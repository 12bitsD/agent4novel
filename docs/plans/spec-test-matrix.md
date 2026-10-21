# Agent4Novel Spec / Test Matrix（R2A）

> 本文是 R2A 的静态核查落盘，不是新的测试通过声明。范围是 `bf5c105`、已完成的 R1A `b92a603` 与 R1B `09f7a8d`；本次修订没有读取新文件、修改生产代码/测试或运行测试。
>
> 证据口径：`V-R1` = R1 最终已验证事实：R1A 完成纯函数迁移，R1B 将根 test script 固化为 `--maxWorkers=2`；R1B 后无额外参数的 `pnpm test` 连续三轮均通过，四包计数为 contracts 141、CLI 243、server 483、web 218。R1A 前的默认失败仅作历史对照，不是当前状态。`S` = 已核查源码/测试中的 seam、断言或行号，尚未在本次修订执行；`H` = `backend-refactor-loop.md` 记录的历史结果，不能当作当前候选的重新验证。下文用引号标出已知测试标题；没有引号的部分是场景短名，`文件:行号` 是定位坐标。

## 1. 公开 seam、证据与独立变红矩阵

| 领域 | 公开 seam 与现有证据（静态坐标） | 独立变红方式（每次只注入一个 mutation） | 处置与 R2B 顺序 |
|---|---|---|---|
| 主链 | `Pipeline.advance` → 作品 HTTP advance → `WorkView`/Artifact head。`apps/server/test/pipeline.test.ts:123-157` 覆盖 output/head 缺失且依赖 approved 后推进，`:157-194` 覆盖 pending/approved 不停留；`apps/server/test/app.test.ts:87-101` 覆盖 Creative 选定，`:389,458` 覆盖失败保留既有成果。 | 删除 output/head 关卡或让 pending/approved 仍调用 Step；目标断言是不错误调用模型、不新增版本、保持 `awaiting-approval`/当前 head。恢复实现后同一场景转绿。 | **保留**。HTTP、Pipeline 和状态投影是不同公开层，不为减少重复而合并；R2B-3 回归。 |
| 两章/起章 | 显式 `start-chapter`、前章 Beat/Prose approved、Prose.inputs 关联。`apps/server/test/chapter-continuation.test.ts:225-359` 覆盖历史章重生与后续章保留，`:421` 覆盖起章结果不明；`apps/server/test/chapter-start-baseline.test.ts:92-113` 覆盖目标已存在时只读重放；`apps/server/test/sqlite-restart.test.ts:115-117` 覆盖两章、历史和 pending 重启恢复。 | 允许不连续章号、错误前章基线或对已有目标再次调用模型；目标断言是拒绝非法起章、原请求基线不变、目标章只读重放且没有下一章/新 Artifact。 | **保留**。两章关联不是通用主链的替代断言；R2B-3 回归。 |
| 关卡/定稿 | pending/approved 与专用 finalize 的 HTTP/Store seam。`apps/server/test/app.test.ts:537-681` 覆盖 Outline 保存/专用通过；`apps/server/test/outline-approval.test.ts:146-162` 覆盖写后响应失败；`apps/server/test/beat-pipeline.test.ts:156,303,343-360` 与 `apps/server/test/prose-routes.test.ts:242-299,382-423` 覆盖 Beat/Prose 关卡、保存、写后失败。 | 把专用 finalize 换成通用 `setStatus` 或 append V+1；目标断言是 Setting/Beat/Prose 通过保持同 id/version/createdAt，Prose save 仍是新 id/version+1，写后异常不得伪报未提交。 | **保留**。通用 Artifact schema 与专用关卡语义有独立价值；R2B-3 回归。 |
| 上游 CAS | Store 条件写入、expectedHead/上游 approved 和跨连接竞争。`apps/server/test/store.test.ts:167,451`、`apps/server/test/sqlite-process.test.ts:86-99` 覆盖过期写入与独立进程竞争；`apps/server/test/chapter-start-baseline.test.ts:92-113` 覆盖真实基线。 | 删除/后移 append 的 precondition，或接受过期 expectedHead；目标断言是过期写入 `version-conflict`、只有一个获胜版本、既有 head 保留。M1 的历史红绿记录属于 `H`，不是本步新证据。 | **保留**。不能用单连接 fake 取代真实 CAS；R2B-3 回归。 |
| 未知恢复 | 传输失败、5xx、畸形响应后的 `unknown`、最多一次回读及禁止自动重发。`packages/contracts/test/beat-submission.test.ts:21-44`；`apps/cli/test/outline-cli.test.ts:32-47` 的 `keeps %s unknown with only the original POST`；`apps/cli/test/setting-cli.test.ts:45-58` 的 `confirms a committed request after losing the response with one read and no repeat write`；`apps/cli/test/prose-cli.test.ts:9-29`；`apps/cli/test/creative-cli.test.ts:148-157`。 | 把 network/5xx/malformed 错报为 `not-committed`，或在 unknown 后自动 GET/POST；目标断言是写入结果保守为 unknown、原冻结基线不变、POST 次数不增加，专用命令回读次数符合契约。 | **保留**。不同命令的恢复 owner 和回读策略不能合并成通用重试；R2B-3 回归。 |
| SQLite/恢复 | 真实 SQLite schema、事务、重启和独立进程。`apps/server/test/sqlite-store.test.ts:54-100,167-176` 覆盖损坏/未来结构及事务回滚；`apps/server/test/sqlite-process.test.ts:59-130` 覆盖 BUSY、CAS、强杀回滚；`apps/server/test/sqlite-restart.test.ts:115-117` 覆盖真实重启；`apps/server/test/sqlite-initialization.test.ts:49-59,75-154` 覆盖构造与初始化诊断。 | 删除事务回滚、把 `SQLITE_LOCKED` 纳入初始化 retry、接受未知 schema；目标断言是物理文件/重开后的数据保留、attempts 有界、无 fallback/删库。M6 的历史红绿记录属于 `H`。 | **保留**；`setting-extension` 第二写另有 **R2B-1 补强**，见第 3 节。 |
| CLI | `a4n` 可执行入口的 help、严格语法、stdout/stderr/exit、文件和 loopback HTTP。`apps/cli/test/command-entry.test.ts` 的 `shows advance help without executing the supplied work command`（起点 :53-59）、`starts exactly the requested chapter and rejects malformed continuation files without HTTP or secret echo`（起点 :124-150）；`apps/cli/test/validation-issues-entry.test.ts:91-114` 的 `preserves central client metadata for %s issues` 与 `preserves Beat raw response metadata for %s issues`；`apps/cli/test/outline-entry.test.ts:53-89` 的真实一次 POST。 | 把 help 移到文件/HTTP 后、把错误写到 stdout、丢弃 `issueCount/issuesTruncated` 或改写请求文件；目标断言是真实进程仍零 I/O、stderr 单行安全 JSON、metadata/文件字节/请求序列完整。M3 的历史红绿记录属于 `H`。 | **保留**；纯函数与进程分层见第 4 节，不把纯函数断言当进程证据。 |
| run-step | 本地 worker、真实生产 Step、loopback provider、四文件记录和 deadline/unknown 收尾。`apps/cli/test/step-transport.test.ts:32-61,118-156,376-432`；`apps/server/test/isolated-runner.test.ts:111-215`；`apps/cli/test/beat-variant-cli.eval.test.ts` 的 `exposes the regeneration source and actual transport in run-step records`。 | 忽略最终 meta 失败、worker crash 后跳过 unknown、接受畸形/错 stepId stdout 或重跑 provider；目标断言是原 CLI 错误优先、invocation 保留、result/meta 状态准确、记录不被误标 complete、没有自动复跑。M5/M8/M9 的历史红绿记录属于 `H`。 | **保留**。provider、文件权限、worker transport 和恢复是独立 seam；R2B-3 回归。 |
| Setting 扩展事务 | `setting-extension` approve 的 canonical Artifact append + proposal 状态更新必须在同一真实 SQLite 事务。当前 `apps/server/test/setting-extension.test.ts:316-330` 只在第一次 canonical INSERT 前注入失败。 | **现有证据不能证明第二写失败回滚。** 按第 3 节在第二写前注入故障，先证明第一写已完成，再检查重开后无半份 Artifact/状态；单独移除事务边界应变红，恢复后转绿。 | **补强，R2B-1**；不把第一次写失败的结果冒充第二次写失败证据。 |

