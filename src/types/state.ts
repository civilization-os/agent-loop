import type { LoopMessage, LoopToolCall } from './model.js';

export type LoopStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'STREAMING'
  | 'EXECUTING_TOOLS'
  | 'SUSPENDED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED';

export type SuspendReason =
  | 'APPROVAL_REQUIRED'
  | 'EXTERNAL_TOOL_WAIT'
  | 'CUSTOM_SUSPEND';

export interface SuspendDetails {
  toolCallId?: string;
  toolName?: string;
  parameters?: unknown;
  message?: string;
}

/**
 * 可序列化保存的 Loop 快照，完全支持存储至 Redis/数据库实现跨进程、跨请求持久化
 */
export interface LoopSnapshot {
  loopId: string;
  iteration: number;
  status: LoopStatus;
  messages: LoopMessage[];
  pendingToolCalls?: LoopToolCall[];
  suspendReason?: SuspendReason;
  suspendDetails?: SuspendDetails;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
