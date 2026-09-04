---
wiki_id: "016"
ticket: 16
ticket_state: done
context_state: current
summary: "ModelRuntime 统一 DeepSeek 与 LongCat 的模型选择、服务端凭据、Base URL、结构化输出和两层超时。"
topics: ["model-runtime", "provider-config", "credentials", "base-url-security", "structured-output", "llm-timeouts"]
code_paths: ["apps/server/src/index.ts", "apps/server/src/steps/llm.ts", "apps/server/src/steps/llm-call.ts", "apps/server/src/config/local-env.ts", "apps/server/src/start.ts", "apps/cli/src/client.ts", ".env.example"]
symbols: ["ModelRuntime", "SupportedModelId", "ModelConfigError", "createModelRuntime", "modelRuntime", "callLlm", "DEFAULT_CLI_TIMEOUT_MS", "DEFAULT_ADVANCE_TIMEOUT_MS", "A4N_LLM_TIMEOUT_MS", "A4N_CLI_TIMEOUT_MS", "llm-timeout"]
inherits: ["014"]
changed_by: []
read_when: ["configure-model-provider", "add-model-provider", "debug-llm-runtime", "change-llm-timeout", "audit-credential-safety"]
last_context_reviewed: "2026-09-04"
---

# 016 — 模型运行配置：统一多 Provider、凭据与超时

## Agent Context

- **读取时机**：配置或新增 provider、切换模型、修改凭据/Base URL、排查结构化输出或 timeout、审计 live 数据边界时读取。
- **原始目的**：把散落且 DeepSeek-only 的运行时选择收敛到 ModelRuntime，使 Pipeline 与 RealStep 无需感知 provider。
- **实际落地**：DeepSeek 与 LongCat 2.0 共用 registry；server 安全加载本地配置，统一校验 URL、模型、credential、单次 LLM timeout 和本地 Zod 边界。
- **当前价值**：本文是 provider 配置、运行时行为、错误语义与验证状态的当前唯一 HOW。
- **后续变化**：CLI 命令、telemetry 账本与 smoke 仍由 [wiki 014](./014-agent-cli-telemetry.md) 拥有；本文记录的 work ID 都是历史进程快照，不代表当前仍存活。
- **代码入口**：[ModelRuntime](../../apps/server/src/steps/llm.ts)、[LLM call](../../apps/server/src/steps/llm-call.ts)、[local env loader](../../apps/server/src/config/local-env.ts)、[server assembly](../../apps/server/src/start.ts)、[CLI timeout](../../apps/cli/src/client.ts)。

## 设计目的

模型运行时必须提供一个安全、可测试、可替换的配置面。Pipeline 只编排 store 与 Step；RealStep 只请求语言模型，不自行解析环境变量、选择 provider 或实现 timeout。

本文独占当前 provider 配置与运行时语义；协议依据在 [LongCat research](../research/longcat-provider-config.md)，无凭据模板在 [.env.example](../../.env.example)，CLI/telemetry 操作在 [wiki 014](./014-agent-cli-telemetry.md)。本票没有新增领域词或不可逆架构决策，因此未新立 ADR。

## 起始上下文

