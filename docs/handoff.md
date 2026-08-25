# Handoff — agent4novel 会话接力快照

> 用途：context compaction / 新会话接力。每个里程碑收尾时刷新本文件（最后更新：2026-08-26，#3b 闭环 @ 4ed74f9）。
> 分工：词汇表看 CONTEXT.md；数据模型看 docs/schema.md；每票 HOW 看 docs/wiki/NNNN-*.md；本文件只管「项目现在到哪了、下一步是什么、哪些决策不能丢」。

## Primary Request and Intent

本地、单用户、开源 web 工具：帮不会写作的作者把一个脑洞，经人机协作（作者把方向、agent 填 gap、每个环节有关卡），写成约 50 万字的中文网文。逐章推进，章纲/正文两个关卡。

## 开发流程（用户的硬规矩，每票都走）

对齐（grill，用 Matt Pocock skill flow）→ 写 wiki 技术方案 → **先给执行计划（plan mode）** → TDD 实现（红绿切片，每 slice 一 commit，保持 test+typecheck 双绿）→ **3 轮自校准（读代码+wiki，核需求一致+规范遵循）** → /code-review（两轴并行 subagent）→ 修复 → commit/push。
回复用中文；wiki/文档是 agent 消费的；决策类问题给用户 (a)/(b)/(c) 选项，最小提问。

## 已完成

- **#2** 脚手架 + 存储 + pipeline 骨架 + 书架（wiki 002 ✅）
- **#3a** 统一入口（启动界面：输入+上传 txt/md/docx/pdf）+ 创作界面 idea 状态（wiki 003）
- **#3b / issue #10** 预处理 RealStep + interview + outline/setting 形态对齐（wiki 010 ✅，AC 全勾，端到端演示模式验证通过）

## 关键架构与契约（不能丢）

- **workflow 骨架 + 步骤内 agent**；Step 零感知 kind，输出 `{content}` 装整个 JSON；kind = 节点名；pipeline 管解析/组装/持久化，是深模块不是 swap seam。
- **两个真 seam**：store（InMemoryStore / #9 做 SQLiteStore）、step（FakeStep / RealStep）。
- **5 节点 kind**：preprocess/outline/setting 每作品一份；beat/prose 每作品×每章。Artifact.content: JsonValue；humanStatus: pending（待把关）| approved；appendArtifact 版本 +1；人工保存即通过，agent 产出 pending。
- **preprocess 最终形态**：`{inputStage: '脑洞'|'设定'|'主线'|'模板', hooks: string[], synopsis: string[], setting: {title,content}[], outline: {title,content}[]}`——多实例并存。outline 定案 `{chapters:[{number,title,summary}]}`（**无卷**）；setting 定案 `{worldview, powerSystem, factions[], characters[](含 profile), extra?}`。
- **interview 状态机**：definition 节点 `interview?: boolean`；advance 遇 interview → questions 阶段 → `awaiting-interview`（pendingInterview 存内存，**重启丢失已接受，#9 持久化**）→ answerInterview(answers) → normalize → 落库 pending。`PipelineInput = {workId, seed, phase?, answers?}`，phase 缺省 normalize（step inputSchema default），pipeline 只在 interview 流程显式传。
- **RealStep**：`server/src/steps/llm.ts` 唯一感知 provider（createProviderRegistry + @ai-sdk/deepseek，registry 读 env DEEPSEEK_API_KEY，代码零感知）；无 key → index.ts 装配 FakeStep（演示模式）；prompt 协议以 `steps/skills/preprocess/SKILL.md` 文件为准（ADR-0002），buildPrompt 只做数据插值；输出 JSON.parse + zod 按 phase 校验。
- **错误**：`server/src/errors.ts` KnownError（code: work-not-found→404 / 其余→400 / 未知→500 兜底），store/pipeline 抛出，routes 按 code 映射。
- **API**：GET/POST /api/works、GET /api/works/:id、PUT .../artifacts/preprocess（validate-on-write）、POST advance / answer-interview / approve、GET /api/config（{demo, interview}）。
- **web**：三界面（书架 Bookcase / 启动界面 Entry / 创作界面 Workspace）useState 导航无 router；Entry 提交后 interview 开则原地转问答（可跳过）；Workspace idea 视图列表式编辑（卖点/梗概 string 列表 + 设定/大纲 Hint{title,content} 列表，增删改整份保存）+ pending 时「通过」按钮；共享 `web/src/ui.ts`（样式 + replaceAt/removeAt）。
- 栈：pnpm workspaces + TS E2E、Vite+React(5173 /api proxy)、Hono(8787)、zod、Vitest、tsx、AI SDK v7 + @ai-sdk/deepseek。测试 81 绿（contracts 21 / server 55 / web 5）。

## 词汇红线（CONTEXT.md 单源）

- 关卡 Avoid「审核、**确认**」→ UI 用「通过」「待把关」（#3b review 收编过一轮，含 CONTEXT.md 自身「把关方向」）。
- 大纲 = 分章**无卷**（#3b 拍板，CONTEXT.md 与 spec #1 故事 7 已同步去卷）；场景/冲突/钩子归 beat（章纲）层。
- 字段名 `inputStage`（不是 granularity——「粗/细」粒度语义被 schema.md 占用；phase 被两阶段占用）。
- idea tab 文案保持英文「idea」（拍板过）。

## 踩坑记录

- **门禁命令不许用 grep 截断 exit code**（slice 4 曾因此带错提交，amend 补修）。
- zod 联合类型推断会带 `?: undefined` 成员，`undefined` 不是 JsonValue → run 返回标注显式类型（PreprocessStepOutput）。
- `registry.languageModel()` 只收 `deepseek:${string}` 模板字面量 → 开放字符串收窄在 preprocess-step 一处（as cast）。
- vi.mock 提升：mock 引用必须经 `vi.hoisted` 定义。
- edit 工具报 "file changed since it was read" → 重读再改。

## 遗留 / 已知限制

- 真 key 下 `deepseek-chat` 模型名未实测（research 标 unverified；有 key 后先验证）。
- advance/answer-interview 失败后，创作界面缺「重新预处理」入口（建议挂 #6）。
- 「演示模式」是 UI 词非领域词，未进 CONTEXT.md。

## 下一步

**#4 大纲生成**（outline 形态的生成步骤实现；definition 加第二阶段，gateBefore preprocess 已 approved）。老规矩：先 grill 对齐 → wiki 技术方案 → 执行计划。
后续队列：#5 章纲/正文关卡 → #6 续写+详情页+router → #7 Agent 配置 → #8 坏例 → #9 SQLite adapter。

## 环境

git: GitHub 12bitsD/agent4novel（public），gh 已认证 12bitsD；git user linhao/bits12@163.com。node v25 / pnpm 10.33。端口 server 8787 / web 5173。`pnpm dev` 起两端；无 DEEPSEEK_API_KEY 时自动演示模式。
