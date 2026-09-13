---
wiki_id: "014"
ticket: 14
ticket_state: done
context_state: mixed
summary: "JSON CLI 驱动作品链路或独立运行五个生产 Step；返回校验后的 content 与安全遥测，支持自定义 SP。"
topics: ["agent-cli", "isolated-step", "system-prompt", "llm-telemetry", "workflow-smoke", "optimistic-locking", "failure-diagnostics"]
code_paths: ["apps/cli/src/client.ts", "apps/cli/src/commands.ts", "apps/cli/src/main.ts", "apps/cli/src/local-step.ts", "apps/server/src/step-lab-main.ts", "apps/server/src/steps/isolated-runner.ts", "packages/contracts/src/step-experiment.ts", "packages/contracts/src/telemetry.ts", "apps/server/src/steps/llm-call.ts", ".claude/skills/agent4novel-drive/SKILL.md"]
symbols: ["createClient", "CliError", "run-step", "runLocalStep", "runIsolatedStep", "stepExperimentRequestSchema", "smoke", "LlmTelemetry", "recordTelemetry", "telemetryFor", "callLlm"]
inherits: ["004", "011"]
changed_by: ["016", "013", "005"]
read_when: ["drive-workflow-from-cli", "run-isolated-step", "compare-system-prompts", "debug-llm-failure", "change-cli-command", "change-telemetry", "run-end-to-end-smoke"]
last_context_reviewed: "2026-09-13"
---

# 014 — Agent 可用性基建：CLI + 遥测内联 + 项目级 Skill

## Agent Context

- **读取时机**：用命令行驱动作品、独立运行节点或对照 SP、修改 CLI、分析 LLM 失败、扩展遥测或维护 smoke 探针时读取。
- **原始目的**：消除 Agent 手拼 curl 和手记 expectedHeadVersion 的易错操作，并让一次 advance 同时返回结果与诊断。
- **实际落地**：a4n 提供作品命令；#13 新增 approve-setting，#5 将 smoke 延伸至章纲通过。新增 run-step 通过本地 server worker 独立调用五个生产 Step，支持自定义 SP 与生成参数，返回校验后的 content 和安全 telemetry；本轮接回验证见“测试与验证”。
- **当前价值**：本文拥有 CLI 命令语义、单节点输入与结果边界、遥测契约、smoke 流程和 outline 截断的排障经验；生成参数与 timeout 默认值由 Wiki 016 维护。
- **后续变化**：[Wiki 016](./016-model-runtime-provider-config.md) 接管模型配置与 timeout 默认值；[Wiki 013](./013-setting-generation-review.md) 拥有 Setting 完整显式版本请求与结果对账规则，不沿用 Outline 自动补版本。
  [Wiki 005](./005-beat-generation-review.md) 已增加按章命令、请求关联与写入结果，移除共享原始错误内容传播；Beat 恢复语义以该页为准。
- **代码入口**：[CLI commands](../../apps/cli/src/commands.ts)、[local-step](../../apps/cli/src/local-step.ts)、[isolated-runner](../../apps/server/src/steps/isolated-runner.ts)、[telemetry ledger](../../apps/server/src/steps/telemetry.ts)、[LLM call](../../apps/server/src/steps/llm-call.ts)、[drive skill](../../.claude/skills/agent4novel-drive/SKILL.md)。

## 设计目的

Agent 操作面必须满足三个条件：命令可组合、输出可解析、失败可定位。CLI 因此只是 server REST 的薄封装，不复制领域状态机；遥测则紧贴一次 advance 返回，避免成功或失败后再猜应该查哪份日志。

核心约束：

- apps/cli/bin/a4n 是直接入口；成功命令向 stdout 写一个 JSON，usage、进度与错误写 stderr。
- HTTP 或传输失败时进程 exit 非零；advance 即使 HTTP 200 也可能返回 kind=failed，调用方必须检查 JSON outcome。
- select 与 save-outline 先 GET 当前快照，自动回填 expectedHeadVersion；Agent 不维护版本计数。
- directionId 缺省仅供 smoke 选择第一个方向；人工工作流应显式传入。
- 每条 LLM telemetry 都带 attemptId、promptHash 与 systemHash，便于关联失败并识别 prompt 版本。

