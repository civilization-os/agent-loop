import { ZodError } from 'zod';
import type { LoopToolCall } from '../types/model.js';
import type { LoopTool } from '../types/tool.js';
import type { LoopState } from '../state/loop-state.js';

export interface RepairHandlerConfig {
  /**
   * 针对同一个工具单次调用最大的自我修正回环次数
   * 默认 2 次
   */
  maxRepairAttempts?: number;
}

export interface ValidationSuccess {
  isValid: true;
  parsedArgs: Record<string, unknown>;
}

export interface ValidationFailure {
  isValid: false;
  shouldRetry: boolean;
  errorType: 'JSON_PARSE_ERROR' | 'SCHEMA_VALIDATION_ERROR' | 'TOOL_NOT_FOUND';
  errorFeedback: string;
  attempt: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export class RepairHandler {
  private readonly maxRepairAttempts: number;

  constructor(config?: RepairHandlerConfig) {
    this.maxRepairAttempts = config?.maxRepairAttempts ?? 2;
  }

  /**
   * 解析与校验工具调用入参。如果失败，自动生成用于塞回 LLM 上下文的纠错信息
   */
  public validateAndParse(
    toolCall: LoopToolCall,
    tool: LoopTool | undefined,
    state: LoopState
  ): ValidationResult {
    const signature = `${toolCall.name}:${toolCall.id}`;
    const currentAttempts = state.repairAttempts.get(signature) ?? 0;

    // 1. 工具未注册情况
    if (!tool) {
      return {
        isValid: false,
        shouldRetry: false,
        errorType: 'TOOL_NOT_FOUND',
        errorFeedback: JSON.stringify({
          status: 'error',
          errorType: 'TOOL_NOT_FOUND',
          message: `Tool '${toolCall.name}' is not available in the current environment.`,
          availableToolsHint: 'Please choose from the registered tools provided in the system prompt.',
        }),
        attempt: currentAttempts,
      };
    }

    // 2. 解析 JSON 参数
    let parsedArgs: Record<string, unknown>;
    if (typeof toolCall.arguments === 'string') {
      try {
        parsedArgs = JSON.parse(toolCall.arguments);
      } catch (err: unknown) {
        const nextAttempt = currentAttempts + 1;
        state.repairAttempts.set(signature, nextAttempt);
        const shouldRetry = nextAttempt <= this.maxRepairAttempts;
        const parseErrorMessage = err instanceof Error ? err.message : String(err);

        return {
          isValid: false,
          shouldRetry,
          errorType: 'JSON_PARSE_ERROR',
          errorFeedback: JSON.stringify({
            status: 'error',
            errorType: 'JSON_PARSE_ERROR',
            tool: toolCall.name,
            attempt: nextAttempt,
            maxAttempts: this.maxRepairAttempts,
            syntaxError: parseErrorMessage,
            malformedInput: toolCall.arguments,
            instruction: shouldRetry
              ? 'Your tool call input was not valid JSON. Please fix syntax errors (e.g. unclosed quotes, brackets, trailing commas) and re-invoke the tool.'
              : 'Maximum repair attempts exceeded for malformed JSON.',
          }),
          attempt: nextAttempt,
        };
      }
    } else {
      parsedArgs = toolCall.arguments ?? {};
    }

    // 3. Schema 校验（如果工具配置了 Zod schema）
    if (tool.schema) {
      const parseResult = tool.schema.safeParse(parsedArgs);
      if (!parseResult.success) {
        const nextAttempt = currentAttempts + 1;
        state.repairAttempts.set(signature, nextAttempt);
        const shouldRetry = nextAttempt <= this.maxRepairAttempts;
        const issues = (parseResult.error as ZodError).issues.map((issue) => ({
          field: issue.path.join('.') || 'root',
          message: issue.message,
          code: issue.code,
        }));

        return {
          isValid: false,
          shouldRetry,
          errorType: 'SCHEMA_VALIDATION_ERROR',
          errorFeedback: JSON.stringify({
            status: 'error',
            errorType: 'SCHEMA_VALIDATION_ERROR',
            tool: toolCall.name,
            attempt: nextAttempt,
            maxAttempts: this.maxRepairAttempts,
            validationIssues: issues,
            providedArguments: parsedArgs,
            instruction: shouldRetry
              ? 'The parameters provided did not match the required schema. Please correct the parameter fields/types according to validationIssues and re-invoke the tool.'
              : 'Maximum repair attempts exceeded for schema validation failure.',
          }),
          attempt: nextAttempt,
        };
      }
      parsedArgs = parseResult.data as Record<string, unknown>;
    }

    // 校验通过，重置该工具调用的纠错计数
    state.repairAttempts.delete(signature);
    return {
      isValid: true,
      parsedArgs,
    };
  }
}
