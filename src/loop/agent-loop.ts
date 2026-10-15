import type { LoopEvent } from '../types/events.js';
import type { ILoopChatModel, LoopMessage, LoopToolCall } from '../types/model.js';
import type { LoopSnapshot } from '../types/state.js';
import type { LoopTool } from '../types/tool.js';
import { LoopAbortedError, LoopError, LoopMaxIterationsError } from '../types/errors.js';
import { LoopState } from '../state/loop-state.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { LoopCircuitBreaker } from '../correction/loop-circuit-breaker.js';
import { RepairHandler } from '../correction/repair-handler.js';
import { StreamDispatcher } from '../stream/stream-dispatcher.js';

export interface AgentLoopConfig {
  /**
   * 最大迭代轮数，默认 10 轮
   */
  maxIterations?: number;
  /**
   * 单个工具调用最大纠错回环次数，默认 2 次
   */
  maxRepairAttempts?: number;
  /**
   * 相同参数连续重复调用的最大容忍次数，默认 2 次
   */
  maxRepeatedCalls?: number;
  /**
   * 模型温度
   */
  temperature?: number;
  /**
   * 最大输出 Tokens
   */
  maxTokens?: number;
}

export interface RunOptions {
  messages: LoopMessage[];
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  loopId?: string;
}

export interface ResumeOptions {
  signal?: AbortSignal;
}

export interface LoopExecutionResult {
  output: LoopMessage;
  snapshot: LoopSnapshot;
  suspended: boolean;
}

export class AgentLoop {
  private readonly model: ILoopChatModel;
  private readonly toolRegistry: ToolRegistry;
  private readonly circuitBreaker: LoopCircuitBreaker;
  private readonly repairHandler: RepairHandler;
  private readonly streamDispatcher: StreamDispatcher;
  private readonly config: AgentLoopConfig;

  constructor(options: {
    model: ILoopChatModel;
    tools?: LoopTool[];
    config?: AgentLoopConfig;
  }) {
    this.model = options.model;
    this.toolRegistry = new ToolRegistry(options.tools);
    this.config = options.config ?? {};
    this.circuitBreaker = new LoopCircuitBreaker({
      maxIterations: this.config.maxIterations ?? 10,
      maxRepeatedCalls: this.config.maxRepeatedCalls ?? 2,
    });
    this.repairHandler = new RepairHandler({
      maxRepairAttempts: this.config.maxRepairAttempts ?? 2,
    });
    this.streamDispatcher = new StreamDispatcher();
  }

  /**
   * 注册新工具
   */
  public registerTool(tool: LoopTool): void {
    this.toolRegistry.register(tool);
  }

  /**
   * 完整流式执行主循环（通过 AsyncGenerator 驱动双模态输出）
   */
  public async *runStream(options: RunOptions): AsyncGenerator<LoopEvent, LoopExecutionResult, unknown> {
    const state = new LoopState({
      loopId: options.loopId,
      messages: options.messages,
      metadata: options.metadata,
      status: 'RUNNING',
    });
    this.circuitBreaker.reset();

    return yield* this.executeLoop(state, options.signal);
  }

  /**
   * 一次性执行主循环（内部消费流式或直接调用 invoke）
   */
  public async run(options: RunOptions): Promise<LoopExecutionResult> {
    const stream = this.runStream(options);
    let result: IteratorResult<LoopEvent, LoopExecutionResult>;
    do {
      result = await stream.next();
    } while (!result.done);
    return result.value;
  }

  /**
   * 从外部挂起状态快照无缝恢复热执行（Resume）
   */
  public async *resumeStream(
    snapshot: LoopSnapshot,
    externalResults: Array<{ toolCallId: string; result: unknown }>,
    options?: ResumeOptions
  ): AsyncGenerator<LoopEvent, LoopExecutionResult, unknown> {
    const state = LoopState.fromSnapshot(snapshot);
    if (state.status !== 'SUSPENDED') {
      throw new LoopError(`Cannot resume loop with status '${state.status}'. Expected 'SUSPENDED'.`);
    }

    // 将外部结果塞回工具消息上下文
    for (const item of externalResults) {
      state.addMessage({
        role: 'tool',
        toolCallId: item.toolCallId,
        content: typeof item.result === 'string' ? item.result : JSON.stringify(item.result),
      });
    }

    // 重置挂起状态并推进轮次
    state.status = 'RUNNING';
    state.suspendReason = undefined;
    state.suspendDetails = undefined;
    state.clearPendingToolCalls();
    state.incrementIteration();

    return yield* this.executeLoop(state, options?.signal);
  }

  /**
   * 一次性恢复执行
   */
  public async resume(
    snapshot: LoopSnapshot,
    externalResults: Array<{ toolCallId: string; result: unknown }>,
    options?: ResumeOptions
  ): Promise<LoopExecutionResult> {
    const stream = this.resumeStream(snapshot, externalResults, options);
    let result: IteratorResult<LoopEvent, LoopExecutionResult>;
    do {
      result = await stream.next();
    } while (!result.done);
    return result.value;
  }

