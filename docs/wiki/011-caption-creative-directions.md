---
wiki_id: "011"
ticket: 11
ticket_state: done
context_state: mixed
summary: "预处理拆成 caption 理解层与 creative 方向层，并以单方向选定关卡连接后续大纲。"
topics: ["caption", "creative-directions", "pipeline-consumes", "workflow-state", "creative-review"]
code_paths: ["packages/contracts/src/caption.ts", "packages/contracts/src/creative.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/pipeline/consume-guards.ts", "apps/server/src/steps/caption-io.ts", "apps/server/src/steps/caption-step.ts", "apps/server/src/steps/creative-io.ts", "apps/server/src/steps/creative-step.ts", "apps/server/src/routes/works.ts", "apps/web/src/creative-compare.ts", "apps/web/src/pages/CreativePoster.tsx"]
symbols: ["captionContentSchema", "creativeContentSchema", "DEFAULT_DIRECTION_COUNT", "Pipeline.advance", "consumeGuards", "CompareState", "advance-in-progress", "direction-not-selected", "version-conflict"]
inherits: ["010"]
changed_by: ["004", "016"]
read_when: ["change-caption-schema", "change-creative-schema", "debug-pipeline-consumes", "change-direction-selection", "debug-creative-retry"]
last_context_reviewed: "2026-09-04"
---

# 011 — 预处理重构：Caption + Creative 方向包 + 比较界面

## Agent Context

- **读取时机**：修改 caption/creative 产物、方向数量、上游消费、链式 advance、方向保存/选定或创意比较界面时读取。
- **原始目的**：把“理解素材”和“提出创作方向”拆开，消除旧 preprocess 四个平行数组之间的隐式对应。
- **实际落地**：caption 自动通过，creative 单次生成 1–3 个方向包并停在人工选择关卡；interview 机制已删除。
- **当前价值**：caption/creative 契约、consumes 语义、失败重入、方向稳定 ID 和比较关卡仍是当前 HOW。
- **后续变化**：[wiki 004](./004-outline-arcs-segments.md) 扩展了 workflowState 并移除 selected；[wiki 016](./016-model-runtime-provider-config.md) 接管 provider、凭据、结构化输出降级与 timeout。
- **代码入口**：[caption contract](../../packages/contracts/src/caption.ts)、[creative contract](../../packages/contracts/src/creative.ts)、[pipeline](../../apps/server/src/pipeline/pipeline.ts)、[creative routes](../../apps/server/src/routes/works.ts)、[compare state](../../apps/web/src/creative-compare.ts)。

## 设计目的

预处理必须先留下“系统如何理解素材”的可诊断产物，再生成彼此完整、自洽的方向候选。否则方向错误时无法区分是素材理解错误，还是创意推导错误。

| 层 | 产物 | 职责 | 人工关卡 |
|---|---|---|---|
| 理解层 | caption / 提炼稿 | 判断输入阶段，说明素材、元素与缺口 | 无，落库即 approved |
| 方向层 | creative / 创意稿 | 生成完整方向包供横向比较 | 有，必须显式选定一个方向 |

CreativePack 把 title、hook、tags、synopsis、characters、setting、payoffs 和 outline hints 绑定在同一个 directionId 下。标题和数组下标都不是标识，方向增删或同名时仍以 directionId 为准。

关键人类决策：方向由一次 generateObject 生成，避免小规模候选 fan-out 后难以整体校验；directionCount 默认 2、范围 1–3，即使只有一个也要显式选定。seed 始终独立传入，consumes 只表达产物依赖；upstream 保持 JsonValue，具体类型由 Step inputSchema 恢复。素材预算只在 contracts/limits.ts 定义，并在共享 prompt 入口截断。

## 起始上下文

