---
wiki_id: "073"
ticket: 73
ticket_state: planned
context_state: current
summary: "模型断连取消传播与 shutdown（等待 #15 基线，未实施）"
topics: ["llm", "cancellation", "shutdown", "pipeline", "reliability"]
code_paths: ["apps/server/src/routes/works.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/steps/llm-call.ts", "apps/server/src/runtime/shutdown.ts"]
symbols: ["AbortSignal", "callLlm", "Pipeline"]
inherits: ["069", "016", "005", "022"]
changed_by: []
read_when: ["implement-llm-cancellation", "propagate-request-abort"]
last_context_reviewed: "2026-11-13"
---

# 073 — 模型取消传播与 shutdown（阻塞）

## Agent Context

- **读取时机**：#15 基线固定后，实施请求断连取消、生成锁释放或 shutdown 取消时。
- **原始目的**：#67 要求避免客户端断开后继续付费推理、持锁并可能提交。
- **实际落地**：未实施；当前仅有风险确认、issue 和验收设计。
- **当前价值**：现有 #69 快照接缝与 Wiki 016 超时语义是后续实现边界。
- **后续变化**：等待 #15 路由候选形成已提交基线。
- **代码入口**：`routes/works.ts`、`pipeline.ts`、`steps/llm-call.ts`、`runtime/shutdown.ts`。

## 设计目的

将外部 AbortSignal 贯通 route → Pipeline → Step → callLlm，并与内部 timeout 合并；区分外部取消和 llm-timeout，保证锁释放和 append 前后提交语义准确。

## 起始上下文

现有 `generateObject` 只接收内部 `AbortSignal.timeout`。CLI 中断自己的 fetch 不会撤销服务端模型调用。真实 Hono Node 断连传播必须用 socket 集成测试证明，不能只测手工 AbortController。

## 技术方案

后续在 #15 基线上传递可选 signal，在自动 Step 开始前、模型返回后和 append 前检查取消；进入同步 Store 原子提交后允许完成。shutdown 复用同一取消入口，不引入后台队列。

## 代码落点

当前未修改。计划涉及路由、Pipeline/Step 类型、callLlm 和 shutdown 测试。

## 测试与验证

### 完成审核证据

- **清单与候选**：仅计划，无候选 tree。
- **逐项判定**：C1 已完成范围/依赖对齐；C2–C7 N/A（等待 #15，未实施）。
- **验收与 TDD**：计划真实 socket 断连、append 前后、取消后重试、内部 timeout 和多步链不启动后续 Step。
- **本地门禁**：未执行，不得记 PASS。
- **双轴 review**：未执行。
- **修复与回归**：未实施。
- **知识维护**：本页记录阻塞；生产文档未宣称能力已实现。
- **发布前裁决**：blocked by #15、#69，不进入发布。

## 边界与非目标

不把客户端 abort 当成已取消 provider 的证明，不改变 committed/unknown 语义，不引入分布式锁或任务队列。

## 上下文演进

### 2026-11-13 — 记录外部依赖

- **触发证据**：路由与 #15 未提交 RPC 工作重叠，不能在不夹带用户改动的前提下修改。
- **原假设**：可直接沿现有路由传播 signal，但当前工作区所有权未固定。
- **决定**：等待 #15 已提交基线，不在本治理分支提前实现。
- **影响**：M1–M5 可独立交付，本项保持未完成。
- **上下文处理**：preserve 风险与验收设计，明确未实施状态。

## 交接结论

#15 基线固定后从本页和 #69 继续；在此之前不得宣称断连取消或 shutdown 取消已经实现。
