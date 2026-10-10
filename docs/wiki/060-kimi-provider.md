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

- **清单与固定点**：`docs/agents/ticket-completion-checklist.md` blob 为 `42116082e8ca2804d826cc00f6578270077f60eb`；固定点为 `59f6148e76b77178685982c2aec4cf11f4846077`；受保护验收方法 `/tmp/a4n-kimi-acceptance-r0.md` SHA-256 为 `96c37a61ed7e25dd103015b20ba5396a53bcc56b5041a9aa0a673fe678ed8f52`。
- **C1（锁定范围）**：`gh issue view 60 --repo 12bitsD/agent4novel --json ...` 已回读 issue #60 正文、开工对齐评论、`enhancement`/`ready-for-agent` 标签、OPEN 状态、assignee 和无 Project；交付模式为 `codex/kimi-provider` → `main` 的 PR 模式；`main` 当前无分支保护。非目标为真实付费调用、failover、Responses API、独立 SDK、工作流/作品数据模型和持久化语义变化。
- **C2（TDD/实现）**：RED/GREEN 及 AC1–AC7 映射见上文；候选只扩展现有 ModelRuntime/provider-neutral contract，保留 DeepSeek/LongCat 专用回归。Round 2 主 Agent 复验发现 `apps/cli/test/step-transport.test.ts` 的通用 helper 仍默认 LongCat，已迁移通用 transport/recording/A-B/error 用例至 Kimi，并将 LongCat thinking/config controls 明确隔离且命名为 provider-specific regression；Round 3 独立 review 又发现 CI `scripts/production-smoke.mjs` 仍使用 LongCat，已将该编译运行 smoke 的通用 provider、作者配置和 wire assertions 全部迁移至 Kimi；随后收口 reviewer 发现的 no-key container smoke 风险，显式清空 Kimi 两个凭据变量；每次修复后均重跑受影响测试。
- **C3（当前候选 T0）**：C5.1 冻结前的 43 个 staged 文件 manifest 只包含本票文件，`git write-tree` 为最新 T0 `01b5129405223be16f2df8325cb77525c2986edf`；`git diff --cached --check` 与 `git diff --check 59f6148e76b77178685982c2aec4cf11f4846077` 通过。候选没有夹带并发混入的 Wiki 005/009/014/020/046/051 变更；这些 foreign paths 保留在 tag `kimi-provider-mixed-snapshot`，不属于本票。
- **C3.1 本地门禁**：2026-10-10 针对当前候选实际执行并通过：
  - `pnpm --filter @agent4novel/server exec vitest run test/kimi-provider.test.ts test/author-config.test.ts`：2 files / 21 tests passed。
  - `pnpm --filter @agent4novel/cli exec vitest run test/step-transport.test.ts`：1 file / 12 tests passed。
  - `pnpm test`：contracts 21 files / 125 tests，CLI 18 / 213，server 43 / 444，web 34 / 216，全部通过。
  - `pnpm typecheck`：contracts、CLI、server、web 全部通过。
  - `pnpm build`：server 与 web 全部通过；仅有既有大 chunk warning。
  - `node scripts/production-smoke.mjs`：compiled server / same-origin Web / author config / local Kimi mock smoke passed。
  - `node --check scripts/container-smoke.mjs`：通过；该 smoke 显式清空 Kimi 两个凭据变量。
  - `docker compose config --quiet`、`git diff --cached --check`、固定点 diff check：通过。