## 2. 证据质量分类与具体处置

### 2.1 有效集成证据：保留，不因“看起来重复”合并

- `apps/server/test/sqlite-process.test.ts:86-99,109-130` 使用独立连接/进程验证 CAS 和强杀恢复；这是内存 Store 或纯 matcher 无法替代的证据。
- `apps/server/test/chapter-start-baseline.test.ts:92-113` 以真实基线和目标章重放验证只读语义；不能用单一 Pipeline fake 代替。
- `apps/cli/test/validation-issues-entry.test.ts:92-114` 真实 CLI + loopback HTTP 直接检查 stderr 的 1/129 条 issues、`issueCount` 和 `issuesTruncated`；这是公开机器输出的有效集成证据。
- `apps/cli/test/outline-entry.test.ts:53-89` 的 `prints exactly one approved target as JSON through the executable with one POST and an unchanged request file` 同时约束进程 JSON、一次 POST 和文件不变。
- `apps/cli/test/step-transport.test.ts:32-61,118-156,404-432` 真实 worker、私有记录目录、路径/symlink 和 deadline 证据均保留；不能由 `runLocalStep` 的纯 mock 取代。
- `apps/cli/test/command-line.test.ts:20-101` 是 R1 新增的纯函数证据，适合快速检查 parser/help；它不是上述集成证据的替代品。

