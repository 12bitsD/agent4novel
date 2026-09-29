<p align="center">
  <img src="./docs/assets/logo.svg" alt="agent4novel 书页标志" width="64" height="64">
</p>

<h1 align="center">agent4novel</h1>

<p align="center">AI 辅助的中文网文创作工具 · 在你的电脑上运行，通过浏览器使用</p>

<p align="center">
  <a href="#快速开始">开始试用</a> ·
  <a href="#创作流程">创作流程</a> ·
  <a href="#文档">文档</a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="#当前状态"><img src="https://img.shields.io/badge/status-in_development-555555?style=flat-square" alt="开发中"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT 开源许可"></a>
</p>

输入故事想法，或上传 TXT、Markdown（`.md`）、Word（`.docx`）、PDF 文档中的文字作为素材。AI 提出故事方向、规划情节、补充人物与世界规则，再逐章生成正文。你选择故事方向，修改生成内容，并决定何时开始下一章。

![当前应用的章节目录、正文阅读区和编辑入口](./docs/assets/workspace-demo.jpg)

<p align="center"><sub>实际界面截图，来自演示模式。正文为专门编写的示例，不代表模型生成效果。</sub></p>

<a id="它是怎么工作的"></a>

## 创作流程

作者依次完成下表中的五步。「通过」表示接受当前内容，将其作为后续创作的依据。

| 步骤 | AI 生成的内容 | 作者操作 |
| --- | --- | --- |
| **选择创意稿** | 默认两个故事方向，各自包含故事梗概、主要人物和冲突 | 比较、修改并选定一个方向 |
| **编写大纲** | 全书的情节安排，描述主要冲突如何展开与解决 | 调整情节，再通过大纲 |
| **完善设定** | 人物、人物关系、世界规则等故事背景信息 | 补充或修改，再通过设定 |
| **编写章纲** | 某一章的写作计划：本章目标、内容顺序和结尾 | 直接修改，或让 AI 重新生成，再通过章纲 |
| **撰写正文** | 根据章纲与设定写出的章节文字 | 直接修改，或让 AI 整章重写，再通过正文 |

每章都经过「章纲 → 正文」两步。正文通过后，本章标记为完成；点击「开始下一章」会生成下一章章纲。章节目录支持回看旧章，以及编辑已通过的正文。

已通过的设定和章纲目前不能修改。修改已通过的旧章正文后，已有后续章节会标记「待检查衔接」，提示作者检查情节是否连贯；应用保留后续章节的文字和通过状态，不会自动改写。

## 快速开始

> **试用前请注意：停止或重启本地服务会清空作品。** 当前作品尚未保存到磁盘，需要保留的文字请复制到本地文件。

### 1. 启动演示模式

以下命令适用于 macOS 和 Linux 终端。安装 Git（下载源码）、Node.js 22.13.0 或更高版本（运行程序）和 pnpm（安装项目依赖）后执行：

```bash
git clone https://github.com/12bitsD/agent4novel.git
cd agent4novel
pnpm install
pnpm dev
```

保持终端中的程序运行，在浏览器打开 **[localhost:5173](http://localhost:5173)**。

未指定模型、也未提供 DeepSeek 或 LongCat 的 API key（调用模型服务的密钥）时，应用进入演示模式。演示模式使用内置示例内容，支持选择、编辑和通过操作，**不调用 AI 生成故事**。指定了模型但缺少对应密钥时，应用会启动失败。

### 2. 配置模型服务

目前支持 **DeepSeek** 和 **LongCat**，需要从所选服务获取 API key。

先复制需要保留的文字，再在运行 `pnpm dev` 的终端按 `Ctrl+C` 停止服务。如已有 `.env.local`，直接编辑该文件。首次配置时，在 `agent4novel` 目录运行以下命令，创建配置文件，并设置为仅当前系统用户可读写：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

在 `.env.local` 中选择一种模型服务，填写模型名称和对应密钥，其余配置保留原值：

| 模型服务 | `A4N_MODEL` 的值 | 填写密钥的字段 |
| --- | --- | --- |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| LongCat | `longcat:LongCat-2.0` | `LONGCAT_API_KEY` |

保存文件，再运行 `pnpm dev`。

使用真实模型时，你的输入和生成所需的故事内容会发送给所选模型服务。`.env.local` 不会被 Git 默认加入版本记录；密钥应保留在该文件中。更多配置选项见 [模型配置说明](./docs/wiki/016-model-runtime-provider-config.md#配置契约)。

## 当前状态

**逐章创作已实现，项目仍在开发中。** 当前限制：

- **停止或重启服务会清空作品。** 作品数据保存在由 `pnpm dev` 启动的本地服务内存中，尚未写入磁盘。需要保留的文字请复制到本地文件。
- **正文自动保存到本地服务。** 页面显示「已保存」后，只要服务未停止或重启，刷新浏览器即可恢复正文。设定和章纲尚未提交的手动修改仅留在当前页面，刷新页面或放弃修改后离开会丢失这些修改。
- **尚未完成整本小说的生成质量评估。** 已有测试的范围和结果见 [章节续写验证记录](./docs/wiki/006-chapter-continuation.md#测试与验证)。

<a id="架构"></a>

## 文档

**本 README 面向人类使用者**，说明项目用途、创作流程、安装方法和使用限制。

**工程文档主要面向开发与运行 Agent**，即负责开发、测试或操作项目的 AI 助手；人类开发者也可以查阅。工程设计与验证记录在 Wiki，需求与验收标准在 Issues，优先级与排期在 Project。

<a id="技术栈"></a>
<a id="开发流程"></a>
<a id="开发"></a>

<details>
<summary>Agent 工程文档入口</summary>

- **开发规则**：[AGENTS.md](./AGENTS.md) 与 [完成检查清单](./docs/agents/ticket-completion-checklist.md)。
- **运行与排障**：[运行指引](./.claude/skills/agent4novel-drive/SKILL.md)、[模型配置](./docs/wiki/016-model-runtime-provider-config.md)、[命令行用法](./docs/wiki/014-agent-cli-telemetry.md)。
- **设计与实现**：[工程 Wiki](./docs/wiki/README.md)、[架构决策](./docs/adr/)、[调研依据](./docs/research/)。
- **术语与数据定义**：[领域词汇表](./CONTEXT.md)、[数据模型](./docs/schema.md)。
- **任务交接**：[交接记录](./docs/handoff.md)。

</details>

## 路线图

[Issues](https://github.com/12bitsD/agent4novel/issues) 记录需求、验收标准和处理状态；[初版功能范围](https://github.com/12bitsD/agent4novel/issues/1) 说明计划覆盖的功能。[Project 看板](https://github.com/users/12bitsD/projects/3) 管理优先级和排期，目前为私有，需要访问权限。

---

<p align="center">
  <a href="https://github.com/12bitsD/agent4novel/issues">反馈问题或建议</a> ·
  <a href="./LICENSE">MIT 开源许可</a>
</p>
