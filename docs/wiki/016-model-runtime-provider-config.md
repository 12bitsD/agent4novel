---
wiki_id: "016"
ticket: 16
ticket_state: done
context_state: current
summary: "ModelRuntime 统一模型、凭据、结构化输出和超时；LongCat 默认关闭 thinking，并支持有界生成参数覆盖。"
topics: ["model-runtime", "provider-config", "generation-parameters", "thinking", "credentials", "base-url-security", "structured-output", "llm-timeouts"]
code_paths: ["apps/server/src/index.ts", "apps/server/src/steps/llm.ts", "apps/server/src/steps/llm-call.ts", "apps/server/src/config/local-env.ts", "apps/server/src/start.ts", "apps/server/src/step-lab-main.ts", "apps/cli/src/local-step.ts", "packages/contracts/src/step.ts", "apps/cli/src/client.ts", ".env.example"]
symbols: ["ModelRuntime", "SupportedModelId", "ModelConfigError", "createModelRuntime", "modelRuntime", "generationSettings", "generationParametersSchema", "callLlm", "run-step", "DEFAULT_CLI_TIMEOUT_MS", "DEFAULT_ADVANCE_TIMEOUT_MS", "A4N_LLM_TIMEOUT_MS", "A4N_CLI_TIMEOUT_MS", "llm-timeout"]
inherits: ["014"]
changed_by: ["013", "005"]
read_when: ["configure-model-provider", "configure-generation-parameters", "run-isolated-step", "add-model-provider", "debug-llm-runtime", "change-llm-timeout", "audit-credential-safety"]
last_context_reviewed: "2026-09-13"
---

# 016 — 模型运行配置：统一多 Provider、凭据与超时

## Agent Context

- **读取时机**：配置或新增 provider、切换模型、调整 thinking/temperature/topP、运行独立节点、修改凭据/Base URL、排查结构化输出或 timeout 时读取。
- **原始目的**：把散落且 DeepSeek-only 的运行时选择收敛到 ModelRuntime，使 Pipeline 与 RealStep 无需感知 provider。
- **实际落地**：DeepSeek 与 LongCat 2.0 共用 registry；server 安全加载本地配置，统一校验 URL、模型、credential、单次 LLM timeout 和本地 Zod。generationSettings 统一生产与独立节点的生成参数；LongCat 默认 disabled/0.9/0.95，本轮接回验证状态见“测试与验证”。
- **当前价值**：本文是 provider 配置、运行时行为、错误语义与验证状态的当前唯一 HOW。
- **后续变化**：CLI／telemetry／smoke 仍由 [Wiki 014](./014-agent-cli-telemetry.md) 拥有；[Wiki 013](./013-setting-generation-review.md) 新增 Setting，显式禁用该步骤的 SDK 重试并记录新实测。[Wiki 005](./005-beat-generation-review.md) 增加 Beat 独立预算、零 SDK 重试和共享安全错误分类。本文 work ID 均为历史进程快照，不代表当前仍存活。
- **代码入口**：[ModelRuntime](../../apps/server/src/steps/llm.ts)、[LLM call](../../apps/server/src/steps/llm-call.ts)、[generation schema](../../packages/contracts/src/step.ts)、[local env loader](../../apps/server/src/config/local-env.ts)、[独立 worker](../../apps/server/src/step-lab-main.ts)、[CLI timeout](../../apps/cli/src/client.ts)。

## 设计目的

模型运行时必须提供一个安全、可测试、可替换的配置面。Pipeline 只编排 store 与 Step；RealStep 只请求语言模型，不自行解析环境变量、选择 provider 或实现 timeout。

本文独占当前 provider 配置与运行时语义；协议依据在 [LongCat research](../research/longcat-provider-config.md)，无凭据模板在 [.env.example](../../.env.example)，CLI/telemetry 操作在 [wiki 014](./014-agent-cli-telemetry.md)。本票没有新增领域词或不可逆架构决策，因此未新立 ADR。