### 2.2 重复但有独立价值：保留

- `packages/contracts/test/step.test.ts:23` 的 runStep 非法输出与 `apps/server/test/pipeline.test.ts:256` 的失败 outcome/no-commit 分别守住 Step 边界和 Pipeline 状态结果，**保留**。
- `packages/contracts/test/artifact-validation.test.ts` 与 `packages/contracts/test/prose-save.test.ts` 分别是通用 Artifact 状态映射和 Prose 专用请求/响应，**保留**。
- R1 的纯 `helpFor`/`parseCommandLine` 与真实 `a4n` 进程有输入重叠，但验证的是不同公开层：前者是文本/解析，后者是 main 的提前返回、进程通道、退出码和零 I/O，**不合并且不重复扩展进程表**。

### 2.3 历史已完成事项（不进入当前 R2B）

以下 B/C 清理已在历史 loop 完成，仅保留变化事实，**不得再次列为当前待处理或可合并项**：

- `beat-pipeline` 缺字段 Beat 的 schema-only 重复已合并。
- `isolated-runner` 的 chapter/systemPrompt 重复已合并。
- `public-api` 的 foreign-work/duplicate-head 已在迁出 issue path、不同章/kind 可共存等独特断言后合并。
- `author-guidance` 与 Beat 的直接 `.run` 已迁到公开 `runStep`；新卡 ID、意见和实际 `callLlm` 配置等独特断言随迁移保留。

### 2.4 当前过宽/假有效风险与内部单元契约

| 位置/场景 | 问题 | 处置 |
|---|---|---|
| `apps/server/test/setting-extension.test.ts:316-330` 的双写回滚场景 | 第一次 canonical INSERT 前失败，最多证明“第一写失败没有写入”；若把它当“第二写失败全回滚”证据就是假有效。 | **补强**，按第 3 节增加第二写故障，不删第一写场景。 |
| `apps/server/test/sqlite-initialization.test.ts:75-154` 的两个直接 helper 用例 | 这是刻意保留的内部初始化单元契约，不是当前必须迁移的 C 类项；只有改实现时才另行对齐公开装配。 | **不处理**；保留 constructor :49/:59 样板、两个 helper 用例及当前代码事实，不在 R2B 重做迁移。 |
| `apps/cli/test/command-line.test.ts:4-16` 的 `expectUsage` | 纯函数只能证明抛出 `usage`、单行安全 message；不能证明进程 exit、stderr JSON、stdout 或零 HTTP。 | **不处理为缺陷**，保留其正确定位；进程代表仍在 `command-entry`，禁止把该 helper 单独引用为零 I/O 证据。 |

## 3. `setting-extension` 第二写故障注入方案（R2B-1）

这是当前已确认的证据缺口，不是已通过的新测试。

1. 使用现有 `setting-extension` 测试的真实 SQLite 数据库、真实 proposal 和公开 approve 入口，保留第一次 canonical INSERT 前失败的原有案例。测试内准备合法候选，记录原 head、Artifact 行数/版本、proposal 状态和 requestId。
2. 在**测试的 SQLite driver/connection 故障注入点**按实际写语句顺序计数：第一次 canonical INSERT 放行并确认完成，第二次 proposal 状态写之前抛出一个确定的数据库错误。只包装 driver 的执行/准备方法，不 mock approve、Store 业务策略或恢复函数；如果现有 helper 只能 fail-before-first，就在测试内扩展为 fail-on-second-write，不改生产实现。
3. 通过公开 approve 调用后，先断言故障确实到达第二写且第一写已完成（例如记录语句顺序/计数）。没有这个到达断言，测试可能只是再次在第一写失败，不能计入证据。
4. 关闭并重开真实 Store/独立连接，核对：候选 Artifact 没有留下、原 head/版本/内容/inputs 不变、proposal 没有被标成已批准、没有半份回执；同时按当前路由契约检查安全错误。响应错误码不能替代物理回滚断言，也不预先发明 `not-committed` 结论。
5. 做一个无故障 control，确认同一候选正常完成 canonical append + proposal 更新。随后**单独**注入事务边界 mutation（例如让第二写脱离原事务/在第一写后提前提交），目标物理回滚断言必须先 RED；恢复正确事务后同一测试 GREEN。第一次写失败和第二次写失败必须分别取得 RED/GREEN，不能合并注入。

