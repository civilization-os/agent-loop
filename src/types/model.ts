/**
 * 核心模型契约与消息类型定义
 * 100% 遵循结构化子类型（Duck Typing），与 @civilization/model-core 无缝兼容
 */

export type LoopRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LoopToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
}

export interface LoopMessage {
  role: LoopRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LoopToolCall[];
  reasoningContent?: string;
}

export interface LoopToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LoopChatResponse {
  content: string;
  role: 'assistant';
  toolCalls?: LoopToolCall[];
  reasoningContent?: string;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error' | string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface LoopToolCallDelta {
  index?: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface LoopStreamChunk {
  content: string;
  reasoningContent?: string;
  toolCallDeltas?: LoopToolCallDelta[];
  finishReason?: string | null;
}

export interface ILoopChatModel {
  invoke(params: {
    messages: LoopMessage[];
    tools?: LoopToolDefinition[];
    signal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  }): Promise<LoopChatResponse>;

  stream?(params: {
    messages: LoopMessage[];
    tools?: LoopToolDefinition[];
    signal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  }): AsyncGenerator<LoopStreamChunk, void, unknown>;
}
