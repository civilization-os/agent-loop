import type { LoopToolCall, LoopToolCallDelta } from '../types/model.js';

interface AccumulatedToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

export class ToolStreamAccumulator {
  private readonly callMap = new Map<number, AccumulatedToolCall>();

  /**
   * 追加流式工具切片
   */
  public appendDelta(delta: LoopToolCallDelta, defaultIndex: number = 0): {
    isNew: boolean;
    toolCall: AccumulatedToolCall;
    index: number;
  } {
    const index = delta.index ?? defaultIndex;
    let existing = this.callMap.get(index);
    let isNew = false;

    if (!existing) {
      existing = {
        id: delta.id,
        name: delta.name,
        arguments: '',
      };
      this.callMap.set(index, existing);
      isNew = true;
    } else {
      if (delta.id && !existing.id) existing.id = delta.id;
      if (delta.name && !existing.name) existing.name = delta.name;
    }

    if (delta.arguments) {
      existing.arguments += delta.arguments;
    }

    return { isNew, toolCall: existing, index };
  }

  /**
   * 组装提取全部已完成累积的工具调用列表
   */
  public finalize(): LoopToolCall[] {
    const result: LoopToolCall[] = [];
    const sortedIndices = Array.from(this.callMap.keys()).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      const item = this.callMap.get(index)!;
      result.push({
        id: item.id || `call_${index}_${Date.now()}`,
        name: item.name || 'unknown_tool',
        arguments: item.arguments,
      });
    }

    return result;
  }

  public reset(): void {
    this.callMap.clear();
  }
}
