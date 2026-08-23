# 数据模型

agent4novel 的领域数据模型。代码英文 id ↔ 领域中文词（见 [CONTEXT.md](../CONTEXT.md)）的映射、实体、形状与不变量。SQLite 建表（issue #9）以此为准。

## 标识符映射

| 领域词 | 代码 id | 形状 |
|---|---|---|
| 脑洞 | `seed`（Work 字段） | 每作品一份 |
| 卖点 | `hook` | 每作品一份 |
| 梗概 | `synopsis` | 每作品一份 |
| 大纲 | `outline` | 每作品一份 |
| 设定 | `setting` | 每作品一份 |
| 章纲 | `beat` | 每作品 × 每章一份 |
| 正文 | `prose` | 每作品 × 每章一份 |

## 实体

### Work（作品）

```ts
Work = {
  id: string
  title: string
  seed: string          // 脑洞原文
  config: AgentConfig   // 每作品可覆盖的 Agent 配置
  createdAt: string
}
```

### Artifact（产物）

```ts
Artifact = {
  id: string
  workId: string
  kind: ArtifactKind    // hook | synopsis | outline | setting | beat | prose
  chapter?: number      // 仅 beat / prose 有
  version: number       // 每次追加 +1，旧版本保留
  content: string
  humanStatus: HumanStatus   // pending | approved；SQLite 列名 human_status
  createdAt: string
}
```

## 形状不变量

- per-work kind（`hook`/`synopsis`/`outline`/`setting`）：`chapter` 必须为 `undefined`
- per-chapter kind（`beat`/`prose`）：`chapter` 必须为 `number`

## 版本与关卡

- `appendArtifact` 追加新版本（version+1），旧版本保留，可回退/对比
- `humanStatus` 语义：`pending` = 待作者确认（关卡中）；`approved` = 已通过
- 关卡在步骤边界：`gateAfter` 的步骤产出后置 `pending` 等 approve；`gateBefore` 的步骤要求目标产物已 `approved`
