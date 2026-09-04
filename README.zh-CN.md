<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel：灵感 → 关卡 → 成书" width="300">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">
  <strong>从一句话脑洞，到一部完本长篇。</strong>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#它是怎么工作的">流水线</a> ·
  <a href="#架构">架构</a> ·
  <a href="#文档">文档</a> ·
  <a href="#路线图">路线图</a> ·
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="#快速开始"><img src="https://img.shields.io/badge/%E6%BC%94%E7%A4%BA%E6%A8%A1%E5%BC%8F-%E5%85%8D_API_Key-brightgreen" alt="演示模式：免 API Key"></a>
  <img src="https://img.shields.io/badge/AI_SDK-v7-000000" alt="AI SDK v7">
</p>

---

小说创作长期是手工作坊式的活计：一个作者，一支笔，几十万字一点点磨。agent4novel 想把它搬进一条现代流水线——AI 像一支随叫随到的编辑团队，负责补设定、排大纲、写正文；你是唯一的主编：故事方向你定，每道关卡你审。混沌的灵感进去，结构严谨的长篇出来。

它面向「有想法但没受过写作训练」的作者。你给它一句话脑洞（或一份设定文档），它先提炼素材、给出几个创意方向供你比较选定，然后一环一环地生成：全书大纲、每章的章纲、每章的正文。应用与存储都在本地运行：演示模式不会调用模型服务；实时模型模式会把生成所需输入发给你配置的模型供应商，并适用该供应商的隐私条款。

## 快速开始

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

打开 <http://localhost:5173>。不配 API key 也能跑：此时是演示模式，由内置 fake 生成示例内容，不会调用真实模型。

接真实模型（支持 DeepSeek，以及 LongCat 的 OpenAI-compatible Chat Completions 接口）：

```bash
cp .env.example .env.local
chmod 600 .env.local
# 编辑 .env.local：设置 A4N_MODEL 与对应 provider 的 API key
pnpm dev
```

`.env.local` 会在 server 启动时读取且已被 Git 忽略；shell/CI 中已有的环境变量优先。显式设置 `A4N_MODEL` 时必须同时提供对应 provider 的 key；未显式设置时按 DeepSeek → LongCat → 演示模式的顺序选择。模型 ID 采用 `provider:model`，例如 `longcat:LongCat-2.0` 或 `deepseek:deepseek-chat`。

凭据、base URL 与 provider adapter 只存在于 server。`Work.config.model` 是作品级内部覆盖接缝，目前没有公开 UI/API。当前 LongCat adapter 只对接其文档明确支持的 Chat Completions，不代表兼容 Responses 等全部 OpenAI 协议。配置契约、安全规则与实测案例统一见 [wiki 016](./docs/wiki/016-model-runtime-provider-config.md)。

### CLI（供脚本和 Agent 使用）

全部能力都能从命令行驱动——stdout 恒为纯 JSON:

```bash
./apps/cli/bin/a4n smoke --seed-file seed.txt   # 一键全链路探针
./apps/cli/bin/a4n list                         # create / get / advance / select / approve / logs …
```

打开本仓库的 Agent 可通过内置 skill `.claude/skills/agent4novel-drive` 获得完整用法。

## 它是怎么工作的

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="流水线：统一入口 → 提炼（caption，自动通过）→ 创意稿方向包 ×N →（比较选定关卡）→ 大纲 →（章纲 → 章纲关卡 → 正文 → 正文关卡）× N → 完本" width="960">
</p>
<p align="center"><sub>图 1 · 流水线与关卡：方框为 agent 步骤 / 产物，菱形「审」为人工关卡，虚线为按章循环</sub></p>

预处理先产出若干创意方向、你在比较视图里选定一个；之后每一章都先出章纲、你点头、再写正文、你再过目。产物没通过，流水线绝不继续。

## 架构

整条架构只围绕一个理念：**human-in-the-loop**——机器负责生成，人负责判断，两层之间唯一的通道是关卡：AI 写出的东西，不过关卡就不算数。

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="分层架构：上层是判断层（用户输入、作者把关），下层是生成层（机器）：Pipeline 编排器拥有全部流程控制权，内部是预处理→大纲→章纲→正文步骤链，步骤间的关卡把 AI 产出（pending）交给作者把关（approved）；容器底部是两个可替换接缝（存储 InMemoryStore│SQLiteStore、步骤 FakeStep│RealStep）；产物落入版本化 Store" width="760">
</p>
<p align="center"><sub>图 2 · human-in-the-loop 分层架构：判断层（人）在上，生成层（机器）在下；Pipeline 拥有全部流程控制权，关卡是两层唯一的通道</sub></p>

