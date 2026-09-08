# 数据模型

agent4novel 的领域数据模型。代码英文 id ↔ 领域中文词（见 [CONTEXT.md](../CONTEXT.md)）的映射、实体、形状与不变量。SQLite 建表（issue #9）以此为准。

## kind = 节点名

产物按**流水线节点**归类（一个节点 = 一个产物，content 装整个 JSON）：

| 节点（kind） | 产物内容 | 形状 |
|---|---|---|
| `caption` | 提炼稿（#3c）：`{inputStage（脑洞/设定/主线/模板）, summary, elements:[{kind,content}], gaps[]}`；理解层产物，落库即 approved，不设关卡 | 每作品一份 |
| `creative` | 创意稿（#3c）：`{directions:[方向包 ×N]}`，方向包 = `directionId + title + hook + tags[] + synopsis + characters[] + setting[] + payoffs[] + outline[]`（全 hint 级）；N=directionCount（默认 2，严格 1~3）；选定时落**单方向**新版本 | 每作品一份 |
| `outline` | 大纲（#4，两层，与章节解耦）：`{arcs:[{arcId, title, conflict, development, resolution, segments:[{segmentId, title, summary, outcome}]}]}`；弧线 3~8、每弧剧情点 2~8；`arcId`/`segmentId` 由 server 注入；章数不在本层（归 #5） | 每作品一份 |
| `setting` | 完整设定（#13）：`{overview, world[], characters[], factions[], relationships[], extensions[]}`；固定栏目通用卡片 + 动态补充栏目，具体规则见下方 | 每作品一份 |
| `beat` | 章纲；当前第一章形态与协议见[下方](#beat5-当前契约)，已接入生产链 | 每作品 × 每章一份 |
| `prose` | 正文 | 每作品 × 每章一份 |

**卖点 / 梗概 不是独立产物**：卖点 = 创意稿方向包的 `hook` / `payoffs`，梗概 = `synopsis`。创意稿里的人物/设定/大纲是 **hint（粗）**；`outline` / `setting` 节点产出的**完整版（细）**是独立产物。各 kind 的 zod schema 见 packages/contracts（caption.ts / creative.ts / outline.ts / setting.ts）。

## 实体

### Work（作品）

```ts
Work = {
  id: string
  title: string
  seed: string          // 脑洞原文（启动界面输入/上传文本）
  config: AgentConfig   // 每作品可覆盖的 Agent 配置
  createdAt: string
}
```

### Artifact（产物）

```ts
Artifact = {
  id: string
  workId: string
  kind: ArtifactKind    // caption | creative | outline | setting | beat | prose
  chapter?: number      // 仅 beat / prose 有
  version: number       // 每次追加 +1，旧版本保留
  content: JsonValue    // 任意 JSON；各 kind 的形状见上表与 packages/contracts
  humanStatus: HumanStatus   // pending | approved；SQLite 列名 human_status
  createdAt: string
}
```

`JsonValue` = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }（递归）。

## 形状不变量

- per-work kind（`caption`/`creative`/`outline`/`setting`）：`chapter` 必须为 `undefined`
- per-chapter kind（`beat`/`prose`）：`chapter` 必须为 `number`

## 版本与关卡

- `appendArtifact` 追加新版本（version+1），旧版本保留；当前公开读模型只返回各地址的 head，尚无历史回看／回退入口
- `humanStatus` 语义：`pending` = 待作者把关（关卡中）；`approved` = 已通过
- 人工保存语义分节点：caption 落库即 `approved`（无关卡）；creative 保存草稿 = 新版本 + `pending`（`saveCreativeDraft`），显式选定方向 = 单方向新版本 + `approved`（`selectCreativeDirection`）；outline（#4）保存草稿 = 新版本 + `pending`（`saveOutlineDraft`，新增弧线/剧情点的 id 由 server 补注入），通过 = 通用 `/approve`；setting（#13）不保存中间草稿，专用完成命令将同 id／version 的内容和状态原子定稿，不追加 V2
- 关卡在步骤边界：`gateAfter` 的步骤产出后置 `pending` 等 approve；`gateBefore` 的步骤要求目标产物已 `approved`；`consumes` 的上游产物读最新版且必须 `approved`

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

`WorkView` 包含 `nextStepId: string | null`，其值来自 Pipeline 状态；新增 `awaiting-setting-review`、`setting-approved` 两个工作流状态。通用 `ready-to-generate`、`failed` 继续复用，不为每种产物复制一组状态。`outline-approved` 保留给以 Outline 结束的旧定义／测试；生产五步定义在大纲通过后进入 ready，具体可生成步骤由 `nextStepId` 标识。

#13 已集中本次经过的 WorkView／Artifact envelope 与 advance 响应（含既有 state、telemetry）定义，并复用 AgentConfig／telemetry schema。Setting 内容执行精确校验；其他 kind 的具体内容仍按现有各自入口校验，全 kind 注册表及剩余协议收敛归 #19。

规范化只去除纯文本标题的首尾空白。总览与正文用去空白结果判断是否非空，但保留原 Markdown 源文本、缩进和换行；不以渲染结果或 Markdown 语义等价比较内容。模型原始输出、请求与存储均复用此规则。

