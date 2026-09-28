---
wiki_id: "025"
ticket: 25
ticket_state: active
context_state: current
summary: "CLI 帮助零副作用、严格参数校验和安全一致的用法错误；不改变作品命令语义。"
topics: ["agent-cli", "command-help", "argument-validation", "safe-discovery"]
code_paths: ["apps/cli/src/main.ts", "apps/cli/src/command-line.ts", "apps/cli/test/command-entry.test.ts", "apps/cli/test/cli-process.ts"]
symbols: ["a4n", "helpFor", "parseCommandLine", "usage", "--help"]
inherits: ["014"]
changed_by: []
read_when: ["change-cli-command", "debug-cli-arguments", "discover-cli-command"]
last_context_reviewed: "2026-09-28"
---

# 025 — CLI 命令发现与参数校验

## Agent Context

- **读取时机**：修改 CLI 帮助、参数或入口错误语义时读取。
- **原始目的**：避免 Agent 查看子命令帮助时触发写入，以及拼错参数后执行了另一种操作。
- **实际落地**：14 个子命令共享帮助和严格语法验证，帮助在 I/O 前返回；非法调用输出安全 usage JSON。发布前验证与审核快照见下方证据，最终发布/关闭状态以 GitHub 为准。
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

本票证据目录：`/Users/user/Documents/Codex/2026-09-28/agent4novel-cli-safety/`。本地日志补充版本内的测试源码和精确命令，不把本地日志当作远端 CI。

真实进程测试从 `apps/cli/bin/a4n` 启动，服务捕获方法、路径与 body；帮助和非法参数断言请求集合为空。写命令、缺失文件、无效配置及 `run-step` 均有覆盖。入口测试显式清空模型凭据并将 provider 指向不可用 loopback，避免开发者环境影响测试。已存在的命令、超时、单节点、版本与恢复测试继续覆盖跨模块语义。

RED 分片记录帮助实际 POST、缺 scoped help、未知参数被执行、位置参数错误仍执行/先读文件，以及互斥输入未提前拒绝而尝试读取缺失文件；各片修复后运行 CLI 定向测试及 typecheck。精确结果与最终全仓门禁在下方收口。

### 完成审核证据

- **清单与候选**：清单 blob `db7f3eda6bce154b99e2ed67f50072465e9e2be0`；固定点 `943086f971e631ab4df9b55fd6d16c6e18c5a781`；T0 `f7ff77d6f538cbc66361858785a109005a304a9d`，T1 `d5bfd89cfb4cf84f748731480a965c3665586473`。精确范围为 CLI 的 8 个文件（main、command-line、command-entry、cli-process、beat-entry、setting-entry、step-entry、step-transport）和本文、Wiki014/索引、双语 README、handoff、运行 skill 共 15 文件；manifest 见证据目录 `pre-review-audit.json`。
- **逐项判定**：C1 = PASS：C1.1/C1.2/C1.6/C1.8 由 `preflight.json`、固定点与 branch/status 支持；issue 已 claim 12bitsD，ready-for-agent 保持，PR → main → 完成评论关闭已获授权，无阻塞、Actions、分支保护或 ruleset；C1.3/C1.4/C1.5/C1.7 由本文起始上下文、版本化计划、Wiki014/CONTEXT/ADR 对齐支持。C2 = PASS：C2.1–C2.5 由下述 RED/GREEN、AC 映射及代码公共接缝支持；C2.6 = N/A（本票有行为变化，已做 RED/GREEN，无替代验证）。C3 = PASS：C3.1/C3.6 见本地门禁；C3.2–C3.5 见 `pre-review-audit.json`，无独立 lint/format script（此子项 N/A，以 tsc 和 diff 检查覆盖，不能提供专用 formatter 保证）。C4 = PASS：C4.1/C4.2/C4.5–C4.8 见文档与 `docs-check.json`；C4.3/C4.4 = N/A（数据/领域不变量、词汇、跨票架构或外部选型未变，不更新 schema/CONTEXT/ADR/research，无新增风险）；C4.9 三轮自校准在 `pre-review-audit.json`，依次核对行为/测试、Wiki/领域词、AC/范围，均 PASS。C5 = PASS：C5.1–C5.3 由 `candidate-T0-r2.json`、`candidate-manifest.txt`、`candidate-T0-r2.patch` 支持，精确 15 文件，staged/base→tree diff check 通过，base..HEAD 无本地提交，unstaged/untracked 为空；C5.4/C5.5 修正后两轴独立 PASS；C5.6 接受并修正文档发现，C5.7 重新冻结并取得新 T0 两轴结论；C6.3 = PASS（仅转录预留证据字段，独立核验前 T1/裁决保持 pending）；C6.4 = PASS（`standards_25` 对 T0→T1 精确核验，仅三个预留证据字段变化，来源忠实；完整候选、空本地历史与工作区核验通过，原文 `pre-attestation-r2.md`）；C6.1 = PASS（独立裁决发现 S5 RED 被误记为创建作品，已改为原始日志实际证明的读取缺失文件）；C6.2 = PASS（本次仅改文档，重新校验结构/链接与差异，代码和既有全仓门禁对应内容未变）。
- **验收与 TDD**：Issue #25 AC1 → `command-entry.test.ts` 顶级/14 子命令长短帮助、无效配置、fake provider 与 FIFO；AC2/AC3 → 未知/重复/缺空值、位置参数、互斥输入、私密 sentinel 与单条 usage JSON；AC4 → leading globals、equals、pnpm 分隔符、字面 help 和 advance failed 控制组，既有 transport/命令/版本测试；AC5 → 真实可执行入口和全仓门禁，均 PASS。S1–S5 RED 分别为 1/14/9/12/2 个目标行为失败，GREEN 与逐片 typecheck 通过（`s1-help-*` 至 `s5-input-shape-*`）；最终 CLI 124 tests/8 files PASS（`s6-compatibility-cli-full-green.log`、`s6-compatibility-typecheck-final.log`）。S6 首次合法控制组失败来自缺 state 的测试响应，已修正为当前合同形状，不将夹具错误算作产品 RED；详见 `IMPLEMENTATION-HANDOFF.md`。
- **本地门禁**：2026-09-28 执行 `COREPACK_ENABLE_AUTO_PIN=0 pnpm run test` / `pnpm run typecheck` / `pnpm run build`，全部 exit 0，完整日志/退出码见 `root-{test,typecheck,build}.{log,json}`。本候选 419 tests/46 files（contracts66、server165、CLI124、Web64），四包 typecheck 通过；Web 构建保留既有 DOCX chunk >500 kB 警告。`git diff --check <fixed-point>` 通过；无新依赖、锁文件或生成物变化。凭据模式及本地 secret 值比对未命中候选，`.env.local` 仍 ignored、0600；固定错误文本不输出用户输入，测试 provider 全部 loopback。复用、可读性、模块归属和线性解析效率审查见 `pre-review-audit.json`。
- **双轴 review**：初始候选 `56e54ae2d1747ac8a6ad71ec18c6a81da68edada` 的独立 Standards/Spec 均 PASS，原始报告 `standards-review.md` / `spec-review.md` 保留；随后独立裁决发现下述文档事实错误。修正后的 T0 由同样隔离的 `standards_25` / `spec_25` 复核均 PASS，无剩余发现（`standards-review-r2.md` / `spec-review-r2.md`）；两位均未参与实现，旧结论仅用于未变部分，新结论明确绑定新 T0。
- **修复与回归**：接受独立裁决在 `pre-attestation-failed.md` 的发现：本页 RED 概述将 S5 错写为创建作品，原 `s5-input-shape-red.log` 实际为 create/smoke 试读冲突缺失文件并返回 internal。已纠正该句；不把文档误述当作产品缺陷。按 C5.7 重新冻结、审核，`docs-check.json` 结构/135 个本地链接 PASS；无代码/测试/业务契约变化，原全仓门禁仍对应同一可执行内容。

