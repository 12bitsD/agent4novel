# 010 — 预处理 RealStep + interview + outline/setting 形态对齐（#3b）

> Ticket: [#10](https://github.com/12bitsD/agent4novel/issues/10) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态：待实现

## 实现目的

把 #3a 备好的人工链路接上 agent：启动界面提交后，agent 反向 interview（可开关），产出 preprocess 产物（多实例 JSON）；同时把 outline / setting 完整版的产物形态设计定案（本票不实现生成）。核心交付：**第一个真 LLM 步骤（RealStep）落地**，打通"pipeline 驱动 agent 步骤"的完整链路，让 Step 契约开始承载真模型。

## 决策基线

- 三界面模型；step 零感知、kind=节点名、content=JsonValue（[wiki 003](./003-unified-entry-idea-workspace.md)）
- 编排 = AI SDK + 薄 DIY workflow（[ADR-0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md)）
- provider = `createProviderRegistry` + `@ai-sdk/deepseek`，代码零感知 key（registry 按约定读 `DEEPSEEK_API_KEY`），无 key fallback fake（[research](../research/llm-provider-strategy.md)）
- skill/prompt 为文件（[ADR-0002](../adr/0002-storage-sqlite-skills-as-files.md)）
- interview = 批量问答（一轮一批问题），definition 字段开关；多实例要点并存（非单选定稿）
- 人工保存 = approved（沿用 #3a）；agent 产出 = pending，等 preprocess 关卡

## 流程（启动界面转对话式）

```
启动界面：输入（可补充编辑）+ 上传 → 「开始创作」
  → POST /api/works（先落库：seed 持久化，中断不丢）
  → interview=true：advance(preprocess) 问题阶段 → 界面显示一批问题 → 作答
      → POST answer-interview → 归一化阶段 → 整份 JSON 落库（pending）
  → interview=false：advance 直接归一化 → 落库（pending）
  → 跳创作界面（idea 状态：列表式编辑已填充的要点）
  → 编辑/直接确认 → approved（过 preprocess 关卡，为 #4 就绪）
```

## 技术方案

### 契约变更（packages/contracts）

**preprocess 最终形态**（provisional 转正）：

```ts
preprocessContentSchema = z.object({
  granularity: z.enum(['脑洞', '设定', '主线', '模板']),
  hooks: z.array(z.string()),
  synopsis: z.array(z.string()),
  setting: z.array(z.object({ title: z.string(), content: z.string() })),
  outline: z.array(z.object({ title: z.string(), content: z.string() })),
})
```

**outline 形态定案**（本票只定设计，不实现生成）：

```ts
outlineContentSchema = z.object({
  chapters: z.array(z.object({ number: z.number(), title: z.string(), summary: z.string() })),
})
// 场景/冲突/钩子不进 outline —— 那是 beat（章纲）层，在生成正文前的章纲关卡把关
```

**setting 形态定案**（本票只定设计，不实现生成）：

```ts
settingContentSchema = z.object({
  worldview: z.string(),
  powerSystem: z.string(),
  factions: z.array(z.object({ name: z.string(), description: z.string() })),
  characters: z.array(z.object({ name: z.string(), role: z.string(), motivation: z.string(), profile: z.string() })),
  extra: z.record(z.string(), jsonValueSchema).optional(),   // 扩展槽
})
```

三个 schema 落 contracts（server 校验 + web `z.infer` 类型，单点不漂移）。

### Pipeline 变更（server/src/pipeline）

- 状态机新增 **`awaiting-interview`** 态；definition 节点加 `interview?: boolean`
- Step 输入组装：pipeline 给步骤传 `{ workId, seed, phase, answers? }`（seed 从 store 取；**这是"上下文组装"的第一版**）
- preprocess 步骤两阶段（同一 step，`phase` 输入区分）：
  - `phase: 'questions'` → 输出 `{ content: { questions: string[] } }` → 不进产物，进 pendingInterview 状态
  - `phase: 'normalize'` → 输出 `{ content: PreprocessContent }` → `appendArtifact(kind='preprocess', pending)`
- 新方法 `answerInterview(workId, answers)`：喂回答 → 跑 normalize → 落库 → 状态前进
- pendingInterview 存 pipeline 内存（重启丢失，本票接受，记进状态记录）
- 步骤输入/输出都过 zod 校验（沿用 runStep）

### RealStep（server/src/steps/）

- `llm.ts`：`createProviderRegistry({ deepseek })`；`hasLlmKey()`；model id 字符串 `'deepseek:deepseek-chat'`（确切模型名拿真 key 后实测，research 已标 unverified）
- `preprocess-step.ts`：RealStep 组装 prompt（system prompt + skill 文件注入 + input）→ `generateText` → zod 校验输出；**零 key 处理**（provider 层管）
- **fallback**：无 `DEEPSEEK_API_KEY` → 用 FakeStep（固定问题 + 固定四字段要点 JSON），启动界面提示"演示模式"
- skill 文件：server/src/steps/skills/preprocess/SKILL.md（提示词以文件维护，ADR-0002）

### API（server/src/routes）

- `POST /api/works/:id/advance` → pipeline.advance → 返回 PipelineState（含 pendingGate / pendingInterview）
- `POST /api/works/:id/answer-interview` `{ answers: [{question, answer}] }` → 归一化 → 落库
- `POST /api/works/:id/approve` `{ kind, chapter? }` → pipeline.approve
- 现有 GET / POST works / PUT preprocess 不变

### 启动界面转对话式（web）

- interview=true 且有 pendingInterview 时：输入区下方显示问题列表 + 作答表单 → 提交 answers
- 无 key 时顶部提示"演示模式（未配置 DEEPSEEK_API_KEY）"

### 创作界面（web）

- idea 状态编辑改**列表式**：每字段（卖点/梗概/设定/大纲）展示 N 条要点，增、删、改；「保存」整份 JSON 新版本
- pending 状态可见；「确认」按钮调 approve API

### 定义真链第一阶段

```ts
definition = [{ stepId: 'preprocess', outputKind: 'preprocess', gateAfter: { kind: 'preprocess' }, interview: <开关> }]
```

## 测试策略

- 测试永远 fake（FakeStep 返回固定问题 + 固定要点 JSON）；**绝不调真 LLM**
- 覆盖：interview=true 全链路（advance→问题→waiting→answerInterview→normalize→落库 pending→approve）；interview=false 跳过；无 key → fake fallback；schema 校验（多实例形状）
- RealStep 组装逻辑：mock model（vi.mock registry/generateText）验证 prompt 组装与输出校验，不联网

## 实施顺序（红绿切片）

1. contracts 三 schema + jsonValueSchema 复用 + 测试
2. Pipeline：awaiting-interview 态 + answerInterview + 两阶段 + interview 开关 + 测试（fake）
3. server：RealStep + llm registry + fake fallback + advance/answer-interview/approve API + 测试
4. web：启动界面转对话式（问题/作答）+ 创作界面列表式编辑 + approve 按钮
5. 全量测试 + typecheck + `pnpm dev` 验证（无 key 走 fake 演示模式）
6. commit → 3 轮校准 → /code-review

## 边界与错误

- 无 key → fake 演示模式（不报错）
- advance 在 awaiting-interview 时拒绝（无副作用）
- answerInterview 无 pendingInterview → 400
- 归一化输出过 schema 校验失败 → 500 并提示（agent 输出不稳时的兜底）
- 服务器重启丢失 pendingInterview → 记录于状态记录，后续 SQLite 再持久化

## 明确不做

- outline / setting 的**生成步骤实现**（本票只定形态）→ 后续票（#4 及设定追加）
- beat / prose 章节循环 → #5
- 创作界面卡片组 / tab 视觉细化
- SQLite → #9；Agent 配置 UI → #7；坏例 → #8

## 状态记录

- 2026-08-24：对齐完成（多实例并存 / outline=chapters 无卷、scene 归 beat / setting 四维度 + extra / 先落库再问答 / key 零感知），计划存档，待开工。
