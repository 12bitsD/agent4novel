---
wiki_id: "014"
ticket: 14
ticket_state: done
context_state: mixed
summary: "Agent 通过 JSON CLI 驱动创作链路，并从 advance 内联结果或 logs 获取每次 LLM 调用的安全遥测。"
topics: ["agent-cli", "llm-telemetry", "workflow-smoke", "optimistic-locking", "failure-diagnostics"]
code_paths: ["apps/cli/src/client.ts", "apps/cli/src/commands.ts", "apps/cli/src/main.ts", "packages/contracts/src/telemetry.ts", "apps/server/src/steps/telemetry.ts", "apps/server/src/steps/llm-call.ts", "apps/server/src/routes/works.ts", ".claude/skills/agent4novel-drive/SKILL.md"]
symbols: ["createClient", "CliError", "smoke", "LlmTelemetry", "recordTelemetry", "telemetryCursor", "telemetryFor", "callLlm"]
inherits: ["004", "011"]
changed_by: ["016", "013", "005"]
read_when: ["drive-workflow-from-cli", "debug-llm-failure", "change-cli-command", "change-telemetry", "run-end-to-end-smoke"]
last_context_reviewed: "2026-09-08"
---

# 014 — Agent 可用性基建：CLI + 遥测内联 + 项目级 Skill

## Agent Context

- **读取时机**：用命令行驱动作品、修改 CLI、分析 LLM 失败、扩展遥测或维护 smoke 探针时读取。
- **原始目的**：消除 Agent 手拼 curl 和手记 expectedHeadVersion 的易错操作，并让一次 advance 同时返回结果与诊断。
- **实际落地**：a4n 提供 JSON 命令；#13 新增 approve-setting，#5 新增按章 Beat 命令并将 smoke 延伸至章纲通过。LLM 成败写入进程内账本，advance 内联本次遥测，logs 支持跨次回看。
- **当前价值**：本文继续拥有 CLI 命令语义、遥测契约、smoke 流程和 outline 截断的排障经验。
- **后续变化**：[Wiki 016](./016-model-runtime-provider-config.md) 接管模型配置与 timeout 默认值；[Wiki 013](./013-setting-generation-review.md) 拥有 Setting 完整显式版本请求与结果对账规则，不沿用 Outline 自动补版本。
  [Wiki 005](./005-beat-generation-review.md) 已增加按章命令、请求关联与写入结果，移除共享原始错误内容传播；Beat 恢复语义以该页为准。
- **代码入口**：[CLI commands](../../apps/cli/src/commands.ts)、[CLI client](../../apps/cli/src/client.ts)、[telemetry ledger](../../apps/server/src/steps/telemetry.ts)、[LLM call](../../apps/server/src/steps/llm-call.ts)、[drive skill](../../.claude/skills/agent4novel-drive/SKILL.md)。

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

命令为 config、list、create、get、advance、select、save-outline、approve、approve-setting、approve-beat、regenerate-beat、logs、smoke。Beat 文件显式保留章号、Artifact ID 与版本；get 按 kind/chapter 精确读取。select/save-outline 自动回填 head version；approve-setting 文件必须显式携带完整 content 与读取时 expectedHeadVersion，最多自动回读一次，不自动重写。pnpm -s cli 等价，但必须带 -s 以免横幅污染 stdout；地址与 timeout 默认值见 [Wiki 016](./016-model-runtime-provider-config.md)，Setting 恢复规则见 [Wiki 013](./013-setting-generation-review.md#提交结果确认)。

CliError 保留 server 返回的 code、status、retryable、attemptId 与可选 issues。命令函数只返回可 JSON 序列化值，main 统一负责打印与 exit code。CLI 主动 deadline 覆盖 fetch 和响应体，Beat 默认通过 30s、再生 920s、恢复 GET 10s；其他默认值未变；超时不代表服务器回滚。

### 遥测账本

LlmTelemetry 公开可选 requestId、stepId、attemptId、model、ok、latencyMs、可选 token/finishReason/error，以及 promptChars、promptHash、systemHash。

实现语义：

- callLlm 无论成功或失败都调用 recordTelemetry。
- LLM 与命令摘要分别保留全局最近 1000 条，按 workId 及可选 requestId/attemptId 过滤。
- HTTP 请求以 AsyncLocalStorage 收集本次记录，不依赖全局窗口 cursor；淘汰或同作品并发不污染内联 telemetry。
- GET /api/works/:id/telemetry 与 CLI logs 返回 telemetry、commands、window；窗口含 processInstanceId、容量及截断信息，重启清空不表示从未执行。
- promptHash 标识本次 user prompt；systemHash 是对应步骤 SKILL.md 内容的 12 位 hash。
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
| telemetry 契约与账本 | [telemetry contract](../../packages/contracts/src/telemetry.ts)、[ledger](../../apps/server/src/steps/telemetry.ts) |
| LLM 记录与安全诊断 | [llm-call.ts](../../apps/server/src/steps/llm-call.ts) |
| advance 内联与查询 | [works.ts](../../apps/server/src/routes/works.ts) |

## 测试与验证

CLI 测试以注入 fetch 覆盖 REST 映射、自动回填版本、首方向缺省、smoke、logs 与 timeout。#5 增加真实 CLI 子进程与 loopback fixture 集成、请求精确关联、1001 条淘汰与重启窗口测试，以及共享 callLlm 脱敏回归。

真实探针曾捕获 outline 在 8000 output tokens 以 length 截断，以及 finishReason=stop 但 schema 失败。前者促使 outline 上限升至 16000 并收紧 prompt；后者促使保留 causeMessage/textTail。复测只证明已缓解该故障，不代表所有 provider 都可靠；当前验证见 [wiki 016](./016-model-runtime-provider-config.md)。

## 边界与非目标

- telemetry 与作品不持久化；账本最多 1000 条，重启或淘汰后不可查。
- smoke 自动选首方向并通过大纲、修改并通过设定和章纲，只验证链路，不代表人工质量验收。
- advance 是同步长请求；没有后台 job、SSE、Web telemetry 或跨进程聚合。
- provider、credential、Base URL、wire protocol 和 timeout 默认值归 wiki 016。

## 上下文演进

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

后续 Agent 应优先使用 a4n 和项目 drive skill，先检查 advance 的 kind，再读内联 telemetry；只有跨次分析才调用 logs。修改这套能力时必须维持 stdout/stderr 分离、自动乐观锁、无敏感正文遥测和手动重入语义；任何 provider 或 timeout 变更只写入 [wiki 016](./016-model-runtime-provider-config.md)。