  /**
   * 核心状态机循环
   */
  private async *executeLoop(
    state: LoopState,
    signal?: AbortSignal
  ): AsyncGenerator<LoopEvent, LoopExecutionResult, unknown> {
    while (true) {
      // 1. 检查取消信号
      if (signal?.aborted) {
        state.abort();
        const snapshot = state.toSnapshot();
        yield { type: 'aborted', reason: signal.reason ? String(signal.reason) : 'User aborted', snapshot };
        throw new LoopAbortedError();
      }

      // 2. 熔断器迭代轮次检查
      try {
        this.circuitBreaker.checkIteration(state.iteration);
      } catch (err: unknown) {
        state.fail();
        const snapshot = state.toSnapshot();
        if (err instanceof Error) {
          yield { type: 'error', error: err, snapshot };
        }
        throw err;
      }

      yield { type: 'iteration-start', iteration: state.iteration };

      // 3. 消费模型输出（优先使用 stream，若未实现则回退 invoke）
      let assistantContent = '';
      let assistantReasoning: string | undefined;
      let toolCalls: LoopToolCall[] = [];

      const toolDefs = this.toolRegistry.getAllDefinitions();

      if (typeof this.model.stream === 'function') {
        const rawStream = this.model.stream({
          messages: state.messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        const dispatcherGen = this.streamDispatcher.dispatch(rawStream, { signal });
        let dispatchStep = await dispatcherGen.next();

        while (!dispatchStep.done) {
          yield dispatchStep.value;
          dispatchStep = await dispatcherGen.next();
        }

        const dispatchResult = dispatchStep.value;
        assistantContent = dispatchResult.content;
        assistantReasoning = dispatchResult.reasoningContent;
        toolCalls = dispatchResult.toolCalls;
      } else {
        const response = await this.model.invoke({
          messages: state.messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          signal,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        });

        assistantContent = response.content;
        assistantReasoning = response.reasoningContent;
        toolCalls = response.toolCalls ?? [];

        if (assistantReasoning) {
          yield { type: 'reasoning-delta', delta: assistantReasoning };
        }
        if (assistantContent) {
          yield { type: 'text-delta', delta: assistantContent };
        }
        for (const tc of toolCalls) {
          yield { type: 'tool-call-ready', toolCall: tc };
        }
      }

      // 4. 取消检查
      if (signal?.aborted) {
        state.abort();
        const snapshot = state.toSnapshot();
        yield { type: 'aborted', reason: signal.reason ? String(signal.reason) : 'User aborted', snapshot };
        throw new LoopAbortedError();
      }

      // 记录助手消息
      const assistantMessage: LoopMessage = {
        role: 'assistant',
        content: assistantContent,
        reasoningContent: assistantReasoning,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      state.addMessage(assistantMessage);

      // 5. 如果没有工具调用，说明思考完成，自然结束
      if (toolCalls.length === 0) {
        state.complete();
        const snapshot = state.toSnapshot();
        yield { type: 'completed', output: assistantMessage, snapshot };
        return { output: assistantMessage, snapshot, suspended: false };
      }

      // 6. 工具调用死循环特征检测
      try {
        this.circuitBreaker.recordAndCheckToolCalls(toolCalls);
      } catch (err: unknown) {
        state.fail();
        const snapshot = state.toSnapshot();
        if (err instanceof Error) {
          yield { type: 'error', error: err, snapshot };
        }
        throw err;
      }

      // 7. 处理工具调用（挂起检测、Schema 校验纠错、本地执行）
      state.setPendingToolCalls(toolCalls);

      for (const call of toolCalls) {
        if (signal?.aborted) {
          state.abort();
          const snapshot = state.toSnapshot();
          yield { type: 'aborted', reason: signal.reason ? String(signal.reason) : 'User aborted', snapshot };
          throw new LoopAbortedError();
        }

        const tool = this.toolRegistry.get(call.name);

        // A. 人工审批挂起（HITL）
        if (tool?.requiresApproval) {
          state.suspend('APPROVAL_REQUIRED', {
            toolCallId: call.id,
            toolName: call.name,
            parameters: call.arguments,
            message: `Tool '${call.name}' requires human approval before execution.`,
          });
          const snapshot = state.toSnapshot();
          yield { type: 'suspended', snapshot };
          return { output: assistantMessage, snapshot, suspended: true };
        }

        // B. 外部宿主/客户端挂起
        if (tool?.executionMode === 'external') {
          state.suspend('EXTERNAL_TOOL_WAIT', {
            toolCallId: call.id,
            toolName: call.name,
            parameters: call.arguments,
            message: `Tool '${call.name}' is marked for external execution.`,
          });
          const snapshot = state.toSnapshot();
          yield { type: 'suspended', snapshot };
          return { output: assistantMessage, snapshot, suspended: true };
        }

        // C. 本地校验与自我纠错（Self-Correction）
        const validation = this.repairHandler.validateAndParse(call, tool, state);

        if (!validation.isValid) {
          yield {
            type: 'tool-repair-attempt',
            toolCallId: call.id,
            toolName: call.name,
            error: validation.errorFeedback,
            attempt: validation.attempt,
          };

          // 将纠错信息塞入 tool 消息，引导模型下一轮自我修正
          state.addMessage({
            role: 'tool',
            toolCallId: call.id,
            content: validation.errorFeedback,
          });
          continue;
        }

        // D. 本地工具正常执行
        yield { type: 'tool-executing', toolCall: call };

        try {
          const result = await tool!.execute!(validation.parsedArgs, {
            toolCallId: call.id,
            signal,
            iteration: state.iteration,
          });

          yield {
            type: 'tool-result',
            toolCallId: call.id,
            toolName: call.name,
            result,
          };

          state.addMessage({
            role: 'tool',
            toolCallId: call.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : String(err);
          const feedback = JSON.stringify({
            status: 'error',
            errorType: 'TOOL_EXECUTION_RUNTIME_ERROR',
            tool: call.name,
            message: errMessage,
          });

          yield {
            type: 'tool-result',
            toolCallId: call.id,
            toolName: call.name,
            result: { error: errMessage },
          };

          state.addMessage({
            role: 'tool',
            toolCallId: call.id,
            content: feedback,
          });
        }
      }

      state.clearPendingToolCalls();
      const currentIteration = state.incrementIteration();
      yield { type: 'iteration-end', iteration: currentIteration };
    }
  }
}