本票交付 issue [#16](https://github.com/12bitsD/agent4novel/issues/16)。此前真实步骤把模型类型收窄为 deepseek 前缀，demo 检测、默认模型和 UI 提示也与 DeepSeek 绑定；修改 Base URL 无法安全地把厂商专用 adapter 变成通用 adapter。

[wiki 014](./014-agent-cli-telemetry.md) 已提供 CLI、遥测和失败证据，但不拥有 provider 配置。新的边界是：Pipeline/Step 保持 provider-neutral；key、provider URL 与 adapter 只在 server；测试 import 不读取本地凭据；显式错误配置响亮失败；live 数据出机边界必须写明。

## 技术方案

### 模块边界

shell/CI 与 server 入口加载的 .env.local 进入 ModelRuntime，再由 registry 选择 DeepSeek 或 LongCat；Work.config.model 可做内部覆盖。入口先 loadLocalEnv 再动态 import，测试直接 import 不加载本地文件；Node 不覆盖已有环境变量，所以 shell/CI 优先。callLlm 统一处理 generateObject、AbortSignal、本地 Zod 与脱敏 telemetry，start.ts 按 mode 装配 RealStep 或 FakeStep。

### 配置契约

| 配置 | 语义 | 默认或边界 |
|---|---|---|
| A4N_MODEL | server 启动默认模型 | 可空；支持 deepseek:model 或精确的 longcat:LongCat-2.0 |
| DEEPSEEK_API_KEY | DeepSeek Bearer credential | 仅 server |
| DEEPSEEK_BASE_URL | DeepSeek API base | https://api.deepseek.com |
| LONGCAT_API_KEY | LongCat Bearer credential | 仅 server |
| LONGCAT_BASE_URL | LongCat OpenAI-compatible base | https://api.longcat.chat/openai/v1 |
| A4N_LLM_TIMEOUT_MS | server 单次 provider 调用上限 | 代码默认 120000；整数 1000..900000；.env.example 为 LongCat 建议值 300000 |
| A4N_BASE_URL | CLI 到 agent4novel server 的地址 | 默认 http://localhost:8787；不是 provider URL |
| A4N_CLI_TIMEOUT_MS | CLI HTTP 请求等待上限的全局覆盖 | 未覆盖时普通请求默认 300000、advance 默认 1820000；整数 1000..3600000；--timeout-ms 优先 |

.env.local 只由 server 入口加载。CLI 是独立进程，不自动从该文件读取 A4N_BASE_URL 或 A4N_CLI_TIMEOUT_MS；需要在 CLI 所在 shell 设置或传 flag。

本地初始化从 .env.example 复制到不存在的 .env.local，并设权限 600。key 不得进入命令参数、客户端 bundle、Work.config、产物、fixture、截图、聊天或日志。

### 默认选择与作品覆盖

启动选择按以下顺序：

1. 设置 A4N_MODEL 时，先校验模型 ID，再要求对应 provider key 存在；失败抛 ModelConfigError，不进入 demo、不降级。
2. 未设置 A4N_MODEL 时，有 DeepSeek key 就选 deepseek:deepseek-chat。
3. 只有 LongCat key 时选 longcat:LongCat-2.0。
4. 两个 key 都没有时进入 demo，所有已注册步骤使用 FakeStep，不触发远程调用。

Work.config.model 可覆盖启动默认值。当前没有公开 UI/API 修改它；无效 ID 或缺少相应 key 会在 Step 边界返回不可重试的 llm-unavailable，不会自动改用另一家 provider。

切换已注册 provider 只改变模型 ID。新增 provider 必须选择正确 adapter、注册 provider、扩展 SupportedModelId 与 credential 校验，并补 transport 测试。

### Base URL 与凭据保护

Base URL 必须是绝对 http/https；非 loopback 必须 https，http 仅允许 localhost、127.0.0.0/8 或 ::1。禁止 userinfo、query 与 hash；日志只记录模型、耗时、token、finish reason、长度和 hash，不记录 key、素材或完整 prompt/output。

live 模式会把生成所需的 prompt、作品素材和上游产物发送给所选远程 provider。“本地应用”只表示应用与作品存储在本机，不表示推理数据不出机。

### Provider 协议与结构化输出

| Provider | Adapter | 当前 wire API | 正确性边界 |
|---|---|---|---|
| DeepSeek | @ai-sdk/deepseek | Chat Completions | adapter 能力加本地 Zod |
| LongCat 2.0 | @ai-sdk/openai-compatible | /chat/completions | json_object 响应模式加本地 Zod |

LongCat 公共 Chat 文档未承诺 json_schema。其 provider 配置因此设置 supportsStructuredOutputs=false，让 AI SDK 发送 response_format type=json_object；最终正确性由生产 Step 的 Zod schema 判断。

所有 RealStep 仍调用 generateObject。可解析 JSON 但 schema 不符，或截断后无法形成对象，都映射为可重试的 llm-invalid-output。

LongCat 的官方材料另有 Responses 支持信息，但当前 @ai-sdk/openai-compatible adapter 与本实现没有接入 Responses API。不能把 Chat Completions 的验证外推成 OpenAI 全协议兼容。

### 两层 timeout 与重试

A4N_LLM_TIMEOUT_MS 控制一次 generateObject；A4N_CLI_TIMEOUT_MS 或 --timeout-ms 统一覆盖 CLI 等待 server HTTP 请求的上限。没有显式覆盖时，普通请求保持 300000ms；一次 advance 可能串行执行多个自动通过步骤，所以它单独按 2 × 900000 加 20000 返回余量设置为 1820000ms。server 与 CLI timeout 不能混用。

Pipeline 不做 provider 自动重试，也不做跨 provider failover：

- 失败 Step 不落 artifact。
- 再次手动 advance 从失败 Step 继续。
- 已完成且已落库的上游 Step 不重跑。
- POST /advance 可能 HTTP 200 但 JSON kind=failed；只看 exit code 会漏报失败。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| Runtime、registry 与配置校验 | [llm.ts](../../apps/server/src/steps/llm.ts) |
| 模型调用、Zod、timeout 与 telemetry | [llm-call.ts](../../apps/server/src/steps/llm-call.ts) |
| 本地配置加载与步骤装配 | [local-env.ts](../../apps/server/src/config/local-env.ts)、[start.ts](../../apps/server/src/start.ts) |
| CLI timeout 与配置模板 | [client.ts](../../apps/cli/src/client.ts)、[.env.example](../../.env.example) |
| 协议依据与 CLI HOW | [LongCat research](../research/longcat-provider-config.md)、[wiki 014](./014-agent-cli-telemetry.md) |

## 测试与验证

### 自动化边界

ModelRuntime 测试以合成 key 与 fake fetch 覆盖选择、缺 key、非法 ID、URL 安全和 timeout；LongCat transport 断言 Bearer、精确模型 ID、/chat/completions 与 json_object。Step 测试通过 languageModel seam 覆盖作品 override、成功、timeout 和非法输出；它们目前不直接断言 telemetry。CLI 测试覆盖 REST、乐观锁、smoke、logs 与独立 timeout。

### 真实验证证据

独立 protocol smoke 已让 caption、creative、outline 三个生产 Step 经 LongCat Chat Completions 返回 schema-valid JSON，并保留了可复验指标，边界见 [LongCat research](../research/longcat-provider-config.md)。完整 CLI smoke 还保留两项关键故障结论：creative 曾在 8000 output tokens 以 length 截断，手动 advance 成功且保留 caption；outline 曾在 300000ms 单次上限超时，手动 advance 只重跑 outline。该 CLI smoke 的完整 telemetry 没有持久化，不能作为第二份可独立复验的记录；若需要第二份完整证据，必须在新进程重跑并保存脱敏结果。历史 work ID 属于已结束的内存进程，当前并不存在可继续使用的实例。

## 边界与非目标

| 情况 | 当前结果 |
|---|---|
| 显式模型/URL/credential 无效 | 启动 ModelConfigError；不 demo、不降级 |
| 作品 override 无效或缺 key | llm-unavailable，retryable=false |
| provider timeout / 非法输出 | llm-timeout / llm-invalid-output，retryable=true |
| 网络/provider 其他错误 | llm-unavailable，通常可重试并保留 attemptId |
| CLI 先到上限 / server 重启 | network-error / 内存作品与 telemetry 丢失 |

明确不做：

- 不做 Responses API、动态 provider DSL、自动发现、failover 或每作品模型 UI/API。
- 不把 key 写入作品、SQLite、浏览器、产物或可查询 telemetry。
- 不做持久化 store、后台 job、队列或异步 advance。

## 上下文演进

### 2026-08-29 — DeepSeek-only 配置收敛为 ModelRuntime

- **触发证据**：provider 选择、demo 检测、模型类型和凭据规则分散且绑定 DeepSeek。
- **原假设**：用 DeepSeek adapter 加 Base URL 覆盖即可承载其他兼容服务。
- **决定**：建立 ModelRuntime registry，DeepSeek 使用专用 adapter，LongCat 使用 OpenAI-compatible adapter。
- **影响**：Pipeline/Step 保持中立；新增 provider 有单一代码入口和测试 seam。
- **上下文处理**：replace；wiki 010/011 中的 DeepSeek-only runtime 说明不再代表当前实现。

### 2026-08-29 — LongCat 采用 Chat Completions + 本地 Zod

- **触发证据**：LongCat 明确公开 Chat Completions，但公共 Chat 文档没有承诺 json_schema；通用 adapter 也不提供 Responses。
- **原假设**：OpenAI-compatible 可以等同于全部 OpenAI 协议和严格 structured output。
- **决定**：接入 /chat/completions，使用 json_object，并把 schema 正确性留给本地 Zod。
- **影响**：当前三步已验证，但不得声称 Responses 或所有结构化任务都有协议保证。
- **上下文处理**：preserve；这是更换 adapter 或扩大兼容性声明前必须重审的证据边界。

### 2026-08-29 — 真实失败校准篇幅与两层 timeout

- **触发证据**：creative 在 8000 output tokens 截断，outline 在 300000ms 单次上限超时。
- **原假设**：一次默认输出预算和一个请求 timeout 足以覆盖整条 advance。
- **决定**：creative prompt 加篇幅纪律；保留 outline 16000 上限；server 单次 timeout 与 CLI 整次请求 timeout 独立。
- **影响**：后续 creative 两例未截断，outline 可手动重入，CLI 不会因 server 单步上限提前断开。
- **上下文处理**：preserve；不要用盲目自动 retry 掩盖 length、schema 与 timeout 的差异。

### 2026-09-04 — 清除进程快照的“当前状态”含义

- **触发证据**：旧记录曾描述当前进程保留 work-1、work-2、work-3，但存储明确随进程消失。
- **原假设**：验证结束时的内存状态可以继续作为后续 Agent 的可访问样例。
- **决定**：保留独立 protocol smoke 的数值证据和 CLI smoke 的故障结论，明确禁止推断历史 work ID 或完整 telemetry 当前仍可访问。
- **影响**：需要样例状态或第二份完整可复验证据时，必须在当前 server 进程重新创建并保存脱敏结果。
- **上下文处理**：compact；保留有证据支持的指标与故障结论，删除易误导的现场状态和可复验性承诺。

## 交接结论

后续 Agent 应只通过 ModelRuntime 增加或选择 provider，并把 .env.local、key、Base URL 与 adapter 保持在 server 边界。排障时先区分模型配置错误、结构化输出错误、单次 LLM timeout 和 CLI 请求 timeout；CLI/telemetry 的操作步骤去 [wiki 014](./014-agent-cli-telemetry.md)，LongCat 协议依据去 [research](../research/longcat-provider-config.md)。
