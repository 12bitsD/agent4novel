---
wiki_id: "012"
ticket: 12
ticket_state: active
context_state: current
summary: "创意稿整步再生、失败重试与补充想法；固定目标和输入版本"
topics: ["creative", "regeneration", "version-preconditions", "unknown-write"]
code_paths: ["apps/server/src/pipeline/pipeline.ts", "apps/server/src/steps/creative-step.ts", "apps/web/src/pages/CreativePoster.tsx", "apps/cli/src/commands.ts"]
symbols: ["regenerateCreative", "creativeRegenerateRequestSchema"]
inherits: ["011", "019", "051"]
changed_by: []
read_when: ["regenerate-creative", "retry-creative", "creative-instructions"]
last_context_reviewed: "2026-10-10"
---

# 012 — 创意稿整步再生与失败重试

## Agent Context

- **读取时机**：修改创意稿失败重试、补充想法、再生和未知结果恢复时。
- **原始目的**：[#12](https://github.com/12bitsD/agent4novel/issues/12) 中失败后缺入口、方向不满意缺补充想法；二期仅交付此核心子范围。
- **实际落地**：尚未实施；下方冻结验收后派工。
- **当前价值**：沿用 011 的整步方向包和显式选定；不放开已选方向重生。
- **后续变化**：渐进展示、分段提炼、历史回看仍后置，原始需求在 issue 保留。
- **代码入口**：Pipeline/creative Step、CreativePoster（Workspace 内的比较关卡）、CLI 文件请求。

## 设计目的

作者失败时能重新运行，成功但不满意时补充想法。可靠性以完整方向包、固定可见基线、不吞未知写入为目标；不把文学质量替换成测试数量。

## 起始上下文

main 固定点 `261b05e3347f7e12a328f8cea560ff0e05a395b2`；当前 PR source `codex/creative-retry-loop`，工作树无用户改动。现有 advance 在 pending 创意关卡只返回 awaiting-approval，因此不能复用为再生动作。创意比较页即 Workspace 子视图，不存在两个独立入口。

C1 对齐：用户授权 Loop 自主定义可靠验收并派工，已确认二期路线取 #12 核心。本次保留原复合票意图并回写实施 AC；不可逆的已选回退不在范围。Issue Native blocked_by=0，无 main protection/required review；交付工作分支→PR→main，CI quality/container 均须通过。终态标签 ready-for-agent、assignee 12bitsD；现有 Project=agent4novel Development，Status 预期 Done。

## 技术方案

### 语义与取舍

复用 Pipeline per-work 锁和 Store CAS，不引入新表或回流状态机。单独 `POST /api/works/:id/artifacts/creative/regenerate`，严格 `{expectedArtifactId: string|null, expectedHeadVersion: positive-int|null, instructions:string<=4000}`；id/version 必须同为空或同有值。没有创意稿时要求已有 approved caption；已有 head 只允许 pending 且仍为创意关卡。源素材不变，不再跑 caption；Step 输入的 regeneration 带当前已保存方向包（首次 null）和本次补充想法。模型完整输出校验后一次 append pending，旧版本不删除。提交 CAS 同时核对创意目标和实际 caption。

Web：未保存方向编辑先保存；本次补充想法单独保留。生成中锁定交互，成功替换本页基线但不选定/不推进。未知写入冻结请求，显式读取，只展示服务器状态；不以新版存在追认原请求，不自动 POST。Harness 复用 HTTP/CLI 和 run-step 的实际记录能力。

### 固定验收 v2（主 Agent 维护，实施 Agent 不得改）

接缝：公开 HTTP/CLI、真实 creative Step 的 SDK transport、Web DOM 交互；存储通过 WorkStore 公开版本接口验证。受保护材料为 `apps/server/test/creative-regeneration.eval.test.ts`、`apps/server/test/creative-regeneration-real-step.eval.test.ts`、`packages/contracts/test/creative-regeneration.eval.test.ts` 和 `apps/web/src/pages/CreativePoster.regeneration.eval.test.tsx`、`apps/cli/test/creative-cli.test.ts`。

| Eval | 固定材料与入口 | 独立预期 / 判失败条件 |
|---|---|---|
| E1 / AC1,3 | server HTTP；approved caption、无 creative、null/null 基线 | 只调用 creative；step 收到精确 seed/caption/null 旧包/意见；恰好追加完整 pending head；caption、seed 不变，无下游；0/半包/approved 失败 |
| E2 / AC2,3 | `creative-regeneration-real-step` 的 HTTP route + `createCreativeStep`；唯一 canary 的 seed、caption、旧方向包、意见 | 同一公开 HTTP 路径调用真实生产 Step；SDK 恰好一次，prompt 精确包含四类 canary；成功产生新 ID/version、完整 pending；旧当前快照不被覆盖、仍可显式选定 |
| E3 / AC3 | HTTP 的 timeout、非法结构输出、竞争提交 | 安全分类错误；旧 head 内容/ID/version/status 不变；无半包/下游；模型成功但 CAS 失败也不算成功 |
| E4 / AC4 | HTTP 的半个 ID/version、缺 caption、stale、approved、caption/creative race、重入锁 | 每个前置拒绝均在模型前且模型调用为 0；等待期间两类竞争均只保留竞争 head；重入第二次不调用模型 |
| E5 / AC5 | `CreativePoster.regeneration.eval` DOM | 脏编辑先 PUT 保存，随后 POST 绑定保存后的 ID/version；成功替换为新 pending 且不自动选定；生成中补充想法、方向编辑、选择和再生均锁定；失败/unknown 保留旧材料和原话，不自动 POST/GET 追认 |
| E6 / AC6 | contracts、`apps/cli/test/creative-cli` 可执行 CLI、`run-step --record-dir` | creative regeneration 输入可被同一生产 Step 接受且意见超限前置拒绝；CLI 单次 POST、畸形/目标不匹配非零，unknown 不回读认领/重发；creative run-step 实际生成四文件并捕获 system/user/model/config |

反作弊：生产 Step canary 不接受 fake substring；失败断言同时核对当前 head；竞争用实际等待模型的 Promise；unknown 要有无回执或畸形 2xx 的记录并证明没有自动确认/重发。未跑的校准保持 pending。

前置方法审查：Hume 只读 reviewer 首轮判 `FAIL`，指出原 v1 只有 E1 且 E2–E6 不可执行，尤其遗漏生产 prompt、竞争、unknown 和 creative 的 run-step 契约；上述 v2 已逐项补齐，后续需重新只读复核。受保护材料当前 SHA-256：server HTTP `dc3aacd34f46f6a26bf1e0af51d8313612de7f922e229561f782d908121eeb97`；HTTP+真实 Step `07a326aad444e802afc8093a300087ba7fd8c28fdd69cb8ff21b95cf7d85d6ac`；contracts `3b53a3263516a184c9ab177cb7c703bb361d9905eb54cc0f91f3eeec25c774d7`；Web `f5a59fe6bad772c40afb1a6fcb40fe2a55a6ff360161b1eaf0515b0d07cb6e11`；CLI `bec8c84f071271ce488f888c4a32e758737c9c6f6d4c6a299e697a7569b92ce6`。

### TDD 切片与轮次

R0：Hume 方法审查 FAIL；补齐 v2 受保护 eval 后，目标端点公开 HTTP 404 RED、creative run-step contract RED；实施 Agent 不得改验收材料。R1：实施 Agent 垂直切片实现契约→HTTP/Step→CLI→Web，每片 RED/GREEN/typecheck；主 Agent 独立跑固定 eval、全量测试/typecheck/build。R2/R3 只修已证实差距，最多三轮。正式 Standards/Spec review、C6 attestation、C7 发布另按完成清单，不降低标准或新增平台。

## 代码落点

计划：contracts/work-requests、Pipeline、creative IO/Step、works route、CLI、CreativePoster/Workspace、Web API。精确文件由候选回读。

## 测试与验证

待取得。

### 完成审核证据

- **清单与候选**：fixed point 如上；清单 blob/T0/T1/manifest pending。
- **逐项判定**：C1 初始对齐如上，余项 pending。
- **验收与 TDD**：E1–E6 v2；R0 RED 已冻结，验收方法审查待复核。
- **本地门禁**：pending。
- **双轴 review**：pending。
- **修复与回归**：pending。
- **知识维护**：pending。
- **发布前裁决**：pending。

## 边界与非目标

不做 selected 回退、历史回看、SSE、中间态、超长分段、队列/数据库表、自动 judge、文学效果承诺。Model transport mock 验证数据流，不证明真实供应商质量；无真实调用预算。

## 上下文演进

### 2026-10-10 — 二期收窄复合票

- **触发证据**：已确认路线明确 #12 核心，现有 pending advance 不再运行；创意比较即创作界面子视图。
- **原假设**：#12 是包括 SSE、长素材与版本 UI 的待 grill 复合票。
- **决定**：本次回写 core AC，原意图保留并明确后置，复用现有 deep seams。
- **影响**：本票只增加安全再生能力；不承诺其他子范围已完成。
- **上下文处理**：preserve 原始 issue；后续落地时 replace 当前 pending 摘要。

## 交接结论

本票未完成。后续从冻结方法与 RED 继续，不从候选输出反推验收。