- **编排器（Pipeline）**：按固定顺序驱动步骤链，用状态机（ready → awaiting-approval → complete，由产物状态推导）强制关卡——AI 产出一律 pending，作者显式通过（如创意稿的选定）后才解锁下一步。顺序、关卡、持久化逻辑全部收在这一个模块。
- **步骤（Step）**：每个环节是一次受契约约束的 AI 生成：`runStep` 对输入输出做双向 zod 校验；提示词维护在 SKILL.md 文件里，调 prompt 不用改代码。步骤不感知自己在流水线中的位置，因此可独立测试、独立替换。
- **产物（Artifact）**：产出按「作品 + 类型 + 章节」归档为 append-only 版本链（`{kind, chapter?, version, content, humanStatus}`），任何历史版本可回读；创意稿保存草稿保持待把关、显式选定才通过；AI 产出一律待把关。
- **可替换点**：Pipeline 的依赖注入接缝是存储（内存版开箱即用 ↔ SQLite 持久化，#9）与 Step（`FakeStep` ↔ `RealStep`）。`RealStep` 内部由 `ModelRuntime` 统一管理 provider 路由、凭据、base URL 与请求超时。切换已注册 provider 只需更换带 provider 前缀的模型 ID；新增 provider 仍需增加 adapter、registry 注册与 key 契约。测试把外部 I/O 全部 mock，不触网。

## 技术栈

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white" alt="Hono">
  <img src="https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/zod-3E67B1?logo=zod&logoColor=white" alt="zod">
  <img src="https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white" alt="Vitest">
</p>

<p align="center">Vercel AI SDK v7（<code>@ai-sdk/deepseek</code> + <code>@ai-sdk/openai-compatible</code>）· pnpm workspaces · TypeScript 全链</p>

```bash
pnpm test        # 单元测试（外部 I/O 全 mock，不联网）
pnpm typecheck
pnpm build
```

## 文档

这个仓库的文档是写给 agent 读的一等公民，人读也够用：

| 文档 | 管什么 |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | 领域词汇表（先读它） |
| [docs/schema.md](./docs/schema.md) | 数据模型的唯一来源 |
| [docs/adr/](./docs/adr/) | 不可逆决策（编排、存储、skill 文件） |
| [docs/wiki/](./docs/wiki/) | 每张票的工程上下文：设计目的、代码落点与变化原因 |
| [Ticket 完成审核清单](./docs/agents/ticket-completion-checklist.md) | 每票必须执行的 review、文档、直推或 PR/merge 与 GitHub 核验闸门 |
| [docs/research/](./docs/research/) | 选型调研（技术栈、LLM provider 策略） |
| [docs/handoff.md](./docs/handoff.md) | 会话接力快照（当前进展与下一步） |

## 开发流程

每张 ticket 走同一个 loop：每票 grill 并对齐范围 → 建立 Wiki 上下文 → 给出计划 → TDD 实现 → 本地门禁 → 回写知识 → 三轮自校准 → Standards/Spec 双轴 review → 直推或 PR/merge → 远端回读。[Ticket 完成审核清单](./docs/agents/ticket-completion-checklist.md) 是这套闸门必须执行的唯一来源；逐票证据格式见 [Wiki 契约](./docs/wiki/README.md)。

## 路线图

| 票 | 内容 | 状态 |
|---|---|---|
| [#2](https://github.com/12bitsD/agent4novel/issues/2) | 脚手架 + 存储 + pipeline 骨架 + 书架 | ✅ |
| [#3](https://github.com/12bitsD/agent4novel/issues/3) | 统一入口 + 创作界面 idea 状态（人工链路） | ✅ |
| [#10](https://github.com/12bitsD/agent4novel/issues/10) | 预处理 RealStep + interview + outline/setting 形态定案 | ✅ |
| [#11](https://github.com/12bitsD/agent4novel/issues/11) | 预处理重构：提炼稿 + 创意稿方向包 + 比较视图 | ✅ |
| [#4](https://github.com/12bitsD/agent4novel/issues/4) | 大纲生成：弧线 + 剧情点(两层,与章节解耦) | ✅ |
| [#14](https://github.com/12bitsD/agent4novel/issues/14) | Agent CLI + LLM 遥测 + 项目驱动 skill | ✅ |
| [#16](https://github.com/12bitsD/agent4novel/issues/16) | 可配置 ModelRuntime + LongCat provider | ✅ |
| [#13](https://github.com/12bitsD/agent4novel/issues/13) | 设定完整版生成 | ◀ 下一个 |
| [#9](https://github.com/12bitsD/agent4novel/issues/9) | SQLite 持久化（提前到 #5 前：正文产出必须扛得住重启） | |
| [#5](https://github.com/12bitsD/agent4novel/issues/5) | 章纲/正文关卡 | |
| [#6](https://github.com/12bitsD/agent4novel/issues/6) | 续写 + 作品详情 + router | |
| [#7](https://github.com/12bitsD/agent4novel/issues/7) | Agent 配置（文风/题材/爽点） | |
| [#8](https://github.com/12bitsD/agent4novel/issues/8) | 坏例收集 | |

---

<p align="center">
  <sub><a href="./LICENSE">MIT License</a></sub><br>
  <sub>如果这个项目对你有意思，欢迎 star，或来 issue 聊聊。</sub>
</p>
