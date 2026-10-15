import { z } from 'zod';
import type { LoopToolDefinition } from './model.js';

export type ToolExecutionMode = 'local' | 'external';

export interface ToolExecutionContext {
  toolCallId: string;
  signal?: AbortSignal;
  iteration: number;
}

export interface LoopTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema?: TSchema;
  /**
   * 执行模式：
   * - 'local': 由 Loop 本地直接执行 execute 函数
   * - 'external': 外部挂起型工具（如需要客户端/浏览器执行、耗时工作流），遇到时 Loop 会挂起（Suspend）
   */
  executionMode?: ToolExecutionMode;
  /**
   * 是否需要人工介入审批（Human-In-The-Loop）
   * 如果为 true，Loop 在执行前会挂起（Suspend），等待外部审批通过后 resume
   */
  requiresApproval?: boolean;
  /**
   * 工具本地执行体
   */
  execute?: (args: z.infer<TSchema>, ctx: ToolExecutionContext) => Promise<unknown> | unknown;
  /**
   * 导出的 JSON Schema 定义
   */
  definition: LoopToolDefinition;
}