- **知识维护**：本文新建，Wiki014 保留原意并追加演进/下一跳，Wiki 索引、README/README.zh-CN、handoff、运行 skill 已更新；135 个本地链接、frontmatter 顺序/数组、固定标题、索引及 issue backlink 检查 PASS，中英文事实对照一致。schema、CONTEXT、ADR、research 按 C4.3/C4.4 记 N/A；无流程规则变化，docs/agents 不需修改。保留历史测试与真实模型失败边界，不声明本票完成真实模型 E2E。
- **发布前裁决**：2026-09-28，未参与实现的 `standards_25` 对 T1 `d5bfd89cfb4cf84f748731480a965c3665586473` 明确 C6.4 PASS（`pre-attestation-r2.md`）。核对清单 blob `db7f3eda6bce154b99e2ed67f50072465e9e2be0`、固定点 `943086f971e631ab4df9b55fd6d16c6e18c5a781`、C1–C5、C6.1–C6.3 及原始证据；初轮文档失败已修复并通过两轴复核，无阻塞遗留。仅按此裁决填入获准证据字段；终止性比较、提交/发布/关闭记录由 GitHub 完成评论及远端状态保存，本文不提前宣称整节 C6 或发布完成。

## 边界与非目标

不改变 advance 的 HTTP200/业务 failed 出口，不修改产物版本协议、模型配置/SP、UI、Store、人工关卡。不新增 agent-v1、prepare/check/record、自动重试或自动审批。单独帮助 token 优先意味着将其作为字面输入时需要 equals 形式，这是明确语法约定。

## 上下文演进

### 2026-09-28 — 将 CLI 发现与语法收在执行前

- **触发证据**：Agent 工程熟悉中的 fake transport 捕获子命令 help POST；未知参数静默忽略。
- **原假设**：顶级帮助和各命令零散校验足够支撑 Agent。
- **决定**：先完成帮助和严格语法切片，保留现有业务结果协议；重构不扩成新编排框架。
- **影响**：错误调用在 I/O 前失败；现有参数合法调用不变，旧静默容错将变为明确 usage。
- **上下文处理**：preserve Wiki014 原始 CLI/遥测理由；本票替代入口帮助和语法行为，014 链接到本页。

## 交接结论

可以依赖帮助与语法校验先于命令 I/O，并从命令专属帮助发现输入与副作用。不能据此认定语义输入有效、某次业务已成功或真实模型质量已达标；仍需检查响应、版本与人工关卡。统一结果、运行记录和 Outline 基线保护是后续独立范围。本文保留发布前审核快照；最终 PR、merge 和关闭结果见 Issue #25 完成评论。项目主线继续按 [handoff](../handoff.md#下一步) 接回 #5。
