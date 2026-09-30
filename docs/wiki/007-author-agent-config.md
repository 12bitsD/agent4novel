---
wiki_id: "007"
ticket: 7
ticket_state: active
context_state: current
summary: "作品默认与节点覆盖、版本文件和一次操作配置快照。"
topics: ["author-config", "prompt-files", "skills", "configuration-snapshot"]
code_paths: ["apps/server/src/runtime/production-app.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/store/sqlite-store.ts", "apps/web/src/pages/Workspace.tsx", "apps/cli/src/main.ts"]
symbols: ["AgentConfig", "Pipeline", "SqliteStore"]
inherits: ["016", "009", "033"]
changed_by: []
read_when: ["configure-author-agent", "upload-skill", "freeze-generation-config"]
last_context_reviewed: "2026-09-30"
---

# 007 — 作者 Agent 配置

## Agent Context

- **读取时机**：修改作品配置、Prompt/Skill上传和生成快照。
- **原始目的**：[#7](https://github.com/12bitsD/agent4novel/issues/7)让作者的三维偏好与节点配置真正进入生成。
- **实际落地**：六节点默认/覆盖、三维偏好、受管Prompt/Skill版本、SQLite配置CAS、HTTP/CLI/Web及操作快照已接线；fake、SDK本地mock、浏览器、一次真实Caption和整目录容器恢复已验证。最终交付状态看live issue/PR/CI。
- **当前价值**：继承[决定D12–D15](../research/mvp-delivery-options.md)及[三案研究](../research/author-config-options.md)。
- **后续变化**：工具执行与作品Wiki仍留#28/#29；本票不回改已有内容。
- **代码入口**：生产装配、Pipeline、SQLite、Workspace和CLI。

## 设计目的

三维偏好、每步实际配置和Skill文件选择可见可验证；一次操作冻结配置，不混用运行期间的改动。

## 起始上下文

固定点94054a1a577f2222973939415b6968d3d5eca79f；干净分支codex/7-agent-config，PR→main→merge模式，用户已授权逐票loop。无保护/ruleset；#33已合并关闭、原#5依赖CLOSED保留。本票claim12bitsD，ready-for-agent和Project Backlog完成时保持，无联动。C1证据在/tmp/a4n-7-evidence。

## 技术方案

方案与明确边界见[三案研究](../research/author-config-options.md)。数据库保留配置revision/元数据/文件引用；文本在受管版本SKILL.md文件。默认字段继承，节点覆盖；数组替换，null清Prompt默认。save expectedRevision与冻结requestId，文件先落地后引用。一次可执行生成操作读取全部实际配置与文本快照；同次所有step固定。输出契约仍由工程保证。

### 实施计划与TDD切片

1. 共享配置契约、HTTP保存/预览、CAS/去重、SQLite版本与旧内容不变。
2. 有界Skill/Prompt文件、跨作品/损坏/元数据校验、重启和文件引用。
3. Pipeline生成/再生冻结、fake接收实际配置、SDK mock及安全溯源。
4. CLI读写与严格语法、未知结果保留；前端偏好/高级/上传选择、正文编辑隔离和浏览器验收。
5. 真实一次调用与容器完整目录恢复，知识同步、三校准、独立双轴与有限attestation、实际CI后合并关闭。

每片真实RED→最小GREEN/typecheck，形成完整候选后审核；不为未知写入自动重放、不让工具伪装启用。

## 代码落点

- [author-config契约](../../packages/contracts/src/author-config.ts)：严格请求、不可变回执、六步实际配置和元数据关联、共享Prompt封装及限额。
- [AuthorConfigService](../../apps/server/src/config/author-config-service.ts)、[独立Repository](../../apps/server/src/config/author-config-repository.ts)：安全解析、受管版本文件、预算、默认/覆盖、解析快照；不扩WorkStore业务接口。
- [SQLite](../../apps/server/src/store/sqlite-store.ts)、[schema](../../apps/server/src/store/sqlite-schema.ts)：v1精确验证后迁移v2，配置revision/CAS/requestId去重与文件元数据。
- [HTTP](../../apps/server/src/routes/author-config.ts)、[生产装配](../../apps/server/src/runtime/production-app.ts)、[Pipeline](../../apps/server/src/pipeline/pipeline.ts)：配置API及全部生产生成路径快照；临时内存夹具仍兼容。
- [callLlm](../../apps/server/src/steps/llm-call.ts)、六个RealStep：内置任务指导＋作者指导，保留输出校验与安全配置溯源。
- [CLI](../../apps/cli/src/main.ts)、[client](../../apps/cli/src/client.ts)、[严格文件读取](../../apps/cli/src/request-file.ts)：配置读写、文件上传/读取；帮助零I/O，冻结请求无自动重发。
- [AuthorConfigPanel](../../apps/web/src/pages/AuthorConfigPanel.tsx)、[Workspace](../../apps/web/src/pages/Workspace.tsx)：正文旁配置、默认/每步覆盖、上传/选择/实际预览，dirty/unknown保护及不卸载正文。
- [生产mock](../../scripts/production-smoke.mjs)、[容器联验](../../scripts/container-smoke.mjs)：实际编译产物配置注入和整个数据目录恢复。

## 测试与验证

2026-09-30，证据目录 `/tmp/a4n-7-evidence`。测试不会读取开发者凭据；mock/fake与真实调用分别记录。

| AC | 实现与可重复验证 |
|---|---|
| 1 偏好/六步配置 | author-config契约、Service、Panel；author-guidance测试及SDK mock核对实际system/model/参数/节点偏好 |
| 2 条件写入/旧内容 | author-config测试两连接CAS、旧请求在新版本后回执、相同ID异内容、旧Work/Artifact逐字段不变；Web未知原请求精确重试 |
| 3 版本文件/安全预算 | author-config测试合法Skill/Prompt重启、跨作品/篡改/alias/重复key/大小/UTF8/HTTP限额/symlink/48K系统预算；零模型telemetry与零产物 |
| 4 操作快照 | author-config-pipeline暂停Caption后改配置/篡改文件，Creative仍用原revision/原文，下一操作读新配置或安全拒绝；start/regenerate沿同一解析入口，既有续章/再生回归保留 |
| 5 实际溯源 | production-smoke本地SDK transport恰两节点，证明模型/参数/系统文本及revision/完整文件hash，日志不含指导/密钥；live-result单次生产Caption见下方边界 |
| 6 CLI/Web | CLI命令发现/严格flag/未知500/错误hash回执；真实CLI上传保存后生成。Web配置测试保存不生成、unknown冻结及成功回执后失败回读；浏览器保存偏好、Prompt/Skill、默认0.2/正文0.7、版本文件回看，正文v3仍approved且全文不变 |
| 7 迁移/恢复/知识 | v1迁移不改旧内容；container-smoke无key两章＋配置/Prompt/Skill，容器重建和完整停机目录归档恢复逐项匹配；实际远端CI在发布后回读，不以本地结果替代 |

RED→GREEN：config-red→config-files-green（公开入口/文件）；snapshot-guidance-red→snapshot-guidance-green（同操作配置与实际SP）；file-symlink-red→file-symlink-green（先校验再建目录）；config-boundaries→config-boundaries-green（真实HTTP预算）；cli-red→cli-green、cli-response-red→cli-response-green（发现/未知/完整hash）；web-red→web-green、web-readback-red→web-readback-green（配置保存/冻结回读）；response-association-red→response-association-green（文件/模型关联）。isolated SP已有400K预算保留，托管作者系统文本单独48K；system-budget-regression-green证明没有把旧独立运行改成新限额。

本地最终门禁为`pnpm test`、`pnpm typecheck`、`pnpm build`；完整输出full-test-final/full-typecheck-final/full-build-final，测试777项通过（仅本次证据，非规范数量）。编译本地SDK mock、container-smoke-final通过；既有docx chunk>500KB构建提示保留。结构/链接/双语事实/旧审核字段和凭据扫描见docs-validation。无独立lint/format脚本，使用typecheck、node --check、完整diff --check。

真实模型证据：LongCat-2.0单次生产Caption操作，合成预置Creative关卡阻止继续真实生成；ok、15.856秒、877/528 tokens，配置revision1/文件ID/fullhash、实际systemHash独立核对，安全日志不含原文/密钥。`live-result.json`及live-proof-current.log；不宣称六步真实贯通、单次远端HTTP（SDK可能内部重试）、长篇或文学质量已验收。

三轮自校准：①代码↔行为，默认/覆盖、同操作冻结、合法与异常写入、迁移/文件损坏/整个目录恢复一致；②代码↔最终知识，schema定义v2与文件发布、016保留provider HOW、README双语说明保存/指导文本，旧009/033审核字节不变；③完整候选↔AC1–7，全部有入口与本票证据，无工具/公网/Wiki扩票，实际CI保留C7。质量清理：复用公共契约、ModelRuntime、Pipeline操作入口和CLI有界读取；配置Repository与内容WorkStore分责，无第二关卡状态机；文件库/装配预算有界，日志只记安全标识。

### 完成审核证据

- **清单与候选**：清单blob42116082e8ca2804d826cc00f6578270077f60eb；固定点94054a1a577f2222973939415b6968d3d5eca79f；T0 83b5a7f962302361a862daaac0927f08c780fe8e；T1 207788c7e902f7c6d0a5fb8a2a241b6e019d55c7；49文件manifest.txt与完整candidate.patch，零本地中间提交。
- **逐项判定**：C1.1–C1.8 PASS：issue-baseline/issue-current、dependencies/protection/rulesets、分支固定点、版本化计划和三案研究、用户D12–D15及loop授权；claim12bitsD，标签/Project/native依赖按起始值保持。C2.1–C2.5 PASS：上方AC映射、真实RED/GREEN、跨包/失败/条件写入和深模块边界；C2.6 N/A（有可执行行为，已TDD）。C3.1–C3.6 PASS：完整门禁、mock/容器/真实安全溯源、docs-validation和diff；无跳过。C4.1–C4.3/C4.5–C4.9 PASS：知识更新/结构检查与三轮自校准；C4.4研究已更新，ADR N/A（遵循0002/0003，未新增不可逆决定）。C5.1–C5.7 PASS：candidate.json/manifest/candidate.patch/local-history与standards-review-fixed/spec-review-fixed，两轴对T0独立PASS，原FAIL保留。C6.1/C6.2 PASS：三个真实review RED到GREEN、当前完整门禁和双轴复审；C6.3 PASS：预留字段忠实转录；C6.4 PASS：独立c6-attestation.md精确比较T0→T1、完整49文件/零历史/余项/证据映射。
- **验收与 TDD**：[#7](https://github.com/12bitsD/agent4novel/issues/7) AC1–7逐项映射见上表；RED/GREEN原日志均保留，不把夹具或类型错误当行为RED。
- **本地门禁**：2026-09-30，`pnpm test`777 PASS、`pnpm typecheck` PASS、`pnpm build` PASS，编译SDK mock/容器重建及整目录恢复PASS；当前T0的真实一次Caption配置溯源PASS（live-result-candidate/live-proof-candidate，21.285秒、877/772 tokens），边界仍限一次生产Caption操作与合成下游关卡，未声称完整真实链路或文学质量。docx>500KB既有警告，无安全输入/密钥/原文日志泄露；结构/210本地链接/双语事实/旧审核字段字节/凭据扫描PASS，无独立lint格式脚本。
- **双轴 review**：原候选a49953bbea139b172af0d0705fa71a22952a0cd0的Standards/Spec均FAIL；原报告standards-review/spec-review保留。三项P2（不可变回执先于当前文件验证、旧unknown遇后次4xx保留、legacy仅revision0）及handoff漂移均接受并修复；新T0两轴独立PASS（standards-review-fixed/spec-review-fixed），reviewer未参与实现，各自复现修复，未发现剩余阻塞。
- **修复与回归**：发布前实现修复包括symlink/HTTP预算/托管与独立预算隔离/客户端关联/hash/成功回执后回读失败保护，各RED及当前GREEN见上文；正式review发现已补receipt-replay-red/legacy-source-red/earlier-unknown-red，修复到receipt-legacy-green/earlier-unknown-green并重跑完整门禁；旧报告不改写，standards-idempotence-fixed/standards-web-unknown-fixed/spec-legacy-repro-fixed与独立定向18 server/4 Web GREEN支持新T0复审PASS。
- **知识维护**：本票Wiki/research、schema v2与配置契约、双语README、handoff、运行skill、索引及009/016/033演进已更新；CONTEXT N/A（使用已有Agent配置等术语）、ADR N/A（遵循既有文件归属和发布物决定）。旧完成审核区保持字节一致。
- **发布前裁决**：独立 reviewer `/root/config_spec_review` 在c6-attestation.md（SHA256 69a6f6bf979cfd964ad7b946993e3f067b2d1ae31caa5e767b86bd16ab540e90）对上述清单blob、固定点及T0→T1给出C6.4 PASS：仅预留字段转录，完整49文件、零中间提交、工作区、安全、旧审核区、原始门禁与双轴来源相符。C1–C5分节PASS，C6.1–C6.4逐项PASS，全部N/A及边界见上文；新docs/agents规则N/A（流程与知识归属未改），运行skill已更新。本次C6.5仅一次填入T1及此独立裁决；C6.6终止核验、C6.7精确manifest及对应提交的实际CI仍待发布流程，不提前声称整节C6或ticket完成。剩余风险限本机单用户、仅文本Skill、未启用工具与完整真实链路/文学质量未验收。

## 边界与非目标

本机单用户，文件文本仅提示用途；不执行脚本/工具、不联网展开附件、不做跨作品共享库，不回改已生成内容或通过状态。凭据/Base URL/运行方式继续由Wiki016和Wiki033持有。

## 上下文演进

### 2026-09-30 — 三案收敛后启动

- **触发证据**：用户确认MVP loop与Agent自主三案评估，#33实际CI通过合并。
- **原假设**：旧AgentConfig字段尚未形成作品可编辑入口，SP不消费作品配置。
- **决定**：采用默认/覆盖/操作快照及受管文件，理由见research。
- **影响**：SQL迁移、HTTP/CLI/UI/生成装配与遥测，本票逐项验证。
- **上下文处理**：preserve旧provider与文件归属；replace本票计划状态，历史不改写。

### 2026-09-30 — 验证暴露的发布与回读边界

- **触发证据**：symlink RED、HTTP超限RED、畸形200文件/模型关联RED，以及写成功后GET失败却解冻的Web RED。
- **原假设**：递归mkdir、通配body middleware、shape校验和仅按最后HTTP状态处理足够。
- **决定**：逐层目录验证、精确路由预算、完整hash/元数据/模型关联校验；写被接受后回读失败仍保留原冻结请求。文件发布采用exclusive hardlink，三案理由见research。
- **影响**：失败零模型/零新产物，不覆盖不可变版本；成功回执与随后失败读取不会被误判成未写入。
- **上下文处理**：preserve失败证据和原产品选择；replace实现事实，不追认旧候选成功。

### 2026-09-30 — 独立审核收敛幂等回执与单一配置来源

- **触发证据**：Standards独立复现已提交后文件损坏导致原请求404，以及先前unknown被后次404清除；Spec独立复现revision1继续继承旧配置和handoff旧声明。
- **原假设**：当前可执行性可以在幂等回执之前重验，最后错误即可决定请求状态；兼容合并不会形成隐藏来源。
- **决定**：先匹配不可变历史回执，再验证新写入；保留更早unknown；旧Work.config仅revision0，保存后唯一作者来源；三案比较见research。
- **影响**：新增行为RED/GREEN，双轴对新tree重新裁决，配置生成安全验证仍保留。
- **上下文处理**：preserve原失败报告/复现，replace当前代码与handoff事实，不继承失败候选的通过结论。

## 交接结论

本票本地能力已验证，独立双轴/有限attestation和对应commit远端CI通过后才合并关闭；终止状态看live issue。下一票#8坏例，最后#1 MVP联验。SQLite/Prompt文件一同保全，不降级旧程序或只恢复数据库；工具/Wiki扩展仍未接入。
