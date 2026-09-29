---
wiki_id: "019"
ticket: 19
ticket_state: done
context_state: current
summary: "统一六类产物、存储与公开协议验证；保留关卡、版本条件和未知写入恢复。"
topics: ["contract-governance", "runtime-validation", "storage-boundary", "public-api"]
code_paths: ["packages/contracts/src/**", "apps/server/src/store/**", "apps/server/src/routes/works.ts", "apps/cli/src/client.ts", "apps/web/src/api.ts"]
symbols: ["Artifact", "artifactSchema", "WorkStore", "workViewSchema", "ApiError"]
inherits: ["013", "006"]
changed_by: ["009"]
read_when: ["change-public-contract", "validate-artifact-content", "implement-storage-adapter"]
last_context_reviewed: "2026-09-30"
---

# 019 — 统一契约与验证边界

## Agent Context

- **读取时机**：调整公开数据、持久化内容校验或消费者解析。
- **原始目的**：[#19](https://github.com/12bitsD/agent4novel/issues/19) 要求共享定义和职责明确，防止跨模块漏改。
- **实际落地**：六 kind/status 共享内容注册表，Store 写前/读回验证，REST/CLI/Web 解析及身份关联，独立实验成功包复验；已随 [PR #34](https://github.com/12bitsD/agent4novel/pull/34) 合并，#19 已关闭。原发布前证据保留如下。
- **当前价值**：继承 #6 多章、CAS 和未知写入恢复，不改变作者操作。
- **后续变化**：[Wiki 009](./009-sqlite-persistence.md) 沿同一 Store 接口和内容验证接入 SQLite；SQL 约束、事务及真实重启证据由该页负责，本页仍拥有共享契约边界。
- **代码入口**：contracts 的 Artifact/公开协议、Store、works 路由、CLI client、Web api。

## 设计目的

让非法内容在提交前被拒绝，协议漂移在消费者入口被识别，并且不把响应解析失败误报成“没有写入”。WHAT 和 AC 以 GitHub 票面为准。

## 起始上下文

- 起始固定点：`3781da36e2e38deca67ae629b138280bea51eec9`；已含 #6，工作区起始 clean。发布前 main 新增 README/清单提交，交付固定点更新为 `e86230205167ff2ab8472edb7c5193b9e67948e2`；保留新的 README，详见变化事件。
- 交付：`feat/19-contract-governance` → PR → `main`；用户已授权对齐后逐票 loop 交付 MVP。
- #19 原无 assignee、Project、native blocker；2026-09-30 claim 给 `12bitsD`。起始 `needs-triage`；范围收敛后改 `ready-for-agent`，完成保持此标签及 assignee；Project N/A。不改其他票终态。
- 三案研究与跨票收敛见 [MVP 研究](../research/mvp-delivery-options.md)。用户授权普通 grilling 工程判断由 Agent 自主完成，Human 只处理关键范围/权限/不可逆取舍；测试接缝无需再次询问。
- 当前 Artifact 仅校验 JSON envelope；WorkView 额外校验部分 kind；Store 缺内容兜底，部分 HTTP/消费者仍依赖类型断言。

## 技术方案

采用按信任边界复用共享 schema，结合 schema 派生类型。维护契约清单，不新建端点生成框架。模型私有输入/包装保持服务端归属；输出注入 ID 后按正式内容复验。

### 已执行的实现前计划

1. contracts → Store 纵切：六 kind 内容和 pending/approved 差异；错误内容、错配与状态升级 RED → 最小 GREEN；再覆盖零写入、引用隔离与既有 CAS。
2. HTTP 纵切：公开请求/响应定义共享；非法输入和坏输出 RED → GREEN，保持错误码及既有拒绝/未知语义。
3. CLI/Web 纵切：共享返回解析与资源身份核对；响应丢失/畸形写响应 RED → GREEN，仍先回读，不自动重放。
4. 更新清单/schema/Wiki/README/handoff，定向与全仓门禁；三轮自校准、双轴独立 review、独立 attestation 后交付。

测试接缝为共享 parse、WorkStore 公共接口、真实 HTTP、CLI 命令与 Web API/用户行为。沿现有接口观测，不测试私有 helper。逻辑提交边界为本票完整契约治理（测试、消费者和文档不可拆成不一致远端状态）；逐片保留本地 RED/GREEN，不在门禁完成前发布。

## 代码落点

| 入口 | 责任 |
|---|---|
| `packages/contracts/src/artifact-envelope.ts`、`artifact-content.ts`、`artifacts.ts` | 外壳/内容分层避免循环依赖，六 kind/status 注册表及 Work 快照身份约束 |
| `work-requests.ts`、`public-api.ts`、`step-experiment.ts` | 公共请求/响应/错误和实验成功内容；类型从 schema 派生 |
| `apps/server/src/store/validation.ts`、`in-memory-store.ts` | 固定安全错误，校验先于状态修改；读回的 head 验证 |
| `apps/server/src/contract-response.ts`、`routes/works.ts`、`app.ts` | 输出校验、输入共享定义、安全 500/404；命令扩展保留 |
| `apps/server/src/step-lab-main.ts` | 跨进程成功/失败包在 stdout 前复验 |
| `apps/cli/src/client.ts`、`apps/web/src/api.ts` | 实际响应 parse 和请求身份关联，unknown 优先于 HTTP4xx |

契约拥有者、生产者、消费者、全部验证点和保留重复的理由统一见 [清单](../agents/contract-governance.md)。

## 测试与验证

2026-09-30 当前实现运行 `COREPACK_ENABLE_AUTO_PIN=0 pnpm test` / `pnpm typecheck` / `pnpm build` 均 exit 0；contracts 100、server 248、CLI 166、Web 120，共 634。构建仍有原有 docx chunk >500 kB 提示，未新增依赖或锁文件改动；root build 当前只执行已有 Web build，server 生产构建归 #33。测试使用 fake/本机模拟供应商，不调用真实模型；本票不改变 Prompt/模型生成机制，无需重复文学质量实验。

| AC | 实现和可复验入口 |
|---|---|
| AC1 现状清单 | `docs/agents/contract-governance.md` 列出内容、全部 REST、跨进程协议、私有包装及责任 |
| AC2 kind/content 和存储拒绝 | `artifact-validation.test.ts`、`store-validation.test.ts`：六 kind 非法内容、状态完整度、元数据、零修改、CAS 优先 |
| AC3 公开 DTO 单源 | `work-requests.test.ts`、server `app.test.ts`、CLI `client-contract.test.ts`、Web `api-contract.test.ts` |
| AC4 运行时边界/失败语义 | 同上，含坏输出 500、畸形4xx/unknown/错误作品身份、续章的错章/错操作/错命令族、无自动重发；既有命令恢复回归 |
| AC5 Step 私有/服务端 ID | Step 继续从共享内容派生；`step-experiment.test.ts` 与 CLI `step-entry.test.ts` 模拟供应商子进程验证完整输出，Store兜底 |
| AC6 知识一致/未迁移 | schema、治理清单、本页和研究、README/handoff/运行skill；#15/#9/新配置等明确后置 |
| AC7 #9 可用接缝 | WorkStore 接口不改变业务语义，已有 Store tests＋validation tests，输入引用/多章集成回归 |

RED/GREEN 原始日志位于 `/tmp/a4n-19-evidence/`：`core-content-*`（内容）、`core-store-*`（写入）、`core-snapshot-*`（归属/重复head）、`core-experiment-*`（跨进程内容）、`core-address-config-*`（章地址/config漂移）；`api-create-*` / `api-output-*` / `api-cli-*` / `api-web-*`（公开边界及 unknown）。独立 review 补充 `review-web-red.log` / `review-cli-red.log` 记录各8个真实错配失败，`review-web-green.log` / `review-cli-green.log` 为修复后定向通过；完整日志 `full-test.log` / `full-typecheck.log` / `full-build.log`。这些本地文件辅助追溯，版本化测试才是后续可重跑入口。

旧测试曾以 `{made:...}` 或非法已通过内容作为 Store 夹具。现改为合法共享内容；需要模拟损坏读取的 HTTP 测试用 Store 端口返回异常快照，不能放松生产校验来迁就夹具。原关卡/并发/未知结果测试目标保留。

三轮自校准：① 代码与行为：修复测试旧非法夹具，检查 unknown优先和响应身份不匹配，当前完整门禁通过；② 代码与知识：补全实验worker出口、配置strict、Store只读head界限，保留旧审核字段字节不变；③ 候选与AC：七条有实现/验证入口，跨票研究和#33登记来自本次用户授权，不把后票计划算作已实现。

### 完成审核证据

- **清单与候选**：固定点 `e86230205167ff2ab8472edb7c5193b9e67948e2`；双轴通过的 T0 `4ca469b76065d62755a8421332965fb4b467c176`；清单 blob `c698cba0cd78798aab1adb5c4e3a504dbd1d029b`；T1 `fc33f3d0f7acfae7d5022c54459dce8df17de630`。精确47文件 manifest 为 `/tmp/a4n-19-evidence/finalbase-manifest.txt`，候选无 unstaged/untracked，当前本地1笔逻辑提交（5db5dcd），最终amend为同一逻辑边界。
- **逐项判定**：C1 PASS（C1.1–C1.8）：live票面/依赖/元数据、起始上下文、三案研究与执行计划、branch/status固定点已核查；PR到main，用户授权逐票loop交付，main无保护、rulesets为空、无required checks/reviews，终态保留ready-for-agent/12bitsD/无Project。C2 PASS（C2.1–C2.5）：本节AC入口、真实RED/GREEN和修复；C2.6 N/A（有行为变化，无替代验证）。C3 PASS（C3.1–C3.6）：634测试、typecheck/build、双diff-check、凭据0及47文件静态核查；无独立lint/format脚本，以typecheck/whitespace覆盖。复用共享schema/Store接缝，依赖分层清楚，边界先校验再写，有限数据遍历无新增联网。C4 PASS（C4.1–C4.9）：本节知识维护、结构/链接与三轮自校准；C4.3的CONTEXT维护N/A（无新领域词，schema已更新），C4.4的ADR维护N/A（沿既定架构，无新不可逆选型），C4.5 README/图示改动N/A（本票不改变作者使用流程；保留新main面向新读者的双语首页，逐段核对说明/链接；排期归issue/Project）。C5 PASS（C5.1–C5.7）：完整manifest/历史/patch审核和两轴独立复审。C6.1 PASS（原P2真实RED→GREEN），C6.2 PASS（完整回归与新tree双轴复审），C6.3 PASS（仅本节预留字段忠实收口）；C6.4 PASS（未参与实现的 `/root/contract_standards_review` 精确核对 T0→T1 仅预留证据字段、转录忠实、完整候选/历史通过；原始 `attestation-finalbase.md`）。
- **验收与 TDD**：AC1–AC7 全满足，映射与RED/GREEN见本节。独立 Spec 逐条确认；原始输出在 `/tmp/a4n-19-evidence/`，版本化测试为可重跑入口。
- **本地门禁**：2026-09-30 `COREPACK_ENABLE_AUTO_PIN=0 pnpm test`、`pnpm typecheck`、`pnpm build` 全部 exit0，634测试；最终固定点重跑日志 `finalbase-test.log` / `finalbase-typecheck.log` / `finalbase-build.log`，原有chunk提示。`git diff --cached --check` 和固定点→T0 diff-check通过。47文件及本地历史凭据扫描0；旧006/013审核块字节不变，Wiki结构/新增链接通过，secret文件保持忽略。CI 尚未配置，本地结果不作CI声明。
- **双轴 review**：新固定点 Standards `/root/contract_standards_review` 与 Spec `/root/contract_spec_review` 均未参与实现且相互隔离；T0复审均PASS、无剩余发现。原始报告 `standards-review.md`/`spec-review.md` 保留FAIL/P2，最终 `standards-finalbase.md`/`spec-finalbase.md` 保留PASS；均位于证据目录。两轴独立重跑CLI18/Web19边界测试通过。
- **修复与回归**：接受P2：同作品错章节/操作的合法响应曾误清冻结请求。共享匹配核对已知续章目标；两端HTTP200/409各8真实RED后GREEN，合法无命令幂等与普通错误仍接受；全仓634测试与typecheck/build通过，复审确认修复。
- **知识维护**：本页/索引/schema/治理清单、MVP三案研究、handoff、运行skill已更新；006/013添加后继而保留原审核证据。README保留main新稿并核验；CONTEXT/ADR/图示 N/A 如上。三轮自校准结论见本节。
- **发布前裁决**：2026-09-30，独立 reviewer `/root/contract_standards_review` 对上述 T1 给出 PASS，原始 `/tmp/a4n-19-evidence/attestation-finalbase.md`；C1–C5/C6.1–C6.4 证据齐全。终止比较与远端结果另行记录。剩余风险：既有大chunk提示、当前root build只构建Web、无仓库CI；生产构建/CI由#33独立交付。本票未做SQLite、配置UI或真实模型质量实验。

## 边界与非目标

不改变关卡、已通过正文编辑、版本/CAS/unknown 恢复；不引入 Hono RPC、SQLite、materials 生命周期或无关重构。损坏内容不能静默修复为合法数据。#9/#7/#8 与 Docker/CI 仍按各自票验收，不提前标完成。

## 上下文演进

### 2026-09-30 — 共享验证供持久化适配器复用

- **触发证据**：#19 已合并关闭，#9 开始把 Work 和全部产物版本写入 SQLite。
- **原假设**：本票以 InMemoryStore 证明共享写前／读回校验，不证明磁盘持久性。
- **决定**：SQLite 复用共享内容 schema 与 Store 验证，物理约束和恢复说明由 [Wiki 009](./009-sqlite-persistence.md) 接管。
- **影响**：避免在 SQL 适配器复制六 kind 内容规则，继续保留坏数据安全失败、版本条件及未知写入语义。
- **上下文处理**：preserve 原始 rationale、发现、TDD 和完成审核证据；replace 顶部交付状态与后继入口，#19 测试不作为 #9 完成证据。

### 2026-09-30 — 三方案自主收敛并接续多章基线

- **触发证据**：#6 已合并关闭；用户要求普通 grilling 自主三案评估，只升级关键节点。
- **原假设**：此前逐票把若干工程选择交给作者确认。
- **决定**：在既有范围内采用信任边界共享验证，保留关键产品裁决入口。
- **影响**：接续多章治理，并为 #9 留同接口校验和行为测试。
- **上下文处理**：preserve 既有 #13/#6 决定和审核证据；新研究说明方案取舍，不重写历史。

### 2026-09-30 — 校验已知续章目标的完整关联

- **触发证据**：独立 Standards 与 Spec 均复现请求第二章收到同作品第三章 HTTP409 时被当作确定拒绝。
- **原假设**：通用错误 schema 加作品 ID 足以验证普通端点返回。
- **决定**：共享 `matchesStartChapterResponse` 校验明确的操作、kind、章号；成功/错误观察均使用；没有命令的幂等回读和普通错误继续合法。
- **影响**：错配仍标 invalid-response/unknown，不清空冻结请求、不自动重放。advance 没有提交目标章号，不凭空猜测。
- **上下文处理**：preserve 原始双轴失败证据；replace 现行公开响应关联说明，补 RED/GREEN 与回归。

### 2026-09-30 — 接入并行 README 更新并重新冻结

- **触发证据**：C7.2回读main发现 `d2cef4215932deebae67e9862de2ba3367481fb5`，重写双语首页并修改清单C4.5；随后 `e86230205167ff2ab8472edb7c5193b9e67948e2` 补充Node最低版本，两笔均保留。
- **原假设**：初始main固定点不变，README承载逐票路线图。
- **决定**：rebase到新main，README冲突采用其面向初次读者的完整新版；排期已在issue/Project，新首页保留入口。
- **影响**：无运行代码差异；更新交付固定点，重跑门禁与独立双轴/证据核验，旧attestation不用于发布。
- **上下文处理**：preserve并行README意图和原始失败/修复证据；replace本票尚未发布的最终候选字段，保留变化原因。

## 交接结论

#19 已合并关闭，原始独立 review 与发布前裁决见证据字段，远端终态以本票 issue/PR 为准。[Wiki 009](./009-sqlite-persistence.md) 继承共享内容验证和 Store 业务语义，并独立记录 SQL 事务及真实重启证据；本页内存门禁不替代 SQLite 验收。后续任务按各自 issue/Project 与交接快照逐票验收。
