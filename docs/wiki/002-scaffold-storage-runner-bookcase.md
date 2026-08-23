# 002 — 脚手架 + 存储 + workflow 骨架 + 书架

> Ticket: [#2](https://github.com/12bitsD/agent4novel/issues/2) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态：已实现

## 实现目的

交付一条最小可运行、可验证的全链路：数据模型文档 → 存储接口(mock) → 步骤契约 → 流水线 runner → Hono API → 书架页。完成后一条命令启动、浏览器打开能看到书架列出示例作品；runner 的顺序与关卡由 Vitest 覆盖，全程不调真 LLM。它是后续 #3–#5 每个写作步骤的"水管"——水管不通，水（LLM 产物）进不来。

## 决策基线

- 编排 = AI SDK v7 + 薄 DIY workflow：[ADR-0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md)
- 存储 = SQLite 为最终目标、mock 先行、prompt/skill 为文件：[ADR-0002](../adr/0002-storage-sqlite-skills-as-files.md)
- 选型依据：[research](../research/agent-tech-stack.md)（AI SDK / Vite+React / Hono / SQLite / SKILL.md）
- 两个 real seam：**存储**（InMemoryStore / SQLiteStore）、**步骤**（FakeStep / RealStep）；Pipeline 是深模块，不是 swap seam
- 步骤契约 = `run(input, config)`，声明 input/output schema 并校验；config 为每步 Agent 配置（本票传默认，完整配置在 #7）
- 领域词汇一律用 [CONTEXT.md](../../CONTEXT.md) 的定义

## 技术方案

### 仓库结构

```
agent4novel/
├── pnpm-workspace.yaml
├── package.json                 # 根：private，workspaces，dev/test/typecheck 脚本
├── tsconfig.base.json
├── docs/schema.md               # 数据模型（本票产出）
├── packages/contracts/          # @agent4novel/contracts
│   └── src/{artifacts.ts, step.ts, index.ts}
├── apps/server/                 # @agent4novel/server（Hono, 8787）
│   └── src/{index.ts, app.ts, routes/works.ts,
│            store/{work-store.ts, in-memory-store.ts},
│            pipeline/pipeline.ts}
└── apps/web/                    # @agent4novel/web（Vite+React, 5173, /api 代理 → 8787）
    └── src/{main.tsx, App.tsx, api.ts, pages/Bookcase.tsx}
```

### 数据模型（docs/schema.md 要点）

标识符映射（代码英文 id ↔ 领域中文词）：

| 领域词 | 代码 id | 形状 |
|---|---|---|
| 脑洞 | `seed`（Work 字段） | 每作品一份 |
| 卖点 | `hook` | 每作品一份 |
| 梗概 | `synopsis` | 每作品一份 |
| 大纲 | `outline` | 每作品一份 |
| 设定 | `setting` | 每作品一份 |
| 章纲 | `beat` | 每作品×每章一份 |
| 正文 | `prose` | 每作品×每章一份 |

实体：

- `Work = { id, title, seed, config: AgentConfig, createdAt }`
- `Artifact = { id, workId, kind, chapter?, version, content, status, createdAt }`
  - `chapter` 仅 `beat`/`prose` 有，其余为 `undefined`
  - `status ∈ { pending, approved }`；`appendArtifact` 追加新版本（version+1），旧版本保留
  - 不变量：per-work kind 禁止带 chapter；per-chapter kind 必须带 chapter

### 模块

**Step 契约（contracts）**

```ts
import { z } from 'zod'

export const agentConfigSchema = z.object({
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).optional(),   // SKILL.md 引用
  tools: z.array(z.string()).optional(),    // 如 ['webSearch']
})
export type AgentConfig = z.infer<typeof agentConfigSchema>

export interface Step<In = unknown, Out = unknown> {
  id: string
  inputSchema: z.ZodType<In>
  outputSchema: z.ZodType<Out>
  run(input: In, config: AgentConfig): Promise<Out>
}

export async function runStep(step: Step, input: unknown, config: AgentConfig) {
  const parsed = step.inputSchema.parse(input)
  const out = await step.run(parsed, config)
  return step.outputSchema.parse(out)   // 输入输出都校验
}
```

`Step` 对外只有一个入口 `run(input, config)`；拼 prompt、加载 skill、tool-call、web search、校验输出全在实现内部。**config 是显式输入**（用户风格/文风/题材是外部配置），Step 只藏机制、不藏风格。

**WorkStore（server/src/store）**

```ts
export interface WorkStore {
  createWork(input: { seed: string; title?: string }): Work
  listWorks(): WorkSummary[]          // { id, title, seedPreview, chapterCount }
  getWork(id: string): WorkDetail | undefined   // Work + 各产物最新版本
  appendArtifact(workId, kind, content, opts?: { chapter?: number }): Artifact
  setStatus(workId, kind, status, opts?: { chapter?: number }): void  // 作用最新版
}
```

`InMemoryStore` 用 `Map`，按 `(workId, kind, chapter)` 存版本数组，`getWork` 折叠到最新版本。

**Pipeline（server/src/pipeline）**

```ts
export type PipelineState = {
  workId: string
  stage: string
  nextStepId: string | null                     // null = 完本
  pendingGate?: { kind: ArtifactKind; chapter?: number }
}

export interface Pipeline {
  getState(workId): PipelineState
  advance(workId): StepResult                    // pendingGate 存在时拒绝、无副作用
  approve(workId, kind, chapter?): void
}

type PipelineDefinition = Array<{
  stepId: string
  outputKind: ArtifactKind
  gateBefore?: { kind: ArtifactKind }   // 运行前该产物须 approved
  gateAfter?: { kind: ArtifactKind }    // 运行后产物置 pending，等 approve
}>
```

构造时注入 `{ store, steps, definition, resolveConfig }`（接受依赖，不自己 new）。状态机由"现有产物 + status"算出下一步；`advance` 跑 nextStep → `appendArtifact` 落库 → 按 `gateAfter` 置 pending 或 approved。**关卡逻辑只活在这一个模块**（Locality）。本票放一条 demo 链（4 个 FakeStep + 1 个 `gateAfter` + 1 个 `gateBefore`）证明机制——比最小多几步，同时覆盖两种关卡方向；完整六步链在 #3–#5 扩展 `definition`，runner 不改。

### API（Hono，8787）

```
GET /api/works       → WorkSummary[]
GET /api/works/:id   → Work | 404
```

启动时 seed 2–3 个示例作品进 mock store。

### Web（书架，5173）

- `api.ts` fetch `/api/works`（Vite 代理 `/api` → 8787）
- `Bookcase.tsx`：卡片列出作品（标题 + 脑洞摘要），点击 → 占位详情视图（useState 切视图，不引 router；router 留给 #6）

## 测试策略

- **好测试标准**：只测外部行为——顺序、关卡强制、持久化、schema 校验；不测 prompt 文本 / LLM 内部。
- **FakeStep**：固定输出，但仍走 outputSchema 校验，保证测试逼真。
- 覆盖点：
  - contracts：`runStep` 对非法输入 / 输出抛错
  - store：create/list/get、append 版本自增、setStatus 作用最新版、per-work / per-chapter 形状不变量
  - pipeline：advance 按序、gateAfter 拦住下一步、approve 解封、终态 nextStepId=null、schema 不匹配被拒

## 实施顺序（红绿切片）

1. 脚手架：`pnpm-workspace.yaml` + 根 `package.json` + `tsconfig.base` + 三包骨架，`pnpm install`
2. contracts：类型 + zod + `runStep`，先写测试（红→绿）
3. `docs/schema.md` 落数据模型
4. store：接口 + `InMemoryStore`，先写测试（红→绿）
5. pipeline：状态机 + 关卡，先写测试（红→绿）
6. server：Hono app + routes + seed + 冒烟测试
7. web：书架 + 占位详情 + `api.ts`
8. 根 `dev` 脚本并发起 server+web，验证书架出数据
9. 全量测试 + typecheck → commit → `/code-review`

## 边界与错误

- advance 于终态 → 返回 `nextStepId: null`（幂等，不抛）
- advance 遇 pendingGate → 拒绝、无副作用、返回 state
- approve 不存在的产物 → 抛错
- `appendArtifact` 违反形状不变量 → 抛错
- 步骤注册重复 id → 构造时抛错
- `getWork` 不存在 → `undefined` → API 404

## 明确不做

- 真 LLM 步骤（RealStep）→ #3 起
- 完整 Agent 配置（三维度 + skill 上传 + 全局/单作品覆盖）→ #7（config 参数本票就位）
- SQLite 适配器 → #9
- 创作页 / 统一入口 → #3；详情页分层管理 → #6；坏例 → #8；路由 → #6

## 技术默认

pnpm · tsx（server dev）· tsc（typecheck）· vitest · zod · Hono · Vite+React（useState 视图切换）

## 状态记录

- 2026-08-22：实现完成。20 个测试全绿（contracts 3 / server 17），typecheck 全绿，`pnpm dev` 验证 server/web/proxy 通。
- 偏差：demo 链做成 4 步（含 gateAfter + gateBefore 两种关卡方向），非 wiki 原写的 2 步——超集，不违反 ticket。
- 偏差：TDD 未严格"先红后绿"（测试与实现同批写），行为覆盖完整；后续票按红绿切片执行。
- 修正：`getWork` 返回类型是 `WorkDetail`（Work + 最新产物），非 `Work`。
