---
wiki_id: "051"
ticket: 51
ticket_state: active
context_state: current
summary: "开发Agent可用的节点实际调用记录，复用run-step支持review/modify、输入输出和A/B + comment"
topics: ["node-iteration", "agent-cli", "system-prompt", "context-control", "private-experiment-records"]
code_paths: ["apps/cli/src/local-step.ts", "apps/cli/src/command-line.ts", "apps/server/src/step-lab-main.ts", "apps/server/src/steps/isolated-runner.ts", "apps/server/src/steps/llm-call.ts", "packages/contracts/src/step-experiment.ts"]
symbols: ["run-step", "runLocalStep", "runIsolatedStep", "callLlm", "--record-dir"]
inherits: ["014", "011", "016"]
changed_by: []
read_when: ["develop-node-iteration", "record-isolated-step", "review-node-input-output", "compare-system-prompts"]
last_context_reviewed: "2026-10-10"
---

# 051 — 节点实际输入输出记录与Agent迭代

## Agent Context

- **读取时机**：开发节点记录、检查实际输入输出、单节点A/B或comment使用方式。
- **原始目的**：让用户通过Agent方便地review/modify SP/context/Harness、看输入输出、A/B + comment，减少重复操作和无用基础设施。
- **实际落地**：[#51](https://github.com/12bitsD/agent4novel/issues/51)的最小记录入口已落在 `run-step --record-dir <新目录>`；目录预检、四文件落盘、六节点共同 `callLlm` 捕获和失败/unknown 语义均由CLI/worker测试覆盖。
- **当前价值**：本票WHAT/AC以GitHub为准，本页给已实现的最小HOW、代码落点和使用边界；普通工程细节自主收敛，不重开已确认的Agent入口与三动作范围。
- **后续变化**：本票只提供一次运行的私有文件资源；读取、A/B、comment和复跑由Agent/Harness复用现有文件与 `run-step` 完成，不扩成Pipeline、UI、数据库或评测平台。
- **代码入口**：local-step/step-lab-main负责CLI-worker交接；isolated-runner负责最终节点结果；callLlm是六节点共同SDK调用边界；step-experiment定义请求、响应和四文件schema；`apps/cli/src/step-record.ts`负责私有目录预检/CLI deadline收尾。

## 设计目的

用户能在聊天中指出一个具体问题。Agent读取真实输入输出，修改相关SP/context/Harness，按授权复跑，需要时复用可比的旧A与新B对照，记录用户原话并继续。当前缺口是运行材料可保存、重读，尤其是实际装配后的system/user内容；不新建实验管理或评阅平台。

需求、AC1–AC9与非目标见issue。先前已收敛的工作方式见[最小工作流](../plans/node-iteration-workbench.md)与[Agent操作方式](../plans/node-iteration-agent-review.md)。

## 起始上下文

固定点main `ce66affa3a0bf6ee76efde60dccb83c1ce396e46`。实现阶段拟使用本地已 claim 的源分支 `feat/51-node-iteration-records`→PR→main；当前尚无 #51 代码提交或 PR，本页不把预定交付路径写成已发生事实。远端main无保护、rulesets为空，CI有quality/container，发布前仍重新核对。

2026-10-07用户明确“需要开发…先claim…Wiki和github issue…具体需求+方案”。此前只做设计没有开发票；本次创建51并claim，回读OPEN/assignee12bitsD/ready-for-agent，无Project/阻塞。完成时保持现有标签/assignee/依赖，Project该部分N/A，不联动其他票。

现有开放票46/29/28/21/20/18/17/15/12未覆盖本最小需求，无重复票。3份已有未跟踪方案/研究均为本会话自有资料，本票纳入；原主目录仍保留，活动工作树复用已附着author-workbench，源代码与main基线一致。模型密钥与现有作品/演示数据不复制、不改写。

C1证据：/tmp/a4n-node-iteration-dev-evidence中的open-issues-baseline.json、main-baseline.json、issue-51-baseline.json、dependencies.json、issue-body.md。当前仅完成需求建档/claim阶段，后续审核/测试/发布均待实际执行。

## 技术方案

### 1. 最小接缝选择

已核对三条机制：把六节点装配全部提成新builder；在现有共同调用边界增加仅实验启用的捕获；另写实验专用装配。选择第二条：改动较少，能记录当前真实传给SDK的内容，并保持生产与实验同源。第三条易与生产漂移；第一条不是本票先决条件。记录只在请求显式带 `record` 时启用；未带参数时不生成全文记录，stdout/stderr/telemetry行为保持原样。

实际入口：run-step原语法增加可选 `--record-dir <dir>`。不给参数时行为完全保留。modify仍由Agent修改普通文件/代码并展示diff；A/B通过读取本地记录完成，comment用本轮comments.md保存，不创建独立会话/评分/采用模型。

### 2. 捕获边界与结果语义

在callLlm实际构造generateObject参数的位置捕获system、prompt、解析后的model/generation以及明确传入的输出上限/重试选项。使用仅runIsolatedStep范围启用的observer/上下文，避免全局可变sink污染并发调用；生产调用没有sink时不产生全文记录。

捕获的是传给SDK的值，不是SDK/provider后续转换的HTTP报文。未传入的选项保留缺失语义，不猜SDK/provider默认或是否真正遵循。捕获文本逐字符匹配SDK入参，schema与既有consume guards不绕过。

最终结果由独立runner/worker返回或记录：Creative/Outline/Setting/Beat在模型之后补结构ID，仅在callLlm记录model object不足以代表最终产物。result保存现有StepExperimentResponse的校验后content/失败与telemetry；不声称是provider原始输出，失败原始文本不在范围内。

### 3. 一次运行一个私有目录

Agent指定尚不存在的本次记录目录，推荐.data/experiments/<本轮>/<A或B>（占位示例，非现存目录）。目录在发请求前做路径/权限/碰撞检查；拒绝破坏性覆盖、保留旧记录。实际实现对符号链接/路径归属及文件权限的保证由确定性测试锁定。

实际固定4份记录：`input.json`（供实验使用的输入与 `sources`）、`invocation.json`（`callLlm`实际传给 `generateObject` 的 system/prompt、`effectiveConfig`、有效SDK选项，或明确未捕获）、`result.json`（最终节点结果或安全失败/unknown）、`meta.json`（格式版本、节点/run标识、时间、代码commit/dirty、来源与完成标志）。`effectiveConfig` 严格只含 model、directionCount、thinking、temperature、topP；它补足影响节点装配但不一定进入generation的配置，不记录凭据或完整配置文件。Harness把同一目录的这四个文件作为一次读取资源：先读 `meta.json`，只有 `complete: true` 且 `status: "complete"` 才把本次结果视为完整，再按 `meta.files` 一次读齐其余三份；`in-progress`/`incomplete` 目录只能作为部分证据，不能冒充成功。

缺失信息保留为 `null`（例如输入校验/guard 在SDK前失败时，`invocation` 的 captured/system/prompt/model/选项不会被源文件重建）；未传给SDK的可选项也不猜 provider 默认值，记录为 `null` 或不出现。`result.json` 的成功内容是节点最终校验并补齐结构ID后的结果，不声称是provider原始文本。文件命名和有限schema已固定；不建立服务/数据库。`comments.md`由Agent在记录目录旁另存用户原话与解释，不改四个机器记录。

CLI在发起worker前只接受尚不存在的记录目录；目标或任何父级是符号链接、目录已存在或路径不安全时直接拒绝且不调用provider。目录权限为0700，四个文件权限为0600；CLI timeout/worker failure 会保留已有调用证据并写 `result.status: "unknown"`、`meta.complete: false`，不能把迟到provider结果或局部文件说成成功。

CLI版本信息HEAD/dirty只报告可确认内容；dirty不冒称已冻结或可重现。完整prompt/素材仅进入显式私有本地归档，不加进现有stdout/stderr/telemetry，不录credential配置或请求头、不上传外部服务。自定义内容可能含用户私有文本，按本地实验材料处理。

### 4. 失败、期限与落盘

输入/预算/配置在SDK前失败时，可以没有invocation，明确“未调用/未捕获”；不能根据源文件捏造实际请求。provider/model timeout保留现有llm-timeout语义；CLI deadline保留现有network-error并说明本地中断/结果未知，不断言provider取消或零计费。模型结果可判定时与未知分开，不自动重发。

记录失败不应被callLlm的model catch误分成llm-unavailable；落盘成功与模型成功是不同事实。无法安全准备记录位置时先停止发请求；调用已完成但收尾写入失败时，保留已写证据并报告归档未完成，不声称模型未执行。原子写入/完成标志与父子进程最终写入责任在实现测试中固定，不凭路径存在断言完整。

### 5. Agent如何使用

Agent/Harness直接读同一记录目录的四个文件，展示当前问题相关SP/context/Harness差异、实际输入和最终输出。比较时核对 `meta` 的节点、来源、版本，以及 `invocation` 的 system/prompt/model/参数和 `result`；条件不全或不同就说明，不能伪称单因素公平对照。

- **A/B**：为A、B分别指定两个全新的 `--record-dir`，复用相同的合成 `--input-file`/`--seed-file`，只替换明确的 `--system-prompt-file` 或选项；分别读取四文件后比较，不能复制或覆盖A。
- **comment**：在记录目录旁写 `comments.md`，记录用户原话、观察和待改假设；它不是机器结果，不回写 `input/result/meta`。
- **复跑**：先核对 `meta`/`input` 和来源文件，再用现有 `run-step` 从相同源输入重新发起，并指定新的记录目录；原目录只读保留。若只剩记录文件，可据 `input.json.input` 生成新的 `--input-file` 请求，不能据缺失的 invocation 字段猜测原调用。

用户明确接回基础版本时仍走现有源码审核流程；实验记录不创建WorkStore/Pipeline，不修改作者作品、批准状态或已有章节。

## 代码落点

| 责任 | 当前入口/拟议新增位置 |
| --- | --- |
| CLI参数、帮助、文件/版本与worker启动 | apps/cli/src/command-line.ts、main.ts、local-step.ts |
| 共同实际调用捕获 | apps/server/src/steps/llm-call.ts、apps/server/src/steps/step-record.ts |
| 最终结果/错误与记录交接 | apps/server/src/steps/isolated-runner.ts、apps/server/src/step-lab-main.ts |
| 内部记录契约 | packages/contracts/src/step-experiment.ts |
| 文档/运行方法 | 本页、schema受影响部分、CLI help、drive skill、README中英、handoff |

## 测试与验证

TDD切片与当前证据：

1. S1 SDK边界：已用mock `generateObject`覆盖六个step，验证记录中的system/prompt与实际入参逐字一致，`effectiveConfig`保留model/directionCount及采样配置，未传generation/provider选项为null，默认无记录路径保持无全文。
2. S2 CLI/worker：已用loopback provider覆盖help、私有目录预检、父级symlink、碰撞、文件权限、最终ID、CLI timeout unknown和worker失败收尾。
3. S3 Agent联验：没有新增平台或独立读取命令；候选 worktree 使用 loopback provider 通过真实 `run-step prose` 完成 A/B，读取两版四文件，写入旁置 `comments.md`，复核 A 未被 B 覆盖、同一 prompt、两次调用和文件权限。完整门禁仍由主Agent按固定验收版本独立复核。

公开接缝使用CLI进程、SDK transport、共享输入/输出schema和实际文件内容，不针对私有函数/目录结构镜像测试。本候选未调用真实provider，测试使用合成fixture、SDK mock和loopback transport；不沿用先前934项门禁当本票结果，不把fake链路当文学质量。

AC映射：AC1/5→S2；AC2→S1；AC3/4/6→S1+S2；AC7→S3；AC8→三片公开联验；AC9→知识/完整门禁/独立审核/CI回读。scope-check报告在/tmp/a4n-iteration-ticket-scope-check.md，明确SDK边界、最终产物和错误分类；它是实施前核对，不是正式候选review。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `d2669132c8598a1368f43e2b7fe66225211f09be`；候选分支 `feat/node-observation-loop`，候选 T0 tree `46c95bd61dd6776b1f5774437dae0a6b8b9ab2f5`。交付模式为 `source branch → PR → main`，base 为 `main`；当前 main 未保护、rulesets 为 0，CI workflow `CI` 含 quality/container 两 job；T0 尚未推送或合并。
- **C1 锁定票面**：C1.1 PASS：`gh issue view 51 --json ...` 回读 WHAT/AC、非目标、评论、`OPEN`、`ready-for-agent`、assignee `12bitsD`、无 Project；依赖 API 回读 blocked-by 数量为 0。C1.2 PASS：候选分支/base/CI/保护状态已实际回读，未按仓库习惯猜测。C1.3 PASS：用户“源信息优先、无值为 None、文件 + run-step、主Agent定义验收后派工、最多3轮”已写入验收计划和 iterate skill。C1.4–C1.8 PASS：Wiki051、CONTEXT、schema、相关运行 skill 已读；范围、非目标、依赖、风险、终态标签与 Project 预期均有记录。
- **C2 TDD 与实现**：C2.1 PASS：基线 RED `/tmp/a4n-loop-start-20261010/baseline.json` 为旧 CLI `--record-dir` 返回 `usage`、不创建目录；C6.1 review 暴露的旧 unknown invocation shape 另以 schema 命令复现 RED：`{"red":true,"missing":["effectiveConfig"]}`。C2.2–C2.6 PASS：S1 SDK 边界、S2 CLI/worker、S3 Harness 联验均先有失败目标再最小实现；成功/边界/错误/隐私/并发和六节点覆盖均有测试；候选反查 AC1–AC9，无静默扩票。
- **C3 本地门禁**：C3.1 PASS：当前候选执行 `pnpm test`、`pnpm typecheck`、`pnpm build`，contracts 121、CLI 202、server 416、web 208 tests 全部通过；build 保留既有 web chunk size warning。C3.2 PASS：定向 CLI 12 tests、diff check、109 个 Markdown 相对链接、skill 结构/等价 symlink 校验通过，新增/未跟踪文件均纳入候选。C3.3–C3.5 PASS：公共输出/telemetry 不含全文或 provider 原文，凭据/请求头不进入记录；采用共同 `callLlm` seam，无新增平台抽象或重复存储。C3.6 PASS：命令和关键警告已在本记录及 acceptance plan 留证。
- **C4 知识维护**：C4.1–C4.2 PASS：Wiki051 当前章节、完成审核证据和交接结论同步。C4.3 `N/A`：实验记录是独立私有文件契约，不改变作品领域 `docs/schema.md`；C4.4 `N/A`：沿用现有接缝，无不可逆跨票架构决定。C4.5–C4.8 PASS：中英文 README、handoff、drive skill、iterate skill、索引/链接均同步并校验。C4.9 PASS：代码↔测试、代码↔Wiki/领域词、候选↔issue AC 三轮自校准均完成。
- **C5 双轴 review**：C5.1–C5.3 PASS：精确 manifest 与 `fixed-point..HEAD` 完整 patch/逐笔 commit/secret scan 已审计，T0 如上。C5.4 Standards reviewer `PASS`、无候选阻塞；C5.5 Spec reviewer 对 AC1–AC8 `PASS`，AC9 的 CI/PR/merge/远端回读属于 C7 待收口事实，不是候选行为缺陷；原始报告指出的 AC7/AC8 证据缺口已由版本化 A/B/comment 测试补齐。C5.6 PASS：接受并修复了父级 symlink、`effectiveConfig`、四文件读取证据问题；未采纳“必须新增读取 CLI”的建议，因为 issue/用户决定明确允许文件 + run-step。C5.7 PASS：最终 T0 未再发生行为或契约变化。
- **C6.1–C6.2 修复与回归**：C6.1 PASS：review 发现 `markStepRecordUnknown` 生成的 `invocation.json` 缺少 schema 必需的 `effectiveConfig`；实施 Agent 在 `d17e677` 补为 `null`，并在 `b305a05` 为 timeout 记录加入共享 schema 复核及四文件读取断言。C6.2 PASS：定向 CLI 12 tests、typecheck，以及最终候选的全量 test/typecheck/build 均通过；修复不改变 AC/范围。
- **C6.3 证据收口**：本次写入的是预留完成审核字段；T0、C1–C5、C6.1–C6.2 及其证据如上，T1 与发布前裁决在本次变更后待独立 reviewer 核对；不在此字段记录最终 T2。
- **C6.4 reviewer attestation**：独立 reviewer 对 `T0=46c95bd61dd6776b1f5774437dae0a6b8b9ab2f5 → T1=2bf72e1998022a0f90ede0600f1f22ab896e04de` 精确比较，结论 `PASS`；确认唯一变化是本节预留证据字段，`git diff --cached --check` 通过，无代码/README/范围夹带、无 T2 自引用。reviewer 未运行真实 provider。
- **C6.5 发布前 attestation**：基于 C6.4 `PASS`，逐项证据、原始 Standards/Spec 报告、修复记录和剩余风险已忠实收口；C1–C5、C6.1–C6.4 的终态证据均已写入本节。此时只生成 T2 供 C6.6 核对，不在 Wiki 中写入最终 T2 或 `C6 = PASS`。
- **C6.6 终止性核对**：`T1 → T2` reviewer 比较待完成；在其 `PASS`、PR/CI/merge 和远端回读完成前，ticket 不进入完成结论。
- **未宣称项与剩余风险**：没有新增独立读取 CLI、评阅平台、UI、数据库或作品数据写入；未做真实 provider 文学质量、付费实验、进程崩溃级归档恢复；这些不被包装成已通过。正式 C6.4–C6.6、PR/CI/merge、issue 完成评论与关闭仍待执行。
- **loop 结论**：开发 loop 按 R0 → R1 → R2 → R3 完成；C6.1 是候选 review 后的定向缺陷修复，不重置 loop 轮次。当前仍不能宣称 #51 或二期完成。

## 边界与非目标

不做评阅平台/专用UI、会话/采用卡/量规、独立评委或自动judge，不固定样本数/重复次数；不新增自动baseline或自动晋升，不读取任意作品历史全文，不接作品Wiki/工具循环。旧14实验能力和安全遥测保留，失败原文采集与真实模型质量验证不扩入本票。

第一版只落实实际调用可检查和结果/comment可读写。文件式归档也有权限、碰撞、部分写入和迟到结果风险，必须测试；不因“本地文件”声称自动具备事务或崩溃恢复。

## 上下文演进

### 2026-10-07 — 从已对齐的简单工作流进入开发claim

- **触发证据**：用户要求停止复杂设计，认可review/modify、输入输出、A/B + comment，并明确要在GitHub/Wiki claim和给需求/方案。
- **原假设**：前几轮只有方案收敛，尚未创建实施票。
- **决定**：新建51并claim，以一个可选本地记录入口复用生产SDK调用边界；评论/读取由Agent完成。
- **影响**：源分支固定、AC/TDD和代码接缝建立，后续按三片实施而非扩成平台。
- **上下文处理**：preserve用户三动作与Agent入口决定、已有实验方法；compact冗余设计为可选研究/私有历史；replace当前进行中入口为本票，不修改旧票冻结审核。

### 2026-10-10 — 第2轮定向修复

- **触发证据**：第1轮主验收指出父级symlink与六节点共同 `callLlm` 记录证据需要补强，并要求明确四文件Harness读取方式。
- **决定**：`safePathChain` 对任一父级symlink直接拒绝；用合成fixture和SDK mock对六个step逐一比对实际 `generateObject` 的system/prompt及省略选项；timeout/worker failure维持已有unknown/incomplete保护。
- **影响**：补充公开CLI文件系统测试、六节点记录测试和本页/drive skill操作说明；不加入Pipeline、UI、数据库、评论API或真实provider。

### 2026-10-10 — loop 收口

- **触发证据**：R1 候选通过定向测试但 E2/E6/E7 证据不足，且发现父级symlink路径边界未锁定。
- **决定**：R2 只修该边界、补六节点真实 SDK 接缝证据并同步中英文 README；不增加读取服务或实验平台。
- **结果**：R2 代码、测试、typecheck、build和文档检查通过；主 Agent完成固定验收版本复验。正式双轴 review因只读 reviewer未返回报告保持待办，不能提前宣称票据发布完成。

### 2026-10-10 — 第3轮配置与落盘收口

- **触发证据**：主验收发现 `directionCount` 只能从 prompt 间接推断，且 worker 独占写入的目标替换语义需要锁定。
- **决定**：在实际调用记录中增加严格 `effectiveConfig`；独占写入改为不覆盖已有文件并补回归；不增加读取服务或其他资源平台。
- **结果**：第3轮受影响测试、全量 `pnpm test`、`pnpm typecheck`、`pnpm build` 均通过；没有开启第4轮。前置独立 Standards/Spec reviewer 已返回候选报告；AC7/AC8 的 loopback 联验随后补齐，正式 C5/C6 仍待执行。

## 交接结论

loop 已完成到 R3：#51 的最小候选、四文件 Harness 资源、运行 skill 和双语说明保留在隔离worktree；正式双轴 review、提交/PR/CI/merge和 issue 关闭仍待后续交付流程，不把当前候选写成已发布。
