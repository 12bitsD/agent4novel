---
wiki_id: "008"
ticket: 8
ticket_state: done
context_state: current
summary: "已保存正文选段、备注、不可变来源快照与按章回看。"
topics: ["bad-examples", "prose-selection", "snapshot", "idempotency"]
code_paths: ["packages/contracts/src/bad-example.ts", "apps/server/src/store/sqlite-store.ts", "apps/server/src/routes/bad-examples.ts", "apps/web/src/pages/ProseReview.tsx", "apps/web/src/pages/BadExamplesPanel.tsx"]
symbols: ["BadExample", "BadExampleRepository", "markBadExample", "bad-examples"]
inherits: ["022", "009", "007"]
changed_by: []
read_when: ["collect-bad-example", "change-prose-selection", "review-sample-snapshot"]
last_context_reviewed: "2026-09-30"
---

# 008 — 正文坏例收集

## Agent Context

- **读取时机**：正文选段/坏例快照、去重或回看。
- **原始目的**：作者手工积累AI味片段，作为后续调整Prompt/Skill的依据；WHAT/AC见[#8](https://github.com/12bitsD/agent4novel/issues/8)。
- **实际落地**：阅读/编辑正文原生选段、可选备注、按章分页回看已接线；SQLite v3严格迁移、UUID事务去重和来源hash核对保护不可变快照。CLI/API独立可用，Web未知写入保留原请求；整仓、浏览器及容器恢复联验通过。[PR39](https://github.com/12bitsD/agent4novel/pull/39)已合并、#8已关闭，[对应CI](https://github.com/12bitsD/agent4novel/actions/runs/36701963863)两job成功；本页原审核记录保留。
- **当前价值**：继承已保存正文baseline、SQLite全部版本和保守unknown恢复；坏例不改正文状态。
- **后续变化**：自动分析、重定位、Wiki联动后置；最终MVP联验在#1。
- **代码入口**：共享坏例契约、独立Repository/SQLite、HTTP/CLI、正文选段与回看面板。

## 设计目的

从正文直接选段、可选备注并保存；后来改写仍能看到当时原文及来源版本，避免将历史样本误认为当前正文。

## 起始上下文

固定点`23b958cb9e6e1da43d12cfd44784b98409b1ebfa`，干净managed worktree，source `codex/8-bad-examples` → PR → main → merge/close，用户loop授权持续。#7由PR38合并关闭，两项实际CI通过；#8原生blocker #22 CLOSED，claim12bitsD。标签ready-for-agent/Project Backlog/native边保留；无分支保护，quality/container实际成功是交付条件。

## 技术方案

票内三案及TDD切片见[研究](../research/bad-example-options.md)。选段绑定artifact ID/version、完整正文SHA256和UTF-16起止位置；正文同版通过可能改内容，hash保护实际来源。独立坏例Repository使用SQLite v3新增表，不改变WorkStore或旧作品形状。样本不可变、请求UUID去重；历史回执优先，不因后来正文修改而失败。每页50、直接按ID对账，无自动重发。Web既有正文读取/编辑保持，未保存/未知先确认。

## 代码落点

- `packages/contracts/src/bad-example.ts`：请求、回执、分页与身份比较；UTF-16位置、完整Unicode、大小预算。
- `apps/server/src/bad-examples/repository.ts`、`store/sqlite-store.ts`、`store/sqlite-schema.ts`：独立Repository、v3迁移、原子去重、历史来源及分页校验。
- `apps/server/src/routes/bad-examples.ts`、`runtime/production-app.ts`：生产HTTP接线及安全错误，不经过Pipeline。
- `apps/cli/src/{client,command-line,main}.ts`：mark-bad-example、bad-examples、bad-example；无基线替换或自动POST重试。
- `apps/web/src/pages/{ProseReview,BadExamplesPanel,Workspace}.tsx`：原生阅读/编辑选段、可选备注、不可变回看、未知对账与导航保护。
- `scripts/container-smoke.mjs`：真实CLI→容器→SQLite的两章、配置/文件、坏例、重建和整目录恢复联验。

## 测试与验证

证据目录`/tmp/a4n-8-evidence/`保存原始命令输出，不作为产品依赖。以下结果均为2026-09-30当前实现；测试数量只记录本次执行，不是规范。

| AC | 代码与验证 |
|---|---|
| AC1 | ProseReview原生预览/textarea选段；Web定向测试、实际浏览器两模式标记。无LLM调用。 |
| AC2 | 共享契约和SQLite核对全部来源字段；server测试覆盖完整emoji、重复位置、跨资源、同版finalize内容变化、错误零写入。 |
| AC3 | SQLite立即事务与UUID回执优先；重复、不同内容冲突、后来新版本、同版通过、重启测试。 |
| AC4 | Repository/HTTP/CLI/Web分页50及直接ID读取；边界/无效游标/畸形回执覆盖，浏览器刷新后回看。 |
| AC5 | 未保存正文禁止标记；Web冻结unknown请求，4xx不能抹掉先前未知结果，匹配GET解除；CLI不自动POST。坏例dirty时禁止起章，起章/正文操作等待时不允许新建备注；定向及完整工作区回归。 |
| AC6 | v1/v2→v3严格迁移与完整当前门禁；实际容器重建/停止整目录备份恢复坏例、配置与文件。实际远端CI仍待C7。 |

TDD实际RED：`contracts-red.log`缺少目标validator、`server-http-red.log`有效mark得到404而非200、`cli-red.log`命令未识别。对应GREEN为`contracts-green.log`、`server-green.log`、`cli-green.log`及typecheck。初次`web-red.log`实际是1项PASS/2项过滤，并无保留的Web前置失败证据，不将其当作RED；原日志保留。独立review暴露起章丢失未提交采集，新增完整Workspace的selection-only/note-only测试在`review-navigation-red.log`中实际2 FAIL，修复后`review-navigation-green.log`全Web129 PASS；清除采集后恢复起章。夹具/类型修复不冒充行为RED，过滤项不是验收豁免。

等待窗口修复也有单独真实RED：`review-inflight-red.log`的延迟start测试发现备注未disabled，`review-inflight-green.log`全Web130 PASS。完整门禁：最终修复后`pnpm test`在`full-test-reviewed2.log`中815 PASS（contracts119/server384/CLI182/Web130）；`pnpm typecheck`、`pnpm build`分别见`full-typecheck-reviewed2.log`、`full-build-reviewed2.log`。此前同一后端/CLI的`node scripts/production-smoke.mjs`本地SDK mock见`production-smoke-final.log`，`node scripts/container-smoke.mjs`见`container-smoke.log`，均exit0；导航修复未改变对应服务/存储行为。现有docx bundle >500KiB警告保留。#8没有新增供应商调用；fake、mock、浏览器和容器证据各自只证明其验证面。

实际浏览器已通过：approved正文v4含emoji选段与备注→保存坏例→正文改为v5仍approved→旧坏例原文/备注/v4不变→阅读模式选段再标记v5无备注→reload回看两份。`browser-final.png`、`browser-bad-final.json`、`browser-work-final.json`为合成验收材料；没有使用用户书架。

三轮自校准：①代码↔测试：核对请求预算、完整hash/UTF-16、同版通过/历史回执、分页、unknown保护，GREEN和两种浏览器选段一致；②代码↔知识：schema v3、双语README、运行skill、前置Wiki与容器恢复导航同步，旧完成审核证据保留；③完整候选↔AC：全部六项有验证映射，自动分析、重定位、LLM/Wiki联动不夹带。静态校验与独立review另见下方预留字段。

### 完成审核证据

- **清单与候选**：清单blob42116082e8ca2804d826cc00f6578270077f60eb，固定点23b958cb9e6e1da43d12cfd44784b98409b1ebfa，T0 `647c8915ac0a946ade7e8741fdf51c5a23805183`，T1 `2f7372316bdbaee948ae8093f350b6c1e26c7045`。精确manifest `staged-manifest.txt`共36文件；HEAD等于固定点，无中间commit或工作区余项。
- **逐项判定**：C1.1–C1.8 PASS：issue-current.json/dependencies.json/protection.json/rulesets.json、起始上下文、三案研究和用户loop授权；保留assignee/ready-for-agent/Project Backlog及#22边。C2.1–C2.5 PASS：实际契约/HTTP/CLI与Web两轮修复RED/GREEN、AC映射、独立Repository及现有请求/导航接缝；C2.6 N/A（有行为RED，不使用替代豁免）。初始Web前置RED未保留，不能追认；局限如实保留且新增缺陷已有真实RED。C3.1–C3.6 PASS：最终815/typecheck/build、静态及安全/完整patch审计、下方预算与清理结论。C4.1–C4.9 PASS：知识回写、200本地链接及schema/索引/双语/旧审核字节校验、上文三校准；其中不受影响来源逐项N/A见知识维护。C5.1–C5.7 PASS：精确T0/36文件、完整base→tree及staged diffcheck、零本地历史、独立双轴原始发现保留并接受修复，最终同树均PASS。C6.1/C6.2 PASS：两次真实导航RED→GREEN、证据与schema修正，受影响全门禁及两轴复审；C6.3 PASS：仅本预留字段忠实转录。C6.4 PASS (independent c6-attestation.md, exact T0-to-T1/full candidate/history/remainder/source mapping)。
- **验收与 TDD**：六项AC映射及实际RED/GREEN见上文；两个原始Spec FAIL及Standards原始发现保存，最终AC全部候选内满足；远端对应commit quality/container CI仍待C7，不能以本地门禁代替。初始Web日志实际1PASS/2过滤，不声称缺失的先RED序列。
- **本地门禁**：2026-09-30最终`full-test-reviewed2.log`815 PASS、`full-typecheck-reviewed2.log`及`full-build-reviewed2.log`exit0；同一后端/CLI的`production-smoke-final.log` SDK mock及`container-smoke.log`实际容器重建/整个目录恢复PASS。`static-validation-reviewed.log`36文件/200链接/Wiki schema/双语事实/workflow/凭据扫描PASS；四个旧审核片段byte-identical。`node --check scripts/container-smoke.mjs`、staged与base→T0 diffcheck PASS；仓库无独立lint脚本，按现有静态门禁替代，不冒充运行lint。`.env.local`继续ignored；无secret、symlink、原始prompt/provider日志、新意外联网或未保护输入。清理：复用共享validator和请求边界，独立Repository职责清楚，立即事务/固定分页预算，未增加票外框架。docx >500KiB既有警告保留。
- **双轴 review**：非实现者 `/root/config_standards_review` 与 `/root/config_spec_review`分别隔离核对完整T0，`standards-review-fixed-final.md`、`spec-review-fixed-final.md`均PASS。原始报告保留；起章前dirty及等待中新备注丢失、WebRED转录和schema摘要均已修复。reviewer亲跑3项Workspace、延迟请求复现及contracts/CLI/server/Web定向验证；不将C5结论当作C6/CI完成。
- **修复与回归**：接受全部阻塞：起章按钮/handler检查采集dirty，canMark=false时备注不可写；`review-navigation-red.log`2FAIL→全Web129GREEN，`review-inflight-red.log`1FAIL→全Web130GREEN，最终全815。纠正初次WebPASS的错误RED描述及schema v3摘要，原日志/历史报告保留；最终实质树两轴重新审，无剩余实现/Spec阻塞。
- **知识维护**：更新Wiki008/007/009/022/033/索引、schema v3、三案research、双语README、handoff和运行skill。C4.3 CONTEXT N/A（沿用既有坏例术语）；C4.4 ADR N/A（按ADR0002/0003增量持久化，无跨票不可逆新决定）；C4.7流程规则N/A（职责与交付门禁不变）；README.zh-CN导航入口不变。200链接/schema/索引/双语事实及四份旧票审核byte-identical已验证。fake/mock/浏览器/容器范围分别记录，不扩大为真实模型或文学质量验收。
- **发布前裁决**：独立非实现者 `/root/config_spec_review` 对精确T1给出C6.4 PASS，`c6-attestation.md` SHA256 `0b1a5e396dfb9b1fb24661165a319ae2eb8bb4517e7956a481e22116486db8a0`。核对清单blob、固定点、完整36文件/1543行diff、零历史及工作区余项、8预留字段外字节一致、来源/AC/TDD/815门禁/隔离双轴/NAs与四份旧审核byte-identical；C1–C5分节PASS，C6.1–C6.4逐项PASS。初次Web-only前置RED无保留证据仍不追认，已有最终回归和独立行为复现，无残留功能阻塞。本次C6.5仅一次填T1及裁决，不记录自树哈希或提前宣称整节C6；C6.6终止比较、C6.7 manifest及实际CI/合并关闭仍待执行。

## 边界与非目标

手动收集、可选备注与回看，不调用模型或自动分析；快照不随正文后改变更，不做当前高亮重定位。全部输入有预算；正文保存/关卡/配置语义不变。

## 上下文演进

### 2026-09-30 — 继承三案决定启动

- **触发证据**：#7实际CI通过合并，作者授权逐票loop及自主三案收敛。
- **原假设**：已有正文/持久化，但没有采集入口；同ID/version不总表示相同pending文本。
- **决定**：不可变原文快照、来源hash、独立短事务和显式未知恢复；理由见研究。
- **影响**：共享契约、迁移、CLI/Web/HTTP及容器恢复验证。
- **上下文处理**：preserve D16/D17与原始目标；replace本票计划入口，尚不宣称实现通过。

### 2026-09-30 — 独立评审修复起章采集丢失

- **触发证据**：独立完整Workspace复现dirty采集仍可起章，无确认切页；原Web初次日志也证明它是GREEN而非此前误写的RED。
- **原假设**：已有目录导航dirty保护可覆盖所有切章入口。
- **决定**：起章按钮与handler增加坏例dirty守卫，selection-only/note-only真实RED→GREEN；复审还暴露等待期间可填新备注，另以延迟响应RED→GREEN修复，不能采集时备注禁用。两项三案见research；纠正测试转录并保留原输出。
- **影响**：采集完成/清除后可继续起章，unknown保护保持。当前整仓门禁重新执行。
- **上下文处理**：preserve原目的、决定与原始评审/日志；replace当前保护说明及错误证据描述，不声称最初Web前置失败已获证明。

## 交接结论

本票由PR39合并关闭，完整完成评论及终态核对live #8；原发布前审核证据逐字保留。整体验收从[Wiki001](./001-mvp-acceptance.md)进入；三方案及所有已对齐点见[总决定清单](../research/mvp-delivery-options.md)。没有新的Human待对齐点。
