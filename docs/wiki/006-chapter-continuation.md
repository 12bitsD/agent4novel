---
wiki_id: "006"
ticket: 6
ticket_state: active
context_state: current
summary: "后续章显式推进、上一章承接、跨章阅读与编辑隔离；交付状态以 issue 为准。"
topics: ["chapter-continuation", "human-review", "upstream-snapshot", "chapter-navigation"]
code_paths: ["apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts", "packages/contracts/src/artifacts.ts", "apps/web/src/pages/Workspace.tsx", "apps/cli/src/commands.ts"]
symbols: ["startChapter", "currentChapter", "previousChapter", "needsContinuityReview", "start-chapter"]
inherits: ["022", "005", "004", "014", "025"]
changed_by: []
read_when: ["continue-chapter", "navigate-chapters", "edit-previous-prose", "debug-chapter-context"]
last_context_reviewed: "2026-09-29"
---

# 006 — 后续章续写与跨章创作

## Agent Context

- **读取时机**：实现或检查第二章及后续章推进、跨章阅读、旧章编辑与上游版本变化。
- **原始目的**：让已完成首章的作品继续逐章创作，同时保留各章独立关卡；WHAT/AC 以 [#6](https://github.com/12bitsD/agent4novel/issues/6) 为准。
- **实际落地**：显式起章、可重复的章纲/正文双关卡、上一章输入、章节目录与链接重入、历史正文编辑和衔接提示均已实现；交付状态以 issue/PR 为准。
- **当前价值**：继承 #22 的正文自动保存、通过后显式编辑、冻结提交与未知结果恢复；把工作进度和当前阅读的章节分开。
- **后续变化**：#6 先于 #19 契约治理和 #9 SQLite；#7 配置及 Docker/CI 方向留到该票开工对齐，#8 仍为 MVP 项；#28/#29 长期记忆和 Wiki 扩展保持后置。
- **代码入口**：Pipeline 负责章节循环和实际依赖快照，Store 原子条件写入；公共协议供 HTTP/Web/CLI 使用，Step 接收明确的上一章内容。

## 设计目的

首章完成后，作者能显式开始下一章，经章纲把关、正文把关后再决定是否继续。旧章可以阅读和编辑正文，当前章的生成、编辑和响应不能因为阅读选择变化而串到另一章。书架、刷新与章节链接只恢复阅读，不调用模型。

## 起始上下文

实现起点为 `7bce2028e2bd7a4eae22d548584baeba2d4c4626`，即 main 上已交付的 #22 加已推送的 README/Wiki/context 维护。原 checkout 的 `feat/mvp-context` 与 PR #31 保留，独立 worktree `/Users/user/.codex/worktrees/chapter-continuation/agent4novel` 使用 `feat/6-chapter-continuation`。

2026-09-29 回读：#6 OPEN，`ready-for-agent`，已 claim `12bitsD`；原生依赖只有已关闭 #22，Project “agent4novel Development” 为 Backlog。main 为 `391d0fbc986c781c7dec9982111ed1183c7c9713`，无 branch protection、ruleset 或 CI。交付以工作分支 PR 为边界，最终合入 main；PR #31 文档基线在发布前按实际远端状态核对，不能把继承的文档提交漏出完整 diff 审计。没有额外的人工作业要求，当前授权为开发本票与逐票推进；不批量关闭关联票。完成标签、assignee 与 Project 字段保持原值，除非其间取得明确新决定。

Store 已按 `(kind, chapter)` 分桶，各章独立版本；限制主要在 Pipeline 一次性六步定义、Step 输入及客户端固定首章。大纲是弧线/剧情点，不预定章数，因此章号不映射剧情点数组索引。原首章谱系只写运行日志；本轮衔接提示需要生成输入版本的可回读依据，新增轻量身份引用，不保存第二份输入正文。

## 技术方案

### 已对齐的产品边界

1. 全部中间产物可查看；待把关产物沿用原编辑规则，已通过正文可显式编辑并保留 approved；已通过章纲与设定保持只读。
2. 下一章章纲消费完整已通过大纲/设定、上一章章纲与最新已通过正文，由模型拟下一章计划、作者把关。前章实际正文优先于计划；不把一个剧情点强制等同一章。本期不实现长期历史记忆或 Wiki 检索。
3. 旧章修改保留后章内容和状态，并提示检查衔接；新生成读取最新实际输入。生成中上游变化时拒绝提交过期结果，允许用户重试。没有自动级联重写、重审或 Wiki 更新。

### 章节命令与读模型

采用 `POST /api/works/:id/chapters/start`，请求显式携带 `{chapter, expectedPreviousProseId, expectedPreviousProseVersion}`，目标章至少为 2；只有上一章正文通过且基线匹配时生成该章章纲。目标号固定，合法请求重放只读已存在目标的当前工作状态，不重新判定旧基线，不生成更后一章，也不覆盖已有目标。返回沿用 `AdvanceOutcomeDto`，消费方同时检查 HTTP 与业务 outcome。

`advance` 继续推进当前工作章，正文通过后停在该章完成态；启动下一章是独立命令。Pipeline 复用同一套 Beat/Prose Step 与生产锁、提交时 CAS，不复制无限多份定义；旧一次性定义保持可用。

WorkView 提供 `currentChapter` 和 `chapters` 摘要（章号、标题、Beat/Prose 状态、章级 actions、衔接检查提示），Web 选择的章节仅控制阅读。稳定链接使用作品及章号，客户端不从“目前正在看哪章”推导服务端推进位置。

Web 把传输失败和 HTTP 200 中 `writeOutcome:unknown` 都按未知结果保护。起章保留原目标/前章基线，最多自动回读一次，再由作者显式核对或重试冻结请求。当前章首次生成未知时记住原产物类型和章号，禁止切章及再次 advance；显式 GET 看到原目标后才恢复，未见目标不能证明未写入。作者仍可通过既有离开确认放弃本页等待，提示已发请求可能继续处理；没有轮询或自动重放。

### 输入与衔接版本

后续章 Step 的 `upstream.previousChapter` 为 `{chapter, beat, prose}`，必须恰为目标前一章；第一章不接受伪造的前章。Beat 另有 outline/setting，Prose 另有本章 beat/setting。结构化输入有界，超预算在模型前拒绝，不静默截断正文或大纲。

生成产物可携带 `inputs` 身份/版本引用，保存、定稿继承其生成依据。读模型比较当前上游及其衔接状态，显示 `needsContinuityReview`；它是提醒，不改变后章 humanStatus，也不宣称模型已理解或修复差异。当前 schema 以 [数据模型](../schema.md) 为准，具体校验由共享契约和 Store 执行。

### TDD 切片与提交边界

| 切片 | 可观察行为与验证面 | AC |
|---|---|---|
| S1 | 任意合法章号、前章输入和命令/响应 schema；非法章号、缺前章、错前章拒绝 | AC2、AC6、AC8 |
| S2 | 多章 Pipeline、两章双关卡与第三章重复推进；前章改动传递、重放/并发不跳章、输入过期不落库 | AC1–AC3、AC5、AC6 |
| S3 | 跨章读模型、已通过历史正文保存、输入引用与衔接提示，状态不被静默回退 | AC4、AC5 |
| S4 | Web 目录与 URL 重入、全层查看、显式续写、autosave 切章与迟到响应隔离 | AC3–AC5、AC7 |
| S5 | CLI help/文件契约与 run-step；可执行 CLI → HTTP 两章并回读第一章 | AC8、AC9 |
| S6 | 完整本地门禁、fake/browser 验收与有边界真实节点验收、知识回写、独立 review 与发布核验 | AC9、AC10 |

代码、测试和对应知识组成一个可审查的纵向候选；提交前审查精确 manifest，最终候选独立执行 Standards/Spec 与 attestation。子代理按 backend/contracts、Step/CLI、Web 分工，互不修改拥有范围外文件；主代理维护票面、文档与集成验收。RED/GREEN 原始输出暂存 `/tmp/a4n-6-evidence/`，最终证据在审核前汇总到下方。

## 代码落点

| 入口 | 职责 |
|---|---|
| `packages/contracts/src/artifacts.ts`、`beat/prose-command.ts`、`beat/prose-submission.ts` | 起章请求、章目录、输入引用、任意章号及恢复响应绑定 |
| `apps/server/src/pipeline/pipeline.ts` | `repeatChapters`、`definitionFor`、`startChapter`、实际输入与提交时前置条件；生产启用、旧定义默认关闭 |
| `apps/server/src/chapter-view.ts`、`routes/works.ts` | 当前工作章与逐章动作、版本变化提示传播、4 KiB 起章 HTTP 边界 |
| `apps/server/src/store/`、`beat-review.ts`、`prose-review.ts` | 按章身份、快照隔离、历史 approved 保存、保留生成输入引用 |
| `apps/server/src/steps/chapter-context.ts`、`beat/prose-io.ts`、`beat/prose-step.ts` 及对应 SKILL | 严格前章校验、400000 字符总输入预算、正文优先于计划的承接提示 |
| `apps/web/src/pages/Workspace.tsx`、`ReferenceMaterials.tsx`、`App.tsx` | 目录、只读资料、作品/章号 URL、按章会话隔离、冻结起章请求及有限回读 |
| `apps/cli/src/{client,command-line,commands,main}.ts` | `start-chapter --file`、任意章读写、严格帮助/文件输入、诊断章号 |

复用既有 Store 原子条件写入、冻结提交、共享响应绑定和独立 Step worker；没有加入第二套状态机或自动重试机制。章节读模型不改变审批状态，Web 的阅读选择不作为服务端生成位置。

## 测试与验证

2026-09-29 本地验证，证据目录 `/tmp/a4n-6-evidence/`（临时原始输出；可复跑入口随代码版本化）。

| 范围 | 命令/入口与结果 |
|---|---|
| 契约/状态机 RED→GREEN | `core-red-targeted.log` → `core-green-initial.log`；`core-response-red.log` → `core-response-green.log`，覆盖写成功但响应构造失败的 unknown 语义 |
| Step/CLI RED→GREEN | `steps-red.log`（6 项目标缺失）、`cli-red.log`（4 项目标缺失）→ `steps-green.log`、`cli-green.log`；`step-cli-green.log` 验证独立 worker 和 HTTP CLI |
| Web RED→GREEN | `web-red.log`（6 项目标缺失）、`web-start-rejection-red.log`、`web-late-approval-red.log` → `web-green.log`；定向覆盖 409 与未知起章、迟到批准不触发其他章生成 |
| review 修复 RED→GREEN | `review-fixes-red.log`：起章 HTTP200 unknown 与正文初次生成未知两项断言失败；`review-fixes-green.log` 与 typecheck 通过，覆盖冻结请求跨重试、读失败/缺失不解锁、读取原章目标才恢复且不额外 POST；`review-prior-unknown-red.log` → `review-prior-unknown-green.log` 验证重试失败不能抹掉较早 unknown |
| 完整门禁 | `COREPACK_ENABLE_AUTO_PIN=0 pnpm test`、`pnpm typecheck`、`pnpm build` 均 exit 0；修复后 561 tests（contracts 80/server 232/CLI 148/Web 101），输出 `review-full-{test,typecheck,build}.log`（初轮 558 tests 见 `full-*`）；构建仍有既有 500 kB chunk 提示 |
| CLI→HTTP | `apps/server/test/continuation-cli-integration.test.ts`：可执行 CLI 完成两章、回读及修改旧章、显式开始第三章；`smoke` 仍只覆盖首章 |
| 浏览器 | 独立 fake :8793 / Vite :5175，完成首章→起章2→编辑章纲→生成/修改/通过正文2→编辑旧章→后章保留 approved 并显示衔接提示；chapter2 URL 刷新及书架重入只读，已通过设定只读，第三章显式起章成功。`browser-continuity.png`、`browser-continuity-dom.txt` 留存；自动测试另覆盖 dirty/inflight/unknown 切章保护与迟到响应 |
| 真实模型节点 | 仅两次独立 `run-step`，LongCat-2.0：Beat2 9.515s，2323/426 input/output tokens；Prose2 33.051s，1620/1455 tokens，2164 字符。均 schema-valid、stop、无重试；合计 42.566s，3943/1881 tokens。`live-continuation-summary.json` 保存公开参数与引用 |

真实调用上游是 fake 首章加合成人工修改的固定快照，真实 Beat2 输出传给 Prose2；未经过生产审批或落库。它证明真实节点可接受承接输入，不证明全链路真实小说质量、长篇记忆或持久化。Beat prompt/system hash 为 `53286809426c`/`51a9992db46f`，Prose 为 `888a8fb303d3`/`7744ac6502af`，公开参数 thinking disabled、temperature 0.9、topP 0.95。

| #6 验收 | 可复跑证据 |
|---|---|
| AC1、AC2 | `chapter-continuation.test.ts`、`continuation-step.test.ts`：两章/第三章、前章审批、最新正文、完整输入及预算；真实节点承接 |
| AC3、AC4 | `Workspace.continuation.test.tsx`、`App.continuation.test.tsx`、浏览器路径：显式动作、目录/URL、只读资料与重入不生成 |
| AC5、AC6 | server 续写测试：历史保存保留 approved/inputs、提示传播、重放/并发、输入在途变化不提交；Web 409/unknown 冻结恢复 |
| AC7 | Web 续写测试：未保存/在途/未知切章保护、迟到 GET 和 Beat 通过响应隔离 |
| AC8、AC9 | CLI continuation/command-entry/step-transport、server CLI integration、上述跨包测试和浏览器记录 |
| AC10 | 本页、schema、双语 README/图示、handoff、CONTEXT、继承页和 drive skill；完成门禁与独立审核在下方收口 |

### 完成审核证据

- **清单与候选**：清单 blob `95103b7eb54ec94e348ffb1b73d040d31bcb5921`；远端交付固定点 `391d0fbc986c781c7dec9982111ed1183c7c9713`；继承提交 `7bce2028e2bd7a4eae22d548584baeba2d4c4626` 已纳入历史与交付 diff 审计。T0：`50dd9f6310c49c1c79f5642fe7da0b279efc965f`；T1：`43541c5b63d1f6a0f868dc4748662f4263fc38a1`。精确 staged manifest 为 76 个文件（固定点到候选共 78 文件，含继承文档），见 `staged-manifest.txt`；无 unstaged/untracked 票内遗留。
- **逐项判定**：C1 = PASS（C1.1–C1.8：`issue-6-baseline.json`、`issue-6-dependencies.json`、起始上下文、三项 Human 裁决、版本化切片计划和原始 clean worktree）。C2 = PASS（C2.1–C2.5：上述 RED/GREEN、原子写入/共享协议复用、AC 映射）；C2.6 = N/A（有行为变更，已用 RED/GREEN）。C3 = PASS（C3.1–C3.6：完整门禁、patch/secret 检查、安全遥测、复用既有锁及 Store；版本引用避免复制全文，Web 不重建状态机）；没有独立 lint/format 脚本，静态检查为 typecheck 和 diff-check。C4 = PASS（C4.1–C4.3、C4.5–C4.9：下方知识与自校准证据）；C4.4 = N/A（本票复用既有内存 Store/模型架构，可逆票内输入引用契约，不引入外部选型或不可逆跨票决定；未来 SQLite 迁移另行设计）。C5 = PASS（C5.1–C5.3：精确 manifest/tree、两次 diff-check、固定点到候选完整 patch、继承唯一提交逐笔审计；C5.4–C5.7：下方隔离双轴结论、原始报告保留、接受修复及新 tree 复审）。C6.1 = PASS（原行为 RED、修复 GREEN 及文档校验）；C6.2 = PASS（561 tests、typecheck/build 全量回归和独立新 tree 双轴 PASS）；C6.3 = PASS（T0→T1 仅本段四行证据转录，彼时 T1/裁决均 pending）；C6.4 = PASS（独立 `continuation_attestation` 精确比较 T0→T1、完整 T1/历史/余项与来源证据，见 `attestation-t1.md`）。
- **验收与 TDD**：AC1–AC9 的可复跑测试及浏览器证据见上表；AC10 文档已同步，候选独立审核在本节收口。所有 RED 都针对缺失行为，不能用环境安装失败充当 RED。
- **本地门禁**：2026-09-29 完整 test/typecheck/build exit 0；git diff-check 固定点通过。`security-check.json`：所有候选文件及继承提交无本地真实凭据匹配，`.env.local` 被忽略且权限 600；HTTP 请求体有界，遥测仅身份、长度、版本、用量，模型输出继续经生产 schema。pnpm 安装曾报 esbuild ignored-builds（安装命令未记 PASS，未改依赖策略）；已安装平台二进制可正常跑完整门禁。构建的既有 chunk 大小提示保留。
- **双轴 review**：Standards：独立 `continuation_standards_review` 对 T0 PASS，0 开放项；Spec：独立 `continuation_spec_review` 对同 T0 PASS，AC1–9 满足、AC10 候选阶段满足。两位均未参与实现、未互读报告。`standards-rereview.md`/`spec-rereview.md` 保存原始结论；Standards 重跑原复现及 16 项工作区测试，Spec 独立四项恢复验证均通过。
- **修复与回归**：实施期间补测并修复响应未知、起章 409 和迟到 Beat 通过误触其他章生成；原始 RED/GREEN 与完整门禁见上表。独立 review 原始发现：Standards 2×P2（HTTP200 unknown 起章、治理文档旧排期）；Spec 2×P2（相同起章缺陷、初次正文生成未知切章）。全部接受并修复，原始报告 `standards-review.md`/`spec-review.md`；修复后完整门禁及双轴复审均 PASS。额外浏览器回归用同一 fake 作品生成第三章正文，前端无 error；`browser-after-review.png`/`browser-after-review-dom.txt`。
- **知识维护**：006 新页；schema、CONTEXT、中文/英文 README 与四张流程 SVG、handoff、Wiki 索引、005/014/022 继承导航、drive skill 已更新。旧票 005/014/022 完成审核字段逐字保留；文档代理校验 272 个本地链接/图片、53 个锚点、SVG XML 及渲染。`docs-validation.txt` 保存来源 hash。ADR/research N/A 见 C4.4；docs/agents/contract-governance.md 仅同步当前队列并保留历史排期，规则未改变。三轮自校准：① 代码↔行为：两章/第三章、锁/CAS、旧章保存与前端隔离匹配测试及浏览器；② 代码↔知识：schema/操作入口/预算、首章历史边界与当前多章导航一致；③ 完整候选↔AC：AC1–AC10 有对应入口，#19/#9/#7/#28/#29 未并入实现，继承文档提交不遗漏。结论均 PASS，review 修复后再次核对：未知生成按原目标保护、当前队列与全部知识入口一致，AC 映射和范围不变；正式 review 仍独立执行。
- **发布前裁决**：独立 `continuation_attestation` 于 2026-09-29 对上述 T1 给出 PASS，0 开放阻塞项；reviewer 未参与实现，辅助历史审计只读。核对清单 blob、固定点、76 staged/78 完整差异、继承提交、C1–C5/C6.1–C6.4、AC/TDD、561 tests/typecheck/build、文档保留及真实模型边界；完整来源 `attestation-t1.md`。剩余限制：内存存储重启丢失、只承接上一章、衔接提示不自动修复、无远端 CI；安装 ignored-builds 未冒充成功。仅授权 C6.5 字段收口；C6.6 终止比较与 C7 发布/merge/关闭仍须外部核验，不在此声明整节 C6 完成。

## 边界与非目标

不做 SQLite、长期记忆、工具循环、作品 Wiki 更新、已通过章纲/设定回改、历史版本比较、自动完本判断或自动连跑后续章。#19 保留全仓契约收敛，本票只改多章能力所需边界。服务重启仍丢失作品；跨浏览器刷新恢复依赖原服务进程。

## 上下文演进

### 2026-09-29 — 续写优先与 MVP 编辑边界

- **触发证据**：作者要求先做续写，并明确接受本轮三项范围建议；#6 的旧“任意层编辑”与 #17/#21 拆分边界冲突。
- **原假设**：旧排期在 #19/#9 后才实现 #6；旧票把全部层级回改及循环到完本笼统放在一起，未定义后章受旧章编辑影响的行为。
- **决定**：先交付多章双关卡与上一章承接；全层可读、按既有权限编辑；旧章修改保留后章并提示，过期生成拒绝落库。新顺序为 #6 → #19 → #9 → #7。
- **影响**：明确章级身份与动作、续写输入、历史阅读及衔接版本依据，扩展 Web/CLI；#19 后续治理实际多章契约，#9 再实现重启恢复。
- **上下文处理**：preserve #6 原始按章创作目的和依赖调整、#22 人工编辑/恢复协议及审核历史；replace 当前排期与模糊编辑边界。原日志谱系继续保留，因新增衔接提示增加可回读版本引用；它只记录生成依据，不复制其他来源的正文。

### 2026-09-29 — 独立 review 补齐未知生成保护

- **触发证据**：Standards/Spec 对初始候选 `9005f4091a8bc91a7a69c09ff560a62364dbad94` 分别复现 HTTP200 unknown 起章被当作普通失败、初次正文生成响应丢失后过早解锁；正式回归两项 RED。
- **原假设**：起章未知主要来自 HTTP/传输错误，普通 advance 的一次回读足以恢复生成状态。
- **决定**：按 command.writeOutcome 判断业务 unknown；起章保留冻结基线，首次生成冻结原始产物地址，GET 缺失不能解除保护。
- **影响**：Web 切章与再次生成保护涵盖上述路径，显式 GET 观察到原目标才恢复；同步遗漏的 contract-governance 当前队列。修复候选重新执行完整门禁与双轴 review。
- **上下文处理**：preserve 原始 RED 与 review 结论；replace 当前未知恢复说明。没有扩大后端 API、重试策略或其他 ticket 实现。

## 交接结论

可继承的能力是逐章双关卡、上一章承接、历史正文编辑、衔接提示与按章恢复保护；不能假定长篇记忆、自动修复衔接或服务重启恢复已经存在。发布状态回读 #6 与对应 PR。完成本票后再单独对齐 #19 的全仓契约治理，然后 #9、#7；不要批量关闭后续需求。
