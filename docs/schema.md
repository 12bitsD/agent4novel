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
| `beat` | 章纲 | 每作品 × 每章一份 |
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

`WorkView` 包含 `nextStepId: string | null`，其值来自 Pipeline 状态；新增 `awaiting-setting-review`、`setting-approved` 两个工作流状态。通用 `ready-to-generate`、`failed` 继续复用，不为每种产物复制一组状态。`outline-approved` 保留给以 Outline 结束的旧定义／测试；生产四步定义在大纲通过后进入 ready，具体可生成步骤由 `nextStepId` 标识。

#13 已集中本次经过的 WorkView／Artifact envelope 与 advance 响应（含既有 state、telemetry）定义，并复用 AgentConfig／telemetry schema。Setting 内容执行精确校验；其他 kind 的具体内容仍按现有各自入口校验，全 kind 注册表及剩余协议收敛归 #19。

规范化只去除纯文本标题的首尾空白。总览与正文用去空白结果判断是否非空，但保留原 Markdown 源文本、缩进和换行；不以渲染结果或 Markdown 语义等价比较内容。模型原始输出、请求与存储均复用此规则。

### 生命周期与存储边界

#13 的流程为 `caption → creative → outline → setting`。Setting 消费原始 `seed`、提炼稿、已选定且通过的单方向创意稿、已通过的大纲。生成成功后创建 `pending`；生成或校验失败不写半成品。

作者只在当前页面内存中修改草稿。点击“通过”时，服务端校验当前版本、`pending` 状态、完整内容与 ID，在一个原子操作中替换同一 Artifact 的内容并置为 `approved`；`Artifact.id`、`version` 不变。#13 不提供单独草稿保存或通过后的编辑接口，后续消费仅使用通过后的内容。

`expectedHeadVersion` 与状态检查须在同一原子操作中执行。并发或重复请求不能再次覆盖已通过内容；校验或冲突失败不修改原记录。网络响应丢失时应回读确认服务器状态，不能把传输失败等同于服务器未提交。

Setting 的状态迁移是单向的：首次生成创建 pending，专用完成命令将同一版本置为 approved。通用 `setStatus` 不接受 Setting，已通过内容不能退回 pending 后再次完成。

此设计沿用 `Work + Artifact`，不指定每种产物一张 SQL 表。当前运行存储仍是 `InMemoryStore`；真实 SQLite、迁移与重启持久性归 #9。`materials` 的多素材生命周期尚未定案，不是 #13 的新实体。