### 生命周期与存储边界

#13 的流程为 `caption → creative → outline → setting`。Setting 消费原始 `seed`、提炼稿、已选定且通过的单方向创意稿、已通过的大纲。生成成功后创建 `pending`；生成或校验失败不写半成品。

作者只在当前页面内存中修改草稿。点击“通过”时，服务端校验当前版本、`pending` 状态、完整内容与 ID，在一个原子操作中替换同一 Artifact 的内容并置为 `approved`；`Artifact.id`、`version` 不变。#13 不提供单独草稿保存或通过后的编辑接口，后续消费仅使用通过后的内容。

`expectedHeadVersion` 与状态检查须在同一原子操作中执行。并发或重复请求不能再次覆盖已通过内容；校验或冲突失败不修改原记录。网络响应丢失时应回读确认服务器状态，不能把传输失败等同于服务器未提交。

Setting 的状态迁移是单向的：首次生成创建 pending，专用完成命令将同一版本置为 approved。通用 `setStatus` 不接受 Setting，已通过内容不能退回 pending 后再次完成。

此设计沿用 `Work + Artifact`，不指定每种产物一张 SQL 表。当前运行存储仍是 `InMemoryStore`；真实 SQLite、迁移与重启持久性归 #9。`materials` 的多素材生命周期尚未定案，不是 #13 的新实体。

## Beat：#5 当前契约

本节是 #5 当前可执行契约；2026-09-08 从已评审方案落地。运行时定义位于 `packages/contracts/src/beat.ts`、`beat-submission.ts`、`public-api.ts` 与 `telemetry.ts`；工程 HOW、条件写入、恢复流程与 TDD 见 [Wiki 005](./wiki/005-beat-generation-review.md)。已实现的 Setting 契约保持上文不变。

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
// kind: 'beat', chapter: 1, version, id, workId, humanStatus, createdAt
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

路径沿用 Setting 的风格，用请求中的显式章号定位 Beat；首次生成仍调用现有 advance，不增加另一条初次生成路径。

```ts
// POST /api/works/:workId/artifacts/beat/approve
type BeatApproveRequest = {
  chapter: number              // 本期入口仅接受 1
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatReviewDraft
}

// POST /api/works/:workId/artifacts/beat/regenerate
type BeatRegenerateRequest = {
  chapter: number              // 本期入口仅接受 1
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatEditDraft       // 当前页，而不是服务端初稿
  instructions: string         // 必须存在，允许 ''
}
```

请求对象严格校验未知字段。完整性问题返回字段路径；外来 ID 即使出现在暂时不完整的再生草稿中也拒绝。初次生成通过 `POST /api/works/:workId/advance` 发起，不能用 regenerate 创建缺失目标。

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
| `target` | 已验证的 `{workId, kind:'beat', chapter:1}`；路径／body 尚未通过结构校验时不伪造完整 target |
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

现有 LLM 账本容量为**进程内全局 1,000 条，不是每作品 1,000 条**。命令摘要用同样全局有界的独立 1,000 条环形缓冲；不记录命令 body。`window` 为两类缓冲分别返回 `capacity/oldestSeq/latestSeq/truncated`，并给出随机 `processInstanceId` 与 `retention:'process-memory'`；truncated 表示该进程该缓冲已发生淘汰，不代表过滤查询本来就有命中。空缓冲 seq 为 null，查询结果为空不能证明未执行；重启清空且 processInstanceId 改变，旧作品也可能直接 404。

每次响应的 LLM 内联数据按 requestId／本次 attemptIds 精确收集，不能继续仅靠 workId 加前后 cursor 筛选，避免锁冲突响应混入另一请求的记录。环形缓冲被淘汰不应导致本次响应丢遥测：在命令作用域内保留有界的本次记录副本。首次多步 advance 的内联 telemetry 保持完整本次请求，beatCommand.attemptIds 只关联 Beat；其他 Step 的业务诊断本票不扩展。

命令结束摘要含上述安全字段、时间、稳定结果 code；busy 只是一时锁状态，不是任务完成凭据。HTTP 丢失后的日志可以解释“发生过什么”，但本票不靠日志自动确认随机再生归属，也不因缺日志而重新调用模型。记录／查询故障应降级为诊断不可用，不改变真实写入结果。

### 外层身份与生命周期

#5 将 Work／Artifact 身份分别改为 `work-<UUID>`／`artifact-<UUID>`，避免重启后重新从零计数使旧请求误中新作品；客户端只把 ID 当作不透明身份。当前 Store 使用 UUID；旧序号数据无持久迁移需求，因为存储仍是进程内存。Beat 新卡为 `beat-item-<UUID>`，人工同版编辑保留旧卡身份，AI 再生采用全新卡身份。

首次生成追加 v1 pending，整份再生成功追加下一版 pending；人工通过原子更新当前完整内容与 approved 状态，保留 id/version/createdAt。通用 approve/setStatus 不接受 Beat，不提供保存中间草稿、已通过修改或退回 pending；详见 [Wiki 005 写入一致性](./wiki/005-beat-generation-review.md#5-写入一致性生成追加通过同版本定稿)。本票仍用内存 WorkStore；SQL 表与持久化不在本节实施。
