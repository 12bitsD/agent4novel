# 契约管理 — 按边界维护同一份可执行定义

契约的执行定义归代码，领域含义归领域文档，每票的设计理由归 Wiki。此归属在 #13 设计访谈中于 2026-09-05 确认；#13 先落实自身契约，跨模块收敛另开治理票。

## 权威来源

沿用现有 [Wiki 信息边界](../wiki/README.md#信息边界)，不把所有内容复制进 Wiki。

| 内容 | 唯一归属 | 其他来源的用法 |
|---|---|---|
| 领域术语及禁用同义词 | [CONTEXT.md](../../CONTEXT.md) | 直接使用并链接 |
| 数据模型、内容形态、不变量及持久化语义 | [docs/schema.md](../schema.md) | Wiki 解释为何变化，代码实现它 |
| 对外内容、请求、响应、错误契约 | `packages/contracts` | Zod 定义派生类型；消费者复用 |
| 无服务端 ID 的内容变体 | `packages/contracts` 的共享内容 schema 派生 | 例如 SettingDraft，避免生成／请求／存储规则漂移 |
| Step 私有输入与 I/O 包装 | 服务端各 `*-io.ts` | 复用共享内容变体，私有调度字段不提升为公共协议 |
| 每票范围和验收标准 | GitHub issue | Wiki 链接票面，记录实现方案 |
| 每票设计理由、落点与演进 | `docs/wiki/NNN-*.md` | 代码和测试负责当前可执行事实 |
| 难以逆转的跨票架构决定 | `docs/adr/` | Wiki 引用，不另写一套决定 |

## 变更如何交付

每次新增或修改契约，交付 Agent 在该票实现与 review 前确认影响到的生产者、消费者和存储边界。完成步骤仍以 [Ticket 完成审核清单](./ticket-completion-checklist.md) 为唯一来源，本页只说明契约归属。

- 公开的内容／请求／响应定义放入 `packages/contracts`，Web、CLI、路由、测试复用或派生，避免平行维护手写 DTO。
- 模型输出只含模型负责的内容。服务端生成的 ID、状态和版本不交由模型决定；存储边界再次验证最终内容。
- 代码变更时同步 schema 与本票 Wiki；术语变化才更新 CONTEXT。尚未实现的设计必须明确标注，并保留当前可执行契约的入口。

## 当前落差与后续治理

#13 已收敛 Setting 的三种内容边界、通过协议、WorkView／Artifact envelope 和 advance 响应；Web 与 CLI 复用这批可执行定义。仓库仍有通用 `Artifact.content: JsonValue`、其他产物的路由内联请求 schema，以及缺少统一 kind→content 校验入口等落差；不是全仓契约治理已完成。

后续治理票 [#19](https://github.com/12bitsD/agent4novel/issues/19) 负责盘点公开与私有 schema、统一产物内容校验入口、收敛重复 DTO 并补足关键边界验证。排期为 #13 之后、#9 SQLite 和 #5 章纲／正文之前；Hono RPC 类型传输迁移仍归 #15，待服务定型后再做。

物理 SQL 表数、迁移策略和 `materials` 生命周期需在对应票中明确，不能从 JSON schema 或历史 research 推断已经建表。下一位治理 Agent 应先回读本页、`docs/schema.md` 和治理 issue，在实施前补全现状清单与测试计划。
