# `@civilization/agent-loop`

> 高韧性、可中断、流式与工具调用双模态解耦的单智能体（Single-Agent）核心执行循环引擎。

[![CI](https://github.com/civilization-os/agent_loop/actions/workflows/ci.yml/badge.svg)](https://github.com/civilization-os/agent_loop/actions)
[![npm version](https://img.shields.io/npm/v/@civilization/agent-loop.svg)](https://www.npmjs.com/package/@civilization/agent-loop)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

---

## 📖 项目定位与设计哲学

在传统多智能体或 ReAct 架构中，最脆弱的环节往往不是“提示词写得不够好”，而是**底层执行循环（Agent Loop）在面对大模型概率缺陷时的系统级坍塌**：
* 模型生成的 JSON 偶尔缺半个括号或拼错字段；
* 思考陷入死胡同，反复拿着相同参数死循环调用同一个工具，烧光 Token；
* 前端打字机文本流与工具调用结构体互相撕裂，出现 JSON 乱码闪烁；
* 需要人类审批或外部耗时任务时，进程无法安全挂起与持久化恢复；
* 用户点击停止后，底层 HTTP 请求依然在跑，导致竞态写入与脏数据污染。

`@civilization/agent-loop` 作为 Civilization OS 体系的核心执行引擎，专注攻克以上工业级痛点。它既可作为独立的多智能体底层内核运行，也天然无缝适配 `@civilization/model-core` 与 `@civilization/multi-agent`。

```
┌────────────────────────────────────────────────────────┐
│                   AgentLoop 核心架构                    │
└────────────────────────────────────────────────────────┘
          │
          ├── [1] 双模态流式状态机 (StreamDispatcher)
          │    ├── 🧠 深度思考流 (reasoning-delta)
          │    ├── 💬 打字机文本流 (text-delta) ──> 零乱码纯净前端展现
          │    └── 🛠️ 工具调用切片 (tool-call-*) ──> 后台平滑缓冲拼装
          │
          ├── [2] 自我修正与死循环防御 (Self-Correction & Circuit Breaker)
          │    ├── 语法拦截：JSON Parse Error 堆栈回传
          │    ├── 校验拦截：Zod Schema Validation Error 字段定位回环
          │    ├── 指纹排查：工具调用特征签名去重检测
          │    └── 硬性阈值：Max Iterations 强行熔断
          │
          ├── [3] 可序列化挂起与热恢复 (Suspend & Resume)
          │    ├── 👤 人工审批挂起 (requiresApproval: true)
          │    ├── 🌐 外部宿主/客户端挂起 (executionMode: 'external')
          │    └── 💾 LoopSnapshot (100% JSON 可序列化存入 Redis/DB)
          │
          └── [4] 全链路原生取消 (Cancellation & Zero Race-Condition)
               └── 🛑 标准 AbortSignal 贯穿模型、流式分发与工具执行
```

---

## 🌟 核心特性剖析

### 1. 结构化输出坍塌与“无限死循环”防御
- **纠错回环（Repair Loop）**：当模型输出语法错误的 JSON 或字段不符合 Zod 定义时，Loop 不会抛错崩溃，而是将错误原因、字段路径、修复指引自动构造成 `tool` 纠错消息塞回上下文，触发下一次微调修正。
- **调用签名指纹检测（Call Signature Fingerprint）**：自动规范化参数 JSON key 顺序并计算签名。若检测到相同参数连续调用达到阈值（默认 2 次），立即判定为逻辑死循环并安全熔断，杜绝 Token 爆炸。
- **迭代熔断器（Circuit Breaker）**：硬性限制最大执行轮数（`maxIterations`），防止不可预期的循环失控。

### 2. 流式打字机与工具调用的双模态解耦
- **零渗漏文本流**：在流式生成中，思考过程输出为 `reasoning-delta`，正式文本输出为 `text-delta`，工具调用由底层 `ToolStreamAccumulator` 异步拼装。
- **无撕裂感**：前端用户在 Telegram 风格界面上看到的永远是干净、连贯的打字机输出，不会被中途突然蹦出的原始工具调用 JSON 片段所破坏。

### 3. 中断与异步挂起 / 热恢复（Suspend & Resume）
- **告别 `while(true)`**：支持将 Loop 挂起并生成 `LoopSnapshot` 快照。
- **持久化友好**：快照包含当前的迭代计数、消息队列、挂起原因、待执行工具。可以直接通过 `JSON.stringify(snapshot)` 存入 Redis / PostgreSQL。
- **热恢复**：外部完成审批或客户端操作后，调用 `loop.resume(snapshot, externalOutputs)`，从断点处无缝继续后续逻辑。

### 4. 异步取消与竞态条件防御（Cancellation）
- 原生支持标准 Web API `AbortSignal`。
- 一旦取消触发，不仅立即中断底层 LLM 的网络连接，还会联动取消正在执行的本地异步任务，并将 Loop 状态原子切换为 `ABORTED`，彻底杜绝后续迟到数据对状态的污染。

---

## 📦 安装与快速开始

```bash
npm install @civilization/agent-loop
```

### 极简示例（结合 Zod 工具定义）

```typescript
import { z } from 'zod';
import { AgentLoop, defineLoopTool } from '@civilization/agent-loop';

// 1. 定义工具（带参数校验与本地执行逻辑）
const searchTool = defineLoopTool({
  name: 'search_database',
  description: '查询数据库中的用户信息',
  schema: z.object({
    userId: z.string().describe('用户唯一标识'),
  }),
  execute: async ({ userId }) => {
    return { userId, name: 'Alice', role: 'admin' };
  },
});

// 2. 初始化 Loop（model 兼容 @civilization/model-core 导出的任意实例）
const loop = new AgentLoop({
  model: myModelInstance,
  tools: [searchTool],
  config: {
    maxIterations: 5,
    maxRepairAttempts: 2,
  },
});

// 3. 执行流式打字机
for await (const event of loop.runStream({
  messages: [{ role: 'user', content: '查询用户 usr_12345 的资料' }],
})) {
  switch (event.type) {
    case 'text-delta':
      process.stdout.write(event.delta); // 纯净的文本打字机
      break;
    case 'tool-executing':
      console.log(`\n[执行工具]: ${event.toolCall.name}`);
      break;
    case 'completed':
      console.log('\n[任务执行完成]');
      break;
  }
}
```

---

## 🔄 中断挂起与热恢复（HITL 场景）

```typescript
// 声明一个需要人工审批的高危工具
const deleteUserTool = defineLoopTool({
  name: 'delete_user',
  description: '删除用户账户',
  requiresApproval: true, // 标记为需要人工审核
  schema: z.object({ userId: z.string() }),
});

const loop = new AgentLoop({ model: myModel, tools: [deleteUserTool] });

// 第一阶段：运行至审批点自动挂起
const runResult = await loop.run({
  messages: [{ role: 'user', content: '删除用户 usr_999' }],
});

if (runResult.suspended) {
  console.log('任务已安全挂起，原因:', runResult.snapshot.suspendReason);
  // 保存至 Redis
  await redis.set(`agent_snapshot:${runResult.snapshot.loopId}`, JSON.stringify(runResult.snapshot));
}

// 第二阶段：人类管理员在后台点击“同意”后，从 Redis 读取快照并恢复
const cachedSnapshot = JSON.parse(await redis.get('agent_snapshot:...'));
const finalResult = await loop.resume(cachedSnapshot, [
  {
    toolCallId: cachedSnapshot.suspendDetails.toolCallId,
    result: { approved: true, deleted: true, operator: 'admin_bob' },
  },
]);
```

---

## 📡 事件系统清单 (`LoopEvent`)

| 事件名称 | 描述 | 载荷字段 |
| :--- | :--- | :--- |
| `iteration-start` | 单轮执行开始 | `{ iteration }` |
| `reasoning-delta` | 深度思考（Thinking）流式切片 | `{ delta }` |
| `text-delta` | 纯净打字机文本切片（前端直接消费） | `{ delta }` |
| `tool-call-start` | 大模型开启工具调用意图 | `{ toolCall: { id, name } }` |
| `tool-call-delta` | 工具参数原始增量切片 | `{ toolCallId, delta }` |
| `tool-call-ready` | 工具参数完整拼装完成 | `{ toolCall }` |
| `tool-executing` | 工具开始在本地执行 | `{ toolCall }` |
| `tool-result` | 工具执行完成并获得返回值 | `{ toolCallId, toolName, result }` |
| `tool-repair-attempt` | 触发自我修正回环（JSON/Schema 失败） | `{ toolCallId, error, attempt }` |
| `suspended` | 循环进入挂起状态（等待外部输入） | `{ snapshot }` |
| `completed` | 思考全部完成并给出最终答复 | `{ output, snapshot }` |
| `aborted` | 由 AbortSignal 成功优雅中断 | `{ reason, snapshot }` |
| `error` | 发生不可恢复的致命异常 | `{ error, snapshot }` |

---

## 🧪 自动化测试验证

本项目拥有完善的单元测试覆盖，针对 4 大核心痛点均编写了高覆盖率用例：

```bash
npm test
```

```text
 ✓ tests/dual-modal-stream.test.ts (1 test)
 ✓ tests/suspend-resume.test.ts (2 tests)
 ✓ tests/self-correction.test.ts (4 tests)
 ✓ tests/cancellation.test.ts (2 tests)

 Test Files  4 passed (4)
      Tests  9 passed (9)
```

---

## 📄 开源许可证

本项目基于 [Apache-2.0](./LICENSE) 协议开源。
