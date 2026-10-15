import type { LoopMessage, LoopToolCall } from './model.js';
import type { LoopSnapshot } from './state.js';

export type LoopEvent =
  | { type: 'iteration-start'; iteration: number }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call-start'; toolCall: { id: string; name: string } }
  | { type: 'tool-call-delta'; toolCallId: string; delta: string }
  | { type: 'tool-call-ready'; toolCall: LoopToolCall }
  | { type: 'tool-executing'; toolCall: LoopToolCall }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }
  | { type: 'tool-repair-attempt'; toolCallId: string; toolName: string; error: string; attempt: number }
  | { type: 'suspended'; snapshot: LoopSnapshot }
  | { type: 'iteration-end'; iteration: number }
  | { type: 'completed'; output: LoopMessage; snapshot: LoopSnapshot }
  | { type: 'aborted'; reason?: string; snapshot: LoopSnapshot }
  | { type: 'error'; error: Error; snapshot: LoopSnapshot };
