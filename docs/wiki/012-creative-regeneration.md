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

### 固定验收 v1（主 Agent 维护）

接缝：公开 HTTP/CLI、真实 creative Step 的 SDK transport、Web DOM 交互；存储通过 WorkStore 公开版本接口验证，不以私有 SQL证明。主 Agent 验收材料 `apps/server/test/creative-regeneration.eval.test.ts` 不授权实施 Agent 改预期。

| Eval | 固定材料与入口 | 独立预期 / 判失败条件 |
|---|---|---|
| E1 / AC1,3 | 已通过 caption + 无 creative；POST null 基线 | creative 恰好 v1 pending，caption id/version/内容不变，seed 不变；0/半包/approved/跑 caption 均 FAIL |
| E2 / AC2,3 | pending v1、补充“不要穿越”、当前方向包；POST 同 id/version | v2 新 id 完整 pending；实际 SDK prompt 含素材/caption/旧方向/原样意见，成功不自动选定 |
| E3 / AC3 | LLM timeout/数量非法/畸形内容 | HTTP 分类安全，创意 head 和旧版本逐字符不变；模型成功但保存失败不算成功 |
| E4 / AC4 | 错误 id/version、已 approved、无 caption、锁重入 | 模型前拒绝；LLM 等待时 caption 或 creative 改动，提交拒绝且竞争版本保留 |
| E5 / AC5 | Web pending/dirty/loading/拒绝/unknown | dirty 必须先保存；生成中禁止编辑/选定/离开；失败保留输入/旧稿，unknown 不重发/不回填 |
| E6 / AC6 | CLI 严格文件、单次 POST、畸形成功响应、run-step | 冻结基线、响应目标/version 校验、非成功非零退出；help 无 IO；观测沿用已交付记录能力 |

反作弊：先得到缺端点的 404 RED；候选出现后以 E1–E4 拒绝“不写/写错/抢最新基线/半包”结果，以 Web/CLI 拒绝未知当成功、自动重发。未跑的校准保持 pending。

### TDD 切片与轮次

R0：目标/方法只读审查与 E1 公开 HTTP RED。R1：实施 Agent 垂直切片实现契约→HTTP/Step→CLI→Web，每片 RED/GREEN/typecheck；主 Agent 独立跑固定 eval、全量测试/typecheck/build。R2/R3 只修已证实差距，最多三轮。正式 Standards/Spec review、C6 attestation、C7 发布另按完成清单，不降低标准或新增平台。

## 代码落点

计划：contracts/work-requests、Pipeline、creative IO/Step、works route、CLI、CreativePoster/Workspace、Web API。精确文件由候选回读。

## 测试与验证

待取得。

### 完成审核证据

- **清单与候选**：fixed point 如上；清单 blob/T0/T1/manifest pending。
- **逐项判定**：C1 初始对齐如上，余项 pending。
- **验收与 TDD**：E1–E6 v1；R0 RED pending，验收方法审查 pending。
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
