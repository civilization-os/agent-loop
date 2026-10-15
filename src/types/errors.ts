export class LoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoopError';
  }
}

export class LoopAbortedError extends LoopError {
  constructor(message: string = 'Agent loop execution was aborted by AbortSignal') {
    super(message);
    this.name = 'LoopAbortedError';
  }
}

export class LoopMaxIterationsError extends LoopError {
  public readonly iteration: number;
  constructor(iteration: number, message?: string) {
    super(message ?? `Agent loop reached maximum allowed iterations: ${iteration}`);
    this.name = 'LoopMaxIterationsError';
    this.iteration = iteration;
  }
}

export class LoopInfiniteLoopError extends LoopError {
  public readonly signature: string;
  public readonly count: number;
  constructor(signature: string, count: number, message?: string) {
    super(
      message ??
        `Infinite loop detected: tool call [${signature}] was repeatedly invoked ${count} times without progress.`
    );
    this.name = 'LoopInfiniteLoopError';
    this.signature = signature;
    this.count = count;
  }
}

export class LoopToolExecutionError extends LoopError {
  public readonly toolName: string;
  public readonly toolCallId: string;
  public readonly originalError: unknown;

  constructor(toolName: string, toolCallId: string, originalError: unknown) {
    super(`Tool [${toolName}] execution failed: ${originalError instanceof Error ? originalError.message : String(originalError)}`);
    this.name = 'LoopToolExecutionError';
    this.toolName = toolName;
    this.toolCallId = toolCallId;
    this.originalError = originalError;
  }
}
