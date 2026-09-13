---
wiki_id: "011"
ticket: 11
ticket_state: done
context_state: mixed
summary: "caption 以素材理解为基础交付开发判断，creative 生成方向包；保存选定关卡、SP 采用依据与迭代方法。"
topics: ["caption", "creative-directions", "pipeline-consumes", "workflow-state", "creative-review", "prompt-iteration", "story-quality-evaluation", "thinking-ab"]
code_paths: ["packages/contracts/src/caption.ts", "packages/contracts/src/creative.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/pipeline/consume-guards.ts", "apps/server/src/steps/caption-io.ts", "apps/server/src/steps/caption-step.ts", "apps/server/src/steps/creative-io.ts", "apps/server/src/steps/creative-step.ts", "apps/server/src/routes/works.ts", "apps/web/src/creative-compare.ts", "apps/web/src/pages/CreativePoster.tsx"]
symbols: ["captionContentSchema", "creativeContentSchema", "DEFAULT_DIRECTION_COUNT", "Pipeline.advance", "consumeGuards", "CompareState", "advance-in-progress", "direction-not-selected", "version-conflict"]
inherits: ["010"]
changed_by: ["004", "016", "013"]
read_when: ["change-caption-schema", "change-creative-schema", "debug-pipeline-consumes", "change-direction-selection", "debug-creative-retry", "optimize-caption-sp", "review-sp-iteration", "evaluate-story-quality", "compare-thinking-mode"]
last_context_reviewed: "2026-09-13"
---

# 011 — 预处理重构：Caption + Creative 方向包 + 比较界面

## Agent Context

- **读取时机**：修改 caption/creative 产物、方向数量、上游消费、链式 advance、方向保存/选定或创意比较界面时读取；优化 SP、评阅故事效果或比较 think 时，读“Caption SP 迭代方法”。
- **原始目的**：把“理解素材”和“提出创作方向”拆开，消除旧 preprocess 四个平行数组之间的隐式对应。
- **实际落地**：caption 自动通过，creative 单次生成 1–3 个方向包并停在人工选择关卡；2026-09-13 已将 R10 A 原样接入 Caption SP，以素材理解为基础交付开发重心与剧情提案，形状及关卡未变。
- **当前价值**：caption/creative 契约、consumes 语义、失败重入、方向稳定 ID 和比较关卡仍是当前 HOW；SP 采用依据与后续迭代方法见本页“当前 Caption SP”及“Caption SP 迭代方法”。
- **后续变化**：[Wiki 004](./004-outline-arcs-segments.md) 扩展 workflowState 并移除 selected；[Wiki 016](./016-model-runtime-provider-config.md) 接管模型配置；[Wiki 013](./013-setting-generation-review.md) 为 consumes 生成增加提交时 head 条件与 Store 快照隔离，Creative select 因此改为回读 approved 响应，外部语义不变。
- **代码入口**：[caption contract](../../packages/contracts/src/caption.ts)、[creative contract](../../packages/contracts/src/creative.ts)、[pipeline](../../apps/server/src/pipeline/pipeline.ts)、[creative routes](../../apps/server/src/routes/works.ts)、[compare state](../../apps/web/src/creative-compare.ts)。
- **实验入口**：先读“Caption SP 迭代方法”，再读[经验摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)与上一轮逐 SP 反思；《旧日人》系列已收束，下一步节点隔离仍是未执行建议。

## 设计目的

预处理必须先留下“系统如何理解素材”的可诊断产物，再生成彼此完整、自洽的方向候选。否则方向错误时无法区分是素材理解错误，还是创意推导错误。下表保留本票初始职责划分；2026-09-13 按用户要求将 caption 扩展为开发判断，当前行为见“当前 Caption SP”。

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
- Workspace 在后续生成的等待、进行中和失败状态保留已通过的创意稿，只读展示；新的审核面板可用后才切换。仅没有可展示产物时回退 seed。该展示选择不改变服务器的工作流与动作权限。

### LLM 边界

caption 与 creative 使用 generateObject 加本地 Zod 校验。错误统一为 llm-invalid-output、llm-timeout 或 llm-unavailable；prompt、素材与完整输出不写日志，只记录长度、hash 与诊断字段。

