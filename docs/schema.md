# 数据模型

agent4novel 的领域数据模型。代码英文 id ↔ 领域中文词（见 [CONTEXT.md](../CONTEXT.md)）的映射、实体、形状与不变量。当前 SQLite 物理存储形状见下方“SQLite 持久化”章节；设计依据和运行 HOW 见 [Wiki 009](./wiki/009-sqlite-persistence.md)。

## kind = 节点名

公开运行健康接口 `GET /api/health` 使用strict `healthSchema`，仅返回 `{status:"ok"}`；不包含作品、配置或模型状态。`A4N_SERVE_WEB=1`显式启用编译后同源Web目录，默认0保留开发Vite方式；与存储实体/schema版本无关。部署配置与卷操作见 [Wiki033](./wiki/033-local-docker-ci.md)。

产物按**流水线节点**归类（一个节点 = 一个产物，content 装整个 JSON）：

| 节点（kind） | 产物内容 | 形状 |
|---|---|---|
| `caption` | 提炼稿（#3c）：`{inputStage（脑洞/设定/主线/模板）, summary, elements:[{kind,content}], gaps[]}`；理解素材后的开发判断与提案，落库即 approved，不设关卡 | 每作品一份 |
| `creative` | 创意稿（#3c）：`{directions:[方向包 ×N]}`，方向包 = `directionId + title + hook + tags[] + synopsis + characters[] + setting[] + payoffs[] + outline[]`（全 hint 级）；N=directionCount（默认 2，严格 1~3）；选定时落**单方向**新版本 | 每作品一份 |
| `outline` | 大纲（#4，两层，与章节解耦）：`{arcs:[{arcId, title, conflict, development, resolution, segments:[{segmentId, title, summary, outcome}]}]}`；弧线 3~8、每弧剧情点 2~8；`arcId`/`segmentId` 由 server 注入；章数不在本层（归 #5） | 每作品一份 |
| `setting` | 完整设定（#13）：`{overview, world[], characters[], factions[], relationships[], extensions[]}`；固定栏目通用卡片 + 动态补充栏目，具体规则见下方 | 每作品一份 |
| `beat` | 章纲；内容和编辑协议见[下方](#beat5-当前契约)，按章推进见[续写契约](#后续章6-续写契约) | 每作品 × 每章一份 |
| `prose` | 正文 `{text}`；内容、保存与通过协议见[下方](#prose22-当前契约) | 每作品 × 每章一份 |

**卖点 / 梗概 不是独立产物**：卖点 = 创意稿方向包的 `hook` / `payoffs`，梗概 = `synopsis`。创意稿里的人物/设定/大纲是 **hint（粗）**；`outline` / `setting` 节点产出的**完整版（细）**是独立产物。各 kind 的 zod schema 见 packages/contracts（caption.ts / creative.ts / outline.ts / setting.ts）。

## 实体

### Work（作品）

```ts
Work = {
  id: string
  title: string
  seed: string          // 脑洞原文（启动界面输入/上传文本）
  config: AgentConfig   // 旧作品配置兼容来源；作者编辑使用下方独立revision
  createdAt: string
}
```

### AgentConfig（Agent 配置）

`agentConfigSchema` 保留既有 model、systemPrompt、skills、tools、directionCount，并加入可选 `thinking: "enabled" | "disabled"`、`temperature: number`（0–1）、`topP: number`（大于 0 且不超过 1）。`generationParametersSchema` 对这三项采用 strict 校验；省略项由 ModelRuntime 解析，provider 支持范围和默认值以 [Wiki 016](./wiki/016-model-runtime-provider-config.md) 为准。#7新增独立作者配置UI/API，见下方；解析后的AgentConfig携带可选安全`configRevision`与`configFiles:[{id,sha256}]`溯源，systemPrompt为实际已读取指导，skills/tools不作为工具执行授权。

`LlmTelemetry.generation?` 使用相同 schema，记录本次已解析的生成参数。它是安全诊断，不含凭据或模型正文。

### 单节点实验协议

`stepExperimentRequestSchema` 是本地 CLI 与独立 worker 的协议，不是作品 REST 写入接口。请求为 `{ stepId, input: { seed, upstream?, chapter?, regeneration? }, systemPrompt?, config? }`；节点限 caption/creative/outline/setting/beat/prose。Beat 与 Prose 的 chapter 必须为正安全整数，可选 regeneration 必须匹配对应节点的草稿形状；其他节点不接受 chapter 或 regeneration。Beat 的 upstream 为完整 `{outline, setting}`，Prose 为 `{beat, setting}`；两者 chapter > 1 时还必须携带 `previousChapter: {chapter, beat, prose}` 且章号恰好为前一章，第一章不接受该字段。下游按生产 Step 输入 schema 与消费守卫校验，独立输入不证明产物来自作品当前已通过版本。

实验 config 只接受 model、directionCount 及三项生成参数，拒绝未知字段；SP 必须非空且最多 100000 字符，seed 受共享素材预算限制。成功结果为 `{ kind: "succeeded", runId, stepId, executionMode: "live", model, content, telemetry }`；失败以 `kind: "failed"`、code、retryable 替代 content，公共响应不含模型 raw 文本。可执行定义见 [step-experiment.ts](../packages/contracts/src/step-experiment.ts)，命令与文件限制见 [Wiki 014](./wiki/014-agent-cli-telemetry.md)。

### Artifact（产物）

```ts
Artifact = {
  id: string
  workId: string
  kind: ArtifactKind    // caption | creative | outline | setting | beat | prose
  chapter?: number      // 仅 beat / prose 有
  version: number       // 每次追加 +1，旧版本保留
  content: JsonValue    // 传输表示；运行时按 kind/humanStatus 的共享内容 schema 精确校验
  humanStatus: HumanStatus   // pending | approved；SQLite 列名 human_status
  createdAt: string
  inputs?: Array<{ kind: ArtifactKind; chapter?: number; artifactId: string; version: number }>
}
```

`JsonValue` = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }（递归）。

## 形状不变量

- per-work kind（`caption`/`creative`/`outline`/`setting`）：`chapter` 必须为 `undefined`
- per-chapter kind（`beat`/`prose`）：`chapter` 必须为正安全整数；输入引用也遵守相同 kind/章号规则
- `inputs` 记录生成时实际消费的上游身份/版本，不包含另一份正文。正文保存与同版本通过保留生成依据；它用于衔接提示，不作为修改上游的授权。

## 版本与关卡

- `appendArtifact` 追加新版本（version+1），旧版本保留；当前公开读模型只返回各地址的 head，尚无历史回看／回退入口
- `humanStatus` 语义：`pending` = 待作者把关（关卡中）；`approved` = 已通过
- 人工保存语义分节点：caption 落库即 `approved`（无关卡）；creative 保存草稿 = 新版本 + `pending`（`saveCreativeDraft`），显式选定方向 = 单方向新版本 + `approved`（`selectCreativeDirection`）；outline（#4）保存草稿 = 新版本 + `pending`（`saveOutlineDraft`，新增弧线/剧情点的 id 由 server 补注入），通过使用[大纲可见版本通过](#大纲可见版本通过)的专用条件命令，旧通用 `/approve` 保留当前 head 兼容语义；setting（#13）不保存中间草稿，专用完成命令将同 id／version 的内容和状态原子定稿，不追加 V2
- Prose 保存追加新 ID／版本并保留匹配基线的 `humanStatus`；pending 草稿可为空，approved 内容必须非空。通过仍是同 ID／版本原子定稿。通过后可编辑是 Prose 的明确例外，不改变 Setting／Beat 通过后只读的语义。
- 关卡在步骤边界：`gateAfter` 的步骤产出后置 `pending` 等 approve；`gateBefore` 的步骤要求目标产物已 `approved`；`consumes` 的上游产物读最新版且必须 `approved`

## 共享验证边界：#19

`Artifact.content` 的传输表示仍是 JSON；有效性由 `artifactContentSchemas` 和 `artifactContentSchemaFor(kind, humanStatus)` 决定。Caption、Creative、Outline、Setting、Beat 使用对应正式内容形态；pending Prose 使用编辑形态，approved Prose 使用非空正式内容。模型输出的无 ID 变体不作为存储形态，服务端注入身份后仍需最终复验。

`artifactSchema` 同时检查内容及 kind/chapter 地址；`workDetailSchema` 和 `workViewSchema` 使用同一归属/唯一 head 规则。每个产物必须属于当前作品，同一 kind/chapter 只出现一个当前版本；本规则不把公开读取扩展成全部历史列表。Config 的未知字段拒绝，不静默丢弃以掩盖协议漂移。

Store 在写入及状态转换前校验候选，保留原有版本与上游条件检查；失败不得创建空 bucket、增加版本或改变状态。读取校验本次返回的内容，快照不暴露内部可变引用。公开 GET 仍只返回各地址 head，不承诺扫描未被读取的历史；SQLite 从磁盘解码时复用同一验证入口，未来历史读取也必须遵守。

公开创建、列表、创意稿保存/选择、大纲保存、通用通过、应用配置、推进及各专用命令均复用 `packages/contracts`。HTTP 成功输出也校验；输出失败统一安全 500，不含原始内容，不宣称操作未发生。错误公共联合 `httpErrorSchema` 保留基础错误以及 Beat/Prose command 与遥测扩展。CLI 本地诊断包装和 Step 私有 I/O 不被强行并入 HTTP 错误形。

Web/CLI 在消费端解析公开响应并核对资源身份。错误体畸形、身份不匹配或成功响应无效时，写操作按结果未知处理；不能仅凭 4xx 认定未写入，也不能自动重复 POST。既有 Beat/Prose 专用恢复层仍保留原始状态与响应，按各自共享命令契约对账。

独立 Step 实验成功包按 `stepId` 校验正式内容；请求与 Step 调度包装仍为各自私有边界。完整契约清单与保留重复的理由见 [契约治理](./agents/contract-governance.md)，本票设计和证据见 [Wiki 019](./wiki/019-contract-governance.md)。

## SQLite 持久化：#9

生产使用 [`SqliteStore`](../apps/server/src/store/sqlite-store.ts) 实现 `WorkStore`；`InMemoryStore` 继续用于行为测试。SQLite v3 由 [`sqlite-schema.ts`](../apps/server/src/store/sqlite-schema.ts) 定义；继承 v1 的两张 `STRICT` 表持有作品与每个产物版本，不按 kind 拆表。v2 新增作者配置与版本文件元数据两表，文本不入数据库；v3再新增不可变坏例表。

| 表 | 列与存储形态 |
| --- | --- |
| `works` | `id` 主键；`title`、`seed`、`created_at` 非空文本；`config` 为通过共享 AgentConfig 校验的 JSON 文本 |
| `artifacts` | `id` 主键；`work_id` 外键指向 `works.id`；`kind`、`version`、`human_status`、`created_at`；`chapter` 为可空整数；`content` 为 JSON 文本；可空 `inputs` 为生成输入引用的 JSON 文本 |

- SQL 校验六种 kind、两种 human status、JSON 语法以及版本为正安全整数。作品级 kind 的 chapter 必须为 SQL `NULL`；Beat/Prose 的 chapter 必须为正安全整数。返回 JavaScript 时 `NULL` chapter 恢复为字段缺省。
- 两个部分唯一索引分别约束 `(work_id, kind, version) WHERE chapter IS NULL` 和 `(work_id, kind, chapter, version) WHERE chapter IS NOT NULL`，防止普通含 NULL 唯一约束遗漏作品级重复版本。
- `content`、`config`、`inputs` 的领域有效性仍由共享 schema 验证；SQL 的 `json_valid` 不取代内容校验。inputs 记录原始生成依据，不复制上游内容，也没有新增关系表或历史版本 UI。
- 读取在一致快照中取每个 kind/chapter 的最大 version；作品列表与章节统计基于这些 head。旧版本留在表中，当前公开接口不读取全部版本，也不承诺扫描未使用的历史数据。

### 事务与版本条件

写操作使用 `BEGIN IMMEDIATE` 语义的短事务；目标 id/version/status 与所消费上游 head 的条件检查、候选内容校验及写入均在其中完成。条件变化时拒绝整个写操作；事务失败不追加版本、不部分通过。LLM 调用在事务外，生成完成后重新验证实际输入基线。

`appendArtifact` 原子追加下一版，默认 pending，也可为允许直接通过的 kind 指定 `humanStatus: 'approved'`。Caption 落库与通过、Creative 选定方向与通过因此不再拆成两次写入；Setting/Beat/Prose 仍只能走专用 finalize。`setStatus` 支持前置条件。Prose save 原子追加新 id/version 并保留匹配状态；finalize 原子替换同一 id/version 的内容与状态；历史版本及 inputs 依既有规则保留。

### Schema 版本与恢复边界

数据库版本使用 `PRAGMA user_version = 3`。初始化在取得写锁后重新读取版本和结构，只对真正无用户对象的 v0 空库建表；已有 v1/v2 必须精确匹配已知表与索引定义，再事务迁移到 v3；v3 同样严格核对结构。未来版本、未知旧结构或不匹配结构使启动失败，不删库、不降级、不悄悄退回内存。当前未提供历史库修复、导入或旧内存实例迁移工具。

连接启用外键、WAL、`synchronous = FULL` 和 5 秒 busy timeout。默认数据目录与备份/恢复操作见 [Wiki 009](./wiki/009-sqlite-persistence.md)。同一数据目录中的已提交作品、产物版本、通过状态和 inputs 可在服务重启后读取；未保存页面草稿、进程内遥测、正在运行的模型调用不在该持久化范围。

## 大纲可见版本通过

#49 的专用命令绑定作者实际读取的大纲，或本页保存成功回执中的新产物身份；确认与重试沿用该基线。可执行定义与响应关联核对见 [`outline-approval.ts`](../packages/contracts/src/outline-approval.ts)。

```ts
// POST /api/works/:workId/artifacts/outline/approve
type OutlineApprovalRequest = {
  expectedArtifactId: string // 长度 1–200，保留原始产物身份
  expectedHeadVersion: number // 正安全整数
}
type OutlineApprovalResponse = Artifact & {
  kind: 'outline'
  chapter?: undefined
  content: OutlineContent
  humanStatus: 'approved'
}
```

请求严格拒绝额外字段，JSON 解析前检查 HTTP body 的 4096 字节上限；CLI 请求文件同为严格 UTF-8 JSON，最多 4096 字节。请求只携带身份与版本；本页大纲若有修改，应先保存，再使用保存回执的 ID／版本通过。

Pipeline 校验显式 ID／版本，并把同一观察到的 ID、version、humanStatus 条件传给 `WorkStore.setStatus`。InMemoryStore 在同步写入中重核；SqliteStore 在同一写事务中重核并更新状态。条件变化拒绝整个操作，不能批准当前新 head。成功只把目标大纲置为 approved，id、version、createdAt、content 和 inputs 保持；不追加版本、不调用模型或推进下一节点。匹配当前已通过目标的重放返回同一产物，也不清除后续生成失败记录。并发条件冲突可以返回 409，不能为绕过冲突换成最新基线。

成功响应是已通过大纲产物本身，没有 workflow、command 或操作流水账包装。`matchesOutlineApprovalResponse` 校验响应形态、作品、原始产物 ID／版本与 approved 状态；只确认目标状态，不证明更早的哪个 HTTP 请求赢得写入。

请求格式非法为 400，作品／大纲不存在为 404，基线冲突为 409，body 超限为 413。意外失败或写入后的响应不可用返回安全 500；传输失败、5xx、畸形响应或身份不匹配均不能证明未落库。保留原请求，显式读取后可核对同一目标是否已通过，不认领历史操作回执或自动重发。

旧 `POST /api/works/:workId/approve` 的 `{ kind: 'outline' }` 仍通过服务器处理时读取的当前 head，返回 `PipelineState`；已有服务端 CAS 继续保留，但该旧请求没有作者可见的 ID／版本条件，不能代替专用命令的保证。CLI `approve <workId> outline` 保留此兼容语义；`approve-outline <workId> --file request.json` 只发送文件中的显式基线一次，不自动 GET、回填版本或重发。此切片未新增 Store 接口、数据库迁移或操作回执表。

## Setting：#13 已确认设计

本节是 2026-09-05 Human 确认并在 #13 实现的契约。可执行定义见 `packages/contracts/src/setting.ts`，提交对账见 `setting-submission.ts`，公开读模型见 `public-api.ts`。设计理由、验证证据与限制见 [Wiki 013](./wiki/013-setting-generation-review.md)。保留本节标题作为既有文档锚点。

### 内容形态

设定采用总览、固定栏目和通用卡片；具体卡片粒度由 Agent 生成、作者把关，不硬编码人物属性或关系图。

```ts
type SettingItem = {
  itemId: string
  title: string
  content: string
}

type ExtensionSection = {
  sectionId: string
  title: string
  items: SettingItem[]
}

type SettingContent = {
  overview: string
  world: SettingItem[]
  characters: SettingItem[]
  factions: SettingItem[]
  relationships: SettingItem[]
  extensions: ExtensionSection[]
}
```

| 字段 | 作者可见栏目 | 最终有效内容 |
|---|---|---|
| `overview` | 设定总览 | 去除首尾空白后非空 |
| `world` | 世界与运行规则 | 至少一张卡片；世界规则在此表达 |
| `characters` | 人物 | 至少一张卡片 |
| `factions` | 势力与组织 | 可为 `[]` |
| `relationships` | 关系 | 可为 `[]`；卡片不要求结构化端点或类型 |
| `extensions` | 补充设定 | 可为 `[]`；每个已有补充栏目标题非空、至少一张有效卡片 |

六个顶层字段始终存在，不用 `undefined` 或 `null`。每张卡片的标题和正文必须非空；不适用用空数组表达，生成约定不填“无”“不适用”等占位内容。语义质量交给作者把关，schema 不判断某段设定是否写得足够好。

`title` 为纯文本。`overview` 与卡片 `content` 保存 Markdown 源字符串，允许段落与换行、粗体与斜体、引用、有序与无序列表；不存 HTML 或编辑器 AST。标题、链接、图片、表格、代码块、原生 HTML 和嵌入内容不属于渲染能力；安全降级不得执行代码或自动联网。

### 身份与三种边界

稳定 ID 标识内容身份，与栏目归属和数组位置无关。已有卡片改名、编辑、排序或跨栏目移动时保留 `itemId`；补充栏目改名或排序时保留 `sectionId`。最终内容中 ID 不得重复，客户端不得伪造不属于当前设定的已有 ID。

| 边界 | 内容与 ID 规则 | 归属 |
|---|---|---|
| Agent 输出 | 内容字段完整；没有 `itemId`、`sectionId`，由服务端注入 | `packages/contracts` 的 `settingDraftSchema`；服务端 `setting-io.ts` 复用并包装 Step I/O |
| 通过请求 `SettingReviewDraft` | 提交整份内容；已有项带原 ID，新增项省略 ID；携带 `expectedHeadVersion` | `packages/contracts` 的公开请求契约 |
| 存储内容 `SettingContent` | 所有 ID 必须存在、合法且唯一；完整内容满足共同约束 | `packages/contracts` 的公开内容契约 |

页面正在编辑的临时状态可以不合法；它不等同于已通过校验的请求或存储内容。前后端复用公开契约校验最终提交，不各自维护一份规则。

校验采用严格对象、非空及宽松的技术安全上限。`settingLimits` 集中维护标题 256／ID 96／单段正文 20,000／总文本 200,000 个 JS code units、总卡片 256／动态栏目 32、HTTP body 2 MiB；这些是技术保护而非创作配额。模型预算与校准证据见 Wiki；不猜测补齐缺失栏目或截断结构化内容。

### #13 公开协议设计

以下协议的可执行 Zod 定义归 `packages/contracts`。内容形态沿用上文；请求／响应不在 Web、CLI 或路由中重新手写一份。

```ts
type SettingReviewItem = Omit<SettingItem, 'itemId'> & { itemId?: string }
type SettingReviewSection = {
  sectionId?: string
  title: string
  items: SettingReviewItem[]
}
type SettingReviewDraft = {
  overview: string
  world: SettingReviewItem[]
  characters: SettingReviewItem[]
  factions: SettingReviewItem[]
  relationships: SettingReviewItem[]
  extensions: SettingReviewSection[]
}
type SettingApproveRequest = {
  content: SettingReviewDraft
  expectedHeadVersion: number
}
type SettingArtifact = Omit<Artifact, 'kind' | 'chapter' | 'content'> & {
  kind: 'setting'
  content: SettingContent
}
type SettingApproveResponse = SettingArtifact & { humanStatus: 'approved' }
type ValidationIssue = {
  path: (string | number)[]
  code: string
  message: string
}
type SettingApiError = ApiError & { issues?: ValidationIssue[] }
```

通过请求是严格对象；`expectedHeadVersion` 为正的安全整数，新增项省略 ID，不传 null、空 ID 或客户端临时键。成功返回完整的已通过 Artifact，不附带触发下一步生成的副作用。HTTP 首次成功为 200；重复通过为 409，客户端可按 Wiki 的回读规则确认目标是否已经达成，不能把 409 一概显示为修改丢失。

`SettingArtifact` 的运行时 schema 禁止 `chapter`；仅 TypeScript `Omit` 不足以执行此限制。存储对象可有 `chapter: undefined`，JSON 响应省略它；其他 envelope 字段和按章规则从共享 Artifact schema 派生。

`WorkView` 包含 `nextStepId: string | null`，其值来自 Pipeline 状态；新增 `awaiting-setting-review`、`setting-approved` 两个工作流状态。通用 `ready-to-generate`、`failed` 继续复用，不为每种产物复制一组状态。`outline-approved` 保留给以 Outline 结束的旧定义／测试；生产定义在大纲通过后进入 ready，具体可生成步骤由 `nextStepId` 标识。

#13 起集中 WorkView／Artifact envelope 与 advance 响应（含 state、telemetry）。#19 将六 kind 内容映射和其余公开协议收敛到共享定义，继承本节的 Setting 语义；当前验证责任见 [契约治理](./agents/contract-governance.md) 和 [Wiki 019](./wiki/019-contract-governance.md)。

规范化只去除纯文本标题的首尾空白。总览与正文用去空白结果判断是否非空，但保留原 Markdown 源文本、缩进和换行；不以渲染结果或 Markdown 语义等价比较内容。模型原始输出、请求与存储均复用此规则。

### 生命周期与存储边界

#13 的流程为 `caption → creative → outline → setting`。Setting 消费原始 `seed`、提炼稿、已选定且通过的单方向创意稿、已通过的大纲。生成成功后创建 `pending`；生成或校验失败不写半成品。

作者只在当前页面内存中修改草稿。点击“通过”时，服务端校验当前版本、`pending` 状态、完整内容与 ID，在一个原子操作中替换同一 Artifact 的内容并置为 `approved`；`Artifact.id`、`version` 不变。#13 不提供单独草稿保存或通过后的编辑接口，后续消费仅使用通过后的内容。

`expectedHeadVersion` 与状态检查须在同一原子操作中执行。并发或重复请求不能再次覆盖已通过内容；校验或冲突失败不修改原记录。网络响应丢失时应回读确认服务器状态，不能把传输失败等同于服务器未提交。

Setting 的状态迁移是单向的：首次生成创建 pending，专用完成命令将同一版本置为 approved。通用 `setStatus` 不接受 Setting，已通过内容不能退回 pending 后再次完成。

此设计沿用 `Work + Artifact`，没有为每种产物分别建表。当前生产使用 `SqliteStore`，内存实现保留用于测试；物理形状见 SQLite 持久化章节。`materials` 的多素材生命周期尚未定案，不是 #13 的新实体。

## Beat：#5 当前契约

本节的内容与编辑契约由 #5 落地，#6 将章号、输入引用与恢复匹配推广至后续章；保留标题供既有链接使用。运行时定义位于 `packages/contracts/src/beat.ts`、`beat-submission.ts`、`public-api.ts` 与 `telemetry.ts`；原设计与 TDD 见 [Wiki 005](./wiki/005-beat-generation-review.md)，多章工程上下文见 [Wiki 006](./wiki/006-chapter-continuation.md)。Setting 契约保持上文不变。

带数字的小节保留 R1 原稿编号，便于与固定评审证据核对；不会据此另建一套契约来源。

### 3.1 最终存储形态

卡片只承载身份、标题和自由说明，不增加场景类型、人物引用、冲突类型等硬字段。

```ts
type BeatContent = {
  title: string
  goal: string
  writingPlan: Array<{
    itemId: string
    title: string
    content: string
  }>
  ending: string
}

// 外层继续使用 Artifact：
// kind: 'beat', chapter: number (正安全整数), version, id, workId, humanStatus, createdAt, inputs?
```

| 字段 | 界面名称 | 最终约束与表达方式 |
|---|---|---|
| `title` | 章标题 | 非空纯文本；去首尾空白 |
| `goal` | 本章目标 | 非空，保存有限 Markdown 源文本 |
| `writingPlan` | 写作安排 | 有序数组，至少一张卡；顺序就是计划顺序 |
| `writingPlan[].title` | 安排标题 | 非空纯文本；去首尾空白 |
| `writingPlan[].content` | 安排说明 | 非空，保存有限 Markdown 源文本 |
| `ending` | 章末落点与承接 | 非空，写预期局势、停止位置和承接；不硬拆成多个必填属性 |

四个字段始终存在，不使用 null/undefined。正文类字符串只用 `trim()` 判空，存储保留原始换行和排版；不按渲染后的文本比较或存 HTML。

### 3.2 同源派生四种边界

重新生成应允许修复尚未编辑完整的计划，因此不能直接复用“通过请求”的非空限制。

| 边界 | ID | 完整性 | 用途 |
|---|---|---|---|
| `BeatDraft` | 不允许模型输出 ID | 必须完整 | 模型结构化输出 |
| `BeatContent` | 每卡必须有唯一服务端 ID | 必须完整 | 存储、响应、后续消费 |
| `BeatReviewDraft` | 已有卡保留 ID，新卡省略 ID | 必须完整 | 一次通过请求 |
| `BeatEditDraft` | 与 review 一样；允许省略新卡 ID | 允许空字符串和空卡数组，仍要求字段齐全且类型／大小合法 | 重新生成的当前编辑内容 |

实现用共同字段构造器和完整性模式派生，不复制四套独立规则。`BeatEditorDraft` 是 Web 内部类型，额外有 `localKey`；出站时显式剔除 localKey，不能把它发成 itemId。

### 3.3 身份与版本建议

人工操作保留卡片身份，AI 整份重新生成建立新一版身份；本期不尝试跨版本推断同一张卡。

人工编辑和重排保留已有 `itemId`。新增卡片缺 ID，由服务端分配 `beat-item-<UUID>`；重复、外来或旧版本 ID 拒绝并返回字段路径。对未变更卡片不重新计算 ID，不用数组下标或文本 hash 当身份。

重新生成时，服务端验证提交基线和 ID 归属，再剔除 ID 交给模型。完整新结果注入全新 ID，成功追加为下一版 pending。旧版保留在现有 Store 内部，但没有历史读取、比较、选择或回退入口。

```text
首次生成          人工修改仅在本页       整份重新生成成功       人工修改并通过
v1 / pending  ──→ 不写服务端        ──→ v2 / pending      ──→ v2 / approved
                                          新 Artifact.id       id/version 不变
```

“不加版本比较”不等于删除存储历史；“通过”也不额外制造 V3。这个技术语义沿用现有 append/finalize 能力，已纳入方案级复审。

### 内容与请求预算

数值来自已评审方案，真实合成样例验证见 Wiki 005；这些是技术防护，不是文学篇幅要求。标题与 ID 的字符串长度按 JavaScript code units 计算，HTTP body 按 UTF-8 字节计算。

| 项目 | 计划初值 |
|---|---:|
| 标题 / ID | 256 / 96 个 JavaScript 字符单位 |
| 单个正文类字段 | 20,000 个 JavaScript 字符单位 |
| 全章标题与正文总量 | 100,000 个 JavaScript 字符单位 |
| 写作安排卡片数 | 最多 128 张；不规定生成目标张数 |
| 本次修改意见 | 10,000 个 JavaScript 字符单位，允许空 |
| approve / regenerate HTTP body | 1 MiB，按 UTF-8 字节计，JSON 解析前检查 |

有限 Markdown 的安全渲染与完整 prompt 预算见 [Wiki 005 的技术预算](./wiki/005-beat-generation-review.md#3-内容契约与技术预算)。

### 6.1 请求与响应

两个新命令都要求客户端提交自己看到的版本，不允许服务端替客户端补成最新版本。

路径沿用 Setting 的风格，用请求中的显式章号定位 Beat；第一章由 advance 生成，后续章由显式 start-chapter 命令启动，随后复用同一套章纲编辑与再生协议。

```ts
// POST /api/works/:workId/artifacts/beat/approve
type BeatApproveRequest = {
  chapter: number              // 正安全整数
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatReviewDraft
}

// POST /api/works/:workId/artifacts/beat/regenerate
type BeatRegenerateRequest = {
  chapter: number              // 正安全整数
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatEditDraft       // 当前页，而不是服务端初稿
  instructions: string         // 必须存在，允许 ''
}
```

请求对象严格校验未知字段。完整性问题返回字段路径；外来 ID 即使出现在暂时不完整的再生草稿中也拒绝。不能用 regenerate 创建缺失目标；后续章初次生成见下方续写契约。

通过和再生成功均为 200 + `{ artifact, command, workflow, telemetry }`。`artifact` 分别是完整 approved／pending Beat；再生版本为请求基线 +1、Artifact ID 为新值，通过则 id/version 不变。`command` 为本节“Agent 可观测协议”的诊断信息，`workflow` 从现有读模型投影，telemetry 只含本命令实际 LLM 调用；通过不伪造模型记录。GET 继续使用 WorkView，不新建章节详情服务或异步 job 查询接口。

客户端校验 schema 之外，还要对照请求检查 workId、kind、chapter、ID／版本关系及状态。错误作品、错误章节、错误版本、非法内容的 200 响应同样按结果未知处理。

首次生成保留 advance 的既有 discriminated outcome，新增可选 `beatCommand` 诊断：仅本次实际尝试执行 Beat 时出现，写入结果只描述这个 Step。`awaiting-approval`／`complete` 不伪造新生成；其他 Step 的 outcome 维持兼容。通用 advance 可能已写前一步后再失败，不能把 Beat 的 `not-committed` 扩大解释为整次 advance 零写入。

### Agent 可观测协议

Agent 不应靠读日志正文猜操作是否成功。响应先给业务结果，再给安全的诊断线索；日志只作辅助，不是持久回执。

#### 命令观察信息

新增共享 `BeatCommandObservation` 运行时 schema，HTTP、CLI 与日志使用同一字段定义。不要把字段只写进 TypeScript 类型而跳过真实响应校验。

| 字段 | 含义与边界 |
|---|---|
| `kind` | 判别联合 `request-rejected / execution-result`；前者仅为尚未进入业务操作的严格请求边界拒绝，后者覆盖目标／基线已解析的命令执行观察 |
| `requestId` | 服务端为每个 HTTP attempt 生成 UUID，复用现有路由关联 ID；向 Step、LLM、命令日志及响应贯通。不是幂等键，重试得到新 ID |
| `operation` | `generate-beat / regenerate-beat / approve-beat`；首次 advance 中仅描述实际执行的 Beat Step |
| `target` | 已验证的 `{workId, kind:'beat', chapter}`；路径／body 尚未通过结构校验时不伪造完整 target |
| `expectedHead` | 通过／再生为请求声明的 `{artifactId,version}`，并标明这不是服务器最新 head；首次生成固定 null（预期不存在）。非法请求尚无法解析时省略 |
| `writeOutcome` | `committed / not-committed / unknown`，严格遵守[Wiki 005 第 6.2 节](./wiki/005-beat-generation-review.md#62-错误与调用预算)，不由 LLM 的 ok 推导 |
| `failureStage` | 失败时为 `request / precondition / input / model / output / commit / response`，成功省略；这是命令失败阶段，不是错误原文 |
| `attemptIds` | 仅本命令实际发起的 LLM 尝试；通过、锁冲突、前置校验拒绝为空。不得拿同作品正在执行请求的 attempt 填补 |
| `executionMode`、`latencyMs` | 运行模式 `demo / live` 与本命令用时；approve 在 live 模式也可以没有 LLM 调用 |
| `resultHead` | 已知成功写入时记录 `{artifactId,version,humanStatus}`，与返回 artifact 一致；不放内容。未知响应不虚构结果 |

有效成功使用 execution-result，必须含全部目标／基线／结果信息。该分支的有效失败也必须含已解析的目标／基线；不允许靠客户端填充缺失字段通过校验。

`request-rejected` 是窄的例外：仅允许在 HTTP 请求解析／校验边界、任何业务命令或模型调用前构造，code 限 `bad-json / invalid-input / payload-too-large / unsupported-chapter`，并校验对应 400／413；固定 `failureStage:'request'`、`writeOutcome:'not-committed'`、`attemptIds:[]`，含有效 requestId、operation、executionMode、latencyMs，省略 target/expectedHead/resultHead，不回显未验证输入。客户端把当前 HTTP promise 与调用的方法／路径绑定，并严格验证该联合分支与预期 operation 后，可判定**本次请求**未提交；无旧 unknown 时保留内容并允许缩减／修正请求。它不是“缺字段也相信 not-committed”的通用后门，任何未分类 5xx、坏 envelope、错误 operation 或执行期缺字段仍为未知；任何分支都不清除更早 unknown。首次 advance 解析前没有实际 Beat 尝试，不伪造此 Beat 诊断。

错误基础 `code/message/retryable` 保留，单个 `attemptId` 仅在确有本命令对应尝试时给出，完整关联以 `attemptIds` 为准。

专用成功的 `workflow` 是当前 WorkView 的 `workflowState / nextStepId / allowedActions` 投影，由同一读模型构造；出错时若成功回读也可返回该投影，否则省略。当前 WorkView 没有 pendingGate，不把 PipelineState 的同名字段误写成现成 WorkView 字段；Agent 通过当前 workflowState 与目标 Beat 的 pending 状态识别作者关卡。该投影是服务器观察到的当前状态，不是永不变化的许可或作者授权。返回 pending／`awaiting-beat-review` 就是在等作者；Agent 不应循环 advance 或自行 approve 来“完成任务”。

`telemetry` 仍记录 LLM 层事实：`ok:true` 只表示模型输出通过该层校验。模型成功后上游改变，会同时得到 LLM ok 和命令 `not-committed + failureStage:'commit' + code:'upstream-changed'`。两者共享 requestId/attemptId，可清楚定位失败在写入而非生成。提交前拒绝没有模型调用，就不生成假的 LLM 成败记录。

#### 机器可执行的恢复信息

Web 和 CLI 复用 `beat-submission.ts` 的纯恢复判断：输入为原始 baseline Artifact（含已删除旧卡的 ID 集）、冻结请求、此前 unknown、合法命令响应以及一次回读的 WorkView，输出 `resolution` 与 `nextActions`。不在 Agent 提示词里再抄一份状态机，也不让服务端猜客户端是否有更早的未知请求。

`resolution` 为 `confirmed / rejected / uncertain / conflict`；`nextActions` 为固定枚举的有序数组：`edit-input / read-work / retry-frozen-request / load-server-version / inspect-diagnostics / check-model-config / await-author`。这些是基于现有事实的建议，不是自动执行授权；`retryable:true` 仅表示原因可能恢复，不等于立即安全重放。版本冲突、旧 unknown 等事实优先于某一次错误的 retryable。

CLI 在失败 JSON 中保留原始安全 `code` 为 `causeCode`、operation、冻结请求的目标／基线、command（若响应合法），并附 `resolution/nextActions`。有回读时输出 `observedHead`：对象表示已读到 head，null 表示成功 GET 确认此地址不存在，省略表示没有可靠读回；404 work-not-found 用独立 code 表示，不能伪装成正常作品缺一章。CLI 的本地上下文和服务端 command 分开校验，不能用本地补齐字段使坏响应看似可信。

恢复矩阵以[Wiki 005 第 6.3 节](./wiki/005-beat-generation-review.md#63-结果确认通过可匹配再生不能猜)为准：确定性通过回读匹配可 confirmed／exit 0；未知再生即便看见新 pending，也仍 conflict／exit 1，需要作者明确选择载入。旧未知不会被当前 not-committed、空日志或锁已释放消除。没有收到 requestId 时明示缺失，通过 workId 回读，不能生成一个假的服务端关联 ID。

例如以下是错误结果的**字段摘录**，不是完整响应样例：

```json
{
  "code": "upstream-changed",
  "command": {
    "operation": "regenerate-beat",
    "writeOutcome": "not-committed",
    "failureStage": "commit",
    "executionMode": "live"
  },
  "resolution": "rejected",
  "nextActions": ["read-work", "inspect-diagnostics"]
}
```

这里 rejected 只在没有更早未知写入时成立；完整输出还应含 requestId、目标、基线和实际 attemptIds。Agent 读完可以明确区分“生成结果未采用”与“可以直接重试”。

#### 有界诊断查询，不新建观测平台

扩展现有 `GET /api/works/:id/telemetry` 与 `a4n logs <workId>`，新增可选 `requestId / attemptId` 查询条件及对应 CLI 参数；保留 `workId/telemetry`，增加 `commands` 与 `window`。未知／非法查询字段明确拒绝，成功与失败均经共享响应 schema 解码，CLI 不再仅作类型断言。

现有 LLM 账本容量为**进程内全局 1,000 条，不是每作品 1,000 条**。命令摘要用同样全局有界的独立 1,000 条环形缓冲；不记录命令 body。`window` 为两类缓冲分别返回 `capacity/oldestSeq/latestSeq/truncated`，并给出随机 `processInstanceId` 与 `retention:'process-memory'`；truncated 表示该进程该缓冲已发生淘汰，不代表过滤查询本来就有命中。空缓冲 seq 为 null，查询结果为空不能证明未执行；重启清空遥测且 processInstanceId 改变，同一 SQLite 数据目录中的已保存作品仍可回读。

每次响应的 LLM 内联数据按 requestId／本次 attemptIds 精确收集，不能继续仅靠 workId 加前后 cursor 筛选，避免锁冲突响应混入另一请求的记录。环形缓冲被淘汰不应导致本次响应丢遥测：在命令作用域内保留有界的本次记录副本。首次多步 advance 的内联 telemetry 保持完整本次请求，beatCommand.attemptIds 只关联 Beat；其他 Step 的业务诊断本票不扩展。

命令结束摘要含上述安全字段、时间、稳定结果 code；busy 只是一时锁状态，不是任务完成凭据。HTTP 丢失后的日志可以解释“发生过什么”，但本票不靠日志自动确认随机再生归属，也不因缺日志而重新调用模型。记录／查询故障应降级为诊断不可用，不改变真实写入结果。

### 外层身份与生命周期

#5 将 Work／Artifact 身份分别改为 `work-<UUID>`／`artifact-<UUID>`，避免重启后重新从零计数使旧请求误中新作品；客户端只把 ID 当作不透明身份。当前两种 Store 都使用 UUID，SQLite 保留已保存的身份；旧内存实例和早期序号数据不自动迁移，保全边界见 Wiki 009。Beat 新卡为 `beat-item-<UUID>`，人工同版编辑保留旧卡身份，AI 再生采用全新卡身份。

首次生成追加 v1 pending，整份再生成功追加下一版 pending；人工通过原子更新当前完整内容与 approved 状态，保留 id/version/createdAt。通用 approve/setStatus 不接受 Beat，不提供保存中间草稿、已通过修改或退回 pending；详见 [Wiki 005 写入一致性](./wiki/005-beat-generation-review.md#5-写入一致性生成追加通过同版本定稿)。SQLite 以事务实现同一 WorkStore 语义，不改变 Beat 生命周期。

## Prose：#22 当前契约

可执行定义为 `packages/contracts/src/prose.ts`、`prose-command.ts`、`prose-submission.ts`；首章工程上下文与已交付证据见 [Wiki 022](./wiki/022-prose-generation-review.md)。#6 保留本节标题与编辑语义，将章号、恢复匹配和章级动作推广至后续章，见 [Wiki 006](./wiki/006-chapter-continuation.md)。

### 内容与生成

正文内容为严格对象 `{text: string}`，外层为 `kind: 'prose', chapter: number` 的 Artifact，章号为正安全整数。章标题来自同章已通过 Beat，不在正文内容里重复存储。text 为纯文本，保留全部空白、缩进和换行；不渲染 HTML，不做 trim 转换。

- `ProseEditDraft` 允许空字符串，供保存 pending 草稿与整章重写输入使用。
- `ProseContent` 用去除空白后的值判非空，供模型最终输出、通过请求和 approved 内容使用。
- `ProseArtifact`／WorkView 按状态验证：pending 可以是空草稿，approved 必须是完整非空正文。生成／重写成功响应仍要求完整正文。

`prose#n` 消费作者最终通过的 `beat#n` 与完整 `setting`；n > 1 时还消费上一章章纲与最新已通过正文。首次生成及整章重写均追加 pending，停在独立正文关卡；重写使用请求里的当前全文与修改意见，保持章纲不变。2000–4000 字是软目标；技术上限为正文 100000、意见 10000 个 JavaScript 字符单位，写请求 body 1 MiB（UTF-8），实际 system+prompt 400000 字符。模型输出预算为16000 tokens、SDK maxRetries=0；结构化上游不静默截断。

### 保存、通过与并发

三个专用命令都提交完整文本和客户端实际读取的基线，不替换为服务器最新版：

```ts
type ProseHeadRequest = {
  chapter: number // 正安全整数
  expectedArtifactId: string
  expectedHeadVersion: number
}
// POST /api/works/:workId/artifacts/prose/save
type ProseSaveRequest = ProseHeadRequest & {
  expectedHumanStatus: 'pending' | 'approved'
  content: { text: string }
}
// POST /api/works/:workId/artifacts/prose/approve
type ProseApproveRequest = ProseHeadRequest & { content: { text: string } }
// POST /api/works/:workId/artifacts/prose/regenerate
type ProseRegenerateRequest = ProseHeadRequest & {
  content: { text: string }
  instructions: string
}
```

保存经 `WorkStore.saveArtifact` 原子追加新 ID／version+1／createdAt，保留基线状态；pending 可保存空草稿，approved 保存空白内容返回422并保留原文。Web 自动保存成功后的文本可在刷新后从服务端恢复。approved 默认阅读，进入编辑后自动保存且仍 approved；本轮不更新设定或 Wiki。

通过只接受 pending 和完整非空全文，经 finalize 原子写入本次实际提交的文本并置为 approved，保持 id/version/createdAt。通用 approve/setStatus 不接受 Prose。通过后的全文编辑使用 save，不能借重复 approve 或 regenerate 修改。

save 必须校验 `expectedHumanStatus`：通过不增加版本，审批前发出的旧 pending 自动保存即使仍携带相同 id/version，也不能覆盖刚通过的文本。两个 save、save 与 approve／regenerate 均以目标条件写入裁决；旧基线409且不自动重放。advance／Beat再生／Prose重写共享作品生成锁；保存可以使进行中的重写基线过时，该模型结果在 commit 时被拒绝。start-chapter 也共享同一作品生成锁。首次生成、重写、保存与通过均校验所需的前置 approved heads，避免把旧输入上的结果提交到已变化的作品。

### 读模型、诊断与恢复

每章完成时为 `prose-approved`、`nextStepId:null`，下一章必须显式开始；pending 为 `awaiting-prose-review`，可用动作 `save-draft/approve/regenerate`，approved 仍允许 `save-draft`；当前工作章完成时还允许 `start-next-chapter`，历史章不提供此动作。`listWorks.chapterCount` 只计各章 head 为 approved 的正文，保存 approved 新版本不多计一章。WorkView 的章目录提供章级动作，与整个作品当前关卡分开；读取历史章不会推进 Pipeline。只返回各地址 head，不提供旧版本回看；旧五步定义保留 `beat-approved`。

成功响应为 `{artifact, command, workflow, telemetry}`，command.operation 为 `save-prose/approve-prose/regenerate-prose`；首次生成在 advance outcome 中提供可选 `proseCommand`。save 的 expectedHead 额外含 humanStatus；save／approve 没有模型 attemptIds。保存结果必须新 ID、基线版本+1且状态不变；通过结果必须同 ID／版本且 approved；重写结果必须新 ID、版本+1且 pending。Prose 预算字段使用 `beatChars`，不借用 Beat 的 `outlineChars`。

失败提供 `writeOutcome:not-committed|unknown` 与阶段；写入后 adapter 异常或响应构造失败都为 unknown，不能据 HTTP 失败认定未落库。内容错误422、身份／状态／上游冲突409、请求格式400、body过大413；日志只记录安全身份、长度、hash和分类。

共享 `recoverProseSubmission` 把保存回读的作品／章节、下一版本、新身份、相同状态和逐字符全文与冻结请求匹配；精确匹配可确认保存结果，较新或不同内容按冲突保留本地输入。通过确认要求同 id/version/createdAt 和逐字符全文。未知重写不能仅凭 GET 新版认领成功；更早 unknown 也不会被后续 not-committed 清除。客户端最多自动回读一次，重试使用冻结基线，不自动改版本覆盖服务器。

生产 WorkStore 使用 SQLite，成功保存的正文及其版本、状态和 inputs 在同一数据目录中跨服务重启保留；未保存的页面内容不恢复。诊断仍是进程内窗口，重启不会自动续跑模型。实际持久性验证见 [Wiki 009](./wiki/009-sqlite-persistence.md)。设定检索与工具执行 #28、作品 Wiki 档案演进及联合通过 #29 均为后续扩展，不属于正文保存语义。

## 作者配置与版本文件：#7

可执行定义为 `packages/contracts/src/author-config.ts`；设计与证据见 [Wiki 007](./wiki/007-author-agent-config.md)。作品配置独立于内容关卡和旧 `Work.config`：`{preferences:{style?,genre?,payoff?}, defaults:controls, steps:{caption?,creative?,outline?,setting?,beat?,prose?}}`。省略字段继承，节点逐字段覆盖作品默认，数组替换；`systemPromptRef:null` 清除作者 Prompt，仍保留内置任务指导。模型、directionCount、thinking、temperature、topP 继续服从 ModelRuntime；tools 只接受空数组。偏好每项最多500字符；文风用于Prose、题材用于除Caption外各步、爽点用于Creative/Outline/Beat/Prose。

`GET /api/works/:id/agent-config` 返回 `{workId,revision,document,files,effective}`，effective 包含恰好六个唯一节点的实际模型/provider/参数/偏好/文件版本与运行模式。响应校验全部文件归属、唯一ID、选择与库中元数据完全匹配及provider/model一致。初始revision为0，仅此时兼容旧Work.config；保存后仅作者document和启动默认生效。已提交请求先匹配不可变回执，当前文件/模型不可用不否认历史提交；`PUT` 接收严格 `{requestId:UUID,expectedRevision:safe>=0,document}`，返回不可变 `{workId,requestId,revision,document}` 回执。SQLite `author_configs` 以作品/revision保存每次配置，requestId去重；同请求返回原回执，同ID异内容或旧revision为409；保存不改变产物或状态。

`POST /api/works/:id/agent-files` 接收 `{requestId:UUID,kind:'prompt'|'skill',text}`，返回 `{id,workId,kind,name,description,sha256,byteLength,createdAt}`；`GET /api/works/:id/agent-files/:fileId` 返回 `{file,text}`。客户端核对完整hash、UTF-8字节数及提交关联。Prompt由共享formatter封装成受管SKILL.md，Skill要求合法frontmatter name/description与非空正文。每文件≤32768 UTF-8 bytes，frontmatter≤4096 bytes，作品≤64文件，每节点≤4唯一Skill，装配后系统文本≤48000字符；HTTP请求≤196608 bytes且严格UTF-8/JSON。禁止重复YAML key和alias，不执行脚本/链接/附件或allowed-tools；校验失败安全400，文件缺失/损坏安全404，未知服务端写入错误不等于未提交。

文件路径由服务端在 `<dataDir>/prompts/<workId的完整SHA256>/<fileId>/<name>/SKILL.md` 生成，拒绝受管目录symlink；先0600临时文件写入/fsync，再exclusive hardlink原子发布/fsync目录，最后提交 `agent_files` 元数据。并发不能覆盖版本；数据库失败可留下无引用文件，同ID相同文本可安全重用。数据库只存元数据/引用，恢复必须包含整个数据目录。文件不可变，不提供删除或跨作品共享入口。

advance/start-chapter/regenerate在操作首个可执行节点之前解析全部实际配置和文件文本快照；同操作不混revision，后续保存只影响下一操作。文件篡改、预算或配置错误在调用模型前拒绝；已读取的快照不因外部文件改变而变更。遥测增加可选 `configRevision` 和 `configFiles:[{id,sha256}]`，模型及systemHash仍记录实际调用，不记录文本或凭据。内置输出契约、ID、内容预算和工程校验不能由作者指导关闭。

## 后续章：#6 续写契约

作品级 caption/creative/outline/setting 完成后，Beat → Prose 双关卡可逐章重复；同一作品同时只有一个未完成工作章。大纲是弧线/剧情点，章号不映射大纲索引，模型结合上一章实际正文提出下一章计划，作者在章纲关卡决定是否采用。

```ts
// POST /api/works/:workId/chapters/start
StartChapterRequest = {
  chapter: number // >= 2，正安全整数，明确绑定目标章
  expectedPreviousProseId: string
  expectedPreviousProseVersion: number
}

// GET /api/works/:workId 增加的字段
ChapterSummary = {
  chapter: number
  title: string
  beatStatus: 'pending' | 'approved' | null
  proseStatus: 'pending' | 'approved' | null
  allowedActions: string[]
  needsContinuityReview: boolean
}
// WorkView.currentChapter: number
// WorkView.chapters: ChapterSummary[]，按章排序
```

开始请求为严格对象，chapter 与 expectedPreviousProseVersion 都是安全整数，前章正文 ID 为非空且最多128字符，HTTP body 上限4096 bytes。目标尚不存在时，验证上一章为已通过正文、身份/版本匹配、章号连续，并复用作品生成锁与提交时前置条件；非法跳章、旧基线和不满足关卡均明确拒绝。合法形状的重放请求若目标章纲已存在，则只返回作品当前状态，不重新核对旧前章基线、不再次调用模型，也不会改成创建再下一章。返回 `AdvanceOutcomeDto`，包含本次真实 telemetry；业务 `failed` 仍需显式检查，不能只看 HTTP 200。

`advance` 不从已完成章隐式开启下一章。Web 的阅读章来自 URL 选择，服务端工作章来自产物与关卡；历史正文保存绑定自己的章号和状态，不能误用当前工作章的 global actions 决定权限。

后续章的 Beat/Prose 输入均在 `upstream` 中携带 `previousChapter: {chapter, beat, prose}`；只消费恰好前一章的最终内容，不引入全书正文拼接、摘要 Agent 或 Wiki 工具。生成前固定实际输入快照，提交时再次校验，调用中前章改变则返回 `upstream-changed`，不追加过期结果。

起章原请求的 `expectedPreviousProseId` 与 `expectedPreviousProseVersion` 也必须与实际输入读取时的前章一致，并保持到条件提交。初检通过后、配置快照与实际输入取样之间若独立连接更新前章，拒绝本次过期请求，不把新版本自动替换为请求基线。行为修复上下文见 [Wiki043](./wiki/043-mvp-review-boundary-fixes.md)。

前章内容计入节点的实际 system+prompt 总预算，超限在模型调用前拒绝；安全预算诊断新增 `previousChapterChars`，不输出原文。

生成时写入 `Artifact.inputs`，正文保存与定稿保留它。上游版本变化或前章衔接已过期时，章节摘要的 `needsContinuityReview` 提醒检查；既有章纲/正文和 humanStatus 均保留。提示不表示内容已经重新校对，不触发级联重写，也不自动清除人工关卡。

可执行字段与验证见 [artifacts.ts](../packages/contracts/src/artifacts.ts)、[公共 API](../packages/contracts/src/public-api.ts) 及 [Pipeline](../apps/server/src/pipeline/pipeline.ts)。工程意图、TDD、运行验证和当前交付状态见 [Wiki 006](./wiki/006-chapter-continuation.md)。

## 坏例快照：#8

`BadExampleRequest = {requestId:UUID, chapter, sourceArtifactId, sourceVersion, sourceHash:SHA256, start, end, text, note?}`；chapter/version为正安全整数，start/end为UTF-16位置，end-start等于text.length。选段非空白、完整Unicode、最多10000字符；备注最多2000；HTTP/CLI请求最多196608字节。服务端在短事务中读取指定作品的历史Prose，核对章号/版本/完整正文hash/精确slice，再创建不可变记录；pending同版通过修改内容会使旧hash拒绝新请求。

`BadExample = {id:requestId, workId, chapter, sourceArtifactId, sourceVersion, sourceHash, start, end, text, note, createdAt}`；note规范化为空串。SQLite v3 `bad_examples`保存record及规范化原请求，关联Work/章节并建索引，独立`BadExampleRepository`不扩大WorkStore。相同UUID且同内容返回原回执，先于当前源正文再验；改变内容或跨作品复用UUID为409，不同备注新UUID。后改/重写/通过不改样本，来源hash和快照为历史权威，不保证当前定位。

`POST /api/works/:id/bad-examples`返回BadExample；`GET .../bad-examples/:sampleId`按ID回读；`GET .../bad-examples?chapter=N&after=cursor`返回`{workId,chapter?,after?,items:BadExample[],nextCursor?}`，固定每页50，游标为正安全整数，重复/未知查询字段拒绝。客户端复验work/chapter/游标及完整写回执，不匹配或网络/5xx为unknown，无自动POST重放，原请求可显式对账/重试。

Web在已保存正文原生选段，保留来源文本供计算hash；正文dirty/unknown禁新标记。坏例未知期间锁定选段/备注和导航，GET未找到也不证明先前写入不会完成。显示本章样本及来源版本，分页回看；不调用LLM，不改变正文或关卡状态。
