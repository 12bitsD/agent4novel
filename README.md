# agent4novel

[English](./README.en.md) · [MIT License](./LICENSE) · [文档导航](#文档)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

agent4novel 是一个跑在本地的网文写作助手，帮「有脑洞、没功底」的作者把想法写成书：你决定故事往哪走、把关每个关键环节，补设定、排大纲、写正文这些专业活交给 AI。从一句话脑洞开始，目标是一部约 50 万字的完本长篇。

## 为什么做这个

写网文卡人的地方往往不是灵感，而是灵感到成书之间的那段距离：世界观要补全，大纲要编排，每一章正文都得写得像样。agent4novel 把这段距离拆成一条流水线——专业环节由 AI 生成，方向判断永远留给人。

## 快速开始

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

打开 <http://localhost:5173>。不配 API key 也能跑：此时是演示模式，由内置 fake 生成示例内容，不会调用真实模型。

接真实模型（目前支持 DeepSeek）：

```bash
export DEEPSEEK_API_KEY=sk-...
pnpm dev
```

## 它是怎么工作的

写一本书，就是一条流水线加上若干道关卡：

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="流水线：统一入口 → 预处理（反向 interview）→ 要点 JSON →（预处理关卡）→ 大纲 →（章纲 → 章纲关卡 → 正文 → 正文关卡）× N → 完本" width="960">
</p>
<p align="center"><sub>图 1 · 流水线与关卡：方框为 agent 步骤 / 产物，菱形「审」为人工关卡，虚线为按章循环</sub></p>

流水线按固定顺序产出四类内容：预处理要点（卖点、梗概、设定与大纲方向）、全书大纲、每章的章纲、每章的正文。每个产物生成后都会停在关卡上等你：可以直接通过，也可以改完再通过。产物没通过，流水线绝不继续。

## 流水线由什么组成

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="组成：Pipeline 编排器驱动步骤链（预处理→大纲→章纲→正文），产物落入版本化 Store，作者在关卡把关；右侧放大单个步骤的内部：输入契约 → Agent（LLM + SKILL.md）→ 输出 JSON" width="960">
</p>
<p align="center"><sub>图 2 · workflow 的四个组成部分：编排器、步骤、产物库，以及守在关卡上的人；右侧是单个步骤的内部结构</sub></p>

- **编排器（Pipeline）**：让流水线按固定顺序运转，并强制执行关卡规则——AI 产出一律先标「待把关」，你通过之后才解锁下一步。顺序、关卡、持久化的逻辑全部收在这一个模块里。
- **步骤（Step）**：每个环节就是一次 AI 生成。步骤不知道自己处在流水线的哪个位置，只认一份输入输出契约（输入输出都过 zod 校验）；提示词维护在 SKILL.md 文件里，调 prompt 不用改代码。
- **产物（Artifact）**：每一步的产出按「作品 + 类型 + 章节」归档，全量版本化，随时可以回到历史版本。你在界面上手动编辑保存，即视为通过。
- **两个可替换点**：存储和模型都可以换。存储默认内存版（开箱即用），正式持久化走 SQLite（#9）；模型经 AI SDK registry 接入，换厂商只是换一个字符串前缀。测试永远用 fake 步骤，不联网。

## 技术栈

TypeScript 全链 · pnpm workspaces · Vite + React（web，:5173）· Hono（server，:8787）· zod · Vitest · Vercel AI SDK v7（`@ai-sdk/deepseek`）

```bash
pnpm test        # 单元测试（全 fake，不联网）
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
| [docs/wiki/](./docs/wiki/) | 每张票的技术方案与状态记录（怎么做只看这里） |
| [docs/research/](./docs/research/) | 选型调研（技术栈、LLM provider 策略） |
| [docs/handoff.md](./docs/handoff.md) | 会话接力快照（当前进展与下一步） |

## 开发流程

每张 ticket 走同一个 loop：grill 对齐 → wiki 技术方案 → TDD 红绿切片 → 三轮自校准 → 双轴 code review。详见 [docs/wiki/README.md](./docs/wiki/README.md)。

## 路线图

- [x] [#2](https://github.com/12bitsD/agent4novel/issues/2) 脚手架 + 存储 + pipeline 骨架 + 书架
- [x] [#3](https://github.com/12bitsD/agent4novel/issues/3) 统一入口 + 创作界面 idea 状态（人工链路）
- [x] [#10](https://github.com/12bitsD/agent4novel/issues/10) 预处理 RealStep + interview + outline/setting 形态定案
- [ ] [#4](https://github.com/12bitsD/agent4novel/issues/4) 大纲生成
- [ ] [#5](https://github.com/12bitsD/agent4novel/issues/5) 章纲/正文关卡
- [ ] [#6](https://github.com/12bitsD/agent4novel/issues/6) 续写 + 作品详情 + router
- [ ] [#7](https://github.com/12bitsD/agent4novel/issues/7) Agent 配置（文风/题材/爽点）
- [ ] [#8](https://github.com/12bitsD/agent4novel/issues/8) 坏例收集
- [ ] [#9](https://github.com/12bitsD/agent4novel/issues/9) SQLite 持久化

## License

[MIT](./LICENSE)
