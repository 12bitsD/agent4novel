---
wiki_id: "020"
ticket: 20
ticket_state: done
context_state: current
summary: "当前 pending beat 再生后的 A/B 比较、显式选择与版本安全"
topics: ["beat-regeneration", "variant-compare", "cas", "author-review"]
code_paths: ["packages/contracts/src/beat-variant.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts", "apps/web/src/beat-review.ts", "apps/web/src/pages/Workspace.tsx", "apps/cli/src/commands.ts"]
symbols: ["BeatVariantComparison", "selectBeatVariant", "runBeatVariant", "select-beat-variant"]
inherits: ["005", "014", "019"]
changed_by: []
read_when: ["change-beat-regeneration", "change-beat-comparison", "review-issue-20"]
last_context_reviewed: "2026-10-10"
---

# 020 — 章纲再生后的比较与选择

## Agent Context

- **读取时机**：修改当前章 beat 再生、比较、选择、CLI 或未知结果恢复时读取本页。
- **原始目的**：作者重新生成章纲后，要能看清再生前快照与新结果，并决定使用哪一份，避免覆盖人工修改。
- **实际落地**：当前 pending beat 再生成功后追加 B 并返回 A/B；选择 B 保留 B 为 pending；选择 A 追加 A-copy C 为 pending；所有选择都需要后续显式通过。PR57 已合并，issue 已关闭；交付证据入口见“交接结论”。
- **当前价值**：本票只覆盖当前章节的 pending beat，不是通用历史服务，不允许已通过 beat 回退，不自动修改下游 prose。
- **后续变化**：暂无后续票改变本页范围；#21 另行处理通过后章节重生。
- **代码入口**：先读 `packages/contracts/src/beat-variant.ts`、`apps/server/src/pipeline/pipeline.ts`、`apps/server/src/routes/works.ts`、`apps/web/src/pages/Workspace.tsx` 和 `apps/cli/src/commands.ts`。

## 设计目的

本票把“再生”与“选择”拆成两个可观察动作。再生只追加候选，不隐式选择。选择接口返回完整比较和选择 receipt，供 Web、CLI 和 Harness 读取。选择动作不调用模型；超时或未知只影响客户端确认状态，不自动追加、选择或重试。

## 起始上下文

#5 已支持当前页面编辑和整份 beat 再生，#14 已提供 CLI 与 run-step 观测能力，#19 约束 artifact 的 kind/status、版本和内容校验。GitHub issue #20 的原始票面明确不预先锁定 UI、存储或回退协议；2026-10-10 的预对齐评论将范围收窄为当前 pending beat 的 A/B/C 版本选择，不扩展为通用历史系统。

## 技术方案

### 版本与选择

- 再生前基线 A 是服务端当前 pending head，成功后追加 B；A/B 都保留，响应中的 comparison 是完整 artifact 快照。
- choice=new 只返回 B 的选择 receipt，B 仍是 pending。
- choice=original 以服务端按 id/version/content 核对的 A 追加 C，C 是新 identity、新 version、pending；A/B/C 不删除。
- 再生、选择和后续 approve 均绑定 artifact id/version。非当前章节、已通过、缺失历史、A/B 身份不符或并发变化在模型前/写入前返回 409。
- 失败、超时和 unknown 不创建半版本、不自动选择、不自动重试；客户端冻结原请求和 A/B 供核对。

### AI/Harness 资源与动作

- **读取**：公开 work GET 读取当前 head；selection response 读取 A/B、choice、expectedHead、originalHead、writeOutcome、resultHead；CLI `select-beat-variant` 输出同一严格 JSON。
- **比较**：再生 response 的 `comparison.original/candidate` 是完整可校验快照；Web 直接展示 A/B。
- **评论**：当前不新增评论存储；Agent 可在 issue/Wiki 中记录选择依据，选择 receipt 记录动作结果。
- **复跑**：选择动作无模型，不做隐式重跑；模型再生沿用既有冻结请求/未知结果恢复；run-step 继续提供节点实际输入、输出、配置和来源记录。
- 没有捕获的字段由既有记录协议表示为缺失/none，不伪造推断值。

### 取舍

复用现有 artifact append、CAS、BeatReview 和 run-step，不新增 SSE、数据库表、通用历史 UI、自动评分器或下游级联。服务端的精确历史读取只用于核对客户端提交的 A，不把所有历史版本扩展进公开 work view。

## 代码落点

- contracts：`beat-variant.ts` 定义 comparison、selection request/receipt/response；`beat-command.ts` 为再生响应增加可选 comparison。
- server：`Pipeline.regenerateBeat` 追加 B 并返回 A/B；`Pipeline.selectBeatVariant` 校验当前 head 与历史 A 并按 choice 返回 B 或追加 C；HTTP 路由提供 `POST /api/works/:id/artifacts/beat/select`；内存/SQLite store 提供精确版本读取。
- Web：`BeatReview` 保存冻结比较；`Workspace.runBeatVariant` 发送一次选择请求、保留 unknown 状态并支持同一请求重试/核对；比较状态禁止 approve。
- CLI：`select-beat-variant <workId> --file <json>` 严格校验输入、响应 identity 和原始内容，5xx/网络/畸形响应按 unknown 处理。
- run-step：继续复用既有记录协议，不新增节点级私有旁路。

