---
wiki_id: "018"
ticket: 18
ticket_state: active
context_state: current
summary: "Setting 前的非阻断冲突 review note、作者澄清与可选下游上下文设计"
topics: ["conflict-review", "author-clarification", "setting-context", "agent-observability", "non-blocking"]
code_paths: ["packages/contracts/src/setting.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts", "apps/web/src/pages/Workspace.tsx"]
symbols: ["ConflictReviewResource", "ConflictFinding", "ConflictDecision", "SelectedContext", "sourceSnapshot", "includeInSettingContext"]
inherits: ["013", "014", "016", "019"]
changed_by: []
read_when: ["design-conflict-review", "detect-setting-conflict", "author-clarification", "setting-context", "debug-conflict-review"]
last_context_reviewed: "2026-10-11"
---

# 018 — 输入与设定的冲突检测及作者澄清

## Agent Context

- **读取时机**：设计或实现 Setting 前冲突检查、作者澄清、额外上下文来源、报告 stale/unknown 或 Harness 读取时。
- **原始目的**：为原始素材、提炼稿、创意稿和大纲之间的歧义提供低负担的作者澄清入口；原票面 [#18](https://github.com/12bitsD/agent4novel/issues/18) 明确不先增加“待作者确认”栏目或阻断工作流。
- **Human 决定**：采用非阻断旁路。检查在 Setting 前可选运行，作者决定是否把已处理的额外上下文带入 Setting；检查失败、未知、未处理或存在候选都不阻断 Setting。
- **实际落地**：本票只完成设计契约和后续实现边界；当前 main 尚未增加 ConflictReview API、数据库字段、模型调用或 Setting schema 字段。
- **当前价值**：把“检测候选”和“作者定案”分开，把 review note 与 canonical Setting 分开，并为 AI/Harness 提供可读资源、可调用动作、来源快照、stale 和 unknown 语义。
- **后续变化**：无。#17 的通过后设定编辑不能假设本页已经提供版本回写或自动冲突解决；#28/#29 的工具/Wiki 能力也不在本页范围。
- **代码入口**：实现票先读本页“资源与动作契约”，再核对 [Wiki013](./013-setting-generation-review.md) 的 Setting 通过边界、[Wiki014](./014-agent-cli-telemetry.md) 的 Harness 记录语义和 [schema](../schema.md) 的当前模型。

## 设计目的

作者需要知道哪些输入需要澄清，但不应被一次模型提示或误报强制拦住。检测器只能提出带证据的候选；作者通过 disposition 和原话表达判断；只有作者明确选择的上下文才可进入 Setting 调用。没有捕获的信息保持 `null`，不能被包装为“没有冲突”。

## 起始上下文

#13 已确定 Setting 是作者通过后的作品基准：Setting 生成前消费 approved caption、creative、outline，Setting 通过使用专用条件写入；当前流程不识别语义矛盾，也不生成“待作者确认”栏。#51 已提供独立 `run-step` 的输入、实际调用、结果和 unknown 记录方式，但本票的冲突 review note 面向作品上下文，不能把本地实验记录冒充作品事实。

#18 原票只要求先探索三类信息、作者动作和是否阻断。2026-10-11 Loop C1 对齐收敛为非阻断旁路；受保护设计 Eval 先后经历一轮失败校准，最终 hash 为 `05173e16c818c6aba1e9fff6ecc735cbf00dbebf284a5a00ad68c42a8d22a68f`，旧 hash `7a0a4459394810a5c21269e21f7f1125ce68dcc24fb9fd7d53f25cc70565055e` 只保留为校准失败证据。

## 技术方案

### 分类与作者定案

检测输出是候选，不是事实结论：

| detector category | 含义 | 是否等于真实冲突 |
|---|---|---|
| `missing-context` | 没有足够信息完成某个创作判断，且没有相反事实 | 否 |
| `potential-contradiction` | 两个或多个来源对同一关系／事实给出可能不兼容的表述 | 否，等待作者 |
| `ambiguity` | 多种解释都与现有文字相容，无法确定作者意图 | 否，等待作者 |
| `no-finding` | 所有必需来源均成功捕获且本次检查没有候选 | 仅表示本次检查无候选 |

`confirmed-conflict`、`not-conflict`、`intentional-ambiguity`、`needs-more-info` 是作者 disposition，不是 detector category。作者可以写 `authorText`，但系统不替作者补写事实。无动作不等于接受、忽略或确认。

### 来源快照与运行资源

未来实现的核心资源为 `ConflictReviewResource`。最小形状如下；具体 Zod 契约需在实现票中落地：

```ts
type SourceRef = {
  kind: 'seed' | 'caption' | 'creative' | 'outline'
  artifactId: string | null
  version: number | null
  contentHash: string | null
}
type SourceSnapshot = { refs: SourceRef[]; snapshotHash: string }
type SafeError = { code: string; retryable: boolean; field?: string | null }
type ConflictEvidence = {
  source: SourceRef
  path: string | null
  quote: string | null
  quoteHash: string | null
}
type ConflictFinding = {
  findingId: string
  category: 'missing-context' | 'potential-contradiction' | 'ambiguity' | 'no-finding'
  question: string
  evidence: ConflictEvidence[]
}
type ConflictDecision = {
  decisionId: string
  findingId: string
  disposition: 'confirmed-conflict' | 'not-conflict' | 'intentional-ambiguity' | 'needs-more-info'
  authorText: string | null
  includeInSettingContext: boolean
  sourceSnapshotHash: string
  usable: boolean
}
type SelectedContext = {
  decisionId: string
  findingId: string
  sourceSnapshotHash: string
  authorText: string
}
type ConflictReviewResource = {
  kind: 'conflict-review'
  workId: string
  runId: string | null
  status: 'none' | 'complete' | 'failed' | 'unknown'
  triggeredAt: string | null
  targetStage: 'setting' | null
  sourceSnapshot: SourceSnapshot | null
  findings: ConflictFinding[] | null
  decisions: ConflictDecision[]
  selectedContext: SelectedContext[] | null
  stale: boolean
  error: SafeError | null
}
type ConflictReviewReceipt = {
  requestId: string
  runId: string
  decisionId: string | null
  outcome: 'success' | 'failed' | 'unknown'
  writeOutcome: 'committed' | 'not-committed' | 'unknown'
}
```

`status: none` 表示还没有 run；`failed`、`unknown` 或部分来源未捕获时 `findings` 必须为 `null`。只有所有必需来源成功捕获且 run `complete` 时才能返回 `findings: []` 或一条 `no-finding`。任何缺失的实际输入、模型参数、输出或错误细节保持 `null`/安全分类，不从当前文件补建。

### 资源与动作

资源挂在作品下，但不进入 `workflowState`、`allowedActions` 或 Setting canonical artifact。实现票按以下 Harness 形状提供能力：

| 能力 | 机器入口 | 约束与回读 |
|---|---|---|
| 读取 | `GET /api/works/:id/conflict-review` | 无 run 返回 `status: none`；读取不运行模型、不把 none 当 no-finding |
| 运行 | `POST /api/works/:id/conflict-review/runs` | request 含 `requestId` 和冻结 source refs；receipt 含 runId/status/writeOutcome；unknown 只按 runId 回读，不自动重 POST |
| 比较 | 读取两个 run resource，按 runId/sourceSnapshot/findingId 比较 | MVP 不新增自动判断 endpoint；比较不能把候选升级为事实 |
| 读取 finding | 资源内 findingId，或 `GET .../runs/:runId/findings/:findingId` | 只读取该 run 的证据和来源，不能拿当前文件替代实际输入 |
| 评论／决定 | `POST .../runs/:runId/findings/:findingId/decision` | request 含 requestId、expected run/source refs、disposition、authorText、includeInSettingContext；成功响应为 `{ decisionId, receipt: ConflictReviewReceipt }`，其中 receipt 的 runId/decisionId/requestId 必须与请求一致；stale/identity mismatch 返回结构化 409 |
| 复跑 | 再次 POST runs，使用新 requestId、新 run | 旧 run 和 decision 只读保留，不自动替换或删除 |
| 带入 Setting | Setting run request 携带 selected decision IDs、作者原话和同一 source snapshot | 仅 `includeInSettingContext: true` 且 source 当前匹配的 decision 可用；上下文是指导，不是 canonical Setting 事实 |

每个动作都返回可验证的 `success|failed|unknown` 与 `committed|not-committed|unknown`；运行和作者决定都必须返回 `ConflictReviewReceipt`，未知结果保留冻结请求并由作者／Agent按 ID 回读。没有捕获的内容不在资源中伪造；安全错误不回显密钥、完整 prompt 或 provider 原始错误。

### 非阻断与 stale

冲突 review 可以在 Setting 生成前运行，也可以没有结果直接进入 Setting。它不是关卡，不新增 `awaiting-conflict-review`，不改变 Setting 的 `generate`/`approve` 动作。候选存在、作者未处理、review 失败或 unknown 都不阻断。

任一 source ref 的 ID、version 或 hash 改变，旧 report 标记 `stale: true`，其 decision 的 `usable` 必须为 false；对 stale report 提交 decision 或把 stale decision 带入 Setting 返回结构化 409。新 run 使用新 source snapshot，旧 run 保留用于比较。Setting 请求只能带作者明确选择的 decision ID、finding ID、source snapshot 和 authorText，不能仅靠 source refs 反向扩展未选择 finding；finding/decision 不写入 Setting 正文、Setting artifact content 或通过状态。

## 合成案例

| 案例 | 输入 | 预期候选 | 作者决定 | Setting context |
|---|---|---|---|---|
| A 普通缺失 | 主角年龄未给出，但没有相反事实 | `missing-context` | `needs-more-info` 或不处理 | 默认 `null`；明确 include 才带作者原话 |
| B 潜在矛盾 | creative 写“童年好友”，outline 写“首次相遇” | `potential-contradiction`，两条 evidence | `confirmed-conflict` + 原话 | 只有明确 include 才带 finding/decision/source refs |
| C 有意模糊 | 素材写“继承人身份后续揭示” | `ambiguity` 或 `no-finding`，不自动称真实冲突 | `intentional-ambiguity` | 默认 `null`；另写原话并 include 才进入 |
| D 无发现 | 所有必需来源成功捕获且同一事实一致 | `no-finding` | 无动作 | `null`，不生成“全文已无冲突”断言 |

失败/unknown/部分来源未捕获的案例不允许使用 D 的 `no-finding` 结果。作者决定与 detector 候选分开保存，便于 Agent 比较不同 run；比较只说明资源差异，不说明文学事实真伪。

## 后续实现范围

后续实现票只需落地以下最小切片：

1. contracts：实现上述 `ConflictReviewResource`、finding、decision、source snapshot、selected context、receipt 和安全错误 schema，并固定 `null`/unknown/stale 不变量。
2. server/Harness：以 fake detector 和临时 Store 先提供 GET、run、finding read、decision、run comparison 的资源读取；验证 requestId/runId/decisionId、CAS/stale 和 unknown readback。
3. Setting 接缝：不改 Setting content schema；在 Setting Step 的输入记录中加入可选 selected-context refs，要求来源快照和作者原话一致，未选择时为 `null`。
4. Web/CLI：展示候选和证据，提交作者 disposition/原话，提供明确的“带入 Setting context”动作；不把它改成自动阻断或自动解决。
5. 测试：E2 四案例、failed/unknown/none/no-finding、stale 409、未选择隔离、Setting canonical artifact 不变和现有 Setting/CLI unknown recovery 回归。

真实 provider 运行和文学质量不属于 #18 设计验收；实现票自行按运行 skill 选择 fake 或已授权的合成输入，不把一次模型成功当成冲突检测正确性。

## 测试与验证

- 受保护 Eval：`/tmp/a4n-conflict-clarification-acceptance-r0.md`，最终 hash `05173e16c818c6aba1e9fff6ecc735cbf00dbebf284a5a00ad68c42a8d22a68f`；独立 reviewer 首轮 FAIL 的三项缺口已收紧，复审 PASS。
- 设计验证：逐条核对分类、作者 disposition、source snapshot、status/unknown、`triggeredAt`/`targetStage`、stale 409、显式 include 隔离、Harness read/run/decision/rerun/Setting 形状和非阻断边界；E2 四案例与 E3 安全/兼容预期均已映射。
- 当前代码未改变。typecheck/build 为 `N/A（设计票无代码变更）`；实现票必须重新执行代码门禁，不得把本票设计 PASS 当实现 PASS。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `eec9a5e481f5e932dd4a135836dcef7090756f3d`（#21 merged main）；交付模式为 `codex/conflict-clarification` → PR → `main`；受保护 Eval hash `05173e16c818c6aba1e9fff6ecc735cbf00dbebf284a5a00ad68c42a8d22a68f`；正式双轴候选 T0=`b9bf9b3b86ab672cad26baeb45390f259a4df0e2`；C6.4 后 pre-attestation T1=`5c35fa69610a44d2368ea9e46897a6ea4e6777f7`。
- **T0 staged manifest**：`docs/handoff.md`、`docs/wiki/018-conflict-clarification.md`、`docs/wiki/README.md`；无代码、锁文件、配置或其他未授权文件。
- **C1 判定**：`C1.1/C1.3` PASS — 已回读 issue #18 标题、正文、标签、状态、评论和项目字段；Human 决定采用 Setting 前非阻断旁路，issue comment 已记录范围和 Eval hash；无 blocker、未加入 Project。`C1.2/C1.6` PASS — source branch/fixed point/PR 模式如上，工作区起始 clean。`C1.4` PASS — 已读取 Wiki skill、#13/#14/#16/#19 上下文、CONTEXT、schema 和路线；`C1.5` PASS — 先固定设计 AC/Eval、独立校准，再形成设计文档；`C1.7/C1.8` PASS — 本票仅设计，非目标、依赖、风险及保持 `needs-triage`/open 的预期已记录。
- **C2 判定**：`C2.1/C2.2` N/A（本票只产出设计契约，无可执行行为实现；用 E1 结构核对和 E2 合成案例替代 RED/GREEN，后续实现票必须重新 TDD）；`C2.3/C2.5` PASS — 四类案例覆盖缺失、潜在矛盾、有意模糊、无发现，并固定作者 disposition、source refs、stale、unknown、Setting context 隔离和 AC1–AC7 映射；`C2.4` PASS — 设计复用现有 Store/CAS、command receipt、Harness/run-step、Setting 输入接缝，不增加通用回退状态机或 canonical Setting 字段；`C2.6` PASS — 已执行文档结构、链接和受保护 hash 的确定性验证。
- **C3 判定**：`C3.1` N/A（无代码变更，typecheck/build 留给实现票）；设计门禁已执行。`C3.2` PASS — `git diff --cached --check`、Wiki frontmatter/固定标题/索引/issue backlink/本地链接检查通过，新增文件已纳入候选。`C3.3/C3.4` PASS — changed-files secret/dangerous-input scan 未发现凭据、危险命令或新增外部输入；设计明确安全错误不回显密钥、完整 prompt/provider 原始错误。`C3.5` PASS — 设计收敛为 note/resource 和显式 action，未膨胀为状态机、自动 judge 或作品 Wiki。`C3.6` PASS — 命令、hash、review 和 warning/NA 结果记录于本页；无代码构建 warning。
- **C4 判定**：`C4.1/C4.2` PASS — 本页含 Agent Context、技术方案、后续范围、边界和完成审核证据，索引已更新。`C4.3` N/A（不改变当前 schema；未来实现契约明确标注为实现票落地内容）；`C4.4` N/A（无不可逆或跨票架构选型）；`C4.5` N/A（本票不改变当前用户可见能力、安装或运行方式）；`C4.6` PASS — handoff 已更新 #21 完成、#18 设计中、#17 后续候选；`C4.7` N/A（运行 skill、模型配置和 CLI HOW 未改变）；`C4.8` PASS — frontmatter、固定标题、索引、issue backlink 和本地链接已核对；`C4.9` PASS — 已完成代码/当前边界↔设计、设计↔Wiki/领域词、候选↔issue AC 三轮自校准。
- **C5 判定**：`C5.1–C5.3` PASS — T0 staged manifest、fixed-point..T0 完整 diff、`git diff --check`、候选文件和无 secret 已审计，无本地中间 commit。`C5.4/C5.5` PASS — 校准 reviewer 首轮 FAIL 的三项缺口已收紧；Poincare 对 T0 独立给出 Standards PASS / Spec PASS，无 blocking，并确认候选只有 3 个文档文件。`C5.6` PASS — 接受并修复 `no-finding` 前提、Harness receipt/unknown/readback、stale/context isolation、运行元数据和 E3 证据缺口；`C5.7` PASS — 修订后重新执行结构/链接/hash 检查并取得新候选 review。
- **验收与校准**：受保护 Eval 初版校准 FAIL（no-finding、Harness response、stale isolation），r0.1 hash `05173e...` 复审 PASS；E1 已固定 `ConflictReviewResource`、`ConflictReviewReceipt`、分类/disposition、stale/unknown/none；E2 四案例和 E3 非阻断/安全/兼容预期均有文档映射。
- **双轴 review**：正式候选 T0 的独立 Poincare 结论为 **Standards PASS / Spec PASS**，无 blocking；设计校准 reviewer r0.1 也 PASS。非阻塞风险为未来实现需把嵌套类型落成 Zod/公开契约，并自行通过代码门禁。
- **本地门禁**：`git diff --check`、Wiki frontmatter/固定章节/索引/issue backlink/相对链接脚本、受保护 Eval SHA-256 均通过；typecheck/build 为 `N/A（设计票无代码变更）`，不是实现质量证据。
- **知识维护**：新增本页和索引，更新 `docs/handoff.md`；`docs/schema.md`、README、CONTEXT、ADR、research 和运行 skill 不受影响，原因是本票不改变当前数据模型、用户操作或运行方式。
- **C6.1/C6.2**：PASS — review 暴露的设计缺口已在设计文档补齐并新增复审证据；修复后重跑文档结构/链接/hash、`git diff --check`，并取得 Standards/Spec PASS。无代码测试可重跑。
- **C6.3**：PASS（受控证据写入）；本字段记录 T0、清单 blob、C1–C5、C6.1/C6.2、AC/Eval、本地门禁、双轴 review、修复和 N/A 边界。
- **C6.4**：PASS — Poincare 精确比较 T0→T1，确认仅本页“完成审核证据”字段发生 14 insertions/6 deletions，`git diff --check` 通过；无代码、AC、设计正文或其他文件变化，且 staged manifest/工作区符合预期。
- **C6.5**：PASS（本次一次性发布前 attestation 写入）；已写入清单 blob、fixed point、T1、C1–C5、C6.1–C6.4、AC/Eval、本地门禁、双轴 review、修复、N/A 边界和未发生的远端动作；不写入自引用最终 tree。
- **发布前裁决**：C6.6/C6.7 尚未执行；尚未创建/合并 PR、推送、关闭 issue 或将设计宣称为实现完成。

## 边界与非目标

- 不新增“待作者确认”Setting 栏目、冲突 workflow gate 或阻断 Setting 的状态。
- 不把 detector 候选自动升级为真实冲突、不自动修复来源、不自动改写 Setting/章纲/正文。
- 不把 finding/decision 写入 canonical Setting content，不提供通用版本回退、自动 judge、作品 Wiki、长期记忆或工具执行循环。
- 不把 `none`、`failed`、`unknown`、未捕获来源解释为 `no-finding`；不从当前文件重建未捕获的实际输入或模型输出。
- 不在本票执行真实 provider 或文学质量评估。

## 上下文演进

### 2026-10-11 — 从“冲突检测”收敛为非阻断 review note

- **触发证据**：#18 原票要求先区分缺失、矛盾和有意模糊，但没有决定是否阻断，也没有定义后续消费边界；Human 选择非阻断 Setting 前旁路。
- **原假设**：可以先设计一个“冲突”字段或流程状态再补作者动作。
- **决定**：检测器输出候选，作者 disposition 才是定案；报告独立于 Setting，只有显式 include 的作者原话可进入 Setting 指导上下文；来源变化使报告 stale，unknown 必须回读。
- **影响**：实现票可复用现有 Store/CAS/command receipt/Harness 语义，不增加通用状态机或 canonical Setting 字段；#17 不能假设本票已提供设定版本编辑/回退。
- **上下文处理**：`replace` 旧的“未设计、未实现”结论为当前设计入口，保留 Human 决定和非目标。

## 交接结论

下一位 Agent 可以假定：#18 目前只有设计契约，没有代码能力；实现时必须以本页与受保护 Eval hash 为准，先读 [Wiki013](./013-setting-generation-review.md)、[Wiki014](./014-agent-cli-telemetry.md) 和 issue #18 的校准评论。不能假定冲突检测会阻断 Setting、自动判断真实冲突、自动解决或修改 canonical Setting。实现结束后需另开实现票或更新本票并重新执行 TDD、双轴 review、CI 和远端回读。
