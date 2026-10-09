---
wiki_id: "046"
ticket: 46
ticket_state: active
context_state: current
summary: "首次并发打开 SQLite 空库时，对可重试锁竞争做有界初始化重试并保留安全诊断"
topics: ["sqlite", "concurrency", "initialization", "reliability"]
code_paths: ["apps/server/src/store/sqlite-store.ts", "apps/server/src/store/sqlite-schema.ts", "apps/server/test/sqlite-process.test.ts"]
symbols: ["SqliteStore", "initializeSqliteSchema", "createWorksIfEmpty"]
inherits: ["009"]
changed_by: []
read_when: ["fix-sqlite-initialization", "diagnose-database-lock", "change-storage-concurrency"]
last_context_reviewed: "2026-10-10"
---

# 046 — SQLite 并发首次建库

## Agent Context

- **读取时机**：修改 SQLite 首次打开、迁移、WAL 设置、空书架 seed 或多进程存储竞争时，先读本页和 [Wiki009](./009-sqlite-persistence.md)。
- **原始目的**：两个进程同时首次打开空数据库时，偶发一个进程收到 `unexpected-error`，而另一个进程完成 seed；已知解释是初始化/WAL 阶段的 SQLite 锁竞争。
- **实际落地**：待本票 Loop 完成后填写。目标是只对允许的 `SQLITE_BUSY*` 锁竞争做有界重试，不改变未知库、损坏库、迁移错误、CAS 和终止恢复语义。
- **当前价值**：#51 的节点实验目录与作品 SQLite 数据库保持分离；本票只修复作品数据库初始化可靠性，不建立实验记录平台。
- **后续变化**：暂无。
- **代码入口**：`SqliteStore` 构造函数、`initializeSqliteSchema`、`createWorksIfEmpty`、`test/sqlite-process.test.ts`。

## 设计目的

让两个独立进程首次打开同一空数据库时都能完成初始化，且只由一个进程执行空书架 seed。锁竞争需要等待，但等待必须有界；不可重试错误必须继续失败，并提供不泄露路径、数据库内容或凭据的阶段与 SQLite 错误码诊断。

## 起始上下文

