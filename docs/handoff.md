# Handoff — agent4novel 会话接力快照

> 用途：context compaction / 新会话接力。最后更新：2026-10-03。#1 及必需子票均已合并关闭，本机 MVP 已发布；当前远端状态和本次复审见 [Wiki001](./wiki/001-mvp-acceptance.md#2026-10-03-清点与复审)。复审发现的三项边界由 [Wiki043](./wiki/043-mvp-review-boundary-fixes.md) 修复；本轮先推送修复 PR，main 与闭票状态仍须远端核对。#28/#29 及长篇质量评估保持后置。
> 分工：词汇表看 CONTEXT.md；数据模型看 docs/schema.md；每票工程上下文看 docs/wiki/NNN-*.md；完成闸门看 docs/agents/ticket-completion-checklist.md；本文件只管「项目现在到哪了、下一步是什么、哪些决策不能丢」。消费或更新 Wiki 时使用 `.claude/skills/agent4novel-wiki/SKILL.md`。

## Primary Request and Intent

本地、单用户、开源 web 工具：帮不会写作的作者把一个脑洞，经人机协作（作者把方向、agent 填 gap、每个环节有关卡），写成约 50 万字的中文网文。逐章推进，章纲/正文两个关卡。

## 开发流程（用户的硬规矩，每票都走）

既有硬规则全部保留：每票 grill 对齐、实现前给执行计划、建立 Wiki 上下文、TDD 红绿切片、回写代码落点与变化原因、三轮自校准、Standards/Spec 双轴 review、修复后再交付。开始每票时完整读取并按 [Ticket 完成审核清单](./agents/ticket-completion-checklist.md) 执行；它是提交、直推或 PR/merge、远端回读顺序的唯一权威来源，逐票证据写入数字 Wiki、GitHub issue 与可回读远端状态。
回复用中文。2026-09-30 用户授权每个任务和实质 gap 内部完成三方案研究，普通工程选择自主收敛；只有产品范围、不可逆数据影响、新权限/费用或核心体验降低升级 Human。当前关键裁决已完成：本机 Docker + CI。完整决定见 [交付研究](./research/mvp-delivery-options.md)，不重复询问已定选择。

2026-10-03 用户要求对外输出遵循其个人 Work Wiki 的中性精确风：事实直陈，一句表达一件事，首次解释必要术语，明确已验证与未验证范围；删除情绪、修辞和没有具体信息的过渡语。个人 Work Wiki 的输出要求与 #29 的书级设定库属于不同用途。本次应用和清点结果见 [复审记录](./wiki/001-mvp-acceptance.md#2026-10-03-清点与复审)。

## 当前里程碑与验证边界

**本机 MVP 已发布，整体验证与边界从 [Wiki001](./wiki/001-mvp-acceptance.md) 进入。** 2026-10-03 回读 #1 及 #6/#19/#9/#33/#7/#8 均已关闭，对应 PR 均已合并；[PR40](https://github.com/12bitsD/agent4novel/pull/40) 对应源提交的 CI 与 [main CI](https://github.com/12bitsD/agent4novel/actions/runs/36727036119) 均成功。本次修复固定点为文档 PR42 合并后的 main `533631cdc28b1c09282845cdfcb6646cc8adbacf`。文档 #41 已关闭，源提交 quality/container CI 成功。关闭记录证明交付状态，本次新发现不因已关闭而视为无缺陷。