- **C3.3–C3.4 安全/范围**：候选 staged patch 的凭据模式扫描无真实凭据；Kimi transport 只使用 synthetic key；`.env.local` 仍被 `.gitignore` 忽略；production/container smoke 均使用本地 mock 或 demo 且显式清空 Kimi 凭据；未发现危险命令、foreign Wiki paths 或锁文件/生成物夹带。日志/telemetry 只保留安全模型身份、hash、长度和分类错误，不写 key、完整 prompt 或 provider response。
- **C3.5 代码质量清理**：复用结论为继续沿用 `ModelRuntime`、现有 OpenAI-compatible adapter、共享 contract/schema、统一超时/错误/telemetry 接缝，没有重复 SDK 或旁路状态机；可读性结论为 Kimi 的 identity/key/base URL/transport 分支集中在既有 provider registry，测试 fixture 的通用默认值与 LongCat/DeepSeek 专用回归边界清晰；边界结论为 Kimi wire 映射、key alias、safe telemetry 与 no-key smoke 属于本票，未扩大 workflow、数据模型或 failover 语义；效率结论为没有增加运行时调用层或重复序列化，通用测试只切换默认 provider，且所有整理后的定向/全量测试与 typecheck/build 仍通过，未改变 AC 语义。
- **C4（知识维护）**：本页、Wiki 016、Wiki Index、README/README.en、schema、handoff、`.env.example`、Compose 和 CI 已更新；`CONTEXT.md`、ADR、research、运行 skill 记为 `N/A`，因为没有新领域词、不可逆跨票架构决策、研究所有权迁移或新的运行流程语义。
- **C4.9（三轮自校准）**：①代码 ↔ 行为/测试：逐项回读 provider registry、author config、isolated runner、telemetry、Web 和 smoke 落点，并以定向/全量测试、typecheck、build、compiled Kimi smoke 复核，未发现行为证据漂移；②代码 ↔ 最终 Wiki/领域词：逐项对照本页、Wiki 016、README、schema、handoff、`.env.example`、Compose/CI 与实现，确认 `kimi:kimi-k2.8-highspeed`、`KIMI_API_KEY`/`MOONSHOT_API_KEY`、wire model 和 no-paid-call 边界一致；③完整候选 ↔ issue AC/范围：以 fixed point、43 文件 manifest、完整 staged diff 和 issue #60 AC/非目标反查，确认仅覆盖 Kimi provider、通用测试 fixture、文档与 smoke 安全收口，没有 foreign Wiki、真实付费调用或票外架构变化。
- **C5.1–C5.3（候选冻结前审计）**：上述 fixed point、staged manifest、T0、完整 patch、commit/name-status、secret/range audit 已取得；C5.1–C5.3 可由当前工作区和命令回读。最新候选从固定点到 T0 共 43 个文件、370 insertions / 104 deletions；新增/修正范围仍只属于 Kimi provider、测试 fixture、CI smoke 和 no-key 安全边界。
- **C5.4–C5.5（双轴 review）**：上一候选 T0=`e7f0105e9069f7d7d2eca8d347a06caf1b6c44a8`、T1=`1cd19f4cc70d26b09d9e3f087b6e791de8e07479` 已由独立 reviewer 完成 T0→T1 比较并判 Standards PASS、Spec AC1–AC6 PASS；其发现的 residual risk 是 `scripts/container-smoke.mjs` 未清空 Kimi 凭据，已纳入当前新 T0 修复。该结论不能替代当前新 T0 的双轴复审。
- **C6.1–C6.2**：Round 3 review cleanup 仅修改 `scripts/container-smoke.mjs`，显式清空 `KIMI_API_KEY` 与 `MOONSHOT_API_KEY`，未改变产品行为；主 Agent 已执行 `node --check`、diff check，并保留此前已通过的 `pnpm build`、compiled Kimi smoke、`pnpm test`、`pnpm typecheck`。当前新 T0 仍需重新双轴 review。
- **C6.3（本次受控证据回写）**：本段先记录上一轮 review、no-key 风险修复、当前最新 T0、manifest、门禁和重审要求；上一轮 reviewer 对旧 pre-attestation tree 的完整性判定为 PASS、Spec AC1–AC6 为 PASS，但指出本段缺少 C3.5 与 C4.9 的逐项记录。仅补齐这两项预留证据后，修正后的 pre-attestation T1 为 `b48beb8abe692a2450eb9035c19d8bd9a81a28fa`；没有改动产品/source。
- **C6.4（独立 reviewer attestation）**：未参与实现的 reviewer Meitner（agent `01a1257b-f85e-7b41-82a1-3c6bd85f0fd0`）已精确比较 T0=`01b5129405223be16f2df8325cb77525c2986edf` → 修正后 T1=`b48beb8abe692a2450eb9035c19d8bd9a81a28fa`，确认完整性 `PASS`（仅 `docs/wiki/060-kimi-provider.md` 的预留证据区变化、diff check 通过、无 unstaged/untracked）；Standards `PASS`（C3.5/C4.9 缺口关闭）；Spec `PASS`（AC1–AC6，无回归）；AC7 的 PR/CI/merge/remote 仍为待完成而非失败。该 attestation 来源为 reviewer 原始回报，主 Agent 未替代其裁决。
- **C6.5（一次性 attestation 写回）**：在 C6.4 `PASS` 后，本次只在预留字段补入清单 blob、fixed point、T0、T1、C1–C5 各节判定、C6.1–C6.4 证据和 reviewer attestation；最终 tree 不写入自身内容。C6.6/C6.7 与 C7 仍待完成；本次写回不等同于发布前终止性裁决。
- **C6.6–C6.7 / C7**：均为 `pending`。在 T1 → 最终 evidence tree 的受控比较、精确提交、PR/CI/远端回读完成前，不创建 PR、不推送、不 merge、不关闭 issue；当前远端 `origin/codex/kimi-provider` 仍指向包含无关 Wiki 变更的 mixed snapshot `1b87352c0c4a4c5468febc3f72c61ee3623f99ed`，不得把它当作本票交付结果。

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
