---
wiki_id: "004"
ticket: 4
ticket_state: done
context_state: current
summary: "全书大纲采用弧线与剧情点两层结构，并在独立人工关卡中保存、审阅和通过。"
topics: ["outline", "story-arcs", "story-segments", "workflow-gates", "outline-review"]
code_paths: ["packages/contracts/src/outline.ts", "packages/contracts/src/artifacts.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/steps/outline-io.ts", "apps/server/src/steps/outline-step.ts", "apps/server/src/routes/works.ts", "apps/server/src/start.ts", "apps/server/test/pipeline.test.ts", "apps/web/src/outline-review.ts", "apps/web/src/pages/OutlineReview.tsx"]
symbols: ["outlineContentSchema", "outlineDraftSchema", "createOutlineStep", "PipelineDefinitionEntry", "workflowOf", "normalizeOutlineIds", "ReviewState", "advance-in-progress", "version-conflict"]
inherits: ["011"]
changed_by: ["016", "013"]
read_when: ["change-outline-schema", "change-outline-generation", "debug-outline-gate", "change-outline-editor"]
last_context_reviewed: "2026-09-05"
---

# 004 — 大纲生成：弧线 + 剧情点两层结构

## Agent Context

- **读取时机**：修改大纲 schema、生成步骤、保存/通过语义、工作流关卡或大纲编辑器时读取。
- **原始目的**：用可审阅的全书结构替代“每章一句话”的分章大纲，并为后续章纲切片提供稳定输入。
- **实际落地**：outline 成为 caption → creative → outline 链路的第三步，生成后停在人工关卡；作者可编辑草稿并单独通过。
- **当前价值**：本文是弧线、剧情点、outline 关卡与编辑行为的当前 HOW；已有 ID 稳定，但批量新增存在重复 ID 的已知限制。
- **后续变化**：模型配置由 [Wiki 016](./016-model-runtime-provider-config.md) 接管；[Wiki 013](./013-setting-generation-review.md) 在大纲后追加 Setting，Web 大纲通过动作成功后续跑一次 advance，生产链不再以 outline-approved 结束。大纲保存／通过本身的两步语义不变。
- **代码入口**：[outline contract](../../packages/contracts/src/outline.ts)、[pipeline](../../apps/server/src/pipeline/pipeline.ts)、[server assembly](../../apps/server/src/start.ts)、[works routes](../../apps/server/src/routes/works.ts)、[review state](../../apps/web/src/outline-review.ts)。

## 设计目的

大纲层只回答“全书冲突如何推进与收束”，不提前决定章节数量。这样作者能在一屏级别审阅全书张力，下游也能按剧情点逐段规划章纲。

| 层级 | 职责 | 字段 | 主要消费者 |
|---|---|---|---|
| 弧线 arc | 一个核心冲突的提出、发展与解决 | title / conflict / development / resolution | 作者把握全书方向 |
| 剧情点 segment | 弧线内一次可执行的情节推进 | title / summary / outcome | 作者局部编辑、后续章纲切片 |

关键人类决策：resolution 写清收束后的局势，outcome 写清本段造成的变化；两者是长线一致性锚点。人物仅在文本中提名，结构化引用归设定层；场景、钩子、爽点和章节数量归后续章纲。

上段保留 #4 的职责分配背景；后来 #13 的 Human 对齐选择通用文本卡片，不实现关系端点或结构化引用，当前设定范围以 Wiki 013 为准。

## 起始上下文