- **交付状态**：#22/PR #30、#6/[PR #32](https://github.com/12bitsD/agent4novel/pull/32)、#19/[PR #34](https://github.com/12bitsD/agent4novel/pull/34)、#9/[PR #36](https://github.com/12bitsD/agent4novel/pull/36) 已关闭/合并；#9终止记录见[完成评论](https://github.com/12bitsD/agent4novel/issues/9#issuecomment-5897744738)。#33/[PR37](https://github.com/12bitsD/agent4novel/pull/37)已关闭/合并，最终源提交两job[CI成功](https://github.com/12bitsD/agent4novel/actions/runs/36653441274)。
- **已验证基线**：#6 有 fake 多章、CLI/Web、独立真实 Beat2/Prose2 和本地门禁证据，见 [Wiki 006](./wiki/006-chapter-continuation.md)。真实节点使用合成上游，不是全书/全部节点真实模型验收，也不证明长篇质量。#19 的共享验证证据见其本票 Wiki；#9 的 SQLite、真实进程重启及关闭路径需看 Wiki 009 的实际结果，不沿用旧票测试。
- **当前存储边界**：生产启动使用 SQLite，恢复已提交的作品、产物版本、状态和输入引用；未保存页面编辑不恢复，遥测仍在进程内，不自动恢复模型调用。旧内存进程不自动迁移或清空。#33同源Web/API、非root镜像、两章卷恢复及实际CI已验证。#7已接入默认/节点覆盖、Prompt/Skill版本和操作快照，实际交付见PR38和本票issue；#8已接入手工坏例快照与回看，交付状态核对#8；长期记忆与Wiki工具仍后置。
- **复审与待修复项**：本次 815 项测试、类型检查和构建通过。新增定向复现发现配置草稿/未知请求在自动切章时丢失、起章前章版本条件未保持至生成、静态文件校验与读取路径解码不一致。触发条件与建议见 [复审记录](./wiki/001-mvp-acceptance.md#2026-10-03-清点与复审)，新修复候选由 [#43](https://github.com/12bitsD/agent4novel/issues/43) 和 Wiki043 记录；原复审是历史未修复快照，不能替代新红绿或 CI 证据。

## 已完成

- **#2** 脚手架 + 存储 + pipeline 骨架 + 书架（wiki 002 ✅）
- **#3a** 统一入口（启动界面：输入+上传 txt/md/docx/pdf）+ 创作界面 idea 状态（wiki 003）
- **#3b / issue #10** 预处理 RealStep + outline/setting 形态对齐（wiki 010 ✅；其 interview 机制已被 #3c 移除）
- **#3c / issue #11** 预处理重构（wiki 011 ✅）：caption（提炼稿，落库即 approved）→ creative（单次 generateObject 直出 N 个创意稿，gateAfter = 创意海报比较视图）；保存/选定两命令；interview 机制整体移除；全应用多巴胺设计系统（亮暗双主题）
- **#4** 大纲生成（wiki 004 ✅）：**推翻「分章每章一句话」**，大纲 = 弧线（冲突生命周期：标题/核心冲突/冲突发展/矛盾解决）+ 剧情点（标题/概要/落点）两层，与章节解耦；选定创意稿后 web 自动续跑 advance；保存 = pending + 通用 /approve 通过；读模型 5 态（selected 移除，加 awaiting-outline-review/outline-approved）
- **#14** Agent 可用性基建（wiki 014 ✅）：`apps/cli` 的作品命令、`bin/a4n` 纯 JSON 输出与 smoke 探针；select/save-outline 自动回填 headVersion。LLM 遥测进程内账本，advance 内联 telemetry、logs 回看；systemHash 让 prompt 版本可追。历史 outline 截断促使上限从 8000 调至 16000，并加入 SKILL 篇幅纪律；这不保证所有模型请求成功。当前命令与独立实验入口见 [Wiki 014](./wiki/014-agent-cli-telemetry.md)。
- **#16** 可配置 ModelRuntime + LongCat provider（[wiki 016](./wiki/016-model-runtime-provider-config.md) ✅）：RealStep 内统一 provider 路由、server-only 本地配置与请求超时；接入 LongCat OpenAI-compatible Chat Completions。2026-08-29 已完成独立生产 Step 真机验证，并留下完整 CLI smoke 的失败与重入结论；所有 work ID 都来自已结束的内存进程，当前不可继续使用，证据边界只看 wiki 016 与 LongCat research。
- **#13** 完整设定（[Wiki 013](./wiki/013-setting-generation-review.md)）：大纲通过后一次生成；六字段通用卡片、有限 Markdown、页内编辑、专用命令同 id/version 原子通过，不追加 V2。Store 读写快照隔离、生成提交条件、Web 未知结果恢复和 CLI 完整请求已落地。本票原末端 `setting-approved` 已由 #5/#22 延伸至首章正文，#6 再接入逐章循环；具体交付证据分别看各票 Wiki 和完成评论。

- **#25** CLI 帮助零副作用与严格参数：顶级/子命令 `--help`、`-h` 在 I/O 前返回，非法语法返回安全 usage。保留业务结果与人工关卡；上下文及验收见 [Wiki 025](./wiki/025-cli-command-safety.md)。
- **#5** 第一章章纲：编辑、整份再生、同版本通过及请求诊断已交付，issue 已关闭；历史方案和完成证据见 [Wiki 005](./wiki/005-beat-generation-review.md)。
- **#22** 第一章正文：生成、编辑自动保存、整章重写、同版本通过及通过后编辑保持 approved 已交付；issue 已关闭。当前正文语义及验证边界见 [Wiki 022](./wiki/022-prose-generation-review.md)。
- **#6** 后续章续写：显式开始下一章、上一章承接、章节目录与旧章正文编辑隔离已交付；见 [Wiki 006](./wiki/006-chapter-continuation.md)。
- **#19** 契约治理：六 kind/status 内容、Store、公开请求/响应及消费者验证已收敛；保留关卡、版本条件和未知结果恢复，见 [Wiki 019](./wiki/019-contract-governance.md)。
- **#9** SQLite持久化：全部产物版本、状态和输入引用；正常/强制退出后两章及待通过第三章恢复已验证，见 [Wiki 009](./wiki/009-sqlite-persistence.md)。

- **#7** 作者配置：PR38合并关闭，对应quality/container实际CI成功；默认/节点覆盖、文本文件版本、操作快照及HTTP/CLI/Web见[Wiki007](./wiki/007-author-agent-config.md)。

## 已交付首章的关键约束

本节保留 #22 交付时的边界；其中“只到第一章”已在 #6 扩展为手动逐章推进，“当前只用内存”由 #9 SQLite 接替。当前多章协议以 [Wiki 006](./wiki/006-chapter-continuation.md) 和 schema 为准，存储恢复见 [Wiki 009](./wiki/009-sqlite-persistence.md)，原首章审核证据不改写。

- 第一章章纲与正文仍是两个 Step／关卡。正文消费作者最终通过的 Beat 和完整 Setting；模型初稿与整章重写结果均 pending，重写使用当前编辑全文及意见。
- 用户在2026-09-29明确替换旧的“正文草稿仅页面内存、通过后只读”默认：待把关正文自动保存到服务端，保存成功后刷新恢复；通过后默认阅读，进入编辑后自动保存且保持 approved。正文空草稿可保存 pending，但空白不能通过或保存为 approved。Setting／Beat 的既有只读边界不变。
- save 基线绑定 id/version/humanStatus，原子追加新ID／版本并保留状态；通过写入实际提交全文并保留id/version/createdAt。审批前迟到的 pending autosave不得覆盖刚通过的全文。并发失败、未知写入和精确回读由共享Prose恢复契约处理。
- Web 的“通过章纲并生成正文”是显式动作；页面打开、刷新和返回只读状态，不隐式生成。正文完成后仍止于第一章。书架返回及稳定作品 URL `?work=<id>` 已验收，刷新恢复服务端最后成功保存的正文。
- 当前只用InMemoryStore：浏览器刷新恢复依赖同一server进程；重启持久化归#9。没有Wiki搜索、tool loop、档案候选或联合通过；它们分别归#28/#29。

## 关键架构与契约（不能丢）

- **2026-09-13 接回**：Caption 采用 R10 A SP，提炼稿在理解素材后作开发判断并提出具体剧情建议；选定证据与限制由 [Wiki 011](./wiki/011-caption-creative-directions.md) 保存。当时 `run-step` 可独立运行 caption/creative/outline/setting/beat#1，复用生产输入、输出 schema、ID 和预算；要求完整 monorepo 与真实 provider，由本地 server worker 执行，不写作品。CLI HOW 见 [Wiki 014](./wiki/014-agent-cli-telemetry.md#单节点实验-run-step)。主仓库 344 测、四包 typecheck 和构建通过，记录见 [本轮计划](./experiments/caption-adoption-2026-09-13/plan.md#验证记录)；没有新增真实模型质量证据。已运行 server 缓存生产 SP，需新进程读取更新。
- **生成参数**：LongCat 默认 thinking disabled、temperature 0.9、topP 0.95，生产链和独立节点共用 ModelRuntime；单节点 config-file 可设置模型与参数，显式 CLI flag 逐字段优先。topK 明确拒绝，telemetry 记录实际公开参数。完整覆盖、provider 和 timeout 契约只看 [Wiki 016](./wiki/016-model-runtime-provider-config.md#生成参数与单节点覆盖)。
- **#5 继承边界**：本页编辑、整份再生、同版本通过、UUID身份与请求关联诊断继续保留；“通过并生成正文”按钮在 #22 接到 Prose，#6 将同一双关卡推广到各章，不开放已通过章纲回改。Beat与Prose契约分别见 [schema](./schema.md)。
- **workflow 骨架 + 步骤内 agent**；Step 零感知 kind，输出 `{content}` 装整个 JSON；kind = 节点名；pipeline 管解析/组装/持久化，是深模块不是 swap seam。
- **两个真 seam**：store（生产 SqliteStore／测试可用 InMemoryStore）、step（FakeStep / RealStep）。SQL 事务内校验目标与实际输入版本；等待 LLM 不占数据库事务，提交时重新检查。
- **模型路由边界**：ModelRuntime 位于 RealStep 内部，不是第三个 Pipeline 注入 seam；已注册 provider 通过模型 ID 切换，新增 provider 需要对应 adapter、registry 注册与 key 契约。完整 HOW 只看 [wiki 016](./wiki/016-model-runtime-provider-config.md)。
- **6 节点 kind**：caption/creative/outline/setting 每作品一份；beat/prose 每作品×每章，生产复用beat/prose逐章推进；章号是正安全整数，每章独立版本。Artifact.content 的 JSON 表示由共享 kind/status schema 校验；humanStatus: pending | approved；appendArtifact版本+1。Setting／Beat／Prose专用finalize同版本原子定稿，通用setStatus均拒绝。Prose saveArtifact追加版本并保留匹配基线状态，不改变其他产物保存策略。
- **creative 保存语义**（#3c 起，取代「人工保存即通过」）：`PUT /artifacts/creative` = saveCreativeDraft，存全部方向、永远 pending、带 `expectedHeadVersion` 乐观锁；`POST /artifacts/creative/select` = selectCreativeDirection，落**单方向**新版本 + approved。`directionId` 由 server 注入（`${workId}-dir-N`），web 永不生成、编辑不可改。
- **pipeline（#3c）**：definition 加 `consumes`（只指前序 outputKind，启动校验唯一/禁环）；`PipelineInput = {workId, seed, upstream}`，upstream 读**最新版且必须 approved**；`advance()` 链式推进到下一个关卡（上限 = definition 长度），per-work 互斥锁（finally 释放，冲突 → 409 `advance-in-progress`），当前章返回可穷举 outcome `advanced | awaiting-approval | complete | failed(stepId, code, retryable, attemptId)`；interview 机制零残留。
- **读模型**：`GET /works/:id` 同快照附带 `workflowState`、`nextStepId`、`allowedActions` 及 `currentChapter/chapters`；生产新增awaiting-prose-review/prose-approved。pending正文动作save-draft/approve/regenerate，approved保留save-draft；完成章数只计approved正文head。outline-approved/setting-approved/beat-approved保留给旧定义。`generating`是Web本地瞬态；按pendingGate.kind分派，Web不重建关卡状态机，历史阅读按章摘要取得动作；`start-chapter` 使用明确章号与前章基线，不依阅读选择决定推进位置。
- **LLM 调用**：`steps/llm-call.ts`统一generateObject + zod + maxOutputTokens（outline/setting/prose 16000，其余默认8000）+ 可配置超时 + 类型化错误。advance业务失败可为HTTP200 + failed outcome，不能只按HTTP成功判断。原始素材>100K字符截断，结构化上游不静默截断；Prose实际system+prompt超过400000字符在模型前拒绝。Setting/Beat/Prose显式SDK maxRetries=0；Pipeline不自动重试。ModelRuntime唯一HOW见 [Wiki 016](./wiki/016-model-runtime-provider-config.md)。
- **CLI**：`./apps/cli/bin/a4n <cmd>`（stdout纯JSON）或`pnpm -s cli`；仅select/save-outline自动回填版本。Prose支持get、save-prose、approve-prose、regenerate-prose，文件显式绑定chapter/id/version，save另带expectedHumanStatus，重写另带instructions；结果未知最多回读一次，不自动重复写入。smoke延伸至正文生成、作者全文save、同版approve、精确回读prose-approved且无第二章；不是文学质量验收。独立run-step支持任意合法章号的Beat/Prose，后续章必须提供previousChapter，不写作品；start-chapter用文件显式绑定目标章与前章正文id/version。
- **错误**：HTTP 统一 `{code, retryable, attemptId?, message, issues?}`；Setting 字段错误 issues 只含 path/code/message。合法且匹配命令的拒绝包才证明写前拒绝；传输/5xx/畸形响应（包括畸形 4xx）可能已写入，必须按对应恢复契约冻结请求并回读。
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
- #7已提供作者配置UI/API；旧Work.config只作revision0兼容来源，保存后以作者document为唯一编辑来源。全局凭据/启动配置仍见 [Wiki016](./wiki/016-model-runtime-provider-config.md)，文件/版本/操作快照见[Wiki007](./wiki/007-author-agent-config.md)。
- run-step 不持久化实验账本、不自动跑上游，也不校验所供content是否来自作品最新版；成功只证明通过生产schema，raw模型输出和reasoning不对外返回。Beat/Prose后续章需显式提供恰好前一章的内容；CLI配置不会写回作品。
- #6 提供各章当前版本浏览，不提供任意历史版本回看；章纲版本比较仍归 #20。渐进展示/分段提炼等独立优化留 #12。
- #5 专属版本比较归 #20，正文后回流与章节重生归 #21；本期只允许通过前整份章纲再生。上条 #6/#12 是旧的通用优化分工，不覆盖这次已确认拆分。
- #5 已修复序号身份复用、共享原始错误日志和首次 Web advance 无限等待。2026-09-08 完整 production live smoke 两次卡在 Creative（截断／schema），不属于 Beat 成功证据；独立 Beat live 样例也是历史结果。#5 当次 fake/mock 回归通过；浏览器确认 pending 章纲及意见输入，原生刷新取消／确认受工具限制未验证，不能用 mounted 测试代替。证据边界统一见 Wiki 005。
- 「演示模式」是 UI 词非领域词，未进 CONTEXT.md。

## 下一步

CLI #25 已交付，无本票阻塞遗留；后续 CLI 结果/运行记录优化与真实模型质量验证仍是独立范围。当前能力、验证边界和完成记录统一从 [Wiki 025](./wiki/025-cli-command-safety.md) 进入。2026-09-13 Caption/CLI 的历史验证保留在 [当时计划](./experiments/caption-adoption-2026-09-13/plan.md#验证记录)。

#22 已合入 main；其原 source、固定点和候选审核记录均属于已交付历史，入口为 [Wiki 022](./wiki/022-prose-generation-review.md)。新票从当前 main 核对基线，不能把旧票授权或审核结论当成新票完成证据。

**当前交付 #43 修复，再对齐扩展范围**。#1 和文档 #41 已关闭，无需重复交付；三项原发现见 Wiki001，修复与验证从 Wiki043 进入。本轮先推送修复 PR，合并及关闭须后续独立执行。#28/#29 尚未开工，长篇质量验证仍未完成。既有三方案研究与用户裁决继续有效，普通工程细节自主处理；重大范围或数据取舍再请求用户决定。

| 交付批次 | 可验收结果 | 后续衔接 |
|---|---|---|
| #33 本机 Docker/CI（已交付） | 单容器同源服务、数据目录卷恢复、远端 fake CI | 不做公网部署/镜像发布/自动部署 |
| #7 Agent 配置（已交付） | 作品默认＋每步覆盖，生成冻结配置和文件版本 | Prompt/Skill 文件沿 ADR0002，工具执行归 #28 |
| #8 坏例（已交付） | 已保存正文选段、备注、原文快照和来源版本、列表回看 | 自动分析及持续重定位后置 |
| #1 MVP 联验（已交付） | 两章双关卡、历史修改、服务/容器重启、配置生效、坏例回看 | 完成评论及远端状态作证；本次新发现另行修复 |
| #28/#29 扩展 | 设定查询工具循环、作品 Wiki 档案演进 | 当前均未实现，保持后置 |

WHAT/AC 和依赖以 [父票 #1](https://github.com/12bitsD/agent4novel/issues/1) 及子票为准；[研究与决定清单](./research/mvp-delivery-options.md) 保存取舍。#33 的 SQLite 恢复 AC 原生依赖 #9；不为纯排期增加其他硬依赖。不迁移或清空旧内存实例；切换且内有重要作品时先保全。配置的实现和验收见Wiki007；坏例已交付见Wiki008，整体验收见Wiki001。SQLite、容器、配置、坏例分别以本票Wiki与远端状态为准。

继续继承条件写入、快照隔离、冻结提交与回读对账，不能照搬Outline保存／通过流程。#29中的WorkWiki指本书设定库，初始Setting与Wiki应呈现一套正式事实；正文与新增／更新档案一同通过、失败不保存一半、重试不重复历史，均是该扩展接入时的目标。通过后正文编辑的异步Wiki更新也是#29待对齐项，#22不预建任务。#17独立设定修改、#18冲突澄清、#20章纲比较、#21章节重生继续后置；#12/#15既有边界不变。

## 环境

git: GitHub 12bitsD/agent4novel（public）。2026-09-05 允许联网环境中 `gh auth status` 与 issue 回读成功；受限网络中的“token invalid”不能单独证明凭据失效，操作前重新核验连接与认证。版本以当前 node/pnpm 命令为准，避免继承会话里的旧工具版本。端口 server 8787 / web 5173。`pnpm dev` 起两端；未配置可用 provider credential 时进入演示模式，secret 与模型配置只按 [.env.example](../.env.example) + [wiki 016](./wiki/016-model-runtime-provider-config.md) 管理。Agent 执行 pnpm 可设置 `COREPACK_ENABLE_AUTO_PIN=0` 避免工具自动改写 packageManager；不得把工具副作用当成票内改动提交。
