---
wiki_id: "041"
ticket: 41
ticket_state: done
context_state: current
summary: "收敛双语用户入口与 MVP 清点文档，保留三项待修复边界"
topics: ["readme", "mvp-acceptance", "documentation", "delivery"]
code_paths: ["README.md", "README.en.md", "docs/handoff.md", "docs/wiki/001-mvp-acceptance.md"]
symbols: ["A4N_SEED_DEMO", "A4N_DATA_DIR", "WorkSession", "startChapter", "staticWeb"]
inherits: ["001", "004", "007", "022", "025", "033"]
changed_by: ["043"]
read_when: ["review-user-documentation", "resume-mvp-review-fixes"]
last_context_reviewed: "2026-10-03"
---

# 041 — README 与 MVP 清点文档交付

## Agent Context

- **读取时机**：核对本轮用户文档、清点结论及后续三项缺陷的来源。
- **原始目的**：用户要求清点已对齐事项并 review，外部输出遵循个人 Work Wiki 的中性、精确、中文表达要求。
- **实际落地**：默认中文 README、英文版本、旧中文路径导航及相关工程交接同步；三项已复现缺陷仍明确未修复。
- **当前价值**：文档与行为修复分别交付，历史审核保持原文，避免测试通过掩盖新增边界。
- **后续变化**：用户明确要求先提交、推送并合入文档，再修复并推送三项缺陷；修复另票，不自动实施扩展。
- **代码入口**：仅文档修改；缺陷代码入口与三个方案比较见 [Wiki001 复审](./001-mvp-acceptance.md#2026-10-03-清点与复审)。


本页相关后续变化：文档发布后的三项行为修复由 [Wiki043](./043-mvp-review-boundary-fixes.md) 跟踪。该票的修复候选与 main 发布状态分别判断，原完成审核不追改。
## 设计目的

[票面 #41](https://github.com/12bitsD/agent4novel/issues/41) 规定用户入口、当前状态、清点与保留边界。README 面向使用者；逐票设计、证据及已知缺陷留在工程 Wiki。个人 Work Wiki 是输出规范来源，不是尚未开发的作品设定 Wiki。

## 起始上下文

固定点为 `1571539b131fb11dea1fbfc5cb6f88e9c8c22815`。原有十份未提交文档修改均属于用户授权范围。复用 `codex/readme-convergence` → PR → main；2026-10-03 用户明确授权合并文档，再修复并推送缺陷。main 无分支保护，rulesets 为空；实际 quality/container CI 成功后才合并。

票面回读：无评论、无原生 blocker、assignee 为 12bitsD，标签为 ready-for-agent，未加入 Project。完成后保持 assignee/标签及未加入 Project；不联动其他票。原用户 checkout 与正在运行的服务、数据不改动。

计划：补齐本票上下文 → 文档结构、链接、渲染与历史保留验证 → 当前完整测试/类型/构建 → 三轮校准 → 固定候选独立双轴与有限证据收口 → commit/push/PR/实际 CI/merge → 完成评论和远端回读。纯文档不新增行为，RED/GREEN 不适用。

## 技术方案

比较三案：只发布 README 会遗漏已确认的交接漂移；发布完整文档及缺陷边界提供一致入口；混入行为修复违反用户要求的顺序。选择第二案。修复 R1–R3 的三案、推荐与验收保留在 Wiki001，本票不实施。

默认 README 用中文说明用途、创作路径、安装、模型、数据及限制。英文对应事实和命令一致；旧中文路径保留入口与历史锚点。演示模式的条件、真实模型样例的时点及验证前提明确写出。工程导航提供用途链接，不复制运行规范或票面排期。

## 代码落点

- `README.md`、`README.en.md`、`README.zh-CN.md`：三种入口、同一操作事实。
- `docs/handoff.md`：当前里程碑、已知缺陷与下一步。
- Wiki001：D01–D20、有效 AC1–AC6、原 24 条故事、R1–R3 与方案。
- Wiki004/007/022/025/033：当前交接与历史边界的机械修正；旧审核不改写。
- 本页与 Wiki 索引：本次独立交付的入口，不改变其他知识来源的权威范围。

## 测试与验证

AC1 对应双语命令/版本、README 入口及必要术语；AC2 对应已回读 GitHub 状态与 provider 选择代码；AC3 对应 Wiki001 的 20 项决定、六项 AC 与历史故事表及三项未修复复现；AC4 对应链接、schema、GFM 渲染、旧锚点及十二份旧审核字节对比；AC5 对应纯 Markdown manifest、独立 review、有限 attestation 与随后实际 CI。

确定性校验脚本及原始输出只保存在 `/tmp/a4n-doc-delivery-evidence/`，不新增仓库校验框架。当前候选本地门禁、三轮校准及正式 review 结果在下方预留字段收口。

2026-10-03 当前候选执行 `pnpm test`（815 项）、`pnpm typecheck`、`pnpm build`，均退出 0。文档确定性验证通过：十二份改动文档、链接与锚点、双语命令与版本、GFM 渲染、Wiki schema/索引、十二份原审核字节保持、凭据扫描。构建保留既有 DOCX 分块超过 500 KiB 警告；没有独立 lint 脚本，类型、构建和结构检查覆盖本票。

三轮自校准：①文档能力与当前可执行代码/测试逐项对照，R1–R3 未修复状态明确；②Wiki 路由、历史审核及 README 双语事实一致，知识归属不变；③完整十二文件候选对应 AC1–AC5，不夹带行为或扩展，GitHub 状态写明回读时点。三轮均通过，正式独立 review 仍待完成。

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `1571539b131fb11dea1fbfc5cb6f88e9c8c22815`；T0 `d8371d971467cd892db8e3fb06511da3cafbc766`；T1 `144067b120a05879d7a068b06729f13d657976bc`。manifest 为 README.md/en/zh-CN、handoff、Wiki001/004/007/022/025/033/041 与 Wiki README，共十二份 Markdown；`manifest.txt`、`candidate.patch` 保存精确范围，零中间本地提交。
- **逐项判定**：C1 PASS（C1.1–C1.8：issue-41.json/dependencies、main.json/rulesets.json、本页起始上下文/计划/三案/非目标/终态）；C2 PASS（C2.3–C2.6：AC 映射、docs-validation.json、纯文档范围与双轴报告；C2.1/C2.2 RED/GREEN N/A：无可执行行为变化，确定性校验替代，暂存检查仍执行）；C3 PASS（C3.1–C3.6：当前三项完整门禁、文档校验、diff/凭据忽略和原始报告；定向包测试 N/A：只改文档，全测试仍执行；独立 lint N/A：无该脚本，类型/构建/结构替代）；C4 PASS（C4.1/C4.2/C4.5/C4.6/C4.8/C4.9：本页/README/handoff/索引、验证及三校准；C4.3/C4.4/C4.7 N/A：不改数据形状、领域词、架构、外部选型、运行能力或协作规则，既有缺陷三案仍在 Wiki001）；C5 PASS（C5.1–C5.7：T0/manifest、完整固定点 diff、空中间历史、standards-final.md/spec-final.md、S1 修复及新 tree 复验）；C6.1 PASS（Spec 原 S1 无效符号已修正）；C6.2 PASS（仅路由符号变化，重新结构验证、diff 检查及双轴核对，生产代码与已执行完整门禁相同）；C6.3 PASS（八字段忠实转录）；C6.4 PASS（独立 attestation-t1.md 精确核对 T0→T1 与完整来源）。所有 N/A 仅针对无对应变化的检查，不免除本票链接、格式、事实与实际 CI 要求。
- **验收与 TDD**：[issue #41](https://github.com/12bitsD/agent4novel/issues/41) AC1–AC4 满足，由本节映射、219 个本地链接/片段、双语 Bash/固定版本、旧锚点、GFM 和十二份原审核 byte-identical 验证；AC5 发布前范围由双轴 PASS，有限 attestation pending，实际 CI/merge 由 C7 取得。纯文档 RED/GREEN N/A；不把生产 R1–R3 未修复称为通过。
- **本地门禁**：2026-10-03 `pnpm test` 815 PASS（119/182/384/130）、`pnpm typecheck`、`pnpm build` 均退出 0，日志在 `/tmp/a4n-doc-delivery-evidence/`；保留 DOCX >500 KiB 警告。S1 修正后 `validate-docs.py` 退出 0，十二份 blob 匹配新候选；cached 及 fixed-point→tree diff check 通过。Markdown 候选凭据扫描无匹配，`.env.local` 仍忽略，未读取密钥、修改原服务或调用模型。复用、可读性、边界和效率检查见 Standards：仅维护既有文档入口，不引入框架或重复规则。
- **双轴 review**：独立 `/root/docs41_standards` 的 standards-final.md 与 `/root/docs41_spec` 的 spec-final.md 对 T0 均 PASS。Spec 原始 S1（P3、无效路由符号）见 spec.md；接受修复 mountStaticWeb→staticWeb，新 tree 仅此一处 delta，两个 reviewer 分别复验。Standards 无阻塞发现；三项生产 P2 属下一票，不被本票文档结论消除。
- **修复与回归**：S1 已修正；受影响文档验证和双轴新 tree 复核通过，原报告保留。生产 R1–R3 不在本票实施，复现前提、三案与推荐仍保留；未重复付费、浏览器或人工容器验收。代码未变，复用本票实际完整门禁；未来修复须有独立 RED/GREEN。
- **知识维护**：本页、Wiki 索引、六篇相关 Wiki、双语 README/旧中文入口及 handoff 已更新；十二份历史审核及原意图、人决、失败经验字节/原文保留。schema/CONTEXT/ADR/research/运行 skill/agents 规则 N/A（形状、词汇、架构、选型、运行及规则不变）；C4 三轮校准通过，普通工程细节由 Agent 自主收敛。
- **发布前裁决**：独立 `/root/docs41_attestation` 对 T1 为 PASS，见 `/tmp/a4n-doc-delivery-evidence/attestation-t1.md`。精确核对仅八预留字段变化，段外字节相同；完整十二文件范围、空中间历史、零余项、旧审核保留、双轴结论及原始证据映射通过。T1→最终字段的终止比较由 C6.6 另行取得，不回写同一候选。剩余风险为尚未修复的 R1–R3、长篇质量未验证、既有 DOCX 分块警告；提交对应 CI/合并尚待 C7。

## 边界与非目标

本票不改代码、数据形状、领域词、架构、运行能力或流程规范，不新增付费调用或浏览器/容器人工验收。schema/CONTEXT/ADR/research/运行 skill 不受影响；既有问题比较保留在 Wiki001，无新外部选型。无独立 lint 脚本，现有类型/构建与文档结构检查替代。#28/#29 等扩展不开发、不关闭。

## 上下文演进

### 2026-10-03 — 复审缺陷另票修复

- **触发证据**：用户要求先合并文档，再修复三项已复现 P2；PR42 已合并，#41 已关闭。
- **原假设**：既有审核未覆盖本次复审暴露的相邻边界，不能用已闭票状态消除新发现。
- **决定**：文档发布后的三项行为修复进入 #43 的公共接口红绿和独立 review，不重写既有产品裁决。
- **影响**：当前相关行为与回归从 Wiki043 接手；修复 PR 本轮先推送，不提前认定 main 已更新。
- **上下文处理**：preserve 原目的、人决、失败经验和完成审核全部字节；replace 当前接手入口；本次修复证据保存在新票。

### 2026-10-03 — 清点文档与缺陷修复分开发布

- **触发证据**：完整 review 发现三项边界缺陷；用户要求先发布文档到 main，再修复并推送。
- **原假设**：文档 review 通过只说明输出准确，不能认证生产缺陷已解决。
- **决定**：本票只交付准确用户入口和交接；行为另票按既有三案选择修复。
- **影响**：README、handoff、六篇相关 Wiki、本页与索引进入同一次文档 review。
- **上下文处理**：preserve 十二份原审核、原意图、用户决定及失败经验；replace 当前摘要和过期导航；后续缺陷从 Wiki001 的 R1–R3 继续。

## 交接结论

文档准确性与实现正确性分别判断。三项已复现缺陷未修复，不能由旧闭票或 815 项既有回归消除。文档发布与关闭状态以 #41、PR、CI 和远端 main 的实时回读为准。后续只实施 R1–R3，不重新询问已确认的工程细节。
