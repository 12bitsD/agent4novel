---
wiki_id: "017"
ticket: 17
ticket_state: active
context_state: current
summary: "通过后设定的 append-only 扩展提案、原子审批与未来章节消费"
topics: ["setting-extension", "append-only", "cas", "sqlite-migration", "harness"]
code_paths: ["packages/contracts/src/setting-extension.ts", "apps/server/src/setting-extension.ts", "apps/server/src/store/work-store.ts", "apps/server/src/store/in-memory-store.ts", "apps/server/src/store/sqlite-store.ts", "apps/server/src/routes/setting-extensions.ts"]
symbols: ["SettingExtensionResource", "SettingExtensionReceipt", "proposeSettingExtension", "approveSettingExtension", "setting_extension_proposals"]
inherits: ["013", "018", "019", "021"]
changed_by: []
read_when: ["implement-setting-extension", "trace-setting-evolution", "debug-setting-extension", "verify-setting-input-refs"]
last_context_reviewed: "2026-10-11"
---

# 017 — 设定演进

## Agent Context

- **读取时机**：实现、调试或复核通过后新增设定扩展，或核对历史／未来章节的 Setting 输入引用时。
- **原始目的**：允许作者在已有 approved Setting 后追加一组新的补充设定，同时保留既有事实、历史章节和可回读操作证据。
- **实际落地**：第一轮实现新增严格 propose、approve、cancel、GET 资源；proposal 是独立操作资源。InMemory 与 SQLite 共用领域规划逻辑，SQLite 使用 v4 表和事务；action 路由先校验 path UUID，再校验 body requestId 与 path 一致，之后才进入 proposal lookup；未提供既有事实编辑、删除、撤销、回退、自动重写或真实模型调用。
- **当前价值**：受保护 Eval r0.3 是实现边界，SHA-256 为 `1d017caad04a8bbb03a29dfc40be1cb12f00e2abbdf7f8a37f9193ee4e53504e`。外部预检已覆盖内存／SQLite公共 HTTP、第二章 Beat 消费 Setting v2、历史引用、终态重放、413 与 SQLite restart；后续两轮补齐 proposal record 不变量、规范化值、Harness 用户入口和 approved candidate 历史 readback；最终候选仍需主 Agent 独立复验和双轴审核。
- **后续变化**：无。#18 只提供非阻断冲突 review 设计，不被本票升级为冲突检测或自动回退。
- **代码入口**：`packages/contracts/src/setting-extension.ts`、`apps/server/src/setting-extension.ts`、`apps/server/src/routes/setting-extensions.ts`、`apps/server/src/store/work-store.ts`、两个 Store 实现及 `apps/server/test/setting-extension.test.ts`。

## 设计目的

扩展动作只追加一个新的 `extensions` section。approved Setting 的旧总览、固定栏目、旧扩展、顺序和身份保持结构相等。扩展先保存为 `(workId, requestId)` 操作记录，作者显式 approve 后才追加新的 approved Setting Artifact。

## 起始上下文

