# 数据模型

agent4novel 的领域数据模型。代码英文 id ↔ 领域中文词（见 [CONTEXT.md](../CONTEXT.md)）的映射、实体、形状与不变量。SQLite 建表（issue #9）以此为准。

## kind = 节点名

产物按**流水线节点**归类（一个节点 = 一个产物，content 装整个 JSON）：

| 节点（kind） | 产物内容 | 形状 |
|---|---|---|
| `preprocess` | 预处理 JSON：`inputStage`（脑洞/设定/主线/模板）+ `hooks[]`（卖点）+ `synopsis[]`（梗概）+ `setting[]`（{title,content} 设定 hint）+ `outline[]`（{title,content} 大纲 hint）；四类要点多实例并存 | 每作品一份 |
| `outline` | 大纲完整版：`{chapters:[{number,title,summary}]}`（分章无卷；场景/冲突/钩子归 beat 层） | 每作品一份 |
| `setting` | 设定完整版：`{worldview, powerSystem, factions:[{name,description}], characters:[{name,role,motivation,profile}], extra?}` | 每作品一份 |
| `beat` | 章纲 | 每作品 × 每章一份 |
| `prose` | 正文 | 每作品 × 每章一份 |

**卖点 / 梗概 不是独立产物**，是 `preprocess` 产物 JSON 里的数组字段（`hooks` / `synopsis`）。preprocess 里的设定/大纲是 **hint（粗）**；`outline` / `setting` 节点产出的**完整版（细）**是独立产物。三者的 zod schema 见 packages/contracts（preprocess.ts / outline.ts / setting.ts）。

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
  kind: ArtifactKind    // preprocess | outline | setting | beat | prose
  chapter?: number      // 仅 beat / prose 有
  version: number       // 每次追加 +1，旧版本保留
  content: JsonValue    // 任意 JSON；各 kind 的形状见上表与 packages/contracts
  humanStatus: HumanStatus   // pending | approved；SQLite 列名 human_status
  createdAt: string
}
```

`JsonValue` = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }（递归）。

## 形状不变量

- per-work kind（`preprocess`/`outline`/`setting`）：`chapter` 必须为 `undefined`
- per-chapter kind（`beat`/`prose`）：`chapter` 必须为 `number`

## 版本与关卡

- `appendArtifact` 追加新版本（version+1），旧版本保留，可回退/对比
- `humanStatus` 语义：`pending` = 待作者确认（关卡中）；`approved` = 已通过
- 人工保存（编辑产物）= 追加新版本 + `approved`（#3a 无关卡；#3b 引入 agent 后重新审视此语义）
- 关卡在步骤边界：`gateAfter` 的步骤产出后置 `pending` 等 approve；`gateBefore` 的步骤要求目标产物已 `approved`
