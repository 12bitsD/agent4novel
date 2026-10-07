---
wiki_id: "051"
ticket: 51
ticket_state: active
context_state: current
summary: "开发Agent可用的节点实际调用记录，复用run-step支持review/modify、输入输出和A/B + comment"
topics: ["node-iteration", "agent-cli", "system-prompt", "context-control", "private-experiment-records"]
code_paths: ["apps/cli/src/local-step.ts", "apps/cli/src/command-line.ts", "apps/server/src/step-lab-main.ts", "apps/server/src/steps/isolated-runner.ts", "apps/server/src/steps/llm-call.ts", "packages/contracts/src/step-experiment.ts"]
symbols: ["run-step", "runLocalStep", "runIsolatedStep", "callLlm", "--record-dir"]
inherits: ["014", "011", "016"]
changed_by: []
read_when: ["develop-node-iteration", "record-isolated-step", "review-node-input-output", "compare-system-prompts"]
last_context_reviewed: "2026-10-07"
---

# 051 — 节点实际输入输出记录与Agent迭代

## Agent Context

- **读取时机**：开发节点记录、检查实际输入输出、单节点A/B或comment使用方式。
- **原始目的**：让用户通过Agent方便地review/modify SP/context/Harness、看输入输出、A/B + comment，减少重复操作和无用基础设施。
- **实际落地**：[#51](https://github.com/12bitsD/agent4novel/issues/51)已创建并claim给12bitsD，ready-for-agent；需求和实施方案已建立，产品代码与新增测试尚未实现。
- **当前价值**：本票WHAT/AC以GitHub为准，本页给最小HOW、代码落点和TDD切片；普通工程细节自主收敛，不再重开已确认的Agent入口与三动作范围。
- **后续变化**：输入捕获/归档/联验依序实现；此处不把方案或旧测试当成本票已通过的能力。
- **代码入口**：local-step/step-lab-main负责CLI-worker交接；isolated-runner负责最终节点结果；callLlm是六节点共同SDK调用边界；step-experiment定义已有输入/结果。

## 设计目的

用户能在聊天中指出一个具体问题。Agent读取真实输入输出，修改相关SP/context/Harness，按授权复跑，需要时复用可比的旧A与新B对照，记录用户原话并继续。当前缺口是运行材料可保存、重读，尤其是实际装配后的system/user内容；不新建实验管理或评阅平台。

需求、AC1–AC9与非目标见issue。先前已收敛的工作方式见[最小工作流](../plans/node-iteration-workbench.md)与[Agent操作方式](../plans/node-iteration-agent-review.md)。

## 起始上下文

固定点main `ce66affa3a0bf6ee76efde60dccb83c1ce396e46`。实现阶段拟使用本地已 claim 的源分支 `feat/51-node-iteration-records`→PR→main；当前尚无 #51 代码提交或 PR，本页不把预定交付路径写成已发生事实。远端main无保护、rulesets为空，CI有quality/container，发布前仍重新核对。

2026-10-07用户明确“需要开发…先claim…Wiki和github issue…具体需求+方案”。此前只做设计没有开发票；本次创建51并claim，回读OPEN/assignee12bitsD/ready-for-agent，无Project/阻塞。完成时保持现有标签/assignee/依赖，Project该部分N/A，不联动其他票。

现有开放票46/29/28/21/20/18/17/15/12未覆盖本最小需求，无重复票。3份已有未跟踪方案/研究均为本会话自有资料，本票纳入；原主目录仍保留，活动工作树复用已附着author-workbench，源代码与main基线一致。模型密钥与现有作品/演示数据不复制、不改写。

C1证据：/tmp/a4n-node-iteration-dev-evidence中的open-issues-baseline.json、main-baseline.json、issue-51-baseline.json、dependencies.json、issue-body.md。当前仅完成需求建档/claim阶段，后续审核/测试/发布均待实际执行。

## 技术方案

### 1. 最小接缝选择

已核对三条机制：把六节点装配全部提成新builder；在现有共同调用边界增加仅实验启用的捕获；另写实验专用装配。选择第二条：改动较少，能记录当前真实传给SDK的内容，并保持生产与实验同源。第三条易与生产漂移；第一条不是本票先决条件。选择不代表实现已验证。

拟议新入口：run-step原语法增加可选 `--record-dir <dir>`。不给参数时行为完全保留。modify仍由Agent修改普通文件/代码并展示diff；A/B通过读取本地记录完成，comment用本轮comments.md保存，不创建独立会话/评分/采用模型。

### 2. 捕获边界与结果语义

在callLlm实际构造generateObject参数的位置捕获system、prompt、解析后的model/generation以及明确传入的输出上限/重试选项。使用仅runIsolatedStep范围启用的observer/上下文，避免全局可变sink污染并发调用；生产调用没有sink时不产生全文记录。

捕获的是传给SDK的值，不是SDK/provider后续转换的HTTP报文。未传入的选项保留缺失语义，不猜SDK/provider默认或是否真正遵循。捕获文本逐字符匹配SDK入参，schema与既有consume guards不绕过。

最终结果由独立runner/worker返回或记录：Creative/Outline/Setting/Beat在模型之后补结构ID，仅在callLlm记录model object不足以代表最终产物。result保存现有StepExperimentResponse的校验后content/失败与telemetry；不声称是provider原始输出，失败原始文本不在范围内。

### 3. 一次运行一个私有目录

Agent指定尚不存在的本次记录目录，推荐.data/experiments/<本轮>/<A或B>（占位示例，非现存目录）。目录在发请求前做路径/权限/碰撞检查；拒绝破坏性覆盖、保留旧记录。实际实现对符号链接/路径归属及文件权限的保证由确定性测试锁定。

拟议最少4份记录：input.json（供实验使用的源输入/配置）、invocation.json（实际SDK输入或明确未捕获）、result.json（最终节点结果或安全失败/unknown）、meta.json（格式版本、节点/run标识、时间、代码commit/dirty等可确认标识与文件关联）。文件命名/有限schema在第一片测试中固定；不建立服务/数据库。comments.md由Agent保存用户原话，Agent解释另列，不改机器结果。

CLI版本信息HEAD/dirty只报告可确认内容；dirty不冒称已冻结或可重现。完整prompt/素材仅进入显式私有本地归档，不加进现有stdout/stderr/telemetry，不录credential配置或请求头、不上传外部服务。自定义内容可能含用户私有文本，按本地实验材料处理。

### 4. 失败、期限与落盘

输入/预算/配置在SDK前失败时，可以没有invocation，明确“未调用/未捕获”；不能根据源文件捏造实际请求。provider/model timeout保留现有llm-timeout语义；CLI deadline保留现有network-error并说明本地中断/结果未知，不断言provider取消或零计费。模型结果可判定时与未知分开，不自动重发。

记录失败不应被callLlm的model catch误分成llm-unavailable；落盘成功与模型成功是不同事实。无法安全准备记录位置时先停止发请求；调用已完成但收尾写入失败时，保留已写证据并报告归档未完成，不声称模型未执行。原子写入/完成标志与父子进程最终写入责任在实现测试中固定，不凭路径存在断言完整。

### 5. Agent如何使用

Agent直接读记录文件，展示当前问题相关SP/context/Harness差异、实际输入和原输出。比较时核对节点、源输入、模型/参数、代码与待测因素；条件不全或不同就说明，不能伪称单因素公平对照。可比旧A直接复用，不计新调用/独立重复。用户原话comment留在本轮；需要继续时读取这些文件即可。

用户明确接回基础版本时仍走现有源码审核流程；实验记录不创建WorkStore/Pipeline，不修改作者作品、批准状态或已有章节。

## 代码落点

| 责任 | 当前入口/拟议新增位置 |
| --- | --- |
| CLI参数、帮助、文件/版本与worker启动 | apps/cli/src/command-line.ts、main.ts、local-step.ts |
| 共同实际调用捕获（拟议小模块） | apps/server/src/steps/llm-call.ts、steps下的实验捕获模块 |
| 最终结果/错误与记录交接 | apps/server/src/steps/isolated-runner.ts、apps/server/src/step-lab-main.ts |
| 内部记录契约（按最小跨包需要新增） | packages/contracts/src/step-experiment.ts或相邻实验记录schema |
| 文档/运行方法 | 本页、schema受影响部分、CLI help、drive skill、README中英、handoff |

## 测试与验证

TDD计划（尚未运行）：

1. S1 SDK边界：mock generateObject，先复现缺少记录；验证system/prompt/settings精确匹配、未传字段缺失、六节点捕获、并发隔离、默认生产无全文。
2. S2 CLI/worker：先复现新flag不存在；验证help零I/O、参数/私有目录预检、记录读取成功、最终ID已注入结果、各失败/期限/归档错误和旧语法结果兼容。
3. S3 Agent联验：用合成内容/本地SDK transport完成正文记录→A/B文件读取→comment→下一版，验证复用A无新调用、读取评论不修改机器记录或作者作品；补齐文档并跑全test/typecheck/build。

公开接缝使用CLI进程、SDK transport、共享输入/输出schema和实际文件内容，不针对私有函数/目录结构镜像测试。真实provider调用在必要时使用已授权配置与明确小样本预算；不沿用先前934项门禁当本票结果，不把fake链路当文学质量。

AC映射：AC1/5→S2；AC2→S1；AC3/4/6→S1+S2；AC7→S3；AC8→三片公开联验；AC9→知识/完整门禁/独立审核/CI回读。scope-check报告在/tmp/a4n-iteration-ticket-scope-check.md，明确SDK边界、最终产物和错误分类；它是实施前核对，不是正式候选review。

### 完成审核证据

- **清单与候选**：固定点/源分支已知；当前无实现候选，T0/T1与清单blob待后续审核。
- **逐项判定**：C1需求/claim/范围/计划已有证据；产品实现、门禁与正式审核未执行，不预写PASS。
- **验收与 TDD**：AC1–AC9与S1–S3已映射；RED/GREEN待实际执行。
- **本地门禁**：本次只做文档结构/链接核对；全测试、typecheck、build及实现安全核查待执行。
- **双轴 review**：实施前scope核对已完成；正式Standards/Spec待冻结候选。
- **修复与回归**：待实际实现/发现；不补造失败或通过。
- **知识维护**：本页、Wiki索引与已收敛方案回链；schema/README/handoff/drive在行为落地后同步，CONTEXT/ADR是否受影响届时按真实变化记录。
- **发布前裁决**：待实现/候选审核，不提前宣称交付、CI、merge或关闭。

## 边界与非目标

不做评阅平台/专用UI、会话/采用卡/量规、独立评委或自动judge，不固定样本数/重复次数；不新增自动baseline或自动晋升，不读取任意作品历史全文，不接作品Wiki/工具循环。旧14实验能力和安全遥测保留，失败原文采集与真实模型质量验证不扩入本票。

第一版只落实实际调用可检查和结果/comment可读写。文件式归档也有权限、碰撞、部分写入和迟到结果风险，必须测试；不因“本地文件”声称自动具备事务或崩溃恢复。

## 上下文演进

### 2026-10-07 — 从已对齐的简单工作流进入开发claim

- **触发证据**：用户要求停止复杂设计，认可review/modify、输入输出、A/B + comment，并明确要在GitHub/Wiki claim和给需求/方案。
- **原假设**：前几轮只有方案收敛，尚未创建实施票。
- **决定**：新建51并claim，以一个可选本地记录入口复用生产SDK调用边界；评论/读取由Agent完成。
- **影响**：源分支固定、AC/TDD和代码接缝建立，后续按三片实施而非扩成平台。
- **上下文处理**：preserve用户三动作与Agent入口决定、已有实验方法；compact冗余设计为可选研究/私有历史；replace当前进行中入口为本票，不修改旧票冻结审核。

## 交接结论

51已claim，需求及最小HOW已就绪；实现/新测试未开始。下一动作是S1实际SDK捕获的有效RED，再依序补CLI/worker与Agent文件联验；代码落地后按规范回写和独立审核。无需再问CLI还是平台，也不自动把comment转成新费用或生产发布。