产品范围由 Human 确认：只做新增设定扩展的设计／最小原型，不支持修改或撤销既有事实。本票 issue 为 [#17](https://github.com/12bitsD/agent4novel/issues/17)。受保护验收见 [`/tmp/a4n-setting-evolution-acceptance-r0.3.md`](file:///tmp/a4n-setting-evolution-acceptance-r0.3.md)，不能修改该文件。#13 的首次 Setting approve 仍走 `approveSetting`；#17 的新接口不接收完整 Setting 内容，也不调用旧首次 approve 路由。

## 技术方案

### 资源与状态

`SettingExtensionDraft` 只含 `title` 与无 ID 的 items。propose request 含 UUID `requestId`、`expectedBase: ArtifactRef` 和 draft；标题、条目标题和内容在原始长度校验后去除首尾空白。服务端生成 section/item IDs，记录带同一 `workId` 的 request、基准、扩展、状态和 candidate ref。Proposal record 读取时校验外层与 request 的 workId/requestId/base 一致性、request.extension 与 record.extension 的规范化内容一致性及 status/candidate 不变量。approved record 还通过共享 readback validator 按 candidate 的精确 id/version 读取历史 Artifact，核对 setting/approved、扩展内容和 stored base input；pending/cancelled 不查 candidate。GET 的 `stale` 是 pending proposal 与当前 Setting head 不同的派生状态；它不写回状态。

动作回执固定包含 `requestId/workId/operation/outcome/writeOutcome/proposal/candidate/errorCode`。操作失败使用公共 error envelope 和固定 extension error code。terminal replay 先校验请求 expectedBase，再返回原 committed receipt；pending proposal 在 approve 时重新检查 Setting CAS 和所有当前 Beat/Prose pending，cancel 可处理 derived-stale proposal。

### 原子性与输入引用

两个 Store 的 propose／approve／cancel 都在写边界内完成。SQLite approve 使用 `BEGIN IMMEDIATE` 的同一事务读取当前 heads、执行 pending guard、追加 approved Setting 和更新 proposal record。事务异常时两项都回滚。新 Setting `inputs` 只引用旧 Setting Artifact；旧 Beat/Prose/正文 Artifact 不被重写。Pipeline 的未来章节输入快照读取新的 Setting head，并保留前章既有输入引用。

### impact 与限制

impact 是读时投影：当前 approved prose 的去重章数、当前 pending Beat/Prose 的去重章数、`continuityWarning = approvedChapterCount > 0`。它不声称检测语义冲突。raw UTF-8 body bytes 超过 Setting body limit 返回 413；合并后 Setting 超过 section、card、field 或 total text 逻辑限制返回 422。没有自动重试，未知传输结果通过 requestId GET 回读。

### 场景边界

新增尚未出场的人物可以作为 append-only extension 提出；作者通过后，它与其他新扩展一样只供未来章节读取。修改已经写入正文的世界规则不是本票能力，不能通过该接口覆盖既有事实或自动重写历史章节；需要回到 Human 决策或后续票据。

## 代码落点

- `packages/contracts/src/setting-extension.ts`：严格 draft、request、resource、receipt、错误码和 SQLite 持久记录 schema。
- `apps/server/src/setting-extension.ts`：ID 生成、append-only 合并、CAS/pending guard、状态优先级、approved candidate readback validator、impact 和资源／回执投影。
- `apps/server/src/store/work-store.ts`：新增四个 Setting extension Store 接口方法。
- `apps/server/src/store/in-memory-store.ts`：同步原子实现及 proposal 隔离 Map。
- `apps/server/src/store/sqlite-schema.ts`：v4 `setting_extension_proposals` 严格迁移，保留 v1–v3。
- `apps/server/src/store/sqlite-store.ts`：事务内 record 读写、重检和 canonical artifact append。
- `apps/server/src/routes/setting-extensions.ts`：Harness HTTP 资源与动作，原始请求字节限制和固定错误映射。

## 测试与验证

第一轮已新增 contracts/server 定向测试，覆盖 strict shape、proposal replay/request conflict、stale/cancel、pending guard（propose 后再次检查）、logical/raw limits、InMemory/SQLite 公共 HTTP、真实 Pipeline 续章输入、历史 refs、SQLite restart/v3→v4 migration 和 SQLite 事务失败回滚。第二轮定向测试增加 proposal record cross-field/status 不变量、SQLite 损坏 record 拒绝、输入 trim 不放宽 raw limit，以及 proposal extension 与 approved candidate extension 相等。第三轮增加 request.extension 与 record.extension 一致性、内存／SQLite 历史 candidate readback，以及 SQLite 缺失／错误 candidate 损坏拒绝。主 Agent 另有受保护外部预检：`/tmp/a4n-setting-extension-main-eval-r1.mts`，hash `4a5c24e03e329ce2ab5f0bc8d5c901b4a3758feb1244a8c7f944df10ba5448fe`，49 checks PASS；该预检不是最终候选审核证据。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `e3cb0bb850952c6a0ba2018bba1e45f977d1f799`；T0 `f5a8418bd20c9d0ff278c2e1860c20ca282eb0a5`。候选只含本票代码、测试、契约／schema、双语 README 与交接文档；未发现未跟踪遗漏。
- **C1（PASS）**：issue #17 标题、正文、评论、`needs-triage` 标签和无 Project 已回读；Human 决定为只做 append-only 新增设定扩展，受保护 Eval r0.3 hash `1d017caad04a8bbb03a29dfc40be1cb12f00e2abbdf7f8a37f9193ee4e53504e`；交付模式为 `codex/setting-evolution` → PR → `main`，固定点为上述 SHA；非目标不含既有事实编辑／撤销、自动重写、冲突检测、Web/CLI UI。
- **C2（PASS）**：第一轮 contracts 缺失 schema 的 RED 为 3 failed/125 passed；第二轮不变量／trim RED 为 contracts 2 failed、server 2 failed；第三轮 record/candidate 对账 RED 为 contracts 1 failed、server 1 failed；各轮修复后 GREEN。受保护 Eval 未修改。
- **C3（PASS）**：主 Agent 在最终候选上重跑 contracts 定向 6 passed、server 定向 17 passed、`pnpm test`（contracts 131、server 464、web 218 tests passed）、`pnpm typecheck`（四包通过）、`pnpm build`（通过；仅既有大 chunk warning）、staged/fixed-point `git diff --check`（均通过）；独立外部 Eval `/tmp/a4n-setting-extension-main-eval-r1.mts` hash `4a5c24e03e329ce2ab5f0bc8d5c901b4a3758feb1244a8c7f944df10ba5448fe`，最终 memory/SQLite 49 checks PASS。secret pattern 检查仅命中既有 synthetic test fixture，无候选凭据；未增加完整 prompt/provider response 日志。
- **C4（PASS）**：新增 Wiki017；更新 `docs/schema.md`、`CONTEXT.md`、Wiki index、Wiki013 关系与审核日期、`docs/handoff.md`；README.md/README.en.md 同步 Harness 能力和历史／未来章节语义；本地 Wiki/README 链接与 Wiki 结构检查通过。无 ADR/research/运行 skill 变化（N/A：本票未引入不可逆外部选型或运行配置规则）。
- **C5（PASS，发布前 attestation 待完成）**：T0 完整 diff 已回读，Standards/Spec reviewer 未参与实现；核心 append-only、状态／replay 优先级、错误／limit、SQLite v4 原子性、历史／未来输入引用、两 Store parity 均 PASS。三轮受限修复后最终 reviewer 无 P0/P1，受保护 AC 全部有证据。剩余已知 P2 有两项，均只涉及恶意／人工篡改已批准 proposal 持久 JSON：approve terminal replay 路径未完整复用 candidate 校验；candidate 对账仍允许“包含”proposal extension/base input，未严格证明旧内容未改、extension 在末尾且 inputs 精确等于 `[expectedBase]`。两项均不来自 HTTP 正常路径，未改变受保护 AC，作为后续硬化风险保留，不据此扩展本票范围。
- **C6.1/C6.2（PASS）**：三轮 reviewer 发现均已补 RED、修复并重跑定向／全量门禁；最终候选行为和文档事实未再变化。C6.3/C6.4/C6.5/C6.6/C6.7 待主 Agent 收口。
- **验收与 TDD**：逐条 AC 入口为 `apps/server/test/setting-extension.test.ts`、`packages/contracts/test/setting-extension.test.ts` 及外部 Eval；覆盖 strict shape、身份与 append-only、proposal replay、stale/cancel、pending guard、raw/logical limits、SQLite migration/restart/rollback、未来章 Setting ref、历史 ref 隔离和持久 record 对账。
- **知识维护**：`preserve` 原始 #13 Setting 首次通过与 #18 非阻断设计边界；本票新增上下文作为 #17 当前实现入口。README 面向用户，Wiki/schema 面向 Agent/工程，issue 保留 WHAT/AC 与生命周期。
- **C6.5（PASS，发布前 attestation）**：C6.4 reviewer 已确认 T0→T1 仅修改本节预声明证据字段，T1=`79da87f0f5203ec7c037f3e2b3b100cc97606398`；C1–C5、C6.1/C6.2 的命令、固定材料、独立双轴结论、三轮修复和剩余两个 P2 均已忠实转录。候选固定点、清单 blob、受保护 Eval hash 与最终门禁如上；没有新增行为或范围变化。
- **发布前裁决**：待 C6.4 独立 reviewer 对 T0→T1 的证据收口及 C6.6 T1→T2 精确 diff 核对；未完成前不得关闭 issue #17 或宣称二期完成。

## 边界与非目标

- 不修改、删除、撤销或回退既有 Setting 事实。
- 不接受完整 Setting body 作为 extension approve 输入。
- 不自动重写任何历史章节，不阻断或自动清除章节连续性提示。
- 不做冲突检测、语义 judge、真实模型调用、作品 Wiki、工具循环、Web/CLI UI 扩展。
- 不把 proposal 当作 canonical Setting artifact；只有 approve 才追加一个 approved Setting 版本。

## 上下文演进

### 2026-10-11 — 从设计进入第一轮实现

- **触发证据**：Human 确认受保护 r0.3 并授权实施；主 Agent 预审要求真实未来章节消费和 SQLite 事务边界证据。
- **原假设**：只增加 HTTP DTO 即可证明设定演进。
- **决定**：把 proposal record、双 Store 原子动作、v4 migration、Pipeline 未来输入和 rollback 测试一起落地。
- **影响**：主 Agent 仍需在最终候选重跑全量门禁、独立复验、双轴 review、CI 和 issue 收口。
- **上下文处理**：preserve。

### 2026-10-11 — 第二轮 P2 修复

- **触发证据**：独立 reviewer 指出 proposal record 缺少跨字段／状态不变量，draft 与 canonical extension 可能出现首尾空白漂移，且 README 与场景边界未同步。
- **原假设**：第一轮的严格字段 schema 和服务端生成 ID 已足以保证持久 record 与展示资源一致。
- **决定**：在 contract record 上增加 `superRefine`，读取 SQLite 时复用同一严格 schema；draft 在原始长度校验后统一 trim；补充新增未出场人物与修改已写正文规则的边界，并同步双语 README。
- **影响**：损坏 proposal record 不再被投影为合法 resource；r0.3 API、状态机和非目标不变。
- **上下文处理**：preserve。

### 2026-10-11 — 第三轮 P2 修复

- **触发证据**：独立 reviewer 要求 record.extension 与 persisted request.extension 对账，并禁止把当前 Setting head 当作 approved candidate 的唯一来源。
- **原假设**：record schema 已保护 proposal 自身，但 approved candidate 的历史 Artifact 仍可仅凭 ref 返回。
- **决定**：增加共享 domain readback validator；approved 通过精确历史 id/version 读取并核对 Artifact 身份、状态、内容扩展和 stored base input，pending/cancelled 不查 candidate；补充 InMemory/SQLite 历史 candidate 与 SQLite 损坏候选测试。
- **影响**：later Setting head 不会使合法历史 candidate 失效；缺失、错位或篡改 candidate 的 SQLite record 不再暴露为合法 resource；r0.3 API、状态机和 canonical store 边界不变。
- **上下文处理**：preserve。

## 交接结论

主 Agent 可以从本页继续最终 Loop，但不能把第一轮定向绿灯当作票据完成。实现需严格保持 protected Eval r0.3 的范围；若需要修改既有事实、自动重写章节、静默 rebase stale proposal 或新增 canonical Setting store，应返回 Human review。
