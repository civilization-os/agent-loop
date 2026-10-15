import { nanoid } from 'nanoid';
import type { LoopMessage, LoopToolCall } from '../types/model.js';
import type { LoopSnapshot, LoopStatus, SuspendDetails, SuspendReason } from '../types/state.js';

export class LoopState {
  public readonly loopId: string;
  public iteration: number = 0;
  public status: LoopStatus = 'IDLE';
  public messages: LoopMessage[] = [];
  public pendingToolCalls: LoopToolCall[] = [];
  public suspendReason?: SuspendReason;
  public suspendDetails?: SuspendDetails;
  public metadata: Record<string, unknown> = {};
  public readonly createdAt: number;
  public updatedAt: number;

  /**
   * 记录工具调用特征签名频次，用于死循环检测与纠错计数
   */
  public toolCallSignatures: Map<string, number> = new Map();
  public repairAttempts: Map<string, number> = new Map();

  constructor(options?: {
    loopId?: string;
    messages?: LoopMessage[];
    metadata?: Record<string, unknown>;
    createdAt?: number;
    iteration?: number;
    status?: LoopStatus;
  }) {
    this.loopId = options?.loopId ?? nanoid();
    this.messages = options?.messages ? [...options.messages] : [];
    this.metadata = options?.metadata ? { ...options.metadata } : {};
    this.createdAt = options?.createdAt ?? Date.now();
    this.updatedAt = Date.now();
    this.iteration = options?.iteration ?? 0;
    this.status = options?.status ?? 'IDLE';
  }

  public addMessage(msg: LoopMessage): void {
    this.messages.push(msg);
    this.updatedAt = Date.now();
  }

  public setPendingToolCalls(calls: LoopToolCall[]): void {
    this.pendingToolCalls = [...calls];
    this.updatedAt = Date.now();
  }

  public clearPendingToolCalls(): void {
    this.pendingToolCalls = [];
    this.updatedAt = Date.now();
  }

  public incrementIteration(): number {
    this.iteration += 1;
    this.updatedAt = Date.now();
    return this.iteration;
  }

  public suspend(reason: SuspendReason, details?: SuspendDetails): void {
    this.status = 'SUSPENDED';
    this.suspendReason = reason;
    this.suspendDetails = details;
    this.updatedAt = Date.now();
  }

  public complete(): void {
    this.status = 'COMPLETED';
    this.pendingToolCalls = [];
    this.suspendReason = undefined;
    this.suspendDetails = undefined;
    this.updatedAt = Date.now();
  }

  public abort(): void {
    this.status = 'ABORTED';
    this.updatedAt = Date.now();
  }

  public fail(): void {
    this.status = 'FAILED';
    this.updatedAt = Date.now();
  }

  /**
   * 序列化为纯 JSON 快照，供 Redis/数据库存储
   */
  public toSnapshot(): LoopSnapshot {
    return {
      loopId: this.loopId,
      iteration: this.iteration,
      status: this.status,
      messages: JSON.parse(JSON.stringify(this.messages)),
      pendingToolCalls: this.pendingToolCalls.length > 0 ? JSON.parse(JSON.stringify(this.pendingToolCalls)) : undefined,
      suspendReason: this.suspendReason,
      suspendDetails: this.suspendDetails ? JSON.parse(JSON.stringify(this.suspendDetails)) : undefined,
      metadata: JSON.parse(JSON.stringify(this.metadata)),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * 从快照反序列化重建状态
   */
  public static fromSnapshot(snapshot: LoopSnapshot): LoopState {
    const state = new LoopState({
      loopId: snapshot.loopId,
      messages: snapshot.messages,
      metadata: snapshot.metadata,
      createdAt: snapshot.createdAt,
      iteration: snapshot.iteration,
      status: snapshot.status,
    });
    state.updatedAt = snapshot.updatedAt;
    if (snapshot.pendingToolCalls) {
      state.pendingToolCalls = [...snapshot.pendingToolCalls];
    }
    state.suspendReason = snapshot.suspendReason;
    state.suspendDetails = snapshot.suspendDetails;
    return state;
  }
}
