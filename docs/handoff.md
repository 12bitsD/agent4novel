# Handoff — agent4novel 会话接力快照

> 用途：context compaction / 新会话接力。最后更新：2026-09-29。#5 已关闭；当前仅交付 #22 第一章正文，工作区实现已接六步至 `prose-approved`，完整本地门禁及真实正文节点验收已通过，发布前审核与远端交付状态分别见Wiki022和live issue/PR。最新正文自动保存与通过后编辑决定见 [Wiki 022](./wiki/022-prose-generation-review.md)。#28/#29 已登记为后续扩展，不阻塞首章。
> 分工：词汇表看 CONTEXT.md；数据模型看 docs/schema.md；每票工程上下文看 docs/wiki/NNN-*.md；完成闸门看 docs/agents/ticket-completion-checklist.md；本文件只管「项目现在到哪了、下一步是什么、哪些决策不能丢」。消费或更新 Wiki 时使用 `.claude/skills/agent4novel-wiki/SKILL.md`。

## Primary Request and Intent

本地、单用户、开源 web 工具：帮不会写作的作者把一个脑洞，经人机协作（作者把方向、agent 填 gap、每个环节有关卡），写成约 50 万字的中文网文。逐章推进，章纲/正文两个关卡。

## 开发流程（用户的硬规矩，每票都走）

既有硬规则全部保留：每票 grill 对齐、实现前给执行计划、建立 Wiki 上下文、TDD 红绿切片、回写代码落点与变化原因、三轮自校准、Standards/Spec 双轴 review、修复后再交付。开始每票时完整读取并按 [Ticket 完成审核清单](./agents/ticket-completion-checklist.md) 执行；它是提交、直推或 PR/merge、远端回读顺序的唯一权威来源，逐票证据写入数字 Wiki、GitHub issue 与可回读远端状态。
回复用中文；wiki/文档是 agent 消费的；需要 Human 裁决的决策类问题提供 (a)/(b)/(c) 选项并最小化提问。

## 已完成

- **#2** 脚手架 + 存储 + pipeline 骨架 + 书架（wiki 002 ✅）
- **#3a** 统一入口（启动界面：输入+上传 txt/md/docx/pdf）+ 创作界面 idea 状态（wiki 003）
- **#3b / issue #10** 预处理 RealStep + outline/setting 形态对齐（wiki 010 ✅；其 interview 机制已被 #3c 移除）
- **#3c / issue #11** 预处理重构（wiki 011 ✅）：caption（提炼稿，落库即 approved）→ creative（单次 generateObject 直出 N 个创意稿，gateAfter = 创意海报比较视图）；保存/选定两命令；interview 机制整体移除；全应用多巴胺设计系统（亮暗双主题）
- **#4** 大纲生成（wiki 004 ✅）：**推翻「分章每章一句话」**，大纲 = 弧线（冲突生命周期：标题/核心冲突/冲突发展/矛盾解决）+ 剧情点（标题/概要/落点）两层，与章节解耦；选定创意稿后 web 自动续跑 advance；保存 = pending + 通用 /approve 通过；读模型 5 态（selected 移除，加 awaiting-outline-review/outline-approved）
- **#14** Agent 可用性基建（wiki 014 ✅）：`apps/cli` 的作品命令、`bin/a4n` 纯 JSON 输出与 smoke 探针；select/save-outline 自动回填 headVersion。LLM 遥测进程内账本，advance 内联 telemetry、logs 回看；systemHash 让 prompt 版本可追。历史 outline 截断促使上限从 8000 调至 16000，并加入 SKILL 篇幅纪律；这不保证所有模型请求成功。当前命令与独立实验入口见 [Wiki 014](./wiki/014-agent-cli-telemetry.md)。
- **#16** 可配置 ModelRuntime + LongCat provider（[wiki 016](./wiki/016-model-runtime-provider-config.md) ✅）：RealStep 内统一 provider 路由、server-only 本地配置与请求超时；接入 LongCat OpenAI-compatible Chat Completions。2026-08-29 已完成独立生产 Step 真机验证，并留下完整 CLI smoke 的失败与重入结论；所有 work ID 都来自已结束的内存进程，当前不可继续使用，证据边界只看 wiki 016 与 LongCat research。
- **#13** 完整设定（[Wiki 013](./wiki/013-setting-generation-review.md)）：大纲通过后一次生成；六字段通用卡片、有限 Markdown、页内编辑、专用命令同 id/version 原子通过，不追加 V2。Store 读写快照隔离、生成提交条件、Web 未知结果恢复和 CLI 完整请求已落地。本票原末端 `setting-approved` 已由 #5 延伸至 `beat-approved`，具体交付证据只看本票 Wiki 和完成评论。

