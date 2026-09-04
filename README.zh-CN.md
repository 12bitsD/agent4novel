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

小说创作长期是手工作坊式的活计：一个作者，一支笔，几十万字一点点磨。agent4novel 想把它搬进一条人机协作流水线——AI 像一支随叫随到的编辑团队，负责展开创意、排大纲、补设定；你是唯一的主编，故事方向与每道作者关卡都由你把握。目标是从模糊脑洞，走到一部完本长篇。

它面向「有想法但没受过写作训练」的作者。当前链路接收一句话脑洞（或一份设定文档），依次生成提炼稿、供你比较选定的创意稿、全书大纲，以及可编辑并通过的完整设定；章纲与正文留给后续 [#5](https://github.com/12bitsD/agent4novel/issues/5)。应用与存储都在本地运行：演示模式不会调用模型服务；实时模型模式会把生成所需输入发给你配置的模型供应商，并适用该供应商的隐私条款。

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

生成与把关也能从命令行驱动——stdout 恒为纯 JSON：

```bash
./apps/cli/bin/a4n smoke --seed-file seed.txt   # 跑完整链路，编辑并通过设定
./apps/cli/bin/a4n list                         # create / get / advance / select / approve / logs …
./apps/cli/bin/a4n get work-1 --kind setting    # 将 work-1 替换成你的作品 ID
./apps/cli/bin/a4n approve-setting work-1 --file setting-request.json
```

`setting-request.json` 包含完整的 `{ content, expectedHeadVersion }` 请求。版本号应来自你实际查看的设定；`approve-setting` 不会将它替换成最新版本。只有 `select` 和 `save-outline` 自动查询版本；`smoke` 会实际修改设定后再通过。

打开本仓库的 Agent 可通过内置 skill `.claude/skills/agent4novel-drive` 获得完整用法。

## 它是怎么工作的

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="当前流水线：统一入口 → 提炼稿（caption，自动通过）→ 创意稿与选定 → 大纲与把关 → 完整设定、本页编辑与一次通过；后续 #5 增加按章生成章纲和正文的循环" width="960">
</p>
<p align="center"><sub>图 1 · 当前四步链路结束于 setting-approved；虚线延续部分是 #5 规划中的按章循环</sub></p>

内部提炼稿自动通过。你先选定一个创意方向，再把关大纲，最后编辑并通过完整设定；这是当前链路的终点。每章的章纲、正文及各自关卡，规划在 #5 中实现。

待把关设定的修改只保存在本页内存中，刷新或离开会丢弃尚未提交的修改。点击**通过**时，编辑内容与通过状态一次落库，保持同一个产物 ID 和版本；没有单独的保存草稿，也不会新增通过版 v2。通过后的设定只读，作为作品固定基准；后续修改与扩展归 #17。

## 架构

架构围绕 **human-in-the-loop**：机器负责生成，作者负责判断；面向作者的产物通过关卡后，下游才能消费。内部提炼稿是预处理例外，会自动通过。

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="当前架构：Pipeline 驱动提炼稿 → 创意稿 → 大纲 → 设定；提炼稿自动通过，作者关卡需显式把关。设定通过时原子更新同一产物版本。存储与步骤可替换；按章生成（#5）和 SQLite（#9）尚在规划中" width="760">
</p>
<p align="center"><sub>图 2 · Pipeline 控制当前四步流程，Store 原子提交设定通过；按章生成与 SQLite 仍属后续工作</sub></p>

- **编排器（Pipeline）**：按提炼稿 → 创意稿 → 大纲 → 设定的固定顺序推进，用状态机（ready → awaiting-approval → complete，由产物状态推导）强制关卡。提炼稿自动通过；创意稿、大纲和设定等待作者显式操作。Pipeline 协调流程，Store 的条件写入保护已落库产物。
- **步骤（Step）**：每个环节是一次受契约约束的 AI 生成：`runStep` 对输入输出做双向 zod 校验；提示词维护在 SKILL.md 文件里，调 prompt 不用改代码。步骤不感知自己在流水线中的位置，因此可独立测试、独立替换。
- **产物（Artifact）**：按「作品 + 类型 + 章节」归档（`{kind, chapter?, version, content, humanStatus}`）。现有创意稿与大纲的保存操作追加版本；设定通过则原子替换同一 ID、同一版本的内容与状态。公开 API 只返回每组产物的最新版本，不提供任意历史版本回读。
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
| [契约管理](./docs/agents/contract-governance.md) | 可执行契约、领域模型与每票决定的归属 |
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
| [#13](https://github.com/12bitsD/agent4novel/issues/13) | 大纲通过后生成完整设定，本地编辑并一次通过（[工程上下文](./docs/wiki/013-setting-generation-review.md)） | ✅ 已实现 |
| [#9](https://github.com/12bitsD/agent4novel/issues/9) | SQLite 持久化（提前到 #5 前：正文产出必须扛得住重启） | |
| [#5](https://github.com/12bitsD/agent4novel/issues/5) | 章纲/正文关卡 | |
| [#6](https://github.com/12bitsD/agent4novel/issues/6) | 续写 + 作品详情 + router | |
| [#7](https://github.com/12bitsD/agent4novel/issues/7) | Agent 配置（文风/题材/爽点） | |
| [#8](https://github.com/12bitsD/agent4novel/issues/8) | 坏例收集 | |

[契约收敛 #19](https://github.com/12bitsD/agent4novel/issues/19) 安排在 #13 之后、#9／#5 之前。[通过后的设定修改 #17](https://github.com/12bitsD/agent4novel/issues/17)、[冲突澄清 #18](https://github.com/12bitsD/agent4novel/issues/18) 分别留给后续优化；边界见 [#13 设计](./docs/wiki/013-setting-generation-review.md)。这些是计划中的能力，不代表当前界面或存储已支持。

---

<p align="center">
  <sub><a href="./LICENSE">MIT License</a></sub><br>
  <sub>如果这个项目对你有意思，欢迎 star，或来 issue 聊聊。</sub>
</p>