## 起始上下文

本票交付 issue [#14](https://github.com/12bitsD/agent4novel/issues/14)，建立在 [wiki 011](./011-caption-creative-directions.md) 的重入语义和 [wiki 004](./004-outline-arcs-segments.md) 的完整三步工作流之上。

当时 curl 需要手拼请求和 expectedHeadVersion，advance 调用者拿不到 server stdout 的步骤证据；outline 又曾频繁失败，却没有 finishReason、outputTokens 或底层校验原因可查。

存储与遥测都沿用进程生命周期。遥测账本不落盘，server 重启后与测试作品一起消失。

## 技术方案

### CLI 命令

统一入口：

~~~bash
./apps/cli/bin/a4n <command>
~~~

作品命令为 config、list、create、get、advance、select、save-outline、approve、approve-setting、approve-beat、regenerate-beat、logs、smoke；独立节点实验使用下节 run-step。Beat 文件显式保留章号、Artifact ID 与版本；get 按 kind/chapter 精确读取。select/save-outline 自动回填 head version；approve-setting 文件必须显式携带完整 content 与读取时 expectedHeadVersion，最多自动回读一次，不自动重写。pnpm -s cli 等价，但必须带 -s 以免横幅污染 stdout；地址与 timeout 默认值见 [Wiki 016](./016-model-runtime-provider-config.md)，Setting 恢复规则见 [Wiki 013](./013-setting-generation-review.md#提交结果确认)。

CliError 保留 server 返回的 code、status、retryable、attemptId 与可选 issues。命令函数只返回可 JSON 序列化值，main 统一负责打印与 exit code。CLI 主动 deadline 覆盖 fetch 和响应体，Beat 默认通过 30s、再生 920s、恢复 GET 10s；其他默认值未变；超时不代表服务器回滚。

### 单节点实验 run-step

`run-step` 运行一个生产 Step，不创建作品、不推进 Pipeline，也不自动运行上游。先在完整 monorepo 执行 `pnpm install`；命令依赖 `apps/server` 的源码、tsx loader 和 provider 包，不能只复制 `apps/cli` 运行。无需启动 HTTP server，不支持 `--url`，`A4N_BASE_URL` 不参与节点调用。

~~~bash
./apps/cli/bin/a4n run-step caption --seed-file seed.txt
./apps/cli/bin/a4n run-step caption --seed-file seed.txt \
  --system-prompt-file caption-sp.md --config-file generation.json \
  --thinking off --temperature 0.9 --top-p 0.95
./apps/cli/bin/a4n run-step setting --input-file setting-input.json
~~~

`--seed-file` 与 `--input-file` 必须且只能选一个。前者读原始文本并组装空 upstream，适合 caption；其他节点需要后者提供完整输入。JSON 顶层是 `{ "seed": "素材", "upstream": {} }`，不是整个实验请求或 Artifact。upstream 的值是对应产物的 `content`，不带 id、version 或 humanStatus。

| 节点 | 必需的 upstream content | 额外输入 |
|---|---|---|
| caption | 无 | 无 |
| creative | caption | 方向数量用 config 的 directionCount 控制 |
| outline | creative | creative.directions 必须恰好一个 |
| setting | caption、creative、outline | creative.directions 必须恰好一个 |
| beat | outline、setting | 必须有 chapter: 1；可带 regeneration: { content, instructions } |

`regeneration.content` 使用 Beat 编辑草稿契约，`instructions` 可以为空；这里只生成独立结果，不校验或写回作品版本。输入与输出仍经过生产 Step schema 和消费守卫；没有 store 可证明输入是某作品的最新版或已通过版本。当前数据形状见 [schema](../schema.md)，请求允许字段见 [step-experiment.ts](../../packages/contracts/src/step-experiment.ts)。

`--system-prompt-file` 替换本次节点的 system prompt，省略则使用该节点生产 SKILL.md；user prompt 组装、输出 schema、ID 注入、token 预算与 SDK 重试策略继续使用生产实现。`--config-file` 只接受 model、directionCount、thinking、temperature、topP；配置文件先独立校验，CLI 覆盖不能掩盖非法字段或值。生成参数优先级、默认值和 `--top-k` 拒绝语义见 [Wiki 016 生成参数](./016-model-runtime-provider-config.md#生成参数与单节点覆盖)。

每个文件及合并后的 UTF-8 请求各限 1 MiB；seed 最多 100000 字符，SP 为非空白且最多 100000 字符。超限在模型调用前失败，不静默截断。worker 结果最多 8 MiB；Beat 仍保留组装后输入预算。

成功 exit 0，stdout 只有 `{ kind: "succeeded", runId, stepId, executionMode: "live", model, content, telemetry }`。content 已通过生产 schema，不返回 raw 模型文本、推理内容或供应商响应。失败 exit 1，stdout 为空，stderr 为安全错误 JSON；若 Step 已执行，包含 `kind: "failed"`、runId、stepId、model、retryable 和本次 telemetry；调用前失败可能没有 telemetry。常见 code 为 usage、invalid-input、payload-too-large、llm-config-invalid、llm-unavailable、llm-invalid-output、llm-timeout、network-error、invalid-response。输入/schema 失败不等于真实模型失败。

worker 会加载仓库 `.env.local` 并使用真实 provider；缺少可用配置时失败，不生成 demo 内容。调用会把素材、上游内容和 SP 发给选定 provider。单次模型与 CLI 总等待分别配置，见 [Wiki 016 timeout](./016-model-runtime-provider-config.md#两层-timeout-与重试)；每次实验进程退出后不保留日志账本，需要时自行保存命令结果。

### 遥测账本

LlmTelemetry 公开可选 requestId、stepId、attemptId、model、ok、latencyMs、可选 token/finishReason/error/generation，以及 promptChars、promptHash、systemHash。generation 只记录已解析的 thinking、temperature、topP；默认值与解析规则见 Wiki 016。

实现语义：

- callLlm 无论成功或失败都调用 recordTelemetry。
- LLM 与命令摘要分别保留全局最近 1000 条，按 workId 及可选 requestId/attemptId 过滤。
- HTTP 请求以 AsyncLocalStorage 收集本次记录，不依赖全局窗口 cursor；淘汰或同作品并发不污染内联 telemetry。
- GET /api/works/:id/telemetry 与 CLI logs 返回 telemetry、commands、window；窗口含 processInstanceId、容量及截断信息，重启清空不表示从未执行。
- promptHash 标识本次 user prompt；systemHash 是本次实际 system prompt 的 12 位 hash，默认对应步骤 SKILL.md，自定义 SP 时对应传入文件内容。
- 不记录 key、素材、完整 prompt 或完整 output。

server stdout 的 llm.error 只含安全分类、长度、tokens、finishReason、hash 与关联 ID；不再输出 textTail、causeMessage 或供应商原始 message。

### 失败分类

| 观测 | 首要判断 | 下一步 |
|---|---|---|
| finishReason=length 且 outputTokens 撞上限 | 输出被截断，JSON 不完整 | 收紧 prompt 篇幅或评估该步骤 token 上限 |
| finishReason=stop 但 ok=false | 输出结束但未通过解析/schema | 用 requestId/attemptId 查安全分类与输出长度 |
| llm-timeout | provider 单次调用超时 | 按 retryable 手动 advance，并检查 wiki 016 的 timeout |
| network-error | CLI 请求先结束或 server 不可达 | 区分 CLI timeout 与 server LLM timeout |

错误名不能只等于 NoObjectGeneratedError。AI SDK v7 实际可能返回 AI_NoObjectGeneratedError；当前映射使用名称包含判断，并将该类失败归入 llm-invalid-output。

### Smoke 探针

smoke 执行 config → create → caption/creative → select → outline/通过 → setting/编辑并通过 → beat#1/编辑并通过 → get final，核对 beat-approved、最终编辑和无 prose。成功 stdout 给出 steps/final；失败 stderr 保留部分 steps、运行模式及可用诊断，exit 非零。HTTP 200 failed 同样停止，不自动重跑模型。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| CLI 入口、client、命令与输出 | [a4n](../../apps/cli/bin/a4n)、[client.ts](../../apps/cli/src/client.ts)、[commands.ts](../../apps/cli/src/commands.ts)、[main.ts](../../apps/cli/src/main.ts) |
| 单节点输入、worker 与生产 Step 调用 | [local-step.ts](../../apps/cli/src/local-step.ts)、[step-lab-main.ts](../../apps/server/src/step-lab-main.ts)、[isolated-runner.ts](../../apps/server/src/steps/isolated-runner.ts)、[实验契约](../../packages/contracts/src/step-experiment.ts) |
| telemetry 契约与账本 | [telemetry contract](../../packages/contracts/src/telemetry.ts)、[ledger](../../apps/server/src/steps/telemetry.ts) |
| LLM 记录与安全诊断 | [llm-call.ts](../../apps/server/src/steps/llm-call.ts) |
| advance 内联与查询 | [works.ts](../../apps/server/src/routes/works.ts) |

## 测试与验证

CLI 测试以注入 fetch 覆盖 REST 映射、自动回填版本、首方向缺省、smoke、logs 与 timeout。#5 增加真实 CLI 子进程与 loopback fixture 集成、请求精确关联、1001 条淘汰与重启窗口测试，以及共享 callLlm 脱敏回归。

真实探针曾捕获 outline 在 8000 output tokens 以 length 截断，以及 finishReason=stop 但 schema 失败。前者促使 outline 上限升至 16000 并收紧 prompt；后者当时促使保留 causeMessage/textTail，#5 后已由安全分类替代原始错误传播。复测只证明已缓解该故障，不代表所有 provider 都可靠；当前验证见 [wiki 016](./016-model-runtime-provider-config.md)。

### 2026-09-13 本地接回验证

验证入口为 [step-entry.test.ts](../../apps/cli/test/step-entry.test.ts)、[step-transport.test.ts](../../apps/cli/test/step-transport.test.ts) 与 [isolated-runner.test.ts](../../apps/server/test/isolated-runner.test.ts)：覆盖参数与文件限制、两个 SP 保持相同 user prompt、生成参数传输、模型覆盖、超时与脱敏失败，以及五个节点的生产预算、上游和 ID。测试使用合成输入与本地 mock provider。

2026-09-13 主仓库完整包测试通过：contracts 66、server 165、CLI 49、web 64，合计 344；四包 typecheck 与 workspace build 通过。保留 SDK 的 json_object 已知提示和 Vite 单 chunk 大于 500 kB 提示。命令及 RED/GREEN 证据见 [本轮计划与验证记录](../experiments/caption-adoption-2026-09-13/plan.md#验证记录)；独立评阅与最终文档检查结果见该记录。本轮没有新增真实模型调用，Caption SP 的既有选定证据与限制见 [Wiki 011](./011-caption-creative-directions.md)。

### 完成审核证据

本记录仅覆盖用户要求的 Caption/CLI 更新及同一会话已有的创意面板修复推送，不重新交付或关闭 #5/#11/#14。公开仓库保留代码、方法和[验证摘要](../experiments/caption-adoption-2026-09-13/plan.md)，完整作品与实验原文保留本地。

- **清单与候选**：固定点 `a1646e7fe4809ae3e37865d05363ab660c9c270d`，与已验证的 `ca9689632442904ad328f3b25cdbec4e5530a65e` 文件树相同；双轴通过候选 T0 为 `7bdd0e845a20724966c552afff499e2423cb5586`。40 文件 manifest 可由 `git diff --name-status <固定点> <T0>` 重建；清单 blob 为 `db7f3eda6bce154b99e2ed67f50072465e9e2be0`；pre-attestation tree（T1）为 `ef0f272b802d53ea48f2cdb54f69a567ce2c6d23`。
- **逐项判定**：C1 = PASS（用户在本会话对 SP 选择、CLI/wiki 和 push 的决定，[计划、验收、工作区与分支范围](../experiments/caption-adoption-2026-09-13/plan.md)；远端回读 main 仍为固定点，新分支尚不存在）。C2 = PASS（下列 AC/TDD 及测试入口）。C3 = PASS（下列本地门禁、代码 hash 与安全审查）。C4 = PASS（下列知识维护及三轮校准）。C5 = PASS（40 文件精确暂存、完整 diff 与中间历史审计、独立双轴结论）。C6.1 = PASS（公开链接缺陷已修正，194 个候选内目标通过）；C6.2 = PASS（无行为修复，源码 hash 未变，重新完成文档与范围检查）；C6.3 = PASS（仅转录预留证据字段，来源见上述记录）；C6.4 = PASS（独立 reviewer 精确核对 T0 → T1、完整候选、零中间提交与工作区余项，见下方 attestation）。
- **N/A 与边界**：C1.1 的新票 claim、C1.8 的新终态、C7.4–C7.6 的 issue/PR 完成操作 N/A：此次仅推功能分支，不重新交付旧票或改变 issue 状态。C2.1 对此次纳入的既有 UI 修复 N/A：本次没有重新实现该修复或重放初始 RED；已有 64 项 web 测试通过及独立 UI review，初始 RED 未在本次发布记录中补造。C2.6 的纯文档验证由 194 链接、Wiki 结构及三轮校准覆盖。C4.4 的新增 ADR N/A：没有新的不可逆架构选择，外部依据保留既有实验摘要。C7.3 的 CI N/A：仓库 GitHub Actions workflow 数为 0，本地结果不代表 CI。
- **验收与 TDD**：Caption 生产 SP 与 R10 A 字节一致；CLI 五节点、自定义 SP、参数覆盖、独立 worker、不落库及失败脱敏由 [step-entry](../../apps/cli/test/step-entry.test.ts)、[step-transport](../../apps/cli/test/step-transport.test.ts)、[isolated-runner](../../apps/server/test/isolated-runner.test.ts) 和 contracts 边界测试证明；入口缺命令与显式模型覆盖的 RED/GREEN 见[验证记录](../experiments/caption-adoption-2026-09-13/plan.md#验证记录)。[UI 测试](../../apps/web/src/pages/Workspace.generation.test.tsx) 验证生成期间保留 creative、只读、失败保留及下游稿切换。用户的 SP 质量取向、单案例局限和停止条件见 Wiki 011。
- **本地门禁**：2026-09-13 完整测试 344 项、四包 typecheck、workspace build 均通过，命令及 SDK/Vite 已知提示见验证记录。提交前比对确认原 38 文件中所有源码和测试 hash 未变，UI 两文件与独立审查 hash 相同；后续差异仅 5 份文档。`git diff --cached --check`、`git diff --check <固定点> <T0>`、40 文件 allowlist、194 个 Markdown 候选内链接、三篇 Wiki 的 12 个 frontmatter 字段和 9 个固定 H2/事件结构均通过；无中间本地 commit。凭据检查没有真实密钥命中，`.env.local` 仍 ignored，实验仅纳入 plan.md。此前代码质量审查覆盖复用、可读性、边界与效率，没有新增阻塞问题；不重复运行未变化代码的测试。
- **双轴 review**：Standards（push_scope_audit）与 Spec（adoption_spec_review）各自对 T0 给出 PASS；沿用原 Caption/CLI review 和 UI 独立双轴 PASS，并重新审核公开摘要、完整范围及 AC。剩余非阻塞项：隔离 runner 的依赖表与 start.ts 重复但一致；UI 两组参数化用例均在失败后经手动刷新切换 setting；成功 advance 后的自动刷新切换未被这些新增用例独立验证；私有原文不能由公共仓库独立复验。未将这些限制描述为已解决。
- **修复与回归**：公开 wiki 改链至可发布摘要，完整原稿、模型正文和历史实验仍保留本地；修正 Wiki 014 审核证据的章节位置。没有改动功能代码；重新执行候选内链接/结构/范围验证，两轴均 PASS。
- **知识维护**：Wiki 011/014/016、schema、CONTEXT、双语 README、handoff、运行 skill 已更新；research 的既有本地归档保留，公开选择依据见实验摘要；ADR N/A 如上。三轮自校准分别核对：① 代码与行为/测试 hash 一致；② 文档字段、错误码、参数及入口与代码一致；③ 40 文件候选覆盖用户 SP/CLI/wiki/UI 与分支推送范围，没有携入原文、临时脚本或票外工作。
- **发布前裁决**：独立 reviewer push_scope_audit 对 T1 给出 C6.4 PASS。原转录中 UI 用例的“成功”措辞经 reviewer 指出后已改为“失败后手动刷新”，未改测试或行为。reviewer 确认 T0 → T1 唯一变化在预留证据块，内容忠实于原始结论，候选与索引一致、差异检查通过、零中间提交；剩余风险见双轴 review 项。本字段是发布前 attestation，不宣称提交、推送或旧 ticket 已完成。

## 边界与非目标

- telemetry 与作品不持久化；账本最多 1000 条，重启或淘汰后不可查。
- smoke 自动选首方向并通过大纲、修改并通过设定和章纲，只验证链路，不代表人工质量验收。
- advance 是同步长请求；没有后台 job、SSE、Web telemetry 或跨进程聚合。
- run-step 仅支持 caption、creative、outline、setting、beat#1；实验结果不会落库或成为作品已通过产物，不支持 prose、后台任务或原始模型输出。
- provider、credential、Base URL、wire protocol 和 timeout 默认值归 wiki 016。

## 上下文演进

### 2026-09-13 — 单节点实验从临时入口接回正式 CLI

- **触发证据**：Caption SP 对照需要复用生产 prompt 组装、schema 与 telemetry；用户要求将已有临时 CLI 能力接回代码并同步 wiki。落点为 local-step、server worker、isolated-runner 及对应测试。
- **原假设**：#14 的 CLI 主要围绕作品与 advance，独立对照依赖临时实验入口；原先 systemHash 描述默认每次都来自生产 SKILL.md。
- **决定**：新增 run-step，以调用者提供的 seed/upstream 和可选 SP 运行一个生产 Step；CLI 只读文件与输出安全结果，模型配置和调用继续由 server 包承担。
- **影响**：可重复使用同一输入比较 SP 或生成参数；输入、预算、生成后 ID 与输出校验沿用生产逻辑。实验不落作品，不能代替全链路或真实质量验收；生成配置 HOW 由 Wiki 016 维护。
- **上下文处理**：`preserve` 原始作品命令、smoke、截断诊断和 #5 安全变更历史；`replace` 当前路由、CLI 摘要与 systemHash 描述；本轮本地测试结果记录于“测试与验证”，独立评阅和最终文档检查结果见本轮验证记录，Caption 选择继续读 Wiki 011。

### 2026-09-08 — Beat 命令和安全请求诊断落地

- **触发证据**：#5 CLI 集成通过；共享错误泄漏与跨请求归属风险由定向测试覆盖。
- **原假设**：cursor 账本足够，原始错误尾部有助排障，smoke 止于 Setting。
- **决定**：改用请求局部收集及安全分类，增加 Beat 文件命令、结构化恢复与窗口；smoke 止于 Beat 通过。
- **影响**：运行方式同步 drive skill；字段约束见 schema，Beat 语义见 Wiki 005。
- **上下文处理**：preserve 下方历史失败及设计记录；replace 当前操作说明。历史 textTail/causeMessage 不再是可用能力。

### 2026-09-08 — 收录章纲的 Agent 观测改进设计

- **触发证据**：作者要求从 Agent 视角检查返回信息；复审发现模型成功不等于条件写入成功，同作品 cursor 也不能准确关联并发请求，原始 text/cause 日志存在风险。
- **原假设**：现有 LLM 遥测、时间窗口与 stdout 原文已足够解释一次操作。
- **决定**：后续 #5 以 requestId/attemptIds 贯通命令和模型，使用安全错误分类、精确归属与有界诊断窗口；HOW 见 [Wiki 005](./005-beat-generation-review.md)，字段见 [schema](../schema.md#agent-可观测协议)。
- **影响**：计划扩展现有 logs／CLI／共享 helper，运行 skill 在代码验证后更新。当前 raw textTail/causeMessage 及 cursor 路径仍未修改，不把方案安全要求冒充已完成修复。
- **上下文处理**：preserve outline 截断实证、当前可用操作和原始排障理由；增加 planned 后续入口。代码落地后再 replace 受影响的现行 HOW。

### 2026-09-05 — 完整设定命令与 smoke 新终点

- **触发证据**：#13 将生产链扩展至 Setting，内容与状态需一次原子定稿。
- **原假设**：全部人工命令都能自动补最新版本，smoke 到大纲即完成。
- **决定**：新增显式版本的 approve-setting，共享 DTO 与提交 matcher；smoke 编辑设定后通过并回读，HTTP 200 failed 同样中止。
- **影响**：CLI 主动 deadline 覆盖响应体，原超时数值保持；不猜测已通过内容是否来自旧进程提交。
- **上下文处理**：preserve 原 CLI 与遥测目的、截断失败史；replace 当前命令和 smoke 说明，专用恢复语义链接 Wiki 013。

### 2026-08-28 — CLI 取代手拼 curl

- **触发证据**：Agent 需要自行拼请求并回填 expectedHeadVersion，容易产生错误和额外上下文。
- **原假设**：REST 已足够，Agent 可直接使用 curl。
- **决定**：新增薄 CLI；成功命令的 stdout 只含一个 JSON，select/save-outline 自动读取快照。
- **影响**：项目级 drive skill 统一要求使用 a4n；正常操作不再复制 REST 细节。
- **上下文处理**：replace；curl 只保留为底层调试手段，不再是标准入口。

### 2026-08-28 — 遥测内联并修复 outline 截断

- **触发证据**：outline 失败率约 3/7，原日志无法区分 token 截断与 schema 偏差。
- **原假设**：事后查看 stdout 足以诊断，默认 8000 output tokens 足够。
- **决定**：advance 内联 telemetry，补充 finishReason/outputTokens/hash/错误诊断；outline 上限调至 16000 并收紧 prompt。
- **影响**：一次调用即可获得结果和观测；两类 NoObjectGeneratedError 可以分流处理。
- **上下文处理**：preserve；这是避免重复盲调模型的关键故障经验。

### 2026-08-29 — 运行时配置移交 wiki 016

- **触发证据**：多 provider ModelRuntime、本地安全配置和两层 timeout 已形成独立边界。
- **原假设**：CLI/遥测票可以同时承载 DeepSeek 探针和模型配置。
- **决定**：本文继续拥有 CLI、遥测账本与 smoke；wiki 016 独占 provider 配置和 LongCat 运行时证据。
- **影响**：修改 CLI/telemetry 更新本文，修改模型配置更新 wiki 016，避免两处漂移。
- **上下文处理**：replace；DeepSeek 探针保留为故障史，不代表当前 provider 基线。

## 交接结论

后续 Agent 应优先使用 a4n 和项目 drive skill；作品链路先检查 advance 的 kind，再读内联 telemetry，跨次分析调用 logs。单节点对照使用 run-step，保存每次返回的 content、telemetry.generation、promptHash 与 systemHash，并保留输入和 SP 的版本；它不写作品。修改时保持 stdout/stderr 分离、作品版本保护和安全遥测；provider、生成参数或 timeout 变更维护 [wiki 016](./016-model-runtime-provider-config.md)。本轮独立评阅和最终文档检查结果统一记录在本轮计划。