本票交付 issue [#4](https://github.com/12bitsD/agent4novel/issues/4)，产品验收背景来自 spec [#1](https://github.com/12bitsD/agent4novel/issues/1)。它继承 [wiki 011](./011-caption-creative-directions.md) 已落地的 caption → creative 链式推进、单方向选定、消费守卫、互斥锁和失败读模型。

开工时，旧 outline 还是 chapters 数组，workflowOf 只认识 creative，complete 仍映射到已废弃的 selected；outline 也未注册进 pipeline。三者必须一起替换，才能让选定 creative 后进入大纲关卡。

当时存储生命周期等同进程生命周期，因此破坏性改写旧 outline 形态无需迁移。SQLite 落地后再发生 schema 变更时，必须重新评估迁移策略。

## 技术方案

### Contract 与数量边界

OutlineContent 存储 arcs：每份 3–8 条弧线，每条 2–8 个剧情点。标题最长 30 字符，文本 trim、非空且有上限，所有对象 strict。OutlineDraft 允许新增项暂缺 ID，OutlineContent 要求 ID 完整；数量边界只由 outlineArcCount 与 outlineSegmentCount 定义。

### Pipeline 与关卡

下列三步装配和状态表保留 #4 交付时的基线；当前四步末态、nextStepId 与 Setting 关卡以 [Wiki 013](./013-setting-generation-review.md#服务端读模型与页面衔接) 为准，旧三步定义仍在兼容测试中使用。

运行时按 caption（自动通过）→ creative（消费 caption，人工选定）→ outline（消费 creative，人工审阅）装配。creative 消费守卫要求最新版本 approved 且恰好一个方向；选定后 Web 再调用 advance，生成 outline 并停在 awaiting-outline-review。

workflowOf 必须按 pendingGate.kind 显式分派：

| Pipeline 状态 | 关卡 | 对外 workflowState | allowedActions |
|---|---|---|---|
| ready | — | ready-to-generate | generate |
| awaiting-approval | creative | awaiting-selection | save-draft / select / generate |
| awaiting-approval | outline | awaiting-outline-review | save-draft / approve |
| complete | 当前末端为 outline | outline-approved | 无 |
| blocked | 上游不满足 | ready-to-generate | 无 |

新增末端节点或关卡时必须同步修改 workflowOf；这里故意选择响亮失败，避免未知关卡被误标。

### 生成、ID 与保存

- createOutlineStep 读取 seed 与唯一选定的 creative，单次生成完整两层大纲。
- LLM 输出不含 ID；server 落库前注入稳定 arcId 与 segmentId，Web 永不生成或改写已有 ID。
- 生成时 ID 使用 workId-arc-N 与 workId-arc-N-seg-N 形式。
- 保存草稿调用 PUT /api/works/:id/artifacts/outline，携带 expectedHeadVersion，结果始终 pending。
- normalizeOutlineIds 保留已有 ID，并为缺 ID 项取请求中现存同前缀最大序号加一。当前实现对每项都读取同一份未规整数组：一次保存多个新弧线，或同一弧线内多个新剧情点，会生成重复 ID；schema 也未校验 ID 唯一性。这是已知限制，不能把 max+1 描述为批量防碰撞保证。
- 通过大纲复用 POST /api/works/:id/approve，kind 为 outline；保存与通过是两个独立动作。

### Web 编辑模型

OutlineReview 采用纯状态映射加 React 视图：

- 弧线和剧情点均可增、删、改与上下移动，不使用拖拽。
- 本地 dirty 状态在保存成功后清除；409 version-conflict 时保留未保存编辑。
- 保存和通过互斥禁用；若通过前仍有修改，先保存再通过。
- 弧线编辑区提示“弧线变化可能要求同步调整其剧情点”，但当前不做级联校验或重生成。
- 通过后保持同版式只读，顶部保留选定创意方向摘要。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| 契约、数量与 workflowState | [outline.ts](../../packages/contracts/src/outline.ts)、[artifacts.ts](../../packages/contracts/src/artifacts.ts) |
| LLM I/O、生成与 prompt | [outline-io.ts](../../apps/server/src/steps/outline-io.ts)、[outline-step.ts](../../apps/server/src/steps/outline-step.ts)、[outline skill](../../apps/server/src/steps/skills/outline/SKILL.md) |
| 装配、保存、通过与 ID 规整 | [start.ts](../../apps/server/src/start.ts)、[works.ts](../../apps/server/src/routes/works.ts) |
| 编辑状态与页面 | [outline-review.ts](../../apps/web/src/outline-review.ts)、[OutlineReview.tsx](../../apps/web/src/pages/OutlineReview.tsx) |

## 测试与验证

自动化覆盖 strict/数量边界、三步推进与两个人工关卡、消费守卫、生成 ID、完整 HTTP 链路、Web 编辑以及 stale 409 保留 dirty。现有测试只覆盖单个缺 ID 项，没有覆盖批量新增的 ID 唯一性。

演示模式已跑通完整 HTTP 链路。真实模型排查还确认：AI SDK v7 的错误名可能是 AI_NoObjectGeneratedError，而不是无前缀名称；错误映射必须按包含 NoObjectGeneratedError 处理。LongCat 2.0 也已生成 schema-valid 大纲，当前运行时证据见 [wiki 016](./016-model-runtime-provider-config.md)。

## 边界与非目标

| 情况 | 当前处理 |
|---|---|
| creative 最新版本未 approved 或方向数不为 1 | pipeline blocked；不会运行 outline |
| 草稿基于旧 head | 409 version-conflict，Web 保留 dirty |
| 同一作品并发 advance | 409 advance-in-progress |
| LLM 非法输出、超时、不可用 | advance 返回 HTTP 200 + kind=failed 及类型化 code；再次 advance 只重跑失败步骤 |
| outline 已通过 | UI 只读；裸 API 仍能追加版本，但当前没有产品入口 |

明确不做：

- 分章大纲与章数配置。
- 拖拽调序和张力曲线可视化。
- 弧线变化后的级联校验或重生成。
- 回溯重选 creative。
- 人物或设定的结构化引用。
- outline fan-out 或多方案生成。

## 上下文演进

### 2026-09-05 — 大纲后衔接完整设定

- **触发证据**：#13 生产定义追加 Setting，OutlineReview 的通过成功回调连接下一次 advance。
- **原假设**：大纲通过是当前生产链终点。
- **决定**：保留 Outline 保存／通过协议；新读模型由 nextStepId 表达下一步，旧三步末态留作兼容。
- **影响**：当前流程与上游再次编辑的静态 Setting 限制见 Wiki 013，不把 #4 历史状态表当成完整现行工作流。
- **上下文处理**：preserve 两层大纲的原始理由与历史验证；replace 当前衔接说明，下一跳为 Wiki 013。

### 2026-08-28 — 从分章摘要改为两层大纲

- **触发证据**：约 150 行章节摘要无法有效审阅，且会把章纲职责提前塞进大纲。
- **原假设**：outline 等于 chapters 数组，每章一句话。
- **决定**：改为 3–8 条弧线，每条含 2–8 个剧情点；章节规划后移。
- **影响**：CONTEXT、schema、contract、issue AC、pipeline 和 Web 审阅界面同步改变。
- **上下文处理**：replace；旧 chapters 形态不再用于当前实现。

### 2026-08-28 — 落地后收紧关卡与 ID

- **触发证据**：隐式 workflow 分派会让后续节点被误标；删除后按位置补 ID 会复用旧标识。
- **原假设**：未知关卡可走默认分支，新项可按当前位置编号。
- **决定**：workflowOf 按 gate kind 穷举；已有 ID 保留，新项按现存最大序号加一。
- **影响**：新增关卡必须显式登记，编辑调序不改已有 ID；批量新增重复 ID 仍待修复并补唯一性校验。
- **上下文处理**：preserve；保留设计意图，同时明确当前实现缺口。

### 2026-08-29 — 运行时事实移交 wiki 016

- **触发证据**：LongCat 2.0 完成真实大纲验证，provider 配置与 timeout 已形成独立运行时模块。
- **原假设**：本票可以同时保存 outline 设计和当次 DeepSeek 探针结论。
- **决定**：本文只拥有大纲产物与关卡 HOW；运行时配置和完整 smoke 归 wiki 016。
- **影响**：历史模型耗时不能作为当前 provider 或 timeout 配置依据。
- **上下文处理**：compact；保留验证结论，替换运行时操作说明。

## 交接结论

后续 Agent 应把弧线与剧情点视为当前大纲契约，把保存与通过视为两个命令，并保持 server 生成稳定 ID。若新增 pipeline 节点，除了 definition，还必须更新 workflowState 映射、allowedActions、CLI smoke 与相应关卡测试；模型和 timeout 变更只更新 [wiki 016](./016-model-runtime-provider-config.md)。