- 票面为 [GitHub #46](https://github.com/12bitsD/agent4novel/issues/46)，属于第二期基础可靠性，排在 #51 之后。
- 现行构造顺序是：创建文件、打开连接（`timeout: 5000`）、外键、事务迁移、WAL、`synchronous=FULL`。构造函数将异常压缩为普通 Error，进程 worker 因而只能看到 `unexpected-error`。
- `initializeSqliteSchema` 在事务内重新读取 `user_version` 和对象，已有有效库重开、迁移、CAS 写入、seed 原子性和强杀恢复属于必须保留的行为。
- 现有 `sqlite-process.test.ts` 有双进程首次 seed 回归，但竞争结果受调度影响；本票新增可控锁竞争证据，不能用重复跑偶发测试替代。

## 验收与 Eval 标准

以下是实施 Agent 开始前固定的验收标准。验收以代码/测试结果为准，不允许实施 Agent 自行降低范围或把偶发通过当作并发修复。

- **AC1 并发首次打开**：两个独立进程共享全新数据库并同时执行初始化与 seed，两个进程均成功返回；最终作品恰好两条；seed 结果恰好一次 `true`、一次 `false`；不得出现 `unexpected-error`。
- **AC2 锁竞争重试边界**：初始化只重试显式允许的 SQLite busy 错误族；重试次数或总等待时间固定有界；释放锁后能继续完成；永不无限循环。
- **AC3 不吞真实错误**：未知 schema、未来版本、损坏文件、迁移 SQL 失败、`SQLITE_LOCKED` 或其他非允许错误不被重试改写为成功；原有安全失败语义保持。
- **AC4 数据与旧语义**：已有库重开、v1/v2 迁移、CAS 保存、seed 原子回滚、已提交写入恢复、未提交事务强杀回滚的现有测试继续通过；不重复 seed、不产生半份作品。
- **AC5 安全诊断**：失败诊断至少能区分初始化阶段、允许的 SQLite 错误码和已尝试次数；不得包含数据库完整路径、作品正文、seed、配置凭据或完整数据库内容；外部启动错误仍不回显敏感值。
- **AC6 工程收敛**：不引入跨进程锁文件、任务队列、新数据库表、实验遥测平台或改变 `WorkStore` 业务接口；重试封装只覆盖初始化接缝。

固定 Eval 命令：

```bash
pnpm --filter @agent4novel/server exec vitest run test/sqlite-initialization.test.ts test/sqlite-process.test.ts
pnpm --filter @agent4novel/server exec vitest run test/sqlite-store.test.ts test/store.test.ts test/sqlite-restart.test.ts
pnpm test
pnpm typecheck
pnpm build
```

验收还要求至少一条实际多进程回归和一条可控锁持有/释放用例。可控用例必须能在修复前形成 RED，在修复后 GREEN；不可用 `sleep` 碰运气证明。全量门禁、双轴 review、CI 和远端回读按 `docs/agents/ticket-completion-checklist.md` 执行。

## 技术方案（实施约束）

- 保持 `SqliteStore(path)`、`initializeSqliteSchema(db)` 和 `WorkStore` 业务接口兼容；可在存储内部新增初始化诊断类型/辅助函数。
- 把外键、schema 迁移、WAL、`synchronous=FULL` 视为同一初始化阶段的重试边界；一次尝试失败后必须让事务/连接回到可重试状态。
- 允许的错误码使用明确的 SQLite `SQLITE_BUSY` 家族判定；不以任意错误 message 模糊匹配，不把 `SQLITE_LOCKED` 当成可重试竞争。
- 诊断字段使用阶段、sqlite code、attempts、retryable 等安全元数据；保留原有对用户的通用错误文案，不打印路径和内容。
- 优先复用 SQLite 自身事务、WAL 与已有连接，不先引入 lock file。对不可逆的数据库 schema 或业务语义不做扩展。

## 代码落点

待实施后填写具体 symbol、错误类型、默认边界和测试 fixture；预期只涉及 SQLite 初始化模块、SqliteStore 装配、进程 fixture/回归测试和本页证据。

## 测试与验证

### 完成审核证据

- **清单与候选**：待 C1–C7；发布前保留 T0/T1/T2 证据，最终 T2 hash 不写入本页。
- **逐项判定**：待 Loop 验收与独立 Standards/Spec review；C6.5–C6.7 及最终 C6 = PASS 留给 GitHub 完成评论。
- **验收与 TDD**：本页“验收与 Eval 标准”固定 AC1–AC6；待补 RED/GREEN 运行结果。
- **本地门禁**：待最终候选执行并记录。
- **双轴 review**：待相互隔离 reviewer。
- **修复与回归**：待记录每轮 Loop 修复与回归范围。
- **知识维护**：初始新增本页；最终按实际修改判断 Wiki 索引、handoff、schema、ADR 是否需要同步，不能把结构调整当成新领域架构决策。
- **发布前裁决**：待独立 reviewer 对 T1 的 attestation。

## 边界与非目标

不迁移旧内存实例，不改变数据库 schema，不增加跨进程锁文件，不做 SQLite 实验记录账本，不承诺真实模型质量，不把 CI 重跑成功当作并发修复证据。不处理运行期所有数据库写入的通用重试；本票只覆盖首次打开/迁移/WAL 初始化接缝。

## 上下文演进

待 Loop 收敛后按“触发证据—原假设—决定—影响—上下文处理”记录。

## 交接结论

本票尚未交付。后续 Agent 必须先按本页 AC/Eval 实施和复验，再按完成审核清单发布；在 PR、CI、main 远端回读和 issue 完成评论完成前，不得关闭 #46 或宣称第二期可靠性已完成。
