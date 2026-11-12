# 契约管理 — 按边界维护可执行定义

契约的执行定义归代码，领域含义归领域文档，设计理由归 Wiki。#19 的治理目的和历史验收由 [Wiki 019](../wiki/019-contract-governance.md) 保留；本页描述当前实现。

## 权威来源

沿用 [Wiki 信息边界](../wiki/README.md#信息边界)，不把多个来源复制成相互漂移的规范。

| 内容 | 唯一归属 | 其他来源的用法 |
|---|---|---|
| 领域术语及禁用同义词 | [CONTEXT.md](../../CONTEXT.md) | 直接使用并链接 |
| 数据模型、内容形态、不变量及持久化语义 | [docs/schema.md](../schema.md) | Wiki 解释变化原因 |
| 前端内容、请求、响应及编辑状态校验 | `packages/contracts` 的 Zod 定义 | Web 运行时复用并派生类型 |
| 生产 HTTP、CLI、Store 和独立节点定义 | `apps/backend/src/agent4novel` 的 Pydantic 模型 | 路由、CLI、Store 和测试复用 |
| 模型无 ID 的内容变体 | `domain/drafts.py` 与 `agent/*_steps.py` | 作者编辑、模型输出、存储完整形态分别验证 |
| 每票范围和验收标准 | GitHub issue 或明确的人类决定 | Wiki 记录方案与证据 |
| 不可逆或跨票架构决定 | `docs/adr/` | Wiki 引用，不另写决定 |

Python 与 TypeScript 不共享可导入的运行时库。`packages/contracts` 不用于 Python 生产进程；公开 JSON 由真实 FastAPI/CLI 测试、跨语言 golden fixtures 和 FastAPI OpenAPI 共同保护。不要恢复第二个生产后端或 stdio 适配层。

## 变更如何交付

每次新增或修改契约，先确认生产者、消费者和存储边界，再按 [Ticket 完成审核清单](./ticket-completion-checklist.md) 交付。公开内容、请求和响应使用现有 Pydantic 模型，避免手写平行 DTO；前端对应变化仍复用 `packages/contracts`。代码变更同步 `docs/schema.md` 和本票 Wiki，只有领域词变化才更新 `CONTEXT.md`。未实现的设计必须标明。

模型输出只含模型负责的内容。服务端生成 ID、状态和版本，存储边界再次验证最终 Artifact。作者输入不完整、模型输出、存储快照不能使用同一份较宽松草稿规则替代。

## 现行契约清单

### 内容与身份

Python 公共模型位于 `domain/work.py`、`domain/drafts.py`、`domain/requests.py`、`domain/resources.py` 和 `domain/commands.py`。前端的对应 Zod 定义继续位于 `packages/contracts/src`。

| 边界 | 生产者 → 消费者 | 验证责任 |
|---|---|---|
| Caption | Caption Step → Store、Creative/Setting Step、Web | 提炼稿结构和数量限制；入库即 approved |
| Creative | Creative Step、作者编辑/选择 → Store、Outline/Setting Step、Web/CLI | 模型不提供 directionId；保存全方向 pending，选定单方向 approved |
| Outline | Outline Step、作者编辑 → Store、Setting/Beat Step、Web/CLI | 弧线/剧情点层级和 ID；保存 pending，专用通过绑定 ID/version |
| Setting | Setting Step、作者通过 → Store、Beat/Prose Step、Web/CLI | 卡片、section、全局 ID 和文本预算；通过保留同 ID/version/createdAt |
| Beat | Beat Step、作者审阅 → Store、Prose/后续章 Step、Web/CLI | 编辑、通过、再生完整度分别验证；章号与版本为正安全整数 |
| Prose | Prose Step、保存、作者通过 → Store、后续章 Step、Web/CLI | pending 可保存空稿；approved 和模型生成必须非空；全文不做 trim 归一化 |

`Artifact` 同时约束 workId、kind、chapter、version、humanStatus、content、createdAt 和 inputs。head 是同地址最大版本；精确历史读取需要完整 kind/chapter/artifactId/version，不提供历史列表或回退操作。

### 生产 HTTP 与 CLI

- `main.py` 创建 FastAPI 应用、加载运行环境并装配实际 Store 和 Pipeline。
- `routes/` 使用请求模型及 `response_model` 校验成功响应；已知错误由 `errors.py` 和公共错误映射处理。未捕获异常返回安全的 internal-error，不能据此断言写入未发生。
- `cli.py` 负责零副作用帮助、严格语法、stdout/stderr 和退出码。`cli_http.py` 校验响应形状与资源关联，不复制领域状态机。
- `services/submissions.py` 与 `cli_special.py` 校验冻结基线、精确全文和 command target，处理 Setting/Beat/Prose 的 committed、not-committed、unknown 与冲突。只有精确确认才能清除 unknown；普通网络错误、5xx 或畸形响应不能证明未写入。
- 创建、选择、advance/start、通用通过等响应还需核对 seed、workId、目标 kind/chapter/status，而不只是 parse 成功。起章只接受 generate-beat 或合法 request-rejected 的关联结果。
- `services/validation.py` 将 validation issues 限制为 128 条，并保留 `issueCount` 和 `issuesTruncated`。客户端拒绝超额、畸形或关联错误的错误包；错误 JSON 不是另一种成功结果。

主要接口保持 `/api/works`、`/api/works/:id`、advance、创意稿保存/选择、Outline 保存/通过、Setting/Beat/Prose 专用命令、显式起章、telemetry、作者配置/文件、设定扩展和坏例。路由、请求与响应以代码和 OpenAPI 为准，不能凭类型断言省略运行时检查。

### 错误、观测与恢复

普通错误包含 code、message、retryable，以及可选 attemptId、issues、issueCount、issuesTruncated。Beat/Prose 的 command observation 另含 operation、target、expectedHead、failureStage 和 writeOutcome；不要把所有 JSON 都改成同一种外壳。

`agent/runtime.py` 与 `domain/diagnostics.py` 记录有界进程内遥测：stepId、attemptId、requestId、模型、耗时、token usage、finishReason、安全错误分类、生成参数、promptHash/systemHash 和配置文件 hash。不得加入完整 prompt、原始 Provider 响应或凭据。空日志不能证明未执行。

CLI 的专用写入最多按契约回读一次，不能自动重发、换基线或凭新 head 认领旧请求。A/B 选择只发送一次请求，不隐式通过。`requestId` 在配置/文件/坏例/扩展中是操作身份，在普通命令遥测中只是关联 ID，不能混用。

### 独立节点与记录

`agent/isolated.py` 使用与生产相同的六个 Step、内容模型和 ID 注入规则，不创建 WorkStore/Pipeline，也不证明所供上游是当前 approved head。`agent/recording.py` 创建不可覆盖的私有目录，写入 `input.json`、`invocation.json`、`result.json`、`meta.json` 四份机器记录；`comments.md` 是可选旁置材料。

只有 `meta.complete:true` 且 `meta.status:"complete"` 才能把记录视为完整。worker/本地 Step 异常、超时和 meta 写入失败保留部分证据；unknown 收尾不得覆盖已有 invocation 或伪造成功。

### 存储与响应的验证责任

- `store/sqlite.py` 严格校验 SQLite v1–v4 结构和读取快照；`store/work.py` 处理作品/Artifact 写入，`store/resources.py` 处理配置、文件、扩展和坏例；`store/memory.py` 仅用于行为测试，不是生产失败后的 fallback。
- append/save/finalize/setStatus 在写入前验证候选，目标和上游条件在同一短事务内比较。LLM 不在数据库事务中运行。多行写入失败必须整体回滚。
- `getWork` 验证作品归属与唯一 head；`get_artifact_version` 验证单个历史版本。读取 head 不等于检查全库全部历史。
- 成功响应校验失败不能证明写入未发生；消费者必须保留相应 unknown/readback 语义。畸形 4xx 同样不能证明未提交。

## 保留的边界

三类 creative hint、Beat/Prose 命令族、各私有 Step 包装和不同人工编辑完整度继续分开。客户端本地编辑状态、HTTP transport、CLI flags 和 Provider 原始响应都不是新的领域 schema。Hono RPC 不再是最终 Web 类型边界；前端继续使用 Zod，Python 提供生产 Pydantic 与 OpenAPI。#28 工具执行、#29 作品 Wiki 和长期记忆不在当前实现中。

历史方案、RED/GREEN、独立审核和排期理由从 [Wiki 019](../wiki/019-contract-governance.md) 及对应票据追溯，不在本页复制旧测试计数或旧实现路径。