## 测试与验证

### 冻结验收与 Eval

受保护材料由主 Agent 维护，实施 Agent 不得修改：

- `packages/contracts/test/beat-variant-selection.eval.test.ts`
- `apps/server/test/beat-variant-selection.eval.test.ts`
- `apps/web/src/pages/Workspace.beat-compare.eval.test.tsx`
- `apps/cli/test/beat-variant-cli.eval.test.ts`

| Eval | 标准 | 可观察证据 |
|---|---|---|
| E20.1 | A 再生为 B，A/B 完整可读且 B pending | HTTP response comparison + GET head + history identity |
| E20.2 | 选择 B 不自动 approve，随后 approve 只接受 B | selection response + approve CAS |
| E20.3 | 选择 A 追加 C pending，A/B/C 历史保留，随后 approve 只接受 C | selection response + artifact versions |
| E20.4 | stale/approved/非当前/缺失身份在模型前拒绝；并发选择 409 | request/model counter + status/code |
| E20.5 | failure/unknown 不追加半包、不自动选择，冻结请求/比较材料保留；Web 核对入口交给 Workspace 执行 readback | no new head + UI lock/recovery + Workspace readback |
| E20.6 | Harness 可通过严格 CLI/HTTP 与 run-step 读取输入、输出、来源身份 | CLI contract + real Step/run-step record |

固定点：`d6b529802811c48560f5de1107ffad3acff72aa8`。受保护方法修订提交为 `a3abe18`；四个受保护文件 SHA-256 为：contracts `cddcb53f7f4964ea69e984c4e97c98a474170850cb5cb24de14c23a9eaff3f2c`、server `a7fc7e71445dca32606500e206ffbedc9ce89fbb83a633dac0a64cfaa8f2eba3`、web `24c18819fa0b42f625d861ad02cee0c98ab39708403ebb89bd6c88bdc0fdd3a8`、CLI `51fdadcb9ddb4c5ea710e694e5ba58813c3eec8c88206d3082787f088c69e507`。Round 2 受保护方法 delta 经独立 reviewer Lagrange 判定 PASS。

### 本地验证

