# 数据模型

agent4novel 的领域数据模型。代码英文 id ↔ 领域中文词（见 [CONTEXT.md](../CONTEXT.md)）的映射、实体、形状与不变量。SQLite 建表（issue #9）以此为准。

## kind = 节点名

产物按**流水线节点**归类（一个节点 = 一个产物，content 装整个 JSON）：

| 节点（kind） | 产物内容 | 形状 |
|---|---|---|
| `caption` | 提炼稿（#3c）：`{inputStage（脑洞/设定/主线/模板）, summary, elements:[{kind,content}], gaps[]}`；理解层产物，落库即 approved，不设关卡 | 每作品一份 |
| `creative` | 创意稿（#3c）：`{directions:[方向包 ×N]}`，方向包 = `directionId + title + hook + tags[] + synopsis + characters[] + setting[] + payoffs[] + outline[]`（全 hint 级）；N=directionCount（默认 2，严格 1~3）；选定时落**单方向**新版本 | 每作品一份 |
| `outline` | 大纲完整版：`{chapters:[{number,title,summary}]}`（分章无卷；场景/冲突/钩子归 beat 层） | 每作品一份 |
| `setting` | 设定完整版：`{worldview, powerSystem, factions:[{name,description}], characters:[{name,role,motivation,profile}], extra?}` | 每作品一份 |
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

- `appendArtifact` 追加新版本（version+1），旧版本保留，可回退/对比
- `humanStatus` 语义：`pending` = 待作者把关（关卡中）；`approved` = 已通过
- 人工保存语义分节点（#3c）：caption 落库即 `approved`（无关卡）；creative 保存草稿 = 新版本 + `pending`（`saveCreativeDraft`），显式选定方向 = 单方向新版本 + `approved`（`selectCreativeDirection`）；后续节点的人工保存策略随各票定
- 关卡在步骤边界：`gateAfter` 的步骤产出后置 `pending` 等 approve；`gateBefore` 的步骤要求目标产物已 `approved`；`consumes` 的上游产物读最新版且必须 `approved`
