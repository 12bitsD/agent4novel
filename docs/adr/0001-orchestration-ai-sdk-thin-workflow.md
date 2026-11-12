# 编排层：Vercel AI SDK + 薄 DIY workflow（不上重型框架）

agent4novel 的编排层采用 Vercel AI SDK v7 作为模型/prompt/tool 层，另加自己维护的薄 TypeScript workflow——每步一个纯函数、产物落 SQLite、关卡在应用层 approve/reject。不采用 LangGraph / CrewAI / Mastra / OpenAI Agents SDK 作为编排层：固定 6 步流水线 + 人关卡使"持久化/恢复"基本免费，而这些框架各自带来 Python 割裂、Enterprise 门槛或 `ee/` 授权拆分。依据见 docs/research/agent-tech-stack.md。

状态补充（2026-11-12）：模型/prompt/tool 执行层由 [ADR-0004](./0004-nextloop-model-execution.md) 取代。本页保留原选型背景。

当前状态（2026-11-13）：按 [ADR-0005](./0005-python-backend-migration.md)，薄 workflow、SQLite 产物和应用层人工关卡的职责不变，但实现已迁移到 Python 进程内的 `GenerationPipeline` 与 Nextloop Agent step。Vercel AI SDK、TypeScript workflow 和 Node stdio worker 均不再是生产运行路径；Node/pnpm 仅用于 React/TypeScript 前端构建与开发进程管理。
