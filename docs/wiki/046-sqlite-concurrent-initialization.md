---
wiki_id: "046"
ticket: 46
ticket_state: active
context_state: current
summary: "首次并发打开 SQLite 空库时，对可重试锁竞争做有界初始化重试并保留安全诊断"
topics: ["sqlite", "concurrency", "initialization", "reliability"]
code_paths: ["apps/server/src/store/sqlite-store.ts", "apps/server/src/store/sqlite-schema.ts", "apps/server/test/sqlite-process.test.ts"]
symbols: ["SqliteStore", "initializeSqliteDatabase", "SqliteInitializationError", "initializeSqliteSchema", "createWorksIfEmpty"]
inherits: ["009"]
changed_by: []
read_when: ["fix-sqlite-initialization", "diagnose-database-lock", "change-storage-concurrency"]
last_context_reviewed: "2026-10-10"
---

# 046 — SQLite 并发首次建库

## Agent Context

- **读取时机**：修改 SQLite 首次打开、迁移、WAL 设置、空书架 seed 或多进程存储竞争时，先读本页和 [Wiki009](./009-sqlite-persistence.md)。
- **原始目的**：两个进程同时首次打开空数据库时，偶发一个进程收到 `unexpected-error`，而另一个进程完成 seed；已知解释是初始化/WAL 阶段的 SQLite 锁竞争。
- **实际落地**：`SqliteStore` 首次打开将外键、schema/migration、WAL 和 `synchronous=FULL` 放入同一个有界初始化重试封装；只重试显式 `SQLITE_BUSY*`，并通过安全诊断暴露阶段、错误码、attempts 和 retryable。未知 schema、损坏库、迁移错误、CAS 和终止恢复语义保持不变。
- **当前价值**：#51 的节点实验目录与作品 SQLite 数据库保持分离；本票只修复作品数据库初始化可靠性，不建立实验记录平台。
- **后续变化**：暂无。
- **代码入口**：`SqliteStore` 构造函数、`initializeSqliteDatabase`、`initializeSqliteSchema`、`createWorksIfEmpty`、`test/sqlite-initialization.test.ts` 和 `test/sqlite-process.test.ts`。

## 设计目的

让两个独立进程首次打开同一空数据库时都能完成初始化，且只由一个进程执行空书架 seed。锁竞争需要等待，但等待必须有界；不可重试错误必须继续失败，并提供不泄露路径、数据库内容或凭据的阶段与 SQLite 错误码诊断。

## 起始上下文