- **#25** CLI 帮助零副作用与严格参数：顶级/子命令 `--help`、`-h` 在 I/O 前返回，非法语法返回安全 usage。保留业务结果与人工关卡；上下文及验收见 [Wiki 025](./wiki/025-cli-command-safety.md)。
- **#5** 第一章章纲：编辑、整份再生、同版本通过及请求诊断已交付，issue 已关闭；历史方案和完成证据见 [Wiki 005](./wiki/005-beat-generation-review.md)。

## 当前实施：#22 第一章正文

- 第一章章纲与正文仍是两个 Step／关卡。正文消费作者最终通过的 Beat 和完整 Setting；模型初稿与整章重写结果均 pending，重写使用当前编辑全文及意见。
- 用户在2026-09-29明确替换旧的“正文草稿仅页面内存、通过后只读”默认：待把关正文自动保存到服务端，保存成功后刷新恢复；通过后默认阅读，进入编辑后自动保存且保持 approved。正文空草稿可保存 pending，但空白不能通过或保存为 approved。Setting／Beat 的既有只读边界不变。
- save 基线绑定 id/version/humanStatus，原子追加新ID／版本并保留状态；通过写入实际提交全文并保留id/version/createdAt。审批前迟到的 pending autosave不得覆盖刚通过的全文。并发失败、未知写入和精确回读由共享Prose恢复契约处理。
- Web 的“通过章纲并生成正文”是显式动作；页面打开、刷新和返回只读状态，不隐式生成。正文完成后仍止于第一章。书架返回和稳定作品URL由本轮Web集成处理，是否已验收看Wiki022证据。
- 当前只用InMemoryStore：浏览器刷新恢复依赖同一server进程；重启持久化归#9。没有Wiki搜索、tool loop、档案候选或联合通过；它们分别归#28/#29。

## 关键架构与契约（不能丢）

