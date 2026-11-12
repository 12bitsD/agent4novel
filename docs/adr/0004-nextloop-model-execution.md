# 节点模型执行使用 Python Nextloop

状态：Superseded by [ADR-0005](./0005-python-backend-migration.md) · 2026-11-13 · 原决定 Accepted · 2026-11-12

> 本页保留以 Nextloop 执行六节点模型调用的选型理由。后续验证表明不再需要 Node → Python stdio 适配层；现由 FastAPI 与 Python CLI 直接调用同一锁定 Nextloop 包，原“全后端 Python 重写不采用”的首版取舍已被人为确认的全量迁移取代。

用户指定以 Nextloop 1.0.0 替换六个创作节点的 Agent loop。保留 `callLlm` 接口，由 Node 按次启动 Python 3.11 worker，通过有界 stdio 调用 Nextloop `AgentLoop` 与 `OpenAIProvider`；最终 JSON 仍由 Node Zod 校验后进入既有 WorkStore。

Node 继续承担 Hono、Web、CLI、Pipeline、人工关卡和 SQLite。Nextloop 使用单次调用的 `InMemoryEventStore` 与空 ToolRegistry，不新增 HTTP 端口、作品事件迁移、跨重启恢复或工具执行。

## Consequences

- ADR-0001 的薄 TypeScript workflow 和应用层人工关卡继续有效；其 Vercel AI SDK 模型/prompt/tool 层由本决定取代。AI SDK Provider 依赖移除。
- 源码 live 运行需要项目内 Python 3.11 虚拟环境；Docker 镜像包含同一锁定环境。demo 仍使用 FakeStep，不调用 Provider。
- Provider 重试、deadline、usage 和安全错误经 stdio 映射到既有遥测与 `llm-*` 契约；密钥只通过子进程环境读取，不进入请求 JSON、命令行或调用记录。
- 全后端 Python 重写和常驻 sidecar 都扩大迁移或进程管理范围，首版不采用。跨重启恢复、Nextloop SQLite、MCP/Tool 和自治多 Step 属于后续独立决策。
