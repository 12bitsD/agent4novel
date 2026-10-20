# Agent4Novel 后端契约与现状冻结（Step 0）

> 本文是后续 Step 1–4 的冻结基线。标记为“冻结事实”的内容来自固定点代码、测试和现行规范；标记为“候选”的内容尚未授权实施，也不证明有收益。Step 0 未修改生产代码或测试，未运行全仓测试。

## 1. 基线与边界

- 固定点：`51b713e808c9842404b910fae51541a36343b460`（短 SHA `51b713e`）。
- 分支：`refactor/agent4novel-backend-loop`，核对时 HEAD 等于固定点。
- 范围：`apps/server`、`apps/cli`、`packages/contracts`。
- trace：[agent4novel-backend-refactor-loop](https://moonshot.feishu.cn/docx/P5iydbOunore99x2NSUcCnvAnUf)。
- loop：Step 0 冻结 → Step 1 清理 → Step 2 先大后小重构 → Step 3 术语与命名 → Step 4 双轴 review、mutation 与全量验证。大结构改、小实现改、命名改必须能分成独立 commit；每步由 nika 验收，loop 后不自动 push。
- 五道停止门必须同时闭合：契约闭合、状态闭合、规则闭合、证据闭合、review 定点。测试数量或“没有更多改法”不是停止依据。

### 1.1 不做什么

1. 不修改 `apps/web`，不访问真实 provider，不制造模型费用，不安装依赖，不修改数据库或 workwiki，不读取或修改 `.npmrc`。
2. 不做 git commit/push、GitHub issue/PR；本 Step 0 不改现有 `docs/schema.md`、Wiki、生产代码或测试，不开始 Step 1。
3. 不搬用 chatty、finalizer、RunSpec 的组件结论；Agent4Novel 当前代码中没有这些组件，不能据此设计新中心组件。
4. 不发明 staging、backup、quarantine、持久任务队列、自动恢复模型调用或实验记录平台。
5. 不把上一轮历史不兼容授权扩大。`docs/schema.md:94` 所记当次 Human 裁决不构成此 loop 的新迁移、删库、公共字段改名或历史数据改写授权。
6. #15 Hono RPC 在 `docs/handoff.md` 中仍未获实施确认，不作为本 loop 的清理或重构前置。

### 1.2 证据口径

- 当前行为以固定点代码和测试为事实；`docs/schema.md` 与 `CONTEXT.md` 提供领域含义；ADR 提供长期架构约束；Wiki 只解释设计意图和变化谱系。
- 本文引用“现有测试”表示测试源码中存在相应断言，不表示本 Step 0 已重新执行。按任务要求，本步只读分析。
- 初始 `git status --short` 只有既有 `?? .npmrc`。本步仓内只新增本文；另一份验收报告写在仓外指定目录。

## 2. 不可简化项（冻结事实）

### 2.1 CLI 参数、stdout/stderr 与进程结果

- `apps/cli/src/command-line.ts:151` 在任何业务 I/O 前解析命令、位置参数、必需参数、互斥参数、重复参数和未知参数；`--help`/`-h` 优先且零副作用。普通命令允许 `--url`，`run-step` 明确不允许；不支持 `--top-k`。
- `apps/cli/src/main.ts:25-37,151-160`：成功结果只向 stdout 写一个 JSON；错误向 stderr 写一个安全 JSON 并置非零退出；帮助文本写 stderr。不能用 `pnpm run` 横幅污染机器 JSON，公开入口是 `apps/cli/bin/a4n` 或文档规定的静默调用。
- HTTP 200 不等于业务成功。`advance`/`start-chapter` 的 `kind:"failed"` 仍按成功传输退出 0，调用方必须检查 `kind`；`smoke` 遇到失败则非零。证据：`apps/cli/test/command-entry.test.ts:239`、`apps/cli/src/commands.ts:326-333`。
- 文件输入必须有界、严格 UTF-8/JSON，错误不得回显私密内容或改写请求文件。证据：`apps/cli/src/request-file.ts`、`apps/cli/test/command-entry.test.ts:100-121`。

### 2.2 HTTP、Zod、Artifact 与错误阶段

- 公开内容、请求和响应的运行时定义归 `packages/contracts`；路由和 CLI 不只依赖 TypeScript 断言。`artifactSchema` 同时校验 envelope、kind/status 内容和章节地址，`workDetailSchema`/`workViewSchema` 再校验作品归属和唯一 head（`packages/contracts/src/artifacts.ts:9-39`）。
- 生产端成功响应经 `contractJson` 或专用响应 schema 复验；消费端还要核对 work/kind/chapter/id/version/冻结请求，schema 合法但关联错误仍按 `invalid-response`。证据：`apps/server/src/contract-response.ts`、`apps/cli/src/client.ts:79-137`、`apps/cli/test/client-contract.test.ts`。
- 普通错误是 `{code,message,retryable,attemptId?,issues?,issueCount?,issuesTruncated?}`；`httpErrorSchema` 另容纳 Beat/Prose 命令错误。`issueCount`/`issuesTruncated` 及最多 128 条 issues 必须透传，证据：`apps/cli/test/validation-issues-entry.test.ts`。
- `failureStage: request|precondition|input|model|output|commit|response` 和 `writeOutcome: committed|not-committed|unknown` 是 Beat/Prose 命令观察，不是所有 JSON 的统一外壳（`packages/contracts/src/beat-command.ts:15-45`、`prose-command.ts:14-46`）。普通错误、CLI 本地诊断和独立 Step 结果不得强行并形。
- `request-rejected + not-committed` 只用于业务执行前的严格请求拒绝。执行期必须匹配 operation、target、expectedHead、公开 code/status 对，才能判定未写；畸形 4xx、任意 5xx、错误 operation 或缺失字段均不能证明未写（`packages/contracts/src/beat-submission.ts:40-86`、`prose-submission.ts:42-94`）。
- 写入后的 adapter 异常、读回失败或响应构造失败返回安全 500；不能声称未提交。证据：`apps/server/test/app.test.ts:140-149`、`outline-approval.test.ts:146-162`、`beat-pipeline.test.ts:343-360`、`prose-routes.test.ts:382-423`。

### 2.3 Artifact id、version、humanStatus、inputs

- `head` 是某 work 下某 kind/chapter 地址的最大 version；公开作品 GET 只返回 head，历史版本仍保留。精确历史读取仅支持 Beat/Prose 且必须同时给 kind/chapter/artifactId/version，不是历史列表或回退入口。
- append/generate/regenerate 创建新 artifact id、version+1；旧版本保留。Caption 无后置关卡，直接 append approved；Creative 选定和 Setting 扩展也有受控 approved append。
- Setting/Beat/Prose 的通过使用专用 finalize：同一 id/version/createdAt 原子替换内容和状态，不追加 V+1。通用 `setStatus` 不得绕过这三类专用命令。
- Prose save 是例外：新 id、version+1、新 createdAt，保留匹配基线的 humanStatus 和 inputs。pending 可保存空字符串；approved 内容必须非空白；通过不增版，通过后的编辑仍用 save 且保持 approved。
- `inputs` 记录生成时实际消费的 `{kind,chapter?,artifactId,version}`，不是上游内容副本，也不是修改上游的授权。保存和定稿保留 inputs；上游 head 改变使既有章节保留并投影 `needsContinuityReview`，不级联重写或自动重审。
- 运行时验证：`packages/contracts/src/artifact-envelope.ts:24-51`、`artifact-content.ts`；写入实现：`apps/server/src/store/sqlite-store.ts:172-237`；连续性：`apps/server/src/chapter-view.ts:7-36`。

### 2.4 SQLite CAS、事务和恢复

- 生产使用 `SqliteStore`；`InMemoryStore` 是行为测试适配器，不是生产失败后的隐式 fallback。
- 所有条件写入在 `BEGIN IMMEDIATE` 语义的短事务中重核目标 id/version/status、输出 head 是否存在和上游 approved head，再校验候选并写入。LLM 调用在事务外；过期结果不得提交（`apps/server/src/store/sqlite-store.ts:79-104,172-237`）。
- 事务失败回滚整个写入，包括多行 seed、Setting 扩展的 canonical append + proposal 状态。不能只回滚“第二个动作”而保留半份。
- SQLite v4 严格核对已知结构；只迁移精确匹配的 v1/v2/v3。未来版本、未知结构、损坏文件安全失败，不删库、不降级、不自动修复。已提交作品、全部 Artifact 版本、状态和 inputs 跨重启恢复；未提交事务强杀后回滚。
- 初始化仅对显式 `SQLITE_BUSY` 允许族做有界重试，默认最多 8 次 attempt；`SQLITE_LOCKED`、迁移错误和损坏不重试。运行期 CAS/写入没有这套自动 retry（`apps/server/src/store/sqlite-schema.ts:95-175`）。
- 证据：`sqlite-store.test.ts`、`sqlite-process.test.ts`、`sqlite-restart.test.ts`、`sqlite-initialization.test.ts`、`setting-extension.test.ts:250-330`。

### 2.5 模型调用、retry 与失败保留

- `runStep` 在 Step 输入和输出两侧执行 Zod；`callLlm` 统一 `generateObject`、schema 复验、输出 token 上限、AbortSignal timeout、错误分类和安全遥测（`packages/contracts/src/step.ts:36-44`、`apps/server/src/steps/llm-call.ts:59-186`）。
- Outline/Setting/Prose 上限 16000 tokens，其他节点默认或显式 8000。`finishReason:"length"` 与 schema 非法都不得发布部分结果。
- 原始 seed 超过 100,000 个 JS code units 时只在规定入口截断；结构化上游不静默截断。Beat/Prose 按实际装配的 system+prompt 在模型前执行 400,000 字符预算，前章和修改意见也计入（`packages/contracts/src/limits.ts`、`llm-call.ts:33-36`、`continuation-step.test.ts:57`）。
- Setting/Beat/Prose 显式 `maxRetries:0`；Caption/Creative/Outline 省略该选项，沿用 AI SDK 默认值，本仓不承诺具体默认次数。Pipeline 不自动重试；CLI 不自动重复 POST。SQLite 初始化 retry 是另一独立边界，不能混用。
- 生成失败或非法输出保留既有 head 和已批准上游；通用 advance 中更早步骤已经提交的成果也保留，后续可从失败 Step 显式重跑，不回滚整次 advance。
- 上游在模型调用期间变化时，提交 CAS 拒绝过期候选。advance 将该原因映射为可手动重试；专用命令给出 commit 阶段结果，不能把模型 `ok:true` 当成作品已写。
- 证据：`caption-step.test.ts`、`setting-step.test.ts`、`beat-step.test.ts`、`prose-step.test.ts`、`pipeline.test.ts:100,194,256`、`setting-pipeline.test.ts`、`chapter-start-baseline.test.ts`。

### 2.6 未知写入与恢复

- 冻结请求及其 id/version/status 基线；传输失败、5xx、畸形响应、错误资源关联均不能推断未写入，也不能自动换基线重发。
- Setting/Beat/Prose 的 CLI 最多回读一次。通过可按同 id/version/createdAt 和精确全文确认；Prose save 还要求新 id、version+1、同状态和逐字符全文；未知 regenerate 不能仅凭出现新 head 认领成功。
- 更早的 unknown 不被后续 `not-committed`、空日志或锁释放清除。`retryable:true` 只是原因可能恢复，不是自动重放授权。
- Outline 专用通过只 POST 一次，不自动 GET/重发；同目标已 approved 的合法重放在服务端是 no-op。Creative 再生也只 POST 一次，未知后不自动 GET/重发。
- 恢复 owner 是共享 submission 纯函数 + CLI/Web 的冻结请求和 WorkView 回读；进程内日志/遥测只是诊断，不是操作回执。

### 2.7 四文件实验记录与 run-step 隔离

- `run-step` 启动一次一个本地 worker，复用生产 Step、输入输出 schema、consume guards、ID 注入和预算；不创建 WorkStore/Pipeline，不写作品，不自动跑上游，不证明所供上游是当前作品 approved head。
- 独立执行要求 live 配置；无凭据不能退回 demo 内容。成功输出校验后的最终 content 和安全 telemetry；失败不返回 provider raw 文本。
- `--record-dir` 显式创建全新私有目录，产生且只约定四份机器记录：`input.json`、`invocation.json`、`result.json`、`meta.json`。`comments.md` 是 Agent 可选旁置材料，不是第五份机器记录。
- `invocation` 记录实际传给 SDK 的 system/prompt/参数，未调用或未传值保留 null，不从源文件重建事实。`result` 是最终 Step 结果，不冒充 provider raw output。
- Harness 先读 meta，只有 `complete:true && status:"complete"` 才把目录当完整记录；`in-progress`/`incomplete` 或缺失/损坏 meta 只能是部分证据。没有整个目录事务或自动修复。
- 证据：`packages/contracts/src/step-experiment.ts`、`apps/server/src/steps/step-record.ts`、`apps/cli/src/step-record.ts`、`apps/server/test/isolated-runner.test.ts:111-215`、`apps/cli/test/step-transport.test.ts:32-156,404-432`。

### 2.8 secret、symlink/path 与私有目录

- 普通日志、HTTP、CLI 和 telemetry 采用安全字段允许清单：id、分类、长度、截断 hash、用量和耗时不等同于通用脱敏器；不得加入完整 prompt、素材、provider 响应、请求头或凭据。`safeLog` 本身不替调用方清洗任意对象。
- 显式 `--record-dir` 是例外：它经用户授权在本地私有目录保存完整 system/prompt/input，但仍不记录 credential/config 文件全文或请求头，不上传。
- CLI 在启动 worker 前拒绝根目录、已存在目标、目标或任一父级 symlink；成功创建目录为 0700、文件为 0600。worker 再检查最终目录不是 symlink 且 group/other 无权限，记录文件用独占 hardlink 发布，替换文件必须是普通非 symlink 文件。
- 新 SQLite 文件以 0600 独占创建，既有权限不被擅自修改。受管 Prompt/Skill 路径必须留在数据目录内、逐级拒绝 symlink，先 0600 临时文件 + fsync，再 exclusive hardlink 发布并 fsync 目录，最后提交 SQLite 元数据。
- 静态 Web 只读已校验构建根内的真实文件；规范路径 containment、单次解码、拒绝外逸 symlink 和私有名称不能被重构绕过（`apps/server/src/runtime/static-web.ts`、`static-web.test.ts`）。

## 3. 行为矩阵（冻结事实）

表中“无自动 retry”不代表禁止作者显式重试；也不表示外部 provider 调用具备 exactly-once。没有对应概念的格子标 N/A。

### 3.1 output/head、生成和上游

| 组件与输入/状态 | 返回与 retry | 产物发布/写入 | 现场恢复 owner | 现有测试证据 |
|---|---|---|---|---|
| Pipeline：输出 head 缺失，依赖已 approved | `ready` 后执行 Step；无自动重试 | 成功才 append v1；`gateAfter` 为 pending，否则 approved；写实际 inputs | Pipeline + Store；后续显式 advance 从缺失点继续 | `pipeline.test.ts:123-157`；`app.test.ts:235` |
| Pipeline：输出 head 为 pending | `awaiting-approval`，不调用模型 | 不写新版；等待作者 | 作者通过对应专用/兼容命令 | `pipeline.test.ts:157-194`；Beat/Prose routes tests |
| Pipeline：输出 head 为 approved 且有效 | 跳过该 Step，继续下一关或 complete | 不重复 append | 当前 WorkView/Store | `pipeline.test.ts:157`；`sqlite-restart.test.ts:115-117` |
| 存储 head 存在但内容非法/“空”于所需 schema | Store 读校验失败，HTTP 安全 500；不当作缺失重生成 | 不发布损坏内容，不改库 | Store 报 `invalid-stored-data`；人工保全/排障，无自动修复 | `sqlite-store.test.ts:87-100`；`artifact-validation.test.ts` |
| Step output 为 undefined、缺必填字段、空 approved Prose、数量/ID 非法 | advance 为 failed；专用再生可 502/422；可手动重试 | 不 append，不消耗目标版本 | 原 head 保留；修正模型/输入后显式重跑 | `step.test.ts:23`；`pipeline.test.ts:256`；`beat-pipeline.test.ts:303`；`prose-step.test.ts:63` |
| 生成成功 | `advanced` 或专用命令 200；无 Pipeline retry | 只提交一次校验后候选；pending/approved 依上表 | Store/WorkView 是事实；telemetry 仅诊断 | `app.test.ts:87-101`；`beat-pipeline.test.ts:156`；`prose-routes.test.ts:242` |
| 模型失败/超时/不可用 | advance HTTP 200 可为 `kind:"failed"`；专用命令 503/504 等；无 Pipeline 自动 retry | 保留原 head 和已批准上游；不写半成品 | `lastFailure` 仅进程内；显式重跑失败 Step | `app.test.ts:389,458`；`setting-pipeline.test.ts:144`；`prose-routes.test.ts:425` |
| 生成期间上游 id/version/status 改变 | `upstream-changed`；advance 可手动 retry；专用命令 commit 拒绝 | 过期候选不发布，竞争 head 保留 | Store CAS 是最终裁决；重新读取显式新基线 | `pipeline.test.ts:100`；`store.test.ts:167`；`chapter-start-baseline.test.ts:115` |
| 多步 advance 前步成功、后步失败 | 返回失败 Step；可显式续跑 | 前步已提交成果保留，无整单回滚 | Store + 当前状态；无自动恢复进程 | `app.test.ts:389` |
| 输出 bucket 已有 head 却仍请求首次生成 | CAS `head:null` 不匹配；不覆盖 | 不追加；既有 head 保留 | Store/调用方读取当前状态 | `store.test.ts:311-331`；`chapter-start-baseline.test.ts:92-113` |

### 3.2 pending/approved、保存、再生、通过与起章

| 组件与输入/状态 | 返回与 retry | 产物发布/写入 | 现场恢复 owner | 现有测试证据 |
|---|---|---|---|---|
| Creative 保存草稿 | 200 pending；无模型；旧基线 409，非法 ID 集 422 | 全方向、新 id/version+1；directionId 集必须等于当前 head | Store/GET；不自动重放 | `app.test.ts:268-337` |
| Creative 选定 | 200 approved；无模型 | 单方向、新 id/version+1，直接 approved，一次写入 | Store/GET；通用 approve 不替代 select | `app.test.ts:87-101,339-389` |
| Creative 整步再生 | 匹配 null/pending 基线才调用模型；成功新 pending head；旧/approved 基线拒绝 | 新 id/version+1；CAS 同时保护 caption 和 creative | CLI 冻结文件；unknown 不自动 GET/POST | `creative-regeneration.eval.test.ts`；`creative-cli.test.ts:128-158` |
| Outline 保存/专用通过 | 保存新 pending；专用通过同 id/version approved；同目标重放 no-op | 保存补全唯一 arc/segment ID；通过不增版、不清除无关失败记录 | 专用 CLI 只 POST 一次；通用 approve 保留当前 head 兼容语义 | `app.test.ts:537-681`；`outline-approval.test.ts`；`outline-cli.test.ts` |
| Setting 通过 | pending + 完整内容才可；同 id/version approved；重复/冲突 409 | 同版原子 finalize，不保存中间草稿、不追加 V2 | `matchesSettingSubmission` + 最多一次回读 | `setting-app.test.ts`；`setting-cli.test.ts`；`setting-submission.test.ts` |
| Setting 扩展 propose/approve/cancel | requestId 同请求重放返回原回执；异内容/旧基准冲突 | approve 在同一事务内追加 approved Setting + 更新 proposal；cancel 不写 Artifact；失败全回滚 | 持久 proposal + 精确 GET；无自动重 POST | `setting-extension.test.ts:88-330` |
| Beat 通过/再生 | 通过同版 approved；再生新 pending；模型/输入失败保留原 head | 通过保留卡片已有 ID；整份再生新 Artifact 和新卡 ID | `recoverBeatSubmission`；通过可精确确认，未知再生不自动认领 | `beat-pipeline.test.ts`；`beat-submission.test.ts` |
| Beat A/B 选择 | 不调用模型；`new` 只确认 B 仍 pending；`original` 追加 A-copy C | `new` 不写；`original` 新 id/version+1 pending，A/B/C 均保留 | 完整 comparison/selection 回执；仍需显式通过 | `beat-variant-selection.eval.test.ts`；`beat-variant-response.test.ts` |
| 历史章重生 | 先 pending Beat，通过后 pending Prose；后续章只提示连续性 | 旧版本和后续章保留，不自动重写 | 精确历史 GET + 当前 head；缺少旧 Prose.beat input 时拒绝推断 | `chapter-continuation.test.ts:225-359` |
| Prose 保存 pending/approved | 新 id/version+1，状态不变；pending 可空，approved 空白 422；无模型 | 原子 append，保留 inputs；旧 pending autosave 不得覆盖 approved | `recoverProseSubmission` 精确全文/身份/状态，最多一次回读 | `prose-routes.test.ts:61-190`；`prose-save.test.ts` |
| Prose 再生 | 当前 pending 草稿或显式历史重生绑定才允许；成功新 pending | 新 id/version+1；正文必须非空；失败保留当前全文 | 未知再生仅见新 head 仍 conflict，不自动重发 | `prose-pipeline.test.ts:109-278`；`prose-submission.test.ts` |
| Prose 通过 | 仅 pending 且全文非空；同 id/version approved | 同版 finalize；不自动生成下一章；通过后编辑走 save | 同 id/version/createdAt + 逐字符全文确认 | `prose-routes.test.ts:242-299`；`prose-cli.test.ts` |
| start-chapter | 要求章号连续、前章 Beat/Prose approved、Prose.inputs 指向当前 Beat、原请求基线匹配 | 成功只生成目标章 pending Beat；目标已存在时合法重放只读、无模型 | Store/WorkView；原文件不换基线，不自动 POST | `chapter-continuation.test.ts`；`chapter-start-baseline.test.ts`；`client-contract.test.ts:59-80` |
| 起章 commit/response 结果不明 | 500/传输错误不能推断未生成；不自动重试 | 已提交目标保留；重放目标地址不再调用模型 | 以目标章实际 head 对账；遥测不是回执 | `chapter-continuation.test.ts:421`；`sqlite-restart.test.ts:115-117` |

### 3.3 SQLite 重启、损坏和部分失败

| 输入/状态 | 返回与 retry | 写入/恢复 | owner 与证据 |
|---|---|---|---|
| 正常/强制重启，已提交数据 | 重开可读；不自动续跑模型 | heads、历史版本、状态、inputs 保留；进程遥测清空 | `sqlite-restart.test.ts`；`sqlite-process.test.ts:109-130` |
| 进程在确认前被强杀，事务未提交 | 重开不见未提交写入 | SQLite 回滚；无应用层半提交 | `sqlite-process.test.ts:119-130` |
| 两个连接/进程使用同一基线 | 一个成功，一个 version-conflict；无运行期自动 retry | 只有一个条件写入获胜 | `sqlite-process.test.ts:86-99`；`sqlite-store.test.ts:138-153` |
| 损坏文件、未来/未知 schema | 启动安全失败；不按 busy retry | 不删库、不重建、不 fallback 内存；无修复工具 | `sqlite-store.test.ts:54-85`；`sqlite-process.test.ts:72-83` |
| 持久 JSON/head 内容被篡改 | 读取安全失败，不泄露内容 | 不把坏数据当合法 WorkView；无自动修复 | `sqlite-store.test.ts:87-100`；`setting-extension.test.ts:272-315` |
| 事务中后一条 SQL 失败 | 整个操作失败；可修复原因后显式重试 | seed 多行、Setting append + proposal 均回滚 | `sqlite-store.test.ts:167-176`；`setting-extension.test.ts:316-330` |
| 初始化遇到允许的 BUSY | 有界等待/重试；其他错误不重试 | 获写锁后重读版本和结构；不改运行期 CAS retry | `sqlite-initialization.test.ts`；`sqlite-process.test.ts:59-107` |

### 3.4 CLI 成功、4xx/5xx、畸形和超时

| 输入/状态 | stdout/stderr 与 exit | 写入/重试与恢复 owner | 现有测试证据 |
|---|---|---|---|
| 成功命令 | stdout 一个 JSON，exit 0；stderr 可为空 | 按命令核对 schema 与资源关联；不额外写 | `command-entry.test.ts:228-236`；`outline-entry.test.ts:53` |
| `advance` HTTP 200 但业务 failed | stdout failed outcome，exit 0 | 不自动重试；调用方检查 kind | `command-entry.test.ts:239-246` |
| 合法普通 4xx | stderr 错误 JSON，exit 1，保留公开 code/issues | 不自动重 POST；普通包不伪造统一 writeOutcome | `outline-cli.test.ts:22-30`；`client-contract.test.ts:70-74` |
| 合法 Beat/Prose 拒绝 | 只有匹配 operation/target/baseline/code/status 且 `not-committed` 才可 rejected | 共享 recovery；可有一次 GET；更早 unknown 优先 | `beat-submission.test.ts:21-34`；`prose-submission.test.ts` |
| 5xx | stderr 错误；写操作按各自契约进入 unknown/保守恢复，普通错误包不新增统一 stage | 不自动重发；按各命令契约回读/人工检查 | `outline-cli.test.ts:32-47`；`creative-cli.test.ts:148-157`；`beat-submission.test.ts:30-33`；`cli.test.ts:120-137` |
| 畸形成功、畸形 4xx/5xx、错误资源/operation | `invalid-response`，写操作 unknown，exit 1 | 不自动重发；专用恢复只接受可匹配回读 | `client-contract.test.ts`；`beat-variant-response.test.ts` |
| HTTP 超时/网络中断 | `network-error`，exit 1；服务端可能已提交 | 不自动重复 POST；Setting/Beat/Prose 最多一次回读；其余按各自说明检查 | `cli.test.ts:53-75`；`prose-cli.test.ts:98`；`outline-cli.test.ts:32-47` |
| run-step provider/模型失败 | stdout 为空，stderr 含安全 failed 详情，exit 1 | 不写作品；按 SDK 节点 retry 规则，CLI 不再重发 | `step-transport.test.ts:434-454`；`isolated-runner.test.ts:49-54` |
| run-step CLI deadline | stderr `network-error`，exit 1，worker 被终止；provider 是否停止不作保证 | 不写作品；记录目录 best-effort 写 unknown/incomplete，不自动复跑 | `step-transport.test.ts:404-432` |

### 3.5 记录目录成功、冲突、部分写入和 unknown

| 输入/状态 | 对外结果 | 文件写入与恢复 owner | 现有证据与停止前动作 |
|---|---|---|---|
| 显式新目录 + 成功 | `kind:"succeeded"`，`recording.status:"complete"` | worker 依次发布 input/invocation/result/meta，最终 meta complete；0700/0600 | `step-transport.test.ts:32-61`；`isolated-runner.test.ts:111-141` |
| 调用前输入/guard 失败 | `kind:"failed"`，可完整记录 | invocation `captured:false` 和 null，不伪造模型输入；result failed | `isolated-runner.test.ts:143-157` |
| 目标/父级 symlink、目录已存在或文件碰撞 | CLI/worker 拒绝，模型未调用（准备阶段） | 原目录/文件不覆盖；显式换全新目录 | `step-transport.test.ts:118-156`；`isolated-runner.test.ts:201-215` |
| worker 启动记录失败 | `recording-failed` / `recording.status:"failed"` | 可有部分目录；meta 非 complete 时才可作部分证据；无自动修复 | `isolated-runner.test.ts:201-215`（文件碰撞） |
| result 已发布、最终 meta 更新失败 | Step 结果与归档结果是不同事实；`finish` 返回 recording failed | 已写 result 保留，目录不得被当 complete；无目录回滚 | 实现：`step-record.ts:118-132`；Step 4 由 M5 补齐故障注入与 unknown 收尾 |
| CLI timeout/worker 失败 | CLI 原错误优先，不宣称 provider 已取消 | CLI best-effort 保留 invocation，补 result unknown（若尚无 result）和 meta incomplete；已 complete 不覆盖 | timeout：`step-transport.test.ts:404-432`；独立 worker-failure 由 Step 4 M8 补齐 |
| worker stdout 畸形/关联 stepId 错误 | CLI `invalid-response`，exit 1，不自动复跑 | 不写作品；记录以实际 meta 为准，不能据 CLI 成败改写历史 | 实现：`local-step.ts:94-101`；Step 4 M9 分别验证两类响应及目录原状态 |

## 4. 状态与资源 owner（冻结事实）

| 资源 | 谁写、commit 点 | 谁恢复/读取 | 失败归宿 | 为什么不会自动重复副作用 |
|---|---|---|---|---|
| WorkStore / SQLite works | `SqliteStore.createWork` 在 IMMEDIATE 事务 INSERT；内存实现同步 Map 写入 | 同数据目录重开 Store | 输入/响应失败按普通/专用契约；无隐式内存 fallback | CLI 不自动重 POST。**普通 create 没有幂等键，人工重复可创建两个作品，不能宣称 exactly-once。** |
| Artifact versions | append/save  INSERT 新 id/version；finalize UPDATE 同 id/version；Setting 扩展两个写操作同事务 | `getWork` 读 head；`getArtifactVersion` 读精确历史 | CAS/校验失败无新版；commit 后异常为 unknown 或安全 500 | 目标 head:null、id/version/status 和上游 CAS；进程内 per-work 锁减少同进程竞争，SQLite 事务裁决跨连接竞争 |
| Artifact.inputs | Pipeline 在实际取样时生成，随 Artifact 同事务写入；save/finalize 保留 | WorkView 连续性投影、精确历史读取 | 上游变化只拒绝新提交或标连续性提示，不改旧 inputs | 同一 Artifact 写一次；不异步补写、不级联重写 |
| Pipeline 生成锁与 lastFailure | 进程内 Set/Map；finally 释放锁；成功推进/人工通过按规则清失败 | 当前进程 Pipeline | 重启即失；不是持久回执 | 锁只防同进程并发生成，不能当跨进程 lease；跨进程由 CAS 兜底 |
| LLM/provider 调用 | `callLlm` 在 DB 事务外调用 `generateObject` | 无自动续跑；作者显式新操作 | 安全错误和 telemetry；既有 Artifact 不动 | Caption/Creative/Outline 可由 SDK 默认 retry，Setting/Beat/Prose 为 0；**外部调用不保证 exactly-once 或零重复费用，本 loop 不得伪造此保证。** |
| 进程内 LLM/命令遥测 | 两个独立全局 1000 条环形缓冲；请求作用域另存有界副本 | `diagnosticsFor`/HTTP logs；仅当前进程 | 记录失败 best effort，不改变业务结果；重启清空 | 只记录已发生事实，不触发业务写入；空窗口不能证明未执行 |
| 作者配置 SQLite 行 | requestId + expectedRevision CAS；同事务查旧回执或插入新 revision | `getAuthorConfigReceipt` / 当前 revision | 旧 revision/同 ID 异内容 409；响应 unknown 可按 requestId 对账 | 同 requestId 同内容返回原回执，不重复新增 revision |
| 受管 Prompt/Skill 文件 + 元数据 | 0600 临时文件/fsync → exclusive hardlink 发布/fsync 目录 → SQLite 元数据 commit | `AuthorConfigService.readText` 校验路径、长度、SHA；操作读取同一快照 | DB 失败可留无引用 orphan；只在 id/hash/内容一致时复用；无删除入口 | 同 ID 同文本返回旧文件；并发发布不覆盖；配置保存不改变 Artifact |
| BadExample / SettingExtension 操作记录 | requestId 查旧并校验原请求；SQLite 事务写入 | 按 requestId GET；扩展 candidate 精确历史复验 | 同 ID 异请求冲突；扩展 approve 任一格失败全回滚 | 同内容重放返回原回执，不重复创建 |
| 实验记录目录 | CLI 预留新目录；worker 写 input/invocation/meta，调用后写 result 并替换 meta；CLI 只在传输 unknown 时 best-effort 收尾 | Agent/Harness 以 meta complete 双条件读取；原目录只读保留 | 碰撞拒绝；部分目录保留；无自动 quarantine/backup/修复 | 新目录和独占发布防覆盖；复跑必须显式使用另一新目录；文件级原子不等于目录事务 |
| 静态 Web 文件 | 只读，无运行期写入 | 已校验真实路径内的构建文件 | 不可读返回 next/启动失败，不改源码 | N/A：无副作用，不引入发布/恢复状态 |

## 5. 测试分类

分类依据是实际调用 seam 和断言，不是文件名。A 保留；B 只有在独特断言迁移后才能合并；C 先迁移到公开入口再改实现；D 只能随已证明的死代码删除。

### 5.1 A：契约测试，保留

| 边界 | 具体文件/测试与保留理由 |
|---|---|
| 共享 Zod/Artifact/HTTP | `packages/contracts/test/artifact-validation.test.ts` 同时检查 Artifact、WorkDetail、WorkView；`public-api.test.ts` 检查归属路径、唯一 head、错误 metadata；`step.test.ts` 检查输入输出边界；`step-experiment.test.ts` 检查六节点成功包和四文件形状。这些直接守住公开 schema。 |
| 提交匹配与恢复 | `beat-submission.test.ts` 的 5xx/旧 unknown/删除卡身份，`prose-submission.test.ts` 的精确全文与未知再生，`prose-save.test.ts` 的同状态保存，`setting-submission.test.ts` 的新旧 ID，`outline-approval.test.ts` 的显式目标，`chapter-continuation.test.ts` 的章号关联。它们不是可由 HTTP status 替代的重复测试。 |
| Store 两适配器与 SQLite | `store.test.ts`/`store-validation.test.ts` 对 memory/sqlite 运行同一行为；`sqlite-store.test.ts` 检查物理约束和损坏；`sqlite-process.test.ts` 用独立进程证明 CAS、强杀恢复；`sqlite-restart.test.ts` 用真实 CLI/生产进程证明两章、历史和 pending 恢复；`setting-extension.test.ts:316` 证明双写回滚。 |
| Pipeline/HTTP | `pipeline.test.ts` 的 output/head、上游变化、锁和失败；`app.test.ts` 的 Creative/Outline 路由与 post-write 响应失败；`beat-pipeline.test.ts`、`prose-pipeline.test.ts`、`prose-routes.test.ts` 的阶段、unknown、保存/通过；`chapter-start-baseline.test.ts` 的真实跨连接基线；`setting-app.test.ts`、`setting-pipeline.test.ts`、`creative-regeneration*.test.ts` 的专用语义。 |
| CLI 进程与 transport | `command-entry.test.ts` 的零 I/O help、严格语法、stdout/stderr/exit；`client-contract.test.ts` 的错误资源和 malformed 4xx；`outline-cli.test.ts` 的单 POST unknown；`setting-cli.test.ts`/`prose-cli.test.ts` 的一次回读；`creative-cli.test.ts` 的不自动 GET/重发；`validation-issues-entry.test.ts` 的真实 stderr metadata；`step-transport.test.ts` 的 loopback provider、文件权限、路径和 deadline。 |
| 模型与安全 | `caption-step.test.ts`、`setting-step.test.ts`、`beat-step.test.ts`、`prose-step.test.ts` 检查 SDK 错误、retry 和安全诊断；`llm.test.ts`/`kimi-provider.test.ts` 只用合成 env 和本地 mock；`server-startup.test.ts` 检查安全启动；`author-config.test.ts`/`author-config-pipeline.test.ts` 检查文件和快照；`static-web.test.ts` 检查 path/symlink。 |

### 5.2 B：可合并的重复测试（候选，先迁移独特断言）

| 重复点 | 实际重叠与独特信息 | 处理依据/公开 seam |
|---|---|---|
| `apps/server/test/beat-pipeline.test.ts:320-326` vs `packages/contracts/test/artifact-validation.test.ts:8-13` | 二者都只向 `workViewSchema` 传入缺字段 Beat 并断言拒绝；server 用例先 GET 只是构造 fixture，最后不断言 HTTP 行为 | contracts 已有六 kind 同边界表驱动用例；可删除 server 的纯重复断言，保留其 HTTP 前序其它测试 |
| `apps/server/test/isolated-runner.test.ts:217-224` vs `packages/contracts/test/step-experiment.test.ts:35-48` | chapter 合法/非法和 systemPrompt 上限重复；server 文件仅直接 parse contracts schema。oversized seed 是独特覆盖 | 把 oversized seed 移到 contracts 对应测试后删除 server 的重复 schema-only 用例；公开 seam 仍是 `stepExperimentRequestSchema` |
| `packages/contracts/test/public-api.test.ts:8-22` vs `artifact-validation.test.ts:20-25` | foreign work 和 duplicate head 拒绝重复；前者另有 issue path、不同章/kind 可共存的独特断言 | 将独特 path/正例合并进一个文件后再删另一处，不能直接整文件删除 |
| `apps/server/test/isolated-runner.test.ts:95-101` vs `packages/contracts/test/step-experiment.test.ts:27-38` | workId、config.systemPrompt、空白 SP 都属于同一请求 strict/覆盖边界 | 可合并到 contracts 表；不减少任何非法输入案例 |

明确不列为 B：`step.test.ts` 的 runStep 非法输出与 `pipeline.test.ts` 的失败 outcome/no-commit 是不同层级；`artifact-validation.test.ts` 与 `prose-save.test.ts` 分别守住通用 Artifact 状态映射和 Prose 专用请求/响应，不能为少几个用例消除任一视角。

### 5.3 C：实现耦合，需迁移到公开入口

| 文件/测试 | 耦合证据 | 迁移要求 |
|---|---|---|
| `apps/server/test/beat-pipeline.test.ts:309-318` | 直接调用 `step.run`，再手工 parse 内容，绕过共享 `runStep` 输入/输出边界 | 改为 `runStep(createFakeBeatStep(), ...)`；保留“再生新卡 ID、意见进入结果”的断言 |
| `apps/server/test/author-guidance.test.ts:8-17` | 直接调用 Fake/Real Caption 的 `.run` | 经 `runStep` 驱动；仍可检查 mocked `callLlm` 的实际 system/config，不把 prompt 拼法重写进 fake 预期 |
| `apps/server/test/sqlite-initialization.test.ts:75-154` | 五个用例直接调用内部 `initializeSqliteDatabase`，绑定 helper 签名和 options | 若调整初始化实现，先迁移到 `SqliteStore` 构造/独立进程公开装配，保留 stage、attempts、busy_timeout 和真实锁断言；现有 49/59 行两个 constructor 用例是必须保留的 A 类样板 |

### 5.4 D：只服务死代码，才可随死代码删除

- `WorkStore.headVersion`：范围内生产源码只有接口声明和两个实现（`work-store.ts:68`、`in-memory-store.ts:261`、`sqlite-store.ts:235`），没有生产调用方。`store.test.ts:157-165` 是唯一只验证该方法的测试，可随方法删除。
- **不能误删其它测试**：`store-validation.test.ts:23,36`、`app.test.ts:121`、`sqlite-store.test.ts:96`、`store.test.ts:182,204,328,402,449,464`、`outline-approval.test.ts:44,161` 只是用该方法辅助断言无新版/当前版。先把这些断言改为 `getWork` head，再删方法。
- `telemetryCursor`：生产只有定义（`steps/telemetry.ts:57`），唯一调用是 `setting-step.test.ts:97`。没有只服务它的独立测试；删除 helper 时把该测试改为对 `telemetryFor(workId)` 的调用前后差集或按 attempt 过滤，不能删除“模型成功但 commit 过期”的整条测试。
- `parseArtifactContent` 虽无仓内调用，但经 `contracts/src/index.ts:24` 公开导出且由契约治理明确列为共享入口，不按 D 删除。`InMemoryStore`、`resetTelemetry` 和 FakeStep 都有明确测试/演示职责，也不按死代码处理。
- 未证明存在可整文件删除的 D 类测试。

## 6. Step 1–3 候选与删减

### 6.1 Step 1：死代码、重复测试、失效注释/文档

| 候选独立提交 | 调用证据 | 减少的状态/来源/调用层级 | 公开验证 seam |
|---|---|---|---|
| 删除 `WorkStore.headVersion` 及两个实现；先迁移辅助断言，再删 D 类专用测试 | 生产调用为零，证据见 5.4 | 少 1 个 Store 读接口、2 份实现、1 条只服务它的测试；head 只剩 `getWork`/精确历史公开语义 | `store.test.ts`、`store-validation.test.ts`、`outline-approval.test.ts` 和 SQLite 全套；不断言版本行为改变 |
| 删除 `telemetryCursor` | 生产调用为零，仅 `setting-step.test.ts:97` 使用 | 少 1 个只服务测试的内部 helper，不减少业务状态 | `setting-step.test.ts:73-104` 仍须证明模型 ok 与 commit 失败分离 |
| 合并 5.2 的 B 类重复测试 | 逐条重叠和独特断言已列 | 少重复的 schema-only 断言，不减少任何非法输入或公开边界 | contracts/CLI/server focused 全量对照迁移前后案例清单 |
| 修正失效注释：`pipeline.ts:77,348`、`llm-call.ts:70`、`telemetry.ts:15-17`、`routes/works.ts:547`、`fake-step.ts:12` | 当前已有 SQLite 事务、六步链、Setting/Beat/Prose 均为 maxRetries 0、遥测为 request scope、demo 取决于所选 provider | 删除 5 个文件中 6 处会误导后续修改的第二“事实来源”；无运行状态变化 | 注释与 `sqlite-store.ts`、`production-app.ts`、`llm-call.ts` 实际行为交叉检查；不做 prompt 文案或模型行为改动 |
| 两处文档漂移单独形成一个文档/注释 cleanup commit：`docs/schema.md:343` 改为精确历史 GET 与 Beat A/B 语义；`docs/handoff.md:106` 改为四文件私有记录、非作品级数据库 | 精确历史 GET 与 A/B：`chapter-continuation.test.ts:225-300`、`beat-variant-selection.eval.test.ts`；四文件：`step-experiment.ts:117-136`、`step-transport.test.ts:32-61` | 删除 2 处陈旧事实来源；无行为、schema 或运行状态变化，不与代码/测试清理混提 | 对照精确历史 GET、Beat A/B 和四文件当前实现校验文档语义；不访问 provider，不把文档清理当行为变更 |

不做：借 Step 1 改 Wiki 或扩大 `docs/schema.md`/`docs/handoff.md` 的清理范围、删除公开但仓内未调用的 contracts export、把“测试看起来相似”当删除理由。

### 6.2 Step 2：先大后小重构

**大结构候选：无。** 当前没有足够用户目标收益证明应拆 Pipeline、引入新 orchestration、合并 Store 或建立通用恢复框架。保留现有两个真 seam：Store 与 Step。

**小实现候选（仅一项，独立 commit）：收敛 Beat/Prose 命令观察中的重复写入结果判定。**

- 调用证据：`observeBeat` 被 `pipeline.ts:279,351`、`beat-review.ts:30`、`routes/works.ts:246` 使用；`observeProse` 被 `pipeline.ts:282,531`、`prose-review.ts:31,43`、`routes/works.ts:322` 使用。`beat-command.ts:18-60` 与 `prose-command.ts:18-60` 的 response unknown、prewrite 集合和 `writeOutcome` 公式逐行重复。
- 候选做法：保留 `observeBeat`/`observeProse`、kind-specific schema、operation 和公开错误类型，内部提取一个参数化 observation helper；不得统一 Beat/Prose submission recovery，也不改 HTTP 形状。
- 减少的来源：同一“commit/response 后失败必须 unknown”的决策点由 2 份降为 1 份；不减少业务状态，不增加调用层级。
- 公开验证 seam：现有 `beat-pipeline.test.ts:343`、`prose-pipeline.test.ts:251,280`、`prose-routes.test.ts:160,382`、两类 submission tests 和 CLI client/executable tests；另跑第 7.4 节 M2 mutation。
- 收益边界：若提取时需要把 kind 特例改成多路 if/switch、改变错误类型或让测试复用该 helper 生成预期，则放弃，不为“更少行数”继续。

C 类测试迁移可先形成 test-only commit，再接实现 commit；大改、小改、命名不得混在同一 commit。

### 6.3 Step 3：术语表与命名冲突

以下术语在本文冻结。Step 3 先按表核对内部命名；公开 wire 字段改名不属于本 loop。

| 术语 | 冻结含义与冲突处理 |
|---|---|
| head / version / artifactId | head 是某地址最大 version；append/save/regenerate 通常换 artifactId，finalize 不换。不要把 head 当作“id 永远不变的一组版本”。 |
| pending / approved | 作者关卡状态，不是模型执行状态，也不是实验记录状态。 |
| requestId（命令观察） | 每次 HTTP attempt 的关联 ID，不是幂等键；Beat/Prose 重试得到新 ID。 |
| requestId（配置/文件/坏例/设定扩展请求） | 客户端提供的操作身份，用于同内容重放对账/去重。字段同名但语义不同，靠上下文区分，禁止互相套用。 |
| attemptId | 一次实际 LLM 尝试；不同于 HTTP requestId、runId。 |
| runId | 一次 isolated Step 实验身份，不是作品 ID，也不证明关联作品当前版本。 |
| processInstanceId | 当前进程诊断窗口身份；重启改变，不能当持久操作回执。 |
| writeOutcome / failureStage | 命令实际写入结论与阶段；不由 HTTP status 或 LLM ok 单独推导。 |
| result.status / meta.status / recording.status | 分别是 Step 结果、目录完成状态和响应中的归档结果；不得以任一字段替代 `meta.complete && meta.status` 双条件。 |
| output / content / raw | Step output 经 schema 和 ID 注入后是最终 content；记录不包含 provider raw 输出。 |
| unknown | 已提交与否无法由现有证据确定；不是“确定失败”或“未提交”，也不会被后续拒绝自动清除。 |
| commit | Store 的事务/同步写入提交；实验记录只有文件发布与 meta 完成，没有目录级 commit。 |

当前没有收益足够的新生产 symbol 改名候选。尤其不改公开 `requestId`、不统一所有 status、不借用 finalizer/RunSpec 名称。`headVersion` 和 `telemetryCursor` 的移除在 Step 1，不混入命名 commit。

### 6.4 明确删除“不做”的改法

1. 不把 Pipeline 拆成通用 workflow/finalizer，不抽象一套 generation/recovery 状态机：六类操作的关卡和恢复差异是真实契约，行数减少不足以抵消风险。
2. 不合并 Beat/Prose submission recovery、不合并 CLI 与 worker 的记录文件写入策略：共享数据结构不等于共享业务策略。
3. 不新增通用 redaction/logger、staging/backup/quarantine、持久遥测、自动模型恢复、数据库实验账本或新 lint/vet 工具：均超出现有目标和证据。
4. 不把 Caption/Creative/Outline 的 SDK retry 一律改 0，不给普通 create 增加幂等键，不自动重放 unknown：这些是契约变化，不是重构。
5. 不修改 prompt/SKILL 文案、模型默认值、公开字段名或历史数据；不夹带 Hono RPC、Web、依赖升级。
6. 不因“还可以更优雅”提取共享 schema helper。`creative.ts:15` 已明确三类 hint 刻意不公共化，不能推翻既有设计理由。

## 7. 验证与停止门

### 7.1 focused 与范围内全量

每个改动切片先按实际触及面运行，例如：

```bash
pnpm --filter @agent4novel/contracts exec vitest run test/step-experiment.test.ts test/artifact-validation.test.ts
pnpm --filter @agent4novel/server exec vitest run test/store.test.ts test/store-validation.test.ts test/sqlite-initialization.test.ts
pnpm --filter @agent4novel/server exec vitest run test/beat-pipeline.test.ts test/prose-pipeline.test.ts test/prose-routes.test.ts
pnpm --filter @agent4novel/cli exec vitest run test/client-contract.test.ts test/validation-issues-entry.test.ts test/step-transport.test.ts
```

Step 4 的“全量”是本任务范围的 contracts/CLI/server 全量，不借用其他项目的 chatty 命令，也不以根目录全仓 Web 测试替代：

```bash
pnpm --filter @agent4novel/contracts test
pnpm --filter @agent4novel/cli test
pnpm --filter @agent4novel/server test
```

### 7.2 typecheck/build、vet/lint 和差异检查

```bash
pnpm --filter @agent4novel/contracts typecheck
pnpm --filter @agent4novel/cli typecheck
pnpm --filter @agent4novel/server typecheck
pnpm --filter @agent4novel/server build
```

- contracts 和 CLI 没有 build script，记 N/A；server build 是现有 `apps/server/scripts/build.mjs`。
- 根、`apps/server`、`apps/cli`、`packages/contracts` 的 manifest 均没有 lint、vet 或 format script；本仓此范围没有对应现有命令，记 N/A，不安装或发明替代门禁。
- 仍需按 ticket checklist 做 `git diff --check <fixed-point>`、精确 manifest/patch 和 secret/危险联网审查；未跟踪文件单独检查。

### 7.3 独立 review

- 对可标识的完整候选 tree 做 Standards 与 Spec 双轴 review；reviewer 不得参与该候选实现。固定点为 `51b713e`，每个实质修复生成新候选并重跑受影响门禁。
- Spec 对照本基线和用户确认的范围/非目标；Standards 对照仓库指令、契约治理、ADR、领域词、安全和测试惯例。
- review 定点要求没有尚未处理的可执行问题；“建议更优雅”不构成新问题，安全、逻辑、数据损坏或契约偏差必须处理。

### 7.4 可独立变红的 mutation 用例

每个 mutation 必须单独注入、先证明对应测试变红，再恢复实现并转绿；不得把多个 mutation 合并后声称都已证明。fake 只提供 transport、时钟、独立连接、进程退出或文件系统故障，不得调用生产 recovery/CAS/record policy 预先生成预期答案。

| mutation | 必须独立变红的公开验证 | 反自欺证据 |
|---|---|---|
| M1：删除/后移 SQLite save 或 append 的 precondition 检查 | `store.test.ts:167,451`、`sqlite-process.test.ts:86`：过期写入被拒绝且只有一版 | 两个真实独立连接/进程竞争，非用生产 CAS 计算预期 |
| M2：把 commit/response 后异常错报为 `not-committed` | `beat-pipeline.test.ts:343`、`prose-routes.test.ts:160,382` | adapter 先调用真实 super 写入再抛错，实际 head 已改变 |
| M3：CLI 丢弃 `issueCount/issuesTruncated` 或过滤必需 issues | `validation-issues-entry.test.ts:92-113` | 真实 CLI 进程 + loopback 返回 1/129 条，直接检查 stderr JSON |
| M4：提交匹配误接受被删除旧卡 ID 或外来 ID | `beat-submission.test.ts:41-44`、`setting-submission.test.ts:26-35,54-57` | 请求明确省略/替换 ID，候选却沿用旧身份，matcher 必须拒绝 |
| M5：忽略 result 已写后的 meta 失败，或把 partial 记录标成 complete | **owner：worker `StepRecorder.finish` 与 CLI `markStepRecordUnknown`。Step 4 新增测试**，真实 writer 发布 result 后仅让最终 meta 替换失败；再执行真实 unknown 收尾，目录仍不得被读取为 complete | 只 fault-inject 文件系统错误；检查真实四文件和 meta 双条件，不 mock `StepRecorder.finish`/`markStepRecordUnknown` 自身来预答 |
| M6：把 `SQLITE_LOCKED`/迁移 SQL 错误纳入初始化 retry | `sqlite-initialization.test.ts:75-109` 和独立进程诊断 | 真实 SQLite 错误，断言 attempt=1、结构可恢复且内容保留 |
| M7：目标 Beat 已存在时 start-chapter 重放再次调用模型 | `chapter-start-baseline.test.ts:92-113`、`sqlite-restart.test.ts:115-117` | 统计 Step 调用和 Artifact 行数，重放只读且不创建下一章 |
| M8：独立 worker-failure 后跳过 unknown 收尾或错误标记 complete | **owner：`local-step.ts` 的 worker-failure 路径与 `step-record.ts` 的 unknown 收尾。Step 4 新增非 deadline 进程失败测试**，断言原 CLI 错误优先、已有 invocation 保留、尚无 result 时补 unknown、meta incomplete 且不自动复跑 | 单独控制 worker 退出而非复用 timeout；只注入进程失败并检查真实文件，不用 `markStepRecordUnknown` 生成预期 |
| M9：worker stdout 畸形或 stepId 不匹配时误报成功或错改记录目录 | **owner：`local-step.ts` 的响应 schema/关联校验与实际 record meta。Step 4 分别注入畸形 stdout、合法但 stepId 不匹配的响应**，断言 `invalid-response`、exit 1、无复跑；worker 已写 complete 则保持 complete，尚未 complete 则不得升级，不虚构 unknown 或 complete | 两个独立 worker/stdout 场景；只控制响应文本或 stepId，对响应前后真实目录做精确比较，不用生产 response policy 预答 |

M5、M8、M9 是当前待补证据，均已有 owner 和停止前动作；Step 4 必须分别完成可红后转绿，不得合并证明。M 列表不增加读取侧 schema 交叉校验 mutation；该工作按第 8.1 节属于独立任务。

### 7.5 五道停止门的可检查条件

1. **契约闭合**：第 3 节每行有确定结果和正确 N/A；第 8.1 节的 JSON schema 形状与独立任务边界未被突破；没有借重构改变公开行为或 JSON schema。
2. **状态闭合**：第 4 节每个副作用都有 owner、commit 点、失败归宿和防自动重复说明；没有虚构 exactly-once。
3. **规则闭合**：同一概念只有一个决定点；候选合并未制造第二套 CAS、恢复、重试、记录或术语来源。
4. **证据闭合**：focused + 三包全量 + typecheck/build 全绿；M1–M9 各自证明可红后转绿；测试没有复用生产 policy 预答。
5. **review 定点**：固定候选 tree 的双轴独立 review 无未处理可执行问题；实质变化已使旧结论失效并重新审核。

## 8. 冻结边界、证据收口与文档清理

### 8.1 记录 schema 冻结边界与明确非目标

本 loop 不因简化改变 JSON schema，`stepExperimentRecordResultSchema` 的当前形状冻结。当前 writer 与 worker 公共 response 已有各自的现行校验：`makeStepExperimentRecordResult` 经记录 schema 解析，worker 写出前和 CLI 接收后均经 `stepExperimentResponseSchema` 解析。

读取侧语义补强——`succeeded/null`、`failed/content` 以及 content 与 `meta.stepId` 的交叉校验——属于另一个独立任务，不在本 loop 范围内。它不是未决项或停止门阻塞项，M 列表也不增加这类 schema mutation。此处仅应用用户既定的冻结约束，不扩大历史授权。

### 8.2 记录证据 owner 与停止前动作

当前三项证据缺口均已有 owner；停止前必须分别完成第 7.4 节对应验证，不能只报告缺口：

1. **result 已写、最终 meta 替换失败**：owner 是 worker `StepRecorder.finish` 与 CLI `markStepRecordUnknown`。Step 4 执行 M5，真实产生部分记录并验证 unknown 收尾和 meta 双条件。
2. **独立 worker-failure**：owner 是 `local-step.ts` 的进程失败路径与 `step-record.ts` 的 unknown 收尾。Step 4 执行 M8，不复用 deadline 场景，独立证明原错误、已有证据和 incomplete 归宿。
3. **worker stdout 畸形或 stepId 不匹配**：owner 是 `local-step.ts` 的响应 schema/关联校验与实际 record meta。Step 4 执行 M9 的两个独立场景，验证 CLI 拒绝且不改变响应前已形成的目录事实。

### 8.3 Step 1 文档/注释 cleanup（独立 commit 候选，不改行为）

- `docs/schema.md:343`：Step 1 将旧“没有历史读取、比较、选择或回退入口”改为当前的精确 ID/version 历史 GET 与 Beat A/B 比较、选择语义。
- `docs/handoff.md:106`：Step 1 将旧“run-step 不持久化实验账本”改为当前四文件私有记录，并明确不是作品级数据库。

两处合入一个独立的文档/注释 cleanup commit 候选，不与代码、测试或重构混提；只使文档回到当前实现，不改变行为。本 Step 0 未修改这两处。

除上述已明确边界和动作的事项外无额外未决项或假设。GitHub issue/PR 未按禁令访问；本基线不重新判定票面 AC，也不把历史 Wiki 的完成证据当本候选验证结果。