- **2026-09-13 接回**：Caption 采用 R10 A SP，提炼稿在理解素材后作开发判断并提出具体剧情建议；选定证据与限制由 [Wiki 011](./wiki/011-caption-creative-directions.md) 保存。`run-step` 可独立运行 caption/creative/outline/setting/beat#1，复用生产输入、输出 schema、ID 和预算；要求完整 monorepo 与真实 provider，由本地 server worker 执行，不写作品。CLI HOW 见 [Wiki 014](./wiki/014-agent-cli-telemetry.md#单节点实验-run-step)。主仓库 344 测、四包 typecheck 和构建通过，记录见 [本轮计划](./experiments/caption-adoption-2026-09-13/plan.md#验证记录)；没有新增真实模型质量证据。已运行 server 缓存生产 SP，需新进程读取更新。
- **生成参数**：LongCat 默认 thinking disabled、temperature 0.9、topP 0.95，生产链和独立节点共用 ModelRuntime；单节点 config-file 可设置模型与参数，显式 CLI flag 逐字段优先。topK 明确拒绝，telemetry 记录实际公开参数。完整覆盖、provider 和 timeout 契约只看 [Wiki 016](./wiki/016-model-runtime-provider-config.md#生成参数与单节点覆盖)。
- **#5 继承边界**：本页编辑、整份再生、同版本通过、UUID身份与请求关联诊断继续保留；本轮仅把明确的“通过并生成正文”按钮接到下一Step，不开放已通过章纲回改。Beat与Prose契约分别见 [schema](./schema.md)。
- **workflow 骨架 + 步骤内 agent**；Step 零感知 kind，输出 `{content}` 装整个 JSON；kind = 节点名；pipeline 管解析/组装/持久化，是深模块不是 swap seam。
- **两个真 seam**：store（InMemoryStore / #9 做 SQLiteStore）、step（FakeStep / RealStep）。
- **模型路由边界**：ModelRuntime 位于 RealStep 内部，不是第三个 Pipeline 注入 seam；已注册 provider 通过模型 ID 切换，新增 provider 需要对应 adapter、registry 注册与 key 契约。完整 HOW 只看 [wiki 016](./wiki/016-model-runtime-provider-config.md)。
- **6 节点 kind**：caption/creative/outline/setting 每作品一份；beat/prose 每作品×每章，生产目前只接beat#1/prose#1。Artifact.content: JsonValue；humanStatus: pending | approved；appendArtifact版本+1。Setting／Beat／Prose专用finalize同版本原子定稿，通用setStatus均拒绝。Prose saveArtifact追加版本并保留匹配基线状态，不改变其他产物保存策略。
- **creative 保存语义**（#3c 起，取代「人工保存即通过」）：`PUT /artifacts/creative` = saveCreativeDraft，存全部方向、永远 pending、带 `expectedHeadVersion` 乐观锁；`POST /artifacts/creative/select` = selectCreativeDirection，落**单方向**新版本 + approved。`directionId` 由 server 注入（`${workId}-dir-N`），web 永不生成、编辑不可改。
- **pipeline（#3c）**：definition 加 `consumes`（只指前序 outputKind，启动校验唯一/禁环）；`PipelineInput = {workId, seed, upstream}`，upstream 读**最新版且必须 approved**；`advance()` 链式推进到下一个关卡（上限 = definition 长度），per-work 互斥锁（finally 释放，冲突 → 409 `advance-in-progress`），返回可穷举 outcome `advanced | awaiting-approval | complete | failed(stepId, code, retryable, attemptId)`；interview 机制零残留。
- **读模型**：`GET /works/:id` 同快照附带 `workflowState`、`nextStepId` 与 `allowedActions`；生产新增awaiting-prose-review/prose-approved。pending正文动作save-draft/approve/regenerate，approved保留save-draft；完成章数只计approved正文head。outline-approved/setting-approved/beat-approved保留给旧定义。`generating`是Web本地瞬态；按pendingGate.kind分派，Web不重建关卡状态机。
- **LLM 调用**：`steps/llm-call.ts`统一generateObject + zod + maxOutputTokens（outline/setting/prose 16000，其余默认8000）+ 可配置超时 + 类型化错误。advance业务失败可为HTTP200 + failed outcome，不能只按HTTP成功判断。原始素材>100K字符截断，结构化上游不静默截断；Prose实际system+prompt超过400000字符在模型前拒绝。Setting/Beat/Prose显式SDK maxRetries=0；Pipeline不自动重试。ModelRuntime唯一HOW见 [Wiki 016](./wiki/016-model-runtime-provider-config.md)。
- **CLI**：`./apps/cli/bin/a4n <cmd>`（stdout纯JSON）或`pnpm -s cli`；仅select/save-outline自动回填版本。Prose支持get、save-prose、approve-prose、regenerate-prose，文件显式绑定chapter/id/version，save另带expectedHumanStatus，重写另带instructions；结果未知最多回读一次，不自动重复写入。smoke延伸至正文生成、作者全文save、同版approve、精确回读prose-approved且无第二章；不是文学质量验收。独立run-step支持prose#1，不写作品。
- **错误**：HTTP 统一 `{code, retryable, attemptId?, message, issues?}`；Setting 字段错误 issues 只含 path/code/message。明确 4xx 均在写前，传输/5xx/非法成功响应可能已写入，必须按 Wiki 013 的冻结提交与回读规则处理。
- **web 设计系统**（#3c）：`apps/web/src/styles.css` 唯一全局面，亮暗双主题 CSS 变量（prefers-color-scheme + data-theme 预留）；多巴胺在点缀层（主 CTA 珊瑚 accent，方向 tab 珊瑚/紫/青轮转，chip 用强调色），底色纸白/墨黑极简；**内联样式只许 var(--*)，禁硬编码色值**。创意海报风险面抽纯函数 `web/src/creative-compare.ts`（tab↔directionId、保存全部、选定、409 保 dirty），vitest 覆盖，无浏览器 E2E。
- 栈：pnpm workspaces + TS E2E、Vite+React(5173 /api proxy)、Hono(8787)、zod、Vitest、tsx、AI SDK v7 + `@ai-sdk/deepseek` + `@ai-sdk/openai-compatible`。Setting 使用 mdast-util-from-markdown + 自有允许列表 React renderer；测试计数与最终命令证据只记本票 Wiki。

## 词汇红线（CONTEXT.md 单源）

- 关卡 Avoid「审核、**确认**」→ UI 用「通过」「待把关」。
- 大纲 = **弧线（冲突生命周期）+ 剧情点（情节步骤）两层，与章节解耦**（#4 grill 推翻「分章每章一句话」）；章纲 = 章标题、本章目标、有序写作安排、章末落点与承接，不强制场景／冲突／钩子字段，词义只看 CONTEXT。
- 预处理 = caption（提炼稿）→ creative（创意稿）两步；提炼稿 Avoid「摘要、解析结果」，创意稿 Avoid「brief、方案」。
- 创意稿的「一句话钩子」字段叫 `hook`；爽点清单叫 `payoffs`；「卖点」作领域词时对应这两者，不再是独立数组。

## 踩坑记录

- **门禁命令不许用 grep 截断 exit code**（slice 4 曾因此带错提交，amend 补修）。
- zod 联合类型推断会带 `?: undefined` 成员，`undefined` 不是 JsonValue → run 返回标注显式类型。
- `createProviderRegistry` 只负责解析 `provider:model`，不提供 HTTP 协议兼容性；每个 provider 的 wire protocol 必须由匹配的 adapter 承担，不能靠改 base URL 复用厂商专用 adapter。
- vi.mock 提升：mock 引用必须经 `vi.hoisted` 定义。
- contracts `export *` 双文件同名导出会被静默排除（inputStages 迁入 caption.ts 时踩过）→ 迁移期用显式 re-export。
- AI SDK 错误按 `err.name` 分类：NoObjectGeneratedError → 模型输出非法；TimeoutError/AbortError → 超时。**v7 真机实测错误名带 `AI_` 前缀**（`AI_NoObjectGeneratedError`)，匹配要用 `includes`。
- **outline 在 v4-flash 的失败有两种模式**（#14 遥测实证）：截断（finishReason=length 撞 8000 上限 → 已修 16000）与 schema 偏差（finishReason=stop 但不过校验，当时保留 causeMessage 辅助诊断；#5 已改为安全分类，不再输出原始错误）。修截断要同时收 prompt 篇幅（SKILL.md 纪律），否则拿质量换稳定。
- **pnpm run 横幅污染 stdout**（`> pkg script …` 两行）：Agent 管道消费会炸 JSON 解析。要么 `./apps/cli/bin/a4n` 直跑，要么 `pnpm -s cli`。
- heredoc/perl 里带反引号的模板字符串会被 shell 吃掉——改代码用 Edit 工具，别用 perl -pi。

