---
wiki_id: "009"
ticket: 9
ticket_state: done
context_state: mixed
summary: "WorkStore接入SQLite，保留全部版本、事务条件写入与真实进程重启恢复。"
topics: ["sqlite", "persistence", "transactions", "restart-recovery"]
code_paths: ["apps/server/src/store/**", "apps/server/src/start.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts"]
symbols: ["WorkStore", "SqliteStore", "AppendOptions", "StoreContractError"]
inherits: ["019", "006", "002"]
changed_by: ["033", "007"]
read_when: ["implement-storage-adapter", "recover-persisted-work", "change-database-schema"]
last_context_reviewed: "2026-09-30"
---

# 009 — SQLite 持久化

## Agent Context

- **读取时机**：更改磁盘存储、迁移或重启恢复。
- **原始目的**：[#9](https://github.com/12bitsD/agent4novel/issues/9) 将内存存储替换成 SQLite，作品重启不丢。
- **实际落地**：生产装配使用SQLite；保存全部产物版本、状态和输入依据，正常退出及强制终止后的CLI多章恢复已验证；[PR36](https://github.com/12bitsD/agent4novel/pull/36)已合并、#9已关闭，终止状态见[完成评论](https://github.com/12bitsD/agent4novel/issues/9#issuecomment-5897744738)。
- **当前价值**：继承 #19 共享验证和 #6 多章/CAS/输入引用；短事务提交，模型调用在事务外。
- **后续变化**：[Wiki033](./033-local-docker-ci.md)已验证容器与整个数据目录卷；[Wiki007](./007-author-agent-config.md)将严格v1事务迁移v2，新增配置版本/文件元数据，文本仍在文件中。本票原v1设计和审核保留为历史，当前形状见schema。
- **代码入口**：WorkStore、SQLite适配器、生产装配、旧路由/流水线的复合写入。

## 设计目的

作者保存或通过的作品、全部产物版本和输入依据持久化到本机。服务终止后重新打开同一数据库能继续创作，不自动续跑模型或重复示例。WHAT/AC 以票面为准。

## 起始上下文

- 固定点 `09b01226bc7a1ec406e646cab1b163a99bdbcca7`，#19 已合并关闭；起始工作区 clean。
- 最终审核固定点刷新为 `3612423400599d86cd7b102ddfc992f1fb146b27`：远端新增README排版、截图与读者边界；先保存本票工作区，安全快进后恢复，仅协调README事实差异，保留远端新布局和规范。无中间本地提交；新清单已完整重读，门禁重新执行。
- `codex/9-sqlite-persistence` → PR → main；用户授权逐票loop交付，部署范围为本机Docker+CI。
- #9 OPEN，ready-for-agent，2026-09-30 claim给12bitsD；原Project为 agent4novel Development / Backlog，完成保持原字段与标签，规则未要求改为Done。native依赖#2 CLOSED，保留关系。
- main无分支保护/rulesets，当前无CI，required checks/reviews为空；发布前再次回读。
- 已读 #19/#6 当前边界、#2存储seam、schema和ADR0002。真实旧内存作品不自动迁移、不停止原实例。

## 技术方案

三案结论继承 [MVP全部对齐点](../research/mvp-delivery-options.md)：作品行＋按版本产物行，content/inputs JSON；拒绝整书JSON覆盖的粗写入和按六kind过早拆表。依赖预检和SQLite机制证据见 [SQLite预检](../research/sqlite-preflight.md)。

本票原子写入gap三案：①向业务暴露transaction callback，改动面大且泄漏适配器事务；②在现有append/setStatus传最终状态和前置条件，能覆盖Caption/Creative复合操作，接口最窄；③引入通用声明式批量commit，扩展性好但当前无跨作品批量需求。选择②，所有校验与写入同事务；禁止把approved选项用于Setting/Beat/Prose绕开专用完成命令。

- `SqliteStore(path)` 实现同WorkStore；close由装配层处理。迁移user_version，事务内复核版本、拒绝未来/未知库，不清库；WAL、FULL、有界busy timeout。
- `AppendOptions.humanStatus?` 默认pending，现有允许setStatus的kind可原子追加approved；`setStatus`可携带preconditions。两适配器行为一致，生产调用绑定实际读取的目标/上游。
- per-work与per-chapter使用独立partial unique index，避免NULL唯一约束空洞；kind/chapter、version、JSON和外键守结构，内容仍由共享Zod校验。
- 默认数据目录根下 `.data`（支持 `A4N_DATA_DIR`），数据库名 `agent4novel.sqlite`；受Git忽略。`A4N_SEED_DEMO=1`仅在空书架显式初始化示例；再次启动不追加；无数据恢复失败时退回内存的旁路。
- 原服务端口默认8787；测试用独立随机loopback端口。生产启动错误不打印作品/凭据，退出不触发LLM。

### 实现前TDD与提交计划

1. Store持久化：可打开/关闭的最小壳先得到“重新连接作品丢失”RED；实现迁移、读写和公共Store行为套件双适配器GREEN。补损坏/未来库、零写入、完整版本/状态/输入引用、隔离快照。
2. 原子写入：复合append/approve与路由外CAS的真实行为RED；最小扩展选项，调用方传preconditions；补两连接/独立进程竞争、校验失败回滚和强制终止恢复。
3. 生产装配与重启：默认持久化/显式幂等seed RED；真实生产装配在独立进程跑两章与历史编辑，终止/重启严格比较作品、版本行、pending和衔接提示。测试不读开发者凭据，fake步骤无网络。
4. schema/README双语/运行skill/handoff/Wiki更新；针对最终候选执行全仓门禁、三轮自校准、独立双轴和有限证据收口，再按授权交付。

逻辑提交为本票完整能力；依赖/适配器/调用方和文档一起进入一致候选，切片保留RED/GREEN日志。root负责调用方、真实进程联验和本页；Store、runtime、知识维护分别由既有实现Agent按文件边界完成。最终候选交给未参与实现的双轴reviewer。

### 数据目录、备份与恢复

默认目录是仓库根下 `.data`；`A4N_DATA_DIR`可设绝对目录，相对目录仍相对仓库根解析。数据库为 `agent4novel.sqlite`，新建目录/数据库权限分别为0700/0600。运行期WAL属于同一份数据；不要仅复制正在写入的主文件。

备份步骤：停止所有访问同一数据目录的进程，向服务实例发送SIGTERM或SIGINT并等待退出，再复制整个数据目录到另一位置。关闭最多等待5秒，不会自动继续未完成的模型请求。恢复步骤：确认服务停止，先保留当前目录的完整备份，再将选定备份恢复到目标目录，以该目录配置 `A4N_DATA_DIR` 后启动；核对书架、正文与待通过状态。不得把恢复理解成清空旧库重建；不支持的版本、未知非空库或损坏库会安全拒绝。

生产默认空书架。仅需演示时设 `A4N_SEED_DEMO=1`，由一次 `createWorksIfEmpty` 事务初始化三例；已有作品时不追加。初始化三案为逐条创建（可能半份）、运行层SQL（泄漏存储边界）、适配器窄事务接口（所选）。它不扩展通用WorkStore，也不影响普通创作。

原内存实例及端口未停止，也不自动迁移；其作品仍只存在该进程。若后续需要切换，先保全重要作品，再另行制定导入方式。本票的恢复证据全部来自独立临时目录与端口，不代表旧内存作品已经落盘。

## 代码落点

- `store/sqlite-store.ts`：事务读快照、版本写入、目标/上游CAS、专用完成命令与原子空库初始化；`sqlite-schema.ts`：严格v1结构、迁移和两个partial unique index。
- `store/invariants.ts`：两适配器共享章节地址与专用通过限制；`work-store.ts`：append最终状态和setStatus前置条件。
- `pipeline/pipeline.ts`、`routes/works.ts`：Caption/Creative以一次条件写入提交最终状态；Creative/Outline编辑和通用通过绑定实际读到的head。
- `config/server-config.ts`、`runtime/storage.ts`、`runtime/production-app.ts`、`runtime/shutdown.ts`、`start.ts`：持久化装配、数据目录/端口、显式示例、安全启动和有界关闭。生产入口仍为index→start。
- `test/store.test.ts`、`sqlite-store.test.ts`、`sqlite-restart.test.ts`：双适配器语义、SQL约束/竞争/恢复、可执行CLI驱动真实生产进程。持久化不引入任务队列或第二个工作流状态机。

## 测试与验证

票面AC分别对应：WorkStore实现→SQLite类及双适配器套件；建表/迁移→v1迁移及schema结构约束测试；版本/status→保存追加版本与同版完成测试；重启→真实生产进程CLI联验；共享读写→参数化Store套件。补充验收覆盖冲突零写入、输入引用、显式幂等seed和安全拒绝损坏数据。预检仅证明本机native模块与SQLite机制，不算项目AC通过。项目证据目录 `/tmp/a4n-9-evidence/`。

真实联验 `test/sqlite-restart.test.ts` 创建两章已通过正文，修改旧章后创建第三章待通过草稿；按SIGTERM与SIGKILL各重启一次，严格比较完整WorkView、书架与全部产物行。启动后遥测为空，重放已有第三章请求不会新增结果或调用模型。使用fake步骤、无供应商凭据、随机loopback端口；2026-09-30 `production-restart.log` PASS。

TDD证据：`store-options-red.log`→GREEN覆盖原子状态/保护种类；`store-reconnect-red.log`的重连和未知库断言为有效RED（尚无表造成的损坏内容夹具失败不计）；`atomic-callers-red.log`5项真实失败→48项GREEN；runtime配置/关闭/存储各自RED→21项GREEN；对象过滤gap另见变化事件。Store最终112项覆盖同套件双适配器、独立进程CAS/迁移/seed、已提交强杀恢复与未提交回滚、SQL失败初始化整批回滚、非默认config重连。现行测试代码是持久可复验入口，临时日志不替代它。

三轮自校准（知识回写后）：①代码↔行为：生产使用同WorkStore，短事务与LLM分离，完整版本/状态/inputs及两类强杀结果核对；发现并修复未知对象过滤；②代码↔知识：schema/运行HOW与实际v1/装配一致，无新领域词，两语README采用新main读者边界，旧票审核证据保持逐字节不变；③候选↔票面：5条原AC和追加验收均有执行入口，旧内存迁移、后台续跑、历史UI、配置/坏例/容器能力仍为非目标。

### 完成审核证据

- **清单与候选**：清单blob `42116082e8ca2804d826cc00f6578270077f60eb`；最终固定点 `3612423400599d86cd7b102ddfc992f1fb146b27`；双轴候选T0 `b2fdcbacaf56263b941ea0170e69607f1902f4a8`；pre-attestation T1 `217fa28c477da0cadd44d807d0a6d722de31d212`；精确47文件见 `/tmp/a4n-9-evidence/manifest.txt`，源码/测试/配置/锁文件/双语文档均在候选。无中间本地提交，完整patch与安全扫描见 `candidate.patch`、`history-audit.json`；无unstaged/untracked或新增symlink。
- **逐项判定**：C1 = PASS（C1.1–C1.8，票面、claim、Project/依赖回读、研究D01–D20、本页事前计划和新基线）；C2 = PASS（C2.1–C2.5，以上真实RED/GREEN、共享接缝及AC映射；C2.6 N/A：已有行为TDD）。C3 = PASS（C3.1–C3.6，本地门禁/安全与质量核对；无独立formatter/linter脚本，typecheck与完整diff检查覆盖现有静态门禁）。C4 = PASS（C4.1–C4.9，知识维护、链接/结构/两语事实和三轮自校准；新ADR/CONTEXT的N/A见知识维护）。C5 = PASS（C5.1–C5.7，精确manifest/tree、两次diffcheck、完整历史审计和相隔离双轴原始报告；无阻塞发现，候选实质未变）。C6.1 N/A（review未暴露行为缺陷；事前自校准对象识别gap已RED/GREEN修复）；C6.2 PASS，冻结前新基线最终门禁及review独立复跑；C6.3 PASS，仅受控字段忠实转录；C6.4 PASS，独立reviewer `attestation.md` 精确比较T0→T1及完整候选、历史、工作区和证据来源。C7.3预期N/A（当前workflows=0，无required checks/reviews；发布时回读，不能用本地门禁代替CI）。
- **验收与 TDD**：issue #9；五条AC和追加验收如本节，Store/runtime/调用方/真实生产联验入口及日志。Fake仅验证工程能力，不代表真实模型创作质量。
- **本地门禁**：2026-09-30定向Store112/runtime21/调用方48/生产进程1 PASS，typecheck PASS；新main基线下 `pnpm test` contracts100/server344/CLI166/Web120共730项PASS，`pnpm typecheck`、`pnpm build` exit0；证据 `final-test.log`、`final-typecheck.log`、`final-build.log`。保留原有Web导入docx大于500kB提示和测试中AI SDK不支持参数提示，均不阻塞；没有真实LLM联网。`dependency-install-frozen.log`：frozen安装exit0；新依赖固定版本，allowBuilds仅esbuild允许，better-sqlite3使用随包预构建。`safety-check.json`与Git ignore检查PASS，无secret/临时数据/用户文件纳入。C3.5复用共享invariants/校验、SQL内部短方法、迁移独立边界与版本索引；单本MVP列表从一致快照派生，无新任务队列或票外抽象。
- **双轴 review**：相隔离且未参与实现的 `/root/sqlite_standards_review`、`/root/sqlite_spec_review` 对T0均PASS，原始报告 `standards-review.md`、`spec-review.md`。Standards独立重跑SQLite/进程/安全启动/关闭21项，Spec独立复跑server344项；全部PASS。未发现需接受修复或拒绝的发现；Linux容器、CI和真实模型质量不在本次裁决内。
- **修复与回归**：review无新增缺陷。事前对象过滤修复、原子调用方RED/GREEN及main刷新后的最终门禁已保留；不计缺表夹具为RED，不复用旧基线门禁。剩余风险：无旧内存迁移/自动LLM恢复/遥测持久化，未来结构需显式迁移；本机darwin-arm64证明不能替代后续Linux容器验收。
- **知识维护**：Wiki009/索引、旧002/006/013/019/022、schema、contract-governance、双语README/流程图、handoff、drive skill已更新。research新增SQLite预检并让交付状态路由到issue；原研究与Human决定preserve。C4.3 CONTEXT N/A（无新术语）；C4.4新增ADR N/A（沿用ADR0002，票内可逆v1实现，无新跨票架构裁决）；README.zh-CN导航不受影响。旧完成审核块字节保留及本地链接/schema/SVG检查见 `docs-validation-refresh.json`（224链接/锚点、5旧Wiki、两语事实、SVG和新main布局保留）、`docs-root-check.json`（含本页）；review后不再改知识事实。
- **发布前裁决**：未参与实现的 `/root/sqlite_standards_review` 对T1 C6.4 attestation为PASS（2026-09-30，`attestation.md`、`attestation-integrity.json`）：T0→T1仅预留证据字段变化，转录忠实；完整47文件、清单blob、AC/TDD/门禁/双轴结论、历史和工作区均核对。剩余风险同上；这不是整节C6或C7完成声明，C6.5–C6.7及远端终止性结果留给GitHub完成评论。

## 边界与非目标

不迁移旧内存实例、不新增历史版本UI、自动模型续跑、持久化诊断账本、材料实体、WorkWiki或配置UI。Prompt/Skill仍为文件，数据库不存另一份正文。SQLite文件与WAL属于同一数据目录，备份不能在写入时只拷贝主文件。Linux/容器原生依赖验证归#33，不用macOS实验代替。

## 上下文演进

### 2026-09-30 — 容器继承整个数据目录

- **触发证据**：#9交付后用户选择本机Docker+CI，#33接入生产发布物和命名卷。
- **原假设**：源码运行是唯一已验证的生产装配。
- **决定**：#33沿同一SqliteStore/v1策略提供独立容器书架；源码备份仍沿本页，卷操作转[Wiki033](./033-local-docker-ci.md#维护操作)。
- **影响**：数据目录与模型操作不自动恢复的规则继续有效；Linux镜像与CI证据由新票独立取得。
- **上下文处理**：preserve旧完成审核区字节与存储设计理由，补充新的运行方式入口。

### 2026-09-30 — 修复未知库对象识别

- **触发证据**：最终自校准发现SQL `LIKE 'sqlite_%'` 中下划线会匹配任意字符，用户表 `sqliteXsentinel` 被误当内部表。
- **原假设**：该过滤仅忽略SQLite内部对象。
- **决定**：先由未知表拒绝断言复现RED，再改为下划线按字面匹配的 `GLOB 'sqlite_*'`。
- **影响**：未知非空库不会被误初始化；重新运行Store和完整门禁。
- **上下文处理**：preserve原安全拒绝目的和失败证据，replace对象过滤机制；有效RED为 `store-schema-name-red.log`，GREEN为对应日志。

### 2026-09-30 — 持久化前先收口原子写入接缝

- **触发证据**：预检发现Caption与Creative使用append→setStatus两次调用，Creative/Outline版本比较在路由外。
- **原假设**：逐方法事务可直接替换内存实现并保证用户动作原子。
- **决定**：最小扩展已有Store选项，将最终状态和实际前置条件放入一次事务。
- **影响**：两适配器与生产调用方同时更新，保留原始版本/关卡语义，增加跨连接和进程证据。
- **上下文处理**：preserve #19/#6内容与并发规则；新增SQL实现及其差异，不重写旧审核证据。

### 2026-09-30 — 作者配置接入版本文件

- **触发证据**：#7 的生产配置、文件校验、操作快照和整目录恢复测试。
- **原假设**：原票交付时只有旧Work.config/数据库和运行期配置。
- **决定**：当前作者配置与受管文件见[Wiki007](./007-author-agent-config.md)，provider HOW仍由016持有，部署HOW仍由033持有。
- **影响**：严格SQLitev1迁移v2，备份含prompts目录；保存只影响下次操作，不改旧产物。
- **上下文处理**：preserve原始目的、历史失败和完成审核证据；replace顶部当前路由事实。

## 交接结论

持久化与真实进程重启已交付，终止记录见#9完成评论。#33继承整个数据目录与v1策略，容器/CI证据从其Wiki进入；#7继续配置与文件引用。不要用macOS原生模块或本地测试代替Linux容器与GitHub CI，也不要提前宣称MVP完成。
