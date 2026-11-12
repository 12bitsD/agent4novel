# 后端全量迁移到 Python

状态：Accepted · 2026-11-13

用户确认目标为后端全部迁移到 Python。生产环境不再运行 Node 后端；Node 仅保留 React/TypeScript 前端构建工具。FastAPI、Pydantic、Nextloop、Python sqlite3 与 Python CLI 共同承担现有后端行为。

迁移采用垂直切片：契约与只读 API → 原生 Agent 与 Caption/Creative → 完整首章 → 多章与辅助资源 → CLI 与交付 → 切换删除。每个切片必须通过现有行为对照、故障矩阵和源码/Docker 验收，未完成等价验证前不得删除 Node 实现。

## Consequences

- ADR-0001 的薄 workflow 与人工关卡继续有效，但实现语言改为 Python；ADR-0003 的 Node 同源生产进程由 Python 同源进程取代；ADR-0004 的 Node → Python stdio Adapter 在原生 Agent 接入后移除。
- 现有 SQLite v4、Artifact 身份/版本/状态、条件写入、作者配置、不可变文件、unknown 恢复和整目录备份语义必须先复刻，再开发 Work Wiki 或 Tool 能力。
- Hono RPC 不再是最终 Web 类型边界。现有 Zod 暂留前端运行时验证，Python 提供 OpenAPI 与跨语言 golden fixtures。
- 不长期维护 Node/Python 双生产实现，不引入 ORM、常驻 sidecar 或新的 Agent 框架。回滚依赖数据副本与已审核候选，不能依赖旧程序读取未来 schema。