本票交付 issue [#11](https://github.com/12bitsD/agent4novel/issues/11)，继承 [wiki 010](./010-preprocess-realstep-interview.md) 的 Step 契约、文件化 prompt 和 KnownError，但替换其产品形态。

旧 preprocess 没有独立理解产物，hooks、synopsis、setting、outline 又靠平行数组下标维持方向关系，inputStage 也只做分类。因此旧 schema、awaiting-interview、answer-interview 和问答 UI 均已删除。由于当时存储仅存活于进程内，无需迁移旧数据；SQLite 引入后不能沿用这一假设。

## 技术方案

### Contract

captionContentSchema 包含 inputStage、summary、elements 与 gaps。creativeContentSchema 包含 1–3 个 CreativePack；每个方向有 server 注入的 directionId，字段 strict，字符串与数组有界，tags 去重。character、setting、outline hint 即使形状相近也分开导出，避免未来演进互相耦合。

AgentConfig.directionCount 是唯一方向数量配置；RealStep 和 FakeStep 都严格断言 directions.length 与请求数量一致。

### Pipeline、消费与重入

本票贡献 caption 自动通过 → creative 消费 caption 并停在人工选择关卡；[wiki 004](./004-outline-arcs-segments.md) 又追加 outline。Pipeline 的稳定语义是：

- consumes 只能引用 definition 中更早出现的 outputKind；构造时校验 stepId/outputKind 唯一、禁止自依赖和后向依赖。
- 下游只读取上游最新版本，且该版本必须 approved。
- consumeGuards 在泛型 pipeline 外恢复领域约束；creative 被 outline 消费时必须恰好有一个方向。
- advance 连续运行无需人工批准的步骤，直到下一个 gate；循环上限是 definition 长度。
- 同一作品用进程内互斥锁保护 advance，finally 必须释放；并发请求返回 advance-in-progress。
- Step 失败不落 artifact。再次手动 advance 从失败 Step 继续，已成功且已落库的 caption 不重跑；系统不自动 retry。

AdvanceOutcome 可穷举为 advanced、awaiting-approval、complete 或 failed。failed 携带 stepId、code、retryable 和可选 attemptId；HTTP 200 仍可能承载 kind=failed，调用方必须检查 JSON。

### 保存与选定

两个命令刻意分离：

| 动作 | API | 结果 |
|---|---|---|
| 保存全部方向草稿 | PUT /api/works/:id/artifacts/creative | 追加新版本，始终 pending |
| 选定当前方向 | POST /api/works/:id/artifacts/creative/select | 只保留目标方向的新版本并 approved |

两者都携带 expectedHeadVersion。版本不一致返回 409 version-conflict；Web 保留本地 dirty edits。通用 approve 对 creative 明确关闭，防止绕过“恰好一个方向”的选择语义。

### 读模型与 Web

GET /api/works/:id 在 artifact 快照上同时返回 workflowState 与 allowedActions，Web 只渲染，不重建状态机。

本票最初引入 ready-to-generate、awaiting-selection 和 failed。generating 始终是 Web 本地瞬态；selected 是当时两步 definition 的临时终态，已被 [wiki 004](./004-outline-arcs-segments.md) 移除。当前完整状态以 [packages/contracts/src/artifacts.ts](../../packages/contracts/src/artifacts.ts) 为准。

CreativePoster 的关键行为：

- tab 使用 directionId 作为 key，以原生 button、role=tab 与 aria-selected 表达选择；当前没有方向键或 roving tabindex 焦点管理。
- 编辑保存在本地缓存；保存与选定期间互斥禁用。
- 选定前若存在 dirty edits，先保存再选定。
- 素材理解区折叠只读；方向内容以海报式布局并排比较。
- Entry 只创建作品并跳转 Workspace，避免在入口挂起等待多次 LLM 调用。

### LLM 边界

caption 与 creative 使用 generateObject 加本地 Zod 校验。错误统一为 llm-invalid-output、llm-timeout 或 llm-unavailable；prompt、素材与完整输出不写日志，只记录长度、hash 与诊断字段。

本文不再定义具体 provider、Base URL、credential、wire protocol 或 timeout 数字；这些当前事实只在 [wiki 016](./016-model-runtime-provider-config.md) 维护。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| 契约、方向数与素材预算 | [caption.ts](../../packages/contracts/src/caption.ts)、[creative.ts](../../packages/contracts/src/creative.ts)、[step.ts](../../packages/contracts/src/step.ts)、[limits.ts](../../packages/contracts/src/limits.ts) |
| Pipeline 与消费守卫 | [pipeline.ts](../../apps/server/src/pipeline/pipeline.ts)、[consume-guards.ts](../../apps/server/src/pipeline/consume-guards.ts) |
| 真实步骤与装配 | [caption-step.ts](../../apps/server/src/steps/caption-step.ts)、[creative-step.ts](../../apps/server/src/steps/creative-step.ts)、[start.ts](../../apps/server/src/start.ts) |
| 保存、选定与读模型 | [works.ts](../../apps/server/src/routes/works.ts) |
| 比较状态与页面 | [creative-compare.ts](../../apps/web/src/creative-compare.ts)、[CreativePoster.tsx](../../apps/web/src/pages/CreativePoster.tsx) |

## 测试与验证

自动化覆盖 contract 边界、链式 advance、最新 approved consumes、非法 definition、并发锁、方向数、保存/选定，以及 409 后保留 dirty；还锁定 caption 成功而 creative 失败时只重跑 creative。

演示模式已验证创建、链式生成、保存、选定、刷新与 stale 409。真实 LongCat 2.0 已验证 caption 与 creative 能生成 schema-valid 产物；具体 provider 适配、结构化输出降级和 smoke 证据见 [wiki 016](./016-model-runtime-provider-config.md)。

## 边界与非目标

| 情况 | 当前处理 |
|---|---|
| directions 数量不等于 directionCount | Step 输出非法，不落库 |
| creative 未选成单方向 | direction-not-selected / pipeline blocked |
| 并发 advance 或旧版本写入 | 409 advance-in-progress / version-conflict；本地编辑保留 |
| seed 超预算 | 共享 prompt 入口截断；Entry 只预提示 |

明确不做：

- 跨方向混搭字段。
- 图片输入与多模态 caption。
- 带补充想法的重新生成、渐进展示、分段提炼和版本回看 UI。
- directionCount 配置 UI。
- provider 动态选择与凭据管理。
- 持久化事务、lease 与 schema 迁移。

## 上下文演进

### 2026-08-27 — preprocess 被 caption + creative 替换

- **触发证据**：提炼与方向生成混在一次 normalize，且四个平行数组没有方向绑定。
- **原假设**：inputStage 加多实例数组足以表达预处理结果。
- **决定**：拆成自动通过的 caption 和待人工选定的 CreativePack 数组，并移除 interview。
- **影响**：artifact kinds、schema、pipeline、routes、Entry 和 Workspace 同步重写。
- **上下文处理**：replace；wiki 010 的 preprocess/interview 产品形态仅保留为历史背景。

### 2026-08-27 — 评审后收紧执行语义

- **触发证据**：单靠 approved 无法保证 creative 已选成一个方向，失败态和并发请求也缺少稳定边界。
- **原假设**：通用 approve、隐式步骤顺序和 console 日志足以支撑下游。
- **决定**：增加 consumeGuards、可穷举 outcome、per-work 锁、类型化错误、promptHash 和消费版本日志。
- **影响**：下游拿到的 creative 必为单方向；失败可手动重入且不会重跑成功步骤。
- **上下文处理**：preserve；这些规则仍是当前 pipeline 的基础。

### 2026-08-28 — workflowState 被 wiki 004 扩展

- **触发证据**：加入 outline 后，selected 不再是可达终态，awaiting-approval 也不能只解释成创意选择。
- **原假设**：两步 definition 完成后统一返回 selected。
- **决定**：按 pendingGate.kind 显式映射，并加入 awaiting-outline-review 与 outline-approved。
- **影响**：本文仍拥有 caption/creative 语义，但当前完整状态机必须连同 wiki 004 阅读。
- **上下文处理**：replace；旧 selected 列表不得复制到新代码或文档。

### 2026-08-29 — provider 事实被 wiki 016 接管

- **触发证据**：Caption 与 Creative 已在 LongCat 2.0 验证，多 provider ModelRuntime 成为统一配置面。
- **原假设**：本票中的 DeepSeek-only 适配与固定 timeout 可以继续代表当前运行时。
- **决定**：本文只保留步骤和 pipeline 的 provider-neutral 边界；运行时配置统一链接 wiki 016。
- **影响**：新增 provider 或修改 timeout 不应回写本文。
- **上下文处理**：compact；保留真实产物验证结论，不复制运行时细节和测试数字。

## 交接结论

后续 Agent 应把 caption 视为可诊断的理解层，把 creative 视为必须显式选定的完整方向包。修改这条链时，优先守住 directionId、最新 approved consumes、方向数严格校验、手动失败重入和 409 保留 dirty；状态机扩展看 [wiki 004](./004-outline-arcs-segments.md)，模型运行配置看 [wiki 016](./016-model-runtime-provider-config.md)。
