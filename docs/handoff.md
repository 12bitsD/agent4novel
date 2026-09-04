# Handoff — agent4novel 会话接力快照

> 用途：context compaction / 新会话接力。每个里程碑收尾时刷新本文件（最后更新：2026-09-04，#4 + #14 + #16 已落地，下一票 #13）。
> 分工：词汇表看 CONTEXT.md；数据模型看 docs/schema.md；每票工程上下文看 docs/wiki/NNN-*.md；本文件只管「项目现在到哪了、下一步是什么、哪些决策不能丢」。消费或更新 Wiki 时使用 `.claude/skills/agent4novel-wiki/SKILL.md`。

## Primary Request and Intent

本地、单用户、开源 web 工具：帮不会写作的作者把一个脑洞，经人机协作（作者把方向、agent 填 gap、每个环节有关卡），写成约 50 万字的中文网文。逐章推进，章纲/正文两个关卡。

## 开发流程（用户的硬规矩，每票都走）

对齐（grill，用 Matt Pocock skill flow）→ 建立 wiki 上下文节点 → **先给执行计划（plan mode）** → TDD 实现（红绿切片，每 slice 一 commit，保持 test+typecheck 双绿）→ 回写代码落点与变化原因 → **3 轮自校准（读代码+wiki，核需求一致+规范遵循）** → /code-review（两轴并行 subagent）→ 修复 → commit/push。
回复用中文；wiki/文档是 agent 消费的；决策类问题给用户 (a)/(b)/(c) 选项，最小提问。

## 已完成

- **#2** 脚手架 + 存储 + pipeline 骨架 + 书架（wiki 002 ✅）
- **#3a** 统一入口（启动界面：输入+上传 txt/md/docx/pdf）+ 创作界面 idea 状态（wiki 003）
- **#3b / issue #10** 预处理 RealStep + outline/setting 形态对齐（wiki 010 ✅；其 interview 机制已被 #3c 移除）
- **#3c / issue #11** 预处理重构（wiki 011 ✅）：caption（提炼稿，落库即 approved）→ creative（单次 generateObject 直出 N 个创意稿，gateAfter = 创意海报比较视图）；保存/选定两命令；interview 机制整体移除；全应用多巴胺设计系统（亮暗双主题）
- **#4** 大纲生成（wiki 004 ✅）：**推翻「分章每章一句话」**，大纲 = 弧线（冲突生命周期：标题/核心冲突/冲突发展/矛盾解决）+ 剧情点（标题/概要/落点）两层，与章节解耦；选定创意稿后 web 自动续跑 advance；保存 = pending + 通用 /approve 通过；读模型 5 态（selected 移除，加 awaiting-outline-review/outline-approved）
- **#14** Agent 可用性基建（wiki 014 ✅）：`apps/cli`（9 命令，`bin/a4n` 直跑 stdout 纯 JSON，headVersion 自动回填，smoke 探针）；LLM 遥测进程内账本，advance 响应内联 telemetry + `GET /works/:id/telemetry` 回看；systemHash 让 prompt 版本可追；**outline 失败根因根治**（8000 截断 → outline 上限 16000 + SKILL 篇幅纪律）；项目级 skill `.claude/skills/agent4novel-drive`
- **#16** 可配置 ModelRuntime + LongCat provider（[wiki 016](./wiki/016-model-runtime-provider-config.md) ✅）：RealStep 内统一 provider 路由、server-only 本地配置与请求超时；接入 LongCat OpenAI-compatible Chat Completions。2026-08-29 已完成独立生产 Step 真机验证，并留下完整 CLI smoke 的失败与重入结论；所有 work ID 都来自已结束的内存进程，当前不可继续使用，证据边界只看 wiki 016 与 LongCat research。

## 关键架构与契约（不能丢）

