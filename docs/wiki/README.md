# Project Wiki — 按 Ticket 继承的工程上下文

本 Wiki 让后续 Agent 继承每张 ticket 的工程心智模型：**原本为什么设计、实际落了什么代码、后来为什么改变，以及下一步可以继续假定什么**。每张 ticket 仍是一篇独立上下文节点；代码和测试负责证明当前行为，Wiki 负责保存代码本身无法说明的意图与演进原因。

核心读者是规划、实现、调试和评审本项目的 Agent。默认先按 `.claude/skills/agent4novel-wiki/SKILL.md` 检索并读取 `Agent Context`，只有任务需要时才展开技术方案或历史。

## 信息边界

同一事实只保留一个权威来源，Wiki 通过链接继承，不复制整份内容。

| 来源 | 权威内容 | Wiki 如何使用 |
|---|---|---|
| GitHub issue | WHAT、验收标准、阻塞关系 | 摘要目的并链接，不复制正文 |
| `CONTEXT.md` | 领域词汇 | 使用其术语，不重新定义 |
| `docs/schema.md` | 当前数据模型 | 记录某票如何改变模型，当前形态直接链接 schema |
| `docs/adr/` | 不可逆架构决策 | 引用；新决策另立 ADR |
| `docs/research/` | 调研证据 | 引用结论和证据，不复制论证 |
| 代码与测试 | 当前可执行行为 | Wiki 提供入口、symbol 和设计理由；发生冲突时先验证代码 |
| `docs/wiki/` | 每票的目的、方案、代码落点、变化原因和交接边界 | 保存工程上下文继承链 |

## 命名与关系

文件名使用 `docs/wiki/NNN-<slug>.md`。`NNN` 是至少三位、左侧补零的 GitHub issue 号，例如 issue `#4` 对应 `004-*.md`；超过三位时保留完整数字。

每篇只描述一张 ticket。跨票演进通过两种关系表达：

- `inherits`：本票开始时直接继承、理解本票时可能需要追溯的上下文。
- `changed_by`：后续 ticket 改变或扩展了本票的部分结论；具体范围必须在 `Agent Context` 和“上下文演进”中说明。页面是否仍可用于当前任务只看 `context_state`，不能从这个关系字段推断。

## Frontmatter 契约

Frontmatter 是快速路由入口。字段顺序固定，数组保持单行，确保 `rg` 不解析 Markdown 正文也能筛选候选页。

```yaml
---
wiki_id: "016"
ticket: 16
ticket_state: done
context_state: current
summary: "统一模型运行配置、provider、凭据与超时边界"
topics: ["model-runtime", "provider", "credentials", "timeout"]
code_paths: ["apps/server/src/steps/llm.ts", "apps/server/src/config/**"]
symbols: ["ModelRuntime", "A4N_MODEL"]
inherits: ["014"]
changed_by: []
read_when: ["configure-model", "add-provider", "diagnose-llm"]
last_context_reviewed: "2026-09-04"
---
```

字段值遵循以下约束：

| 字段 | 约束 |
|---|---|
| `wiki_id` | 与文件名前缀一致的字符串 |
| `ticket` | GitHub issue 整数 |
| `ticket_state` | `planned`、`active` 或 `done` |
| `context_state` | `current`、`mixed` 或 `historical` |
| `summary` | 一行说明本票最终留下的能力 |
| `topics` | 稳定主题 slug，不写临时任务描述 |
| `code_paths` | 代码入口或 glob；只列高信号路径 |
| `symbols` | 类型、函数、命令、错误码或配置名 |
| `inherits` | 直接前置 Wiki ID，不展开整条祖先链 |
| `changed_by` | 改变或扩展本票上下文的后续 Wiki ID；不表示整页失效 |
| `read_when` | Agent 任务触发词 slug |
| `last_context_reviewed` | 最近一次人工或 Agent 审核上下文的日期；不等于代码已验证日期 |

`context_state` 与 ticket 是否完成是两回事：

- `current`：声明范围内的上下文仍可用于理解当前实现。
- `mixed`：仍有当前价值，但部分结论已被后续 ticket 改变；顶部必须点明边界。
- `historical`：只用于追溯目的、方案或变化原因，不能作为当前实现说明。

## 正文模板

所有新建或改造后的页面使用相同一级结构，让 Agent 可以按 heading 读取局部内容。

```markdown
# NNN — 标题

## Agent Context

- **读取时机**：什么任务、路径、symbol 或错误应读本页。
- **原始目的**：为什么启动本票。
- **实际落地**：最终形成的能力。
- **当前价值**：今天仍应继承的上下文。
- **后续变化**：哪些结论被谁改变。
- **代码入口**：优先阅读的文件和 symbol。

## 设计目的
## 起始上下文
## 技术方案
## 代码落点
## 测试与验证
## 边界与非目标
## 上下文演进
## 交接结论
```

