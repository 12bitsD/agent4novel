---
wiki_id: "021"
ticket: 21
ticket_state: active
context_state: current
summary: "通过后按章重生章纲与正文，保留历史和后续章并暴露连续性提示"
topics: ["chapter-regeneration", "versioned-artifacts", "human-review", "continuity-warning", "harness"]
code_paths: ["packages/contracts/src/artifact-envelope.ts", "packages/contracts/src/beat.ts", "packages/contracts/src/prose.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/chapter-view.ts", "apps/server/src/routes/works.ts", "apps/web/src/beat-review.ts", "apps/web/src/prose-review.ts", "apps/web/src/pages/Workspace.tsx"]
symbols: ["chapterRegenerationBindingSchema", "Pipeline.regenerateBeat", "Pipeline.regenerateProse", "chapterSummaries", "regenerate-chapter", "regenerate-chapter-prose"]
inherits: ["006", "020", "022"]
changed_by: []
read_when: ["regenerate-chapter", "replan-approved-chapter", "continuity-warning", "read-artifact-history"]
last_context_reviewed: "2026-10-10"
---

# 021 — 章节重生

## Agent Context

- **读取时机**：实现或排查通过后历史章重生、旧版本读取、后续章节连续性提示、章级 allowedActions 或 Harness 历史读取时。
- **原始目的**：作者在已有正文后重新规划该章章纲，并据此重新生成对应正文；WHAT/AC 以 [#21](https://github.com/12bitsD/agent4novel/issues/21) 为准。
- **实际落地**：已按 Human 决定 B 实现：可指定历史章；后续章保留原产物、状态和输入快照，只显示连续性提示。重生分为章纲 pending 和正文 pending 两个显式人类关卡。
- **当前价值**：重生请求绑定旧 head 的 artifact ID/version；旧版本保留在 Store 历史并可通过公开 Harness 路由读取；当前 head 通过追加改变，不静默覆盖。
- **后续变化**：暂无；通过后正文编辑仍继承 [Wiki 022](./022-prose-generation-review.md)，跨章输入和连续性判断继承 [Wiki 006](./006-chapter-continuation.md)，当前章 pending beat 比较与选择仍由 [Wiki 020](./020-beat-variant-compare.md) 负责。
- **代码入口**：先读共享重生绑定与 Beat/Prose request schema，再读 Pipeline 两个专用分支、chapter-view 读模型、历史 GET 路由和 Workspace 动作。

## 设计目的

把“通过后重生”拆成可观察、可恢复的两个动作：先重生章纲，作者通过后再重生正文。任何一步失败或版本过期都不得创建部分结果。后续章不自动重写、不退回关卡，只依据旧输入引用与当前 head 的差异提供 `needsContinuityReview`。

## 起始上下文

#20 已交付当前 pending beat 的 A/B 比较与选择，但不覆盖已通过章节回流。#6 已提供每章独立 Beat/Prose 关卡、上一章输入和历史编辑隔离。#22 已确定 Prose 的保存、整章重写和通过后编辑语义。Issue #21 原票面明确不提前预建回流状态机；本票只在开工时收敛历史章范围和保留规则。

2026-10-10 的 Loop C1 对齐确认：允许指定历史章重生，后续章节保留且只提示连续性；受保护验收文件为 `/tmp/a4n-chapter-regeneration-acceptance-r0.md`，冻结 hash `8cf3349f19b74e7cb458deaee03aa9d94e6a631085b90706a424a28a91fd5005`。

## 技术方案

### 两阶段请求

Beat/Prose regeneration request 各自可带严格的 `regeneration` 绑定：`mode: "chapter-regeneration"`、`expectedBeat` 和 `expectedProse` 的 `{artifactId, version}`。Beat 请求的普通 head 必须等于 `expectedBeat`；Prose 请求的普通 head 必须等于 `expectedProse`。

- 章纲阶段：目标 Beat 与 Prose 当前 head 均为 approved 且与绑定一致。服务端使用当前已通过上游和上一章快照调用 Beat Step，追加新的 pending Beat；旧 Beat/Prose 和后续章节不变。
- 正文阶段：目标 Beat 已通过、目标 Prose 仍是旧 approved head，且旧 Prose 的输入引用不再指向当前 Beat。服务端使用新 Beat 及现行上游快照调用 Prose Step，追加新的 pending Prose。
- 两阶段均使用现有 observe、Artifact CAS、输入引用、错误分类和命令 envelope；普通当前章再生保持原 gate 语义。
- 作者分别通过新 Beat 和新 Prose。通过动作不调用模型，也不改变旧版本身份。

### 读模型和历史资源

`chapterSummaries` 从 head 关系派生动作：

- approved Beat + approved Prose 且 Prose 仍引用当前 Beat：`regenerate-chapter`；
- chapter regeneration 产生的 pending Beat：`approve`/`regenerate`；
- 新 Beat approved、旧 Prose approved 且 Prose 不再引用新 Beat：`regenerate-chapter-prose`；
- pending Prose：原有 `save-draft`/`approve`/`regenerate`。

后续 chapter 的 `needsContinuityReview` 复用现有 `inputs` stale 检查。历史资源通过严格的 `GET /api/works/:id/artifacts/{beat|prose}/{chapter}/versions/:version?artifactId=...` 返回完整 Artifact；它要求 kind、chapter、version、artifactId 全部匹配，不提供历史列表或回退动作。

## 代码落点

- `packages/contracts/src/artifact-envelope.ts`：重生绑定和 artifact identity ref。
- `packages/contracts/src/beat.ts`、`prose.ts`：普通再生请求的可选严格绑定及 head 一致性。
- `packages/contracts/src/beat-command.ts`、`prose-command.ts`：命令观察中的重生绑定和 operation/expected head 约束。
- `apps/server/src/pipeline/pipeline.ts`：历史章 Beat/Prose 两阶段分支、上游输入和提交前置条件。
- `apps/server/src/chapter-view.ts`：章级动作和连续性提示投影。
- `apps/server/src/routes/works.ts`：历史 Artifact Harness GET；既有 Beat/Prose command routes 复用同一请求。
- `apps/web/src/pages/Workspace.tsx`：历史章章纲/正文重生按钮和既有人工关卡显示。
- `apps/server/test/chapter-continuation.test.ts`：三章 fake provider、两阶段 gate、后续快照、历史 GET 和 stale request 验证。

## 测试与验证

- 受保护 Eval：C1 对齐和独立 reviewer 校准已完成。固定文件未被实现修改，hash 仍为 `8cf3349f19b74e7cb458deaee03aa9d94e6a631085b90706a424a28a91fd5005`。
- TDD RED：在固定点临时 worktree 只应用章节重生测试后，`pnpm --filter @agent4novel/server exec vitest run test/chapter-continuation.test.ts --reporter=dot` 以非零退出；失败原因为固定点把已通过 Beat 当作不可再生，未有历史重生分支。临时 worktree 已移除。
- 定向测试：`pnpm --filter @agent4novel/server exec vitest run test/chapter-continuation.test.ts --reporter=dot` 已通过，包含 13 tests；覆盖三章 fake provider、两阶段 gate、目标章/后续快照、历史 GET、目标 workflow、普通历史 pending gate 及其 HTTP response workflow、stale/wrong-id/pending/no-source 拒绝。
- Web reducer 定向测试：`pnpm --filter @agent4novel/web exec vitest run` 已通过，34 files / 218 tests；新增 reducer 测试验证 approved head 可带绑定进入重生并冻结请求。
- 类型检查：`pnpm typecheck` 已通过（contracts/server/web/cli）。
- 历史读取逐字段断言、旧版本身份和后续章节快照均在新增章节重生测试中覆盖；不调用真实模型。SQLite 既有全版本、inputs 和重连回归保持通过。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `7a57e4b8230a611349c9ec51bc8c2e6b1d5f378f`；交付模式为 `codex/chapter-regeneration` → PR → `main`，默认分支为 `main`，分支保护 API 返回 404（仓库当前无保护）；受保护 Eval hash `8cf3349f19b74e7cb458deaee03aa9d94e6a631085b90706a424a28a91fd5005`；双轴候选 T0=`c275339f7d2d7ee0b23435407afc44bc842920cf`；C6.4 后 pre-attestation T1=`033d9abf53c55f1e32efae82d02f5c1efbc76d8a`。
- **T0 staged manifest**：`.claude/skills/agent4novel-drive/SKILL.md`、`README.en.md`、`README.md`、`apps/server/src/{beat-command.ts,chapter-view.ts,pipeline/pipeline.ts,prose-command.ts,routes/works.ts}`、`apps/server/test/chapter-continuation.test.ts`、`apps/web/src/{beat-review.test.ts,beat-review.ts,prose-review.test.ts,prose-review.ts,pages/Workspace.tsx}`、`docs/{handoff.md,schema.md}`、`docs/wiki/{005-beat-generation-review.md,006-chapter-continuation.md,021-chapter-regeneration.md,022-prose-generation-review.md,README.md}`、`packages/contracts/src/{artifact-envelope.ts,beat-command.ts,beat.ts,prose-command.ts,prose.ts}`；无 unstaged/untracked 票外文件。
- **C1 判定**：`C1.1/C1.3` PASS — 已回读 issue #21 标题、原始范围、标签、状态、评论和项目字段；Human 对齐评论确认 B 方案、两阶段 gate、历史读取和非目标；无 blocker、未加入 Project。`C1.2/C1.6` PASS — source branch/fixed point/PR 模式如上。`C1.4` PASS — 已读取 Wiki skill、相关 Wiki、CONTEXT/schema；`C1.5` PASS — 先固定受保护 AC/Eval，再按 RED → 实现 → 独立 review → 回归执行；`C1.7/C1.8` PASS — 范围、非目标、风险和完成时保留 `needs-triage`、不改依赖/Project、按完成评论后关闭的预期已记录。
- **C2 判定**：`C2.1` PASS — fixed-point 临时 worktree 仅应用章节测试时定向测试以非零失败，另有第三轮普通历史 pending gate 的 RED（`beat gate not ready`）；`C2.2` PASS — 最小实现后每轮受影响测试/typecheck 通过；`C2.3/C2.5` PASS — E2 三章 fake-provider 覆盖两阶段 gate、CAS、错误语义、后续快照、历史 GET、目标章响应 workflow，AC1–AC7 均有代码/测试映射；`C2.4` PASS — 复用现有 Artifact CAS、command envelope、readback/unknown recovery、`run-step` 输入组装和 continuity 派生，未引入回流状态机或自动 judge；重复 helper 是已记录的 P3 风险；`C2.6` PASS — 本票是行为变化，已执行 RED/GREEN。
- **C3 判定**：`C3.1` PASS — 最终定向 server/SQLite 为 2 files/25 tests，章节重生文件为 13 tests；最终 `pnpm test` 为 server 43 files/447 tests、contracts 21 files/125 tests、CLI 18 files/213 tests、Web 34 files/218 tests；`pnpm typecheck` 和 `pnpm build` 均退出 0。`C3.2` PASS — `git diff --cached --check`、fixed-point..T0 `git diff --check` 通过，新增 Wiki/skill/docs 均纳入候选。`C3.3/C3.4` PASS — changed-files secret/dangerous-input scan 未发现凭据、新增联网、无保护外部输入或注入入口，未新增 secret 文件；遥测仍为安全摘要，不记录完整 prompt、密钥或供应商原始错误。`C3.5` PASS — 复用、边界、可读性和并发/CAS 已清理；非阻塞 warning 仅是既有 Web `act(...)` 和 Vite chunk size。`C3.6` PASS — 命令、退出码、关键 warning 和结果已记录于本页与交接文档。
- **C4 判定**：`C4.1/C4.2` PASS — 本页、完成审核证据和索引已更新；`C4.3` PASS — `docs/schema.md` 更新 binding/history route 不变量；`C4.4` N/A（没有不可逆、跨票架构决定）；`C4.5/C4.6` PASS — 中英文 README 与 `docs/handoff.md` 已同步用户行为、当前里程碑和限制；`C4.7` PASS — drive skill 已同步两阶段章级绑定、历史 Harness GET 和 CLI 复用方式；模型配置/Loop 规则未改变，Kimi provider/test model 已在基线 #60/#61 交付；`C4.8` PASS — frontmatter、固定标题、索引、issue backlink 和本地链接已核对；`C4.9` PASS — 已完成代码↔行为/测试、代码↔Wiki/领域词、候选↔issue AC 三轮自校准。
- **C5 判定**：`C5.1–C5.3` PASS — T0 staged manifest、fixed-point..T0 完整 diff、`git diff --check` 和无本地中间 commit 已审计。`C5.4/C5.5` PASS — 未参与实现的 Poincare 对 fixed-point..T0 独立复审：无 blocking，Standards PASS、Spec PASS；终轮特别确认普通历史 pending Beat/Prose 仍经共享 preparation/CAS/unknown 路径，且成功 response 返回目标章 `awaiting-beat-review`/`awaiting-prose-review`。`C5.6` PASS — 第一轮 Web recovery、目标 workflow、provenance 误判和终轮 response workflow 发现均接受并修复；`C5.7` PASS — 每次实质修复都重跑受影响 RED/GREEN、门禁并重新取得对应 review。
- **验收与 TDD**：受保护 AC/Eval 未被实现修改；E1 RED/GREEN、E2 三章端到端、E3 兼容/安全检查均已执行。AC1 由目标章入口/allowedActions，AC2–AC3 由两阶段 pending/approve/CAS，AC4/AC7 由精确历史 GET、命令 receipt 和目标 workflow，AC5 由后续 artifact 逐字段快照，AC6 由 stale/wrong-id/pending/no-source/no-partial-write 测试覆盖。
- **双轴 review**：校准 reviewer 已在 issue 评论确认受保护 AC PASS；终轮 Poincare 明确给出 **Standards PASS / Spec PASS**，无 blocking；仅保留 Beat/Prose workflow 投影重复的 P3 可维护性风险。
- **修复与回归**：第三轮修复普通历史 pending gate 的全局 workflow 判断；终轮修复 HTTP successful regenerate response 仍回退全局 `workflowOf` 的 AC7 缺陷，并补充三章 HTTP response workflow 断言；修复后定向/全量测试、typecheck、build 和 diff check 均通过。
- **知识维护**：本页、`docs/wiki/README.md`、Wiki005/006/022 路由、`docs/schema.md`、中英文 README、`docs/handoff.md` 和 drive skill 已更新；CONTEXT/ADR/research 不受影响（没有新增领域词或不可逆选型）。
- **C6.1/C6.2**：PASS — review 暴露的行为缺陷均有对应回归或结构化断言；修复后重跑定向 2 files/25 tests、全量 43/447 + 21/125 + 18/213 + 34/218、`pnpm typecheck`、`pnpm build`、`git diff --check`，均成功。
- **C6.3**：PASS（受控证据写入）；本字段记录 T0、清单 blob、C1–C5、C6.1/C6.2、AC/TDD、本地门禁、双轴 review、修复和风险。
- **C6.4**：PASS — Poincare 精确比较 T0→T1，确认仅本页“完成审核证据”字段发生 14 insertions/12 deletions，`git diff --check` 通过；无代码、AC、实现逻辑或其他文件变化，且无 unstaged/untracked 余项。
- **C6.5**：PASS（本次一次性发布前 attestation 写入）；已写入清单 blob、fixed point、T1、C1–C5、C6.1–C6.4、AC/TDD、门禁、双轴 review、修复、剩余 P3 风险与未发生的远端动作；不写入自引用最终 tree。
- **发布前裁决**：C6.6/C6.7 尚未执行；尚未创建/合并 PR、推送、关闭 issue 或声明票据完成。

## 边界与非目标

- 不删除或覆盖旧 Beat/Prose，不把旧版本变成新的 approved head。
- 不自动退回、重写或生成后续章节；连续性提示不是新的审批状态。
- 不改变设定/大纲，不新增通用回流状态机、历史列表、版本回退、自动 judge 或真实模型验收。
- 不把公开历史 GET 扩成全历史浏览；调用方必须掌握精确 artifact identity/version。

## 上下文演进

### 2026-10-10 — 从需求入口收敛到双关卡历史重生

- **触发证据**：Human 选择允许历史章重生、后续章保留并只提示连续性；现有 #6 输入引用已能识别下游漂移。
- **原假设**：#21 旧票面未决定 current-only、旧正文和后续章语义。
- **决定**：不做回流状态机；用两个显式 pending head、CAS 绑定和 inputs stale 派生完成最小安全能力。
- **影响**：普通当前章命令保持兼容；Harness 增加精确历史 Artifact GET；后续章节数据不参与写入。
- **上下文处理**：`replace` 旧的“未设计、未实现”结论，保留原始需求和非目标。

## 交接结论

下一位 Agent 可以假定：章节重生的安全边界是两次显式通过、版本绑定、历史可读和后续只提示；不能假定自动改写后续章节、历史列表或任何真实模型质量。继续开发时优先读取本页、Wiki 006/020/022、`docs/schema.md` 和 issue #21 的对齐/校准评论。