本文不再定义具体 provider、Base URL、credential、wire protocol 或 timeout 数字；这些当前事实只在 [wiki 016](./016-model-runtime-provider-config.md) 维护。

### 当前 Caption SP

当前采用《旧日人》实验第十轮 A：[生产文件](../../apps/server/src/steps/skills/caption/SKILL.md)与本地归档的 R10 A 受测 SP（版本核对见[采用记录](../experiments/caption-adoption-2026-09-13/plan.md#选择与范围)）字节一致，SHA256 为 `dcbe0addf9cf394ab9706f4f7da4967592e872f8f9c40053c1181cc7dfe91fc5`。系统提示全文直接从文件加载并缓存；不额外拼接旧版“只理解、不创作”的限制或未经测试的新反馈。

选择依据是用户要求的故事开发目标，以及 R10 两位评阅在 caption、creative 两阶段均首选 A。它选择一个重心，主要篇幅交付具体剧情及后续影响，允许按人物处境改写。它尚未证明稳定或跨作品优胜；原样采用便于追溯，已知记忆前提等样本问题继续作为后续实验依据。[评估与接入记录](../experiments/caption-adoption-2026-09-13/plan.md)

四字段 schema 和自动通过保持不变。SP 的 gaps 0–1 项、elements 3–5 段是生成要求，不是收紧存储 schema；【原有／推测／建议】也不是代码已验证的语义保证。Caption 的 user prompt 仍为原稿加“请输出提炼稿”；creative 独立收到原稿及 caption，其 SP 与受测固定版一致。

`loadSkill` 原样读取文件，不解析 frontmatter；此版本保留受测全文，不添加会进入 system 的包装。已运行 server 使用进程内缓存，新进程才读取替换后的文件。单节点自定义 SP 用法见 [Wiki 014](./014-agent-cli-telemetry.md)，生成参数默认与覆盖见 [Wiki 016](./016-model-runtime-provider-config.md)。

### Caption SP 迭代方法

先明确要改善的阅读效果，再选择能回答问题的实验。本文维护执行方法和设计理由；每轮 SP、配置、原始输出及裁决保存在 `docs/experiments/`，研究证据留在 `docs/research/`。此次方法沉淀没有新增模型调用。

#### 目标与实验类型

Caption 实验优先看“读者愿意继续看、作者能继续写”。把失败先定位为选点、剧情开发、下游承接或格式问题，避免把所有失败都归为提炼错重点。Creative 是方向包，评阅概要中关键选择与结果的连接，不要求完整小说的逐场正文。

沿用用户已明确的创作边界：允许重排、改写结局、新规则、必要的伤害或牺牲，也允许合作与重新信任；不以忠实复述、温和、惨烈或宏大为默认目标。检验承载阅读期待的关键前提，不要求解释完全部世界机制。

已有用户偏好和素材范围直接复用。尚不明确的审美分歧，由执行 Agent 先准备 2—3 个现有短样例供用户校准，记录想续读的版本及具体原因。《旧日人》是当前指定案例；作品内结论不能外推其他素材。

| 实验类型 | 怎么执行 | 能支持的结论与限制 |
| --- | --- | --- |
| 候选筛选 | 沿用本系列的三份新版 + 同期上一轮推荐；每份说明不同改进假设 | 决定本次样本偏好与编辑基础；整份 SP 可含多处改动，但不能归因到某一句或某个组件 |
| 稳定性验证 | 冻结 SP 独立重复；协议先选 caption、固定 caption 后的 creative 或端到端流程 | 可先各做三次作小样本检查，报告全部结果；同次 creative 的多个方向不是独立复现，不宣称统计显著 |
| 组件归因 | 只改变一个概念因素，如示例、任务范围或备选交付；其他项固定并重复 | 区分组件作用；有交互问题时做交叉对照，不能把精简版胜出解释为越短越好 |
| 节点隔离 | 固定原稿，改变有无 caption 或 caption 内容，下游 SP 与参数固定 | 定位输入内容和承接问题；固定一个 caption 只能评价该样本，不能评价整个自动流程的稳定收益 |
| Think A/B | 同 SP、素材与采样配置重复配对，只改目标节点 thinking | 若测 caption，creative 两边保持同一关闭配置；分别比较质量、时间和 token，不混入换 SP 或调温度 |

#### 每轮执行与交付

执行 Agent 负责冻结、调用、评阅组织和回填，评阅者负责基于原文判断。下表按步骤先后设检查点；已有素材发送授权按会话范围继承，运行操作遵循 [drive skill](../../.claude/skills/agent4novel-drive/SKILL.md)，不要另造 CLI 参数或把临时实验能力写成已上线能力。

| 步骤与检查点 | 必须交付 | 判断方式 |
| --- | --- | --- |
| 1. 写新版之前 | 阅读当前经验账本与上一轮反思，列出目标、未解决问题、当前保留版、下一轮编辑基础 | 保留版与编辑基础可能不同；新版内第一名不自动升级。要决定替换保留版而它不同于同期上一版时，也纳入保留版对照 |
| 2. 调用之前 | `protocol.md`：实验类型、各 SP 假设、原文证据、保留的优点、改动、预期变化、反证条件、重复次数、顺序、评阅与停止规则 | 每份新版都能解释改什么、为什么、如何判断；写清本实验不能证明什么 |
| 3. 发请求之前 | 完整 SP、实际输入和下游输入快照、`manifest.json`：内容 hash、运行代码版本、provider/model、实际请求参数、方向数及截断情况 | 除待测因素外保持一致；记录 provider 实际支持/发送的字段，不把未支持的参数当已控制；不写入凭据 |
| 4. 运行与保存 | 通过 CLI 在隔离实验中执行，保留每次首次 raw、结构结果、耗时、usage、错误和调用标识 | 条件允许时并发独立候选，重复测试交错运行并记录并发条件；重试/修复另列，不覆盖失败。实验快照不等于允许把正文加入生产遥测 |
| 5. 全部产物锁定后 | 匿名评阅先读 creative 并保存判断，再读 caption；保留分歧和双方引文 | 先评续读兴趣，再核对支撑兴趣的关键前提；格式、成本另列。结构失败仍读原文，无法正常接下游就注明缺失，不伪造通过 |
| 6. 决定下一轮之前 | `comparison.md`：新版内首选、相对同期上一版的收益/退步、是否替换保留版及理由 | 明确判为有进步／局部进步但总体未定／无明确进步／退步；缺证据单列，不能用名次或总分代替进步证据 |
| 7. 再改 SP 之前 | `sp-reflection.md` 覆盖每份新版和基线；回填经验账本、停止计数和下一步 | 每份均写优点与不足；撤销被反证的经验，下一轮必须实际使用这些结论，不能只累加提醒 |

文学评阅重点是具体牵挂、素材独特条件的作用、人物回应与持续开发。可问“删掉前次互动，后续是否仍照常发生”“对方的决定是否改变主角计划”。这些是诊断问题，不能变成动作配额，也不能排斥气氛、揭示与含蓄情绪。匿名、换序与独立评阅能减少部分干扰，不能代替用户偏好校准。

#### 可直接复用的反思记录

同一份 `sp-reflection.md` 按 SP 重复以下记录，基线也填写。运行前写假设，运行后补实际证据；协议已冻结的预期不事后改成符合结果的说法。

```text
SP / 角色：新版、同期上一版或当前保留版
问题证据：原文位置；影响哪项阅读期待；发生在哪个节点
改进假设：本次改动；希望保留的优点；预期变化与反证条件
实际收益：产物引文及作用，没有就写未观察到
失败或退步：产物引文；关键前提/下游/格式/成本分别说明
与上一版比较：收益、退步、进步判定；样本偏好与稳定性分开
归因边界：是否混改、重复是否充分、替代解释
下一步：保留/删除/改写什么；由谁在下一次调用前检验什么
经验回填：更新哪条经验；支持/不确定/反证
```

经验账本每条保存：`经验 ID | 当前认识 | 来源证据 | 证据状态 | 下次验证 | 执行状态`。证据状态区分“观察支持／待验假设／已被反证”，执行状态区分“未执行／已执行／延期及理由”。新证据出现时修订顶部摘要，同时保留历史变化；一份证据链接足够时不重复抄全文。研究建议也必须落实为实验或注明延期原因。

#### 保留版本与停止

每轮分开回答“哪份值得继续编辑”和“是否有证据替换当前保留版”。历史好样本可以辅助，但不能替代同期旧版；没有明确升级证据时保留旧版，仍可记录新版有价值的局部做法。

本系列按用户指定的连续三轮无较大进展停止。较大进展须有可指认的续读兴趣或持续剧情开发提升，且支撑它的关键条件成立；格式全绿、变长、孤立好场面不单独计入。出现较大进展归零，证据不足不计停滞。另起实验时写明是否沿用该规则及新的计数起点，不能直接继承历史 3/3。

停止时交付保留 SP、完整证据、残留问题与未验证边界；停止不代表通用最优、模型到顶或生产发布。R8–R10 已满足本次条件，推荐文件是 R10 A 的原样导出，公开的选择与停止结论见[实验摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)，完整报告和停止记录保留在本地归档。

#### 下一次优先诊断：输入是否帮助 Creative

此实验尚未执行。执行 Agent 先准备可比较的参考开发稿并完成用户偏好校准，再冻结三种输入：A 原稿直接生成；B 原稿 + 当前固定自动 caption；C 原稿 + 用户认可的固定参考 caption。参考稿不是唯一答案或质量上限，B/C 尽量保持相近篇幅。

保持同一 creative SP、模型、采样、方向数和输出上限，各做三次、交错运行，共九次作初步诊断。先核实 CLI 能表达真实的“无 caption”实验条件；不能用伪造空生产 caption 冒充。全部结果保存后再比较：

| 观察 | 可以采取的下一步 |
| --- | --- |
| C 多次优于 B 且优于 A | 优先研究如何生成有帮助的 caption；尚未区分选点、前提修复与口味匹配的贡献 |
| C 优于 B，但未优于 A | 尚未建立加入 caption 的增量价值，不宣布流程升级 |
| A 不弱于 B | 当前自动样本未建立收益，不能外推整个自动流程 |
| A 也不弱于 C | 检查参考稿、交接要求及下游能力，不能直接判定 creative 是唯一根因或删除节点 |
| 差异不稳定 | 先补重复，暂不选新冠军 |

据结果再选一项：固定 caption、只改 creative 的承接要求；或固定一份有亮点的产物，给出具体局部编辑反馈，检查修复是否保住吸引力。R10 A 的“已接收子秋人生，却以名单遗漏解释独缺记忆”可作前提修复例子，不把“再精彩一点”当充分反馈。[复盘摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)

Think 暂保留关闭。R9 只有一次配对，开启后 caption 用时增加 29.2%，有局部关系收益而未证明整体稳定改善；重复模式测试仍未执行，不能外推其他节点或宣称采样参数已最优。[配对结果摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)

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

SP 迭代的公开结论见[实验与复盘摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)；真实结果、首次失败和完整原文保留在本地实验归档，不随公开仓库发布。2026-09-13 的 wiki 方法维护仅检查受影响页面的 frontmatter、固定章节、索引、相对链接及历史内容保留；没有重跑模型、应用测试或重新完成 #11 的发布审核。

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

### 2026-09-13 — 采用 R10 A 为当前 Caption SP

- **触发证据**：用户要求评估并采用现有最适合的 Caption SP；R10 A 在两位匿名 creative 与 caption 评阅中均首选，当前旧 SP 仍要求“只理解、不创作”，与已明确的故事开发目标不符。
- **原假设**：原票将 caption 限定为素材理解，创意全部留到下一步；此前实验推荐仍未接入代码。
- **决定**：将 R10 A 全文原样替换生产 Caption SP，保留素材理解与来源区分，并允许具体开发建议；不拼接未经重测的修订，不改 creative SP 和产物 schema。
- **影响**：后续新进程的 Caption 生成使用新指令；原有关卡、上游消费和 ID 语义不变。此次接回单节点实验 CLI 与生成参数控制，HOW 分别见 Wiki 014/016。选用不代表稳定性、跨作品效果或完整链路质量已获证明。
- **上下文处理**：preserve 初始理解层意图、此前方法沉淀、失败实验和原始选择记录；replace 当前职责、SP 状态与领域描述。证据留在[接入记录](../experiments/caption-adoption-2026-09-13/plan.md)，不回写历史“未上线”快照。

### 2026-09-13 — 将 Caption SP 实验沉淀为可执行迭代方法

- **触发证据**：《旧日人》多轮对照出现具体关系场面的收益，但没有稳定改善后续开发；同一旧版重复生成会换重心。用户要求逐份反思、比较上一版、验证 think，并在复盘后明确要求把方法落入 wiki。[复盘摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)
- **原假设**：不断修改 caption SP、固定 creative 后比较样本，能够逐步找到更好的提炼方式；实际筛选尚未拆清抽样波动、组件贡献和下游承接。
- **决定**：在本页维护迭代方法，区分候选筛选、重复验证、组件归因与节点隔离；每份 SP 都保留正反证据，经验同时记录证据状态与执行状态。具体参数、原文和每轮裁决仍在实验目录。
- **影响**：新增下一位 Agent 可直接使用的步骤、记录模板与判定边界；当前《旧日人》系列已按连续三轮停滞收束，节点隔离和重复 think 尚未执行。此次仅为知识维护，没有替换生产 SP、改变节点契约或重新交付 #11。
- **上下文处理**：preserve 原始理解层/方向层意图、已有 UI 修复和历史事件；compact 实验经验为本页方法并链接原始证据；replace 顶部路由和交接摘要，使后续 SP 优化能找到正确入口。

### 2026-09-09 — 后续生成期间保留创意稿面板（本地修复）

- **触发证据**：用户在真实模型生成设定时看到页面回退 seed；Workspace 原先仅在 awaiting-selection 展示 CreativePoster。
- **原假设**：离开创意选择关卡后可隐藏创意面板，但长耗时生成使页面丢失可阅读的上下文。
- **决定**：后续 ready-to-generate/failed 且没有新审核面板时展示 approved 创意稿，生成中及非选定关卡只读。按产物 ID/version 重建面板，避免保留选定前的其他方向。
- **影响**：新增 Workspace.generation.test.tsx 覆盖大纲/设定等待、请求中、失败和新产物回读切换，以及选第二方向后自动续跑、只保留选定方向。真实页面已观察到“正在生成设定”与创意稿同时显示。完整 test/typecheck/build 通过，追加用例后定向 3 tests 与 web typecheck 通过；构建保留既有大 chunk 警告。独立 Standards/Spec 未发现阻塞问题；成功 advance 自动刷新不是新增用例的验证范围。此记录为本地修复，不代表重新完成或发布 #11。
- **上下文处理**：preserve 原有人工选定和服务器读模型边界；补充生成间隙的展示行为。

### 2026-09-05 — 上游快照与提交条件补强

- **触发证据**：#13 生成等待期间上游可改变，旧 Store 又暴露可变引用。
- **原假设**：await 前的 approved 检查与返回对象别名足以保持生成和选定语义。
- **决定**：Store 返回隔离快照；Pipeline 追加输出时再次检查 consumes 的 head，Creative select 回读已通过产物。
- **影响**：正常 caption／creative 行为不变；过时生成输出不落库，竞态失败恢复规则见 Wiki 013。
- **上下文处理**：preserve 本票方向设计与失败经验；replace 一致性实现边界，下一跳为 Wiki 013。

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

后续 Agent 应把 caption 视为可诊断的素材理解与开发判断，把 creative 视为必须显式选定的完整方向包。修改这条链时，优先守住 directionId、最新 approved consumes、方向数严格校验、手动失败重入和 409 保留 dirty；状态机扩展看 [wiki 004](./004-outline-arcs-segments.md)，模型运行配置看 [wiki 016](./016-model-runtime-provider-config.md)。

进行 SP 优化时先读本页“Caption SP 迭代方法”、[当前经验摘要](../experiments/caption-adoption-2026-09-13/plan.md#历史实验记录)和上一轮反思，再选择实验类型与冻结输入。R10 A 已接入代码，证据范围仍限当前《旧日人》实验；下一步优先验证固定 caption 对 creative 的增量作用，不能把未执行建议当结果，也不能因接入代码自动重启已结束系列。
