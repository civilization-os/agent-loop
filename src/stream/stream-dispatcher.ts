import type { LoopEvent } from '../types/events.js';
import type { LoopStreamChunk, LoopToolCall } from '../types/model.js';
import { ToolStreamAccumulator } from './tool-stream-accumulator.js';

export interface DispatchResult {
  content: string;
  reasoningContent?: string;
  toolCalls: LoopToolCall[];
}

export class StreamDispatcher {
  /**
   * 消费 LLM 底层原始流，通过双模态状态机解耦分流为标准的打字机事件与工具指令事件
   */
  public async *dispatch(
    stream: AsyncIterable<LoopStreamChunk>,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<LoopEvent, DispatchResult, unknown> {
    const accumulator = new ToolStreamAccumulator();
    let accumulatedContent = '';
    let accumulatedReasoning = '';

    for await (const chunk of stream) {
      if (options?.signal?.aborted) {
        break;
      }

      // 1. 深度思考流式输出（Reasoning/Thinking Chunks）
      if (chunk.reasoningContent) {
        accumulatedReasoning += chunk.reasoningContent;
        yield { type: 'reasoning-delta', delta: chunk.reasoningContent };
      }

      // 2. 打字机文本流式输出（Text Chunks）
      if (chunk.content) {
        accumulatedContent += chunk.content;
        yield { type: 'text-delta', delta: chunk.content };
      }

      // 3. 工具调用切片收集与状态分流（Tool Calling Chunks）
      if (chunk.toolCallDeltas && chunk.toolCallDeltas.length > 0) {
        for (let i = 0; i < chunk.toolCallDeltas.length; i++) {
          const delta = chunk.toolCallDeltas[i]!;
          const { isNew, toolCall, index } = accumulator.appendDelta(delta, i);

          if (isNew && toolCall.name) {
            yield {
              type: 'tool-call-start',
              toolCall: {
                id: toolCall.id || `call_${index}`,
                name: toolCall.name,
              },
            };
          }

          if (delta.arguments) {
            yield {
              type: 'tool-call-delta',
              toolCallId: toolCall.id || `call_${index}`,
              delta: delta.arguments,
            };
          }
        }
      }
    }

    // 流式结束，提取组装好的完整工具调用
    const toolCalls = accumulator.finalize();
    for (const toolCall of toolCalls) {
      yield { type: 'tool-call-ready', toolCall };
    }

    return {
      content: accumulatedContent,
      reasoningContent: accumulatedReasoning.length > 0 ? accumulatedReasoning : undefined,
      toolCalls,
    };
  }
}
