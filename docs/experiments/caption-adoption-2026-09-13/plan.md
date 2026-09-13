# Caption SP 与单节点 CLI 接入

本次按用户要求，把现有最合适的 Caption SP 和此前隔离实验的 CLI 能力接回当前代码，并同步 wiki。最初范围是本地代码与文档更新；用户随后明确要求 git push，本次增加已审核变更的分支提交与推送，不重新开启 SP 搜索，不合并或关闭既有 issue。

## 选择与范围

- 采用 R10 A 原样 SP：[生产 SP](../../../apps/server/src/steps/skills/caption/SKILL.md)。SHA256 为 `dcbe0addf9cf394ab9706f4f7da4967592e872f8f9c40053c1181cc7dfe91fc5`。R10 两位 creative/caption 评阅均首选 A；它比当前“只理解、不创作”的指令更符合用户要求。公开证据范围见[历史实验记录](#历史实验记录)。不把单样本偏好写成稳定或跨作品最优。
- R10 A 四字段及限制兼容既有 caption schema。直接替换生产 `skills/caption/SKILL.md`，不混入尚未测试的新改法；原稿和 creative 输入构造不变，creative SP 与实验固定版一致。
- 移入临时 runtime 的 `run-step`：五个已实现节点、自定义 system prompt、配置及参数覆盖、独立 worker、生产 Step/schema 复用、安全遥测。没有模型 raw 输出；失败不会落作品或伪造结构成功。
- 同步已在实验中使用、符合用户此前参数请求的 LongCat 默认 `thinking=disabled`、`temperature=0.9`、`topP=0.95`，允许显式 generation 覆盖。默认会影响正常 Pipeline/Web 的后续 LongCat 调用；它们不是已证明的通用最优。topK 不受支持，明确拒绝。
- 不改变产物形状、人工关卡、Creative SP、UI 或既有作品；不增加无 caption 的诊断入口、原文捕获模式、自动重试或新依赖。

## 验收与执行计划

1. 核对推荐文件、真实受测 SP 与生产文件字节一致；读取器仍直接加载文件，生产 systemHash 可追踪来源。用已有 Step 测试确认组装与输出契约。
2. 在既有公开 CLI 边界先得到 `run-step` 缺失的 RED，再移入最小实现得到 GREEN；使用本机 mock provider 验证自定义 SP、参数覆盖、五节点输入、错误/超时及敏感内容边界。重复参数边界采用 contracts 测试，不通过真模型断言随机文本。
3. 核对显式实验模型覆盖只作用于隔离 worker；正常 server 启动配置校验仍保留。验证 topK 拒绝、无凭据不降级 demo、worker 不污染 stdout 或 store。
4. 同步 Wiki 011/014/016、领域和 schema 语义、双语 README、handoff 与运行 skill。方法/历史实验保留，新增变化事件记录此次采用；不回写冻结输出和停止结论。
5. 定向测试通过后运行完整 test/typecheck/build、差异/链接检查和独立代码评阅。新失败才扩大验证。记录实际结果及剩余边界，不把既有实验结果冒充本轮真实调用。

## 工作区与审核边界

- 固定点：`ca9689632442904ad328f3b25cdbec4e5530a65e`；当前分支 `codex/issue-5-beat-review`。本次保留当前工作区，不改变 #5 的交付流程。
- 开始时已有 `Workspace.tsx`、`Workspace.generation.test.tsx`、Wiki 011/索引、experiments/research 未提交修改。UI 内容不属于本次变更；对既有 wiki 仅追加/更新本次相关内容。
- 已完整读取 ticket-completion-checklist 并回读 #11/#14 的既有目的；两票已 CLOSED。本次验收来自当前用户指令，不冒称重新通过旧票 AC、远端 review、CI 或发布。
- 输入与 provider 配置使用既有授权和安全通路；本轮验证使用 fake/mock transport，没有新增真实素材发送。
- 主要风险：候选仍有语义错误与单案例局限；默认 LongCat 参数会改变后续生成分布；单节点 CLI 依赖完整 monorepo；已运行 server 的 skill 缓存需要新进程读取。本次检查时 8787 无监听进程。

## 验证记录

| 检查 | 本轮结果 |
| --- | --- |
| CLI RED → GREEN | `step-entry.test.ts` 的命令发现测试先因 help 缺少 run-step 失败，迁入后通过 |
| 显式模型 RED → GREEN | `step-transport.test.ts` 先复现 config.model 被无凭据的启动默认阻挡（exit 1）；worker 仅覆盖自身默认后通过，同时测试选中模型缺凭据仍不发请求 |
| 定向测试 | CLI 11、Server 47、Contracts 新增边界 16 测通过 |
| 完整包测试 | `COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/contracts --filter @agent4novel/server --filter @agent4novel/cli test --silent`：66 + 165 + 49 = 280 测通过；`COREPACK_ENABLE_AUTO_PIN=0 pnpm --filter @agent4novel/web test`：64 测通过；合计 344 |
| 类型检查 | contracts/server/cli 三包 typecheck 与 web typecheck 全部通过 |
| 构建 | `COREPACK_ENABLE_AUTO_PIN=0 pnpm build` 通过；保留既有 Vite 单 chunk > 500 kB 提示 |
| 版本核对 | 生产 Caption SP、推荐文件、R10 A 受测文件字节一致；creative SP 与固定实验版一致 |
| 依赖与安全 | package.json/pnpm-lock 无变化；测试仅使用合成 loopback provider；CLI 不输出 worker 原始 stderr 或模型失败正文 |
| 独立评阅 | Standards 与 Spec 均 PASS，分别核对最终 38 文件内容 hash。没有阻塞问题；Spec 初审发现的非 LongCat thinking 错误码说明已按 runtime 的 llm-unavailable 修正 |
| 文档与范围检查 | 197 个本地引用、三篇 wiki 的 frontmatter/固定章节/变化事件、SP 字节及既有 UI 事件保留均通过；git diff --check 通过；无依赖变化 |

Server 测试保留 SDK 关于 LongCat schema responseFormat 的已知提示，仍使用 json_object 加本地校验。以上验证证明代码接线和边界，没有新增真实模型质量证据。

Standards 留下一项非阻塞 P3：隔离 runner 的上游依赖表与生产 start.ts 当前一致，但将来变更需同步。此次保留简单映射和五节点测试；后续确有依赖变更时可抽取无启动副作用的共用定义，不为潜在改动扩大本次范围。此次评阅后仅回填本节证据及 Wiki 014/016、handoff 的验证状态，没有修改行为或验证标准。


## 历史实验记录

以下是既有实验的摘要，不是本次代码接入新产生的模型质量证据。完整原稿、逐次模型正文、评阅和运行快照保留在本地 `docs/experiments/caption-optimization-2026-09-13/`，不随公开仓库推送。源码中的 Caption SP 可直接复核；未发布的详细实验不能由公共仓库独立复现。

- R10 A 在两位匿名 creative 评阅和后续 caption 评阅中均列第一；同轮四份 caption 均结构有效，A/B 的 creative 首次输出出现字段错误，全文仍参加文学评阅。
- R8、R9、R10 都只出现局部收益，没有较大整体进展；按用户约定累计 3/3 后停止。推荐意味着当前采用候选，不意味着已经稳定、跨作品最优或所有故事前提正确。
- R9 用同一 SP/素材对 caption thinking 作一次开关配对，两侧 creative 均关闭。开启后的 caption 用时从 37.310 秒增至 48.214 秒，增加 29.2%；局部关系细节有收益，但没有稳定整篇改善的证据。没有据此证明所有节点或采样参数的最优配置。
- 可保留的方法：用具体人物处境承接设定，让回应影响后续；分开判断好重心与持续开发；逐 SP 记录收益、退步及与上一版的差异。正例、简化提示或去掉备选尚未获得单独因果验证。
- 主要方法边界：每臂单次筛选不能证明稳定性；代理评阅仍需用户偏好校准；原稿直达、自动 caption、认可的参考 caption 三条件隔离实验尚未执行。

本地定位：推荐文件 `recommended-caption.md`；总结 `final-report.md`；停止记录 `stopping-rule.json`；逐轮方法与反思 `lessons.md`、`iteration-retrospective.md`；thinking 配对 `round-09-old-day/thinking-ab.md`。这些是本地归档位置，不是公开下载链接。

## 分支推送范围

用户于本次接入完成后明确要求推送。新分支为 `codex/caption-sp-cli`，基于 `origin/main` 的 `a1646e7fe4809ae3e37865d05363ab660c9c270d`；其文件树与先前验证固定点 `ca9689632442904ad328f3b25cdbec4e5530a65e` 相同。旧 PR #23 已合并，issue #5 仍 OPEN；此次不修改 issue 或 PR 状态。仓库未配置 GitHub Actions workflow。

提交包含此前审核的 Caption/CLI/文档，以及同一会话已要求并测试的“后续生成期间保留 creative 面板”修复和测试，以对应 Wiki 011 的现有记录。原稿、完整模型输出、临时脚本及其他实验资料均留在本地；公开 wiki 链接本摘要，避免递归加入私有实验内容。
