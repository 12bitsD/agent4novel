---
wiki_id: "075"
ticket: 75
ticket_state: active
context_state: current
summary: "后端与 CLI 分支和链式简写治理，保持 feature、协议与性能操作计数不变"
topics: ["readability", "refactoring", "performance", "reliability"]
code_paths: ["apps/server/src/**", "apps/cli/src/**", "apps/server/src/command-observation.ts", "apps/server/src/pipeline/consume-guards.ts"]
symbols: ["missingOutputState", "observeCommand", "approvedUpstream", "handleCommand", "readbackCommand", "createWorkerContext", "parseRange"]
inherits: ["068", "069", "070", "071", "072"]
changed_by: []
read_when: ["simplify-backend-logic", "reduce-nested-branches", "review-readability-refactor"]
last_context_reviewed: "2026-11-17"
---

# 075 — 后端逻辑简化

## Agent Context

- **读取时机**：评审后端分支、链式转换、普通循环与纯函数拆分时。
- **原始目的**：本票 issue 为 [#75](https://github.com/12bitsD/agent4novel/issues/75)，承接 #67，要求在不改变 feature 和性能的前提下简化逻辑、减少嵌套 if-else 和难读简写。
- **实际落地**：bits-style 0.3.2 全量治理后端与 CLI；普通循环和阶段 helper 替代嵌套分支与难读简写；共享上游 gate、命令观测、HTTP 解析和 CLI readback 控制流；worker 与静态资源生命周期保持原边界。
- **当前价值**：公开协议、状态机、数据形状、错误码与优先级、CAS、unknown-write/readback、资源回收和性能操作计数不变；扫描结果为 0 violations / 0 warnings。
- **后续变化**：本轮独立审查发现并已修复章节操作和三种 review 的错误优先级回归，详见上下文演进。
- **代码入口**：`observeCommand()`、`approvedUpstream()`、`handleCommand()`、`readbackCommand()`、`createWorkerContext()`、`parseRange()`。

## 设计目的

用表驱动、普通循环、纯函数和提前返回替代嵌套分支、三元/可选链/空值合并/短路赋值及链式转换，让主流程直接表达执行、判定与清理，而不是为了风格统一引入新的抽象层。

## 起始上下文

#68–#72 已建立功能与性能验收。此次基线补充：书架 200 次读取约 262ms、静态资源 200 次约 56ms、100 次双 Step advance 约 36ms；这些墙钟值只用于同机对照，不作为跨环境承诺。

## 技术方案

- SQLite 预计算 expected schema，书架用普通循环和 `workSummary()`；Setting 合并/校验与 Pipeline 阶段判定复用纯函数。
- `approvedUpstream()` 统一上游 approved 与 consume guard 校验，各 review 保留自己的错误码、消息和 precondition 形状。
- `observeCommand()` 与 `responseErrorObservation()` 统一成功/失败观测算法，Beat/Prose 适配层只提供 schema、kind 和错误类型。
- `handleCommand()` 统一 HTTP 请求解析；CLI 用 `readbackCommand()`、`commandResultError()` 共享恢复机制，不用自动重试追认未知写入。
- runner、静态文件和 CLI worker 按阶段拆分资源上下文，保持 stdout 上限、信号、超时和 close 顺序。
- 不引入 baseline 或文件级豁免；必要的 async/await、类型和标准库 API 不当作需要机械清除的语法糖。
- 后端 61 个源文件的 2,187 个调用表达式均有函数名与极简职责注释，AST 复查遗漏为 0；注释不改变运行逻辑。

## 代码落点

- `apps/server/src/store/**`、`setting-extension.ts`、`pipeline/**`
- `apps/server/src/config/**`、`steps/**`、`runtime/**`
- `apps/server/src/{beat,prose,setting}-review.ts`、`pipeline/consume-guards.ts`
- `apps/server/src/{beat,prose}-command.ts`、`command-observation.ts`、`routes/**`
- `apps/cli/src/{client,command-line,commands,local-step,main,request-file,step-record}.ts`

## 测试与验证

### 完成审核证据

- **清单与候选**：本轮固定点 `dcf83cf981e8d73f045d94b0b22cad6e19af8296`，分支 `style/bits-backend`；全部改动保持未提交，没有本轮 commit、T0/T1/T2 或远端发布记录。此前其他候选的提交与 tree 不作为本轮证据。
- **逐项判定**：C1–C5 PASS：范围、回归防护、定向/全量门禁、知识回写和 Standards/Spec 独立审查完成；C6.1/C6.2 PASS，C6.3 已记录本页实际证据。C6.4–C6.7 与 C7 为 `N/A（用户未要求本轮提交、冻结发布候选或远端交付；不宣称 ticket 完成）`。
- **验收与 TDD**：行为保持重构沿用现有测试；章节缺失 input 和 Setting 错误优先级测试先得到 RED，再恢复 GREEN；另增 Beat/Prose 无效 baseline 与上游未批准的组合回归。最终 Server 47 文件/519 项、CLI 23 文件/248 项、Web 34 文件/218 项、Contracts 23 文件/141 项全部通过。
- **本地门禁**：2026-11-17 对最终候选执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`node scripts/production-smoke.mjs`、`node scripts/container-smoke.mjs`、bits 0.3.2 `style check apps/server/src apps/cli/src --all` 和 `git diff --check dcf83cf`，全部通过。bits 扫描 68 文件：0 violations、0 warnings、0 scan errors。Web build 仅保留既有 >500 kB chunk 警告。
- **双轴 review**：Standards/Spec 独立 reviewer 最终均无剩余发现。审查关闭章节 `allowedActions`、Setting/Beat/Prose 错误优先级、重复 observer/HTTP/readback 控制流、命名和文档漂移；没有以扫描清零替代语义审查。
- **修复与回归**：章节只复用一次 beat input，缺失 input 时保持整章重生；三种 review 恢复 upstream preconditions 先于 baseline/content 转换；observer 与响应失败构造单源化，公开 observation 和错误类型不变。
- **知识维护**：本页与 handoff 已更新；schema/CONTEXT/ADR/research/README/运行 skill 为 `N/A（无数据模型、领域词、架构决定、用户操作或运行流程变化）`；Wiki index 已有本页入口，无需新增。
- **发布前裁决**：本轮是已验证、已复审的本地未提交候选，不进入 C6 发布前 attestation。剩余风险为不同机器墙钟波动及后续 #15 合并冲突；性能操作计数由既有断言保护。未 push、未 merge、未关闭 issue。

## 边界与非目标

不改公开协议、状态机、数据形状、错误语义或性能操作计数；不放宽测试断言、不触碰未提交 #15 RPC 工作或生成物。测试仅随内部函数签名迁移调用形状，并为已发现回归补充组合条件；不把正常类型或 async/await 当成“语法糖”机械清除。

## 上下文演进

### 2026-11-17 — 建立逻辑简化票据

- **触发证据**：主状态机、配置解析和 runner/静态分支中有多层三元、链式转换和重复清理逻辑。
- **原假设**：减少 if-else 必须全面改写语法，但这会把简单条件变成更多分支并增加回归风险。
- **决定**：仅做行为保持的结构简化，优先纯函数、普通循环和表驱动，沿用性能与功能门禁。
- **影响**：后端生产代码可读性；公开行为不变。
- **上下文处理**：preserve #68–#72 的验收边界，本页只记录重构与复核证据。

### 2026-11-17 — bits 0.3.2 全量治理与行为复审

- **触发证据**：bits 0.3.2 对 68 个后端/CLI 源文件报告 violations 与 warnings；独立审查另发现扫描无法识别的章节操作、review 错误优先级和重复控制流问题。
- **原假设**：按规则拆分函数并清零扫描即可证明行为保持；实际对象参数求值顺序和缺失 input 的条件仍会改变公开语义。
- **决定**：按阶段和不变量提取 helper，保留领域 schema、错误类型与性能计数；为组合条件补回归，并共享 observer、上游校验、HTTP 与 readback 算法。
- **影响**：本轮候选达到 0 violations / 0 warnings，全量门禁和两项 smoke 通过；公开协议、状态机、数据形状与 feature 不变。
- **上下文处理**：`replace` 本轮固定点、候选状态和验证证据；`preserve` 旧性能基线、原始目的与此前候选的历史，不把旧提交当成本轮交付。

### 2026-11-17 — 后端调用点上下文注释

- **触发证据**：用户要求所有后端函数在调用时都有极简职责说明，而不只给共享 helper 的定义处加注释。
- **原假设**：给少量抽象 helper 注释即可降低跳转成本；实际调用点仍需要读者自行理解上下文。
- **决定**：为 `apps/server/src` 全部 61 个源文件的 2,187 个调用表达式补充函数名与职责注释，包括动态调用和 `super()`；保留原有设计说明与组合根豁免。
- **影响**：只增加注释，不改变运行逻辑、协议、性能操作计数或测试断言；AST 复查 missing 为 0。
- **上下文处理**：`preserve` 原有设计 rationale 和回归证据，`replace` 当前候选的注释覆盖事实。

## 交接结论

当前 `style/bits-backend` 是完整验证且独立复审无剩余发现的未提交候选。性能墙钟只在同机对照时有意义；后续交付仍需按清单冻结精确候选、提交并另行获得 push/merge 授权，不能把本轮结果当成 issue 已关闭。
