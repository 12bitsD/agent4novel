---
wiki_id: "068"
ticket: 68
ticket_state: active
context_state: current
summary: "SQLite v5 作品索引与书架批量读取，消除结构性读放大并保留损坏数据和 CAS 语义"
topics: ["sqlite", "performance", "schema-migration", "query-plan", "reliability"]
code_paths: ["apps/server/src/store/sqlite-schema.ts", "apps/server/src/store/sqlite-store.ts", "apps/server/test/sqlite-store.test.ts", "apps/server/test/sqlite-initialization.test.ts"]
symbols: ["SqliteStore", "listWorks", "artifact_work_head", "agent_file_work"]
inherits: ["009", "046", "019"]
changed_by: []
read_when: ["change-sqlite-indexes", "optimize-work-list", "migrate-sqlite-v5"]
last_context_reviewed: "2026-11-13"
---

# 068 — SQLite 索引与书架读放大

## Agent Context

- **读取时机**：修改作品/Artifact 查询、SQLite schema、书架列表或迁移时。
- **原始目的**：#67 的后端性能与稳定性治理要求消除 `listWorks()` 的 N+1 和作品查询缺少索引的问题，不能牺牲既有持久化保障。
- **实际落地**：计划新增 v5 普通作品索引，并在一次读事务中批量构造书架摘要。
- **当前价值**：保留部分唯一索引、全部 head 的损坏数据校验、作品顺序、UTF-16 seedPreview、approved 正文章数及事务 CAS。
- **后续变化**：#70 在同一 SQLite 实现之后处理 Setting extension 完整性。
- **代码入口**：`sqlite-schema.ts` 的迁移清单；`sqlite-store.ts` 的 `readDetail()` / `listWorks()`。

## 设计目的

让单作品读取成本不再显式依赖全表扫描，让书架 SQL 次数不再随作品数线性增长；性能验收使用查询计划和语句计数，不承诺未测量的墙钟提升。

## 起始上下文

固定点为 `c060be489c21d6646fff1b59615a8eb71d8951b2`。旧 `listWorks()` 先读作品 ID，再逐作品读取 work 和全部 heads，形成 `1 + 2N` 查询并重复解析 JSON/Zod。现有两个 Artifact 部分唯一索引必须继续负责版本唯一性。Wiki 009 定义 v4 与恢复边界，Wiki 046 定义并发初始化边界。

2026-11-13 固定点基线：`pnpm test && pnpm typecheck && pnpm build && node scripts/production-smoke.mjs && node scripts/container-smoke.mjs` 全部通过；容器 smoke 覆盖同源 Web/API、无密钥两章 CLI、配置/文件、坏例、历史/关卡以及停止后的整目录备份恢复。

## 技术方案

新增普通 `artifacts(work_id, kind, chapter, version)` 与 `agent_files(work_id)` 索引，严格迁移到 v5。`listWorks()` 在一个 deferred 事务内批量读取 works 和所有当前 heads，按 workId 分组并复用现有 row/schema 解码，保留任一损坏 head 使列表失败的行为。

## 代码落点

- `apps/server/src/store/sqlite-schema.ts`：v5 定义、空库初始化、v1–v4 增量迁移和严格结构校验。
- `apps/server/src/store/sqlite-store.ts`：批量书架读取。
- `apps/server/test/sqlite-store.test.ts`、`sqlite-initialization.test.ts`：查询计划、语句计数、迁移和损坏数据回归。

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `c060be489c21d6646fff1b59615a8eb71d8951b2`；实现提交 `e301d79`；T0/T1 待最终统一收口。
- **逐项判定**：C1/C2 PASS：计划、票据、固定点与 RED/GREEN 完整；C3/C4 定向证据已取得；C5 三轴审查发现已修复并复审关闭；C6 待最终统一 attestation。
- **验收与 TDD**：issue #68；旧实现书架 SQL 5 次（两作品）且缺索引，目标测试先 RED；实现后恒为 2 次，生产两条 Artifact 查询均使用完整 covering index，v1–v4 原始多版本行不变，孤儿与合法作品行为保持。
- **本地门禁**：固定点完整基线通过；候选相关 10 个测试文件 208 项及 server typecheck 通过；最终全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、production smoke、container smoke 与 `git diff --check <fixed-point>` 均通过；容器完成同源 Web/API、无密钥两章、配置/文件、坏例、历史/关卡和停止后的整目录备份恢复。
- **双轴 review**：Standards/Spec/Risk 已关闭重复 head 校验丢失、孤儿范围扩大、弱查询计划与迁移历史盲区，增量复审无剩余代码发现。
- **修复与回归**：共享 currentArtifactHead/schemaVersions，恢复 workDetailSchema，强化原始行与真实 SQL 断言。
- **知识维护**：本页与 Wiki index 新建；`docs/schema.md` 已更新 v5、索引与批量书架语义；CONTEXT/ADR/research/README/运行 skill N/A（无对应变化）；handoff 待统一更新。
- **发布前裁决**：pending；默认仅本地分支，不 push/远端 merge/关闭 issue。

## 边界与非目标

不分页、不删除历史、不改变公开 WorkView/WorkSummary、Store 接口、CAS、事务或损坏数据语义；不将 better-sqlite3 改成 worker，不引入跨请求缓存。

## 上下文演进

### 2026-11-13 — 建立性能治理票据

- **触发证据**：静态代码复核确认 `listWorks()` 为 `1 + 2N` 查询，作品读取与配置文件列举缺少对应普通索引。
- **原假设**：本地单用户下逐作品读取足够简单，但作品与历史版本增长会放大所有书架访问。
- **决定**：以 v5 索引和批量读取做最小治理，保留全部现有正确性边界。
- **影响**：SQLite schema 与书架读路径；不影响公开协议和写入语义。
- **上下文处理**：preserve Wiki 009/046 的持久化与初始化约束，本页只记录新增性能治理。

## 交接结论

候选实施后，下一位 Agent 应能从测试确认 v5 查询计划、常量查询次数和 v1–v4 数据不变；未完成候选门禁和独立 review 前不得视为已交付。