Round 1 曾发现 Web unknown 的核对按钮先将 ref 置为 `reconciling`，随后被 `Workspace.runBeat` guard 拦截，GET/readback 未执行。Round 2 仅将按钮恢复为调用 `onConfirm`，由 Workspace 统一推进状态并执行 GET。该缺陷对应 E20.5，修复后受保护 Web eval 已通过，且已重跑全量测试、typecheck、build 和 diff 检查。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `d6b529802811c48560f5de1107ffad3acff72aa8`；双轴候选 T0 `42f506003aaf15c288773429fce133d8fa3625b7`；pre-attestation T1 `5143b2d4aa41e3bb30372472647279f8376fdbac`。T2 不写入本页，避免自引用。T0 staged manifest 为 7 个文件；fixed→T0 完整 delta 共 27 个文件，均为本票实现/验收/知识维护范围。
- **C1 锁定票面：PASS**。C1.1（`gh issue view 20 --repo 12bitsD/agent4novel --json ...`；issue OPEN、labels `needs-triage`/`ready-for-agent`、无 Project/milestone；AC 以 issue 和预对齐评论 `https://github.com/12bitsD/agent4novel/issues/20#issuecomment-6089706743` 为准）；C1.2（PR 模式，source `codex/outline-version-compare`，base `main`，当前未创建 PR）；C1.3（current pending beat、A/B/C、CAS、unknown 和非目标已固定）；C1.4（本页、CONTEXT、schema、ADR 入口已核对）；C1.5（TDD slices：contract/server/Web/CLI/run-step）；C1.6（branch/status 与固定点已回读，无用户改动）；C1.7（不做通用历史、SSE、自动评分、下游级联）；C1.8（终态预期为 PR merge 后关闭 issue，保留现有 labels/依赖边）。
- **C2 TDD/实现：PASS**。C2.1（四组受保护 E20 冻结；E20.5 缺口经补断言形成 RED/修复）；C2.2（最小生产修复 `36f3551`，typecheck/受影响 Web tests 通过）；C2.3（E20.1–E20.6 覆盖成功、选择、CAS/并发、失败/unknown、CLI/HTTP/run-step）；C2.4（复用 artifact append、CAS、BeatReview、run-step、store seam）；C2.5（Euler 对 T0 Spec PASS）；C2.6（Web 入口断言与 Workspace readback 分层覆盖）。
- **C3 本地门禁：PASS**。C3.1（定向 E20：contracts 2、server 3、web 2、CLI 4；`pnpm test` 992 tests：contracts 125、CLI 213、server 438、web 216；`pnpm typecheck`；`pnpm build`）；C3.2（staged/fixed→T0 diff check、完整 manifest、新增文件核对）；C3.3（只记录安全 telemetry/hash/identity，无 prompt/credential/provider raw response 泄露）；C3.4（未发现真实 secret、危险命令或未保护外部输入，synthetic key 仅隔离 fixture）；C3.5（Noether 未发现重复 helper、旁路状态机或 coding 膨胀）；C3.6（命令、结果、日期和 warning 已记录，React `act(...)` 与 Vite chunk size 为非阻断 warning）。
- **C4 知识回写：PASS**。C4.1/C4.2（本页 canonical frontmatter、固定章节、完成审核证据）；C4.3（schema 补 #20 契约）；C4.4 N/A（无不可逆跨票决定，复用既有 artifact/CAS/store）；C4.5（双语 README 的 A/B/选择/显式通过）；C4.6（handoff）；C4.7 N/A（运行方式和模型配置未变）；C4.8（Wiki Index、issue backlink、frontmatter、固定标题、本地链接）；C4.9（三轮代码↔测试、代码↔知识、候选↔AC 自校准）。
- **C5 双轴 review：PASS**。C5.1/C5.2/C5.3（T0、manifest、fixed→T0 完整 diff、每笔本地 commit、两种 diff check）；C5.4（Noether，Standards，T0）；C5.5（Euler，Spec，T0）；C5.6（Round 1 阻断证据与 Round 2 最小修复）；C5.7（行为修复后门禁和双轴复核均重新执行）。
- **C6.1/C6.2：PASS**。E20.5 先补受保护 Web 断言，再由 `36f3551` 修复 BeatReview/Workspace 双写状态竞争；定向 E20、992 tests、typecheck、build、diff check 全部重跑通过。
- **C6.3：PASS**。本字段已忠实汇总 C1–C5、C6.1/C6.2、AC/TDD、门禁、双轴 reviewer、知识维护、N/A 和剩余风险，来源为 T0 与可回读命令输出。
- **C6.4：PASS**。Noether 独立比较 T0→T1；唯一改动是本 Wiki 的完成审核证据字段；T1 完整 diff、manifest、工作区和证据映射均通过。
- **C6.5：PASS（本次写入）**。在 C6.4 PASS 后，本字段一次性写入清单 blob、固定点、T0/T1、C1–C5、C6.1–C6.4 逐项证据、reviewer attestation、修复与剩余风险；不写 T2 或整节最终关闭结论。
- **双轴原始发现与处理**：Round 1 Spec FAIL：BeatReview 先 dispatch confirm 导致 Workspace guard 不能 GET；由 `36f3551` 修复。Round 1 Standards FAIL：Wiki contract、schema、双语 README、handoff/index 不完整；已在 T0 收敛。Round 2 Euler Spec PASS、Noether Standards PASS；Lagrange 对受保护验收方法 delta PASS。
- **剩余风险与待办**：C6.6/C6.7 尚待独立核对；PR、required CI、merge、远端分支回读和 issue 关闭尚未发生。React `act(...)` 与 Vite chunk size warning 不阻断本地门禁。#12 的 Docker Hub 429 是另一票的远端阻塞，不作为本票通过依据。

## 边界与非目标

不支持已通过 beat 回退，不承诺跨刷新后继续展示本次 A/B，不做统一历史浏览、SSE、数据库新表、自动评分、评论存储或下游自动重写。选择接口不调用模型。若服务端没有捕获某项运行信息，Agent 应读取既有记录中的缺失/none，而不是推测。

## 上下文演进

### 2026-10-10 — 从待设计票收敛为当前 beat 选择

- **触发证据**：GitHub issue #20 的原始需求与预对齐评论。
- **原假设**：可以先把比较做成通用历史能力。
- **决定**：先只实现当前 pending beat 的 A/B/C，复用现有 artifact 版本与 CAS。
- **影响**：接口、UI、CLI 和验收都限定在 beat；#21 保持独立。
- **上下文处理**：preserve；保留原票面和未纳入通用历史系统的理由。

### 2026-10-10 — Round 1 review 暴露 unknown readback 缺口

- **触发证据**：Spec reviewer 发现 `BeatReview.tsx` 先派发 confirm，`Workspace.runBeat` 随即因 reconciling guard return。
- **原假设**：UI 同时更新本地状态并触发 Workspace handler 不会改变 ref 的同步判定。
- **决定**：由 Workspace 的 `runBeat('confirm')` 单一负责状态转换和服务器 GET/readback；UI 只调用 `onConfirm`。
- **影响**：E20.5 现在有明确的 readback 入口，避免未知结果永久卡在 reconciling。
- **上下文处理**：replace；用已验证的单一入口取代双写状态路径。

## 交接结论

PR57 已以 `e0b2e43` 合入，#20 已关闭；交付、CI 与 C7 终止证据见 [完成评论](https://github.com/12bitsD/agent4novel/issues/20#issuecomment-6090215524)。本页完成审核字段保留发布前快照，其 pending 表述不代表当前票态。后续修改继续继承当前 pending beat、A/B/C、显式通过和 unknown readback 边界，针对新候选重跑相应验收；#21 的通过后章节重生与 #18 的产品设计另行对齐。
