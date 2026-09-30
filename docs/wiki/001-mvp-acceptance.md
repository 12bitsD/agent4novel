---
wiki_id: "001"
ticket: 1
ticket_state: active
context_state: current
summary: "本机单用户MVP工程验收、证据边界及后续拓展入口。"
topics: ["mvp-acceptance", "local-single-user", "delivery", "verification"]
code_paths: ["scripts/container-smoke.mjs", "scripts/production-smoke.mjs", "apps/server/test/sqlite-restart.test.ts", "apps/web/src/pages/Workspace.tsx"]
symbols: ["createApp", "WorkView", "BadExample", "AuthorConfigView"]
inherits: ["006", "007", "008", "033"]
changed_by: []
read_when: ["resume-mvp", "review-mvp-acceptance", "plan-post-mvp"]
last_context_reviewed: "2026-09-30"
---

# 001 — 本机单用户 MVP 工程验收

## Agent Context

- **读取时机**：恢复当前MVP、区分已交付能力与扩展、核对整体验收。
- **原始目的**：让作者从脑洞逐章创作并把关；原目标和当前有效解释见[#1](https://github.com/12bitsD/agent4novel/issues/1)。保留长期完本愿景。
- **实际落地**：必需子票已逐票合并关闭；本机Docker、六节点/逐章双关卡、章节阅读及正文编辑、配置/文件、SQLite、手工坏例均已接线。当前完整回归及CLI/容器/浏览器/真实进程重启验收见下文；发布终态以live issue/PR/CI为准。
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

当前可执行实现来自#8最终候选，本票不改代码。2026-09-30重新执行`pnpm test`815 PASS（contracts119/CLI182/server384/Web130）、`pnpm typecheck`及`pnpm build`均exit0，原始日志在`/tmp/a4n-1-evidence/`。静态校验7份文档、100个本地链接、Wiki schema/索引/双语事实/旧审核byte-identical/凭据扫描PASS；无独立lint脚本，执行现有类型/构建/结构和diff检查。保留既有docx >500KiB构建警告；本票对应commit远端CI仍待发布。

- **CLI/实际容器**：#8当前`container-smoke.log`及[PR39 CI](https://github.com/12bitsD/agent4novel/actions/runs/36701963863)验证真实Linux生产镜像和可执行CLI，两章双关卡、配置/Prompt/Skill、pending正文坏例后续改写/通过仍不变，容器重建及停止后整目录恢复逐字一致。本票无可执行文件差异；实际本票对应commit CI仍重新执行。
- **浏览器＋真实进程重启**：合成作品第一章v5→显式起章2→Beat2/Prose2通过→历史第一章v6修改仍approved，第二章id/version/全文/status精确不变且待检查衔接→章2 URL刷新；真正停止并新进程启动，作品/config revision3/两份坏例逐字一致，日志为空且未自动生成。`browser-verification.log`、前后JSON、`browser-two-chapters.png`留存。
- **统一入口**：真实Markdown文件上传保留原始seed，创建作品、提炼稿/创意方向选择、设定及章纲/正文到首章完成；大纲原生window.confirm未能通过浏览器工具确认，该一步使用CLI approve+advance，其余页面结果可观察，不能宣称全浏览器无辅助走通。`entry-verification.log`、`entry-complete-work.json`和`browser-entry-complete.png`证明六kind approved且停在首章；TXT/MD读取与DOCX/PDF adapter路由沿用当前测试，未宣称这次实际浏览器验收全部文件格式。
- **SDK mock**：配置真实进入生产节点的模型/参数/系统文本、文件hash/revision及并发冻结，由production smoke和当前回归证明；mock不证明供应商生成质量。
- **有限真实模型来源**：#6独立Beat2 9.515s、Prose2 33.051s/2164字符，fake首章与合成上游，非生产审批/落库；#7最终候选一次生产Caption配置溯源21.285s、877/772 tokens，合成下游关卡阻止继续。分别见[Wiki006](./006-chapter-continuation.md#测试与验证)、[Wiki007](./007-author-agent-config.md#测试与验证)。本票不新增调用或重标这些历史证据为最终全真链路验收。

三校准：①逐项核对实现/当前回归及真实用户操作，采集及历史修改无副作用；②各票Wiki/schema/词汇/README与来源边界一致，旧审核字节保留；③完整文档候选对应AC1–6及原24条stories，已确认演进明确写出、扩展不夹带、没有虚构质量或CI结论。

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

## 交接结论

当前已具备本机工程MVP闭环，本票审核/实际CI/合并关闭尚待交付阶段；终态以live #1为准。下一阶段先另行对齐#28工具执行和#29作品Wiki，再评估长期质量与其他优化，不自动开展或关闭扩展票。恢复先读本页、D01–D20和对应Wiki；操作仍以运行skill为准。