“技术方案”解释结构、接口和取舍；“代码落点”只做导航，不大段复制可从代码直接看到的内容。“交接结论”明确下一位 Agent 可以假定什么、不能假定什么，以及应继续读哪张 ticket。

## 记录设计变化

有解释价值的变化按事件记录。普通格式调整、文件移动或机械测试数字可以压缩进一个落地事件。

```markdown
### YYYY-MM-DD — 变化标题

- **触发证据**：什么事实暴露了原方案的问题。
- **原假设**：此前为什么认为原方案可行。
- **决定**：改成什么，以及为什么。
- **影响**：代码、契约、后续 ticket 或操作方式受到什么影响。
- **上下文处理**：`preserve`、`compact` 或 `replace`，并说明保留尺度。
```

同一变化跨越多天时使用 `YYYY-MM-DD..YYYY-MM-DD — 变化标题`，不要改用自然语言日期范围或其他分隔符。

Agent 默认自主判断保留、压缩或替换；可能损失原始目的、设计理由、失败经验、人工裁决，或改变知识归属时，按项目 Wiki Skill 请求 Human 确认。

具体创建、实现回写、设计变化、漂移修复、关系维护与最小读取步骤只在项目 Wiki Skill 中定义，避免两套流程漂移。

## 完成审核证据

每张 ticket 的完整完成流程只在 [Ticket 完成审核清单](../agents/ticket-completion-checklist.md) 中维护。数字 Wiki 不复制清单；在“测试与验证”末尾按以下格式保存发布前证据。review 前可以先写已取得的部分，其余标为待完成；发布前必须由最终 attestation 收口。

```markdown
### 完成审核证据

- **清单与候选**：清单 blob 标识、固定点 SHA、双轴候选 T0、pre-attestation tree（T1）、staged manifest；最终 tree（T2）不在其自身内容中记录。
- **逐项判定**：C1–C5 各节及 C6.1–C6.4；每个 `PASS` 条目列出 ID 和证据引用，一份证据可覆盖多个明确 ID；所有 `N/A`、`FAIL` 与例外列出 ID、原因与风险。C6.5–C6.7 及最终 `C6 = PASS` 留给 GitHub 完成评论。
- **验收与 TDD**：issue #NN；逐条 AC 的代码或人工验证入口；RED/GREEN 或替代验证证据。
- **本地门禁**：最终候选执行的命令、结果、日期与关键警告；secret/安全检查结论。
- **双轴 review**：相互隔离的 Standards 与 Spec 结论；发现及其处理。
- **修复与回归**：修复项、补充证据、重跑范围和最终结果。
- **知识维护**：Wiki/schema/CONTEXT/ADR/research/README/handoff/运行 skill 的更新项或 `N/A（原因）`。
- **发布前裁决**：独立 reviewer 对 T1 的 `PASS`/`FAIL` attestation、剩余风险与待办。
```

证据记录发布前事实；T0 → T1 与 T1 → T2 的受控证据收口按清单 C6.4/C6.6 比较。后者及 C6.7 的结果不再写回同一候选，而在 GitHub 完成评论中汇总。commit、push、PR/merge、CI 与关闭方式/条件也写入该评论，实际关闭结果以随后回读的 live issue state 为准。这样无需为补记远端结果再创建一轮文档提交与审核。`N/A` 必须附原因与风险，未执行的检查不能写成通过。

## Index

| Wiki | Ticket | 上下文状态 | 主要范围 |
|---|---:|---|---|
| [002 脚手架、存储、workflow 与书架](./002-scaffold-storage-runner-bookcase.md) | [#2](https://github.com/12bitsD/agent4novel/issues/2) | mixed | monorepo、store、基础 pipeline、书架 |
| [003 统一入口与 idea 工作区](./003-unified-entry-idea-workspace.md) | [#3](https://github.com/12bitsD/agent4novel/issues/3) | mixed | 创建作品、文件导入、早期编辑链路 |
| [004 大纲弧线与剧情点](./004-outline-arcs-segments.md) | [#4](https://github.com/12bitsD/agent4novel/issues/4) | current | outline 契约、关卡、编辑界面 |
| [010 预处理 RealStep 与 interview](./010-preprocess-realstep-interview.md) | [#10](https://github.com/12bitsD/agent4novel/issues/10) | historical | 已被替代的 preprocess 方案及其遗留机制 |
| [011 Caption 与 Creative 方向包](./011-caption-creative-directions.md) | [#11](https://github.com/12bitsD/agent4novel/issues/11) | mixed | 提炼稿、创意稿、选择关卡、读模型 |
| [014 Agent CLI 与遥测](./014-agent-cli-telemetry.md) | [#14](https://github.com/12bitsD/agent4novel/issues/14) | mixed | CLI、smoke、LLM telemetry |
| [016 模型运行配置](./016-model-runtime-provider-config.md) | [#16](https://github.com/12bitsD/agent4novel/issues/16) | current | provider、凭据、timeout、ModelRuntime |