- 票面为 [GitHub #46](https://github.com/12bitsD/agent4novel/issues/46)，属于第二期基础可靠性，排在 #51 之后。
- 起始构造顺序是：创建文件、打开连接（`timeout: 5000`）、外键、事务迁移、WAL、`synchronous=FULL`。原构造函数将异常压缩为普通 Error，进程 worker 因而只能看到 `unexpected-error`。
- `initializeSqliteSchema` 在事务内重新读取 `user_version` 和对象，已有有效库重开、迁移、CAS 写入、seed 原子性和强杀恢复属于必须保留的行为。
- 现有 `sqlite-process.test.ts` 有双进程首次 seed 回归，但竞争结果受调度影响；本票新增真实 WAL 锁持有/释放、独立进程失败诊断和迁移失败用例，不能用重复跑偶发测试替代。

## 验收与 Eval 标准

以下是实施 Agent 开始前固定的验收标准。验收以代码/测试结果为准，不允许实施 Agent 自行降低范围或把偶发通过当作并发修复。

- **AC1 并发首次打开**：两个独立进程共享全新数据库并同时执行初始化与 seed，两个进程均成功返回；最终作品恰好两条；seed 结果恰好一次 `true`、一次 `false`；不得出现 `unexpected-error`。
- **AC2 锁竞争重试边界**：初始化只重试显式允许的 SQLite busy 错误族；重试次数或总等待时间固定有界；释放锁后能继续完成；永不无限循环。
- **AC3 不吞真实错误**：未知 schema、未来版本、损坏文件、迁移 SQL 失败、`SQLITE_LOCKED` 或其他非允许错误不被重试改写为成功；原有安全失败语义保持。
- **AC4 数据与旧语义**：已有库重开、v1/v2 迁移、CAS 保存、seed 原子回滚、已提交写入恢复、未提交事务强杀回滚的现有测试继续通过；不重复 seed、不产生半份作品。
- **AC5 安全诊断**：失败诊断至少能区分初始化阶段、允许的 SQLite 错误码（无 SQLite code 时为 `null`）、诊断类别和已尝试次数；不得包含数据库完整路径、作品正文、seed、配置凭据或完整数据库内容；外部启动错误仍不回显敏感值。
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

- 保持 `SqliteStore(path)`、`initializeSqliteSchema(db)` 和 `WorkStore` 业务接口兼容；新增的 `initializeSqliteDatabase` 与诊断类型只属于存储初始化内部接缝。
- 把外键、schema 迁移、WAL、`synchronous=FULL` 视为同一初始化阶段的重试边界；一次尝试失败后必须让事务/连接回到可重试状态。
- 允许的错误码使用明确的 SQLite `SQLITE_BUSY` 家族判定；不以任意错误 message 模糊匹配，不把 `SQLITE_LOCKED` 当成可重试竞争。
- 诊断字段使用阶段、sqlite code（缺失时 `null`）、诊断类别、attempts、retryable 等安全元数据；保留原有对用户的通用错误文案，不打印路径和内容。`UnsupportedDatabaseError` 也携带安全结构化字段，避免 worker 把未知 schema 降级为 `unexpected-error`。
- 优先复用 SQLite 自身事务、WAL 与已有连接，不先引入 lock file。对不可逆的数据库 schema 或业务语义不做扩展。

## 代码落点

- `apps/server/src/store/sqlite-schema.ts`：`initializeSqliteDatabase` 固定默认 `busy_timeout=100ms`、最多8次、每次间隔10ms；只 allowlist `SQLITE_BUSY`、`SQLITE_BUSY_RECOVERY`、`SQLITE_BUSY_SNAPSHOT`、`SQLITE_BUSY_TIMEOUT`；结束时恢复调用者原有 busy timeout。`SqliteInitializationError` 和 `UnsupportedDatabaseError` 只携带安全诊断字段。
- `apps/server/src/store/sqlite-store.ts`：构造函数使用初始化封装；成功后恢复运行期 `busy_timeout=5000`，打开阶段异常统一为不含路径的安全错误。
- `apps/server/test/sqlite-initialization.test.ts`：真实 WAL busy、busy 耗尽、`SQLITE_LOCKED`、迁移 `SQLITE_ERROR`、未知 schema、WAL/synchronous 最终状态和 timeout 恢复。
- `apps/server/test/fixtures/sqlite-worker.ts`、`apps/server/test/sqlite-process.test.ts`：独立进程 seed/CAS/强杀回归和安全初始化诊断回传；worker 只序列化安全元数据。

## 测试与验证

### Loop 与 TDD 证据

- **R0 RED**：在 fixed point `7a19b4378f9d8bb1ba22cc5ffba36c4b9184c037` 上，新增的可控初始化 Eval 首先因 `initializeSqliteDatabase`/`SqliteInitializationError` 不存在而失败；原有双进程测试连续20次通过只记录为“未重现偶发竞争”，不冒充修复证据。
- **R1 实现**：新增初始化封装，真实 WAL `SQLITE_BUSY` 释放后重试并完成 schema/WAL/synchronous；定向初始化/process/store/restart tests 通过。
- **R2 自验**：实施 Agent 发现 worker 仍把结构化错误降级为 `unexpected-error`，且直接调用初始化函数会留下短 busy timeout；补充安全 worker 诊断、独立进程测试和 timeout 恢复测试。
- **R3 主 Agent 复验修复**：独立 Standards review 发现 unknown/future schema 仍没有结构化诊断；补充 `UnsupportedDatabaseError` 的安全字段、open 阶段错误包装和独立进程 unknown-schema 回归。Spec review 未发现范围扩张。
- **当前结果**：定向五组 SQLite 测试 `5 files / 102 tests passed`；独立 process 回归另重复10次，每次5 tests通过；server typecheck/build 和 `git diff --check` 通过。根目录全量门禁待最终候选收口后记录。

### 完成审核证据

- **清单与候选**：固定点为 `7a19b4378f9d8bb1ba22cc5ffba36c4b9184c037`；候选分支 `codex/sqlite-init-loop`。C1–C4 的 issue、Wiki、handoff、索引和范围证据已建立；最终 T2 hash 不写入本页。
- **逐项判定**：C1–C4 待最终候选逐项记录；C5 双轴 review 已发现的 AC5 问题已在 R3 修复，需对最终文档/代码候选重新审查；C6.5–C6.7 及最终 C6 = PASS 留给 GitHub 完成评论。
- **验收与 TDD**：AC1–AC6 已有实际代码入口；可控 busy 是第二个 SQLite connection 的真实锁竞争，独立 worker 回归 seed、CAS、unknown schema 与强杀恢复。
- **本地门禁**：定向门禁如上；`pnpm test`、`pnpm typecheck`、`pnpm build`、secret/links/完整历史审计将在冻结候选后执行并填入。
- **双轴 review**：首轮 Standards review 曾因 AC5 阻塞，Spec review PASS；R3 后必须重新取得相互隔离的 Standards/Spec PASS。
- **修复与回归**：R2 修复 worker/timeout，R3 修复非 busy 初始化诊断；每次修复均重跑 SQLite 定向测试和 server typecheck。
- **知识维护**：新增本页、Wiki 索引和 handoff；未改 `docs/schema.md`（不改变数据库 schema），未新增 ADR（沿用 Wiki009/ADR0002 的存储边界），未新增 README/运行 skill 能力说明。
- **发布前裁决**：待独立 reviewer 对最终 T1 的 attestation；未执行真实 Provider 质量验证。

## 边界与非目标

不迁移旧内存实例，不改变数据库 schema，不增加跨进程锁文件，不做 SQLite 实验记录账本，不承诺真实模型质量，不把 CI 重跑成功当作并发修复证据。不处理运行期所有数据库写入的通用重试；本票只覆盖首次打开/迁移/WAL 初始化接缝。

## 上下文演进

### 2026-10-10 — 从偶发并发失败改为初始化接缝重试

- **触发证据**：#35 main CI 首轮曾在两个进程首次建库时出现一个 `unexpected-error`；后续重跑通过，不能证明竞争已消失。可控锁探针确认 WAL 阶段会返回 `SQLITE_BUSY`。
- **原假设**：连接级5秒 busy timeout 足以覆盖首次 schema/WAL 竞争。
- **决定**：把外键、schema/migration、WAL、FULL synchronous 作为一次初始化操作，以短单次 timeout + 固定次数重试处理 `SQLITE_BUSY*`；不把 `SQLITE_LOCKED`、未知 schema 或其他错误当成竞争。
- **影响**：两进程首次打开/seed 只执行一次，运行期 busy timeout 仍恢复为5000ms；WorkStore、数据库 schema、seed 原子事务和恢复语义不变。
- **上下文处理**：`preserve` Wiki009 的事务、WAL、恢复和安全拒绝边界；`replace` 原构造阶段只返回 `unexpected-error` 的诊断限制。

## 交接结论

实现 Loop 已完成到 R3，候选尚未发布。后续必须按完成审核清单重新冻结候选、取得双轴 review、完成 PR/CI/main 远端回读，并在 GitHub 完成评论后关闭 #46；在此之前不得宣称第二期可靠性或整个第二期完成。
