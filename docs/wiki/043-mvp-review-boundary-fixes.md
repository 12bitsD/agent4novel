---
wiki_id: "043"
ticket: 43
ticket_state: active
context_state: current
summary: "修复配置自动切章、起章前章版本与静态文件规范路径边界"
topics: ["chapter-navigation", "conditional-write", "static-files", "review-fixes"]
code_paths: ["apps/web/src/pages/Workspace.tsx", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/runtime/static-web.ts"]
symbols: ["WorkSession", "startChapter", "runEntry", "staticWeb"]
inherits: ["001", "006", "007", "033", "041"]
changed_by: []
read_when: ["debug-config-navigation", "review-start-baseline", "review-static-web-boundary"]
last_context_reviewed: "2026-10-03"
---

# 043 — MVP 复审边界修复

## Agent Context

- **读取时机**：检查配置与自动切章、续章版本条件、静态文件路径边界。
- **原始目的**：[票面 #43](https://github.com/12bitsD/agent4novel/issues/43) 修复 [Wiki001 复审](./001-mvp-acceptance.md#2026-10-03-清点与复审) 的三项 P2，不扩大 MVP 产品范围。
- **实际落地**：配置导航复用最新 dirty/locked 保护；起章原条件保持至实际输入与提交；静态资源只解码一次并从已校验规范路径读取。每项取得有效红绿，完整门禁及正式审核见下方证据。
- **当前价值**：保持显式保存、原请求版本条件及静态发布目录，保留原复现和历史审核。
- **后续变化**：文档已通过 PR42 合入 main；用户要求随后修复并推送，修复 PR 先保持开放。
- **代码入口**：Workspace、Pipeline 与 staticWeb；测试从组件挂载、Pipeline/HTTP/SqliteStore 和 Hono HTTP 三个公共接口验证。

## 设计目的

三项都修复已确定行为，没有新产品裁决：配置草稿/未知请求不因自动导航丢失；起章使用原请求绑定的前章；仅发布经目录校验的同一个静态文件。

## 起始上下文

固定点 `533631cdc28b1c09282845cdfcb6646cc8adbacf`，文档 PR42 已合并，源提交 quality/container CI 成功。新 source `codex/43-mvp-review-fixes` → PR → main，本次先推送并验证 PR；合并和闭票待后续，不能提前宣布 main 已修复。原用户 checkout、8787/5173 及数据不改动。

#43 无评论、无原生 blocker、assignee 12bitsD、ready-for-agent、未加入 Project；保持这些字段。main 无保护，rulesets 为空；实际提交 quality/container CI 仍须回读。

计划与提交边界：R1 组件导航首项测试 RED→最小保护 GREEN→异步完成/未知回读相邻路径；R2 双 SQLite 连接交错 RED→保持原基线 GREEN→正常/replay/生成中修改回归；R3 编码外链 HTTP RED→规范路径 GREEN→合法编码/HEAD/MIME/API 回归。三个逻辑修复提交，各片定向测试与类型通过后审核暂存；最后知识同步、完整门禁、三校准、独立双轴和有限 attestation，再提交证据并推送 PR。

## 技术方案

三案研究继承 Wiki001，但重新核对本次公共接口和风险。R1 的跨章保存草稿会扩大存储职责，自动保存会改变显式保存语义；选择既有 dirty/locked 保护，起章前与异步完成后都检查当前配置状态。R2 的编辑禁令缩减既有能力，自动使用最新基线违背原请求；选择把原 id/version 条件传到实际输入与提交。R3 的仅编码拒绝仍留下双路径职责，启动复制清单增加运维；选择复用规范文件路径校验与读取，可组合保留字符拒绝防御，继续沿用已有静态资源中间件。

测试接口已由用户的缺陷修复授权及既有已确认范围确定；不新增内部方法测试或独立状态机。R2 用独立连接在公开配置快照接缝更新前章，表示可控交错而非自然单进程 HTTP 调度。R3 使用合成私有标记与特定编码名称外链，不读取真实文件。

## 代码落点

- `apps/web/src/pages/Workspace.tsx`：配置 guard 同步 ref，起章入口与成功/异常回读/显式核对共用 `openStartedChapter`；有配置风险时保留面板，不强制保存或卸载。已看到目标章后解除已确认的起章冻结，配置未知请求仍由其面板保留。
- `apps/web/src/pages/Workspace.config-navigation.test.tsx`：14 项真实挂载行为，公开 fetch 边界。覆盖起章前、请求中新增 dirty/saving/unknown、三种完成路径、精确原请求重试及保存/明确放弃后的切章。
- `apps/server/src/pipeline/pipeline.ts`：`startChapter` 将原前章 `ArtifactInput` 传入 `runEntry`，匹配实际 input refs 后调用模型；原条件保留至 Store 原子 append，与已有消费快照的条件写入（CAS，提交时比较输入版本）同时生效。
- `apps/server/test/chapter-start-baseline.test.ts`：两个真实 SQLite 连接、HTTP/公开 Pipeline/Store，证明取样前变化拒绝、显式新基线重试/只读重放，以及模型期间变化的提交拒绝。
- `apps/server/src/runtime/static-web.ts`：编码斜杠拒绝；URL 解码一次、realpath/目录校验后把显式 `path` 交给既有 serveStatic，不再使用原 URL 二次解码。
- `apps/server/test/static-web.test.ts`：编码斜杠与保留字符外链的真实失败、合法编码名称、百分号外链、HEAD/MIME/range/API 与无构建错误。
- README 双语、schema 条件说明、handoff、Wiki001/006/007/033/041 及索引：更新使用行为和接手入口，旧审核保持字节一致。

## 测试与验证

原始复现位于 `/tmp/a4n-review-20261003/`；本票逐项红绿、类型、完整门禁及 review 存 `/tmp/a4n-43-evidence/`。2026-10-03 定向验证：Web 全包 144 项、R1 邻接集 37 项；R2 baseline/continuation/作者快照/SQLite Store 27 项；静态资源 8 项及对应 typecheck 均通过。完整候选门禁另行记录，不用局部结果代替。

RED 表示目标行为复现失败，GREEN 表示修复后通过。有效 RED→GREEN：R1 `r1-initial-dirty-*`、`r1-inflight-success-*`、`r1-readback-dirty-*`、`r1-confirm-dirty-*`；R2 `r2-red.log`→`r2-green-tracer.log`；R3 `r3-separator-*` 与 `r3-canonical-*`。保留但排除夹具失败：R1 早期 `r1-inflight-dirty-*` 使用无效 `kind: gate`；R2 `r2-fixture-setup-failure.log` 误用直接 approved append。它们不算目标行为 RED，修正夹具后重新取得上述真实红绿。

AC1 对应 14 项配置导航挂载测试；AC2 对应三个双连接 baseline 测试及既有续章回归；AC3 对应静态 HTTP 的八项；AC4 对应当前完整门禁、双语/链接/schema/十三份旧审核保留、独立双轴和有限 attestation；AC5 由推送 PR 与对应实际 CI 回读取得，合并/闭票仍待后续。

代码质量：复用已有配置保护、ArtifactInput/Store CAS 和 serveStatic；异步完成共用 helper，条件写入仍属于 Pipeline/Store，静态边界属于 runtime。未加配置存储或状态机，文件响应保留既有流式处理及 range，不读取全部内容到内存，不加依赖。

2026-10-03 完整候选执行 `pnpm test` 836 PASS（contracts 119/CLI 182/server 391/Web 144）、`pnpm typecheck`、`pnpm build`，全部退出 0。文档验证通过：十一份改动文档、203 个本地链接/片段、双语命令及版本、GFM、Wiki/索引、十三份旧审核 byte-identical；保留既有 DOCX >500 KiB 警告。无独立 lint 脚本，执行现有类型/构建/结构和 diff 检查。测试使用 fake/mock 和合成本地数据，没有新增付费或真实模型调用，没有重新进行浏览器人工验收。

三轮自校准：①代码↔行为/新红绿：三项原缺陷与成功/错误/异步相邻行为都由公共接口验证；②代码↔最终知识：原版本条件、配置保护及规范路径描述与源码一致，schema 澄清既有条件，领域词/架构不变，十三份旧审核保留；③完整候选↔#43 AC1–AC5：三项修复逐项对应，非目标未实施，本轮只推送 PR，实际 CI 和待合并状态不提前断言。均通过，正式双轴与 attestation 尚待完成。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `533631cdc28b1c09282845cdfcb6646cc8adbacf`；T0 `6de6a2838f3a4515af5ae1dcedc27cbaa0275744`；T1 `7299b767b3abf8e1a2fc333ad22bb4d3d84cd003`。完整候选 17 文件见 `/tmp/a4n-43-evidence/manifest.txt` 与 `candidate-baseline.json`：六份代码/测试已在 `8d309e18e0d73801eac6e0281309e933013e4a0a`、`ed52c607c65a8487e9f7ef183808137c7fb5b2e4`、`1fcb646f1b6ee60c9838ccbbe97f58235ec46d9e` 三笔逻辑提交；十一份文档精确暂存。完整候选、三笔历史和 HEAD→暂存均已检查，无 unstaged/untracked 余项，不记录 T2。
- **逐项判定**：C1 = PASS（C1.1–C1.8：`issue.json`、`dependencies.json`、`main.json`、`rulesets.json`，本页起始上下文/技术方案/计划及用户授权；无 Project，保持 assignee/标签/依赖）；C2 = PASS（C2.1–C2.5：下列有效红绿、公共接口、AC 映射、各片暂存审计与 GREEN/typecheck；C2.6 N/A：本票有行为变化，配套文档另执行确定性校验，无跳过行为测试）；C3 = PASS（C3.1–C3.6：定向/完整门禁、`candidate-baseline.json`、全部 patch 与安全审计、本页质量及警告说明；C3.2 独立 lint N/A：仓库无该脚本，现有类型/构建/结构/diff 已执行，未认证额外 lint）；C4 = PASS（C4.1–C4.9：本页与下列知识维护、`docs-validation.json` 及本页三轮自校准，C4.3/C4.4/C4.7 的不受影响项见知识维护）；C5 = PASS（C5.1–C5.7：T0/manifest、cached 与 fixed-point→T0 diff 检查、三笔历史和完整候选 patch、彼此隔离的 `standards.md`/`spec.md`，两轴无发现；未发生实质候选变化）。C6.1 PASS：三项原复审缺陷取得有效 RED→GREEN，正式双轴没有新发现；C6.2 PASS：代码最终候选全部门禁通过，文档校验及精确暂存完成；C6.3 PASS：仅本票八个预留字段忠实转录来源；C6.4 PASS：独立 `/root/fix43_attestation` 的 `attestation-t1.md` 绑定上述 T1，精确八字段变化、忠实来源、完整候选/三笔历史/余项核验均通过。C7 尚未执行，不把 PR、实际 CI、合并或闭票写成已完成。
- **验收与 TDD**：issue #43。AC1：`Workspace.config-navigation.test.tsx` 十四项，R1 `r1-initial-dirty-*`、`r1-inflight-success-*`、`r1-readback-dirty-*`、`r1-confirm-dirty-*` 有效 RED→GREEN；AC2：`chapter-start-baseline.test.ts` 三项双连接条件与续章回归，`r2-red.log`→`r2-green-tracer.log`；AC3：`static-web.test.ts` 八项 HTTP，R3 `r3-separator-*`、`r3-canonical-*` 有效 RED→GREEN。AC4 的实现、完整本地验证与知识维护满足，正式独立双轴均 PASS，有限 attestation 待收口；AC5 的 source/PR 计划已核对，推送、PR 和对应实际 CI 待执行，合并/闭票仍待后续。早期 R1 无效 gate 夹具与 R2 approved append 夹具失败保留但不计 RED，详见本页说明。
- **本地门禁**：2026-10-03，在当前候选执行 `COREPACK_ENABLE_AUTO_PIN=0 pnpm test`、`pnpm typecheck`、`pnpm build`，全部退出 0，原始 `full-test.log`/`full-typecheck.log`/`full-build.log` 及 SHA-256 见 `candidate-baseline.json`；836 测试 = contracts 119 + CLI 182 + server 391 + Web 144。定向 R1 全 Web 144/邻接 37、R2 27、R3 8 及各包 typecheck 均通过；独立 Standards 另重跑 25 项通过。十一份文档、203 本地链接/片段、双语事实/GFM/Wiki/schema/索引及十三份历史审核字节一致，见 `docs-validation.json`。保留既有 AI SDK mock 的 LongCat responseFormat/structuredOutputs 警告及 DOCX >500 KiB 构建警告；它们不等于真实 provider 验证失败或新通过。完整 patch/逐笔历史/diff/凭据检查通过，`.env.local` 仍忽略且未读取；无新付费模型调用、新浏览器人工验收或本地容器人工验收，不能以 mock 结果认证这些验证。
- **双轴 review**：独立 `/root/fix43_standards_review` 的 `standards.md`/`standards-audit.json` 为 PASS、原始发现为空；独立 `/root/fix43_spec_review` 的 `spec.md`/`spec-validation.json` 为发布前 PASS、发现为空。双方未参与实现且未读取另一轴报告，结论均绑定上述 fixed-point/T0/HEAD。Spec 认证 AC1–AC3 和 AC4 的本地部分，明确 AC4 attestation 与 AC5 远端交付尚待执行；交付 Agent 接受该边界，不把发布前 PASS 当作票已完成。
- **修复与回归**：修复原 review R1 配置自动导航、R2 原起章基线及 R3 静态文件双解码边界；二十一项新增公共接口回归，七组有效红绿，相关定向/typecheck 及当前完整 836 测试、类型和构建通过。使用已有配置保护、输入/事务条件及静态中间件，没有旁路状态机或新依赖。正式两轴无新修复项；受控证据收口不改可执行内容，不重复执行不受影响的完整门禁。
- **知识维护**：已更新本票 Wiki、001/006/007/033/041 的路由与完整演进事件、索引、schema 原版本条件说明、双语 README 使用行为及 handoff 当前阶段，十三份旧审核保持字节一致。C4.3 CONTEXT N/A：领域词与数据形状未变，schema 只澄清既有条件。C4.4 ADR/research N/A：恢复既有约束，无新不可逆架构或外部选型，三案依据继承 Wiki001 并在本页复核。C4.7 运行 skill/Agent 规则 N/A：命令、配置、运行 HOW 与完成流程未变，用户 UI 行为已在 README 更新。README.zh-CN 旧导航与 anchors 已校验保留。风险是未覆盖的运行验收不能从文档或 mock 推断。
- **发布前裁决**：独立 `/root/fix43_attestation` 于 2026-10-03 给出 C6.4 = PASS，原始报告 `/tmp/a4n-43-evidence/attestation-t1.md`，原始发现为空；绑定上述清单 blob、fixed-point、T0 与 T1。精确八字段变化、忠实来源、完整候选/三笔历史及余项均通过。只允许 C6.5 的本次预留字段收口；其后 C6.6 终止性精确核验结果不写回同一候选，当前不提前断言整节 C6 或 ticket 完成。剩余边界：恶意本机写入者在校验后置换文件的竞态未证明；真实模型、新浏览器/本地容器人工验收未执行；实际 GitHub CI、推送、合并和闭票不得提前认证。

## 边界与非目标

不改变作品内容、通过状态、配置显式保存或操作冻结；不加跨章配置存储、前章编辑禁令、自动刷新起章基线。无数据迁移、付费模型调用、账号/公网部署、工具/Wiki 或扩展票实施。现有领域词、数据形状和架构不变；运行能力/命令不变。恶意本机写入者在路径检查后置换文件的文件系统竞态不在本次复现或证明范围。

## 上下文演进

### 2026-10-03 — 从复审记录进入三个独立修复切片

- **触发证据**：两种配置挂载复现及独立 SQLite/编码外链合成复现失败；用户授权先合并文档，再修复并推送。
- **原假设**：既有回归没有覆盖自动导航、初检到实际取样及双解码边界。
- **决定**：按已研究的三案选择恢复原有行为，每项保存可观察 RED/GREEN；只推送修复 PR，尚不闭票。
- **影响**：三个入口及测试、用户说明、交接和相关 Wiki 同步进入最终 review。
- **上下文处理**：preserve 原始发现、触发前提、失败证据和十三份旧审核；replace 当前行为摘要时另记本票来源，不追改历史。

## 交接结论

三项定向行为均已有新红绿证据；完整门禁、独立审核与发布前裁决从本票记录接手。来源和范围已明确，不需要再次对琐碎工程选择请求用户决定。修复分支的行为与 main 发布状态分别判断：本次先推送 PR，main 更新和 issue 关闭仍以后续远端动作作证，不提前宣布。
