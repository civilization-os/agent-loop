import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AgentLoop,
  defineLoopTool,
  type ILoopChatModel,
  type LoopEvent,
  type LoopStreamChunk,
} from '../src/index.js';

describe('2. 流式传输与工具调用双模态分流状态机 (Dual-Modal Stream State Machine)', () => {
  it('2.1 平滑分离打字机文本流与工具调用，工具参数不污染前端文本流', async () => {
    const echoTool = defineLoopTool({
      name: 'echo',
      description: '回显工具',
      schema: z.object({ text: z.string() }),
      execute: ({ text }) => ({ echoed: text }),
    });

    let turn = 0;
    const mockModel: ILoopChatModel = {
      async invoke() {
        throw new Error('Not used in streaming test');
      },
      async *stream(): AsyncGenerator<LoopStreamChunk, void, unknown> {
        turn++;
        if (turn === 1) {
          // 深度思考阶段
          yield { content: '', reasoningContent: '用户想要查询信息，我需要调用 echo 工具...' };
          // 文本阶段（打字机流）
          yield { content: '好的，' };
          yield { content: '我正在为你查询。' };
          // 工具调用流（切片式输入）
          yield {
            content: '',
            toolCallDeltas: [
              { index: 0, id: 'call_1', name: 'echo', arguments: '{"te' },
            ],
          };
          yield {
            content: '',
            toolCallDeltas: [
              { index: 0, arguments: 'xt": "hello world"}' },
            ],
          };
          return;
        }

        if (turn === 2) {
          yield { content: '查询完成，' };
          yield { content: '结果为 hello world。' };
          return;
        }
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [echoTool],
    });

    const events: LoopEvent[] = [];
    const textDeltas: string[] = [];
    const reasoningDeltas: string[] = [];
    const toolCallReadyEvents: any[] = [];

    for await (const event of loop.runStream({
      messages: [{ role: 'user', content: '测试' }],
    })) {
      events.push(event);
      if (event.type === 'text-delta') {
        textDeltas.push(event.delta);
      } else if (event.type === 'reasoning-delta') {
        reasoningDeltas.push(event.delta);
      } else if (event.type === 'tool-call-ready') {
        toolCallReadyEvents.push(event.toolCall);
      }
    }

    // 验证深度思考流被纯净提取
    expect(reasoningDeltas.join('')).toContain('用户想要查询信息');

    // 验证文本流绝无任何 JSON 乱码或工具调用标签
    const fullText = textDeltas.join('');
    expect(fullText).toContain('好的，我正在为你查询。');
    expect(fullText).toContain('查询完成，结果为 hello world。');
    expect(fullText).not.toContain('call_1');
    expect(fullText).not.toContain('{"te');

    // 验证工具调用被完整拼装成 JSON 对象或完整字符串
    expect(toolCallReadyEvents.length).toBe(1);
    expect(toolCallReadyEvents[0].name).toBe('echo');
    expect(toolCallReadyEvents[0].arguments).toBe('{"text": "hello world"}');
  });
});
