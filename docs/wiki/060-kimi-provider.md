---
wiki_id: "060"
ticket: 60
ticket_state: active
context_state: current
summary: "在 ModelRuntime 中增加 Kimi OpenAI-compatible provider，并将通用测试模型固定为 kimi-k2.8-highspeed。"
topics: ["model-runtime", "provider", "kimi", "credentials", "test-fixtures"]
code_paths: ["apps/server/src/steps/llm.ts", "apps/server/src/config/author-config-service.ts", "packages/contracts/src/author-config.ts", "apps/server/test/kimi-provider.test.ts", "apps/web/src/pages/AuthorConfigPanel.tsx", "compose.yaml"]
symbols: ["DEFAULT_KIMI_MODEL_ID", "DEFAULT_KIMI_BASE_URL", "createModelRuntime", "SupportedModelId", "KIMI_API_KEY", "MOONSHOT_API_KEY"]
inherits: ["016"]
changed_by: []
read_when: ["add-kimi-provider", "configure-kimi", "test-kimi-model", "audit-provider-routing"]
last_context_reviewed: "2026-10-10"
---

# 060 — Kimi API provider 与测试模型切换

## Agent Context

- **读取时机**：新增或排查 Kimi provider、调整 Kimi 凭据/Base URL、解释 `kimi:kimi-k2.8-highspeed` 与 wire model 的差异、迁移通用测试 fixture 时读取。
- **原始目的**：在既有 `ModelRuntime` provider 边界内接入 Kimi OpenAI-compatible API，并让通用测试使用用户指定的 `kimi-k2.8-highspeed`，同时保持 DeepSeek/LongCat 专用回归覆盖。
- **实际落地**：内部模型 ID 为 `kimi:kimi-k2.8-highspeed`；默认 Kimi Base URL 为 `https://api.moonshot.cn/v1`；server 读取 `KIMI_API_KEY`，兼容读取官方别名 `MOONSHOT_API_KEY`；请求经现有 OpenAI-compatible adapter 发往 `/chat/completions`，wire model 不带 provider 前缀；作者配置、`run-step`、telemetry、Web contract 和 UI 都能识别 `kimi:`。
- **当前价值**：Kimi provider 复用既有凭据、Base URL 安全校验、JSON mode、本地 Zod、timeout 和错误语义；不添加 Kimi 专用 thinking 参数或 provider failover。
- **后续变化**：暂无后续 ticket；完成状态、CI 和远端交付以 GitHub issue [#60](https://github.com/12bitsD/agent4novel/issues/60) 的最终回读为准。
- **代码入口**：[ModelRuntime](../../apps/server/src/steps/llm.ts)、[Kimi transport test](../../apps/server/test/kimi-provider.test.ts)、[author-config contract](../../packages/contracts/src/author-config.ts)、[author config service](../../apps/server/src/config/author-config-service.ts)、[Web selector](../../apps/web/src/pages/AuthorConfigPanel.tsx)。

## 设计目的

Kimi 是新增的 provider，不应让各个 Step、CLI 或 Web 页面自行判断供应商。实现沿用 #16 的深模块边界：provider adapter、credential、Base URL 和模型路由留在 server 的 `ModelRuntime`；公共配置 contract 只表达可选模型 ID 和已知 provider；生产 Step 继续只依赖 `languageModel()` 与共享结构化输出链路。

本票的通用测试模型固定为 `kimi:kimi-k2.8-highspeed`，但不删除 DeepSeek/LongCat 专用 adapter、thinking 和旧 transport 回归测试。这样“默认使用 Kimi”与“既有 provider 不回归”两个目标同时可验证。

## 起始上下文

本票交付 issue [#60](https://github.com/12bitsD/agent4novel/issues/60)，继承 [Wiki 016](./016-model-runtime-provider-config.md) 的 provider-neutral `ModelRuntime`、OpenAI-compatible adapter、本地 schema 校验和 Base URL/key 安全边界。开工对齐、范围、非目标和受保护验收方法记录在 issue 评论；验收方法文件为 `/tmp/a4n-kimi-acceptance-r0.md`，SHA-256 为 `96c37a61ed7e25dd103015b20ba5396a53bcc56b5041a9aa0a673fe678ed8f52`。

Kimi 官方快速开始文档确认 OpenAI-compatible Chat Completions、Bearer credential 和 `https://api.moonshot.cn/v1` base URL；本票没有对用户指定模型做真实付费调用，因此不把账号侧模型可用性写成已验证事实。

## 技术方案

### 模型与凭据

- 公开/内部模型 ID：`kimi:kimi-k2.8-highspeed`。
- wire model：`kimi-k2.8-highspeed`，只在 provider 请求体中出现无前缀名称。
- 默认 Base URL：`https://api.moonshot.cn/v1`；可用 `KIMI_BASE_URL` 覆盖，但仍经过既有绝对 HTTP(S)、非 loopback 必须 HTTPS、无 userinfo/query/hash 规则。
- canonical key：`KIMI_API_KEY`；为兼容 Kimi 官方文档的环境变量名，读取 `MOONSHOT_API_KEY` 作为 fallback。`KIMI_API_KEY` 优先；key 不进入作品、SQLite、日志或公开 telemetry。
- 未显式设置 `A4N_MODEL` 时，选择顺序仍为 DeepSeek → LongCat → Kimi → demo；显式 Kimi 模型缺 key 时硬失败，不降级到其他 provider。

### 请求与输出

Kimi 注册为 `@ai-sdk/openai-compatible` provider，使用 `/chat/completions` 和 Bearer header。`supportsStructuredOutputs` 设为 `false`，由 AI SDK 请求 `response_format: { type: "json_object" }`，最终结构由现有 Step Zod schema 校验。Kimi 不复用 LongCat 的 `thinking` provider option；对 Kimi 设置 thinking 仍沿用共享运行时的不可用错误。

### 测试迁移

通用 server、contracts、CLI/worker 和 Web fixture 的默认模型改为 `kimi:kimi-k2.8-highspeed`。CLI fake provider 返回的 wire model 也严格使用 `kimi-k2.8-highspeed`。`llm.test.ts`、`step-transport.test.ts` 等明确测试 DeepSeek/LongCat adapter 或 LongCat thinking 的用例保留，作为旧 provider 回归，而不是通用默认模型。

## 代码落点

| 责任 | 权威入口 |
|---|---|
| Kimi registry、模型解析、key、默认 URL | [apps/server/src/steps/llm.ts](../../apps/server/src/steps/llm.ts) |
| 作者配置 provider 推导 | [apps/server/src/config/author-config-service.ts](../../apps/server/src/config/author-config-service.ts) |
| 作者配置模型与 provider contract | [packages/contracts/src/author-config.ts](../../packages/contracts/src/author-config.ts) |
| 安全 telemetry / isolated run 模型识别 | [apps/server/src/steps/llm-call.ts](../../apps/server/src/steps/llm-call.ts)、[apps/server/src/steps/isolated-runner.ts](../../apps/server/src/steps/isolated-runner.ts) |
| Web 模型选择 | [apps/web/src/pages/AuthorConfigPanel.tsx](../../apps/web/src/pages/AuthorConfigPanel.tsx) |
| 配置模板、Compose、CI、用户说明 | [.env.example](../../.env.example)、[compose.yaml](../../compose.yaml)、[README.md](../../README.md)、[README.en.md](../../README.en.md)、[.github/workflows/ci.yml](../../.github/workflows/ci.yml) |
| 核心 Kimi transport 验收 | [apps/server/test/kimi-provider.test.ts](../../apps/server/test/kimi-provider.test.ts) |

## 测试与验证

### TDD 与 AC 映射

- **RED**：实现前新增 Kimi provider 测试在 server suite 中暴露三类缺口：Kimi-only 环境仍为 demo、显式 Kimi 缺 key 不失败、Kimi registry/transport 不存在。该阶段未做真实网络调用。
- **GREEN**：Kimi-only 选择、显式缺 key、官方 Moonshot key alias、非 loopback HTTP Base URL 拒绝、fake fetch 的 endpoint/Bearer/wire model/json_object/local Zod 均由 `kimi-provider.test.ts` 覆盖。
- **AC1–AC3**：`llm.ts` 与 Kimi fake transport test；内部 ID、wire model、key、URL、安全 JSON mode 和本地 schema 均可直接复验。
- **AC4**：author config contract/service、isolated-runner、llm-call、Web selector 及对应 contracts/server/CLI/Web tests。
- **AC5**：通用 fixture 迁移清单见提交 diff；旧 provider-specific adapter/LongCat thinking tests 明确保留。
- **AC6**：`.env.example`、双语 README、CI 空变量、Wiki 016、handoff 已更新；未发起真实付费模型调用。
- **AC7**：Ticket Completion Checklist 的 C1–C6 在发布前继续收口；PR/CI/merge/远端回读尚未完成。

### 已执行验证

2026-10-10 已执行：

```text
pnpm --filter @agent4novel/server exec vitest run test/kimi-provider.test.ts test/author-config.test.ts  # 21 tests passed
pnpm test                                                                  # contracts 125, CLI 213, server 444, web 216 passed
pnpm typecheck                                                             # contracts, CLI, server, web passed
pnpm build                                                                 # server and web build passed
docker compose config --quiet                                             # passed
git diff --check                                                           # passed
```

已知警告：Kimi/LongCat `supportsStructuredOutputs:false` 会触发 AI SDK 关于 JSON schema fallback 的预期提示；Web 中已有 React `act(...)` 警告；生产 Web build 保留既有大 chunk warning。定向测试、完整测试、typecheck、build 已通过；最终 secret/范围审计、独立双轴 review、CI 和远端交付尚待完成。

### 完成审核证据

- **清单与候选**：清单 blob、固定点 SHA、T0、T1、staged manifest：待最终候选冻结后填写；固定点为 `59f6148e76b77178685982c2aec4cf11f4846077`。
- **逐项判定**：C1–C4 已有开工、实现和文档证据；C5、C6.1–C6.7 待候选冻结、独立 review 和发布前裁决。不得据此提前宣称 C6 通过。
- **验收与 TDD**：issue #60；RED/GREEN 和 AC 映射见本节；保护验收方法 SHA 见“起始上下文”。
- **本地门禁**：定向 Kimi/author-config 测试、完整测试、typecheck、build、`git diff --check` 已通过；secret/范围扫描已执行且没有发现候选中的真实凭据，最终候选审计待完成。
- **双轴 review**：独立 Standards/Spec reviewer 尚未取得；已有 reviewer 调度因模型容量失败，不能将其记为通过。
- **修复与回归**：已按 Kimi provider、author config、telemetry、CLI/worker、Web 和 docs 影响面重跑完整 tests/typecheck；后续 review 发现修复须重新冻结候选。
- **知识维护**：Wiki 060（本页）、Wiki 016、Wiki Index、README/README.en、schema、handoff、`.env.example`、CI 已更新；`CONTEXT.md`、ADR、research、运行 skill 不受影响，原因是没有新领域词、不可逆架构决策、外部选型研究所有权或运行流程变化。
- **发布前裁决**：待独立 reviewer 对 T1 给出终止性 `PASS`/`FAIL`，并按清单写入候选证据。

## 边界与非目标

- 不进行真实 Kimi 付费调用；fake fetch 只证明本地 adapter 装配和 wire 请求形状。
- 不承诺 `kimi-k2.8-highspeed` 在当前账号、区域或时点一定可用；真实模型可用性需由用户配置 key 后自行验证。
- 不接入 Responses API、独立 Kimi SDK、动态 provider DSL、provider failover、队列、作品数据模型或作者配置持久化新语义。
- 不为 Kimi 增加 LongCat 专用 `thinking` 参数；Kimi 的采样字段继续走共享 `temperature/topP` contract。
- 不把“所有测试”解释为删除既有 provider-specific 回归；通用/default/integration fixtures 使用 Kimi，DeepSeek/LongCat 专用测试保留。

## 上下文演进

### 2026-10-10 — #60 增加 Kimi provider

- **触发证据**：用户要求新增 Kimi API endpoint，并让测试模型使用 `kimi-k2.8-highspeed`。
- **原假设**：#16 的 DeepSeek/LongCat registry 足以覆盖当前测试和运行配置。
- **决定**：扩展现有 registry，而不是新建 Kimi SDK、旁路配置或 provider DSL；保留 provider 前缀作为内部模型身份，wire 层去掉前缀。
- **影响**：模型 contract、作者配置推导、telemetry 安全识别、独立 worker、Web 选择和通用测试 fixture 都增加 Kimi；旧 provider 专用回归保留。
- **上下文处理**：`preserve` provider-neutral、key/URL 脱敏、本地 schema 和无 failover 边界；`replace` 仅更新 provider 列表、测试模型与用户配置入口。

## 交接结论

下一位 Agent 可以假定：Kimi 的唯一运行时注册入口是 `ModelRuntime`；`KIMI_API_KEY` 优先、`MOONSHOT_API_KEY` 兼容；`kimi:kimi-k2.8-highspeed` 是内部测试模型，wire model 必须是 `kimi-k2.8-highspeed`；通用测试应继续使用该模型，旧 provider-specific 测试除非有明确票面理由不得删除。`pnpm build` 已通过；下一步是冻结候选、完成独立 Standards/Spec review 和 C6 证据收口，再按 issue #60 的交付模式创建 PR；在 CI/远端回读完成前，不能关闭 issue。
