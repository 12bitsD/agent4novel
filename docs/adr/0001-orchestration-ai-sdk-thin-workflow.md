# 编排层：Vercel AI SDK + 薄 DIY workflow（不上重型框架）

agent4novel 的编排层采用 Vercel AI SDK v7 作为模型/prompt/tool 层，另加自己维护的薄 TypeScript workflow——每步一个纯函数、产物落 SQLite、关卡在应用层 approve/reject。不采用 LangGraph / CrewAI / Mastra / OpenAI Agents SDK 作为编排层：固定 6 步流水线 + 人关卡使"持久化/恢复"基本免费，而这些框架各自带来 Python 割裂、Enterprise 门槛或 `ee/` 授权拆分。依据见 docs/research/agent-tech-stack.md。