建议的测试内伪代码（仅说明注入顺序，不是本步已落地的实现）：

```text
onWrite(sql):
  if isCanonicalInsert(sql): record("canonical-insert-complete"); allow()
  if isProposalWrite(sql): record("second-write-reached"); fail(injectedDbError)
  allow()

approveThroughExistingPublicSeam(validCandidate)
assert record == ["canonical-insert-complete", "second-write-reached"]
reopenRealSqlite()
assert originalHeadAndRowsUnchanged()
```

## 4. R1 纯函数/进程重叠与 `retryable:false` 审计

### 重叠是否合并

| R1 位置 | 纯函数证明 | 真实进程证明 | 决定 |
|---|---|---|---|
| `apps/cli/test/command-line.test.ts:20-47` vs `command-entry.test.ts` help 场景 | `helpFor` 的命令识别、用法/示例/副作用和隐私文本 | main 提前返回、exit/stdout/stderr、非法配置优先、零 HTTP/FIFO/provider | **都保留，不合并**；输入相似不是证据重复。 |
| `apps/cli/test/command-line.test.ts:49-101` vs 保留的 parser/usage 进程案例 | 每个非法 argv 的 `parseCommandLine` 拒绝、单行 message 和隐私 | 错误 JSON 外壳、exit 1、空 stdout、无 HTTP，以及 main 层 kind 校验 | **纯表保留、进程代表保留**；不把所有非法输入再次启动进程。 |
| `outline-entry.test.ts:11-20` 等已迁移 entry | help/必填参数的纯解析 | 文件、HTTP 和真实错误仍留在同文件或 `command-entry` | **不合并独立失败语义**。 |

### `retryable:false` 是否丢失

基于 R1 实际 diff 的静态核对，**没有证据支持“唯一显式 `retryable:false` 断言已经丢失”这一说法**：

- 原 `apps/cli/test/outline-entry.test.ts` 起点 :20 对缺少 `--file` 的进程错误断言 `{ code: 'usage', retryable: false }`。
- R1 新 `apps/cli/test/outline-entry.test.ts:16-18` 仍以 `expect.objectContaining({ code: 'usage', retryable: false })` 检查同一公开错误属性；focused 105/105 是 `V-R1`，但本条字段核对本身是 `S`。
- R1 新 `apps/cli/test/command-line.test.ts:11` 的通用 helper 只统一检查 `code:'usage'`。原 `command-entry` 那些迁移表本来也只显式断言 `code:'usage'`，没有可被称为“丢失”的 `retryable:false` 断言；进程保留案例仍检查真实 JSON 外壳。

因此 R2B 的最小决定是：**保留现有 `retryable:false`，不合并、不删除，也不为它新增重复进程**。若验收要求所有纯 parser 错误都额外检查该字段，可在纯 helper 中补强，但应记录为新增断言，而不是恢复一个已证明丢失的断言；不能把静态字段核对写成测试已通过。

## 5. R2B 最小顺序、验证 seam 与红绿门

1. **R2B-1：先补第二写回滚**（`apps/server/test/setting-extension.test.ts:316-330`）。真实 SQLite + 公开 approve seam；按第 3 节取得第二写故障的独立 RED，再恢复实现取得 GREEN。第一次写失败案例继续单独存在。
2. **R2B-2：只做必要的证据复核**。核对第二写注入确实到达、物理回滚断言有效，以及 R1 纯函数/进程分层和 `retryable:false` 结论；没有新的字段丢失证据就不改测试、不合并案例。历史已完成的 B/C 清理不再执行，`sqlite-initialization` 两个内部 helper 单元契约也不重迁。
3. **R2B-3：最终全量验证**。先跑受影响的 server/CLI focused，再执行无额外参数的 `pnpm test` 连续三轮；R1B 已在根 script 固化 `--maxWorkers=2`，不再叠加参数。核对 contracts、CLI、server、web 四包结果，并把每个 mutation 单独变红、恢复后转绿；超时、fixture 错误或未到达注入点不算有效 RED。新验证未执行前不得沿用 R1 的通过结论替代。

当前 `V-R1` 已包含 R1B 后三轮四包全绿；但本矩阵的保留/补强和 R2B 建议仍是静态判断，本次修订没有重新执行矩阵项，也不宣称新的 GREEN。
