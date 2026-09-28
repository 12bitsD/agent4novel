---
wiki_id: "022"
ticket: 22
ticket_state: done
context_state: current
summary: "第一章正文生成、服务端自动保存、整章重写、同版通过及通过后编辑；首章结束。"
topics: ["prose", "human-review", "autosave", "conditional-write", "agent-observability"]
code_paths: ["packages/contracts/src/prose.ts", "packages/contracts/src/prose-submission.ts", "apps/server/src/steps/prose-step.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts", "apps/web/src/pages/ProseReview.tsx", "apps/cli/src/commands.ts"]
symbols: ["ProseContent", "ProseSubmission", "recoverProseSubmission", "regenerateProse", "save-prose", "awaiting-prose-review", "prose-approved"]
inherits: ["005", "013", "014", "016", "025"]
changed_by: []
read_when: ["implement-prose", "review-prose", "debug-prose-submission", "change-prose-autosave", "continue-chapter"]
last_context_reviewed: "2026-09-29"
---

# 022 — 第一章正文生成、编辑、整章重写与通过

## Agent Context

- **读取时机**：实现或排查第一章正文、服务端自动保存、通过后编辑、全文重写、同版通过、未知提交与 CLI 正文命令。
- **原始目的**：由作者最终通过的章纲和设定写出正文，让作者直接修改或重写后独立把关；WHAT/AC 看 [#22](https://github.com/12bitsD/agent4novel/issues/22)。
- **实际落地**：已接通真实/fake Prose Step、六步生产链、HTTP/Web/CLI 保存与审阅；完成状态、刷新及书架重入均可读回。2026-09-29 回读 #22 已关闭；发布与终止核验结果见 [完成评论](https://github.com/12bitsD/agent4novel/issues/22#issuecomment-5875092744)，本页保留当次发布前审核证据。
- **当前价值**：继承 #5 的按章身份、条件写入、冻结请求与保守恢复；正文自动保存到服务端、刷新恢复，approved 默认阅读且可显式进入编辑，保存保留 approved。旧页内草稿/只读假设的变化原因见“上下文演进”。
- **后续变化**：首章闭环已交付，完整 MVP 尚未完成；下一票按既定排期对齐 #19，再推进 #9/#6，#7/#8 仍须交付。设定检索 tools [#28](https://github.com/12bitsD/agent4novel/issues/28) 与作品 Wiki 异步更新 [#29](https://github.com/12bitsD/agent4novel/issues/29) 保持后置待 triage。当前进度及验证边界统一见 [交接快照](../handoff.md#当前里程碑与验证边界)。
- **代码入口**：先看共享正文契约及提交恢复，随后对应 Step/Pipeline、HTTP、Web 和 CLI。当前形状最终维护于 [schema](../schema.md)。

## 设计目的

用真实可运行的纵向切片完成第一章正文，而非仅注册一个生成函数。作者看到、自动保存和实际通过的全文必须一致；新生成、重写均 pending，失败保留正文与意见。正文通过后默认阅读，作者可显式进入编辑，自动保存保留 approved。2000–4000 字仅为写作软目标。

## 起始上下文

#5 已提供 Beat 关卡、按章寻址、UUID、共享生成锁与条件追加；Setting/Beat 提供同版本原子定稿、冻结与结果对账。本票起始时生产止于 Beat，worker/读模型/日志/Web/CLI 各有 Beat 专用分支，均须明确接线。Store 已有泛用 append/finalize，不新增存储抽象。

架构继承 [ADR0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md)、[ADR0002](../adr/0002-storage-sqlite-skills-as-files.md)。本期仍是进程内 WorkStore；不能称跨重启持久化。

## 技术方案

### 本轮范围与对齐

本轮最新 Human 决定是先完成 #22，并将设定检索 tools 与作品 Wiki 扩展留给 #28/#29。#22 保留两个 Step/关卡、当前编辑文本参与重写、失败保护和只到第一章的边界；最终实现遵循以下边界：

- 正文内容 `{text:string}`，章标题继承已通过 Beat；纯文本显示，保留空白与段落，不渲染 HTML。
- pending 正文编辑后自动保存到服务端；刷新从服务端最新 head 恢复已确认保存的全文。自动保存对象是正文，不把只存在页面内的文本标成已保存；未确认保存、保存失败或冲突时保留当前编辑并显示真实状态。服务器仍为进程内 Store，刷新恢复不等于跨服务重启持久化。
- approved 正文默认阅读，点击“编辑”进入可修改状态；自动保存追加版本并保持 approved，不重新要求通过。approved 空白正文不保存，保留最后一个有效已通过版本及当前未保存编辑。
- Beat 使用明确按钮“通过章纲并生成正文”，成功通过后衔接一次正文生成；首次打开或刷新 ready 页面只提供手动生成。正文通过即第一章完成，本票没有“下一章”或继续 advance 的入口。
- 通过请求提交全文，保留目标 id/version/createdAt；重写成功追加新 pending，不能改 Beat。重写意见不属于 save 请求；带意见通过时提示意见未参与生成。
- 作品 Wiki 异步更新仅记 TODO #29，设定检索 tools 留给 #28；两票后置待 triage，不作为本票实现、验证或关闭的前置条件。

此前外部方案 SHA-256 为 `22be8115eae9322c7ba23166e20c6cacdab4e60100cac9d043eec7ed3b010331`，只用于追溯旧草案及其证据。最新 Human 决定改变了保存与通过后编辑边界；受影响计划、测试和候选 review 均须重新收口，旧方案记录不充当本轮验证结论。

### 生成与命令边界

生产第六步为 prose#1，消费最终 approved beat#1 和完整 setting。模型输出 `{text}`，真实/fake 复用 schema；生成及已通过正文非空但不 trim 保存值。pending 编辑可以暂时为空并保存或用于重写；空白正文不能通过。首次生成和重写均在最终 append 时核验目标及全部前置 approved head；通过用 finalize 原子写全文和状态。共用 per-work 生成锁与条件写入，禁止通用 approve/setStatus 绕开正文命令。

专用 HTTP 保留 `POST /api/works/:id/artifacts/prose/approve` 和 `/regenerate`，新增 `/save`。approve/regenerate 请求包含 chapter=1、expectedArtifactId、expectedHeadVersion、content，重写另含 instructions（可空）。save 请求另要求 `expectedHumanStatus: pending | approved`：

- 保存原子追加新 id、下一 version，状态必须与预期 head 的状态相同；pending 允许空文，approved 要求有效非空全文。
- head 身份、版本或状态任一变化均拒绝保存；在作者通过后抵达的旧 pending autosave 不得追加回 pending，也不得覆盖 approved。
- 保存是 `save-prose`，不调用模型，attemptIds 为 `[]`；通过仍为 `approve-prose`，同 id/version/createdAt 定稿；重写为 `regenerate-prose`，成功追加 pending。
- Workflow 的 pending actions 为 `save-draft`、`approve`、`regenerate`；approved 只提供 `save-draft`。Web 用本地阅读/编辑状态实现显式编辑，不通过改变 humanStatus 打开编辑器。

这些命令沿用 ProseCommandResponse、requestId、真实 attemptIds、阶段和 writeOutcome；advance 的 proseCommand 诊断保持与旧 Beat 协议兼容。日志仅记录安全身份、长度、hash 与分类，不输出正文、意见或 provider raw。保存、通过和重写必须共享当前 head 的条件写入约束；Web 在执行通过/重写前处理在途自动保存，避免使用已被保存替换的旧 head。

资源预算：正文 100000 JavaScript 字符单位、意见 10000、写命令 body/CLI 文件 1 MiB，实际组装 system+prompt 400000 字符，模型输出初值16000 tokens、SDK maxRetries=0。预算超限在模型前拒绝，结构上游不截断；这不是模型容量或质量保证。独立实验文件仍遵守自身入口预算。

### 结果恢复

通过成功响应或 GET 精确匹配冻结提交才能确认成功；匹配作品、kind、章、身份、版本、时间及逐字符全文。保存的恢复规则是：有效成功响应，或回读为基线的精确下一版本、新身份、相同 humanStatus 且逐字符全文一致，才可确认本次保存；更远版本或内容/状态不一致均按冲突处理。重写只能由与提交基线绑定的有效成功响应确认，GET 新版不足以证明来源。

unknown 后保留冻结全文/意见，最多自动回读一次；旧 unknown 不因后来 not-committed、空日志或原 pending 回读而消失。冲突需作者明确载入服务器版本，不自动覆盖或把当前文本套在新版本上。按 prose head 保持单调读取，自动保存按作品和编辑次序协调，防止迟到响应降级 head 或清除较新的未保存编辑。页面刷新只承诺恢复服务端已确认保存内容，不能把在途未知保存当作完成。

既有通过30秒、重写920秒、对账GET10秒、advance1820秒的客户端 deadline 包含响应体读取；save 同通过使用30秒完整响应期限，失败最多自动回读一次，不自动 POST 重试。客户端 abort 仅结束等待，服务端可能仍提交，不声称 exactly-once 模型执行。

### 实施计划

固定点为 main `7a57d48aa50ced5c79ca4bc26cc9a424322f0a6f`；source `feat/22-prose-review` → PR → main。#5 CLOSED且原生open blocker为0；已claim `12bitsD`，标签`ready-for-agent`，未加入Project。完成保持标签/assignee/原依赖，Project N/A；远端无保护/ruleset/CI（发布再回读）。用户现有开发/交付授权覆盖本票，源分支在首个本票commit之前建立，工作区起点干净。本票代码与知识作为一个完整纵向逻辑提交，经精确候选审查后发布。既有公共测试接缝为 Step、Pipeline/Store、HTTP、CLI 可执行入口和 mounted Web。2026-09-29 的保存/编辑决定保留既有未提交实现，并补齐以下切片的 RED→GREEN。以下映射对照 #22 当前 AC，原始计划及旧评审只作历史证据。

| 切片 | RED→GREEN 的可观察结果 | AC |
|---|---|---|
| S1 | 严格正文内容/请求/结果契约；save 的状态前置条件与下一版精确恢复；pending 空文可存、approved 空文拒绝；unknown 重写不可按新 head 确认 | AC6、AC8、AC9 |
| S2 | 真实/fake Step与worker消费最终Beat/Setting、当前文本/意见；预算前拒绝；坏输出不落库 | AC1、AC2、AC4、AC6 |
| S3 | 六步生产链，Beat pending阻断；修改通过后正文消费真实内容；停于正文pending；前置变化拒绝append | AC1、AC2、AC5、AC6 |
| S4 | HTTP save 原子追加新 id/v+1 并保留状态，迟到 pending 保存不得覆盖 approved；人工同版通过、重写追加 pending 且 Beat 不变；共享锁/CAS/写后异常 unknown；测试专用 Prose 下游 pending 阻断、approved 消费逐字符人工文本 | AC3、AC4、AC6、AC8、AC9 |
| S5 | Web pending 自动保存与刷新恢复，approved 默认阅读/显式编辑/保存保持 approved；在途保存与通过/重写协调，失败保留、冲突及 unknown 恢复、作品隔离与迟到响应；Beat 明确按钮只衔接一次、刷新不自动生成、无下一章入口 | AC3–AC6、AC8–AC11 |
| S6 | CLI 严格帮助与全文保存/通过/重写命令；loopback 完整 smoke 至 prose-approved；已通过编辑保存后仍计完成一章，最终全文回读，无 chapter2，pending 不计完成章数 | AC2、AC3、AC5、AC6、AC8、AC9 |
| S7 | 全仓门禁、真实Step样例与证据边界、知识同步、三轮校准、独立双轴及attestation、PR/merge/关闭回读 | AC7 |

## 代码落点

最终代码入口：contracts/prose* 是内容、命令及恢复的共享入口；server/prose-review 与 prose-command 管保存、定稿及诊断，steps/prose* 管生产与实验；Pipeline、routes、Store 和 start 装配；Web ProseReview + reducer/API；CLI 文件命令和 smoke。具体导出以代码为准，不在 Wiki 复制类型全文。

## 测试与验证

自动化按 Step、Pipeline/Store、HTTP、可执行 CLI、mounted Web 和 App URL 接缝验证。原始日志位于本地 `/Users/user/Documents/Codex/2026-09-28/agent4novel-mvp/`，下列文件名均相对此目录；仓库内可重复执行的测试是长期证据入口。

| 验收 | 可重复的代码/测试入口 | 本轮结果 |
|---|---|---|
| AC1 | `prose-pipeline.test.ts`、`prose-step.test.ts` | pending Beat 阻断；最终 approved Beat/Setting 输入；前置变更不追加 |
| AC2 | `prose-step.test.ts`、`prose-cli-integration.test.ts`、`Workspace.prose.test.tsx` | real/fake 接线、按章保存、pending 展示 |
| AC3 | `prose-routes.test.ts`、`prose-pipeline.test.ts`、`Workspace.prose.test.tsx` | 逐字符人工全文通过、下游消费；同版 finalize |
| AC4 | `prose-routes.test.ts`、`prose-step.test.ts`、`prose-review.test.ts` | 当前草稿/意见参与重写；成功 pending，失败保留；Beat 不变 |
| AC5 | `prose-cli-integration.test.ts`、`Workspace.prose.test.tsx` | prose-approved、完成一章、无第二章自动生成 |
| AC6 | contracts `prose*.test.ts`、HTTP/CLI/Web 测试 | 错误分类、CAS、共享锁、响应丢失与 body deadline |
| AC7 | 本页审核证据及远端 PR/issue | 发布前审核见下表；交付终态见 #22 完成评论及 live issue |
| AC8–AC9 | `prose-save.test.ts`、`prose-routes.test.ts`、`Workspace.autosave.test.tsx` | 自动保存、状态绑定、空文边界、在途编辑、冲突与回读 |
| AC10 | `App.prose.test.tsx`、`Workspace.prose.test.tsx` | 稳定 `?work=<id>` 重入、切换隔离、刷新不发模型请求 |
| AC11 | `Workspace.prose.test.tsx` | 合并按钮一次衔接；通过回包丢失恢复；生成失败可重试 |

RED/GREEN 按切片保留：`prose-s1-content-*` / `prose-s1-recovery-*`、`prose-s2-{fake,worker,budget,experiment}-*`、`prose-s3-{generate,review,response}-*`、`prose-s4-{request,approval,response,classification,advance-response}-*`、`prose-web-{approval,transition,isolation,reconcile-transition}-*`、`prose-cli-{discovery,command}-*`。新增保存语义由 `prose-save-contract-{red,green}.log`、`prose-save-http-{red,green}.log`、`prose-save-cli-{discovery,command,file,smoke}-{red,green}.log`、`prose-autosave-web-{red,green}.log`、`prose-approved-edit-web-{red,green}.log` 和 `prose-reopen-web-red.log` 对应；最终 Web GREEN 为 `prose-web-autosave-suite.log`。中间 assertion/命令 reporter 错误仅保留诊断，不作为成功或目标 RED 证据。

2026-09-29：`pnpm test`、`pnpm typecheck`、`pnpm build` 均成功（`prose-final-{test,typecheck,build}.log`）。build 保留现有 docx 约504.5 KB chunk 警告，没有扩票优化。测试不调用真实 provider。

真实验证用隔离 loopback fixture，**前五步为 fake，仅 Prose 使用 LongCat-2.0**；合成素材 CLI smoke 完成生成、pending 编辑保存和通过，回读 prose v2 approved。唯一真实模型调用约50.3秒，输入801/output1795 tokens，`finishReason=stop`；只验证工程契约与流程，不宣称长篇质量。浏览器又编辑已通过全文，保存为 v3 approved，刷新与书架重入仍为完成一章；再次编辑保存为 v4 approved 并保持编辑器打开；返回/编辑入口在 IAB 语义点击偶有不生效时用截图坐标完成。证据 `prose-live-smoke.json`、`prose-live-telemetry.json`、`prose-live-after-browser.json` 和 `prose-browser-acceptance.md`。原生 beforeunload 对话框未作浏览器人工确认；mounted handler 覆盖 dirty 保护。

以下“完成审核证据”保留 #22 当次发布前候选的原始记录，其中 AC7 待发布、后续终止核验等描述按当时时点理解。后续发布结果只链接 [完成评论](https://github.com/12bitsD/agent4novel/issues/22#issuecomment-5875092744) 与 live issue，不改写原始审核结论。

### 完成审核证据

本段是 C6.3/C6.5 预先声明的唯一受控证据字段；review 后实质事实变更必须回到 C5。

- **清单与候选**：清单 blob `db7f3eda6bce154b99e2ed67f50072465e9e2be0`；固定点 `7a57d48aa50ced5c79ca4bc26cc9a424322f0a6f`；source `feat/22-prose-review` → PR → main。T0：`c926449e544ec3144aa764853c1f6169e1fc0530`；T1：`8fa6846cd80811cce756a50049ed4805a229d565`。精确 manifest：`prose-candidate-manifest.txt`，72文件，固定点到候选3189新增/221删除行；完整patch及hash见`prose-candidate-audit.json`；代码与知识为一个纵向逻辑提交，无本票中间 commit。
- **逐项判定**：C1 = PASS：C1.1/C1.8 由 `issue22-pre-review.json` 及原生依赖回读（blocked by closed #5，blocking #6/#8，标签 ready-for-agent、assignee12bitsD 保留，Project 空）作证；C1.2/C1.6 由本页固定点/source、分支记录及远端 main 同 SHA、无保护/ruleset 作证；C1.3/C1.5/C1.7 由 Human 2026-09-29 决定、本页切片及 #22 当前 AC 作证；C1.4 由 schema、CONTEXT、ADR 及最小相关 Wiki 核对作证。C2 = PASS：C2.1–C2.3 见上述 RED/GREEN 及最后完整门禁；C2.4 复用现有 Step/Pipeline/Store/共享契约，没有新存储/调度层；C2.5 见 AC1–AC11 映射。C2.6 = N/A（所有切片都有行为变化，非纯文档票）。C3 = PASS：C3.1/C3.6 见最终门禁日志及日期；C3.2 见 manifest、完整 diff 和 whitespace 审计；C3.3/C3.4 见 `prose-security-audit.txt` 与安全诊断测试；C3.5 质量核对见下。C4 = PASS：C4.1/C4.2 本页当前上下文和证据；C4.3 schema 已更新，CONTEXT N/A（正文/章纲术语未变）；C4.4 ADR/research N/A（继承既定单进程、Step、文件 SP 架构，无新外部选型）；C4.5–C4.7 文档/运行 skill 已同步；C4.8 结构、索引、issue backlink/本地链接/SVG 与双语事实校验；C4.9 见三轮自校准。C5 = PASS：C5.1–C5.3 由 `prose-candidate-manifest.txt`、`prose-candidate-audit.json`、完整patch与空本地历史，以及独立Standards完整审计作证；C5.4/C5.5 见隔离双轴原始报告；C5.6 下方记录P3处置及Spec的AC7待发布边界；C5.7 无实质候选变化，两轴均针对同一T0。C6.1 = N/A（双轴未发现需要修复的行为或文档缺陷，仅有可选P3测试健壮性观察；保留风险如下）。C6.2 = PASS（无实质修复，复核tree与最终门禁一致，独立Web19测试通过）。C6.3 = PASS（本段忠实转录原始报告及C1–C5证据；本次C6.5前T1/裁决保持pending）。C6.4 = PASS：独立reviewer `/root/beat_close_audit` 的 `prose-attestation-t1.md` 与机械证据 `prose-attestation-t1-checks.json` 确认T0→T1仅本预留证据段、段外逐字不变、转录忠实；以已审T0及精确差异核对T1完整候选，空本地历史、72 staged且无unstaged/untracked余项、index/worktree吻合T1，whitespace checks全通过。
- **验收与 TDD**：AC1–AC11 与 S1–S7 映射见上表。上游 fake + 真实正文 CLI、浏览器已通过编辑/刷新/书架重入、最终 v4 approved 的验收见 `prose-browser-acceptance.md`。原生 beforeunload 对话框人工操作 N/A（IAB 工具限制；mounted handler 已覆盖，有真实浏览器提示差异的剩余风险）。旧草案评审及中间运行错误不计新行为通过证据。
- **本地门禁**：2026-09-29 `pnpm test`、`pnpm typecheck`、`pnpm build` PASS，分别 `prose-final-test.log`、`prose-final-typecheck.log`、`prose-final-build.log`；本次完整测试510项（只作运行快照）。`git diff --check` PASS；无独立 lint/format script，C3.2 的工具部分 N/A（以 tsc、diff whitespace 与代码审查覆盖，不能声称已运行不存在的工具）。`.env.local` ignored，所有改动及新增文件无现有凭据匹配，无新增 symlink/lockfile/生成物。正文/意见纯文本；模型输入/输出经 schema、长度及 body 预算；异常与 telemetry 只含安全分类/身份/hash/长度，不写正文、完整 prompt 或 provider raw。真实调用只有 Prose 一次，不冒充六步全真模型。build 的既有约504.5 KB docx chunk warning 保留。
- **双轴 review**：Standards `/root/beat_close_audit`（只读辅助`standards_docs`）与独立只读 ephemeral Codex Spec 进程均未参与实现，彼此未消费对方结论；两轴对T0均PASS。原始报告为 `prose-standards-review.md`、`prose-spec-review.md`。Standards：0阻断/0硬规则违规/1可选P3；Spec：0实现缺失/0扩票，AC1–AC6及AC8–AC11满足，AC7完整交付证据待C6/C7完成，不能据本地review提前宣称已关闭。独立Standards追加Web四文件19测试PASS，`prose-standards-independent-web.log`；作者完整门禁只回读而未冒称由reviewer重跑。
- **修复与回归**：当前目标行为均已 GREEN；未作review后实质改动。Standards的可选P3（`apps/cli/test/prose-cli.test.ts:12`，fetch回调内的正文expect可能被预期网络错误恢复吞掉）属真实测试健壮性观察，接受为剩余风险；可后续将断言移到命令返回后。本票不依赖该单测证明全文传递，`apps/server/test/prose-cli-integration.test.ts:69–72,81–86` 已经从真实可执行CLI→HTTP核对逐字符通过和保存，因此不影响AC6，未把观察错误标记为“已修复”。C3.5：复用公共契约/recovery 和既有 Store 接缝；Prose reducer 与 Step 分开 UI/模型职责；CLI 及 HTTP 的边界校验统一依赖 contracts。票内保持显式正文流程以便审阅，跨产物重复协议治理留 #19。自动保存600ms debounce、同一在途命令串行，保存不调用模型，失败不自动重发。C4.9 三轮自校准：① Step/Store/HTTP/Web/CLI 行为对照最终测试和真实验收，一致；② 当前保存/审批/恢复边界已同步 Wiki/schema/双语README/skill/handoff，原始范围动机保留在变化事件；③ 全候选逐条映射 AC1–AC11，#28/#29/#9/#6 未夹带实现，不联动关闭。
- **知识维护**：更新 Wiki022/索引及直接前置005/013/014导航、schema、双语README/四张图、handoff、canonical drive skill。CONTEXT N/A（无新术语）、ADR/research N/A（无新不可逆架构/外部选型）、其他 docs/agents N/A（交付规则未变）。保留既有意图、Human决定、失败恢复rationale；replace 当前终点和操作说明，compact 中间实验记录为可追溯证据路径。
- **发布前裁决**：2026-09-29，独立reviewer `/root/beat_close_audit` 对T1给出 **PASS**；未参与实现，原始报告 `prose-attestation-t1.md`。C1–C5分节均PASS，N/A与例外按上文逐项列明；C6.1–C6.4按上文证据收口。C6.5后最终证据差异仍须终止核验，后续结果留外部记录及GitHub完成评论，不写回本候选。剩余风险包括上述可选P3及原生beforeunload人工验证边界。其余边界：内存 Store/单进程、只有首章、返回日志保留窗口；context仍输入完整已通过设定，设定检索 #28/作品Wiki #29 待后续对齐；已通过编辑尚无异步Wiki更新。正式质量/SP迭代及跨重启恢复不在本票验收结论内。

## 边界与非目标

本票范围包含首章 pending 自动保存与刷新恢复、人工同版通过，以及 approved 正文默认阅读/显式编辑/自动保存保持 approved。仍只到第一章，不生成第二章，不提供下一章入口；不做局部 AI 改写、章纲回流、版本比较、SQLite 或全仓契约治理。内存/单进程和日志窗口限制继承；服务重启后的恢复由后续存储票处理，上游重新通过后不承诺已有下游自动语义一致。

设定检索 tools TODO [#28](https://github.com/12bitsD/agent4novel/issues/28)、作品 Wiki 异步更新 TODO [#29](https://github.com/12bitsD/agent4novel/issues/29) 均为后置待 triage 扩展，不阻塞 #22；本票不实现两者，也不宣称正文变更已同步作品 Wiki。

## 上下文演进

### 2026-09-28 — 恢复第一章正文的独立交付

- **触发证据**：用户要求继续开发并关闭MVP；#22已从#5拆分，章纲实现已合并。
- **原假设**：原合票覆盖第一章全部链路，拆票后正文仍未落地。
- **决定**：保留独立Step/关卡，以当时共享写入和恢复边界接通Web/CLI；采用当时的页内暂存与通过后只读默认，后由下方 2026-09-29 事件取代。
- **影响**：生产终点计划由beat-approved延伸至prose-approved；旧五步测试定义仍保留自身终点，不把测试consumer当第二章实现。
- **上下文处理**：preserve #5的人工作出的拆票与固定章纲决定；本页新增正文工程上下文，后续#19/#9/#6继续独立交付。

### 2026-09-29 — 按 Human 决定加入服务端自动保存与通过后编辑

- **触发证据**：用户重新对齐排期和交互后要求先完成 #22：pending 正文自动保存到服务端并在刷新后恢复；approved 默认阅读，点击编辑后可以修改，自动保存仍保持 approved。用户同时将设定检索 tools 与作品 Wiki 拆为后置的 [#28](https://github.com/12bitsD/agent4novel/issues/28) 和 [#29](https://github.com/12bitsD/agent4novel/issues/29)。
- **原假设**：2026-09-28 草案为缩小首章交付范围，采用“草稿仅当前页面内存，刷新丢弃”和“正文通过后只读”的 Agent 默认；它们不是旧 Human 决定，也不能覆盖本轮明确指示。
- **决定**：新增有 head 与状态前置条件的全文 save 命令；pending 和 approved 保存都追加新身份及下一版本并保留原状态，approved 空文拒绝。通过仍同版 finalize。Beat 按钮明确为“通过章纲并生成正文”。作品 Wiki 异步更新记为 TODO #29，本票仍止于首章。
- **影响**：共享契约、Store/HTTP 条件写入、提交恢复、Web 阅读/编辑及 CLI 保存路径均须按新计划实施和验证；迟到 pending 保存不得覆盖已通过正文，过时版本不得自动覆盖当前编辑。旧计划和其验证记录不能替代本轮受影响接缝的新证据。
- **上下文处理**：preserve 旧草案的范围动机及原始首章、独立关卡决定；replace 本页当前摘要、保存/编辑计划、验收切片和非目标。#28/#29 仅作为后续扩展入口，尚未改变本票可执行事实，不加入 changed_by，也不构成 #22 完成依赖。

### 2026-09-29 — 首章交付后的 MVP 状态收敛

- **触发证据**：用户询问 MVP 是否跑通，并要求更新 Wiki 与 context；GitHub 回读 #22 CLOSED、#1 及 #19/#9/#6/#7/#8 OPEN。
- **原假设**：发布前文档把 #22 保持为 active，并将“完成首章”列作下一步；继续沿用会让接手者重复交付已关闭票，也容易把首章验证扩大为完整 MVP 验收。
- **决定**：本页状态改为 done，下一步指向 #19 的独立范围对齐；明确首章闭环已跑通、完整 MVP 尚未完成。本次真实模型证据仅覆盖 Prose，上游五步为 fake。
- **影响**：更新本页当前入口、交接结论和项目进度导航；后续仍须完成持久化、续写、配置、坏例及最终联验。#28/#29 保持后置扩展，不因本次文档更新开工或关闭。
- **上下文处理**：preserve 原始目的、Human 决定、失败边界和发布前审核证据；replace 已漂移的票面状态与下一步描述。整体进度留在 handoff，WHAT/AC 与远端交付记录继续链接 GitHub，不改变知识归属。

## 交接结论

首章正文已交付，#22 无需重新开工；接手先读 [完成评论](https://github.com/12bitsD/agent4novel/issues/22#issuecomment-5875092744) 和 [当前里程碑](../handoff.md#当前里程碑与验证边界)。正文自动保存，approved 默认阅读且允许显式编辑后保持 approved；不要沿用“仅页内草稿”或“approved 永久只读”的旧假设。

运行事实可由共享契约和 HTTP/Web/CLI 测试复核。fake 首章全链路与真实 Prose 节点均已有验证，但不是全链路真实模型或长篇质量验收。不能假定支持跨服务重启、第二章或作品 Wiki 自动更新。按父 #1 既定排期先对齐 #19，再逐票推进；#28/#29 保持后置扩展。
