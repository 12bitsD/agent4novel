# #5 技术方案：按章生成章纲，经作者通过后停止

建议在现有工作流中补齐第一章章纲关卡，复用条件写入与页内编辑机制；整份重新生成走独立命令，不与正文生成合并。

状态：**R1 修订稿，技术方案复审通过；待正式录入与开工确认，未开始实现。** 日期：2026-09-06。票面：[章纲生成、编辑、重新生成与通过（第一章）#5](https://github.com/12bitsD/agent4novel/issues/5)。代码核对基线：`main@70b43968de24ecf21e596bff35988feff62b73a9`。

修订来源见[综合评审记录](./005-beat-technical-review.md)；[R0 原稿快照](./005-beat-generation-review-r0.md)保留初轮证据。2026-09-06 作者追加要求：从实际调用能力的 Agent 视角检查结果、错误、恢复与可观测性。本次仅修订方案，不把技术修订等同于代码修复。

本文临时放在 `docs/plans/` 供评审，不新增知识权威来源。评审修订后，将工程 HOW 收入 Wiki 005，内容与公开协议收入 schema/contracts；本草案届时只保留评审记录与正式入口，避免长期维护两份方案。

## 读者确认

核心读者是作者／产品负责人，其次是实现、评审和调用能力的 Agent。本文回答三个问题：章纲是否符合创作流程，失败是否可恢复，以及人和 Agent 能否从稳定信息中判断结果并执行下一步。

作者已确认“章纲 → 作者通过 → 正文”是两个 Step。本方案不重新讨论这一边界，也不要求作者裁决每个内部函数名。下文“已确认”来自本轮访谈与 #5；“建议”是本次经方案级复审的技术设计，不代表实现或测试已经通过。

## 问题定义

把第一章的创作计划做成可生成、可编辑、可整份重新生成、可一次通过的独立产物，并确保后续只能消费作者实际通过的内容。

原 #5 同时包含章纲和正文，现已拆分。当前生产链止于设定通过，下一步需要的不只是模型函数，还包括按章节寻址、关卡、公开协议和失败保护。[#5](https://github.com/12bitsD/agent4novel/issues/5)、[当前 Pipeline](../../apps/server/src/pipeline/pipeline.ts)

## 核心结论（≤3条）

1. **内容采用四部分，中等结构化。** 卡片保留顺序与自由说明，程序只检查完整性；不硬编码叙事公式。这是已确认的产品选择，研究理由见[调研笔记](../research/chapter-plan-design-methods.md)，不是已证明的生成质量优势。
2. **建议“生成追加版本，通过定稿当前版本”。** 页内修改不单独保存；重新生成成功才追加 pending，点击通过则原子更新当前内容并置 approved。依据是现有 [WorkStore](../../apps/server/src/store/work-store.ts) 的 append/finalize 接口，不需要新 SQL 表或持久任务系统。
3. **独立交付第一章章纲，并让调用结果可判读。** 生产链停在 `beat-approved`；正文归 [#22](https://github.com/12bitsD/agent4novel/issues/22)。Agent 得到目标、写入结果、失败阶段和安全恢复信息；LLM 成功不冒充业务成功。仍按[完成清单](../agents/ticket-completion-checklist.md)评审、录入、TDD 和交付。

## 1. 已确认的产品基线

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

#5 票面“尚待方案收口”仍概括列有草稿生命周期、字段约束等待定项，其中上述产品规则已在后续访谈中明确。正式方案录入时同步票面，不把旧待定描述当成尚需重复询问的问题。

非目标保持独立：正文 [#22](https://github.com/12bitsD/agent4novel/issues/22)、续写 [#6](https://github.com/12bitsD/agent4novel/issues/6)、新旧比较 [#20](https://github.com/12bitsD/agent4novel/issues/20)、章节重生 [#21](https://github.com/12bitsD/agent4novel/issues/21)。不预建回流接口、语义冲突拦截、单卡 AI 操作或通用版本管理 UI。

## 2. 当前代码可复用什么，缺什么

存储一致性与人工定稿已有基础，缺口主要在按章调度和重新生成命令；不需要重写编排层。

| 当前事实 | #5 的处理建议 | 依据 |
|---|---|---|
| Artifact 已区分作品级与章节级产物；getWork 只返回每个地址的最新版 | 继续使用 `(workId, kind='beat', chapter=1)`；章纲内容不重复存章号 | [artifacts](../../packages/contracts/src/artifacts.ts)、[schema](../schema.md) |
| Store 已支持带 chapter 的追加、条件写入和同版本定稿 | 复用 append/finalize，不增加数据库表，也不让路由拼“先保存再通过” | [Store 实现](../../apps/server/src/store/in-memory-store.ts) |
| Pipeline 查找 output/consumes 时仍使用无 chapter 地址 | 补齐输出、依赖、关卡和条件写入的章地址；不能只注册 Beat Step | [Pipeline](../../apps/server/src/pipeline/pipeline.ts) |
| Setting 已有完整提交、稳定 ID 和回读对账 | 继承机制，增加 Beat 专用模块；不把随机再生套成确定性提交对账 | [Wiki 013](../wiki/013-setting-generation-review.md#提交结果确认) |
| WorkView 目前只深入校验 Setting 内容 | 增加 Beat 校验及章纲状态；不借机治理全部六种产物 | [public-api](../../packages/contracts/src/public-api.ts)、[#19](https://github.com/12bitsD/agent4novel/issues/19) |
| Outline 目前允许重新保存为 pending | 维持既有兼容性，当前上游关卡不满足时阻止 Beat 操作；不承诺自动更新已有下游 | [works routes](../../apps/server/src/routes/works.ts)、[Wiki 013](../wiki/013-setting-generation-review.md#服务端读模型与页面衔接) |

架构仍服从 [ADR 0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md) 的薄 TypeScript workflow 和 [ADR 0002](../adr/0002-storage-sqlite-skills-as-files.md) 的长期存储方向。SQLite 是后续落地项，不把 ADR 的目标误写为当前实现。

## 3. 内容契约：四部分内容，一份可执行定义

建议使用 `title / goal / writingPlan / ending` 四个顶层字段，统一维护于拟新增的 `packages/contracts/src/beat.ts`。这是内容 JSON 的 schema，不是创建四张 SQL 表。

### 3.1 最终存储形态

卡片只承载身份、标题和自由说明，不增加场景类型、人物引用、冲突类型等硬字段。

```ts
type BeatContent = {
  title: string
  goal: string
  writingPlan: Array<{
    itemId: string
    title: string
    content: string
  }>
  ending: string
}

// 外层继续使用 Artifact：
// kind: 'beat', chapter: 1, version, id, workId, humanStatus, createdAt
```

| 字段 | 界面名称 | 最终约束与表达方式 |
|---|---|---|
| `title` | 章标题 | 非空纯文本；去首尾空白 |
| `goal` | 本章目标 | 非空，保存有限 Markdown 源文本 |
| `writingPlan` | 写作安排 | 有序数组，至少一张卡；顺序就是计划顺序 |
| `writingPlan[].title` | 安排标题 | 非空纯文本；去首尾空白 |
| `writingPlan[].content` | 安排说明 | 非空，保存有限 Markdown 源文本 |
| `ending` | 章末落点与承接 | 非空，写预期局势、停止位置和承接；不硬拆成多个必填属性 |

四个字段始终存在，不使用 null/undefined。正文类字符串只用 `trim()` 判空，存储保留原始换行和排版；不按渲染后的文本比较或存 HTML。

### 3.2 同源派生四种边界

重新生成应允许修复尚未编辑完整的计划，因此不能直接复用“通过请求”的非空限制。

| 边界 | ID | 完整性 | 用途 |
|---|---|---|---|
| `BeatDraft` | 不允许模型输出 ID | 必须完整 | 模型结构化输出 |
| `BeatContent` | 每卡必须有唯一服务端 ID | 必须完整 | 存储、响应、后续消费 |
| `BeatReviewDraft` | 已有卡保留 ID，新卡省略 ID | 必须完整 | 一次通过请求 |
| `BeatEditDraft` | 与 review 一样；允许省略新卡 ID | 允许空字符串和空卡数组，仍要求字段齐全且类型／大小合法 | 重新生成的当前编辑内容 |

实现用共同字段构造器和完整性模式派生，不复制四套独立规则。`BeatEditorDraft` 是 Web 内部类型，额外有 `localKey`；出站时显式剔除 localKey，不能把它发成 itemId。

### 3.3 身份与版本建议

人工操作保留卡片身份，AI 整份重新生成建立新一版身份；本期不尝试跨版本推断同一张卡。

人工编辑和重排保留已有 `itemId`。新增卡片缺 ID，由服务端分配 `beat-item-<UUID>`；重复、外来或旧版本 ID 拒绝并返回字段路径。对未变更卡片不重新计算 ID，不用数组下标或文本 hash 当身份。

重新生成时，服务端验证提交基线和 ID 归属，再剔除 ID 交给模型。完整新结果注入全新 ID，成功追加为下一版 pending。旧版保留在现有 Store 内部，但没有历史读取、比较、选择或回退入口。

```text
首次生成          人工修改仅在本页       整份重新生成成功       人工修改并通过
v1 / pending  ──→ 不写服务端        ──→ v2 / pending      ──→ v2 / approved
                                          新 Artifact.id       id/version 不变
```

“不加版本比较”不等于删除存储历史；“通过”也不额外制造 V3。这个技术语义沿用现有 append/finalize 能力，已纳入方案级复审。

### 3.4 技术预算与安全渲染

建议设置宽松的防滥用上限，不把上限当作创作配额；具体数值尚未做真实模型校准。

| 项目 | 草案建议值 |
|---|---:|
| 标题 / ID | 256 / 96 个 JavaScript 字符单位 |
| 单个正文类字段 | 20,000 个 JavaScript 字符单位 |
| 全章标题与正文总量 | 100,000 个 JavaScript 字符单位 |
| 写作安排卡片数 | 最多 128 张；不规定生成目标张数 |
| 本次修改意见 | 10,000 个 JavaScript 字符单位，允许空 |
| approve / regenerate HTTP body | 1 MiB，按 UTF-8 字节计，JSON 解析前检查 |

数值是待校准的技术建议，参考了 Setting 已有保护方式；不是对一章文学篇幅的要求。模型输出初始预算建议沿用 `callLlm` 的 8,000 tokens 默认量级，按真实样例调整，不能把截断或超限输出作为半份产物保存。[现有调用器](../../apps/server/src/steps/llm-call.ts)

合并后的完整 prompt 也须检查技术预算，不能只看 HTTP body。先采用票内 `beatLimits.maxPromptChars` 常量，初值建议 400,000 个 JavaScript 字符单位，计入 system、完整 outline/setting、当前章纲和意见；超限在模型调用前返回 `input-budget-exceeded`、`writeOutcome:'not-committed'` 及安全的分项长度／limit。本票不新增环境变量或模型配置界面。这个上限用于限制资源，不声称等价于任意模型的 token 窗口；模型自身上下文拒绝映射为安全类别 `context-limit`，不静默裁剪上游，提示缩减可编辑输入或检查模型配置。具体数值和近上限样例在真实验证时校准。

建议复用有限 Markdown：段落、换行、粗体／斜体、引用、列表；禁用链接、图片、HTML、嵌入等执行或联网能力，其他语法安全降级。将 [setting-markdown](../../apps/web/src/setting-markdown.tsx) 小范围抽为共用格式渲染器，参数化预算；不抽通用富文本编辑框架，也不把 Beat 的内容上限绑定到 Setting 的常量。

## 4. 流程与模块：明确章地址，不提前实现章节循环

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

### 4.1 按地址解析输出、依赖和关卡

建议保留当前定义结构，增加最少的章信息，并集中一个地址解析函数，避免各处只按 kind 查第一条记录。

`PipelineDefinitionEntry` 增加 `chapter?: number`；`gateBefore/gateAfter` 使用已有 `GateRef`。本票仍可保留 `consumes: ArtifactKind[]`：通过 prior definition 找到对应 outputKind 的完整地址。定义当前已禁止重复 outputKind，所以对本票第一章及 fake 下游没有歧义，不扩展多章调度框架。

生产 Beat entry 为 `outputKind:'beat', chapter:1, consumes:['outline','setting'], gateAfter:{kind:'beat',chapter:1}`。启动校验需要拒绝作品级 kind 带章号、章节级 kind 缺章号／非法章号，以及 gateAfter 与输出地址不一致。

`getState`、`runEntry`、输入快照、append 条件、日志和 gate 查找统一使用完整地址。`PipelineInput` 增加可选 `chapter`，Beat 私有输入要求 `1`；既有作品级 Step 不凭空获得章号。公共 Artifact 形态允许正整数章号，但本票生产命令仅开放第一章，其他章返回 `unsupported-chapter`。

### 4.2 输入与生成责任

Beat Step 只负责生成完整内容，不写 Store，也不能通过关卡。

首次生成的模型输入为完整已通过 outline、setting 和 `chapter=1`。重新生成另带当前页内容及修改意见；保留 Pipeline 既有 `seed` 输入兼容性，但本票 prompt 不默认重复堆入 caption、creative 和原始素材，避免把上游已淘汰方向重新引入。

生成提示明确：默认围绕首弧首剧情点，后续大纲用于把握全局；不要求一章完成该剧情点；输出计划而非正文。以上是提示与人工检查项，不增加判断“是否提前剧透”“冲突是否足够”的语义拦截器。

新增 Beat 私有输入／输出包装及生成 skill；首次生成与再生共享同一个内容生成器，以 `mode:'initial'|'regenerate'` 区分必要输入。此模式留在服务端私有 I/O，不把调度参数变成公共内容字段。fake 依同一共享输出 schema 提供完整样本，不能走宽松的占位 JsonValue。

### 4.3 责任划分

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

## 5. 写入一致性：生成追加，通过同版本定稿

所有写入都在最后一步再次检查前置条件，也就是“读取时的版本仍有效才写入”；只在 HTTP 开头检查不够。

### 5.1 首次生成和整份再生

生成前后都要守住正确的作品、章号和上游关卡。

1. 取得该作品生成锁，读取隔离快照；确认所有较早关卡合法且已通过。再生还检查目标 head 的 ID、版本及 pending 状态，先拒绝陈旧请求再花费模型调用。
2. 冻结输入和各上游 head。首次目标条件为 `beat#1 不存在`；再生为原目标 `id/version/pending`。调用模型，整体校验，再注入服务端 ID。
3. 用同一次 `appendArtifact` 校验目标及操作开始时的 approved 上游 head，成功才发布完整 pending。任何失败不 append，不改变旧章纲；`finally` 释放锁。

内容输入只有 outline/setting，但关卡与提交条件应覆盖定义中所有较早产物的当前有效 head，防止模型运行期间更早关卡退回 pending。对上游的检查复用各自 consume guard，不能只检查字符串 `approved`。

当前共享 consumeGuards 实际只注册了 creative。本票明确补齐所需 caption/outline/setting/beat 的共享 schema 检查；已有 approved 输出也须被检查，不能只在“输出还不存在”时运行 guard。读模型和命令采用同一规则，污染内容按关卡未就绪拒绝，不让 Agent 看到可执行操作但服务端必定失败。

`advance` 与 `regenerateBeat` 共用现有 per-work 锁：同一作品并发生成直接 409，不排队、不重复调用模型；不同作品互不阻塞。锁是单进程机制，不承诺跨进程租约。人工通过可以与正在生成竞争，但最终只允许一次条件写入获胜：通过先成功则迟到再生失败，再生先成功则旧版本通过失败；客户端页面仍禁止同时发两个命令。

### 5.2 一次通过

通过接收作者当前完整内容，将目标的内容和状态一次定稿，不先保存后批准。

检查顺序为作品／目标存在 → 目标 ID 与版本匹配 → pending → 当前关卡允许 → 内容与 ID 归属。准备完整候选后调用 `finalizeArtifact`，传入目标和操作开始时上游 head 条件；成功保持 Artifact 的 id、version、createdAt，状态改为 approved。

通用 `/approve`、`Pipeline.approve(kind='beat')` 和 `setStatus(kind='beat')` 必须像 Setting 一样关闭，返回 `beat-approval-required`，包括禁止退回 pending。Beat 公开写入口只有首次生成、专用再生和专用通过；不提供 PUT 草稿或通过后编辑入口。

Store 仍是内部接口，不把内容 schema 整套搬进 adapter。Beat 命令在写入边界完整验证候选，GET/成功响应和后续消费再验证共享 schema；测试直接污染 Store 的内容必须在消费守卫被挡住。

### 5.3 跨重启身份隔离

作品和产物身份不跨 Store 生命周期复用，重启前的请求必须无法命中新作品。

将 `Work.id` 改为 `work-<UUID>`、`Artifact.id` 改为 `artifact-<UUID>`，服务端分配且客户端视作不透明字符串；不再从每实例归零的 seq 生成身份。卡片 UUID 不能代替外层身份隔离。内存 seed、测试夹具与 CLI 均从创建响应获取身份，不写死 work-1 等序号。

本票不做持久化迁移，旧内存实例重启后本就消失。两个 Store 同序创建后应得到不同 ID；旧通过／再生（包括全新无 ID 卡片或空卡片基底）在模型调用前 404／409，新作品不变。未来 #9 持久化仍继承“不会意外复用已发行身份”的规则。

### 5.4 不承诺跨整个人工编辑周期的语义一致性

上游版本条件保护的是本次操作，不是永久锁定章纲生成时的全书快照。

现有 Outline 可以再保存、再通过；若上游退回 pending，读模型优先展示前置关卡并禁止 Beat 操作。上游重新通过后，旧 Beat 可以恢复审阅，再生使用此时最新的完整上游；系统不自动刷新旧计划，也不声称它已经与新版上游语义一致。

这一边界继承现有 Setting 行为。当前不增加持久谱系、冲突检测或级联失效系统；必须在方案和测试中保留此限制，避免让“通过版本检查”被理解为“内容绝不会冲突”。

## 6. HTTP 与 CLI：两条新命令，复用现有读取

建议延续 Setting 的路径风格，用请求内显式章号定位 Beat；首次生成仍调用现有 advance。

### 6.1 请求与响应

两个新命令都要求客户端提交自己看到的版本，不允许服务端替客户端补成最新版本。

```ts
// POST /api/works/:workId/artifacts/beat/approve
type BeatApproveRequest = {
  chapter: number              // 本期入口仅接受 1
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatReviewDraft
}

// POST /api/works/:workId/artifacts/beat/regenerate
type BeatRegenerateRequest = {
  chapter: number              // 本期入口仅接受 1
  expectedArtifactId: string
  expectedHeadVersion: number
  content: BeatEditDraft       // 当前页，而不是服务端初稿
  instructions: string         // 必须存在，允许 ''
}
```

请求对象严格校验未知字段。完整性问题返回字段路径；外来 ID 即使出现在暂时不完整的再生草稿中也拒绝。初次生成通过 `POST /api/works/:workId/advance` 发起，不能用 regenerate 创建缺失目标。

通过和再生成功均为 200 + `{ artifact, command, workflow, telemetry }`。`artifact` 分别是完整 approved／pending Beat；再生版本为请求基线 +1、Artifact ID 为新值，通过则 id/version 不变。`command` 为第 6.5 节的诊断信息，`workflow` 从现有读模型投影，telemetry 只含本命令实际 LLM 调用；通过不伪造模型记录。GET 继续使用 WorkView，不新建章节详情服务或异步 job 查询接口。

客户端校验 schema 之外，还要对照请求检查 workId、kind、chapter、ID／版本关系及状态。错误作品、错误章节、错误版本、非法内容的 200 响应同样按结果未知处理。

首次生成保留 advance 的既有 discriminated outcome，新增可选 `beatCommand` 诊断：仅本次实际尝试执行 Beat 时出现，写入结果只描述这个 Step。`awaiting-approval`／`complete` 不伪造新生成；其他 Step 的 outcome 维持兼容。通用 advance 可能已写前一步后再失败，不能把 Beat 的 `not-committed` 扩大解释为整次 advance 零写入。

### 6.2 错误与调用预算

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

提交前 catch 与提交／响应阶段分开。append/finalize 返回后已发生写入，即使日志、DTO 校验或 JSON 序列化失败，也不得回落到 not-committed；返回安全的 unknown 或让客户端按传输未知处理。诊断记录失败不反向改变产物。执行期观察必须契约合法、operation／已验证目标与请求基线匹配；缺元数据、冲突字段或非法成功响应不能作为“未写入”证明。唯一例外是第 6.5 节严格定义的请求边界拒绝分支，它证明本次调用尚未进入业务操作，不要求解析根本不存在的 body 基线；仍不能消除旧 unknown。

通过请求预算为 30 秒、确认 GET 10 秒、整份再生 920 秒；Web 通用 advance 增加与当前 CLI 一致的 1,820 秒完整 deadline，覆盖现有最多两个连续模型调用与传输余量。首次 Beat 也经这一有界调用，不凭旧 GET 推断永远只跑一步而缩短通用预算。CLI 显式 override 仍覆盖请求预算；多步定义变化时重新核对上限。这是调用方最长等待，不是模型典型耗时承诺。[现有运行预算](../../apps/server/src/steps/llm.ts)、[CLI 超时](../../apps/cli/src/client.ts)

deadline 要覆盖响应体读取，并主动结束等待；AbortController 不等于服务端撤销。重新生成 `maxRetries:0`，不自动 LLM repair、不自动补卡、不因断网自动再生成；恢复均由用户发起。

首次 advance 的 fetch 或 body 悬挂时，到期必须结束本地 generating 并自动有界回读一次：已有 Beat pending 则展示现状等待作者；没有目标则保留已通过 Setting，显示结果未确认／手动核对入口，不自动再发 POST。迟到响应由请求序号和已观察 head 隔离；同样不承诺取消服务端执行。

### 6.3 结果确认：通过可匹配，再生不能猜

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

### 6.4 CLI 对齐

新增 `approve-beat <workId> --file request.json` 与 `regenerate-beat <workId> --file request.json`，沿用当前 CLI 的 --file 风格。文件包含完整共享请求，不在 CLI 内偷偷取最新版本覆盖文件内容；新增 `get <workId> --kind beat --chapter 1` 精确读取，不能只按 kind 取第一条。章节级 kind 必须指定合法章号，作品级 kind 禁止 --chapter；读取允许既有正整数章地址，写入仍只开放第一章。

联网前校验文件，非法 JSON／参数错误保留安全字段路径；成功后校验完整响应。通过未知时按同一匹配规则回读；再生未知时报告已知服务器 head 与恢复建议、非零退出，不声称成功，也不自动覆盖用户请求文件。专用命令成功 stdout 一个 JSON、exit 0；拒绝／失败／未知 stderr 一个错误 JSON、exit 1，不把诊断混入正常产物内容。既有 advance 兼容 HTTP 200 failed 的退出语义，帮助中明确必须检查 `kind`；smoke 遇 failed 必须非零退出。

新增只读 `a4n config`，复用并校验现有 `/api/config {demo}`，不暴露 key、baseURL 或完整运行配置。smoke 的结果和部分失败诊断显式携带 executionMode，不能由 telemetry 为空判断 fake：live 的 approve 同样不调用模型。

fake smoke 扩到第一章 pending → 人工改动 → 通过 → 回读，明确断言 `beat-approved` 且没有 prose。另测整份再生，不能靠通用 approve 绕过完整提交。smoke 是合成探针的显式批量授权，不代表一般 Agent 可以因为 allowedActions 有 approve 就自动替作者把关。

### 6.5 Agent 视角：结果、恢复与观测契约

Agent 不应靠读日志正文猜操作是否成功。响应先给业务结果，再给安全的诊断线索；日志只作辅助，不是持久回执。

#### 命令观察信息

新增共享 `BeatCommandObservation` 运行时 schema，HTTP、CLI 与日志使用同一字段定义。不要把字段只写进 TypeScript 类型而跳过真实响应校验。

| 字段 | 含义与边界 |
|---|---|
| `kind` | 判别联合 `request-rejected / execution-result`；前者仅为尚未进入业务操作的严格请求边界拒绝，后者覆盖目标／基线已解析的命令执行观察 |
| `requestId` | 服务端为每个 HTTP attempt 生成 UUID，复用现有路由关联 ID；向 Step、LLM、命令日志及响应贯通。不是幂等键，重试得到新 ID |
| `operation` | `generate-beat / regenerate-beat / approve-beat`；首次 advance 中仅描述实际执行的 Beat Step |
| `target` | 已验证的 `{workId, kind:'beat', chapter:1}`；路径／body 尚未通过结构校验时不伪造完整 target |
| `expectedHead` | 通过／再生为请求声明的 `{artifactId,version}`，并标明这不是服务器最新 head；首次生成固定 null（预期不存在）。非法请求尚无法解析时省略 |
| `writeOutcome` | `committed / not-committed / unknown`，严格遵守第 6.2 节，不由 LLM 的 ok 推导 |
| `failureStage` | 失败时为 `request / precondition / input / model / output / commit / response`，成功省略；这是命令失败阶段，不是错误原文 |
| `attemptIds` | 仅本命令实际发起的 LLM 尝试；通过、锁冲突、前置校验拒绝为空。不得拿同作品正在执行请求的 attempt 填补 |
| `executionMode`、`latencyMs` | 运行模式 `demo / live` 与本命令用时；approve 在 live 模式也可以没有 LLM 调用 |
| `resultHead` | 已知成功写入时记录 `{artifactId,version,humanStatus}`，与返回 artifact 一致；不放内容。未知响应不虚构结果 |

有效成功使用 execution-result，必须含全部目标／基线／结果信息。该分支的有效失败也必须含已解析的目标／基线；不允许靠客户端填充缺失字段通过校验。

`request-rejected` 是窄的例外：仅允许在 HTTP 请求解析／校验边界、任何业务命令或模型调用前构造，code 限 `bad-json / invalid-input / payload-too-large / unsupported-chapter`，并校验对应 400／413；固定 `failureStage:'request'`、`writeOutcome:'not-committed'`、`attemptIds:[]`，含有效 requestId、operation、executionMode、latencyMs，省略 target/expectedHead/resultHead，不回显未验证输入。客户端把当前 HTTP promise 与调用的方法／路径绑定，并严格验证该联合分支与预期 operation 后，可判定**本次请求**未提交；无旧 unknown 时保留内容并允许缩减／修正请求。它不是“缺字段也相信 not-committed”的通用后门，任何未分类 5xx、坏 envelope、错误 operation 或执行期缺字段仍为未知；任何分支都不清除更早 unknown。首次 advance 解析前没有实际 Beat 尝试，不伪造此 Beat 诊断。

错误基础 `code/message/retryable` 保留，单个 `attemptId` 仅在确有本命令对应尝试时给出，完整关联以 `attemptIds` 为准。

专用成功的 `workflow` 是当前 WorkView 的 `workflowState / nextStepId / allowedActions` 投影，由同一读模型构造；出错时若成功回读也可返回该投影，否则省略。当前 WorkView 没有 pendingGate，不把 PipelineState 的同名字段误写成现成 WorkView 字段；Agent 通过当前 workflowState 与目标 Beat 的 pending 状态识别作者关卡。该投影是服务器观察到的当前状态，不是永不变化的许可或作者授权。返回 pending／`awaiting-beat-review` 就是在等作者；Agent 不应循环 advance 或自行 approve 来“完成任务”。

`telemetry` 仍记录 LLM 层事实：`ok:true` 只表示模型输出通过该层校验。模型成功后上游改变，会同时得到 LLM ok 和命令 `not-committed + failureStage:'commit' + code:'upstream-changed'`。两者共享 requestId/attemptId，可清楚定位失败在写入而非生成。提交前拒绝没有模型调用，就不生成假的 LLM 成败记录。

#### 机器可执行的恢复信息

Web 和 CLI 复用 `beat-submission.ts` 的纯恢复判断：输入为原始 baseline Artifact（含已删除旧卡的 ID 集）、冻结请求、此前 unknown、合法命令响应以及一次回读的 WorkView，输出 `resolution` 与 `nextActions`。不在 Agent 提示词里再抄一份状态机，也不让服务端猜客户端是否有更早的未知请求。

`resolution` 为 `confirmed / rejected / uncertain / conflict`；`nextActions` 为固定枚举的有序数组：`edit-input / read-work / retry-frozen-request / load-server-version / inspect-diagnostics / check-model-config / await-author`。这些是基于现有事实的建议，不是自动执行授权；`retryable:true` 仅表示原因可能恢复，不等于立即安全重放。版本冲突、旧 unknown 等事实优先于某一次错误的 retryable。

CLI 在失败 JSON 中保留原始安全 `code` 为 `causeCode`、operation、冻结请求的目标／基线、command（若响应合法），并附 `resolution/nextActions`。有回读时输出 `observedHead`：对象表示已读到 head，null 表示成功 GET 确认此地址不存在，省略表示没有可靠读回；404 work-not-found 用独立 code 表示，不能伪装成正常作品缺一章。CLI 的本地上下文和服务端 command 分开校验，不能用本地补齐字段使坏响应看似可信。

恢复矩阵以第 6.3 节为准：确定性通过回读匹配可 confirmed／exit 0；未知再生即便看见新 pending，也仍 conflict／exit 1，需要作者明确选择载入。旧未知不会被当前 not-committed、空日志或锁已释放消除。没有收到 requestId 时明示缺失，通过 workId 回读，不能生成一个假的服务端关联 ID。

例如以下是错误结果的**字段摘录**，不是完整响应样例：

```json
{
  "code": "upstream-changed",
  "command": {
    "operation": "regenerate-beat",
    "writeOutcome": "not-committed",
    "failureStage": "commit",
    "executionMode": "live"
  },
  "resolution": "rejected",
  "nextActions": ["read-work", "inspect-diagnostics"]
}
```

这里 rejected 只在没有更早未知写入时成立；完整输出还应含 requestId、目标、基线和实际 attemptIds。Agent 读完可以明确区分“生成结果未采用”与“可以直接重试”。

#### 有界诊断查询，不新建观测平台

扩展现有 `GET /api/works/:id/telemetry` 与 `a4n logs <workId>`，新增可选 `requestId / attemptId` 查询条件及对应 CLI 参数；保留 `workId/telemetry`，增加 `commands` 与 `window`。未知／非法查询字段明确拒绝，成功与失败均经共享响应 schema 解码，CLI 不再仅作类型断言。

现有 LLM 账本容量为**进程内全局 1,000 条，不是每作品 1,000 条**。命令摘要用同样全局有界的独立 1,000 条环形缓冲；不记录命令 body。`window` 为两类缓冲分别返回 `capacity/oldestSeq/latestSeq/truncated`，并给出随机 `processInstanceId` 与 `retention:'process-memory'`；truncated 表示该进程该缓冲已发生淘汰，不代表过滤查询本来就有命中。空缓冲 seq 为 null，查询结果为空不能证明未执行；重启清空且 instanceId 改变，旧作品也可能直接 404。

每次响应的 LLM 内联数据按 requestId／本次 attemptIds 精确收集，不能继续仅靠 workId 加前后 cursor 筛选，避免锁冲突响应混入另一请求的记录。环形缓冲被淘汰不应导致本次响应丢遥测：在命令作用域内保留有界的本次记录副本。首次多步 advance 的内联 telemetry 保持完整本次请求，beatCommand.attemptIds 只关联 Beat；其他 Step 的业务诊断本票不扩展。

命令结束摘要含上述安全字段、时间、稳定结果 code；busy 只是一时锁状态，不是任务完成凭据。HTTP 丢失后的日志可以解释“发生过什么”，但本票不靠日志自动确认随机再生归属，也不因缺日志而重新调用模型。记录／查询故障应降级为诊断不可用，不改变真实写入结果。

## 7. 创作界面：保留旧内容，只有确认结果才替换

建议沿用 Setting 的预览／编辑模式与确认弹窗，新增章纲独立 reducer，不先抽整套通用产物编辑器。

### 7.1 状态与交互

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

### 7.2 离开与可访问性

站内离开使用现有 ConfirmDialog，真实刷新使用浏览器原生提醒，不承诺能自定义刷新弹窗。

有草稿修改、未提交意见或在途／未知命令时，站内提示当前状态及“离开会放弃本页内容；已发送的请求可能继续处理”。默认“继续查看／编辑”，只有明确确认才执行导航一次；Esc、遮罩和关闭均取消离开。

复用焦点约束、默认取消、焦点恢复和亮暗主题；字段错误关联到输入。beforeunload 的安装和清理覆盖 dirty／在途状态，遵守浏览器可能不展示原生提示的限制。[ConfirmDialog](../../apps/web/src/ConfirmDialog.tsx)

### 7.3 服务端读模型与前后衔接

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

## 8. 代码落点与改动边界

按已存在的模块扩展，以下是计划入口，不是已创建的实现文件。

| 范围 | 新增／修改计划 |
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

### 8.1 安全诊断：有足够信息，不输出作者内容

R3 的修订范围必须包含共享 callLlm 的继承路径，不能仅承诺“新增 Beat 日志不含内容”。移除当前 `textTail`、`causeMessage` 和原始 provider `err.message` 的默认日志／公开错误传播；截短不等于脱敏。所有调用该 helper 的既有 Step 都受影响，需要兼容回归。

采用白名单诊断：requestId、workId、chapter、stepId、attemptId、executionMode、受控 provider/model 标识、时间／时延、token 用量、长度、hash、稳定错误类别及版本身份。provider/model 仅取通过白名单验证的运行配置标识，不记录 baseURL、请求头、凭据或任意供应商响应体。

LLM 安全分类至少区分 `configuration / network / timeout / context-limit / output-truncated / output-schema / unknown`，条件写入失败另按命令 code 与 failureStage 表达。分类优先依据 SDK 类型、结构化 status/reason 和本地校验，不靠把原始 message 返回给调用者；无法可靠分类时用 unknown + 稳定消息，不能伪造精确原因。模型错误 detail 可以保留白名单状态码、已知 finishReason；其余值安全归一化。

内容校验只给安全 issue code、预定义字段路径和可选 limit／actualLength。路径只允许 schema 已知字段与有界数组下标，未知对象键不回显；不直接透传可能含输入值、动态键或作者文字的 Zod issues/message。Agent 可以据 `writingPlan[2].content` 等路径修正请求，或据 output-schema 与 attemptId 查模型失败，不需要看到原始失败文本。

上述白名单覆盖 stdout、HTTP／CLI 错误、LLM 遥测和命令摘要。日志记录器必须以非抛出或隔离失败方式调用，不能在 append 成功后因诊断错误把命令误报为明确未写入。批准请求不记录 content，再生不记录 instructions；仅 Agent 合法请求的正常产物读取／成功响应返回内容，不把禁止日志泄露误解为禁止返回产物。

## 9. TDD 计划：每个切片先失败、再实现、再核对方案

建议按可观察行为做纵向切片，不先批量写完所有测试或所有实现。以下均为待执行计划，本次没有运行功能测试或真实模型。

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

实现后先跑定向测试，再跑仓库门禁；这些命令不是本次已取得的结果。

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

## 10. 评审重点与知识回写

复审覆盖产品、前端、后端、运维与 Agent 五个视角，重点检查下列技术取舍，不扩大已确认的产品范围。

| 待评审决定 | 本稿推荐 | 主要代价／替代方案 |
|---|---|---|
| 再生版本 | 成功追加 pending，人工通过同版本定稿；跨再生全新卡 ID | 暂不提供历史 UI；覆盖原版本虽简单但削弱现有版本冲突语义 |
| 不完整草稿再生 | 有界 EditDraft 允许暂时空字段 | 比直接复用通过 schema 多一个派生边界，但避免妨碍作者修复草稿 |
| 未知再生结果 | 保守冻结／回读，显式载入服务器版本 | 少数网络故障多一步确认；若必须自动确认归属，再评估 commandId/回执，不预建持久任务框架 |
| 技术规模 | 最小章地址扩展、票内再生命令、现有内存 Store | 不解决多章循环、跨进程锁、长期语义冲突和持久化；分别交后续票 |
| Agent 可观测性 | 稳定命令结果＋精确遥测归属＋共用恢复建议，复用 logs 与 WorkView | 增加少量共享契约和有界诊断记录；不增加原始内容日志、持久回执或自动替作者通过 |

复审检查 HTTP 错误映射、版本／身份不变量、预算合理性、TDD 是否覆盖每条 AC，以及旧 Outline/Setting 回归计划。正式裁决见评审记录；方案通过不等同于代码评审，预算校准和功能验证仍须在实现时完成。

2026-09-06 初稿完成自检后，正式综合评审提出 R1–R4；本次 R1 修订补充了写入结果分类、UUID 身份、共享安全诊断和首次 advance deadline，并按作者要求补齐 Agent 的按章读取、模式识别、调用归属、恢复协议与有界诊断窗口。原稿及发现保留于评审记录，不改写为“初稿已通过”；当前复审裁决与固定 hash 以[评审记录](./005-beat-technical-review.md)为准。尚未执行实现测试或模型验证。

### 10.1 评审后录入，落地后核实

Wiki 保存工程理由，schema/contracts 保存数据与协议定义，不能让本方案成为第四套长期契约。

| 来源 | 计划维护内容 | 时机 |
|---|---|---|
| Wiki 005（待新建） | 按 Wiki README 固定模板录入修订方案、范围、TDD、后续入口；ticket_state 标 planned/active，不冒充 done | 技术评审修订后、实现前 |
| `docs/schema.md` | Beat 内容、身份、版本、命令协议；未实现时明确设计状态，落地后关联可执行定义 | 方案通过后；落地再核实 |
| `CONTEXT.md` | 将章纲的旧“场景／冲突／钩子”说明更新为已确认四部分，保留 beat 与 segment 的区别 | 方案收口时 |
| #5 issue | 补齐后续访谈已确认项和正式方案入口；不提前勾 AC／关闭 | 方案收口时 |
| Wiki 004 / 013 | 保留原始设计，记录 #5 扩展生产终点的变化事件和下一跳；不用新设计改写历史 | 方案入口建立及代码落地时，按事实分别标注 |
| Wiki 014／运行 skill | 记录关联方式从 cursor 筛选到 requestId、增加命令层结果；更新 logs 保留边界和安全排障，替换读取原始 causeMessage 的旧建议，保留变化理由 | 方案录入时标注 planned；代码验证后更新当前可用 HOW |
| contract-governance / handoff | 将旧排期替换为已确认的 #5 → #22 → #19 → #9 → #6，保留调整原因 | 获准知识回写时；不扩大为 #19 实施 |
| README 中英文 / CLI / 运行说明 | 更新实际可用操作、终点和验证命令；不宣传未实现正文 | 代码验证后 |
| 调研笔记与本草案 | 调研保留当时“待确认”历史；本稿收敛为正式方案和评审记录入口 | 方案正式录入时 |

知识归属不变，变化事件按 Wiki skill 记录触发证据、原假设、决定、影响、上下文处理。删除或改变 Human 决定仍需确认；机械更新索引与当前入口不覆盖原始理由。

### 10.2 开工与交付门禁

当前获得方案修订和增加 Agent 视角的授权，不据此开始业务实现、发布 Wiki、修改 GitHub 或提交推送。

初轮评审核对时，#5 为 OPEN、ready-for-agent、Project Backlog、无 assignee；原生前置 #4/#13 均 CLOSED。这是初轮快照，开工须再次验证。当前 tracked 文件保持干净，本轮未跟踪文件是方案／评审／原稿快照及已有调研笔记，未修改业务代码。

正式开工前重新回读 live issue、依赖、仓库状态及[完成清单 C1](../agents/ticket-completion-checklist.md)，确认当前票交付方式。默认建议新建 `codex/` 前缀分支并走 PR，但 commit、push、PR、merge 授权分别记录，不沿用 #13 的发布方式或历史批准。

技术方案通过后才进入 C2/TDD。代码落地后按 C3–C7 完成检查、知识回写、冻结候选的独立 Standards/Spec 评审、修复回归和 attestation，再按实际授权发布；方案评审或本文自检都不能替代这些步骤。

## 下一步

修订稿已完成复审，下一步正式录入 Wiki，再按开工门禁进入 TDD；不在改方案阶段顺手实现 #5 或 #22。

| 行动 | 负责人 | 截止时间 |
|---|---|---|
| 审阅第 10 节关键技术取舍，检查是否偏离产品基线 | 作者／产品负责人 + 技术评审 Agent | 方案批准前 |
| R1–R4、A1 与 Agent 契约已完成方案复审；正式录入时保持裁决、证据及版本可追溯 | 独立技术 reviewer + 当前协作 Agent | Wiki 正式录入时核对 |
| 录入 Wiki、同步 schema/issue/领域词与受影响排期 | 实现负责人／Agent | 首个 TDD 实现切片前 |
| 确认本票交付方式并按 S1–S6 开发、逐片核对方案 | 作者 + 实现 Agent | 开工时确认；代码评审前完成 |
| 完成代码评审、文档核实与发布门禁 | 独立评审 Agent + 实现负责人 | commit/push/PR/merge 对应门禁前 |
