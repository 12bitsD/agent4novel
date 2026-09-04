---
name: agent4novel-wiki
description: 面向 Agent 消费和维护 docs/wiki 的每票工程上下文交接。规划、实现、调试或评审既有行为，追查代码或设计为何变化，以及创建、更新、漂移修复或取代 wiki 页面时使用。
---

# Agent4novel Wiki

`docs/wiki/` 是每张 ticket 的工程上下文交接：**原始目的 → 技术与代码落地 → 变化原因 → 下一位 Agent 的接手上下文**。

格式、字段、状态值、固定章节和模板的唯一来源是 [`docs/wiki/README.md`](../../../docs/wiki/README.md)。创建或写入前先读它；本 skill 只规定如何消费和维护，不复制 schema。

开始规划、实现、审核候选/attestation 或交付一张 ticket 时，还必须先完整读取 [`docs/agents/ticket-completion-checklist.md`](../../../docs/agents/ticket-completion-checklist.md)：实现前执行其 C1/C2 前置项，候选形成后继续 C3–C7。清单回指本 skill 时只执行下方 Wiki 路由，不重复读取文件。纯只读解释、调试诊断或尚未进入 ticket 交付的探索不触发完成清单。

## 权威边界

先按问题类型选择来源，不把一个来源的内容搬去另一个：

- **代码与测试**：当前可执行事实。与 wiki 漂移时，以它们判断“现在怎么运行”。
- **wiki**：实现意图、技术落地和变化谱系。它解释“为何如此、从何变化、接下来读什么”。
- **GitHub issue**：WHAT、验收标准和阻塞关系。
- **`CONTEXT.md`**：领域词与禁用同义词。
- **`docs/schema.md`**：当前领域数据模型、形状与不变量。
- **ADR**：不可逆、跨票且长期约束的决定。
- **research**：外部证据、选型论证和实验材料。

发现内容放错地方时，链接到权威来源并收窄 wiki；不要复制另一来源的全文。改变上述知识归属属于 Human-in-loop 例外。

## 消费：先路由，再扩展

### 1. 用线索定位候选页

接受任意可用线索：issue 号、主题、已知 wiki 路径、代码路径、symbol、错误码或错误文本。路径已明确时直接使用；否则先只查 README 规定的规范化 frontmatter，不先扫长正文。

优先查完整的 YAML token，不用 `gate` 之类短子串做模糊正则——它会误中 `investigate-*`。安全示例：

```bash
rg -n --glob '[0-9]*.md' '^(wiki_id|ticket|ticket_state|context_state|summary|topics|code_paths|symbols|inherits|changed_by|read_when|last_context_reviewed):' docs/wiki
rg -n --glob '[0-9]*.md' '^ticket: 16$' docs/wiki
rg -l --glob '[0-9]*.md' '^symbols: .*"ModelRuntime"' docs/wiki
rg -l --glob '[0-9]*.md' '^topics: .*"llm-timeouts"' docs/wiki
rg -l --glob '[0-9]*.md' '^read_when: .*"change-llm-timeout"' docs/wiki
```

先比较候选页的 `ticket_state`、`context_state`、`summary` 与路由字段。`context_state` 是判断页面为 current / mixed / historical 的唯一字段；`changed_by` 只指向后续演进，不能单独推出本页已经失效。

没有 frontmatter 命中时，才用原始线索做字面量正文 fallback；`-F` 不解释正则字符：

```bash
rg -l -F 'A4N_LLM_TIMEOUT_MS' docs/wiki/[0-9]*.md
```

把“元信息漏标”记为下一次获准维护时的修复项，不因此扩大当前任务。

### 2. 只读入口上下文

对每个候选页，第一轮只读：

1. frontmatter；
2. `## Agent Context`。

```bash
sed -n '1,27p' docs/wiki/016-model-runtime-provider-config.md
```

遇到 `Agent Context` 后的下一条二级标题就停止消费；固定上限保证 frontmatter 损坏时也不会意外读完整页。此时应能判断本页是否覆盖当前问题、是否仍为 current、应读哪一节，以及是否需要追溯。

### 3. 通过扩展闸门

每多读一个 section、关系页或代码文件前，先写出它要回答的**一个尚未回答的问题**。`Agent Context` 已经给出足够结论时直接使用，不为“再确认一次”展开祖先、successor 或全部代码。

- 追溯一次设计变化时，默认预算是目标页加一个直接相关的 `changed_by` 页面；只有仍缺原始前提时才读 `inherits`。
- 当前行为会驱动代码修改或结论时，才核对对应代码；纯历史解释不需要重新证明所有继承机制。
- 请求已经明显触发 Human-in-loop 时，只读取目标段落与规则，展示证据和拟议处理后停止；确认前不展开关联页、不运行测试。
- 默认在两篇 wiki、三个代码入口内重新评估。确有未回答问题可以继续，但要逐个说明缺口，不能一次展开整条图。

### 4. 按问题读取目标章节

先用标题拿边界，再只读必要行段：

```bash
rg -n '^## ' docs/wiki/016-model-runtime-provider-config.md
sed -n '/^## 技术方案$/,/^## /p' docs/wiki/016-model-runtime-provider-config.md
```

heading-bounded 命令会额外显示下一条二级标题作为停止边界；不要消费其正文。

