import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AgentLoop,
  defineLoopTool,
  LoopInfiniteLoopError,
  LoopMaxIterationsError,
  type ILoopChatModel,
  type LoopChatResponse,
  type LoopMessage,
} from '../src/index.js';

describe('1. 结构化输出坍塌与死循环防御 (Self-Correction & Infinite Loop Breaker)', () => {
  it('1.1 当大模型输出非法 JSON 语法时，Loop 自动捕获语法错误并注入纠错回环，指导模型在下一轮修正', async () => {
    let callCount = 0;
    const weatherTool = defineLoopTool({
      name: 'get_weather',
      description: '查询天气',
      schema: z.object({
        city: z.string(),
      }),
      execute: ({ city }) => ({ city, temperature: 25, condition: 'Sunny' }),
    });

    const mockModel: ILoopChatModel = {
      async invoke({ messages }): Promise<LoopChatResponse> {
        callCount++;
        if (callCount === 1) {
          // 第一次输出残缺破坏的 JSON（缺少闭合花括号）
          return {
            role: 'assistant',
            content: '让我为你查询东京的天气。',
            toolCalls: [
              {
                id: 'call_weather_1',
                name: 'get_weather',
                arguments: '{"city": "Tokyo"', // 故意语法坍塌
              },
            ],
          };
        }

        // 第二次：检查上下文是否有纠错提示
        const lastMsg = messages[messages.length - 1];
        expect(lastMsg?.role).toBe('tool');
        const feedback = JSON.parse(lastMsg!.content);
        expect(feedback.status).toBe('error');
        expect(feedback.errorType).toBe('JSON_PARSE_ERROR');

        // 模型在下一轮纠正为正确的 JSON
        if (callCount === 2) {
          return {
            role: 'assistant',
            content: '东京现在的天气是晴天，25度。',
          };
        }

        return { role: 'assistant', content: '完成' };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [weatherTool],
      config: { maxIterations: 5, maxRepairAttempts: 2 },
    });

    const result = await loop.run({
      messages: [{ role: 'user', content: '东京天气如何？' }],
    });

    expect(result.suspended).toBe(false);
    expect(result.output.content).toContain('东京现在');
    expect(callCount).toBe(2);
  });

  it('1.2 当大模型入参不符合 Zod Schema 时，Loop 提取具体字段校验错误并回传，指导模型修正字段', async () => {
    let turn = 0;
    const calculateTool = defineLoopTool({
      name: 'calculate',
      description: '数学计算',
      schema: z.object({
        a: z.number().describe('第一个数，必须是数字'),
        b: z.number().describe('第二个数，必须是数字'),
        operation: z.enum(['add', 'multiply']),
      }),
      execute: ({ a, b, operation }) => {
        return operation === 'add' ? a + b : a * b;
      },
    });

    const mockModel: ILoopChatModel = {
      async invoke({ messages }): Promise<LoopChatResponse> {
        turn++;
        if (turn === 1) {
          // 第一次：参数类型传错（传递了字符串且缺失 operation）
          return {
            role: 'assistant',
            content: '正在计算...',
            toolCalls: [
              {
                id: 'calc_1',
                name: 'calculate',
                arguments: JSON.stringify({ a: '100', b: '200' }), // a 和 b 都是 string，且漏了 operation
              },
            ],
          };
        }

        if (turn === 2) {
          const lastMsg = messages[messages.length - 1]!;
          expect(lastMsg.role).toBe('tool');
          const feedback = JSON.parse(lastMsg.content);
          expect(feedback.status).toBe('error');
          expect(feedback.errorType).toBe('SCHEMA_VALIDATION_ERROR');
          expect(feedback.validationIssues.length).toBeGreaterThan(0);

          // 模型纠正并输出正确参数
          return {
            role: 'assistant',
            content: '纠正参数后重新调用：',
            toolCalls: [
              {
                id: 'calc_2',
                name: 'calculate',
                arguments: JSON.stringify({ a: 100, b: 200, operation: 'add' }),
              },
            ],
          };
        }

        return {
          role: 'assistant',
          content: '计算结果是 300。',
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [calculateTool],
    });

    const result = await loop.run({
      messages: [{ role: 'user', content: '帮我计算 100 + 200' }],
    });

    expect(result.output.content).toBe('计算结果是 300。');
    expect(turn).toBe(3);
  });

  it('1.3 相同参数重复调用死循环（Tool Calling Infinite Loop）时熔断拦截', async () => {
    const dummyTool = defineLoopTool({
      name: 'search',
      description: '搜索信息',
      execute: () => ({ result: '未找到关键线索' }),
    });

    // 模型陷入死胡同，反复拿着同一个参数调用同一个工具
    const mockModel: ILoopChatModel = {
      async invoke(): Promise<LoopChatResponse> {
        return {
          role: 'assistant',
          content: '找不到线索，我再搜一遍...',
          toolCalls: [
            {
              id: 'call_search',
              name: 'search',
              arguments: { query: 'killer identity' },
            },
          ],
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [dummyTool],
      config: { maxRepeatedCalls: 2 }, // 允许最多重复 2 次，第 3 次熔断
    });

    await expect(
      loop.run({
        messages: [{ role: 'user', content: '凶手是谁？' }],
      })
    ).rejects.toThrow(LoopInfiniteLoopError);
  });

  it('1.4 超过最大硬性迭代次数（Max Iterations）时安全熔断', async () => {
    let iterationCount = 0;
    const endlessTool = defineLoopTool({
      name: 'tick',
      description: '计时器',
      execute: () => {
        iterationCount++;
        return { count: iterationCount };
      },
    });

    // 每次参数变化，但永远不停止
    const mockModel: ILoopChatModel = {
      async invoke(): Promise<LoopChatResponse> {
        return {
          role: 'assistant',
          content: '继续执行下一轮...',
          toolCalls: [
            {
              id: `call_${iterationCount}`,
              name: 'tick',
              arguments: { timestamp: Date.now() + iterationCount },
            },
          ],
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [endlessTool],
      config: { maxIterations: 3 }, // 限制最大 3 轮
    });

    await expect(
      loop.run({
        messages: [{ role: 'user', content: '开始' }],
      })
    ).rejects.toThrow(LoopMaxIterationsError);
  });
});