- **workflow 骨架 + 步骤内 agent**；Step 零感知 kind，输出 `{content}` 装整个 JSON；kind = 节点名；pipeline 管解析/组装/持久化，是深模块不是 swap seam。
- **两个真 seam**：store（InMemoryStore / #9 做 SQLiteStore）、step（FakeStep / RealStep）。
- **模型路由边界**：ModelRuntime 位于 RealStep 内部，不是第三个 Pipeline 注入 seam；已注册 provider 通过模型 ID 切换，新增 provider 需要对应 adapter、registry 注册与 key 契约。完整 HOW 只看 [wiki 016](./wiki/016-model-runtime-provider-config.md)。
- **6 节点 kind**：caption/creative/outline/setting 每作品一份；beat/prose 每作品×每章。Artifact.content: JsonValue；humanStatus: pending | approved；appendArtifact 版本 +1。
- **creative 保存语义**（#3c 起，取代「人工保存即通过」）：`PUT /artifacts/creative` = saveCreativeDraft，存全部方向、永远 pending、带 `expectedHeadVersion` 乐观锁；`POST /artifacts/creative/select` = selectCreativeDirection，落**单方向**新版本 + approved。`directionId` 由 server 注入（`${workId}-dir-N`），web 永不生成、编辑不可改。
- **pipeline（#3c）**：definition 加 `consumes`（只指前序 outputKind，启动校验唯一/禁环）；`PipelineInput = {workId, seed, upstream}`，upstream 读**最新版且必须 approved**；`advance()` 链式推进到下一个关卡（上限 = definition 长度），per-work 互斥锁（finally 释放，冲突 → 409 `advance-in-progress`），返回可穷举 outcome `advanced | awaiting-approval | complete | failed(stepId, code, retryable, attemptId)`；interview 机制零残留。
- **读模型**：`GET /works/:id` 同快照附带 `workflowState`（ready-to-generate | awaiting-selection | awaiting-outline-review | outline-approved | failed；`generating` 是 web 本地瞬态，不入契约）+ `allowedActions`，按 `pendingGate.kind` 分派，web 只渲染不重建状态机。`failed` 由 pipeline `lastFailure` 驱动，approve/成功清除。
- **LLM 调用**：`steps/llm-call.ts` 统一 generateObject + zod + maxTokens（outline 16000，其余默认 8000）+ 可配置超时 + 类型化错误（llm-invalid-output→502 / llm-unavailable→503 / llm-timeout→504）；素材 >100K 字符截断收在这一处；`steps/llm.ts` 的 ModelRuntime 是唯一感知 provider 的模块，配置与安全规则见 [wiki 016](./wiki/016-model-runtime-provider-config.md)。**遥测（#14）**：每次调用记进程内环形账本（steps/telemetry.ts），advance 响应内联本次记录，`GET /works/:id/telemetry` 回看；`systemHash` = SKILL.md 内容 hash，prompt 版本可追。
- **CLI（#14）**：`apps/cli`，`./apps/cli/bin/a4n <cmd>`（直跑，stdout 纯 JSON）或 `pnpm -s cli`；select/save-outline 自动回填 expectedHeadVersion；`smoke` = 一键全链路探针，**每次测试的标准动作之一**。
- **错误**：HTTP 统一 `{code, retryable, attemptId, message}`；409 = advance-in-progress / version-conflict / direction-not-selected，422 内容非法。
- **web 设计系统**（#3c）：`apps/web/src/styles.css` 唯一全局面，亮暗双主题 CSS 变量（prefers-color-scheme + data-theme 预留）；多巴胺在点缀层（主 CTA 珊瑚 accent，方向 tab 珊瑚/紫/青轮转，chip 用强调色），底色纸白/墨黑极简；**内联样式只许 var(--*)，禁硬编码色值**。创意海报风险面抽纯函数 `web/src/creative-compare.ts`（tab↔directionId、保存全部、选定、409 保 dirty），vitest 覆盖，无浏览器 E2E。
- 栈：pnpm workspaces + TS E2E、Vite+React(5173 /api proxy)、Hono(8787)、zod、Vitest、tsx、AI SDK v7 + `@ai-sdk/deepseek` + `@ai-sdk/openai-compatible`。测试 139 绿（contracts 35 / server 72 / web 24 / cli 8）。

## 词汇红线（CONTEXT.md 单源）

