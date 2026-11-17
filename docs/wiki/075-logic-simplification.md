---
wiki_id: "075"
ticket: 75
ticket_state: active
context_state: current
summary: "后端生产代码分支与链式简写治理，保持 feature 与性能验收不变"
topics: ["readability", "refactoring", "performance", "reliability"]
code_paths: ["apps/server/src/store/**", "apps/server/src/setting-extension.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/config/author-config-service.ts", "apps/server/src/steps/*-step.ts", "apps/cli/src/local-step.ts", "apps/server/src/runtime/static-web.ts"]
symbols: ["missingOutputState", "failureCodeFor", "mergedSetting", "closeError", "parseRange"]
inherits: ["068", "069", "070", "071", "072"]
changed_by: []
read_when: ["simplify-backend-logic", "reduce-nested-branches", "review-readability-refactor"]
last_context_reviewed: "2026-11-17"
---

# 075 — 后端逻辑简化

## Agent Context

- **读取时机**：评审后端分支、链式转换、普通循环与纯函数拆分时。
- **原始目的**：本票 issue 为 [#75](https://github.com/12bitsD/agent4novel/issues/75)，承接 #67，要求在不改变 feature 和性能的前提下简化逻辑、减少嵌套 if-else 和难读简写。
- **实际落地**：版本 schema 预计算、Setting 合并/校验共用、流水线阻塞与错误分类提取、配置/Step 普通循环、runner 非零退出与静态 range 独立函数。
- **当前价值**：公开协议、状态机、数据形状、错误码、CAS、unknown-write/readback、资源回收和性能操作计数不变。
- **后续变化**：无。
- **代码入口**：`missingOutputState()`、`failureCodeFor()`、`mergedSetting()`、`closeError()`、`parseRange()`。

## 设计目的

用表驱动、普通循环、纯函数和提前返回替代嵌套分支、三元/可选链/空值合并/短路赋值及链式转换，让主流程直接表达执行、判定与清理，而不是为了风格统一引入新的抽象层。

## 起始上下文

#68–#72 已建立功能与性能验收。此次基线补充：书架 200 次读取约 262ms、静态资源 200 次约 56ms、100 次双 Step advance 约 36ms；这些墙钟值只用于同机对照，不作为跨环境承诺。

## 技术方案

- SQLite 预计算 expected schema，书架用普通循环和 `workSummary()`。
- Setting 用 `mergedSetting()` 统一 append-only 结果，approved 校验共用。
- Pipeline 提取缺失产物阻塞判定与失败分类，配置/Step 用普通数组和循环。
- runner 用 `closeError()` 统一非零退出分类，静态用 `parseRange()` 独立处理范围。
- 不机械替换所有 JavaScript 表达式；保留必要的 async/await、类型和标准库 API，避免为“少 if-else”引入更多嵌套分支。

## 代码落点

- `apps/server/src/store/sqlite-schema.ts`、`sqlite-store.ts`
- `apps/server/src/setting-extension.ts`
- `apps/server/src/pipeline/pipeline.ts`
- `apps/server/src/config/author-config-service.ts`
- `apps/server/src/steps/{beat,prose}-step.ts`
- `apps/cli/src/local-step.ts`
- `apps/server/src/runtime/static-web.ts`

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `e6889027aead377956e84f8f23a8c96b6d68e34f`；实现提交 `c436725`、`1d99cc0`；候选 tree `32a5e924f0e71e9ccbf7dca4983ac401de09902a`。
- **逐项判定**：C1–C5 PASS：范围、TDD 防护、定向/全量门禁、知识与 Standards/Spec/Risk 审查均完成；C6.1/C6.2 PASS，C6.3 已转录，C6.4 由独立 reviewer 核验候选，C6.5 已记录，C6.6 PASS，C6.7 已完成逻辑提交。
- **验收与 TDD**：本票为行为保持重构，沿用现有 RED/GREEN 作为防护；存储 46 项、流水线/配置/Step 103 项、runner/静态 40 项定向回归通过，并新增失败可选键形状回归。
- **本地门禁**：`pnpm test`、`pnpm typecheck`、`pnpm build`、production/container smoke 与 `git diff --check <fixed-point>` 全部通过。
- **双轴 review**：Standards/Spec/Risk 已关闭可选键形状、配置回退、复杂度转移和偏好类型问题，增量复审无剩余发现。
- **修复与回归**：恢复 `attemptId`、`beatCommand`、`proseCommand` 的键存在性（含 undefined/空字符串）；`savedVersion()`、`chars()` 等收敛不引入新抽象层。
- **知识维护**：本页与 Wiki index 新建；schema/CONTEXT/ADR/README/运行 skill N/A；handoff 已更新。
- **发布前裁决**：C6.4/C6.6 独立 reviewer PASS，剩余风险仅为墙钟本机波动和 #15 后续合并冲突；C7 仅本地分支，不 push/远端 merge/关闭 issue。

## 边界与非目标

不改公开协议、状态机、数据形状、错误语义或性能操作计数；不改测试表达、未提交 #15 RPC 工作或生成物；不追求把正常条件表达式、类型或 async/await 当成“语法糖”机械清除。

## 上下文演进

### 2026-11-17 — 建立逻辑简化票据

- **触发证据**：主状态机、配置解析和 runner/静态分支中有多层三元、链式转换和重复清理逻辑。
- **原假设**：减少 if-else 必须全面改写语法，但这会把简单条件变成更多分支并增加回归风险。
- **决定**：仅做行为保持的结构简化，优先纯函数、普通循环和表驱动，沿用性能与功能门禁。
- **影响**：后端生产代码可读性；公开行为不变。
- **上下文处理**：preserve #68–#72 的验收边界，本页只记录重构与复核证据。

## 交接结论

候选应证明主流程更易读且没有转移复杂度；独立审查、性能对照和全量门禁未完成前不视为交付。
