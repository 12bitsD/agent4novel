---
wiki_id: "069"
ticket: 69
ticket_state: active
context_state: current
summary: "失败状态可恢复、作品快照复用与配置单快照文件复用，降低流水线重复工作"
topics: ["pipeline", "reliability", "performance", "author-config", "snapshot"]
code_paths: ["apps/server/src/pipeline/pipeline.ts", "apps/server/src/config/author-config-service.ts", "apps/server/src/runtime/production-app.ts", "apps/server/src/steps/beat-step.ts", "apps/server/src/steps/prose-step.ts"]
symbols: ["Pipeline", "getStateFromWork", "failureOf", "clearFailure", "AuthorConfigService"]
inherits: ["016", "007", "005", "022", "002"]
changed_by: []
read_when: ["fix-stale-pipeline-failure", "reduce-work-snapshot-reads", "dedupe-author-file-reads"]
last_context_reviewed: "2026-11-13"
---

# 069 — 流水线恢复、快照与配置重复工作

## Agent Context

- **读取时机**：修改失败读模型、advance 快照、作者配置保存/解析或 Beat/Prose 输入预算时。
- **原始目的**：#67 要求修复旧失败阻断生成，并消除完整作品快照、文件读取和大对象序列化的确定性重复工作。
- **实际落地**：计划让失败随步骤与配置保存失效，增加有界缓存；状态投影复用 WorkDetail；单次配置 resolve 复用唯一文件；预算统计复用已序列化文本。
- **当前价值**：原错误响应 retryable 不变，模型期间 Store CAS 与 operation 配置冻结不变，不做跨请求文件缓存。
- **后续变化**：#73 将在此接缝上传播取消 signal。
- **代码入口**：`Pipeline.getStateFromWork()`、`failureOf()`、`AuthorConfigService.resolve()`。

## 设计目的

恢复用户修正配置或推进人工关卡后的可用状态，同时降低长作品上的同步 SQLite/JSON/Zod 和文件 I/O 放大。

## 起始上下文

旧 `lastFailure` 只按 workId 保存，配置保存和专用审批后仍可能影响新步骤，且没有容量上限。一次 advance 会多次读取同一作品；详情 GET 连续读取两次。配置 defaults 被六个节点继承时，同一文件重复同步读取/hash/YAML 解析。Wiki 016/007 要求模型超时和配置文件快照语义不变。

## 技术方案

以当前 nextStepId 过滤旧失败，成功配置保存通过统一回调清理；失败 Map 有界淘汰。抽出接收 WorkDetail 的纯状态投影，advance 每轮读取一次并复用 entry/config/input，执行后仍重读。单次 resolve 内 memoize 唯一文件，下一次 resolve 重新检测篡改。Beat/Prose 在组装 section 时同步保留文本长度。

## 代码落点

- `apps/server/src/pipeline/pipeline.ts`：状态投影、失败恢复与快照复用。
- `apps/server/src/routes/works.ts`：详情 GET 复用已读作品。
- `apps/server/src/config/author-config-service.ts`、`runtime/production-app.ts`：保存失效回调与单快照文件复用。
- `apps/server/src/steps/{beat,prose}-step.ts`：预算长度复用。

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `c060be489c21d6646fff1b59615a8eb71d8951b2`，M1 为先行提交；实现提交 `a9dec06`；T0/T1 待最终统一收口。
- **逐项判定**：C1/C2 PASS；C3/C4 定向证据已取得；C5 三轴审查发现已修复并复审关闭；C6 待最终统一 attestation。
- **验收与 TDD**：issue #69；失败不失效、缓存无上限、advance 9 次读取、详情 2 次、配置文件 6 次均先 RED；实现后 advance 4 次、详情 1 次、唯一文件每次 resolve 1 次，旧失败随步骤/配置失效且缓存有界，篡改下次仍拒绝，Beat 超预算只序列化三个 section。
- **本地门禁**：相关 12 个测试文件 165 项及 server typecheck 通过；修复后 74 项定向复验通过；最终全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、production/container smoke 与 `git diff --check <fixed-point>` 均通过。
- **双轴 review**：已关闭 Beat 二次序列化与清理分散，Spec/Risk 复审无剩余代码发现。
- **修复与回归**：`clearFailure` 统一入口；状态投影与配置/文件复用仅限明确快照；CAS、配置 revision 冻结和 unknown-write 语义不变。
- **知识维护**：本页与 Wiki index 新建；schema/CONTEXT/ADR/research/README/运行 skill N/A；handoff 待统一更新。
- **发布前裁决**：pending；默认仅本地分支。

## 边界与非目标

不改变公开 PipelineState/WorkView、原 retryable、人工审批、写前 CAS、unknown-write/readback、配置 revision 冻结、模型超时或输入预算；不引入跨请求缓存或异步 Store。

## 上下文演进

### 2026-11-13 — 建立流水线恢复与性能治理票据

- **触发证据**：旧失败跨步骤/配置残留、Map 无界、作品与文件重复读取均由当前代码确认。
- **原假设**：简单按 workId 记录最近失败足够，但状态机与配置已经前进后该记录不再代表当前步骤。
- **决定**：失败绑定当前步骤并有界保存；状态投影与配置/文件复用仅在明确快照范围内发生。
- **影响**：流水线读模型、advance 和配置解析；不改变写入授权。
- **上下文处理**：preserve Wiki 016/007/005/022 的运行与恢复约束，本页记录新增治理。

## 交接结论

实施后应以读取次数和行为测试证明恢复与复用边界；独立 review 和最终门禁未完成前不视为交付。
