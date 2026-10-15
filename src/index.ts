export { AgentLoop, type AgentLoopConfig, type RunOptions, type ResumeOptions, type LoopExecutionResult } from './loop/agent-loop.js';
export { defineLoopTool, type DefineLoopToolOptions } from './tools/define-tool.js';
export { ToolRegistry } from './tools/tool-registry.js';
export { LoopState } from './state/loop-state.js';
export { LoopCircuitBreaker, type CircuitBreakerConfig } from './correction/loop-circuit-breaker.js';
export { RepairHandler, type RepairHandlerConfig, type ValidationResult } from './correction/repair-handler.js';
export { StreamDispatcher, type DispatchResult } from './stream/stream-dispatcher.js';
export { ToolStreamAccumulator } from './stream/tool-stream-accumulator.js';

export type {
  LoopRole,
  LoopMessage,
  LoopToolCall,
  LoopToolDefinition,
  LoopChatResponse,
  LoopStreamChunk,
  LoopToolCallDelta,
  ILoopChatModel,
} from './types/model.js';

export type {
  LoopTool,
  ToolExecutionMode,
  ToolExecutionContext,
} from './types/tool.js';

export type {
  LoopStatus,
  SuspendReason,
  SuspendDetails,
  LoopSnapshot,
} from './types/state.js';

export type {
  LoopEvent,
} from './types/events.js';

export {
  LoopError,
  LoopAbortedError,
  LoopMaxIterationsError,
  LoopInfiniteLoopError,
  LoopToolExecutionError,
} from './types/errors.js';