## 遗留 / 已知限制

- LongCat 的 Responses 协议尚未接入；当前只对接其文档明确支持的 OpenAI-compatible Chat Completions。
- LongCat 文档未保证 JSON Schema structured output；当前走 `json_object` + 本地 zod 校验。历史三步证据见 Wiki 016，Setting 新样例见 Wiki 013；成功样例不是上游协议保证。
- `Work.config.model` 已作为内部覆盖接缝接入 Pipeline，但目前没有公开 UI/API；全局启动配置见 [wiki 016](./wiki/016-model-runtime-provider-config.md)。
- run-step 不持久化实验账本、不自动跑上游，也不校验所供content是否来自作品最新版；成功只证明通过生产schema，raw模型输出和reasoning不对外返回。Beat/Prose当前只第一章，CLI配置不会写回作品。
- 版本回看 UI（后悔药）没有入口，留 #6；重新生成（带补充想法）/渐进展示/分段提炼留 #12。
- #5 专属版本比较归 #20，正文后回流与章节重生归 #21；本期只允许通过前整份章纲再生。上条 #6/#12 是旧的通用优化分工，不覆盖这次已确认拆分。
- #5 已修复序号身份复用、共享原始错误日志和首次 Web advance 无限等待。2026-09-08 完整 production live smoke 两次卡在 Creative（截断／schema），不属于 Beat 成功证据；独立 Beat live 样例也是历史结果。本轮 fake/mock 回归通过；浏览器确认 pending 章纲及意见输入，原生刷新取消／确认受工具限制未验证，不能用 mounted 测试代替。证据边界统一见 Wiki 005。
- 「演示模式」是 UI 词非领域词，未进 CONTEXT.md。

