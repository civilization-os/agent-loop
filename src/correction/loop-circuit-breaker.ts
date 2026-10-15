import type { LoopToolCall } from '../types/model.js';
import { LoopInfiniteLoopError, LoopMaxIterationsError } from '../types/errors.js';

export interface CircuitBreakerConfig {
  /**
   * 最大允许循环迭代次数，超过将强行熔断抛出 LoopMaxIterationsError
   * 默认 10 轮
   */
  maxIterations?: number;
  /**
   * 相同工具相同参数连续重复调用的最大容忍次数，超过将判定为死循环并抛出 LoopInfiniteLoopError
   * 默认 2 次（即第 3 次重复时熔断）
   */
  maxRepeatedCalls?: number;
}

export class LoopCircuitBreaker {
  private readonly maxIterations: number;
  private readonly maxRepeatedCalls: number;
  private readonly callHistory: string[] = [];

  constructor(config?: CircuitBreakerConfig) {
    this.maxIterations = config?.maxIterations ?? 10;
    this.maxRepeatedCalls = config?.maxRepeatedCalls ?? 2;
  }

  /**
   * 检查当前轮次是否超过硬性迭代上限
   */
  public checkIteration(iteration: number): void {
    if (iteration >= this.maxIterations) {
      throw new LoopMaxIterationsError(iteration);
    }
  }

  /**
   * 检查工具调用是否存在死循环特征
   */
  public recordAndCheckToolCalls(toolCalls: LoopToolCall[]): void {
    for (const call of toolCalls) {
      const signature = this.computeSignature(call);
      this.callHistory.push(signature);

      // 计算最近历史记录中连续匹配该签名的次数
      let consecutiveCount = 0;
      for (let i = this.callHistory.length - 1; i >= 0; i--) {
        if (this.callHistory[i] === signature) {
          consecutiveCount++;
        } else {
          break;
        }
      }

      if (consecutiveCount > this.maxRepeatedCalls) {
        throw new LoopInfiniteLoopError(signature, consecutiveCount);
      }
    }
  }

  /**
   * 生成规范化签名，确保 JSON key 顺序不影响指纹比较
   */
  public computeSignature(call: LoopToolCall): string {
    const rawArgs = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments);
    let canonicalArgs = rawArgs;
    try {
      const parsed = JSON.parse(rawArgs);
      canonicalArgs = JSON.stringify(this.sortObjectKeys(parsed));
    } catch {
      // 保持原始字符串
    }
    return `${call.name}:${canonicalArgs}`;
  }

  private sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = this.sortObjectKeys(record[key]);
    }
    return result;
  }

  public reset(): void {
    this.callHistory.length = 0;
  }
}
