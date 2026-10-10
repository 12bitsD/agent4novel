# Project Wiki — 按 Ticket 继承的工程上下文

本 Wiki 让后续 Agent 继承每张 ticket 的工程心智模型：**原本为什么设计、实际落了什么代码、后来为什么改变，以及下一步可以继续假定什么**。每张 ticket 仍是一篇独立上下文节点；代码和测试负责证明当前行为，Wiki 负责保存代码本身无法说明的意图与演进原因。

核心读者是规划、实现、调试和评审本项目的 Agent。默认先按 `.claude/skills/agent4novel-wiki/SKILL.md` 检索并读取 `Agent Context`，只有任务需要时才展开技术方案或历史。

恢复项目进度时，先读 [交接快照的当前里程碑与验证边界](../handoff.md#当前里程碑与验证边界)，再按本页索引进入相关 ticket。首章闭环、续章及完整 MVP 的完成状态分别核对 [#22](https://github.com/12bitsD/agent4novel/issues/22)、[#6](https://github.com/12bitsD/agent4novel/issues/6) 和 [#1](https://github.com/12bitsD/agent4novel/issues/1)。MVP 后的已交付增量见 [Wiki 051](./051-node-iteration-records.md)、[Wiki 046](./046-sqlite-concurrent-initialization.md)、[Wiki 012](./012-creative-regeneration.md) 和 [Wiki 020](./020-beat-variant-compare.md)。当前 Kimi 候选从 [#60](https://github.com/12bitsD/agent4novel/issues/60) 与 [Wiki 060](./060-kimi-provider.md) 进入；后续顺序见 [第二期路线](../plans/mvp-phase2-roadmap.md)。

## 读者与内容边界

- **人类使用者**：根目录 [README](../../README.md) 集中介绍项目用途、创作流程、安装方法与使用限制；英文版与中文旧路径保持同步。首次使用所需的说明在 README 内完整给出。
- **开发与运行 Agent**：工程设计、代码落点、验证证据和变化原因保存在本 Wiki；操作流程、术语、数据模型及架构决定仍由下表和 [AGENTS.md](../../AGENTS.md) 指定的来源维护。人类开发者可以按需查阅这些文档。
- **共同协作**：issue 保存需求、验收标准和阻塞关系，Project 保存优先级与排期；README 提供入口。

新增内容按用途归属：影响使用者操作或预期的事实，在 README 中用日常语言说明；开发、调试、评审和交接所需的工程细节，保留在相应 Agent 文档。README 的 Agent 区只提供带用途的链接，不复制操作规范、协议或交付记录。

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
| [001 MVP 工程验收](./001-mvp-acceptance.md) | [#1](https://github.com/12bitsD/agent4novel/issues/1) | current | 本机单用户闭环、各验证面与后续拓展入口 |
| [002 脚手架、存储、workflow 与书架](./002-scaffold-storage-runner-bookcase.md) | [#2](https://github.com/12bitsD/agent4novel/issues/2) | mixed | monorepo、store、基础 pipeline、书架 |
| [003 统一入口与 idea 工作区](./003-unified-entry-idea-workspace.md) | [#3](https://github.com/12bitsD/agent4novel/issues/3) | mixed | 创建作品、文件导入、早期编辑链路 |
| [004 大纲弧线与剧情点](./004-outline-arcs-segments.md) | [#4](https://github.com/12bitsD/agent4novel/issues/4) | mixed | outline 契约、关卡、编辑界面 |
| [005 第一章章纲生成与通过](./005-beat-generation-review.md) | [#5](https://github.com/12bitsD/agent4novel/issues/5) | mixed | 章纲编辑／再生／通过已接线；Agent 可观测协议、验证与交付证据 |
| [006 后续章续写与跨章创作](./006-chapter-continuation.md) | [#6](https://github.com/12bitsD/agent4novel/issues/6) | mixed | 显式下一章、上一章承接、章节目录与历史编辑隔离 |
| [007 作者 Agent 配置](./007-author-agent-config.md) | [#7](https://github.com/12bitsD/agent4novel/issues/7) | mixed | 三维偏好、默认与节点覆盖、版本文件及生成快照 |
| [008 正文坏例收集](./008-bad-example-collection.md) | [#8](https://github.com/12bitsD/agent4novel/issues/8) | current | 已保存正文选段、备注、不可变来源快照与回看 |
| [009 SQLite 持久化](./009-sqlite-persistence.md) | [#9](https://github.com/12bitsD/agent4novel/issues/9) | mixed | 作品与全部产物版本、事务条件写入、数据目录与重启恢复 |
| [010 预处理 RealStep 与 interview](./010-preprocess-realstep-interview.md) | [#10](https://github.com/12bitsD/agent4novel/issues/10) | historical | 已被替代的 preprocess 方案及其遗留机制 |
| [011 Caption 与 Creative 方向包](./011-caption-creative-directions.md) | [#11](https://github.com/12bitsD/agent4novel/issues/11) | mixed | 提炼稿、创意稿、选择关卡；R10 A SP 采用依据、对照迭代与逐版反思 |
| [012 创意稿整步再生与失败重试](./012-creative-regeneration.md) | [#12](https://github.com/12bitsD/agent4novel/issues/12) | current | 补充想法、整步再生、固定版本条件与未知结果恢复 |
| [013 完整设定生成与一次通过](./013-setting-generation-review.md) | [#13](https://github.com/12bitsD/agent4novel/issues/13) | mixed | 设定生成、页内编辑、同版本原子通过、失败对账 |
| [014 Agent CLI 与遥测](./014-agent-cli-telemetry.md) | [#14](https://github.com/12bitsD/agent4novel/issues/14) | mixed | 作品 CLI、run-step 单节点 SP 对照、smoke、安全 telemetry |
| [016 模型运行配置](./016-model-runtime-provider-config.md) | [#16](https://github.com/12bitsD/agent4novel/issues/16) | mixed | provider、凭据、timeout、生成参数默认与覆盖、ModelRuntime |
| [018 冲突检测与作者澄清](./018-conflict-clarification.md) | [#18](https://github.com/12bitsD/agent4novel/issues/18) | current | Setting 前非阻断 review note、作者 disposition、stale 与显式上下文 |
| [019 契约治理](./019-contract-governance.md) | [#19](https://github.com/12bitsD/agent4novel/issues/19) | current | 全 kind/status 内容校验、Store 与公开协议边界 |
| [020 章纲再生后的比较与选择](./020-beat-variant-compare.md) | [#20](https://github.com/12bitsD/agent4novel/issues/20) | current | 当前 pending beat 的 A/B 比较、选择与 CAS |
| [021 章节重生](./021-chapter-regeneration.md) | [#21](https://github.com/12bitsD/agent4novel/issues/21) | current | 通过后历史章两阶段重生、历史 Artifact Harness 读取与连续性提示 |
| [022 第一章正文](./022-prose-generation-review.md) | [#22](https://github.com/12bitsD/agent4novel/issues/22) | mixed | 首章生成／自动保存／整章重写／通过后编辑 |
| [025 CLI 命令发现与参数校验](./025-cli-command-safety.md) | [#25](https://github.com/12bitsD/agent4novel/issues/25) | current | 帮助零副作用、严格参数与安全 usage |
| [033 本机 Docker 与 CI](./033-local-docker-ci.md) | [#33](https://github.com/12bitsD/agent4novel/issues/33) | current | 同源生产服务、整个数据目录卷、容器恢复与无密钥 CI |
| [035 黑白灰写作工作台](./035-frontend-design.md) | [#35](https://github.com/12bitsD/agent4novel/issues/35) | mixed | 已交付的 B/C 视觉、主题选择与像素品牌；阅读比例与目录断点后续由 047 细化 |
| [041 README 与 MVP 清点交接](./041-readme-mvp-handoff.md) | [#41](https://github.com/12bitsD/agent4novel/issues/41) | current | 用户入口、清点文档及三项待修复边界的发布 |
| [043 MVP 复审边界修复](./043-mvp-review-boundary-fixes.md) | [#43](https://github.com/12bitsD/agent4novel/issues/43) | current | 配置导航、原起章基线和静态文件规范路径 |
| [047 阅读排版与组件比例](./047-reading-layout-refinement.md) | [#47](https://github.com/12bitsD/agent4novel/issues/47) | mixed | 阅读列对齐、短章自然高度、控件密度及中屏单列；发布终态以 GitHub 为准 |
| [049 作者编稿台](./049-author-workbench.md) | [#49](https://github.com/12bitsD/agent4novel/issues/49) | current | 稳定作品壳、材料交接、导航恢复与大纲可见版本 |
| [046 SQLite 并发首次建库](./046-sqlite-concurrent-initialization.md) | [#46](https://github.com/12bitsD/agent4novel/issues/46) | current | 首次并发初始化的 busy 有界重试、事务恢复与安全诊断 |
| [051 节点实际输入输出记录与 Agent 迭代](./051-node-iteration-records.md) | [#51](https://github.com/12bitsD/agent4novel/issues/51) | current | 已交付的 `run-step` 实际调用记录、A/B 对照与 comment |
| [060 Kimi API provider 与测试模型切换](./060-kimi-provider.md) | [#60](https://github.com/12bitsD/agent4novel/issues/60) | current | Kimi OpenAI-compatible provider、凭据/Base URL、通用测试模型与回归边界 |
