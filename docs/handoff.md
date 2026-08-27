# Handoff — agent4novel 会话接力快照

> 用途：context compaction / 新会话接力。每个里程碑收尾时刷新本文件（最后更新：2026-08-28，#4 已落地，下一票 #13）。
> 分工：词汇表看 CONTEXT.md；数据模型看 docs/schema.md；每票 HOW 看 docs/wiki/NNNN-*.md；本文件只管「项目现在到哪了、下一步是什么、哪些决策不能丢」。

## Primary Request and Intent

本地、单用户、开源 web 工具：帮不会写作的作者把一个脑洞，经人机协作（作者把方向、agent 填 gap、每个环节有关卡），写成约 50 万字的中文网文。逐章推进，章纲/正文两个关卡。

## 开发流程（用户的硬规矩，每票都走）

对齐（grill，用 Matt Pocock skill flow）→ 写 wiki 技术方案 → **先给执行计划（plan mode）** → TDD 实现（红绿切片，每 slice 一 commit，保持 test+typecheck 双绿）→ **3 轮自校准（读代码+wiki，核需求一致+规范遵循）** → /code-review（两轴并行 subagent）→ 修复 → commit/push。
回复用中文；wiki/文档是 agent 消费的；决策类问题给用户 (a)/(b)/(c) 选项，最小提问。

## 已完成

- **#2** 脚手架 + 存储 + pipeline 骨架 + 书架（wiki 002 ✅）
- **#3a** 统一入口（启动界面：输入+上传 txt/md/docx/pdf）+ 创作界面 idea 状态（wiki 003）
- **#3b / issue #10** 预处理 RealStep + outline/setting 形态对齐（wiki 010 ✅；其 interview 机制已被 #3c 移除）
- **#3c / issue #11** 预处理重构（wiki 011 ✅）：caption（提炼稿，落库即 approved）→ creative（单次 generateObject 直出 N 个创意稿，gateAfter = 创意海报比较视图）；保存/选定两命令；interview 机制整体移除；全应用多巴胺设计系统（亮暗双主题）
- **#4** 大纲生成（wiki 004 ✅）：**推翻「分章每章一句话」**，大纲 = 弧线（冲突生命周期：标题/核心冲突/冲突发展/矛盾解决）+ 剧情点（标题/概要/落点）两层，与章节解耦；选定创意稿后 web 自动续跑 advance；保存 = pending + 通用 /approve 通过；读模型 5 态（selected 移除，加 awaiting-outline-review/outline-approved）

## 关键架构与契约（不能丢）

- **workflow 骨架 + 步骤内 agent**；Step 零感知 kind，输出 `{content}` 装整个 JSON；kind = 节点名；pipeline 管解析/组装/持久化，是深模块不是 swap seam。
- **两个真 seam**：store（InMemoryStore / #9 做 SQLiteStore）、step（FakeStep / RealStep）。
- **6 节点 kind**：caption/creative/outline/setting 每作品一份；beat/prose 每作品×每章。Artifact.content: JsonValue；humanStatus: pending | approved；appendArtifact 版本 +1。
- **creative 保存语义**（#3c 起，取代「人工保存即通过」）：`PUT /artifacts/creative` = saveCreativeDraft，存全部方向、永远 pending、带 `expectedHeadVersion` 乐观锁；`POST /artifacts/creative/select` = selectCreativeDirection，落**单方向**新版本 + approved。`directionId` 由 server 注入（`${workId}-dir-N`），web 永不生成、编辑不可改。
- **pipeline（#3c）**：definition 加 `consumes`（只指前序 outputKind，启动校验唯一/禁环）；`PipelineInput = {workId, seed, upstream}`，upstream 读**最新版且必须 approved**；`advance()` 链式推进到下一个关卡（上限 = definition 长度），per-work 互斥锁（finally 释放，冲突 → 409 `advance-in-progress`），返回可穷举 outcome `advanced | awaiting-approval | complete | failed(stepId, code, retryable, attemptId)`；interview 机制零残留。
- **读模型**：`GET /works/:id` 同快照附带 `workflowState`（ready-to-generate | awaiting-selection | awaiting-outline-review | outline-approved | failed；`generating` 是 web 本地瞬态，不入契约）+ `allowedActions`，按 `pendingGate.kind` 分派，web 只渲染不重建状态机。`failed` 由 pipeline `lastFailure` 驱动，approve/成功清除。
- **LLM 调用**：`steps/llm-call.ts` 统一 generateObject + zod + maxTokens + AbortSignal 超时 + 类型化错误（llm-invalid-output→502 / llm-unavailable→503 / llm-timeout→504）；素材 >100K 字符截断收在这一处；`steps/llm.ts` 唯一感知 provider。
- **错误**：HTTP 统一 `{code, retryable, attemptId, message}`；409 = advance-in-progress / version-conflict / direction-not-selected，422 内容非法。
- **web 设计系统**（#3c）：`apps/web/src/styles.css` 唯一全局面，亮暗双主题 CSS 变量（prefers-color-scheme + data-theme 预留）；多巴胺在点缀层（主 CTA 珊瑚 accent，方向 tab 珊瑚/紫/青轮转，chip 用强调色），底色纸白/墨黑极简；**内联样式只许 var(--*)，禁硬编码色值**。创意海报风险面抽纯函数 `web/src/creative-compare.ts`（tab↔directionId、保存全部、选定、409 保 dirty），vitest 覆盖，无浏览器 E2E。
- 栈：pnpm workspaces + TS E2E、Vite+React(5173 /api proxy)、Hono(8787)、zod、Vitest、tsx、AI SDK v7 + @ai-sdk/deepseek。测试 124 绿（contracts 35 / server 65 / web 24）。

