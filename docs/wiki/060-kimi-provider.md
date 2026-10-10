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

- **清单与固定点**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；原始开发固定点 `59f6148e76b77178685982c2aec4cf11f4846077`；实际 PR base 为 `1b87352c0c4a4c5468febc3f72c61ee3623f99ed`。受保护验收方法 `/tmp/a4n-kimi-acceptance-r0.md` SHA-256 仍为 `96c37a61ed7e25dd103015b20ba5396a53bcc56b5041a9aa0a673fe678ed8f52`，标准没有因候选而降低。当前 T0/T1/发布前裁决待重新冻结及独立 review。
- **C1.1–C1.8 范围与交付**：已回读 issue #60 的 AC1–AC7、开工评论、标签、assignee、Project 和 native dependencies：OPEN，`enhancement`/`ready-for-agent`，assignee `12bitsD`，无依赖边、无 Project；标签/assignee 终态保持原值，Project 为 N/A（未加入）。模式仍为 `codex/kimi-provider` → PR → `main`；`main` protection API 返回 404，无强制 review/check 配置，但本票要求 CI 的 quality/container 两项成功后再 merge。用户授权 Loop 交付及本票范围，不含真实付费调用。开工对齐、TDD 切片与风险以本页及 issue 开工评论为据；当前 base reconciliation 只保留已在 main 的并发文档，不扩大产品范围。
- **C2.1–C2.5 验收/TDD**：原始 RED/GREEN 与逐条 AC 映射见上文，独立期望来自保护验收而非候选输出。Round 2 修复通用 CLI transport fixture 仍用 LongCat；Round 3 修复 compiled smoke 仍用 LongCat，并清空 container smoke 的 Kimi 两个凭据变量；LongCat thinking/config tests 和 DeepSeek 专用 adapter tests 保留。没有新增 SDK、failover、状态机或作品数据协议。C2.6 为 N/A（本票是行为变化，采用 RED/GREEN 而非无行为替代验证）。
- **C3.1–C3.2 / C3.6 本地门禁**：当前 base reconciliation 后的代码与上一已测候选相同；2026-10-10 重新执行并通过定向测试（Kimi/author-config 21、CLI transport 12）、`pnpm test`（contracts 125、CLI 213、server 444、Web 216）、`pnpm typecheck`、`pnpm build`、`node scripts/production-smoke.mjs`、`node --check scripts/container-smoke.mjs`、`docker compose --env-file /dev/null config --quiet`、`git diff --check`。Build 仅有既有 Web chunk warning；测试保留既有 AI SDK structured-output fallback 与 React `act(...)` 警告。没有配置独立 lint/format 脚本，以 typecheck 和 diff whitespace check 覆盖静态门禁；实际 container execution 交由 CI，不把 syntax check 冒充容器运行成功。
- **C3.3–C3.4 安全/范围**：2026-10-10 对最终 PR 候选执行凭据模式、危险命令/外部输入、生成物/锁文件和范围扫描：仅 synthetic key、本地 mock 或 demo；未发起真实付费模型调用；公开日志/telemetry 不包含 key、完整 prompt/output；`.env.local` 仍被 `.gitignore` 忽略；无未跟踪/未暂存文件。六篇并发 Wiki 文件与 PR base 字节相同，最终 PR 差异不包含这些文件。
- **C3.5 质量清理**：复用既有 ModelRuntime、OpenAI-compatible adapter、本地 schema、timeout/error/telemetry 接缝，无重复 SDK/helper；可读性上通用 Kimi fixture 与明确命名的 LongCat thinking/config 回归分开；边界只扩展 provider 识别、key/URL、fixture 与 no-key smoke；效率无新增调用层、重复序列化或运行时联网。base reconciliation 只改变历史父提交/保留 main 文档，没有改变 AC 行为。
- **C4.1–C4.8 知识维护**：Wiki 060/016、Index、schema、双语 README、handoff、env/Compose/CI 已随初始实现更新并保留。C4.3 的 CONTEXT 为 N/A（无新领域词）；C4.4 的 ADR/research 为 N/A（沿用既有适配器，不产生不可逆架构决定或研究所有权迁移）；C4.7 的运行 skill/流程文档为 N/A（HOW 仍由 Wiki 016 持有，启动/运行方法不变）。2026-10-10 已校验本页 schema/frontmatter/固定标题、#60 backlink、Wiki Index、相关本地链接及中英文 README 的 Kimi model/key/base-url 事实一致。
- **C4.9 三轮自校准**：①代码 ↔ 行为/测试：逐项核对 ModelRuntime、author config、isolated runner、telemetry、Web 与 smoke；定向验证没有发现漂移；②代码 ↔ Wiki/领域词：`kimi:kimi-k2.8-highspeed`、wire model、key alias、URL 和 no-paid-call 边界一致；③完整候选 ↔ issue AC/范围：初始实现来自原始固定点；当前 PR base 已含该实现，实际增量只有通用 CLI transport、compiled/container smoke 和本页证据，六篇并发 Wiki 原样保留。
- **历史 review / 例外**：Huygens 发现 production smoke 遗漏并修复；Carver 发现 container smoke 未清空 Kimi credentials 并修复；Meitner 对上一候选 Standards/Spec 和 C6.4/C6.6 判 PASS，另发现 C3.5/C4.9 记录缺口并补齐。这些结论只覆盖各自旧 tree，不替代当前 PR base 重审。早期 mixed snapshot 已直接出现在 main，source branch 也曾在未正确核对 PR base 差异时推送；此流程偏差不能追记为合规发布。此次不改写 main，保留其六篇并发 Wiki，把 source 历史整理为以当前 main 为父的安全增量，并重新执行 C5/C6 后才继续发布。
- **C5.1–C5.3 当前候选审计**：实际 base 为 `1b87352c0c4a4c5468febc3f72c61ee3623f99ed`；从 base 到候选的完整 diff 与每筆本地 commit 将重新审计，staged manifest、T0 与范围/secret 结果待冻结记录。此前 mixed 内容留在原 main 和本地 recovery tags，不混入 PR 增量。当前双轴 review 前的候选 T0 为 `35015b5b0adcf19ca0b1877e6e5384893b75438f`；pre-attestation T1 与独立裁决待完成。
- **C5.4–C5.6 双轴 review**：当前 base 重审 pending；AC1–AC6 的旧 review 通过只作历史证据。所有既有行为发现已修复，剩余风险是真实模型账号可用性/文学质量未验证，非本票目标。
- **C5.7 / C6.1–C6.2**：base drift 改变候选 tree/历史，已返回 C5，不复用旧裁决；本轮仅文档/历史收口，代码修复仍属于既有三轮，没有开启第四轮产品优化。受影响 gate 和独立 Standards/Spec 需针对重新冻结的候选完成。
- **C6.3（受控证据回写）**：本页的当前行为候选 T0=`35015b5b0adcf19ca0b1877e6e5384893b75438f`，实际 PR base 为 `1b87352c0c4a4c5468febc3f72c61ee3623f99ed`；pre-attestation T1=`33b4034c3374b0379a9bcbc63fb593c91cab02aa`。本次 T0→T1 仅修改预留 `### 完成审核证据`，没有改产品/source/上下文演进。
- **C6.4（独立 reviewer attestation）**：未参与实现的 reviewer Meitner（agent `01a1257b-f85e-7b41-82a1-3c6bd85f0fd0`）已精确比较上述 T0→T1，给出完整性 `PASS`（仅本页预留证据区、两侧 diff check 通过、无 unstaged/untracked）；Standards `PASS`（C3.1–C3.6、C4.1–C4.9 证据已补齐）；Spec `PASS`（AC1–AC6）；AC7 的 CI/PR review/merge/remote 仍为 `PENDING`。该结论来自 reviewer 原始回报，主 Agent 未替代裁决。
- **C6.5（一次性 attestation 写回）**：在 C6.4 `PASS` 后，本段一次性记录清单 blob、原始固定点、实际 PR base、当前 T0/T1、C1–C5、C6.1–C6.4 证据与 reviewer attestation；不记录最终 tree 自身哈希。C6.6/C6.7 与 C7 尚未完成。
- **C6.6–C6.7 / C7**：`PENDING`；下一步由同一或第二独立 reviewer 精确比较 T1→最终 evidence tree，随后提交/推送、创建 PR、等待 required CI/review、merge、远端回读、发布 issue 完成评论并关闭 issue。此前旧候选的 C6.6 结论不迁移为当前候选终止裁决。

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