## 下一步

CLI #25 已交付，无本票阻塞遗留；后续 CLI 结果/运行记录优化与真实模型质量验证仍是独立范围。当前能力、验证边界和完成记录统一从 [Wiki 025](./wiki/025-cli-command-safety.md) 进入。2026-09-13 Caption/CLI 的历史验证保留在 [当时计划](./experiments/caption-adoption-2026-09-13/plan.md#验证记录)。

#22 当前source为`feat/22-prose-review`，固定点`7a57d48aa50ced5c79ca4bc26cc9a424322f0a6f`，目标main。逐票按完成清单核对候选门禁、知识回写、独立评审与远端交付证据；不能因局部测试通过提前关闭issue。最新计划、变化事件与实际证据从 [Wiki 022](./wiki/022-prose-generation-review.md) 进入。旧#5分支／发布授权只属历史，不重做已关闭票。

当前先完成**#22第一章正文**；既有后续排期为#19契约治理 → #9 SQLite → #6后续章推进，每票开工前单独grill。#7/#8仍是原MVP交付项。#28设定检索＋Agent工具执行、#29作品Wiki＋档案演进已登记为后续扩展，不合并进首章、不作为#22前置。顺序不是新增硬依赖；旧排期变化保留在 [Wiki 005](./wiki/005-beat-generation-review.md#上下文演进)。

| 交付批次 | 可验收结果 | 后续衔接 |
|---|---|---|
| #22 第一章正文 | 自动保存刷新恢复、整章重写、全文通过、通过后编辑保持approved；失败保护；无第二章 | 通过完整门禁与远端回读后再进入下一票 |
| #19 契约治理 | 各产物与命令边界一致，非法内容在入口／读回被拒绝 | 覆盖已落地的Prose保存及错误语义 |
| #9 SQLite | 作品与产物跨实际重启可回读，继承条件写入和身份规则 | 与 #8 联验坏例的作品／章节关联及持久化 |
| #6 后续章 | 可重复的按章推进和作者关卡，遵守已确认的编辑／回流边界 | 收口 #7 配置与 skill 消费、#8 片段标记／备注／列表 |
| #28 / #29 扩展 | 分别完成设定查询工具循环、作品Wiki档案演进；当前未实现 | 每票单独对齐接入范围；#29接入时正文与档案联合通过 |

MVP 的 WHAT 与当前排期以 [父票 #1](https://github.com/12bitsD/agent4novel/issues/1) 为入口，每票按各自 AC 和原生依赖验收；本表只作接手导航，不缩减 MVP、不新建依赖或承诺日期，也不提前设计章节重生。

继续继承条件写入、快照隔离、冻结提交与回读对账，不能照搬Outline保存／通过流程。#29中的WorkWiki指本书设定库，初始Setting与Wiki应呈现一套正式事实；正文与新增／更新档案一同通过、失败不保存一半、重试不重复历史，均是该扩展接入时的目标。通过后正文编辑的异步Wiki更新也是#29待对齐项，#22不预建任务。#17独立设定修改、#18冲突澄清、#20章纲比较、#21章节重生继续后置；#12/#15既有边界不变。

## 环境

git: GitHub 12bitsD/agent4novel（public）。2026-09-05 允许联网环境中 `gh auth status` 与 issue 回读成功；受限网络中的“token invalid”不能单独证明凭据失效，操作前重新核验连接与认证。版本以当前 node/pnpm 命令为准，避免继承会话里的旧工具版本。端口 server 8787 / web 5173。`pnpm dev` 起两端；未配置可用 provider credential 时进入演示模式，secret 与模型配置只按 [.env.example](../.env.example) + [wiki 016](./wiki/016-model-runtime-provider-config.md) 管理。Agent 执行 pnpm 可设置 `COREPACK_ENABLE_AUTO_PIN=0` 避免工具自动改写 packageManager；不得把工具副作用当成票内改动提交。