## 词汇红线（CONTEXT.md 单源）

- 关卡 Avoid「审核、**确认**」→ UI 用「通过」「待把关」。
- 大纲 = **弧线（冲突生命周期）+ 剧情点（情节步骤）两层，与章节解耦**（#4 grill 推翻「分章每章一句话」）；场景/冲突/钩子归 beat（章纲）层。
- 预处理 = caption（提炼稿）→ creative（创意稿）两步；提炼稿 Avoid「摘要、解析结果」，创意稿 Avoid「brief、方案」。
- 创意稿的「一句话钩子」字段叫 `hook`；爽点清单叫 `payoffs`；「卖点」作领域词时对应这两者，不再是独立数组。

## 踩坑记录

- **门禁命令不许用 grep 截断 exit code**（slice 4 曾因此带错提交，amend 补修）。
- zod 联合类型推断会带 `?: undefined` 成员，`undefined` 不是 JsonValue → run 返回标注显式类型。
- `registry.languageModel()` 只收 `deepseek:${string}` 模板字面量 → 开放字符串收窄在 llm-call 一处（as cast）。
- vi.mock 提升：mock 引用必须经 `vi.hoisted` 定义。
- contracts `export *` 双文件同名导出会被静默排除（inputStages 迁入 caption.ts 时踩过）→ 迁移期用显式 re-export。
- AI SDK 错误按 `err.name` 分类：NoObjectGeneratedError → 模型输出非法；TimeoutError/AbortError → 超时。**v7 真机实测错误名带 `AI_` 前缀**（`AI_NoObjectGeneratedError`)，匹配要用 `includes`。
- `deepseek:deepseek-v4-flash` 实测可用（#4 冒烟）：caption 3s / creative 49s / outline 54s;v1 无模型配置口，临时指定走 `resolveConfig`（正式配置归 #7)。

## 遗留 / 已知限制

- 真 key 下 `deepseek-chat` 模型名未实测（research 标 unverified；有 key 后先验证）。
- caption/creative 的 SKILL.md 提示词只过了演示模式，真模型效果未验（调 prompt 不改代码，随时迭代）。
- 版本回看 UI（后悔药）没有入口，留 #6；重新生成（带补充想法）/渐进展示/分段提炼留 #12。
- 「演示模式」是 UI 词非领域词，未进 CONTEXT.md。

## 下一步

**#13 设定完整版生成（创意稿 → setting 定稿）**（wiki 待建；issue #13，blocked by #11 已解除）：consumes creative（+caption?），生成 `{worldview, powerSystem, factions[], characters[], extra?}`，可 review/编辑/保存；block #5。
后续队列：**#13** → #9 SQLite（提前到 #5 前）→ #5 章纲/正文关卡（输入 = 剧情点切片 + 章数规划）→ #6 → #7 → #8。#12 = 优化项（重新生成/渐进展示/版本回看/弧线级联重生成），低优。

## 环境

git: GitHub 12bitsD/agent4novel（public），gh 已认证 12bitsD；git user Bits12(Mac)/bits12@163.com。node v25 / pnpm 10.33。端口 server 8787 / web 5173。`pnpm dev` 起两端；无 DEEPSEEK_API_KEY 时自动演示模式。
