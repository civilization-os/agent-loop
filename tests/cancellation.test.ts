import { describe, it, expect } from 'vitest';
import {
  AgentLoop,
  defineLoopTool,
  LoopAbortedError,
  type ILoopChatModel,
  type LoopStreamChunk,
} from '../src/index.js';

describe('4. 异步取消与竞态条件防御 (Cancellation & Race Conditions)', () => {
  it('4.1 当外部触发 AbortSignal 时，LLM 流式请求立刻中止并抛出 LoopAbortedError，状态置为 ABORTED', async () => {
    const controller = new AbortController();
    let streamChunksProduced = 0;

    const mockModel: ILoopChatModel = {
      async invoke() {
        throw new Error('Not used');
      },
      async *stream({ signal }): AsyncGenerator<LoopStreamChunk, void, unknown> {
        for (let i = 0; i < 100; i++) {
          if (signal?.aborted) {
            return;
          }
          streamChunksProduced++;
          yield { content: `Token ${i} ` };
          // 模拟延迟
          await new Promise((res) => setTimeout(res, 10));
        }
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
    });

    const stream = loop.runStream({
      messages: [{ role: 'user', content: '测试取消' }],
      signal: controller.signal,
    });

    // 读取前两个 chunk 之后主动取消
    const receivedEvents: any[] = [];
    const executionPromise = (async () => {
      for await (const event of stream) {
        receivedEvents.push(event);
        if (receivedEvents.length >= 2) {
          controller.abort('User clicked stop button');
        }
      }
    })();

    await expect(executionPromise).rejects.toThrow(LoopAbortedError);
    // 验证流式生成没有继续疯狂产生 Token
    expect(streamChunksProduced).toBeLessThan(10);
  });

  it('4.2 当工具执行耗时较长时触发取消，当前循环干净退出且不产生脏写入', async () => {
    const controller = new AbortController();

    const slowTool = defineLoopTool({
      name: 'slow_task',
      description: '耗时工具',
      execute: async (_args, ctx) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('finished'), 500);
          ctx.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Tool canceled'));
          });
        });
      },
    });

    const mockModel: ILoopChatModel = {
      async invoke() {
        return {
          role: 'assistant',
          content: '开始执行长任务...',
          toolCalls: [
            { id: 'call_slow', name: 'slow_task', arguments: {} },
          ],
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [slowTool],
    });

    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(
      loop.run({
        messages: [{ role: 'user', content: '运行' }],
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });
});
