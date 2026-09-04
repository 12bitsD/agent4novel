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
changed_by: ["016"]
read_when: ["drive-workflow-from-cli", "debug-llm-failure", "change-cli-command", "change-telemetry", "run-end-to-end-smoke"]
last_context_reviewed: "2026-09-04"
---

# 014 — Agent 可用性基建：CLI + 遥测内联 + 项目级 Skill

## Agent Context

- **读取时机**：用命令行驱动作品、修改 CLI、分析 LLM 失败、扩展遥测或维护 smoke 探针时读取。
- **原始目的**：消除 Agent 手拼 curl 和手记 expectedHeadVersion 的易错操作，并让一次 advance 同时返回结果与诊断。
- **实际落地**：a4n 提供 9 个 JSON 命令；LLM 成败都写入进程内账本，advance 内联本次遥测，logs 支持跨次回看。
- **当前价值**：本文继续拥有 CLI 命令语义、遥测契约、smoke 流程和 outline 截断的排障经验。
- **后续变化**：[wiki 016](./016-model-runtime-provider-config.md) 已接管 provider、凭据、Base URL、结构化输出协议与两层 timeout；不要从本文推导当前模型配置。
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

九个命令分别是 list、create、get、advance、select、save-outline、approve、logs、smoke。select/save-outline 自动读当前快照并回填 head version；smoke 串起完整三步链。pnpm -s cli 等价，但必须带 -s 以免横幅污染 stdout；地址与 timeout 见 [wiki 016](./016-model-runtime-provider-config.md)。

CliError 保留 server 返回的 code、status、retryable 与 attemptId。命令函数只返回可 JSON 序列化值，main 统一负责打印与 exit code。

### 遥测账本

LlmTelemetry 公开 stepId、attemptId、model、ok、latencyMs、可选 token/finishReason/error，以及 promptChars、promptHash、systemHash。

实现语义：

- callLlm 无论成功或失败都调用 recordTelemetry。
- 账本是容量 1000 的进程内环形缓冲，按 workId 查询。
- advance 开始前记 telemetryCursor，结束后只把该 cursor 之后且属于本作品的记录内联到响应。
- GET /api/works/:id/telemetry 与 CLI logs 返回本进程仍保留的全部该作品记录。
- promptHash 标识本次 user prompt；systemHash 是对应步骤 SKILL.md 内容的 12 位 hash。
- 不记录 key、素材、完整 prompt 或完整 output。

server stdout 的 llm.error 另含 textChars、最多 200 字符的 textTail 和最多 500 字符的 causeMessage，用于判断截断或 Zod/JSON 失败；它们不进入查询账本。

### 失败分类

| 观测 | 首要判断 | 下一步 |
|---|---|---|
| finishReason=length 且 outputTokens 撞上限 | 输出被截断，JSON 不完整 | 收紧 prompt 篇幅或评估该步骤 token 上限 |
| finishReason=stop 但 ok=false | 输出结束但未通过解析/schema | 用 attemptId 查 server 的 llm.error causeMessage |
| llm-timeout | provider 单次调用超时 | 按 retryable 手动 advance，并检查 wiki 016 的 timeout |
| network-error | CLI 请求先结束或 server 不可达 | 区分 CLI timeout 与 server LLM timeout |

错误名不能只等于 NoObjectGeneratedError。AI SDK v7 实际可能返回 AI_NoObjectGeneratedError；当前映射使用名称包含判断，并将该类失败归入 llm-invalid-output。

### Smoke 探针

smoke 执行 create → advance（caption + creative）→ select 首个方向 → advance（outline）→ approve → get。成功后 stdout 给出 steps 与 final，stderr 报进度；失败时不会返回部分 steps，应据 stderr 用单条命令和 logs 检查已有状态。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| CLI 入口、client、命令与输出 | [a4n](../../apps/cli/bin/a4n)、[client.ts](../../apps/cli/src/client.ts)、[commands.ts](../../apps/cli/src/commands.ts)、[main.ts](../../apps/cli/src/main.ts) |
| telemetry 契约与账本 | [telemetry contract](../../packages/contracts/src/telemetry.ts)、[ledger](../../apps/server/src/steps/telemetry.ts) |
| LLM 记录与安全诊断 | [llm-call.ts](../../apps/server/src/steps/llm-call.ts) |
| advance 内联与查询 | [works.ts](../../apps/server/src/routes/works.ts) |

## 测试与验证

CLI 测试以注入 fetch 覆盖 REST 映射、自动回填版本、首方向缺省、smoke、logs 与 timeout。Server 路由测试目前只锁定 fake advance 的空 telemetry、按作品查询和 404；尚未直接断言 callLlm 成败记录或 1000 条淘汰边界。

真实探针曾捕获 outline 在 8000 output tokens 以 length 截断，以及 finishReason=stop 但 schema 失败。前者促使 outline 上限升至 16000 并收紧 prompt；后者促使保留 causeMessage/textTail。复测只证明已缓解该故障，不代表所有 provider 都可靠；当前验证见 [wiki 016](./016-model-runtime-provider-config.md)。

## 边界与非目标

- telemetry 与作品不持久化；账本最多 1000 条，重启或淘汰后不可查。
- smoke 自动选首方向并通过大纲，只验证链路，不代表人工质量验收。
- advance 是同步长请求；没有后台 job、SSE、Web telemetry 或跨进程聚合。
- provider、credential、Base URL、wire protocol 和 timeout 默认值归 wiki 016。

## 上下文演进

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
