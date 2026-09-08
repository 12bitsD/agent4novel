---
wiki_id: "005"
ticket: 5
ticket_state: active
context_state: current
summary: "第一章章纲已接入 Web/CLI：编辑、整份再生、同版本通过、安全请求诊断；交付证据在本页。"
topics: ["beat", "chapter-planning", "human-review", "conditional-write", "agent-observability"]
code_paths: ["packages/contracts/src/beat.ts", "packages/contracts/src/beat-submission.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/store/in-memory-store.ts", "apps/server/src/routes/works.ts", "apps/server/src/steps/llm-call.ts", "apps/web/src/pages/Workspace.tsx", "apps/cli/src/commands.ts"]
symbols: ["BeatContent", "BeatEditDraft", "BeatCommandObservation", "regenerateBeat", "matchesBeatSubmission", "writeOutcome", "request-rejected", "beat-approved"]
inherits: ["004", "013", "014"]
changed_by: []
read_when: ["implement-beat", "change-beat-schema", "review-beat-plan", "debug-beat-submission", "design-agent-observability"]
last_context_reviewed: "2026-09-08"
---

# 005 — 第一章章纲生成、编辑、重新生成与通过

## Agent Context

- **读取时机**：规划／实现／评审 #5，检查按章寻址、章纲失败恢复或 Agent 调用诊断时。
- **原始目的**：生成当前第一章的完整写作计划，由作者编辑或整份再生，最终通过后再供正文使用；WHAT/AC 以 [issue #5](https://github.com/12bitsD/agent4novel/issues/5) 为准。
- **实际落地**：已在 `codex/issue-5-beat-review` 接通生产第五步、真实/fake Beat、Web 编辑与再生、同版本通过、UUID 身份及 CLI 文件命令。当前终点 `beat-approved`，无正文或第二章；实现候选正在交付收口，门禁和独立 review 以本页证据为准。
- **当前价值**：本页是已批准方案的现行工程 HOW；先读“技术方案”对应节、“测试与验证”中的 S1–S6。形状／协议唯一入口为 [schema](../schema.md#beat5-当前契约)，复审证据见 [评审记录](../plans/005-beat-technical-review.md)。
- **后续变化**：正文归 #22，比较归 #20，章节重生归 #21；已确认排期 #5 → #22 → #19 → #9 → #6，不把顺序视为新增硬依赖。
- **代码入口**：现有 [Pipeline](../../apps/server/src/pipeline/pipeline.ts)、[WorkStore](../../apps/server/src/store/work-store.ts)、[路由](../../apps/server/src/routes/works.ts)；完整落点见下表，内容／命令协议均已有运行时 schema。

## 设计目的

本票只交付第一章章纲至作者通过，不把正文写作并入同一步。

### 读者确认

首要读者是下一位实现 Agent，其次是作者与 reviewer：应能判断哪些决定已固定、到哪些边界开发，以及需要哪些证据才能交付。

### 问题定义

在完整已通过的大纲与设定上，形成可人工编辑、可整份重新生成、失败不丢修改的第一章章纲，并只消费作者实际通过的版本。

### 核心结论（≤3条）

1. 内容采用中等结构化的四部分，不强制场景／冲突公式；依据为作者访谈及 [研究](../research/chapter-plan-design-methods.md)。
2. 生成追加 pending，人工通过同版本原子定稿；页内草稿不单独落库，沿用 [Wiki 013](./013-setting-generation-review.md) 的冻结提交与条件写入。
3. Agent 必须分辨目标、业务提交、模型尝试与恢复动作；五视角评审已 PASS，具体证据不替代代码门禁。

本节是实现不得悄悄改变的边界；具体字段名、技术上限和恢复协议在后文作为建议提出。

| 主题 | 已确认规则 |
|---|---|
| 生成粒度 | 只生成当前第一章，但一次完整生成本章章纲；不批量规划后续章节 |
| 上游与取材 | 使用完整、已通过的大纲和设定；第一章默认围绕第一条弧线的第一个剧情点展开，不要求写完该剧情点，不把后期情节提前塞入本章 |
| 内容层次 | 章标题、本章目标、写作安排、章末落点与承接；写作安排是有序标题／说明卡片 |
| 卡片自由度 | 可表达行动、对话、内心反应和过渡；不要求一张卡等于一个场景，不强制每卡冲突／转折，不设固定张数 |
| 计划与正文 | 写清发生什么、为什么、后果及衔接；不是提前代写正文。可记关键台词意图，不要求成段小说或完整对话 |
| 最小完整性 | 章标题、目标、结尾非空；至少一张卡；存在的卡片标题、说明均非空。编辑过程中可以暂时不满足，最终通过时完整校验 |
| 人工修改 | 可编辑四部分，对卡片增删、重排；不另设“保存修改”。点击“通过”提交当前完整内容 |
| 临时草稿 | 仅在当前页面内存；失败保留修改，刷新／确认离开后放弃。重新打开读取服务端现有产物，不自动重新生成 |
| 整份重新生成 | 使用当前页内容，包含尚未通过的人工修改；修改意见可空。成功结果仍 pending，不做单卡 AI 改写 |
| 通过后 | 只读；不得修改或重新生成。正文后返回章纲属于“章节重生”，本期不设计 |
| 存储范围 | 使用现有 WorkStore，接受服务重启丢失测试作品；跨重启持久化归 #9 |

#5 票面的“尚待方案收口”仍是旧阶段说明；上述访谈与技术方案已完成。方案收录阶段未作远端写入；实现阶段已 claim，issue 的正式方案 backlink 与阶段说明待文档发布时同步，不重新讨论已确认决定。

非目标保持独立：正文 [#22](https://github.com/12bitsD/agent4novel/issues/22)、续写 [#6](https://github.com/12bitsD/agent4novel/issues/6)、新旧比较 [#20](https://github.com/12bitsD/agent4novel/issues/20)、章节重生 [#21](https://github.com/12bitsD/agent4novel/issues/21)。不预建回流接口、语义冲突拦截、单卡 AI 操作或通用版本管理 UI。

## 起始上下文

存储一致性与人工定稿已有基础，缺口主要在按章调度和重新生成命令；不需要重写编排层。

| 当前事实 | #5 的处理建议 | 依据 |
|---|---|---|
| Artifact 已区分作品级与章节级产物；getWork 只返回每个地址的最新版 | 继续使用 `(workId, kind='beat', chapter=1)`；章纲内容不重复存章号 | [artifacts](../../packages/contracts/src/artifacts.ts)、[schema](../schema.md) |
| Store 已支持带 chapter 的追加、条件写入和同版本定稿 | 复用 append/finalize，不增加数据库表，也不让路由拼“先保存再通过” | [Store 实现](../../apps/server/src/store/in-memory-store.ts) |
| Pipeline 查找 output/consumes 时仍使用无 chapter 地址 | 补齐输出、依赖、关卡和条件写入的章地址；不能只注册 Beat Step | [Pipeline](../../apps/server/src/pipeline/pipeline.ts) |
| Setting 已有完整提交、稳定 ID 和回读对账 | 继承机制，增加 Beat 专用模块；不把随机再生套成确定性提交对账 | [Wiki 013](./013-setting-generation-review.md#提交结果确认) |
| WorkView 目前只深入校验 Setting 内容 | 增加 Beat 校验及章纲状态；不借机治理全部六种产物 | [public-api](../../packages/contracts/src/public-api.ts)、[#19](https://github.com/12bitsD/agent4novel/issues/19) |
| Outline 目前允许重新保存为 pending | 维持既有兼容性，当前上游关卡不满足时阻止 Beat 操作；不承诺自动更新已有下游 | [works routes](../../apps/server/src/routes/works.ts)、[Wiki 013](./013-setting-generation-review.md#服务端读模型与页面衔接) |

架构仍服从 [ADR 0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md) 的薄 TypeScript workflow 和 [ADR 0002](../adr/0002-storage-sqlite-skills-as-files.md) 的长期存储方向。SQLite 是后续落地项，不把 ADR 的目标误写为当前实现。

2026-09-08 回读 #5：OPEN、ready-for-agent、Project Backlog、无 assignee；原生 blocked_by 为 #4/#13，均 CLOSED。工作区为 `main@70b43968de24ecf21e596bff35988feff62b73a9`；本轮只做知识收录，没有 claim、分支切换、业务代码或远端写入。开工／交付模式及授权仍按完成清单 C1.2 另行锁定。

## 技术方案

以下是复审通过、正在实现的工程设计；实际覆盖见“测试与验证”，不能用设计命令宣称当前生产应用已完整支持 Beat。

技术小节保留已审 R1 的编号；内容字段及第 6.1 节协议已按知识归属移入 schema，其余实施约束在本页继续维护。

### 3. 内容契约与技术预算

建议使用 `title / goal / writingPlan / ending` 四个顶层字段，统一维护于拟新增的 `packages/contracts/src/beat.ts`。这是内容 JSON 的 schema，不是创建四张 SQL 表。

四种内容边界、字段限制、ID 与规范化只有一个现行设计入口：[schema 的 Beat 节](../schema.md#beat5-当前契约)。生成追加 pending、人工同版本定稿；跨再生不推断同卡身份。这继承现有 append/finalize 的条件写入能力，不需要新 SQL 表。

#### 3.4 技术预算与安全渲染

内容／HTTP 上限见 schema；完整上下文、模型输出和安全渲染按以下工程约束实施。

数值沿用已评审初值，并以本轮合成实测校准，参考了 Setting 已有保护方式；不是对一章文学篇幅的要求。模型输出初始预算建议沿用 `callLlm` 的 8,000 tokens 默认量级，按真实样例调整，不能把截断或超限输出作为半份产物保存。[现有调用器](../../apps/server/src/steps/llm-call.ts)

合并后的完整 prompt 也须检查技术预算，不能只看 HTTP body。先采用票内 `beatLimits.maxPromptChars` 常量，初值建议 400,000 个 JavaScript 字符单位，计入 system、完整 outline/setting、当前章纲和意见；超限在模型调用前返回 `input-budget-exceeded`、`writeOutcome:'not-committed'` 及安全的分项长度／limit。本票不新增环境变量或模型配置界面。这个上限用于限制资源，不声称等价于任意模型的 token 窗口；模型自身上下文拒绝映射为安全类别 `context-limit`，不静默裁剪上游，提示缩减可编辑输入或检查模型配置。初值保持不变；近上限合成实测见“实际链路与质量样例”，不据单次成功推导 provider 保证。

建议复用有限 Markdown：段落、换行、粗体／斜体、引用、列表；禁用链接、图片、HTML、嵌入等执行或联网能力，其他语法安全降级。将 [setting-markdown](../../apps/web/src/setting-markdown.tsx) 小范围抽为共用格式渲染器，参数化预算；不抽通用富文本编辑框架，也不把 Beat 的内容上限绑定到 Setting 的常量。

### 4. 流程与模块：明确章地址，不提前实现章节循环

建议将第一章写成生产定义的显式地址，并让通用调度认识地址；第二章的选择、进度游标和循环由 #6 决定。

```text
已通过 outline + setting
          │ 首次生成：advance
          ▼
  beat / chapter=1 / pending
          │
          ├─ 页内修改 ───────────────┐
          ├─ 整份再生 → 新版 pending ┤
          │                         │
          └──── 当前完整内容通过 ◀───┘
                     ▼
           beat / chapter=1 / approved
                     ■ #5 生产终点；不调用 prose
```

#### 4.1 按地址解析输出、依赖和关卡

建议保留当前定义结构，增加最少的章信息，并集中一个地址解析函数，避免各处只按 kind 查第一条记录。

`PipelineDefinitionEntry` 增加 `chapter?: number`；`gateBefore/gateAfter` 使用已有 `GateRef`。本票仍可保留 `consumes: ArtifactKind[]`：通过 prior definition 找到对应 outputKind 的完整地址。定义当前已禁止重复 outputKind，所以对本票第一章及 fake 下游没有歧义，不扩展多章调度框架。

生产 Beat entry 为 `outputKind:'beat', chapter:1, consumes:['outline','setting'], gateAfter:{kind:'beat',chapter:1}`。启动校验需要拒绝作品级 kind 带章号、章节级 kind 缺章号／非法章号，以及 gateAfter 与输出地址不一致。

`getState`、`runEntry`、输入快照、append 条件、日志和 gate 查找统一使用完整地址。`PipelineInput` 增加可选 `chapter`，Beat 私有输入要求 `1`；既有作品级 Step 不凭空获得章号。公共 Artifact 形态允许正整数章号，但本票生产命令仅开放第一章，其他章返回 `unsupported-chapter`。

#### 4.2 输入与生成责任

Beat Step 只负责生成完整内容，不写 Store，也不能通过关卡。

首次生成的模型输入为完整已通过 outline、setting 和 `chapter=1`。重新生成另带当前页内容及修改意见；保留 Pipeline 既有 `seed` 输入兼容性，但本票 prompt 不默认重复堆入 caption、creative 和原始素材，避免把上游已淘汰方向重新引入。

生成提示明确：默认围绕首弧首剧情点，后续大纲用于把握全局；不要求一章完成该剧情点；输出计划而非正文。以上是提示与人工检查项，不增加判断“是否提前剧透”“冲突是否足够”的语义拦截器。

新增 Beat 私有输入／输出包装及生成 skill；首次生成与再生共享同一个内容生成器，以 `mode:'initial'|'regenerate'` 区分必要输入。此模式留在服务端私有 I/O，不把调度参数变成公共内容字段。fake 依同一共享输出 schema 提供完整样本，不能走宽松的占位 JsonValue。

#### 4.3 责任划分

命令负责业务检查，Store 负责最终原子写入；HTTP、Web 和 CLI 不各自实现一遍关卡规则。

| 模块 | 建议职责 |
|---|---|
| contracts / `beat.ts` | 四种内容边界、两个命令及响应、章地址与预算 |
| contracts / `beat-submission.ts` | 确定性通过结果匹配、根据已知事实推导恢复动作；不猜测随机再生归属 |
| `beat-content.ts` | ID 注入、已有 ID 归属检查、剔除模型不负责的字段 |
| Beat Step / `beat-io.ts` | 完整输入校验、生成、完整输出校验；不写库 |
| `beat-review.ts` | 准备通过候选，检查当前关卡并 finalize |
| Pipeline / 票内再生方法 | 共享生成锁、上游快照、调用 Step、条件 append；不承担页面草稿 |
| WorkStore | 地址与状态检查、隔离复制、一次条件写入；不理解章纲文学内容 |
| Web Beat review | 本地编辑、冻结请求、结果确认、冲突和离开保护 |
| CLI | 调用相同协议、校验响应、输出明确结果；不另调模型 |

建议在 Pipeline 增加窄的 `regenerateBeat` 入口，复用内部生成／快照帮助函数；不要做可任意重跑任何 Step 的公共接口。职责若需要拆文件，保持相同边界，不以文件数作为架构目标。

### 5. 写入一致性：生成追加，通过同版本定稿

所有写入都在最后一步再次检查前置条件，也就是“读取时的版本仍有效才写入”；只在 HTTP 开头检查不够。

#### 5.1 首次生成和整份再生

生成前后都要守住正确的作品、章号和上游关卡。

1. 取得该作品生成锁，读取隔离快照；确认所有较早关卡合法且已通过。再生还检查目标 head 的 ID、版本及 pending 状态，先拒绝陈旧请求再花费模型调用。
2. 冻结输入和各上游 head。首次目标条件为 `beat#1 不存在`；再生为原目标 `id/version/pending`。调用模型，整体校验，再注入服务端 ID。
3. 用同一次 `appendArtifact` 校验目标及操作开始时的 approved 上游 head，成功才发布完整 pending。任何失败不 append，不改变旧章纲；`finally` 释放锁。

内容输入只有 outline/setting，但关卡与提交条件应覆盖定义中所有较早产物的当前有效 head，防止模型运行期间更早关卡退回 pending。对上游的检查复用各自 consume guard，不能只检查字符串 `approved`。

当前共享 consumeGuards 实际只注册了 creative。本票明确补齐所需 caption/outline/setting/beat 的共享 schema 检查；已有 approved 输出也须被检查，不能只在“输出还不存在”时运行 guard。读模型和命令采用同一规则，污染内容按关卡未就绪拒绝，不让 Agent 看到可执行操作但服务端必定失败。

`advance` 与 `regenerateBeat` 共用现有 per-work 锁：同一作品并发生成直接 409，不排队、不重复调用模型；不同作品互不阻塞。锁是单进程机制，不承诺跨进程租约。人工通过可以与正在生成竞争，但最终只允许一次条件写入获胜：通过先成功则迟到再生失败，再生先成功则旧版本通过失败；客户端页面仍禁止同时发两个命令。

#### 5.2 一次通过

通过接收作者当前完整内容，将目标的内容和状态一次定稿，不先保存后批准。

检查顺序为作品／目标存在 → 目标 ID 与版本匹配 → pending → 当前关卡允许 → 内容与 ID 归属。准备完整候选后调用 `finalizeArtifact`，传入目标和操作开始时上游 head 条件；成功保持 Artifact 的 id、version、createdAt，状态改为 approved。

通用 `/approve`、`Pipeline.approve(kind='beat')` 和 `setStatus(kind='beat')` 必须像 Setting 一样关闭，返回 `beat-approval-required`，包括禁止退回 pending。Beat 公开写入口只有首次生成、专用再生和专用通过；不提供 PUT 草稿或通过后编辑入口。

Store 仍是内部接口，不把内容 schema 整套搬进 adapter。Beat 命令在写入边界完整验证候选，GET/成功响应和后续消费再验证共享 schema；测试直接污染 Store 的内容必须在消费守卫被挡住。

#### 5.3 跨重启身份隔离

作品和产物身份不跨 Store 生命周期复用，重启前的请求必须无法命中新作品。

将 `Work.id` 改为 `work-<UUID>`、`Artifact.id` 改为 `artifact-<UUID>`，服务端分配且客户端视作不透明字符串；不再从每实例归零的 seq 生成身份。卡片 UUID 不能代替外层身份隔离。内存 seed、测试夹具与 CLI 均从创建响应获取身份，不写死 work-1 等序号。

本票不做持久化迁移，旧内存实例重启后本就消失。两个 Store 同序创建后应得到不同 ID；旧通过／再生（包括全新无 ID 卡片或空卡片基底）在模型调用前 404／409，新作品不变。未来 #9 持久化仍继承“不会意外复用已发行身份”的规则。

#### 5.4 不承诺跨整个人工编辑周期的语义一致性

上游版本条件保护的是本次操作，不是永久锁定章纲生成时的全书快照。

现有 Outline 可以再保存、再通过；若上游退回 pending，读模型优先展示前置关卡并禁止 Beat 操作。上游重新通过后，旧 Beat 可以恢复审阅，再生使用此时最新的完整上游；系统不自动刷新旧计划，也不声称它已经与新版上游语义一致。

这一边界继承现有 Setting 行为。当前不增加持久谱系、冲突检测或级联失效系统；必须在方案和测试中保留此限制，避免让“通过版本检查”被理解为“内容绝不会冲突”。

### 6. HTTP 与 CLI

通过与再生的请求／响应、命令观察联合、精确遥测和诊断窗口归 [schema](../schema.md#61-请求与响应)，不在 Wiki 复制 DTO。下面保留实现顺序、失败语义与恢复理由。

#### 6.2 错误与调用预算

明确拒绝与结果未知必须分开，否则客户端可能误丢草稿或重复调用模型。

| 状态 / code | 情况 | 客户端行为 |
|---|---|---|
| 400 `bad-json` / `invalid-input` / `unsupported-chapter` | 外层参数或章节非法 | 保留输入，提示修正 |
| 413 `payload-too-large` | 超过字节预算 | 保留输入，提示缩减 |
| 422 `invalid-content` / `input-budget-exceeded` | 内容／ID 不合法，或合并输入超过技术预算 | 保留草稿，定位字段或展示长度／limit |
| 404 `work-not-found` / `artifact-not-found` | 作品或目标不存在 | 保留本地内容；不自动创建／生成 |
| 409 `version-conflict` / `artifact-already-approved` | 目标 head 或状态改变 | 回读、对账或进入冲突 |
| 409 `beat-gate-not-ready` / `upstream-changed` | 前置关卡未通过或运行中变化 | 保留内容，回读前置状态；可恢复后人工重试 |
| 409 `advance-in-progress` | 同作品另一个生成已持锁 | 不发第二次模型请求；保留当前页 |
| 409 `beat-approval-required` | 试图走通用状态入口 | 提示专用命令，不改状态 |
| 502 `llm-invalid-output` / 503 `llm-unavailable` / 504 `llm-timeout` | 再生输出无效／模型不可用／模型超时 | 验证 command.writeOutcome；明确 not-committed 且无旧未知写入时，回读确认后可保留内容恢复编辑；否则继续结果确认 |
| 网络异常、客户端 deadline、非法成功／错误响应、其他 5xx | 提交结果未知 | 冻结请求和本地内容，进入结果确认，不自动重发 |

错误复用 `code/message/retryable/attemptId/issues` 基础 envelope，Beat 专用错误另含 `command`，可含本次 `telemetry`；均有共享运行时 schema。当前 apiErrorSchema 是 strict，CLI 也只传递旧字段，因此必须明确增加 Beat 专用解码及元数据传递，不能只给服务端加字段。首次生成仍沿用 advance 的 `200 + kind:'failed'`，Agent 同时检查 outcome 与 Step 诊断，不只看 HTTP／退出码。

`writeOutcome` 取 `committed / not-committed / unknown`。专用成功只能 committed；专用失败为 not-committed 或 unknown，不能凭错误 code／HTTP 状态推断。参数、关卡、ID、模型和输出校验在提交前失败，可由命令构造 not-committed；进入 append/finalize 后默认 unknown，仅 Store 明确保证写前拒绝的条件错误可记 not-committed。Store 未分类异常仍 unknown。

提交前 catch 与提交／响应阶段分开。append/finalize 返回后已发生写入，即使日志、DTO 校验或 JSON 序列化失败，也不得回落到 not-committed；返回安全的 unknown 或让客户端按传输未知处理。诊断记录失败不反向改变产物。执行期观察必须契约合法、operation／已验证目标与请求基线匹配；缺元数据、冲突字段或非法成功响应不能作为“未写入”证明。唯一例外是[schema 的 Agent 可观测协议](../schema.md#agent-可观测协议)严格定义的请求边界拒绝分支，它证明本次调用尚未进入业务操作，不要求解析根本不存在的 body 基线；仍不能消除旧 unknown。

通过请求预算为 30 秒、确认 GET 10 秒、整份再生 920 秒；Web 通用 advance 增加与当前 CLI 一致的 1,820 秒完整 deadline，覆盖现有最多两个连续模型调用与传输余量。首次 Beat 也经这一有界调用，不凭旧 GET 推断永远只跑一步而缩短通用预算。CLI 显式 override 仍覆盖请求预算；多步定义变化时重新核对上限。这是调用方最长等待，不是模型典型耗时承诺。[现有运行预算](../../apps/server/src/steps/llm.ts)、[CLI 超时](../../apps/cli/src/client.ts)

deadline 要覆盖响应体读取，并主动结束等待；AbortController 不等于服务端撤销。重新生成 `maxRetries:0`，不自动 LLM repair、不自动补卡、不因断网自动再生成；恢复均由用户发起。

首次 advance 的 fetch 或 body 悬挂时，到期必须结束本地 generating 并自动有界回读一次：已有 Beat pending 则展示现状等待作者；没有目标则保留已通过 Setting，显示结果未确认／手动核对入口，不自动再发 POST。迟到响应由请求序号和已观察 head 隔离；同样不承诺取消服务端执行。

#### 6.3 结果确认：通过可匹配，再生不能猜

建议采用保守回读方案，不新增 commandId／持久回执框架；代价是未知的再生成果需要作者明确载入。

通过的共享 `matchesBeatSubmission` 继承 Setting 规则：同 work/章/kind/Artifact ID/version、approved、文本与顺序符合规范化后的冻结提交；旧卡 ID 对位相同，新卡获合法且不属于原基线的唯一 ID。不能简单删除所有 ID 后比较 JSON，也不能用后台 GET 覆盖冻结基线。

再生是随机新内容，不存在可预先比较的“预期正文”。即使 GET 读到 `v+1 pending`，也可能来自另一页面，不能冒认本次成功或清除本地修改。

| 已知事实 | 建议恢复动作 |
|---|---|
| 合法 not-committed（包括提交前模型失败），且没有更早的未知写入 | 保留草稿与意见；内容错误可继续编辑；模型／关卡／版本失败回读原基线与操作权限后恢复 |
| 无未知旧写入；回读确认仍为原 pending，ID／版本／内容均与基线一致，allowedActions 重新允许目标命令 | 提供“继续编辑”，保留原草稿与修改意见；结束本次已拒绝的提交快照，不重新生成或自动提交 |
| 有效通过响应／回读，匹配本次提交 | 确认目标达成，进入 readonly，清本次草稿 |
| 有效再生成功响应，匹配请求且不落后于已观察到的 head | 以响应的新 pending 整份替换基线，清本次修改意见；不自动通过 |
| 通过结果未知，GET 仍是原 pending 或 GET 失败 | 保持 uncertain；只允许再次回读或重试同一冻结通过请求 |
| 再生结果未知，GET 仍是原 head 或 GET 失败 | 保持 uncertain；只允许回读，或用户明确选择重试同一冻结再生请求；不换内容／版本 |
| 再生结果未知，读到新的 pending 或 approved | 进入冲突，保留本地副本；经“载入服务器版本，将放弃本地修改”确认后才替换，不声称是本次成功 |
| 通过回读为不同 approved／不同目标 | 冲突，保留本地副本，不自动合并或重新套版本 |

页面记录 `hasUnknownWrite`；后续一次 not-committed／4xx、GET 原 pending 或“当前没有生成锁”都不能清除它。未提交只证明当前 HTTP attempt，不证明更早未知请求已终止。旧 POST 可能尚未到达服务端，客户端无法由空闲状态证明请求已撤销。结果未知时自动 GET 一次，后续由用户操作；不后台无限轮询。

同一冻结再生请求的人工重试仍受锁和 head 条件约束：已有成功写入后，晚到请求在调用模型前被拒绝，不能继续追加；若前次明确失败，用户重试才允许再调用一次模型。这里保证的是正确条件写入，不承诺 exactly-once 模型执行或重复 HTTP 必然返回 200。

刷新／确认离开按产品约定丢弃页内状态，重新打开只读当前服务器结果。不承诺撤销在途请求，也不跨页面会话追认历史请求。

#### 6.4 CLI 对齐

新增 `approve-beat <workId> --file request.json` 与 `regenerate-beat <workId> --file request.json`，沿用当前 CLI 的 --file 风格。文件包含完整共享请求，不在 CLI 内偷偷取最新版本覆盖文件内容；新增 `get <workId> --kind beat --chapter 1` 精确读取，不能只按 kind 取第一条。章节级 kind 必须指定合法章号，作品级 kind 禁止 --chapter；读取允许既有正整数章地址，写入仍只开放第一章。

联网前校验文件，非法 JSON／参数错误保留安全字段路径；成功后校验完整响应。通过未知时按同一匹配规则回读；再生未知时报告已知服务器 head 与恢复建议、非零退出，不声称成功，也不自动覆盖用户请求文件。专用命令成功 stdout 一个 JSON、exit 0；拒绝／失败／未知 stderr 一个错误 JSON、exit 1，不把诊断混入正常产物内容。既有 advance 兼容 HTTP 200 failed 的退出语义，帮助中明确必须检查 `kind`；smoke 遇 failed 必须非零退出。

新增只读 `a4n config`，复用并校验现有 `/api/config {demo}`，不暴露 key、baseURL 或完整运行配置。smoke 的结果和部分失败诊断显式携带 executionMode，不能由 telemetry 为空判断 fake：live 的 approve 同样不调用模型。

fake smoke 扩到第一章 pending → 人工改动 → 通过 → 回读，明确断言 `beat-approved` 且没有 prose。另测整份再生，不能靠通用 approve 绕过完整提交。smoke 是合成探针的显式批量授权，不代表一般 Agent 可以因为 allowedActions 有 approve 就自动替作者把关。

#### 6.5 Agent 使用与排障的设计理由

模型产物合法不等于条件写入成功；同作品日志也不一定属于同次请求。因此 Agent 必须收到可验证的命令结果，并用 requestId／attemptIds 连接 LLM 与提交阶段，而不是按时间窗口猜测归属。

字段、请求阶段拒绝分支、observedHead 三态、恢复枚举、精确遥测收集和两个全局有界缓冲的规范统一在 [Agent 可观测协议](../schema.md#agent-可观测协议)。必须保留三个边界：旧 unknown 不被新拒绝清除；日志不是持久回执；allowedActions 不是替作者批准的授权。


### 7. 创作界面：保留旧内容，只有确认结果才替换

建议沿用 Setting 的预览／编辑模式与确认弹窗，新增章纲独立 reducer，不先抽整套通用产物编辑器。

#### 7.1 状态与交互

页面同时持有服务器基线、当前草稿和冻结命令三份隔离数据，避免响应覆盖正在编辑的内容。

| 交互阶段 | 可执行动作 | 内容处理 |
|---|---|---|
| `editing`（可处于预览或编辑模式） | 人工编辑、卡片增删重排、填写意见、通过、整份再生 | 只改页内草稿，预览读取草稿 |
| `submitting` / `regenerating` | 查看原内容、请求离开 | 锁编辑、卡片操作和另一写命令，防止重复点击 |
| `reconciling` / `uncertain` | 查看冻结内容、按上节规则回读或同请求重试 | 不修改请求快照，不自动替换基线 |
| `conflict` | 再次回读；满足第 6.3 节恢复条件时继续编辑；或确认载入服务器版本、请求离开 | 继续编辑保留原草稿和意见；不能清除未知写入标记，不自动合并或套最新版本 |
| `approved` | 只读 | 无编辑／再生按钮；本票无生成正文按钮 |

新增状态保存在 Workspace 的 workId 会话下；临时切回上游关卡不销毁 Beat 草稿。不同作品、不同请求序号、较旧响应必须隔离；后台刷新不覆盖 dirty 草稿。[现有状态模式](../../apps/web/src/setting-review.ts)、[Workspace](../../apps/web/src/pages/Workspace.tsx)

同一地址已观察 head 单调前进：GET v3 先到，迟到的再生 v2 200 不得替换 v3 或清本地草稿；同一 id/version 已知 approved 也不能被迟到 pending 降级。冲突保留副本，重新有界回读后按第 6.3 节处理，不自动改用最新版本重发。

点击再生前提示“将根据当前内容重新生成整份章纲，成功后替换当前内容”；失败保留原草稿和意见。意见可空；仅填写意见也纳入离开提醒。成功替换不提供版本比较，取消或失败不清意见。

意见框固定标注“仅用于重新生成”。如果意见非空却点击通过，确认弹窗明确“只通过当前可见章纲，不会应用这些修改意见”，默认取消；作者可以返回再生或明确通过当前内容。通过命令从不把意见暗中送给 AI。

通过时前端先完整校验，错误切到编辑并定位字段；服务端仍复验。卡片操作使用稳定 localKey，删除非空卡片可复用轻量确认；允许删到空数组再补齐或请 AI 重新生成。

#### 7.2 离开与可访问性

站内离开使用现有 ConfirmDialog，真实刷新使用浏览器原生提醒，不承诺能自定义刷新弹窗。

有草稿修改、未提交意见或在途／未知命令时，站内提示当前状态及“离开会放弃本页内容；已发送的请求可能继续处理”。默认“继续查看／编辑”，只有明确确认才执行导航一次；Esc、遮罩和关闭均取消离开。

复用焦点约束、默认取消、焦点恢复和亮暗主题；字段错误关联到输入。beforeunload 的安装和清理覆盖 dirty／在途状态，遵守浏览器可能不展示原生提示的限制。[ConfirmDialog](../../apps/web/src/ConfirmDialog.tsx)

#### 7.3 服务端读模型与前后衔接

WorkView 决定关卡与操作，页面只增加生成中的临时显示，不从局部按钮推断服务器状态。

| 服务器事实 | `workflowState` | `nextStepId` | `allowedActions` |
|---|---|---|---|
| 前置关卡未通过 | 沿用对应上游状态 | 按既有定义 | 不给 Beat 命令 |
| Setting 已通过，第一章 Beat 不存在 | `ready-to-generate` | `beat` | `generate` |
| 首次 Beat 生成失败 | `failed` | `beat` | 可重试时 `generate` |
| 第一章 Beat pending | `awaiting-beat-review` | null | `approve`, `regenerate` |
| 整份再生明确失败，旧 Beat 仍 pending | `awaiting-beat-review` | null | 保留关卡，错误显示在再生命令区域 |
| 第一章 Beat approved | `beat-approved` | null | 空 |

不能让再生失败把已有章纲藏进全页 `failed`，也不能令 `generate` 绕过现有 pending 关卡。complete 展示继续依据定义末端，保留三步／四步测试链的兼容性。

建议 Setting 通过动作确认成功后，页面仅衔接一次 advance 生成第一章章纲，沿用 Outline 的事件式模式；若作者只是刷新或重新打开 ready 状态，显示手动“生成第一章章纲”。不得在 render／GET 中自动调用模型；不因已通过响应重复到达而发两次 advance。

Beat 通过后只回读并展示终点，不自动调用 advance、也不接占位 prose Step。后续 #22 如何衔接正文，由其独立方案接手。

### 8.1 安全诊断：有足够信息，不输出作者内容

R3 的修订范围必须包含共享 callLlm 的继承路径，不能仅承诺“新增 Beat 日志不含内容”。移除当前 `textTail`、`causeMessage` 和原始 provider `err.message` 的默认日志／公开错误传播；截短不等于脱敏。所有调用该 helper 的既有 Step 都受影响，需要兼容回归。

采用白名单诊断：requestId、workId、chapter、stepId、attemptId、executionMode、受控 provider/model 标识、时间／时延、token 用量、长度、hash、稳定错误类别及版本身份。provider/model 仅取通过白名单验证的运行配置标识，不记录 baseURL、请求头、凭据或任意供应商响应体。

LLM 安全分类至少区分 `configuration / network / timeout / context-limit / output-truncated / output-schema / unknown`，条件写入失败另按命令 code 与 failureStage 表达。分类优先依据 SDK 类型、结构化 status/reason 和本地校验，不靠把原始 message 返回给调用者；无法可靠分类时用 unknown + 稳定消息，不能伪造精确原因。模型错误 detail 可以保留白名单状态码、已知 finishReason；其余值安全归一化。

内容校验只给安全 issue code、预定义字段路径和可选 limit／actualLength。路径只允许 schema 已知字段与有界数组下标，未知对象键不回显；不直接透传可能含输入值、动态键或作者文字的 Zod issues/message。Agent 可以据 `writingPlan[2].content` 等路径修正请求，或据 output-schema 与 attemptId 查模型失败，不需要看到原始失败文本。

上述白名单覆盖 stdout、HTTP／CLI 错误、LLM 遥测和命令摘要。日志记录器必须以非抛出或隔离失败方式调用，不能在 append 成功后因诊断错误把命令误报为明确未写入。批准请求不记录 content，再生不记录 instructions；仅 Agent 合法请求的正常产物读取／成功响应返回内容，不把禁止日志泄露误解为禁止返回产物。

## 代码落点

以下模块已经落地；此表是接手入口，不复制代码。

| 范围 | 当前落点 |
|---|---|
| contracts | 新增 `beat.ts`、`beat-submission.ts` 与测试；扩展 `index.ts`、`artifacts.ts`、`public-api.ts`、`telemetry.ts`，统一命令诊断、日志查询和安全错误的运行时 schema |
| server 领域 | 新增 `beat-content.ts`、`beat-review.ts`，在 `pipeline/pipeline.ts` 加地址解析与窄再生入口 |
| server 生成 | 新增 `steps/beat-io.ts`、`beat-step.ts`、`steps/skills/beat/SKILL.md`；真实/fake 同契约 |
| server 装配 | 修改 `start.ts`、`routes/works.ts`、`pipeline/consume-guards.ts`；注册第五步、两个命令、读模型，并贯通请求关联 ID |
| server 观测 | 修改共享 `steps/llm-call.ts`、`steps/telemetry.ts` 及必要错误映射；安全分类、准确调用归属、有界命令摘要和查询窗口，不引入外部平台 |
| store | Work／Artifact 改为 UUID 身份；复用 append/finalize，补 Beat 通用状态禁令和必要章地址校验；不设计 SQLite adapter |
| Web | 新增 `beat-review.ts`、`beat-api.ts`、`pages/BeatReview.tsx`；接入 Workspace、api、样式；补通用 advance 完整 deadline，小范围共用 Markdown |
| CLI | 修改 `client.ts`、`commands.ts`、`main.ts`，增加两个命令、按章 get、只读 config、诊断过滤与解码、恢复 JSON、长请求预算与 smoke |

只抽实际重复且稳定的纯工具，如地址解析、deadline 或格式渲染。Beat 专有的再生状态与 Setting 不同，不能用“大一统 reviewer／regenerator”增加本票维护负担。

新增生成 SKILL.md 时需按项目写作规范处理指令与素材边界；模型输入作为数据，不执行素材中的任意工具或外部指令。

## 测试与验证

S1–S6 保留实现前的验证计划，实际执行结果见“完成审核证据”；技术方案评审不替代实现 review。

实现采用公开边界的纵向切片；下表的 RED/GREEN 是预先约定，不表示每项都已执行。

每片固定循环：核对本方案对应条款 → 写一个体现缺失能力的失败测试 → 最小实现至通过 → 重构 → 对照 AC 和方案记录差异。测试应调用公开边界、可替换 Step／Store／HTTP，不断言私有函数的内部步骤。

| 切片 | 先写的 RED 行为 | 最小 GREEN 交付 | AC |
|---|---|---|---|
| S1 首次按章生成 | 已通过上游经 fake advance 得到合法 `beat#1 pending`，不同作品／章节不串；pending 不可消费 | Beat 最小共享契约、按章寻址、fake Step、关卡和 GET 深校验 | AC1、2、5、6 |
| S2 完整人工通过 | 当前页编辑可同 id/version 定稿，后续 fake 消费的是编辑后内容；旧版／外来 ID／跨 Store 旧请求／通用 approve 被拒绝 | 通过协议、UUID 身份、原子命令与安全错误；store 隔离和写入结果分类 | AC3、5、6 |
| S3 整份重新生成 | 当前未提交编辑及空意见确实进入 fake Step；不完整编辑可再生；失败不追加，成功 v+1 pending | 再生命令、共享锁、快照条件、完整输出校验 | AC4、6 |
| S4 Web 关卡 | 四部分显示、增删重排、有限 Markdown、过早通过字段错误、通过和再生互斥 | Beat reducer／页面、离开保护、Workspace 一次性衔接 | AC2、3、4、5 |
| S5 失败与结果未知 | 合法未提交失败可恢复编辑，旧 unknown 不被清除；首次 advance 到期结束等待；GET v3 后的 v2 响应不回退，未知再生不冒认成功 | Web/CLI 共用恢复判断与完整 deadline；覆盖 request revision、workId 隔离及挂载交互 | AC4、6、7 |
| S6 真实 Step 与 CLI | mock LLM 验证完整上下文及合并预算；安全错误仍可关联命令和模型；CLI 精确读章、模式／恢复 JSON 及 fake smoke 停在 Beat | 真实 prompt、生产装配、Agent 可观测协议和端到端 smoke | AC1–7 |

### 9.1 必须覆盖的对抗与回归案例

失败保护需用可控延迟测试证明，不能只测正常返回。

| 风险 | 必测证据 |
|---|---|
| 地址混淆 | 缺章号、零／负数／小数、不支持的第二章被拒绝；读取 beat#1 不拿到 beat#2；旧作品级链兼容 |
| 并发写入 | 双再生只一个获得锁；模型在途时通过／上游改变使另一写入失败；失效请求在模型前拒绝；跨作品可并行 |
| 草稿丢失 | 422、网络异常、200 非法响应、GET 失败、后续 4xx 均遵守 unknown 标记；明确失败保留意见和内容 |
| 假成功 | 另一页面同版本不同 approved、不正确新卡身份、再生后的未知 v+1、错误 work/章均不得清本地草稿 |
| 绕过关卡 | 通用通过、退回 pending、approved 再生被拒绝；无完整有效 Beat 的 fake 下游不能运行 |
| 半份与污染 | 输出缺字段／超限／错误 JSON 无 append；修改输入、返回对象不影响内部 Store；无生产 prose、无第二章 |
| 页面安全 | localKey 不外发，卡片移动身份稳定；离开取消恢复焦点，刷新不自动生成；恶意 Markdown 不执行／不联网 |
| R1 未提交与未知 | 502/503/504 合法 not-committed 可保留内容／意见继续编辑；合法 request-rejected 的 400/413 允许修正但不清旧 unknown；非法／错 operation／执行期缺字段仍未知；append 后 DTO／日志／传输异常不得标为 not-committed |
| R2 重启隔离 | 两个 Store 同序创建身份不相同；旧通过含全新无 ID 卡片、旧再生含空数组均在模型前拒绝，新作品不变 |
| R3 诊断脱敏 | 合成秘密分别植入输出 text、cause、provider message、未知键和 schema 错误；stdout／HTTP／CLI／telemetry／commands 均无标记，仍保留可用路径与关联 ID；回归共享 helper 旧 Step |
| R4 完整期限 | advance fetch 永不结束、headers 后 body 悬挂、忽略 abort、服务端写入后客户端超时均能结束本地等待并有界 GET 一次；不自动再 POST |
| Agent 精确判读 | get 区分 beat#1/#2；pending 明示等作者；advance awaiting／complete 无假 Beat 结果；合法响应字段与请求不匹配必须按未知处理 |
| Agent 调用归属 | 模型成功但 CAS 失败时，LLM ok 与命令 not-committed 共享关联 ID；锁拒绝不夹带持锁请求遥测；前置失败无 LLM；live approve 仍明确 live |
| Agent 恢复与窗口 | 未知再生读到 v+1 仍非零；observedHead 省略／null／对象语义分别验证；超出全局容量有截断标识、重启换 instanceId，空日志不证明未执行；诊断故障不影响写入 |

通过重放只要求最多一次定稿和准确对账，不要求重复 HTTP 都 200；再生测试也不把“最多一次成功写入”混同于“任何失败都不可能调用两次模型”。

页面验证必须包含 mounted DOM 集成测试：真实挂载 BeatReview／ConfirmDialog，验证键盘焦点约束与恢复、beforeunload 监听安装清理、Esc／遮罩取消和确认导航仅一次；再做浏览器合成 case 核对视觉与刷新限制。`renderToStaticMarkup` 仅证明静态输出，不可替代这些交互证据。对应测试运行环境如需补依赖，在 S4 显式记录，不以纯 reducer 测试冒充浏览器交互通过。

### 9.2 自动化和真实样例验证

完整门禁命令如下；实际执行时间、结果和警告见完成审核证据。

```sh
COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/contracts test
COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/server test
COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/web test
COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/cli test
COREPACK_ENABLE_AUTO_PIN=0 pnpm test
COREPACK_ENABLE_AUTO_PIN=0 pnpm typecheck
COREPACK_ENABLE_AUTO_PIN=0 pnpm build
```

真实模型至少准备行动、对话、内心反应／过渡三类合成样例。检查能否生成完整四部分、第一章范围是否合适、说明是否过度写成正文、人工意见是否进入再生，以及 tokens／时延是否支持上述预算；不制定自动文学评分或语义拒绝阈值。

真实运行前读取项目运行 skill，使用现有模型配置与遥测入口；只用合成素材。记录实际命令、样例、attemptId、结果和限制；服务重启导致数据丢失符合当前存储边界，但刷新丢未提交编辑和服务器丢测试作品须分别验证、分别说明。

### 技术方案评审

2026-09-06 已完成前端、后端、运维、产品与 Agent 视角复审：R1 失败恢复、R2 身份复用、R3 安全日志、R4 首次等待及新增 A1 请求拒绝分支均在设计层关闭。完整发现与裁决保留于 [评审记录](../plans/005-beat-technical-review.md)，已审 R1 [历史快照](../plans/005-beat-generation-review-r1.md) SHA-256 为 `c91f72ce3067bbe9e68236c86c4ae47e48c91fc3991568bfb6c5a7c1f6f788b6`。

### 开发步骤的执行约定

沿用已评审 S1–S6，行为变化先 RED 再 GREEN。S5 共享恢复判断作为 S4 依赖提前落地，S6 共享日志脱敏随服务端观察协议提前验证。六片现已接线；相互依赖的 contracts/server/Web/CLI 与交付文档作为一个逻辑候选审核，避免提交不可运行的中间链。发布状态以远端回读为准。

| 切片 | 开始前依赖 | 主要公开测试边界 | 步骤完成条件／预期逻辑提交边界 |
|---|---|---|---|
| S1 首次按章生成 | 锁定开工范围与分支模式 | contracts 导出 schema；HTTP advance/get；可替换 Step | fake 生成第一章 pending，关卡／地址／读回正确；不接正文 |
| S2 完整人工通过 | S1 | HTTP approve-beat/get；WorkStore 公共契约；fake 消费者 | 作者内容同版本定稿；通用入口禁止；UUID 隔离及重启旧请求拒绝 |
| S3 整份重新生成 | S2 | HTTP regenerate-beat/get；可替换 Step／Store | 当前草稿和意见进入生成；成功追加 pending，竞态／失败不误写 |
| S4 Web 关卡 | S1–S3 协议可用 | 挂载页面／ConfirmDialog；浏览器交互 | 阅读、编辑、排序、意见、通过／再生互斥、离开保护；不用静态 HTML 代替交互验证 |
| S5 失败与结果未知 | S2–S4 | 共享恢复函数；HTTP deadline；Web 与 CLI 调用边界 | 400/413/模型拒绝／网络未知可判读；旧 unknown 保留；迟到响应不回退，等待有界 |
| S6 真实 Step 与 Agent 链路 | S1–S5 | 真实 Step 的可替换模型边界；CLI 进程 JSON／exit；合成 smoke | prompt 与预算、安全日志／命令关联／窗口、精确读章及模式可验证；最后核对无 prose |

上表是本票逻辑提交边界，不是 commit/push 授权。Agent 诊断契约与相关失败测试应随 S1–S3 命令落地，S6 做跨层完整验证，不拖到最后才补观测；实现不得先写无法判读的新端点。开发前由作者与实现 Agent 确认这些测试边界；每步要有定向测试和 typecheck 证据，最终跑全仓门禁。

### 三轮自校准（2026-09-08）

1. **代码 ↔ 行为／测试**：从公开 schema、HTTP、实际 CLI 和 mounted 页面核对，补齐 fake 下游、超时／非法 200 单次回读、焦点环／遮罩取消；发现并修复迟到无 Beat 快照回退及未约定 5xx 被当作未写入。最终定向与根门禁通过。
2. **代码 ↔ Wiki／领域词**：Beat 四部分、同版本通过、再生追加、页内草稿和正文拆票一致；同步五步终点、UUID、日志字段、期限与双语图示。保留原始评审及 Creative 失败，不掩盖内存边界。
3. **完整候选 ↔ issue AC／范围**：AC1–6 有公开边界与实际链路证据，AC7 的正式 review／发布裁决待完成；没有 prose、第二章、SQLite、版本比较或后编辑接口。新增文件均属 #5，base..HEAD 无本地提交。

### 实际链路与质量样例（2026-09-08）

本轮只使用合成素材。CLI 为真实可执行文件 `./apps/cli/bin/a4n`；服务器仍是内存存储，以下 ID 是验收证据，不保证进程重启后可查询。

- **生产 demo 全链路**：`smoke --seed '合成 demo 验收：旅人在雨夜问路，寻找失踪的名字。' --title 'Ticket5 完整 CLI demo 验收'`，exit 0；work `work-abb85efc-fa62-4943-a2f6-79f0e94ef7f1`，五类产物、最终 beat-approved、无 prose。
- **真实 Beat 定点链路**：测试 host `pnpm --filter @agent4novel/server exec tsx test/fixtures/beat-cli-server.ts --live-beat --port=8791`。上游 Steps 为 fake，Beat 使用已配置 LongCat-2.0；生产命令、守卫、Store、HTTP 不替换。此结果不是全生产 live smoke。
- **浏览器**：合成作品 `work-0bc31cae-27ed-4ca3-b0aa-60bdf2050fc5` 完成编辑目标、卡片移动、意见再生、再编辑与通过；最终 v2 approved，CLI 回读与卡片顺序一致。默认取消、Esc 焦点恢复、离开丢弃再打开、有限 Markdown 与只读终点已检查；刷新原生弹窗未由自动化完整确认，以 mounted beforeunload 安装／清理测试补证，不能声称跨浏览器原生弹窗已验收。

| 真实 Beat 样例 | attemptId（work 前缀省略） | tokens 输入/输出；时延 | 结果与人工观察 |
|---|---|---|---|
| 行动：停电夜巡救人；work-3b0590a2-3c9e-4bc8-a237-9afb8109d2fd | beat-2d31a6a3-a210-4a91-a6d0-58892d081cb9 | 1738/848；25,502ms | 四部分、5 卡、后续 CLI 编辑并通过；结尾提及第 2 弧，跨度仍需作者把关 |
| 对话：钟表匠向邻居打探女儿；work-517299a5-8da3-4b7f-9933-93ed359f4515 | beat-cc8b02b1-4ef6-4f54-901c-e58b8d6d91eb | 1794/832；24,757ms | 四部分、4 卡，温和问答而非强行行动公式；编辑并通过 |
| 内心／过渡：旧房与未寄信；work-80a6f812-373a-4822-8928-47513721206e | beat-f0bbd78a-8f47-40be-801b-88f6a4f87f7b | 1849/994；37,305ms | 首次 output-schema 失败未落库，手动 advance 后成功；5 卡停在出门前 |
| 同作品整份再生，作者要求读信后收拾行李 | beat-80339913-3d5a-4871-b948-cc20e36fe393 | 2476/1997；44,697ms | 6 卡，意见得到体现；新 ID/v2 pending，人工最终目标同 v2 通过 |

再生 requestId `f2e1e4b2-15e5-4de9-86ba-193aee787027`；最终通过 requestId `35b851d2-4f4d-4de9-b77c-f1234da0e77b`。后者 `logs --request-id` 回读为 live、committed、attemptIds/telemetry 均空，准确表示通过没有调用模型。

**完整 production live smoke 未通过**：两次均停在 Creative，未进入 Beat。work-569b15b6-ca12-49ab-935f-e9db16ed240f 的 creative attempt 后缀 1788872713136，138,157ms、8000 output tokens、finishReason=length/output-truncated；work-81f1b74d-efd2-4f96-b3f2-6f14e2d045ec 的后缀 1788873079763，74,870ms、3609 output tokens、stop/output-schema。CLI 均非零退出并保留部分 steps。保留为上游可靠性限制，不静默调 Creative 或声称全链路 live 成功。

**近上限技术样例**：2026-09-08 以合法 Setting 字段加入合成控制字符，经 JSON 转义构成 user prompt 398,160 字符（含 system 的合计仍低于 400,000），直接调用真实 Beat Step。attemptId `work-synthetic-near-limit-beat-555de113-61b1-4fe8-ade0-b62b7891007f`，LongCat-2.0，331,282/851 input/output tokens，44,226ms，stop，四部分 schema-valid、5 卡。这个样例只校准转义后的资源边界，不代表文学质量；超预算不调用模型和 context-limit 安全分类另有单元测试。数值仍保留 400,000 / 8,000，不静默截断。

### 完成审核证据

本节八个字段是 C6.3/C6.5 唯一预留的受控转录区域；实质行为或上方事实变化必须重新进入 C5。

- **清单与候选**：固定点 `70b43968de24ecf21e596bff35988feff62b73a9`；source `codex/issue-5-beat-review` → PR → main，merge 需作者确认。清单 blob `db7f3eda6bce154b99e2ed67f50072465e9e2be0`；双轴通过候选 T0 `af41591906babcc626dfe0ec803dcd3442f9a7be`；pre-attestation T1 `ef82bad99e6632e026a4afb1c5491505de837f0a`。staged manifest 为 `git diff --name-status 70b43968de24ecf21e596bff35988feff62b73a9 af41591906babcc626dfe0ec803dcd3442f9a7be` 的完整 82 文件（代码／测试／锁文件／知识文档／图示）；无 unstaged/untracked，base..HEAD 无本地提交。
- **逐项判定**：C1 = PASS：C1.1/C1.8 据本轮 gh issue/dependency/Project 回读（OPEN、#4/#13 CLOSED、无评论；assignee 已 claim 12bitsD，完成时保留 ready-for-agent/Project Backlog，无明确终态规则）；C1.2/C1.6 据固定点、source branch、manifest 与远端 main 无保护／ruleset／workflow 的回读；C1.3–C1.5/C1.7 据本页已确认 grill/R1/S1–S6、领域/schema/ADR、作者正文拆票和范围决定。C2 = PASS：C2.1–C2.3 据下栏 RED/GREEN、公开边界测试与实际 CLI／浏览器；C2.4 据初步清理对共享边界与复用的结论；C2.5 据 Spec 逐条 AC 核对；C2.6 N/A（存在行为变化，执行 RED/GREEN）。C3 = PASS：C3.1–C3.4/C3.6 据本地门禁栏最终命令、静态扫描和日志／输入对抗测试；C3.5 据 closure_reuse/quality/efficiency 三视角清理，修复结果见本页变化事件：复用共享恢复／deadline／Markdown，保留 Beat 专用再生边界；提升错误语义可读性，提前数组数量检查并限制 CLI 文件读取，未扩票。C4 = PASS：C4.1–C4.3/C4.5–C4.8 据知识维护栏及链接／schema／图示校验，C4.4 research 已保存，新增 ADR N/A（沿用既有 Step/Store 架构，无新增不可逆决定）；C4.9 据上方三轮自校准与修订后双轴复核。C5 = PASS：C5.1–C5.3 据 T0 manifest、两种 diff check、空本地历史与工作区余项核对；C5.4–C5.7 据下栏独立双轴原发现、接受修复与新候选 PASS。C6.1/C6.2 = PASS：补证与文档修订后定向及全仓重跑，双轴复审通过。C6.3 = PASS：只在预留八字段转录上述证据、T0、例外与风险，当时 T1/裁决保留 pending；精确 diff 已经 C6.4 独立核对。C6.4 = PASS：beat_c5_standards 核验 T0 → T1 仅四个预留字段变化、转录忠实；继承完整 T0 并检查增量，T1 的 82 文件、空本地历史、工作区与两种 diff check 均一致，无新增阻塞。C3.2 格式/lint 子项 N/A（仓库无对应脚本，typecheck/diff 检查替代）；C7.3 预计 N/A（当前无 CI，发布时须再回读，不用本地门禁冒充 CI）。
- **验收与 TDD**：AC1/2→beat-step、beat-pipeline、beat 契约与生产 demo；AC3/5→原子通过、fake downstream 消费最终编辑、mounted Workspace 与 CLI 回读；AC4/6→再生草稿与意见、旧 head/CAS/共享锁、跨 Store UUID、unknown 恢复；AC7→完整门禁、双轴 review 与交付。行为 RED 包含首次缺章、专用路由 404、跨 Store 重复 ID、上游更换后误提交、非法输出落库、日志异常改变结果、命令缺诊断、未知恢复／迟到响应回退、secret 文本泄漏、CLI logs 的 undefined query。后续修复另有 RED：合法编辑通过误判冲突、旧 GET 恢复权限、10,000 卡放大校验错误、Workspace 的迟到无 Beat GET 隐藏已通过页面；另补 code/status 不匹配的 5xx 必须 unknown、再生超预算显示长度的 RED，最小修复后定向 GREEN。fake 下游新增测试初次即 PASS（补充既有行为证据，不冒充 RED）。
- **本地门禁**：2026-09-08 21:46，根脚本 `COREPACK_ENABLE_AUTO_PIN=0 pnpm test` exit 0（contracts 50、server 151、Web 61、CLI 38）；`pnpm typecheck` 和 `pnpm build`（同环境前缀）exit 0。完整测试输出保留在本轮命令日志（最新 `/tmp/a4n-closure-DO8pu2/c5-fix-test.log`），未用管道掩盖退出码。构建只有既有 DOCX 504.50kB 分块警告。`git diff --check <fixed-point>` exit 0，仓库无 lint/formatter 脚本（C3.2 对该子项 N/A，使用 typecheck/diff 检查）；R0/R1 hash 与归档值一致。82 文件 staged 增量静态扫描：硬编码凭据、shell/eval/SQL 注入模式均无命中，`.env.local` 被忽略；新增 fixture 默认 fake，只有显式 --live-beat 才加载已配置 provider。19 个 Markdown 的本地链接／锚点／Wiki 必填元数据及固定标题校验通过；四张 SVG 经浏览器渲染核验。jsdom@26.1.0 用于 mounted DOM；whatwg-encoding 间接依赖 deprecated 警告。SDK LongCat responseFormat 警告为已知 json_object + 本地 Zod 限制，不代表 structuredOutputs 已支持。
- **双轴 review**：技术方案评审 preserve；首轮候选 `95e5f9c212203c3c26bc22a4bd5636c402ef692f` 的 Standards FAIL（P2 context-limit 证据缺失；P3 导航状态冲突），Spec FAIL（AC7 缺 R2/R4/context-limit 必测证据；AC1–6 未发现确定实现错误）。全部接受，补证／修订见下方变化事件；T0 复审：beat_c5_standards 与 beat_c5_spec 分别 PASS，均完整核对五文件修订并继承先前 82 文件审计；原发现全部关闭、无新增阻塞。Spec 独立复跑 Server 25／Web 7 共 32 项通过并逐条确认 AC1–6 与 AC7 必测证据。独立 beat_c5_security 首轮及 T0 JSON 评审均 passed=true、security_concerns/logic_errors 为空；首轮导航建议已关闭，T0 suggestions 为空。初步清理（三个只读 Agent：closure_reuse/quality/efficiency）发现不可达安全日志、pending→approved 误判、旧 GET 权限、错误分类和预算丢失、大数组校验放大及 CLI 文件无界读取；接受并修复，不将清理结论冒充 C5。
- **修复与回归**：上述发现修复后 contracts/server/Web/CLI 定向测试通过；共享 LLM helper 回归覆盖 caption/creative/outline/setting。C5 修订仅补公开路径测试及文档，无生产行为修改：beat-pipeline 21、beat-step 4、mounted Workspace 7 项定向通过；全仓最终 300 项与 typecheck/build 通过。context 测试最初夹具失败、其余补证初次 PASS 的性质见变化事件，不虚构业务 RED。所有首轮 findings 均接受并关闭，无有证据拒绝项；T0 获双轴及安全／逻辑 PASS，T1 获下栏独立 C6.4 裁决。
- **知识维护**：Wiki 005、索引与 004/013/014/016 继承边界、schema、CONTEXT、双语 README/四张 SVG、handoff、contract-governance 和 drive skill 已同步；R0/R1、调研及作者原始决定 preserve。CLI 真实 provider 限制与浏览器原生刷新限制如上。issue backlink 在远端入口可读后同步，不预写关闭结果。
- **发布前裁决**：2026-09-08，未参与实现的 beat_c5_standards 对 T1 `ef82bad99e6632e026a4afb1c5491505de837f0a` 给出 **C6.4 PASS**：清单 blob 匹配；T0 → T1 仅四个预留字段，转录忠实于已审候选、双轴原始结论、gh 回读与验证证据；300 项根测试及 32 项独立定向测试有结果，夹具失败未冒充业务 RED，计划未冒充运行结果。完整 82 文件范围不变，HEAD 等于 BASE、无区间提交或 unstaged/untracked，diff check 通过，secret 仍忽略。剩余风险：完整 production live smoke 停在 Creative，原生刷新弹窗未完整确认，内存／单进程边界；无新增阻塞。本次按 C6.5 一次转录该裁决，仍须 C6.6 终止核验与 C6.7 后才能交付；不在本候选记录最终 tree 或整节 C6 判定，merge 仍需作者确认。

## 边界与非目标

范围仅第一章完整 Beat；不做批量章纲、正文、版本比较、单卡 AI、回流或已通过编辑。继承单进程锁、内存存储、当前页面草稿生命周期；不承诺 exactly-once 模型执行、日志持久回执或跨整个人工编辑周期的语义一致性。

正文 #22、第二章循环 #6、新旧比较 #20、章节重生 #21、全仓治理 #19、SQLite #9 各自独立。模型预算的合成真实样例与容量限制见下方实测记录；诊断窗口会淘汰并随进程清空，不能以空日志证明未执行。

## 上下文演进

### 2026-09-08 — 正式候选评审补齐必测证据

- **触发证据**：独立 Standards/Spec 对候选 `95e5f9c212203c3c26bc22a4bd5636c402ef692f` 判 FAIL：context-limit 测试声明无对应案例，R2 跨 Store 旧 HTTP 命令与 R4 首次生成超时的 mounted 回读证据不足；导航页仍声称未开始实现。独立安全／逻辑轴无阻塞项。
- **原假设**：UUID Store 测试、advance deadline 单测与人工通过超时测试足以代表相应公开路径，context-limit 分类实现可被既有共享错误测试覆盖。
- **决定**：接受全部发现；补两个 provider context code 的安全遥测测试、旧作品／新作品地址上的旧 approve（全新无 ID 卡）与 regenerate（空数组）HTTP 拒绝测试，以及首次生成响应丢失后读到 pending／回读自身超时的 mounted 测试；修正导航的当前状态。
- **影响**：公开边界测试通过且无需改变生产行为。context 测试首次失败是 beforeEach 意外返回 mock 被当作清理函数调用，修正夹具后通过；不将此夹具错误冒充业务 RED。其余补证初次 PASS。重新跑全仓门禁与独立双轴评审。
- **上下文处理**：preserve 初轮发现与原技术方案必测要求；replace 无证据的覆盖假设为实际测试入口，导航不再重复维护实现阶段，未改写 R0/R1。

### 2026-09-08 — 五步链路落地与交付前修复

- **触发证据**：完整 demo CLI 与浏览器编辑／再生／通过成功；初步三轴清理发现日志不可达、响应对账与大数组校验问题。
- **原假设**：同版本内容变化可统一视为冲突，旧 GET 可用于恢复权限，数组 max 会先于逐项解析生效。
- **决定**：区分 pending→approved 的合法原子更新；恢复权限只用本次提交后的新回读；数组先检查数量，再逐项校验。修复已提交后的日志路径及 Workspace 迟到无 Beat 快照回退。
- **影响**：增加公开边界 RED/GREEN、可执行 CLI 集成及安全诊断测试；README、图示、schema、运行 skill 与前置 Wiki 同步当前能力。
- **上下文处理**：preserve 作者边界、R0/R1 和真实模型失败；compact 阶段性测试计数到最终门禁，replace “未接线／待实现”的当前说明。未扩展为正文或 Creative 调优。

### 2026-09-08 — 开始完整实现与 CLI 验证

- **触发证据**：作者明确要求完成整个 #5，闭环后做代码评审与 CLI 功能链路验证；开发范围及测试边界沿用上方 S1–S6。
- **原假设**：仅收录方案，尚未开始业务实现。
- **决定**：从固定点 `70b43968de24ecf21e596bff35988feff62b73a9` 创建 `codex/issue-5-beat-review`，按 implement/TDD 流程逐片实现；完成后独立双轴评审和实际 CLI 验证。合并 main 前仍需确认，不直推 main。
- **影响**：已通过 gh 将 #5 assignee 设为当前账户；标签与 Project 暂保持 ready-for-agent／Backlog。main 无保护、无 ruleset、无 Actions workflow；这些不豁免本地门禁或独立 review。交付目标为开发分支 PR，merge 不在当前授权内。
- **上下文处理**：preserve 已有方案、R0/R1 快照及收录变更；本轮原有工作区文档均属 #5，上方计划逐片记录实际证据，不提前宣称完成。

### 2026-09-06 — 拆分章纲与正文并完成技术方案复审

- **触发证据**：作者确认章纲和正文是独立 Step；初轮评审及新增 Agent 视角暴露失败冻结、身份复用、共享原始错误、首次等待和早期拒绝分支问题。
- **原假设**：#5 同时承接第一章章纲和正文，卡片 UUID、现有遥测和 fetch 即足以复用。
- **决定**：本票止于 Beat 通过；补齐命令写入结果、Work／Artifact UUID、安全关联诊断和有界等待。完整裁决见评审记录，不在这里复制每项发现。
- **影响**：共享 contracts、Store、Pipeline、Web、CLI 与旧 helper 回归均进入本票切片；正文另归 #22，#19/#9 在两类产物之后。
- **上下文处理**：preserve 全部作者决定、调研与 R0/R1 评审快照；replace 现行票内工程方案为修订结论，未把旧实现描述改成新能力已上线。

### 2026-09-08 — 正式收录并建立实现交接入口

- **触发证据**：作者要求“正式收录进 wiki，写入完后定开发 step”；已审 R1 hash 与本地文件一致，live #5 及依赖回读未改变范围。
- **原假设**：docs/plans 临时承载待评审方案；CONTEXT 将章纲概括为“本章目标、场景、冲突、结尾钩子”，handoff 仍沿用先治理／SQLite 的旧排期。
- **决定**：工程 HOW 收到本页，形状／协议收到 schema 并标记待实现，原稿归档、原入口改为导航；保留 S1–S6 并补步骤依赖、测试边界和完成条件。
- **影响**：更新 Wiki 索引和 004／013／014 的后续关系；领域词与排期同步已确认决定。代码、README 当前运行说明、运行 skill、GitHub 元数据均不作为本轮实现或发布。
- **上下文处理**：preserve 原始目的、Human 决定、失败实验及已审原稿；compact 临时计划入口为导航；replace 现行交接的旧排期，下一位 Agent 从本页 S1 与 C1 开始。

## 交接结论

可以依赖五步链路、Beat 四部分契约、专用命令和请求诊断；不能假定已有正文、第二章、持久化或自动语义一致性检查。接手时先查下方完成审核证据与 live PR/issue 状态，不把本地能力等同于已合并发布。

### 下一步

| 行动 | 负责人 | 截止时间 |
|---|---|---|
| 完成尚缺的门禁、独立评审和精确候选 attestation | 交付 Agent + 独立 reviewer | commit/push 前 |
| 发布 PR 并回读分支、检查和 Wiki；同步票面工程入口 | 交付 Agent | C1–C6 全部通过后 |
| 按确认的 PR 模式合并、核对 issue 终态 | 作者授权 + 交付 Agent | merge 前取得授权，关闭前验证 main |
