# agent4novel

> 本地优先、单用户、开源的网文写作 agent：你把方向，它填 gap——把一个模糊脑洞，经层层关卡把关，写成一部约 50 万字的长篇。

[English](./README.en.md) · [MIT License](./LICENSE) · [文档导航](#文档)

![License: MIT](https://img.shields.io/badge/license-MIT-blue)

## 它在解决什么

有脑洞，没功底。不会补设定、不会编排大纲、文笔一般——所以脑洞永远停留在脑洞。agent4novel 把「写书」拆成一条固定流水线：预处理 → 卖点+梗概 → 大纲 →（章纲 → 正文）× N。作者只做两件事：**把握故事方向**、**在每个关卡把关**；补全、生成、组织都交给 agent。

## 流水线

<p align="center">
  <img src="./docs/assets/pipeline.svg" alt="流水线：统一入口 → 预处理（反向 interview）→ 要点 JSON →（预处理关卡）→ 大纲 →（章纲 → 章纲关卡 → 正文 → 正文关卡）× N → 完本" width="960">
</p>
<p align="center"><sub>图 1 · 流水线与关卡：方框为 agent 步骤 / 产物，菱形「审」为人工关卡，虚线为按章循环</sub></p>

关卡是硬约束：产物不通过，流程不前进。章纲不通过，正文不会写。

## 快速开始

```bash
pnpm install
pnpm dev        # server :8787 + web :5173
```

打开 <http://localhost:5173>。**不配 key 也能跑**：自动进入演示模式（内置 fake 生成示例内容，不调真模型）。

接真模型：

```bash
export DEEPSEEK_API_KEY=sk-...   # registry 按约定读取，代码零感知 key
pnpm dev
```

## 架构

一句话：**workflow 骨架 + 步骤内 agent**。骨架是固定流水线（顺序、关卡、产物确定）；每个步骤内部是 agent 能力（LLM + prompt/skill 文件）。两者靠一条契约衔接：workflow 明确规定每个步骤的输入与输出（zod 校验），步骤只负责在该步骤内生成。

- **Step 零感知**：步骤不知道自己在流水线里的位置，输出 `{content}` 装整个 JSON；解析、组装、持久化全归 pipeline。
- **两个 seam**：存储（`InMemoryStore` ↔ #9 的 `SQLiteStore`）与步骤（`FakeStep` ↔ `RealStep`）——测试永远跑 fake，不联网。
- **Pipeline 是深模块**：关卡逻辑（`gateAfter` 产出 pending 等 approve / `gateBefore` 要求上游 approved）只活在这一个模块。
- **数据模型五节点**：`preprocess`（预处理要点 JSON）→ `outline`（大纲）→ `setting`（设定）→ `beat`（章纲）→ `prose`（正文）；前三者每作品一份，后两者每作品 × 每章。产物全量版本化（`appendArtifact`），人工保存即通过，agent 产出待把关。
- **interview**：预处理先反向问作者一批问题再归一化；问答态是瞬态内存（重启丢失已接受，#9 持久化）。

## 技术栈

pnpm workspaces · TypeScript 全链 · Vite + React（web）· Hono（server）· zod · Vitest · Vercel AI SDK v7 + `@ai-sdk/deepseek`（`createProviderRegistry`：换 provider = 换字符串前缀，上游零感知）。

```bash
pnpm test        # 全部单测（永远 fake，不联网）
pnpm typecheck
pnpm build
```

## 文档

这套仓库的文档是 agent 可消费的一等公民：

| 文档 | 管什么 |
|---|---|
| [CONTEXT.md](./CONTEXT.md) | 领域词汇表（先读它） |
| [docs/schema.md](./docs/schema.md) | 数据模型单源 |
| [docs/adr/](./docs/adr/) | 不可逆决策（编排、存储、skill 文件） |
| [docs/wiki/](./docs/wiki/) | 每票技术方案 + 状态记录（HOW 的唯一来源） |
| [docs/research/](./docs/research/) | 选型调研（技术栈、LLM provider 策略） |
| [docs/handoff.md](./docs/handoff.md) | 会话接力快照（当前状态与下一步） |

## 开发流程

每张 ticket 走固定 loop：grill 对齐 → wiki 技术方案 → TDD 红绿切片 → 3 轮自校准 → 双轴 code-review。规则见 [docs/wiki/README.md](./docs/wiki/README.md)。

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
