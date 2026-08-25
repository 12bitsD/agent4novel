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
- 大纲分章**无卷**（#3b 决策，已同步 CONTEXT.md 大纲定义与 spec #1 故事 7）；场景/冲突/钩子归 beat（章纲）层
- 输入所处阶段字段名 = `inputStage`（CONTEXT.md 用词「阶段」；弃用 `granularity`——schema.md 已用「粗/细」占住粒度语义，`phase` 已被步骤两阶段占用）

## 技术方案

### 流程（启动界面转对话式）

```
启动界面：输入（可补充编辑）+ 上传 → 「开始创作」
  → POST /api/works（先落库：seed 持久化，中断不丢）
  → interview=true：advance(preprocess) 问题阶段 → 界面显示一批问题 → 作答
      → POST answer-interview → 归一化阶段 → 整份 JSON 落库（pending）
  → interview=false：advance 直接归一化 → 落库（pending）
  → 跳创作界面（idea 状态：列表式编辑已填充的要点）
  → 编辑/直接确认 → approved（过 preprocess 关卡，为 #4 就绪）
```

### 契约变更（packages/contracts）

**preprocess 最终形态**（provisional 转正）：

```ts
preprocessContentSchema = z.object({
  inputStage: z.enum(['脑洞', '设定', '主线', '模板']),
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

**落库与同步**（单源不漂移）：

- 三个 schema 落 contracts：server 校验 + web `z.infer` 类型。
- interview 类型同落 contracts/preprocess.ts：`interviewQuestionsSchema`（`{questions: string[]}`）、`interviewAnswerSchema`（`{question, answer}`）——web 问答表单复用。
- **schema.md 同 commit 同步**：preprocess 行改新形态（`hook`→`hooks`、加 `inputStage`、多实例并存语义）、删 provisional 注记；outline/setting 行补完整版形状引用。
- 受影响文件清单：packages/contracts（preprocess 转正 + outline/setting schema）、docs/schema.md、apps/server（pipeline `PipelineInput` 拓宽、routes 三新 API）、apps/web（Entry 对话式、Workspace 列表式）。

### Pipeline 变更（server/src/pipeline）

- 状态机新增 **`awaiting-interview`** 态；definition 节点加 `interview?: boolean`
- **`PipelineInput` 类型拓宽**：`{ workId }` → `{ workId, seed, phase, answers? }`（seed 从 store 取；**这是"上下文组装"的第一版**）
- preprocess 步骤两阶段（同一 step，`phase` 输入区分；`phase` 缺省 = `'normalize'`，pipeline 只在 interview 流程显式传，普通 advance 不传）：
  - `phase: 'questions'` → 输出 `{ content: { questions: string[] } }` → 不进产物，进 pendingInterview 状态
  - `phase: 'normalize'` → 输出 `{ content: PreprocessContent }` → `appendArtifact(kind='preprocess', pending)`
- 新方法 `answerInterview(workId, answers)`：喂回答 → 跑 normalize → 落库 → 状态前进
- pendingInterview 存 pipeline 内存（重启丢失，本票接受——见「边界与错误」）
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
- `GET /api/config` → `{ demo: boolean, interview: boolean }`（启动界面渲染前就要知道演示模式 / interview 开关）
- 现有 GET / POST works / PUT preprocess 不变（PUT 的 validate-on-write 随 contracts schema 升级自动传导）

### 启动界面转对话式（web）

- interview=true 且有 pendingInterview 时：输入区下方显示问题列表 + 作答表单 → 提交 answers
- 无 key 时顶部提示"演示模式（未配置 DEEPSEEK_API_KEY）"

### 创作界面（web）

- idea 状态编辑改**列表式**：每字段（卖点/梗概/设定/大纲）展示 N 条要点，增、删、改；「保存」整份 JSON 新版本
- pending 状态可见；「确认」按钮调 approve API
- tab 文案保持英文 `idea`（2026-08-25 拍板）

### 定义真链第一阶段

```ts
definition = [{ stepId: 'preprocess', outputKind: 'preprocess', gateAfter: { kind: 'preprocess' }, interview: true }]   // v1 硬编码开
```

## 测试策略

- 测试永远 fake（FakeStep 返回固定问题 + 固定要点 JSON）；**绝不调真 LLM**
- 覆盖：interview=true 全链路（advance→问题→waiting→answerInterview→normalize→落库 pending→approve）；interview=false 跳过；无 key → fake fallback；schema 校验（多实例形状）
- RealStep 组装逻辑：mock model（vi.mock registry/generateText）验证 prompt 组装与输出校验，不联网

## 实施顺序（红绿切片）

1. contracts 三 schema + jsonValueSchema 复用 + **schema.md 同步**（同 commit）+ 测试
2. web 创作界面列表式编辑（**提前**：contracts 改形即破 web 编译，且只依赖现有 PUT API；保持每个 commit 双绿）
3. Pipeline：awaiting-interview 态 + answerInterview + 两阶段 + `PipelineInput` 拓宽 + interview 开关 + 测试（fake）
4. server：RealStep + llm registry + fake fallback + advance/answer-interview/approve API + `GET /api/config` + 装配 + 测试
5. web：启动界面转对话式（问题/作答 + 演示模式提示）+ 创作界面 approve 按钮 + pending 徽标
6. 全量测试 + typecheck + `pnpm dev` 验证（无 key 走 fake 演示模式）→ commit → 3 轮校准 → /code-review

## 边界与错误

- 无 key → fake 演示模式（不报错）
- advance 在 awaiting-interview 时拒绝（无副作用）
- answerInterview 无 pendingInterview → 400
- 归一化输出过 schema 校验失败 → 500 并提示（agent 输出不稳时的兜底）
- 服务器重启丢失 pendingInterview → **对 ADR-0001 持久化方向的临时偏离，显式标注**：interview 问答态是瞬态非产物，本票接受丢失，#9 随 SQLite 落地时一并持久化

## 明确不做

- outline / setting 的**生成步骤实现**（本票只定形态）→ 后续票（#4 及设定追加）
- beat / prose 章节循环 → #5
- 创作界面卡片组 / tab 视觉细化
- SQLite → #9；Agent 配置 UI → #7；坏例 → #8

## 状态记录

- 2026-08-24：对齐完成（多实例并存 / outline=chapters 无卷、scene 归 beat / setting 四维度 + extra / 先落库再问答 / key 零感知），计划存档，待开工。
- 2026-08-25：/code-review（Standards + Spec 两轴并行 subagent）+ 自校准 5 点。修：① schema.md 同步列入「契约变更」+ slice 1（AC1 原要求 contracts + schema.md 双落库）；② `granularity`→`inputStage`（粒度语义被 schema.md「粗/细」占用、`phase` 被两阶段占用）；③ `PipelineInput` 拓宽点名；④「流程」节并入「技术方案」（回归 8 段模板）；⑤ pendingInterview 显式标 ADR-0001 临时偏离；⑥ README 索引 003b→010。拍板：大纲无卷同步 CONTEXT.md + spec #1 故事 7；idea tab 保持英文。驳回：Speculative Generality / Divergent Change（outline/setting 定形、双主题均为 ticket #10 授权范围）。复核通过项：PUT 已 validate-on-write（schema 升级自动传导）、测试不联网已明示。
- 2026-08-25（执行计划评审通过，开工）：定切片顺序（创作界面列表式提前为 slice 2——contracts 改形即破 web 编译，且它只依赖现有 PUT；保持每 commit 双绿）；补 `GET /api/config`（Entry 渲染前需 demo/interview 标记）；`phase` 缺省 normalize（pipeline 尽量零感知）；interview 类型落 contracts/preprocess.ts（web 问答表单复用）；interview 开关 v1 硬编码 true。
- 2026-08-26（实现完成，slice 1–5）：偏差与踩坑——
  - 步骤输入/输出 schema 提取为 `steps/preprocess-io.ts`（RealStep / FakeStep / 测试 fake 三方同源，避免三处重复定义）。
  - 踩坑：slice 4 提交时 typecheck 被管道里的 `grep` 吞掉退出码，三个类型错误漏检、带错提交后 amend 补修（`PreprocessStepOutput` 标注、registry `deepseek:${string}` 模板类型收窄、buildPrompt 的 phase 形参改可选）。**教训：门禁命令不许用 grep 截断 exit code，必须看原始退出码。**
  - Entry 增加「跳过，直接生成」次按钮（对应 buildPrompt 的无作答路径，wiki 流程未明写，小补充）。
  - 端到端验证通过（无 key 演示模式）：config → 创建 → advance（awaiting-interview + 3 问）→ advance 无副作用 → answer-interview（pending 落库）→ approve（complete）；answer-interview 重放 400、approve 带 chapter 400、advance 未知作品 404；web 5173 + /api 代理正常。
  - 未决：真 key 下模型名实测（research 标 unverified）；pendingInterview 重启丢失待 #9 持久化。
- 2026-08-26（3 轮自校准完成）：R1 需求对账（AC1–6 全对得上，含路由/状态机/key 零感知逐条 grep 验证）；R2 规范（禁区词零命中、granularity 零残留、SKILL.md 落文件；**修掉 store.test.ts 旧四字段 fixture**——store 本不感知形状，改中性 `{note}`）；R3 测试/边界（81 测试 + typecheck 绿、测试策略覆盖点全有、明确不做零越界）。**已知限制（不修，挂后续票）**：advance/answer-interview 失败后作品已落库但创作界面没有「重新预处理」入口（→ #6 续写/详情页时代再议）；「演示模式」是 UI 词非领域词，暂不进 CONTEXT.md。
