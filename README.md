# agent4novel

[English](./README.en.md) · [MIT License](./LICENSE) · [文档导航](#文档)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

agent4novel 是一个把网文脑洞变成完本长篇的工具。你给它一句话脑洞（或一份设定文档），它先反过来问你几个关键问题，然后一环一环地生成：卖点与梗概、全书大纲、每章的章纲、每章的正文。

它面向「有想法但没受过写作训练」的作者：专业起草全部由 AI 完成，你只在每道关卡做判断——通过、修改，或打回重来。工具完全在本地运行，单用户、开源，数据不出你自己的电脑。

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

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="流水线：统一入口 → 预处理（反向 interview）→ 要点 JSON →（预处理关卡）→ 大纲 →（章纲 → 章纲关卡 → 正文 → 正文关卡）× N → 完本" width="960">
</p>
<p align="center"><sub>图 1 · 流水线与关卡：方框为 agent 步骤 / 产物，菱形「审」为人工关卡，虚线为按章循环</sub></p>

预处理先和你确认故事方向；之后每一章都先出章纲、你点头、再写正文、你再过目。产物没通过，流水线绝不继续。

## 架构

整条架构只围绕一个理念：**human-in-the-loop**——机器负责生成，人负责判断，两层之间唯一的通道是关卡：AI 写出的东西，不过关卡就不算数。

<p align="center">
  <img src="./docs/assets/workflow.svg" alt="组成：Pipeline 编排器驱动步骤链（预处理→大纲→章纲→正文），产物落入版本化 Store，作者在关卡把关；右侧放大单个步骤的内部：输入契约 → Agent（LLM + SKILL.md）→ 输出 JSON" width="960">
</p>
<p align="center"><sub>图 2 · human-in-the-loop：判断层（人）与生成层（机器）分治，关卡是两层之间唯一的通道；右侧为单个步骤的内部结构</sub></p>

- **编排器（Pipeline）**：按固定顺序驱动步骤链，用状态机（ready → awaiting-interview / awaiting-approval → complete，由产物状态推导）强制关卡——AI 产出一律 pending，作者通过或编辑保存后才解锁下一步。顺序、关卡、持久化逻辑全部收在这一个模块。
- **步骤（Step）**：每个环节是一次受契约约束的 AI 生成：`runStep` 对输入输出做双向 zod 校验；提示词维护在 SKILL.md 文件里，调 prompt 不改代码。步骤不感知自己在流水线中的位置，因此可独立测试、独立替换。
- **产物（Artifact）**：产出按「作品 + 类型 + 章节」归档为 append-only 版本链（`{kind, chapter?, version, content, humanStatus}`），任何历史版本可回读；人工编辑保存即通过，AI 产出待把关。
- **可替换点**：存储（内存版开箱即用 ↔ SQLite 持久化，#9）与模型（AI SDK `createProviderRegistry`，换厂商 = 换字符串前缀，代码不感知 key）是两个注入点；测试用 FakeStep 跑全链路，从不触网。

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
