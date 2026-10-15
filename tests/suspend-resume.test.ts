import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AgentLoop,
  defineLoopTool,
  type ILoopChatModel,
  type LoopChatResponse,
} from '../src/index.js';

describe('3. 中断与异步挂起/热恢复 (Suspend & Resume)', () => {
  it('3.1 人工介入审批（HITL）：当遇到敏感工具时安全挂起，序列化快照后通过外部注入结果恢复执行', async () => {
    const transferTool = defineLoopTool({
      name: 'transfer_money',
      description: '银行转账工具',
      requiresApproval: true, // 标记必须人工审批
      schema: z.object({
        toAccount: z.string(),
        amount: z.number(),
      }),
      execute: () => {
        throw new Error('Should not be executed locally because requiresApproval=true');
      },
    });

    let turn = 0;
    const mockModel: ILoopChatModel = {
      async invoke({ messages }): Promise<LoopChatResponse> {
        turn++;
        if (turn === 1) {
          return {
            role: 'assistant',
            content: '准备转账 500 元至张三账户。',
            toolCalls: [
              {
                id: 'transfer_call_001',
                name: 'transfer_money',
                arguments: { toAccount: 'zhangsan', amount: 500 },
              },
            ],
          };
        }

        // 恢复后第二轮：收到外部审批结果
        const lastMsg = messages[messages.length - 1]!;
        expect(lastMsg.role).toBe('tool');
        expect(lastMsg.toolCallId).toBe('transfer_call_001');

        return {
          role: 'assistant',
          content: '转账已由人类管理员审批通过，流水号为 TX_88888。',
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [transferTool],
    });

    // 第一次运行：触发挂起
    const firstRun = await loop.run({
      messages: [{ role: 'user', content: '给张三转账 500' }],
    });

    expect(firstRun.suspended).toBe(true);
    expect(firstRun.snapshot.status).toBe('SUSPENDED');
    expect(firstRun.snapshot.suspendReason).toBe('APPROVAL_REQUIRED');
    expect(firstRun.snapshot.suspendDetails?.toolName).toBe('transfer_money');

    // 模拟将快照存入 Redis/数据库（全 JSON 序列化与反序列化测试）
    const serialized = JSON.stringify(firstRun.snapshot);
    const restoredSnapshot = JSON.parse(serialized);

    // 模拟人工在前端审批并调用 resume
    const resumedRun = await loop.resume(restoredSnapshot, [
      {
        toolCallId: 'transfer_call_001',
        result: { approved: true, txId: 'TX_88888', reviewer: 'admin_alice' },
      },
    ]);

    expect(resumedRun.suspended).toBe(false);
    expect(resumedRun.snapshot.status).toBe('COMPLETED');
    expect(resumedRun.output.content).toContain('流水号为 TX_88888');
  });

  it('3.2 外部宿主/客户端挂起（External Tool Execution）：通知客户端执行并在完成后热恢复', async () => {
    const clientBrowseTool = defineLoopTool({
      name: 'client_open_browser',
      description: '客户端打开浏览器',
      executionMode: 'external', // 标记为外部客户端执行
      schema: z.object({ url: z.string() }),
    });

    let step = 0;
    const mockModel: ILoopChatModel = {
      async invoke(): Promise<LoopChatResponse> {
        step++;
        if (step === 1) {
          return {
            role: 'assistant',
            content: '我将在您的浏览器中打开 Google。',
            toolCalls: [
              {
                id: 'browser_cmd_1',
                name: 'client_open_browser',
                arguments: { url: 'https://google.com' },
              },
            ],
          };
        }

        return {
          role: 'assistant',
          content: '浏览器已成功打开目标网页。',
        };
      },
    };

    const loop = new AgentLoop({
      model: mockModel,
      tools: [clientBrowseTool],
    });

    const runResult = await loop.run({
      messages: [{ role: 'user', content: '打开谷歌' }],
    });

    expect(runResult.suspended).toBe(true);
    expect(runResult.snapshot.suspendReason).toBe('EXTERNAL_TOOL_WAIT');

    // 外部执行完毕恢复
    const finalResult = await loop.resume(runResult.snapshot, [
      {
        toolCallId: 'browser_cmd_1',
        result: { status: 'opened', pid: 12345 },
      },
    ]);

    expect(finalResult.suspended).toBe(false);
    expect(finalResult.output.content).toContain('浏览器已成功打开');
  });
});
