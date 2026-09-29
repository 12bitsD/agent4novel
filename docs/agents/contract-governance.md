# 契约管理 — 按边界维护同一份可执行定义

契约的执行定义归代码，领域含义归领域文档，每票的设计理由归 Wiki。此归属在 #13 设计访谈中于 2026-09-05 确认；#13 先落实自身契约，跨模块收敛另开治理票。

## 权威来源

沿用现有 [Wiki 信息边界](../wiki/README.md#信息边界)，不把所有内容复制进 Wiki。

| 内容 | 唯一归属 | 其他来源的用法 |
|---|---|---|
| 领域术语及禁用同义词 | [CONTEXT.md](../../CONTEXT.md) | 直接使用并链接 |
| 数据模型、内容形态、不变量及持久化语义 | [docs/schema.md](../schema.md) | Wiki 解释为何变化，代码实现它 |
| 对外内容、请求、响应、错误契约 | `packages/contracts` | Zod 定义派生类型；消费者复用 |
| 无服务端 ID 的内容变体 | `packages/contracts` 的共享内容 schema 派生 | 例如 SettingDraft，避免生成／请求／存储规则漂移 |
| Step 私有输入与 I/O 包装 | 服务端各 `*-io.ts` | 复用共享内容变体，私有调度字段不提升为公共协议 |
| 每票范围和验收标准 | GitHub issue | Wiki 链接票面，记录实现方案 |
| 每票设计理由、落点与演进 | `docs/wiki/NNN-*.md` | 代码和测试负责当前可执行事实 |
| 难以逆转的跨票架构决定 | `docs/adr/` | Wiki 引用，不另写一套决定 |

## 变更如何交付

每次新增或修改契约，交付 Agent 在该票实现与 review 前确认影响到的生产者、消费者和存储边界。完成步骤仍以 [Ticket 完成审核清单](./ticket-completion-checklist.md) 为唯一来源，本页只说明契约归属。

- 公开的内容／请求／响应定义放入 `packages/contracts`，Web、CLI、路由、测试复用或派生，避免平行维护手写 DTO。
- 模型输出只含模型负责的内容。服务端生成的 ID、状态和版本不交由模型决定；存储边界再次验证最终内容。
- 代码变更时同步 schema 与本票 Wiki；术语变化才更新 CONTEXT。尚未实现的设计必须明确标注，并保留当前可执行契约的入口。

## 现行契约清单

以下清单覆盖 #19 的六类产物、全部作品 REST 接口和 CLI 独立节点协议。它描述定义与运行时责任；本次测试结果和完成状态见 [Wiki 019](../wiki/019-contract-governance.md)。表中的 contracts 路径均相对于 [`packages/contracts/src`](../../packages/contracts/src/)，服务端私有定义相对于 [`apps/server/src`](../../apps/server/src/)。

### 内容、身份与快照

| 定义与 owner | 生产者 → 消费者 | 验证责任／复用方式 |
|---|---|---|
| `caption.ts`：`captionElementSchema`、`captionContentSchema` | Caption Step → Store、Creative/Setting Step、Web | Step 校验模型内容；共享注册表负责最终产物内容验证 |
| `creative.ts`：三类 hint、`creativePackSchema`、`creativeContentSchema` | Creative Step、创意稿编辑与方向选择 → Store、Outline/Setting Step、Web/CLI | 无 ID 的 LLM 形态从 pack 派生；服务端注入 `directionId`；方向数量／是否已选择仍由对应业务关卡判断 |
| `outline.ts`：segment、arc、content、draft | Outline Step、作者编辑 → Store、Setting/Beat Step、Web/CLI | LLM 形态去除 ID；人工 draft 允许新增项省略 ID；两者均从完整形态派生并共享数量边界，入库前补 ID |
| `setting.ts`：content、draft、reviewDraft、artifact、通过请求/响应 | Setting Step、作者通过 → Store、Beat/Prose Step、Web/CLI | 模型不提供 ID，人工新增项可省略 ID，存储内容必须有 ID；通过响应限定 approved |
| `beat.ts`：content、draft、editDraft、reviewDraft、artifact、request head、通过/再生请求 | Beat Step、作者审阅 → Store、Prose/下一章 Step、Web/CLI | 保留生成、编辑、通过三种完整度；最终产物必须是完整 content，章号与版本为正安全整数 |
| `prose.ts`：content、editDraft、artifact、request head、保存/通过/再生请求 | Prose Step、自动保存、作者通过 → Store、下一章 Step、Web/CLI | pending 可以保存空稿；approved 与模型生成要求非空全文；纯文本空白不被 trim 转换 |
| `artifact-envelope.ts`：kind/status、JSON、input refs、envelope | Store、专用 Artifact schema → 全包 | 持有共享身份与传输外壳，避免内容 schema 相互循环引用；envelope 单独不证明 content 合法 |
| `artifact-content.ts`：`artifactContentSchemas`、`artifactContentSchemaFor`、`parseArtifactContent` | 各内容 schema → Artifact、Store、跨进程节点结果 | 六 kind 的唯一内容映射；按状态选择 pending Prose 编辑形态，其余使用完整内容 |
| `artifacts.ts`：Artifact、Work、WorkDetail、章目录、续写请求、WorkView envelope | Store、Pipeline、路由 → Web/CLI | `artifactSchema` 统一校验 kind/content/status/chapter；WorkDetail 与 WorkView 共用作品归属与唯一 head 校验；input refs 验证 kind/chapter 匹配 |
| `step.ts`：AgentConfig、generationParameters、Step/runStep | Work／运行配置 → Pipeline、ModelRuntime、Step | 配置 schema 拒绝未知字段；`runStep` 验证具体 Step 输入与输出；运行配置不等于新增作者配置 API |

`Artifact` 的通用 TypeScript 外壳仍能承载 JSON 内容；可信度来自 `artifactSchema` 的运行时映射验证，不能只凭类型断言跳过边界。特定 kind 的消费点仍可使用专用 Artifact/content schema，避免把 TypeScript 表示与验证责任混为一谈。

### 公开 REST 请求与响应

除 `/api/config` 由 [`app.ts`](../../apps/server/src/app.ts) 提供，以下路由均由 [`routes/works.ts`](../../apps/server/src/routes/works.ts) 提供。请求在路由解析；服务端成功响应在 `contractJson` 或已有专用命令响应入口验证；Web/CLI 再验证实际收到的响应，并在需要时核对 workId、目标 kind、版本或冻结请求。

| 接口（省略 `/api/works/:id` 前缀） | 请求定义 | 成功响应定义 | 消费者 |
|---|---|---|---|
| `GET /api/config` | 无 body | `public-api.ts`：`appConfigSchema` / AppConfig | Web、CLI config |
| `GET /api/works` | 无 body | `work-requests.ts`：`workListResponseSchema` / `workSummarySchema` | 书架、CLI list |
| `POST /api/works` | `work-requests.ts`：`workCreateRequestSchema` | `artifacts.ts`：`workSchema` | Web 入口、CLI create/smoke |
| `GET /api/works/:id` | workId path | `public-api.ts`：`workViewSchema` | 工作区、提交回读、CLI get |
| `PUT /artifacts/creative` | `work-requests.ts`：`creativeDraftRequestSchema` | `artifactSchema`，creative/pending | Web 创意稿保存 |
| `POST /artifacts/creative/select` | `work-requests.ts`：`selectCreativeRequestSchema` | `artifactSchema`，creative/approved | Web、CLI select |
| `PUT /artifacts/outline` | `work-requests.ts`：`outlineDraftRequestSchema` | `artifactSchema`，outline/pending | Web、CLI save-outline |
| `POST /approve` | `work-requests.ts`：`approveRequestSchema` | `public-api.ts`：`pipelineStateSchema` | Web、CLI 通用通过；专用关卡仍拒绝此路径 |
| `POST /artifacts/setting/approve` | `setting.ts`：`settingApproveRequestSchema` | `settingApproveResponseSchema` | Web、CLI Setting 通过 |
| `POST /artifacts/beat/approve`、`regenerate` | `beat.ts`：对应 request schema | `beat-command.ts`：`beatCommandResponseSchema` | Web、CLI 专用命令与恢复 |
| `POST /artifacts/prose/save`、`approve`、`regenerate` | `prose.ts`：对应 request schema | `prose-command.ts`：`proseCommandResponseSchema` | Web、CLI 专用命令与恢复 |
| `POST /advance` | 无 body | `public-api.ts`：`advanceOutcomeDtoSchema` | Web、CLI advance |
| `POST /chapters/start` | `artifacts.ts`：`startChapterRequestSchema` | `advanceOutcomeDtoSchema` | Web、CLI 显式开始下一章 |
| `GET /telemetry` | `diagnostics.ts`：`diagnosticQuerySchema` | `diagnosticResponseSchema` | CLI logs |

`public-api.ts` 同时拥有 `gateRefSchema`、`pipelineStateSchema`、内部 `advanceOutcomeSchema` 与含遥测的 `advanceOutcomeDtoSchema`。GateRef 也要求 kind/chapter 一致且章号为正安全整数。Pipeline 状态生产者使用共享类型，HTTP 才追加本次 telemetry；不为 Web 创建第二个工作流状态机。未知路径由 app 的 `notFound` 输出固定普通错误包；未捕获异常输出安全的 500 包。

响应关联分别核对：创建作品的 seed 与提交值一致；GET Work 的 id、advance/start/通用通过的 state.workId 与请求作品一致；start 的成功/错误命令观察还必须匹配 generate-beat、beat kind 和请求章号，无 target 的 request-rejected 仍核对操作；创意稿保存/选择、大纲保存的 workId/kind/chapter/status 与目标一致；diagnostics.workId 与查询作品一致。Setting/Beat/Prose 还通过共享 submission 规则匹配冻结请求、版本与内容；这些额外检查不能被一次通用 schema parse 替代。书架/config 没有单作品请求基线，只验证自身响应形态。

### 错误、观测与恢复

| 定义与 owner | 生产者 → 消费者 | 边界 |
|---|---|---|
| `artifacts.ts`：`apiErrorSchema`、`validationIssueSchema` | HTTP 路由 → Web/CLI | 普通错误形状；不回传完整解析输入或模型原文 |
| `beat-command.ts`、`prose-command.ts`：operation/head/target、observation、workflow、input budget、response/error | 服务端命令及路由 → Web/CLI、diagnostics | 机器可读的目标、写入结果和恢复线索；不能把 retryable 当作自动重放授权 |
| `public-api.ts`：`httpErrorSchema` | 通用 HTTP 客户端接收 → Web/CLI | 合并普通错误与两类命令错误，避免 strict ApiError 把合法命令诊断当作协议错误 |
| `telemetry.ts`：`llmTelemetrySchema` | server steps/telemetry → advance、专用命令、diagnostics、独立节点结果 | 共享生成参数、耗时、用量与 hash；不含完整 prompt/provider 原文 |
| `diagnostics.ts`：query、commandSummary、response（含 buffer window） | server steps/telemetry → CLI logs | 有界进程内窗口，尚非持久化审计日志 |
| 三个 `*-submission.ts`：提交匹配及恢复函数 | Web/CLI 冻结请求与回读 → UI/Agent 建议动作 | 共享纯业务规则；保留原始 HTTP status/body 直到恢复层解析与关联，不能提前丢失 unknown-write 信息 |

服务端已知异常 `errors.ts`、客户端异常类、CLI 参数解析与 stderr 序列化属于各自适配层。CLI stderr 可能带命令诊断或独立实验 details，不是另一个同形 HTTP ApiError；worker 启动前的有界 code 包也不是成功的 StepExperimentResponse。不得因此声称所有 JSON 都采用相同外壳。

### 本地实验协议与私有 Step

`step-experiment.ts` 定义 CLI ↔ worker 的 request/response，由 [`local-step.ts`](../../apps/cli/src/local-step.ts)、[`step-lab-main.ts`](../../apps/server/src/step-lab-main.ts) 和 [`isolated-runner.ts`](../../apps/server/src/steps/isolated-runner.ts) 消费。请求先校验有界公开包装，节点专属 upstream 再交给私有 Step；独立执行不证明素材来自作品当前已通过版本。成功响应依 stepId 使用共享注册表验证完整生成内容（包括 Prose 非空），worker 写 stdout 前与 CLI 收到 stdout 后均解析同一响应 schema；失败响应不带 content。

| 私有 owner | 输入与模型输出的共享来源 | 最终验证 |
|---|---|---|
| `steps/caption-io.ts` | seed/workId/upstream 包装、caption content | `runStep` 的 input/output schema |
| `steps/creative-io.ts` | caption 上游；LLM 从 creativePack 去 directionId | 服务端补 ID 后以 creative content 验证 |
| `steps/outline-io.ts` | creative 上游；LLM 从 arc/segment 去 ID，共享数量范围 | 服务端补 ID 后以 outline content 验证 |
| `steps/setting-io.ts`、setting-step | caption、单方向 creative、outline；模型用 settingDraft | 服务端补 ID，Step 输出复验 setting content |
| `steps/beat-io.ts`、beat-step | outline、setting、previousChapter；模型用 beatDraft | 服务端补 ID，Step 输出复验 beat content |
| `steps/prose-io.ts`、prose-step | beat、setting、previousChapter；模型用 proseContent | Step 输出验证非空全文 |
| `steps/chapter-context.ts` | previousChapter 中复用 Beat/Prose 内容 | 第一章禁止；后续章必须是 chapter − 1 |
| `steps/llm-call.ts`、llm | 具体 Step 提供 output schema；ModelRuntime 解析 provider 配置 | SDK 结构化输出后再次 parse，重试和安全日志属于运行层 |

私有 `*-io.ts` 保留调度字段、包装和模型无 ID 形态，不将其全部提升为 REST。Step 输入验证与 Store 最终验证分别保护模型调用前、服务端 ID 注入后的边界，不能互相替代。

## 存储与响应的验证责任

- [`store/validation.ts`](../../apps/server/src/store/validation.ts) 以共享 schema 检查输入与存储快照，抛出固定消息的 `StoreContractError`，区分 `invalid-store-input` / `invalid-stored-data`，不携带原始内容。
- `createWork` 校验公开创建输入与候选 Work；`appendArtifact`、`saveArtifact`、`finalizeArtifact`、`setStatus` 在修改内部状态前校验完整候选 Artifact。现有版本／上游条件比较保留；内容校验失败不追加版本、不通过、不部分写入。
- SQLite 与内存适配器复用上述内容校验；SQL 额外保证物理身份、版本唯一、kind/chapter、JSON 与外键约束。写入的目标和上游条件在同一短事务内比较，不能用路由中的预检替代。
- `getWork` 验证当前 WorkDetail 和所有 head；`listWorks` 从已验证的 getWork 派生摘要；`headVersion` 验证所读的单个 head。当前读取不扫描全部历史版本，不能据此声称全库历史已检查。
- [`contract-response.ts`](../../apps/server/src/contract-response.ts) 是 HTTP 输出验证与安全失败接缝。输出验证失败不能证明此前写入未发生；返回通用安全失败，不泄漏非法内容。写请求的消费者遇到无效成功包仍须保留回读语义，不自动重放。
- Web/CLI 的成功包解析不能只检 shape：涉及既有作品／产物时还需核对目标关联；Setting/Beat/Prose 的提交结果继续使用共享匹配／恢复逻辑。读取非法数据不应作为正常工作区展示。
- 畸形 4xx 不能仅凭 HTTP 状态被认定为确定拒绝；错误包无法解析时，写请求仍标为 unknown。合法命令错误中的 `writeOutcome: unknown` 也优先于 4xx 状态；保留冻结请求与既有回读路径，不换基线、不自动重试。

## 重复定义处理与明确保留

本次移出路由的创建、创意稿保存/选择、大纲保存、通用通过请求归 `work-requests.ts`；WorkSummary 与 AppConfig 的消费者类型从 schema 派生。WorkView 不再为六 kind 分别追加平行内容检查，而是复用统一 Artifact 校验；低层 envelope 与内容注册表分开消除循环依赖。

三类 creative hint、Beat/Prose 命令族、各私有 Step 包装和三种人工编辑完整度继续分开：相似字段不表示相同业务。客户端本地编辑状态、HTTP transport、CLI flags、provider 原始响应都不是新的公开领域 schema。#15 Hono RPC 迁移仍未实施；#9 SQL 表/迁移由 Wiki 009 和 schema 拥有，#7 作者配置、#28 工具执行、#29 作品 Wiki 和未对齐的 materials 生命周期也不由契约治理预定义。

## 向 #9 交接

SQLite 适配器沿用 WorkStore 接缝以及 `artifactSchema` / `workSchema` / `workDetailSchema`；独立内容检查使用共享 `parseArtifactContent`。SQL 约束补足身份、版本和原子性，不能手写第二套六 kind 内容规则。加载的持久内容须验证，坏数据不能以 HTTP200 传出；写入前验证和 CAS 在事务内保持一致。当前两种适配器都只验证实际读取的 head；未来历史查询增加时也要对其输出验证。

正文空白、pending/approved 差异、同版通过、新版保存、全部历史版本与 inputs 引用沿现有领域语义保留。`appendArtifact` 可携带最终状态及前置条件，用于 Caption 直接通过、Creative 选定等一次提交；Setting/Beat/Prose 禁止借此跳过专用 finalize。`setStatus` 也接收前置条件，避免事务外版本检查后的竞态。物理 SQL v1 形状见 [schema](../schema.md#sqlite-持久化9)，运行 HOW 与真实重启证据见 [Wiki 009](../wiki/009-sqlite-persistence.md)；此职责清单本身不替代验收。

## 治理前落差与排期沿革

以下保留 #19 实施前的盘点与排期理由；其中“当前”“后续”均指当时状态，现行定义以本页上方清单为准。

#13 已收敛 Setting 的三种内容边界、通过协议、WorkView／Artifact envelope 和 advance 响应；Web 与 CLI 复用这批可执行定义。仓库仍有通用 `Artifact.content: JsonValue`、其他产物的路由内联请求 schema，以及缺少统一 kind→content 校验入口等落差；不是全仓契约治理已完成。

后续治理票 [#19](https://github.com/12bitsD/agent4novel/issues/19) 负责盘点公开与私有 schema、统一产物内容校验入口、收敛重复 DTO 并补足关键边界验证。作者在 #5 对齐中决定先完成章纲与正文，再治理；当时顺序为 #5 → #22 → #19 → #9 → #6，取代先 #19/#9 再 #5 的旧排期，变化理由见 [Wiki 005](../wiki/005-beat-generation-review.md#上下文演进)。2026-09-29 作者将续写前移，当前队列为 #6 → #19 → #9 → #7，见 [Wiki 006](../wiki/006-chapter-continuation.md#上下文演进)；#19 要覆盖已落地的多章请求、输入引用与恢复契约。Hono RPC 类型传输迁移仍归 #15，待服务定型后再做。

2026-09-08，#5 票内契约已随章纲实现落到共享 schema 和 Wiki；这是本票必要边界，不是提前实施 #19 全仓治理。当前契约由代码与测试证明，历史方案快照保留作追溯。

物理 SQL 表数、迁移策略和 `materials` 生命周期需在对应票中明确，不能从 JSON schema 或历史 research 推断已经建表。下一位治理 Agent 应先回读本页、`docs/schema.md` 和治理 issue，在实施前补全现状清单与测试计划。