## 起始上下文

本票交付 issue [#16](https://github.com/12bitsD/agent4novel/issues/16)。此前真实步骤把模型类型收窄为 deepseek 前缀，demo 检测、默认模型和 UI 提示也与 DeepSeek 绑定；修改 Base URL 无法安全地把厂商专用 adapter 变成通用 adapter。

[wiki 014](./014-agent-cli-telemetry.md) 已提供 CLI、遥测和失败证据，但不拥有 provider 配置。新的边界是：Pipeline/Step 保持 provider-neutral；key、provider URL 与 adapter 只在 server；测试 import 不读取本地凭据；显式错误配置响亮失败；live 数据出机边界必须写明。

## 技术方案

### 模块边界

shell/CI 与 server 入口加载的 .env.local 进入 ModelRuntime，再由 registry 选择 DeepSeek 或 LongCat；Work.config.model 可做内部覆盖。入口先 loadLocalEnv 再动态 import，测试直接 import 不加载本地文件；Node 不覆盖已有环境变量，所以 shell/CI 优先。callLlm 统一处理 generateObject、生成参数、AbortSignal、本地 Zod 与脱敏 telemetry，start.ts 按 mode 装配 RealStep 或 FakeStep。run-step 使用 server 包的独立 worker 加载配置和生产 Step，不依赖常驻 HTTP server；调用方式见 [Wiki 014](./014-agent-cli-telemetry.md#单节点实验-run-step)。

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
| A4N_CLI_TIMEOUT_MS | CLI HTTP 请求或独立 worker 总等待上限的全局覆盖 | 未覆盖时普通 300000、advance 1820000、Beat 通过 30000／再生 920000／恢复 GET 10000、run-step 920000；整数 1000..3600000；--timeout-ms 优先 |

.env.local 由常驻 server 或 run-step 的 server worker 入口加载。CLI 父进程不自动从该文件读取 A4N_BASE_URL 或 A4N_CLI_TIMEOUT_MS；需要在 CLI 所在 shell 设置或传 flag。worker 加载该文件不会反向改变父进程已经确定的等待期限。

本地初始化从 .env.example 复制到不存在的 .env.local，并设权限 600。key 不得进入命令参数、客户端 bundle、Work.config、产物、fixture、截图、聊天或日志。

### 默认选择与作品覆盖

启动选择按以下顺序：

1. 设置 A4N_MODEL 时，先校验模型 ID，再要求对应 provider key 存在；失败抛 ModelConfigError，不进入 demo、不降级。
2. 未设置 A4N_MODEL 时，有 DeepSeek key 就选 deepseek:deepseek-chat。
3. 只有 LongCat key 时选 longcat:LongCat-2.0。
4. 两个 key 都没有时进入 demo，所有已注册步骤使用 FakeStep，不触发远程调用。

Work.config.model 可覆盖启动默认值。当前没有公开 UI/API 修改它；无效 ID 或缺少相应 key 会在 Step 边界返回不可重试的 llm-unavailable，不会自动改用另一家 provider。

切换已注册 provider 只改变模型 ID。新增 provider 必须选择正确 adapter、注册 provider、扩展 SupportedModelId 与 credential 校验，并补 transport 测试。

### 生成参数与单节点覆盖

生成参数由 ModelRuntime.generationSettings 统一解析，生产链和 run-step 共用。LongCat-2.0 未显式设置时发送 `thinking: { type: "disabled" }`、`temperature: 0.9`、`top_p: 0.95`；这些是应用默认值。DeepSeek 省略参数时保留 adapter/provider 默认，不套用 LongCat 的默认值。

| config 字段 | 允许值 | run-step flag | 语义 |
|---|---|---|---|
| model | 已注册 provider:model | 通过 --config-file 设置 | 选择本次独立运行的模型 |
| directionCount | 整数 1..3 | 通过 --config-file 设置 | Creative 生成数量，省略为 2 |
| thinking | enabled / disabled | --thinking on / off | 仅 LongCat-2.0 可显式设置；DeepSeek 设置此项会失败 |
| temperature | 有限数字 0..1 | --temperature | 采样温度 |
| topP | 有限数字，大于 0 且不大于 1 | --top-p | 累积概率采样阈值；wire 字段为 top_p |

`generation.json` 示例：

~~~json
{
  "model": "longcat:LongCat-2.0",
  "thinking": "disabled",
  "temperature": 0.9,
  "topP": 0.95
}
~~~

run-step 的参数按“显式 flag → config-file 对应字段 → 所选模型的运行时默认值”逐字段取值。flag 不清空文件中其他字段；文件会先校验，因此 `temperature: 2` 不能靠后续 `--temperature 0.9` 掩盖。配置文件只接受上表字段，SP 使用独立的 `--system-prompt-file`。`--thinking` 用 on/off，JSON 用 enabled/disabled，不能混写。

当前接口明确拒绝 `--top-k`，config-file 中的 topK、top_k 和其他未知字段也会失败；不会悄悄忽略或将其转换为 topP。参数通过 generateObject options 传给 adapter，telemetry.generation 只保留实际解析出的公开值，不包含 reasoning 内容。未在配置/模型解析前开始调用的失败不保证带 generation 或 telemetry。

作品仍只通过内部 AgentConfig 覆盖这些参数；本轮未增加作品配置 UI/API。run-step 可用 config-file 选择模型和参数，但不保存 Work.config。它要求真实模型配置，缺 key 时失败，不切到 demo 或其他 provider；模型选择仍需符合本页 credential 与 Base URL 边界。

独立 worker 先加载 `.env.local`，再用 config-file 的 `model`（如有）覆盖自身 A4N_MODEL，最后初始化 ModelRuntime。因此请求模型优先于 shell/文件中的启动默认；没有请求模型时沿用“默认选择与作品覆盖”中的启动顺序。校验和 credential 要求针对本次选中的模型：即使旧启动默认缺 key，只要请求模型有效且有 key，也可运行；请求模型缺 key 时返回 llm-config-invalid。覆盖只作用于这一 worker，不修改父进程、文件或常驻 server；常驻 server 仍拒绝缺少对应 key 的显式 A4N_MODEL。

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

A4N_LLM_TIMEOUT_MS 控制一次 generateObject；A4N_CLI_TIMEOUT_MS 或 --timeout-ms 统一覆盖 CLI 等待 server HTTP 请求的上限。没有显式覆盖时，普通请求保持 300000ms；一次 advance 可能串行执行多个自动通过步骤，所以它单独按 2 × 900000 加 20000 返回余量设置为 1820000ms。Beat 命令的默认完整期限为通过 30000ms、再生 920000ms，恢复 GET 10000ms；显式全局 CLI 覆盖仍优先。server 与 CLI timeout 不能混用。

run-step 默认给独立 worker 总计 920000ms，覆盖进程启动、模型调用与结果读取；`--timeout-ms` 优先于 CLI 父进程的 A4N_CLI_TIMEOUT_MS。单次 LLM 仍受 A4N_LLM_TIMEOUT_MS 限制。CLI deadline 到期会结束 worker 并返回 network-error；远程 provider 可能仍在处理请求，不能据此推断远端已取消或自动重跑。

Pipeline 不做 provider 自动重试，也不做跨 provider failover：

- 失败 Step 不落 artifact。
- 再次手动 advance 从失败 Step 继续。
- 已完成且已落库的上游 Step 不重跑。
- POST /advance 可能 HTTP 200 但 JSON kind=failed；只看 exit code 会漏报失败。

这不等于 SDK 内部请求重试为零。#13 核对已安装 SDK 后发现其默认重试次数为 2；Setting 与 Beat 显式传 maxRetries=0，其他步骤保留 SDK 默认值。一次 generateObject 的总等待仍受本页 LLM timeout 限制；具体证据与 Setting 验证见 Wiki 013。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| Runtime、registry 与配置校验 | [llm.ts](../../apps/server/src/steps/llm.ts) |
| 生成参数和独立运行配置 | [step.ts](../../packages/contracts/src/step.ts)、[step-experiment.ts](../../packages/contracts/src/step-experiment.ts)、[step-lab-main.ts](../../apps/server/src/step-lab-main.ts)、[local-step.ts](../../apps/cli/src/local-step.ts) |
| 模型调用、Zod、timeout 与 telemetry | [llm-call.ts](../../apps/server/src/steps/llm-call.ts) |
| 本地配置加载与步骤装配 | [local-env.ts](../../apps/server/src/config/local-env.ts)、[start.ts](../../apps/server/src/start.ts) |
| CLI timeout 与配置模板 | [client.ts](../../apps/cli/src/client.ts)、[.env.example](../../.env.example) |
| 协议依据与 CLI HOW | [LongCat research](../research/longcat-provider-config.md)、[wiki 014](./014-agent-cli-telemetry.md) |

## 测试与验证

### 自动化边界

ModelRuntime 测试以合成 key 与 fake fetch 覆盖选择、缺 key、非法 ID、URL 安全和 timeout；LongCat transport 断言 Bearer、精确模型 ID、/chat/completions 与 json_object。Step 测试通过 languageModel seam 覆盖作品 override、成功、timeout 和非法输出；CLI 测试覆盖 REST、乐观锁、smoke、logs 与独立 timeout。

2026-09-13 接回的 [llm.test.ts](../../apps/server/test/llm.test.ts)、[isolated-runner.test.ts](../../apps/server/test/isolated-runner.test.ts)、[step-transport.test.ts](../../apps/cli/test/step-transport.test.ts) 覆盖 LongCat 默认及显式参数、DeepSeek thinking 拒绝、config/flag 优先级、topK 拒绝、worker 模型选择与安全 generation 遥测。本轮 contracts/server/CLI 共 280 测、web 64 测通过；四包 typecheck 与 workspace build 通过。仅保留 SDK 的 json_object 已知提示和 Vite 单 chunk 大于 500 kB 提示。命令、RED/GREEN 与剩余项见 [本轮验证记录](../experiments/caption-adoption-2026-09-13/plan.md#验证记录)；独立评阅和最终文档检查结果见该记录，没有新增真实 provider 调用或模型质量结论。

### 真实验证证据

独立 protocol smoke 已让 caption、creative、outline 三个生产 Step 经 LongCat Chat Completions 返回 schema-valid JSON，并保留了可复验指标，边界见 [LongCat research](../research/longcat-provider-config.md)。完整 CLI smoke 还保留两项关键故障结论：creative 曾在 8000 output tokens 以 length 截断，手动 advance 成功且保留 caption；outline 曾在 300000ms 单次上限超时，手动 advance 只重跑 outline。该 CLI smoke 的完整 telemetry 没有持久化，不能作为第二份可独立复验的记录；若需要第二份完整证据，必须在新进程重跑并保存脱敏结果。历史 work ID 属于已结束的内存进程，当前并不存在可继续使用的实例。

## 边界与非目标

| 情况 | 当前结果 |
|---|---|
| 显式模型/URL/credential 无效 | 启动 ModelConfigError；不 demo、不降级 |
| 作品 override 无效或缺 key | llm-unavailable，retryable=false |
| generation 字段/值无效或 topK | CLI 预校验为 usage / invalid-input；直接进入运行时则为不可重试 llm-unavailable |
| 非 LongCat 显式 thinking | 通过 CLI 参数形状校验后，运行时返回 llm-unavailable，retryable=false |
| provider timeout / 非法输出 | llm-timeout / llm-invalid-output，retryable=true |
| 网络/provider 其他错误 | llm-unavailable，通常可重试并保留 attemptId |
| CLI 先到上限 / server 重启 | network-error / 内存作品与 telemetry 丢失 |

明确不做：

- 不做 Responses API、动态 provider DSL、自动发现、failover 或每作品模型 UI/API。
- 不把 key 写入作品、SQLite、浏览器、产物或可查询 telemetry。
- 不做持久化 store、后台 job、队列或异步 advance。

## 上下文演进

### 2026-09-13 — 统一生成参数并支持独立节点覆盖

- **触发证据**：用户要求将 Caption SP 对照使用的 CLI 与 generation 能力接回主仓库，并保留 LongCat 的 thinking disabled、temperature 0.9、topP 0.95。对应实现为 generationSettings、共享参数 schema、callLlm 和 run-step worker。
- **原假设**：此前配置 HOW 聚焦模型 ID、credential、wire protocol 与 timeout，独立实验的生成参数和 SP 由临时运行入口承担，缺少可复用的覆盖契约。
- **决定**：模型运行时统一默认值与校验；config-file 及显式 CLI flag 可逐字段覆盖，先校验文件再应用 flag。topK 明确拒绝；DeepSeek 不接受 LongCat thinking 控制。自定义 SP 的节点输入与文件语义归 Wiki 014。
- **影响**：生产链与独立运行使用相同生成参数解析和安全 telemetry.generation；凭据与 adapter 继续留在 server 包。run-step worker 加载本地配置后优先选择请求模型，CLI 总等待仍在父进程控制；不会新增作品配置 UI、持久化或 provider failover。
- **上下文处理**：`preserve` 原始 provider 选择、LongCat Chat 协议决定、真实失败及重入证据；`replace` 当前配置摘要与 CLI timeout 范围，新增生成参数 HOW。本轮本地测试结果记录于“自动化边界”，独立评阅与最终文档检查结果见本轮验证记录，不把历史真机成功外推为本轮证明；Caption SP 决定见 Wiki 011。

### 2026-09-08 — Beat 接入共享模型与错误边界

- **触发证据**：#5 真实 Beat 三类合成样例及再生已运行；共享 helper 脱敏测试覆盖原始 text/cause/provider message。
- **原假设**：只有 Setting 需要零重试，CLI 普通和 advance 两档足够。
- **决定**：Beat 同样禁用 SDK 重试；增加通过／再生／恢复读取期限；共享错误只返回安全分类与关联信息。
- **影响**：配置 ownership 不变；新实测与生产 live 上游 Creative 失败的边界见 Wiki 005，CLI HOW 见 Wiki 014。
- **上下文处理**：preserve 旧 provider 与失败实验；replace 当前重试、CLI 期限和后续关系，不把历史样例当作当前存活作品。

### 2026-09-05 — 区分 Pipeline 与 SDK 请求重试

- **触发证据**：#13 一次生成要求下，安装 SDK 的默认 maxRetries 为 2。
- **原假设**：“Pipeline 不自动重试”容易被误读成底层 HTTP 也只尝试一次。
- **决定**：仅 Setting 显式覆盖为 0；不改变其他步骤或 provider 配置。
- **影响**：运行 skill 与 Wiki 013 同步区分调用层次；旧三步实测仍只证明当时观察到的结果。
- **上下文处理**：preserve 原 timeout 配置与失败证据；replace 重试层次的歧义说明，不变更配置 HOW 归属。

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

后续 Agent 应通过 ModelRuntime 增加或选择 provider、调整生成参数，并把 .env.local、key、Base URL 与 adapter 保持在 server 边界。排障先区分输入/参数校验、模型配置、结构化输出、单次 LLM timeout 与 CLI 总等待；CLI/telemetry 操作去 [Wiki 014](./014-agent-cli-telemetry.md)，LongCat 协议依据去 [research](../research/longcat-provider-config.md)。本轮独立评阅与最终文档检查结果统一记录在本轮计划。