- 关卡 Avoid「审核、**确认**」→ UI 用「通过」「待把关」。
- 大纲 = **弧线（冲突生命周期）+ 剧情点（情节步骤）两层，与章节解耦**（#4 grill 推翻「分章每章一句话」）；场景/冲突/钩子归 beat（章纲）层。
- 预处理 = caption（提炼稿）→ creative（创意稿）两步；提炼稿 Avoid「摘要、解析结果」，创意稿 Avoid「brief、方案」。
- 创意稿的「一句话钩子」字段叫 `hook`；爽点清单叫 `payoffs`；「卖点」作领域词时对应这两者，不再是独立数组。

## 踩坑记录

- **门禁命令不许用 grep 截断 exit code**（slice 4 曾因此带错提交，amend 补修）。
- zod 联合类型推断会带 `?: undefined` 成员，`undefined` 不是 JsonValue → run 返回标注显式类型。
- `createProviderRegistry` 只负责解析 `provider:model`，不提供 HTTP 协议兼容性；每个 provider 的 wire protocol 必须由匹配的 adapter 承担，不能靠改 base URL 复用厂商专用 adapter。
- vi.mock 提升：mock 引用必须经 `vi.hoisted` 定义。
- contracts `export *` 双文件同名导出会被静默排除（inputStages 迁入 caption.ts 时踩过）→ 迁移期用显式 re-export。
- AI SDK 错误按 `err.name` 分类：NoObjectGeneratedError → 模型输出非法；TimeoutError/AbortError → 超时。**v7 真机实测错误名带 `AI_` 前缀**（`AI_NoObjectGeneratedError`)，匹配要用 `includes`。
- **outline 在 v4-flash 的失败有两种模式**（#14 遥测实证）：截断（finishReason=length 撞 8000 上限 → 已修 16000）与 schema 偏差（finishReason=stop 但不过校验，llm.error 已记 causeMessage 守株待兔）。修截断要同时收 prompt 篇幅（SKILL.md 纪律），否则拿质量换稳定。
- **pnpm run 横幅污染 stdout**（`> pkg script …` 两行）：Agent 管道消费会炸 JSON 解析。要么 `./apps/cli/bin/a4n` 直跑，要么 `pnpm -s cli`。
- heredoc/perl 里带反引号的模板字符串会被 shell 吃掉——改代码用 Edit 工具，别用 perl -pi。

## 遗留 / 已知限制

- LongCat 的 Responses 协议尚未接入；当前只对接其文档明确支持的 OpenAI-compatible Chat Completions。
- LongCat 文档未保证 JSON Schema structured output；当前走 `json_object` + 本地 zod 校验，`work-4` 已验证当前三步，但这不是上游协议保证。
- `Work.config.model` 已作为内部覆盖接缝接入 Pipeline，但目前没有公开 UI/API；全局启动配置见 [wiki 016](./wiki/016-model-runtime-provider-config.md)。
- 版本回看 UI（后悔药）没有入口，留 #6；重新生成（带补充想法）/渐进展示/分段提炼留 #12。
- 「演示模式」是 UI 词非领域词，未进 CONTEXT.md。

## 下一步

**#13 设定完整版生成（创意稿 → setting 定稿）**（wiki 待建；issue #13，blocked by #11 已解除）：consumes caption + 已选定 creative，生成 `{worldview, powerSystem, factions[], characters[], extra?}`，可 review/编辑/保存；block #5。
后续队列：**#13** → #9 SQLite（提前到 #5 前）→ #5 章纲/正文关卡（输入 = 剧情点切片 + 章数规划）→ #6 → #7 → #8。#12 = 优化项（重新生成/渐进展示/版本回看/弧线级联重生成），低优。#15 = web↔server 换 Hono RPC 消 DTO 漂移，**服务全部定型后**再做。

## 环境

git: GitHub 12bitsD/agent4novel（public）；`gh auth status` 当前报告 12bitsD token 失效，issue 写操作前需重新登录。git user Bits12(Mac)/bits12@163.com。node v25 / pnpm 10.33。端口 server 8787 / web 5173。`pnpm dev` 起两端；未配置可用 provider credential 时进入演示模式，secret 与模型配置只按 [.env.example](../.env.example) + [wiki 016](./wiki/016-model-runtime-provider-config.md) 管理。
