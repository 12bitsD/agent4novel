---
wiki_id: "070"
ticket: 70
ticket_state: active
context_state: current
summary: "Setting extension candidate/base 精确对账与合法终态重放零写入"
topics: ["setting-extension", "reliability", "append-only", "idempotency", "corruption"]
code_paths: ["apps/server/src/setting-extension.ts", "apps/server/src/store/sqlite-store.ts", "apps/server/src/store/in-memory-store.ts", "apps/server/test/setting-extension.test.ts"]
symbols: ["isValidApprovedExtensionCandidate", "actOnExtension", "approveSettingExtension"]
inherits: ["017", "068", "019"]
changed_by: []
read_when: ["harden-setting-extension-replay", "validate-extension-candidate", "debug-extension-corruption"]
last_context_reviewed: "2026-11-13"
---

# 070 — Setting extension 完整性与重放

## Agent Context

- **读取时机**：修改 Setting extension 状态机、candidate readback、终态重放或两个 Store 的扩展写入时。
- **原始目的**：本票 issue 为 [#70](https://github.com/12bitsD/agent4novel/issues/70)，关闭 Wiki 017 留下的两个 P2：approved replay 绕过 candidate 对账，以及 validator 只检查“包含”而非精确 append-only。
- **实际落地**：GET/propose replay/approve replay 共用 candidate+base 精确校验，合法无变化 replay 不再 INSERT/UPDATE/REPLACE。
- **当前价值**：合法重放回执不变，损坏持久数据安全失败且零写入；不改公开 API、状态机或历史章节。
- **后续变化**：无。
- **代码入口**：`isValidApprovedExtensionCandidate()`、两个 Store 的 `actSettingExtension()`。

## 设计目的

证明 approved candidate 恰好等于 expectedBase 内容加末尾 proposal extension，且 inputs 恰好是唯一旧 Setting 基准；避免把损坏记录当成合法成功回执，同时减少无意义写锁和磁盘提交。

## 起始上下文

Wiki 017 的正常 HTTP 路径已具备原子 CAS 与历史 readback，但人工/恶意篡改 approved record/candidate 后，终态 approve replay 仍可能返回 committed；旧 validator 允许额外扩展、旧内容变化和额外 inputs。M1 已将底层 schema 迁至 v5 并保留原始多版本行。

## 技术方案

按 record.candidate 与 expectedBase 的精确 id/version 分别读取历史和基准 Artifact。校验 base 归属/kind/status，使用基准内容与 record.extension 重建唯一合法 candidate，深比较完整 content 和 inputs。approve terminal replay 也执行该校验；cancel 不增加 candidate 读取。合法 replay 跳过 record UPDATE。

## 代码落点

- `apps/server/src/setting-extension.ts`：共享 candidate/base 对账与 replay 标记。
- `apps/server/src/store/{sqlite,in-memory}-store.ts`：GET/replay 校验和跳过无变化写入。
- `apps/server/test/setting-extension.test.ts`：损坏矩阵、两个 Store parity 与 UPDATE 次数。

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `c060be489c21d6646fff1b59615a8eb71d8951b2`，依赖 #68/#69 已落地；实现提交 `a22f7c7`；T0/T1 待最终统一收口。
- **逐项判定**：C1/C2 PASS；C3/C4 定向证据已取得；C5 三轴审查发现已修复并复审关闭；C6 待最终统一 attestation。
- **验收与 TDD**：issue #70；旧 validator 接受额外扩展/inputs 和篡改 replay 先 RED；实现后 candidate=base+末尾 extension 且 inputs 唯一，GET/approve replay 均校验，合法 replay 无任何 proposal INSERT/UPDATE/REPLACE，损坏时 head 不增长。
- **本地门禁**：相关 4 个测试文件 128 项及 server typecheck 通过；最终全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、production/container smoke 与 `git diff --check <fixed-point>` 均通过。
- **双轴 review**：已关闭 SQLite 重复校验和普通 UPDATE 测试盲区；Spec/Risk 复审无生产缺陷。
- **修复与回归**：SQLite validateExtensionCandidate 共用，合法/损坏 replay 零写入断言完整。
- **知识维护**：本页与 Wiki index 新建；Wiki 017 changed_by、当前技术视图和变化事件已更新；schema/CONTEXT/ADR/research/README/运行 skill N/A；handoff 待统一更新。
- **发布前裁决**：pending；默认仅本地分支。

## 边界与非目标

不改变 proposal API、状态机、append-only 语义或合法回执；不自动修复损坏数据、不重写历史章节、不新增通用写入去重框架。

## 上下文演进

### 2026-11-13 — 关闭 Wiki 017 的持久数据硬化缺口

- **触发证据**：Wiki 017 与当前代码均确认 approved replay 未复用 validator，validator 只检查包含关系。
- **原假设**：正常 HTTP 原子写入足够，但终态重放也是合法入口，损坏存储不能被包装成成功。
- **决定**：GET 与 approve replay 共用精确 candidate/base 对账，合法 replay 零写入。
- **影响**：仅损坏数据处理和重放写放大；公开协议不变。
- **上下文处理**：preserve Wiki 017 的正常路径与原始风险记录，本页记录缺口关闭。

## 交接结论

候选应证明损坏 replay 安全失败、合法 replay 回执不变且无 UPDATE；未完成独立 review 和全量门禁前不视为交付。