- **规划 / 实现**：读 issue 的 AC，再读相关设计、测试、边界和最新交接；无需先读全部历史。
- **调试**：读与错误、路径或 symbol 对应的当前设计和最近变化事件，再到代码与测试验证。
- **评审**：以 issue 检查 WHAT/AC，以 wiki 检查意图、落地与已声明偏差，以代码和测试检查当前事实。
- **追问“为什么”**：读设计目的、起始上下文及相关变化事件；论据在 ADR/research 时沿链接读取，不从头遍历所有引用。

只在当前页留下未解释的起始前提时跟随 `inherits`；只有当前问题需要理解后续演进时跟随 `changed_by`。一次只展开一跳，得到答案即停，不预读整条关系链。页面是否仍代表当前上下文只看 `context_state`。

## 维护模式

先选一个主模式；同一修改确实跨模式时再组合。

### Create

从 issue 获取目的、AC 与 blockers，按 README 的 schema/template 新建一页。`Agent Context` 应让下一位 Agent 不读全文也能判断范围、当前状态、关键代码落点和继续阅读入口。只写已决定或已有证据支持的内容。

### Implementation landing

代码落地后继续执行 Ticket 完成审核清单的 C3–C7；它是 review、知识回写、提交、推送、PR/merge 和远端确认顺序的唯一来源，本 skill 不复制这些步骤。用代码、测试和实际验证刷新当前技术状态、路由元信息与 `Agent Context`，并按 README 在“测试与验证”中留下完成审核证据。有可复用的偏差、失败实验或新决定时追加变化事件；纯机械落地不要制造流水账。

### Design change

先追加变化事件，再更新当前摘要和受影响章节。可逆票内决定留在 wiki；不可逆或跨票约束写入 ADR，wiki 只链接。旧设计仍解释迁移或兼容边界时保留，否则按下方 preservation judgment 处理。

### Drift repair

用代码和测试确认当前事实。机械且无歧义的漂移可自主修正，并记录触发证据和上下文处理；“代码是 bug 还是 wiki 过时”无法从证据确定时，先请求 Human 裁决。

### Supersession

把新页写成新的交接入口；按 README 更新新页的 `inherits` 与旧页的 `changed_by`，并按旧页剩余的当前价值单独设置 `context_state`。旧页保留原始目的和变化谱系，在 `Agent Context` 明确其当前边界及下一跳。不要靠重写旧正文伪装成一直如此。

## Preservation judgment

每次更新都对受影响内容作出一种显式判断：

- **preserve**：原始目的、Human 决定、重要 rationale、仍能防止重踩的失败实验，或解释兼容/迁移所必需的历史。
- **compact**：重复事件、过长诊断过程或已被更好证据取代的细节；保留结论、证据链接和变化顺序。
- **replace**：当前摘要、路由元信息或已由代码明确改变的现行描述；先用变化事件保存“为何改变”。

默认自主维护。以下情况必须在动手前向 Human 展示原文、证据与拟议处理并取得确认：

- 删除或改写原始意图、rationale、失败实验或 Human 决定；
- 漂移存在两种合理解释，无法判断代码是有意现状还是缺陷；
- 改变 wiki、issue、`CONTEXT.md`、ADR、research 或代码之间的 canonical ownership。

## 变化事件

设计变化、漂移修复、重要实施偏差和 supersession 按 README 的事件格式追加到指定位置。每个事件必须完整写出**触发证据、原假设、决定、影响、上下文处理**；最后一项选择 `preserve` / `compact` / `replace`，并说明处理了哪些旧内容及下一跳。

一项变化只记一次；其他章节更新为当前视图并链接该事件。缺乏证据时明确写“待验证”，不要把推测写成决定。

## 最小验证

写入后只验证受影响页面和它直接连接的页面：

```bash
rg -n '^(wiki_id|ticket|ticket_state|context_state|summary|topics|code_paths|symbols|inherits|changed_by|read_when|last_context_reviewed):|^## Agent Context$|^### [0-9]{4}-[0-9]{2}-[0-9]{2}(\.\.[0-9]{4}-[0-9]{2}-[0-9]{2})? — ' docs/wiki/016-model-runtime-provider-config.md
rg -n '^## ' docs/wiki/016-model-runtime-provider-config.md
sed -n '1,27p' docs/wiki/016-model-runtime-provider-config.md
```

同时按 README 检查必填 frontmatter、固定章节、文件名、索引与 issue backlink；抽查本次新增或改动的本地链接。不要为 wiki 维护新增 CLI 或脚本。

## 完成标准

**消费完成**：能用来源链接说明当前行为、相关意图和变化原因；知道候选页为何命中；每次扩展都关闭了一个明确缺口，未回答问题已清零，并停止了无关读取。

**维护完成**：

- README schema/template 校验项全部满足；
- `Agent Context` 与当前代码事实、页面范围和下一跳一致；
- frontmatter 能被原始线索重新 `rg` 命中；
- 每个实质变化都有完整事件，旧内容有 preserve/compact/replace 结论；
- 若本次是 Implementation landing，已执行 Ticket 完成审核清单，且本票“测试与验证”留下 README 规定的完成审核证据；
- Human-in-loop 例外已获确认；
- diff 只包含获准的 wiki 维护范围，没有重复其他权威来源。
