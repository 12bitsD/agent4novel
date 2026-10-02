---
wiki_id: "025"
ticket: 25
ticket_state: done
context_state: current
summary: "CLI 帮助零副作用、严格参数校验和安全一致的用法错误；不改变作品命令语义。"
topics: ["agent-cli", "command-help", "argument-validation", "safe-discovery"]
code_paths: ["apps/cli/src/main.ts", "apps/cli/src/command-line.ts", "apps/cli/test/command-entry.test.ts", "apps/cli/test/cli-process.ts"]
symbols: ["a4n", "helpFor", "parseCommandLine", "usage", "--help"]
inherits: ["014"]
changed_by: ["041"]
read_when: ["change-cli-command", "debug-cli-arguments", "discover-cli-command"]
last_context_reviewed: "2026-10-03"
---

# 025 — CLI 命令发现与参数校验

## Agent Context

- **读取时机**：修改 CLI 帮助、参数或入口错误语义时读取。
- **原始目的**：避免 Agent 查看子命令帮助时触发写入，以及拼错参数后执行了另一种操作。
- **实际落地**：14 个子命令共享帮助和严格语法验证，帮助在 I/O 前返回；非法调用输出安全 usage JSON。[PR #26](https://github.com/12bitsD/agent4novel/pull/26) 已合并，[Issue #25](https://github.com/12bitsD/agent4novel/issues/25) 已关闭；验证与追溯入口见下方。
- **当前价值**：本票拥有 CLI 命令发现与参数语法；作品流程、结果与遥测仍归 [014](./014-agent-cli-telemetry.md)。
- **后续变化**：无；统一结果 envelope、请求准备/预检/导出属于后续独立范围。
- **代码入口**：[command-line.ts](../../apps/cli/src/command-line.ts) 的 `helpFor` / `parseCommandLine`、[main.ts](../../apps/cli/src/main.ts)、真实 CLI 入口测试。

## 设计目的

[Issue #25](https://github.com/12bitsD/agent4novel/issues/25) 的 WHAT/AC 是范围权威。CLI 的帮助和用法检查必须先于任何 HTTP、文件读取和 worker 操作；参数误用应安全失败，合法调用沿用既有业务契约。

## 起始上下文

固定点 `943086f971e631ab4df9b55fd6d16c6e18c5a781`，从干净 main 建立 `feat/25-cli-command-safety`。临时 loopback 服务曾记录 `advance <work> --help` 与 `approve <work> outline --help` 的 POST；旧解析器把所有长选项视为有值，dispatch 没有统一帮助与参数检查。

本轮范围对齐：用户在已展示复现及分步设计后要求“做一轮优化，提 issue、起分支、close”。选择最先可独立交付的调用安全切片，经 PR 合并 main 后发布完成摘要并关闭；不改其他票。问题、影响与最小验收已由上一轮 CLI 实测明确，本轮沿用已演示的 CLI 进程＋临时 loopback 服务作为测试 seam。没有新增产品取舍或测试 seam。

决策树收口：帮助无副作用 → 必须在 I/O 前短路；误参数不静默忽略 → 各命令统一语法验证；兼容业务调用 → 保留数据形状、期限、人工关卡及 advance 业务 failed 的既有出口。单独 `--help/-h` token 是帮助；需要字面值时使用 `--flag=--help`。没有剩余决策分支。本地没有项目 Matt flow 命令入口，按完成清单执行了等价的范围、假设、风险、验收对齐。

## 技术方案

### 实施计划与 TDD 切片

1. 通过真实可执行 CLI＋临时 loopback 捕获帮助误写 RED，再实现顶级和子命令帮助短路；验证 help 在非法配置或缺文件时仍返回、零请求。
2. 新增真实入口非法参数 RED；用一个轻量命令定义集中参数语法、必需项和帮助，严格拒绝未知/重复/缺值/空值/位置参数错误/互斥输入；安全 usage JSON。
3. 验证合法 HTTP 调用及 run-step 既有输入行为；完成 CLI 定向及全仓测试、类型检查、构建，保持未修改领域契约。
4. 同步 Wiki、运行 skill、README/handoff；完成三轮自校准和双轴 review。预留证据按清单完成 T0→T1→T2 收口，再以一个逻辑提交发布 PR、合并、回读关闭。

测试不读取个人脑洞，不调用真实 provider；mock 只替换网络 endpoint，不测试私有 parser 的实现细节。无新依赖。

### 执行前的命令边界

`main` 先扫描独立 `--help` / `-h`，也保留无参数时显示顶级帮助的行为。帮助输出 stderr、exit 0，不受缺参数、无效 timeout/model 或不存在的输入文件影响。`helpFor` 从命令定义渲染语法、输入形状、示例和副作用；全局选项可以放在命令前。

`parseCommandLine` 随后解析并验证白名单选项、重复项、非空值、位置参数数量、必需文件参数及恰好一个输入来源。保留 `--flag=value` 与 pnpm 的独立 `--` 分隔符；后者不是未知选项的转义开关。`create` / `smoke` 必须在 `--seed`、`--seed-file` 中选一个，`run-step` 必须在 `--input-file`、`--seed-file` 中选一个。带符号的数值仍交给原有语义校验。

解析失败抛 `CliError(code=usage)`，入口输出一条 JSON 到 stderr、exit 1、stdout 为空。错误只引用固定语法说明，不插入用户给出的未知命令、参数名、值或 kind。文件内容、schema、生成参数范围及业务冲突仍由原有模块验证，不统一改成 usage；CLI 的 JSON 成功结果和 advance 的业务 failed 语义也保持不变。

定义表只负责 CLI 语法和发现，不复制业务状态机；dispatch、HTTP client 和本地 worker 沿用现有接缝。新增命令时需同时补定义、dispatch 和真实入口用例。

## 代码落点

- [command-line.ts](../../apps/cli/src/command-line.ts)：命令定义、`helpFor`、`parseCommandLine`。
- [main.ts](../../apps/cli/src/main.ts)：帮助优先、解析后 dispatch、安全错误出口。
- [command-entry.test.ts](../../apps/cli/test/command-entry.test.ts)：真实可执行程序＋临时 loopback 服务，验证零请求和合法调用。
- [cli-process.ts](../../apps/cli/test/cli-process.ts)：入口测试环境隔离，防止继承本地凭据或真实 provider 地址。
- [local-step.ts](../../apps/cli/src/local-step.ts)、[commands.ts](../../apps/cli/src/commands.ts)：沿用单节点输入、版本及业务语义，非本票改造边界。

## 测试与验证

完整审核记录和原始日志索引保存在[发布时 Wiki](https://github.com/12bitsD/agent4novel/blob/a96339a7eb11e8d28a4eb33ba8829ef6bfac7bbd/docs/wiki/025-cli-command-safety.md#完成审核证据)。以下是导航摘要；历史验证只证明该发布候选，不自动适用于后续改动。

真实进程测试从 `apps/cli/bin/a4n` 启动，服务捕获方法、路径与 body；帮助和非法参数断言请求集合为空。写命令、缺失文件、无效配置及 `run-step` 均有覆盖。入口测试显式清空模型凭据并将 provider 指向不可用 loopback，避免开发者环境影响测试。已存在的命令、超时、单节点、版本与恢复测试继续覆盖跨模块语义。

RED 分片记录帮助实际 POST、缺 scoped help、未知参数被执行、位置参数错误仍执行/先读文件，以及互斥输入未提前拒绝而尝试读取缺失文件；各片修复后运行 CLI 定向测试及 typecheck。精确结果与最终全仓门禁在下方收口。

### 完成审核证据

- **清单与候选**：发布版本 `a96339a` 的完整清单 blob、固定点、T0/T1 与 15 文件 manifest 见上述不可变记录。
- **逐项判定**：原交付 C1–C5、C6.1–C6.4 通过，逐项来源及 N/A 保留在原记录；C6.5–C6.7 与最终交付事实归 [Issue 完成评论](https://github.com/12bitsD/agent4novel/issues/25#issuecomment-5871092145)。
- **验收与 TDD**：AC1–AC5 满足；真实入口覆盖帮助/非法调用零 I/O、安全错误与合法调用兼容，S1–S5 均保留 RED/GREEN。S6 的缺 state 响应是夹具错误，不计为产品 RED。
- **本地门禁**：2026-09-28 发布候选 419 tests / 46 files、四包 typecheck、build 通过，凭据/范围检查通过；保留已有 DOCX chunk >500 kB 警告。专用 lint/format script 未配置，以 tsc/diff 检查覆盖；无远端 CI，也没有真实模型 E2E 结论。
- **双轴 review**：独立 Standards/Spec 均通过；文档修正后，两轴重新绑定最终实质候选。
- **修复与回归**：S5 RED 曾被文档误述为创建作品，原日志实际证明尝试读取冲突的缺失文件；已纠正并复核。原失败裁决及修复顺序保留，未改业务代码。
- **知识维护**：Wiki014/025、索引、双语 README、handoff、运行 skill 已同步；未改数据形状、领域词、跨票架构或外部选型，schema、CONTEXT、ADR、research 更新为 N/A。原结构/135 个本地链接检查通过。
- **发布前裁决**：独立 T1 attestation 通过；完整来源见发布时 Wiki，最终比较与关闭结果见完成评论。当前整理只收敛导航，不改变已审核快照。

## 边界与非目标

不改变 advance 的 HTTP200/业务 failed 出口，不修改产物版本协议、模型配置/SP、UI、Store、人工关卡。不新增 agent-v1、prepare/check/record、自动重试或自动审批。单独帮助 token 优先意味着将其作为字面输入时需要 equals 形式，这是明确语法约定。

## 上下文演进

### 2026-09-28 — 将 CLI 发现与语法收在执行前

- **触发证据**：Agent 工程熟悉中的 fake transport 捕获子命令 help POST；未知参数静默忽略。
- **原假设**：顶级帮助和各命令零散校验足够支撑 Agent。
- **决定**：先完成帮助和严格语法切片，保留现有业务结果协议；重构不扩成新编排框架。
- **影响**：错误调用在 I/O 前失败；现有参数合法调用不变，旧静默容错将变为明确 usage。
- **上下文处理**：preserve Wiki014 原始 CLI/遥测理由；本票替代入口帮助和语法行为，014 链接到本页。

### 2026-09-28 — 发布后收敛接手入口

- **触发证据**：用户要求收敛 Wiki；远端已合并/关闭，页面仍标 active 且审核细节占据正文。
- **原假设**：发布前快照足够接手，交付后只需查询 GitHub。
- **决定**：同步 done 与完成链接；当前页保留审核摘要，完整证据链接同一 Wiki 的不可变发布版本。
- **影响**：下一位 Agent 先读当前能力、边界与下一步，需要审核细节时再展开历史版本。
- **上下文处理**：replace 状态与交接入口；compact 审核叙述；preserve 原始目的、范围裁决、失败实验和完整审核来源，不改变知识归属。

### 2026-10-03 — 更新主线接手入口

- **触发证据**：当前交接仍让主线接回 #5，#5 及后续本机 MVP 已交付。
- **原假设**：CLI 交付时的下一票可以继续作为当前主线导航。
- **决定**：项目进度链接当前 handoff 和 Wiki001，保留 CLI 帮助与语法校验的继承约束。
- **影响**：只修正导航，不改变命令或结果语义。
- **上下文处理**：preserve 原目的、失败经验及完成审核；replace 末尾旧队列。

## 交接结论

可以依赖帮助与语法校验先于命令 I/O，并从命令专属帮助发现输入与副作用。不能据此认定语义输入有效、某次业务已成功或真实模型质量已达标；仍需检查响应、版本与人工关卡。统一结果、运行记录和 Outline 基线保护是后续独立范围。本票已交付；审核细节见发布时 Wiki，最终 PR、merge 和关闭结果见上方完成评论。项目当前进度见 [handoff](../handoff.md#下一步)，本机 MVP 验证和待修复项见 [Wiki001](./001-mvp-acceptance.md#2026-10-03-清点与复审)。
