---
wiki_id: "001"
ticket: 1
ticket_state: done
context_state: current
summary: "本机单用户MVP工程验收、证据边界及后续拓展入口。"
topics: ["mvp-acceptance", "local-single-user", "delivery", "verification"]
code_paths: ["scripts/container-smoke.mjs", "scripts/production-smoke.mjs", "apps/server/test/sqlite-restart.test.ts", "apps/web/src/pages/Workspace.tsx"]
symbols: ["createApp", "WorkView", "BadExample", "AuthorConfigView"]
inherits: ["006", "007", "008", "033"]
changed_by: ["041"]
read_when: ["resume-mvp", "review-mvp-acceptance", "plan-post-mvp"]
last_context_reviewed: "2026-10-03"
---

# 001 — 本机单用户 MVP 工程验收

## Agent Context

- **读取时机**：恢复当前MVP、区分已交付能力与扩展、核对整体验收。
- **原始目的**：让作者从脑洞逐章创作并把关；原目标和当前有效解释见[#1](https://github.com/12bitsD/agent4novel/issues/1)。保留长期完本愿景。
- **实际落地**：#1 及必需子票已合并关闭；本机 Docker、六节点/逐章双关卡、章节阅读及正文编辑、配置/文件、SQLite、手工坏例均已接线。2026-10-03 远端回读及当前回归见[清点与复审](#2026-10-03-清点与复审)；本次发现三项待修复边界。
- **当前价值**：全部已对齐点见[决定清单](../research/mvp-delivery-options.md) D01–D20；本页聚合验证边界，不替代各票技术上下文。
- **后续变化**：#28/#29设定工具/作品Wiki、自动Wiki更新、已通过设定/章纲回改及长篇质量评估继续后置，不自动关闭拓展票。
- **代码入口**：真实CLI容器联验、production SDK mock、跨进程恢复测试与Workspace；具体模块从继承Wiki进入。

## 设计目的

对当前已确认的本机单用户MVP作工程验收：作者能完成两章，回看和编辑历史正文，保全作品及作者配置/文件/坏例。记录真实模型调用的有限证据，避免把短样例扩大为整本小说质量证明。

## 起始上下文

- 固定点 `a68fdd39e1a5551ee0eb76f67e146d644279c570`，#8 PR39已合并关闭；#6/#19/#9/#33/#7均已交付。新source `codex/1-mvp-acceptance` → PR → main，用户loop授权持续；只有本机Docker+CI范围是本轮明确人决，其余三案自主收敛。
- #1原生blocker为空；claim12bitsD，保留ready-for-agent/Project Backlog，无保护/rulesets。对应commit的实际quality/container成功后才合并关闭。
- 纯文档及验收收口，不新增行为；版本化计划为票面/子票对账→验证矩阵与三案→当前门禁及链接/旧审核保留→三校准→独立双轴/有限attestation→实际CI/PR/merge/comment/close。
- 用户原checkout与8787/5173未触碰；浏览器/CLI合成验收只使用临时8794和独立数据目录，无供应商key、无新增付费调用。

## 技术方案

三案研究见[最终验收选择](../research/mvp-delivery-options.md#最终mvp验收三案)。选择完整回归＋真实CLI/容器恢复＋浏览器用户路径＋既有有限供应商证据。当前有效解释继承#11提炼稿/创意选择替代interview、#4弧线/剧情点与章节解耦、#6只读已通过章纲/设定和上一章承接；原始目标保留。

| 验收项 | 原User Stories | 当前实现/证据 |
|---|---|---|
| AC1 统一入口与方向/大纲/设定 | 1–8 | #3/#11/#4/#13；真实Markdown上传保留seed、创意选择、六kind首章完成，CLI smoke和前端文件adapter/编辑测试。interview及按章固定大纲已由已确认方案替换。 |
| AC2 两章关卡/按章回看/历史编辑 | 9–16 | #5/#22/#6；无通过不得继续，每章正文通过后停止；目录与稳定URL，旧章正文编辑仍approved，后章原文/状态保留并提示衔接。所有中间产物可看，已通过设定/章纲只读。 |
| AC3 三维配置/模型覆盖/版本文件/实际快照 | 17–20 | #7；production SDK mock证明实际参数/系统文本/revision/文件hash；并发配置冻结、真实CLI/浏览器保存及重启/备份回看。上传Skill为文本指导，tools仍关闭。 |
| AC4 手动坏例及回看 | 21–22 | #8；原生阅读/编辑选段，可选备注，不可变来源/原文；历史修改和重启不改样本，采集未知结果/导航保护；不自动分析。 |
| AC5 持久化恢复 | 23 | #9/#7/#8；全部产物版本、状态、输入引用、配置和文件及坏例；实际终止/新进程、容器重建和停止后整目录恢复。未保存页面修改/进程内日志不恢复，重启不自动调用模型。 |
| AC6 本机运行与交付 | 24 | #33；同源Web/API、localhost、数据目录卷、无key fake质量与容器CI，镜像与静态资源实际可用。当前源提交实际CI需在C7完成。 |

上述解释是既有已对齐范围，不新增删除原目标的裁决。任意层回改、工具搜索/Wiki和公网部署仍是后续票，所有对齐点以D01–D20完整表为准。

## 代码落点

- `scripts/container-smoke.mjs`：实际镜像/CLI两章、作者配置/版本文件、坏例、历史全部版本、重建和整目录备份恢复。
- `scripts/production-smoke.mjs`及`apps/server/test/author-config-pipeline.test.ts`：真实生产装配接本地SDK mock，验证配置确实进入调用和同操作冻结。
- `apps/server/test/{sqlite-restart,sqlite-process}.test.ts`：正常/强制退出、并发条件及事务回滚，生产SQLite恢复。
- `apps/web/src/pages/Workspace.tsx`及对应mounted测试：关卡、编辑/切章/未知结果保护；源码HOW及CLI命令见运行skill。

## 测试与验证

**记录时点**：下方 2026-09-30 的验证说明及“完成审核证据”保留当时发布前状态，其中的待 CI/合并/关闭表述属于历史审核。当前远端结果及新增发现见本次复审；原审核字段不追改。

当前可执行实现来自#8最终候选，本票不改代码。2026-09-30重新执行`pnpm test`815 PASS（contracts119/CLI182/server384/Web130）、`pnpm typecheck`及`pnpm build`均exit0，原始日志在`/tmp/a4n-1-evidence/`。静态校验7份文档、100个本地链接、Wiki schema/索引/双语事实/旧审核byte-identical/凭据扫描PASS；无独立lint脚本，执行现有类型/构建/结构和diff检查。保留既有docx >500KiB构建警告；本票对应commit远端CI仍待发布。

- **CLI/实际容器**：#8当前`container-smoke.log`及[PR39 CI](https://github.com/12bitsD/agent4novel/actions/runs/36701963863)验证真实Linux生产镜像和可执行CLI，两章双关卡、配置/Prompt/Skill、pending正文坏例后续改写/通过仍不变，容器重建及停止后整目录恢复逐字一致。本票无可执行文件差异；实际本票对应commit CI仍重新执行。
- **浏览器＋真实进程重启**：合成作品第一章v5→显式起章2→Beat2/Prose2通过→历史第一章v6修改仍approved，第二章id/version/全文/status精确不变且待检查衔接→章2 URL刷新；真正停止并新进程启动，作品/config revision3/两份坏例逐字一致，日志为空且未自动生成。`browser-verification.log`、前后JSON、`browser-two-chapters.png`留存。
- **统一入口**：真实Markdown文件上传保留原始seed，创建作品、提炼稿/创意方向选择、设定及章纲/正文到首章完成；大纲原生window.confirm未能通过浏览器工具确认，该一步使用CLI approve+advance，其余页面结果可观察，不能宣称全浏览器无辅助走通。`entry-verification.log`、`entry-complete-work.json`和`browser-entry-complete.png`证明六kind approved且停在首章；TXT/MD读取与DOCX/PDF adapter路由沿用当前测试，未宣称这次实际浏览器验收全部文件格式。
- **SDK mock**：配置真实进入生产节点的模型/参数/系统文本、文件hash/revision及并发冻结，由production smoke和当前回归证明；mock不证明供应商生成质量。
- **有限真实模型来源**：#6独立Beat2 9.515s、Prose2 33.051s/2164字符，fake首章与合成上游，非生产审批/落库；#7最终候选一次生产Caption配置溯源21.285s、877/772 tokens，合成下游关卡阻止继续。分别见[Wiki006](./006-chapter-continuation.md#测试与验证)、[Wiki007](./007-author-agent-config.md#测试与验证)。本票不新增调用或重标这些历史证据为最终全真链路验收。

三校准：①逐项核对实现/当前回归及真实用户操作，采集及历史修改无副作用；②各票Wiki/schema/词汇/README与来源边界一致，旧审核字节保留；③完整文档候选对应AC1–6及原24条stories，已确认演进明确写出、扩展不夹带、没有虚构质量或CI结论。

### 2026-10-03 清点与复审

**范围**：复审时的 main 为 `1571539b131fb11dea1fbfc5cb6f88e9c8c22815`。本轮逐项核对[决定清单](../research/mvp-delivery-options.md) D01–D20、父票有效 AC1–AC6 与原 24 条用户故事，并分别检查需求、工程规范和对外说明。文档交付由 [#41](https://github.com/12bitsD/agent4novel/issues/41) 和 [Wiki041](./041-readme-mvp-handoff.md) 跟踪；本节不重新认证旧候选的发布前裁决。

**交付**：#1/#6/#19/#9/#33/#7/#8 均已关闭，PR32/34/36/37/38/39/40 均已合并。PR37–40 对应源提交的质量与容器 CI 均成功，[main CI](https://github.com/12bitsD/agent4novel/actions/runs/36727036119) 也成功。PR32/34/36 交付时没有 CI，保留原完成评论中的边界，不能补称当时 CI 成功。#28/#29 及 #12/#15/#17/#18/#20/#21/#35 仍开放，本轮没有改动远端票面。

**当前验证**：`pnpm test` 815 项通过（contracts 119、CLI 182、server 384、Web 130），`pnpm typecheck`、`pnpm build` 均退出 0。保留 DOCX 分块超过 500 KiB 的构建警告。另增定向复现证明下列三项缺陷；现有测试通过不覆盖这些新边界。本轮未重新进行浏览器、容器恢复或真实模型验收，也未新增供应商调用。

| Review 编号 | 严重级别与已复现事实 | 影响与处理状态 |
|---|---|---|
| R1 | P2：配置草稿未保存或配置写入结果未知时，点击“开始下一章”，自动导航卸载配置面板。两种 mounted（实际挂载组件）测试均得到预期失败。入口为 [Workspace](../../apps/web/src/pages/Workspace.tsx) 的 `beginNextChapter` 与 `WorkSession` 按章重建。 | 草稿及冻结的原配置请求从页面丢失，服务端写入未必取消。需要把显式起章及完成后的自动导航纳入配置保护；行为未修复。 |
| R2 | P2：起章初检匹配前章 v1 后，配置快照接缝中由第二 SQLite 连接合法保存 v2，后续输入再次取样消费并提交 v2，原请求仍绑定 v1。入口为 [Pipeline](../../apps/server/src/pipeline/pipeline.ts) 的 `startChapter`、`executeEntry`、`runEntry`。 | 请求的前章版本条件没有保持至实际输入读取及提交。复现是独立连接交错模拟，不宣称证明了单进程 HTTP 的特定异步调度。需重新检查并保持原版本条件；行为未修复。 |
| R3 | P2：静态包装层用 `decodeURIComponent` 校验，底层使用不同解码规则读取。`/assets%2Ffile.txt` 在同时存在安全解码资源和编码名称外链的夹具中返回目录外合成内容。入口为 [static-web](../../apps/server/src/runtime/static-web.ts)。 | 违反发布目录边界。必须统一校验与实际读取的文件路径；行为未修复。触发要求特定编码名称文件/符号链接存在，未证明默认构建能被任意文件读取。 |

**清点结果**：下表只记录已定事项的落实与边界；决定正文继续由 research 维护。

| 决定 | 复审结果与来源 |
|---|---|
| D01 三方案评估 | 已保存在交付研究及各票 research；本次三个行为缺陷的方案结果见下表。 |
| D02 人工参与范围 | 本轮无新产品裁决、权限、费用或不可逆数据动作；普通检查与机械文档修正自主完成。 |
| D03 逐票交付顺序 | #19 → #9 → #33 → #7 → #8 → #1 均有独立交付记录；#6 在其前完成。 |
| D04 本机 Docker + CI | 仍是当前产品范围，未扩大为公网部署。 |
| D05 共享校验边界 | 共享契约、Store 和 HTTP/CLI/Web 边界实现及当前测试均可核查，见 Wiki019。 |
| D06 版本条件与未知写入 | 既有关卡与冻结请求保留；R1 的页面请求保留、R2 的起章版本条件仍需修复。 |
| D07 事务与输入引用 | SQLite 保存全部版本和实际输入，模型调用在事务外，见 Wiki009；R2 指原请求条件，不是引用记录缺失。 |
| D08 真实重启与迁移 | 既有跨进程/容器恢复证据保留，当前重启测试通过；本轮未重新做人工容器恢复。 |
| D09 旧实例与数据保护 | 未停止、迁移或清空原运行实例。旧内存数据不会自动迁入新 SQLite。 |
| D10 容器、凭据与备份 | 同源、本机端口、运行期密钥、整目录恢复已接入；R3 是静态发布目录的新边界缺陷。 |
| D11 无密钥 CI | 固定版本质量/容器工作流已接入，当前 main CI 成功；无镜像发布或自动部署。 |
| D12 作者配置与预览 | 默认/节点覆盖、三维偏好及实际配置预览已实现，见 Wiki007；导航保护存在 R1。 |
| D13 操作配置冻结 | 生成开始时的配置与文件版本快照有代码及测试；R1 不否定服务端冻结，但页面草稿/回执恢复缺失。 |
| D14 受管文件与输出契约 | 文件版本、数据库引用、整目录保全及工程校验已实现；未允许作者指导关闭输出契约。 |
| D15 Skill 文本与预算 | 文件元数据、数量/大小/装配限额可核查；工具、脚本、链接/附件执行仍未启用。 |
| D16 不可变坏例快照 | 保存来源版本/原文/选段/备注，后改正文不改样本，见 Wiki008。 |
| D17 坏例去重及恢复 | 保存基线、冻结请求、原回执去重和导航保护已有测试；不自动分析或持续重定位。 |
| D18 扩展后置 | #28/#29 仍开放；设定库查询、工具循环、正文与档案联合通过及自动 Wiki 更新尚未实现。 |
| D19 验收证据区分 | AC1–AC6 对应原 24 条故事的既有范围保留。AC2/AC3 涉 R1，AC2 涉 R2，AC6 涉 R3；全链路真实模型和长篇质量仍未验证。 |
| D20 完成审核与历史保留 | 逐票发布记录及例外保留。Wiki008 首次 Web-only RED 缺失不追认；本次复审不是新的 C6/发布认证。 |

**方案结果**：三项均为已定行为的缺陷，未产生新产品范围。比较结果用于后续修复设计，本轮未实现。

| 缺陷 | 三种可行处理 | 推荐与验收 |
|---|---|---|
| R1 配置导航 | A 起章及完成导航复用现有脏内容/未知写入保护；B 把配置草稿提升到跨章会话；C 自动保存配置后导航。 | A；改动范围最小且保持显式保存。覆盖起章前、请求处理中新增草稿、未知请求与完成回读，确保未保存或未确认时不自动卸载。B 可作为将来会话设计；C 改变保存语义。 |
| R2 起章版本 | A 将原请求版本条件保持到输入读取与提交；B 生成期间禁止修改前章；C 将新前章自动作为起章基线。 | A；符合已定条件写入和可编辑前章。校验后交错写入须安全拒绝且不保存目标产物，正常及重试仍只处理原目标章。B 限制已有编辑能力，C 违反显式版本条件。 |
| R3 静态边界 | A 校验和读取复用一个规范化文件路径；B 在现有双解码前拒绝保留字符编码；C 每次启动复制已审查静态文件清单。 | A；让实际读取路径通过相同目录/外链检查。保留正常资源、HEAD、API 隔离，编码外链复现须返回安全拒绝。B 可作防御补充，C 增加部署和资源维护。 |

**文档处理**：修正 MVP 状态、过期队列、当前工作流导航、Docker 演示条件及真实样例时点。README 首次解释 MVP、Prompt/Skill，已知问题与双语说明同步。旧意图、用户决定、失败实验及全部完成审核字段保持原文。源代码未改，复现测试已移出工作树。

**证据入口**：本机原始日志、独立 Spec/Standards/输出报告、远端 JSON 及合成复现位于 `/tmp/a4n-review-20261003/`；本节保存可继承的结论和范围。复现不使用模型密钥、真实作品或原服务端口。独立报告发现与修正文档复验仍应按实际结果记录，不把旧 README blob 的结论移用到改后内容。

### 完成审核证据

- **清单与候选**：清单blob42116082e8ca2804d826cc00f6578270077f60eb，固定点 a68fdd39e1a5551ee0eb76f67e146d644279c570，双轴通过的T0 `39a46413b79bf362635def20ae8e8008b7f46b73`，pre-attestation T1 `7d6a4ef88be180ea4e0462500b3cf3ec9742e46b`。精确manifest仅README.md、README.en.md、docs/handoff.md、docs/research/mvp-delivery-options.md、docs/wiki/001-mvp-acceptance.md、docs/wiki/008-bad-example-collection.md、docs/wiki/README.md七份Markdown；attestation时HEAD等于固定点，无中间本地commit、unstaged/untracked余项。
- **逐项判定**：C1 = PASS（C1.1–C1.8）：issue-current/children-status/dependencies/protection/rulesets、固定点/源分支、起始计划及三案研究/用户本机Docker与loop决定；保留12bitsD/ready-for-agent/Project Backlog、native边为空。C2 = PASS（C2.3–C2.6）：矩阵及确定性来源/结构/链接/旧审核保留验证，本票不改接缝或状态机；C2.1/C2.2 N/A（纯文档，无行为变化，不追认历史RED）。C3 = PASS（C3.1–C3.6）：当前full-test/typecheck/build、static-validation、完整diff检查与独立来源复验；质量清理保持现有模块/领域边界，无代码抽象或效率变化，风险及警告如本地门禁。C4 = PASS（C4.1/C4.2/C4.4研究/C4.5/C4.6/C4.8/C4.9）：本页及索引、双语README/handoff/research、旧审核保留、schema/链接校验和三校准；C4.3及C4.4 ADR、C4.7 N/A原因见知识维护。C5 = PASS（C5.1–C5.7）：精确T0/七文件、staged与完整diffcheck、零中间commit历史、安全/余项检查及独立Standards/Spec原始报告；无发现，无实质修复或范围变化。C6.1 N/A（两轴无发现，无行为/文档缺陷需修复）；C6.2 PASS（当前门禁与结构校验，候选只作获准证据收口）；C6.3 PASS（八个预留字段范围内五条实际转录、字段外字节一致）；C6.4 PASS（独立reviewer核对精确T0→T1、完整七文件、历史/余项、原始报告与全部来源/NAs，见发布前裁决）。
- **验收与 TDD**：AC1–6矩阵及原24stories已逐项对应已确认解释，所有必需子票#2/#3/#4/#5/#6/#7/#8/#9/#10/#11/#13/#14/#16/#19/#22/#25/#33在children-status均CLOSED；#28/#29仍OPEN。真实模型、fake/mock、容器、浏览器和工具限制分别如实记录，无新增模型费用；本票纯文档替代验证不豁免功能AC。
- **本地门禁**：2026-09-30 full-test.log815 PASS、full-typecheck/full-build exit0、static-validation.log7文件/100本地链接/Wiki/双语/旧审核字节/凭据扫描PASS。浏览器JSON重启逐字比较与Markdown入口最终六kind/首章停止均PASS，详见browser-verification/entry-verification。独立两轴复验来源和完整候选，`git diff --cached --check`及`git diff --check a68fdd39e1a5551ee0eb76f67e146d644279c570 39a46413b79bf362635def20ae8e8008b7f46b73`均exit0；没有key/临时文件/无关改动，secret/data仍ignored。现有docx>500KiB警告；无独立lint，现有type/build/结构/diff覆盖；没有新联网或日志行为，合成样本及有限真实调用边界保留。
- **双轴 review**：精确T0的Standards与Spec均PASS且相互隔离，reviewer均未参与本候选实现；原始报告为`/tmp/a4n-1-evidence/standards-review.md`和`spec-review.md`，均无actionable finding。独立核对七文档、24 stories/6 AC、815输出、100链接、旧审核及research/issue原始前缀、浏览器JSON/截图和子票/真实CI；Markdown入口按既有outer trim保留正文，原生确认转CLI、fake/mock/实际容器/有限live边界明确。结论仅认证T0，本票未来CI/关闭不预认证。
- **修复与回归**：无review修复，不改变T0实质内容；仅C6.3/C6.5获准预留字段收口。本票不新增RED/GREEN；既有坏例初次Web-only RED缺失继续保留，当前功能及真实修复RED/GREEN见Wiki008。既有815回归/type/build和本票确定性结构/来源验证均通过，受控delta与完整候选由独立attestation再核对。
- **知识维护**：本票Wiki/索引、README中英文、handoff、#8已交付导航及research已同步；旧#8审核byte-identical。C4.3 schema/CONTEXT N/A（无数据/术语变化）；C4.4 ADR N/A（无架构新决定，研究已写）；C4.7运行skill/流程规则N/A（命令/职责/流程不变）；README.zh-CN入口保留，无新增运维步骤。三校准已记录，source链接及双语事实已验证。
- **发布前裁决**：独立非实现reviewer `/root/config_spec_review` 对精确T1给出C6.4 PASS，原始报告`/tmp/a4n-1-evidence/c6-attestation.md`，SHA256 `43f3032a61fe646d093d8afaadc39232355291cceb4a401b43c628808a4a5e93`；来源与全部N/A、旧审核/原始前缀和验证边界忠实，无剩余阻塞。C6.5记录后仍需独立C6.6终止比较、C6.7及对应提交实际CI/PR/合并/评论先于关闭的远端验证；本候选不记录自己的最终tree或整节C6终态。

## 边界与非目标

本机单用户、没有账号/公网部署；上一章承接，无长篇检索/档案/工具循环；Skill只作指导文字，不执行脚本/附件；坏例手工收集及回看。已通过设定/章纲回改、自动Wiki更新/重写后章、自动分析及长篇成书质量仍后置。历史初次Web RED缺失在Wiki008保留，本票不追认；当前功能回归和修复的真实RED/GREEN已有独立证明。

## 上下文演进

### 2026-09-30 — 按既有决定聚合 MVP 工程验收

- **触发证据**：所有必需子票逐票交付，用户要求loop完成MVP且普通gap三案自主收敛。
- **原假设**：父票早期interview/分章大纲/任意层编辑与后来已确认实现存在解释差异，子票局部成功不足以证明完整工程闭环。
- **决定**：保留原始目标，按已确认演进逐项对账；组合可重复fake/真实容器、浏览器及有边界供应商证据，三案理由见research。
- **影响**：增加MVP恢复入口和完整验证矩阵；原票/ADR/实现不回改，扩展保持后置。
- **上下文处理**：preserve原始愿景、人决及各票审核；replace当前里程碑/导航/README能力摘要，验证细节只保存在本页及对应来源。

### 2026-10-03 — 远端交付状态与复审入口收敛

- **触发证据**：用户要求清点所有已对齐点；回读 #1 已关闭、PR40 已合并、对应源提交与 main CI 成功，并复现三项当前行为缺陷。
- **原假设**：发布前文档保留待交付措辞，但当前导航没有区分历史审核与发布后状态，接手者可能重复交付或遗漏新发现。
- **决定**：更新当前路由、交接和复审结果；原始目标、用户裁决、历史验证及全部完成审核字段保持原文。
- **影响**：本轮仅维护文档，生产缺陷未修复；后续先处理复审发现，再对齐 #28/#29。
- **上下文处理**：preserve 原审核与演进依据；replace 当前 ticket_state、交接描述和漂移导航；新增验证事实另记日期，不覆盖旧候选证明。

## 交接结论

#1 已通过 [PR40](https://github.com/12bitsD/agent4novel/pull/40) 合入 main 并关闭，[完成评论](https://github.com/12bitsD/agent4novel/issues/1#issuecomment-5913002048)保存发布记录。本次复审发现三项待修复边界，先按本次记录修复和回归，再另行对齐 #28 工具执行、#29 作品 Wiki 及长篇质量验证。扩展票仍开放，不自动开工或关闭。操作仍以运行 skill 为准。
