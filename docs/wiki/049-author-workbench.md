---
wiki_id: "049"
ticket: 49
ticket_state: active
context_state: current
summary: "作者编稿台首期：稳定作品框架、真实材料交接与可见版本护栏"
topics: ["frontend-design", "workbench", "material-handoff", "navigation-guards", "outline-approval"]
code_paths: ["apps/web/src/WorkShell.tsx", "apps/web/src/MaterialFrame.tsx", "apps/web/src/pages/Workspace.tsx", "apps/web/src/pages", "packages/contracts/src", "apps/server/src/routes/works.ts", "apps/cli/src"]
symbols: ["WorkShell", "MaterialFrame", "WorkSession", "approveOutline", "OutlineApprovalRequest"]
inherits: ["047", "043", "019"]
changed_by: []
read_when: ["review-workbench", "change-material-handoff", "review-outline-approval", "debug-navigation-guards"]
last_context_reviewed: "2026-10-06"
---

# 049 — 作者编稿台与材料交接

## Agent Context

- **读取时机**：改造作品框架、材料页头、保存/通过/生成交接、导航保护或大纲版本条件。
- **原始目的**：[#49](https://github.com/12bitsD/agent4novel/issues/49)落实已认可的作者编稿台方向。作者要求独立review无遗漏后直接开发。
- **实际落地**：方案双轴PASS，已创建首期票并开始TDD；代码/浏览器/正式候选审核尚未完成。
- **当前价值**：作品身份持续、材料变化、作者把关；B框架＋适配＋CSS，沿用各节点控制器与真实权限。
- **后续变化**：W0–W4依序收口；后置契约和工具/Wiki不联动，不预先关闭实现票。
- **代码入口**：WorkShell/MaterialFrame组织呈现，Workspace/各Review执行原业务；新大纲条件请求涉及共享契约、Pipeline/Store和CLI。

## 设计目的

让作者感到同一作品始终在场，AI递交材料，作者修改、通过并决定下一章；状态和行动在所有材料中可预测，输入与基线受保护。

## 起始上下文

固定点main `5ba9fe38062120231d42b8b64a8fc4b5e3cd1e23`；实施source `codex/49-author-workbench`→PR→main。main无保护、rulesets空，现有quality/container CI；沿用本会话已审核PR提交/合并授权。#49为新首期票，OPEN、ready-for-agent、assignee12bitsD、无Project/依赖，完成时保持元数据（Project N/A）。

现有工作树供用户预览8795且保留三份自有方案草稿；新managed工作树 `/Users/user/.codex/worktrees/author-workbench/agent4novel`隔离实现与验收，复制三份已获准方案。原用户checkout/服务/数据和secret保留。仅复制本票资料，未把用户文件夹带。

原方案与范围见[详细清单](../plans/author-workbench-renovation.md)及[路线研究](../research/author-workbench-interaction-plan.md)。2026-10-06独立Standards/Spec对计划分别PASS且相互隔离；原始报告在 `/tmp/a4n-workbench-implementation-evidence/plan-standards.txt`、`plan-spec.txt`。F28澄清：运行/异常信息不输出执行prompt/secret，作者自己的Prompt/Skill输入、预览、版本文件查看保留。

C1依据：issue-baseline.json、dependencies.json、rulesets.json及source/status快照；用户条件授权已满足。三路线研究与普通grill推荐保留：稳定壳/适配；侧栏只读不卸原编辑器；文件按选择顺序追加；K01显式artifactId＋version。无需重新HIL字体/参数。

## 技术方案

WorkShell在章级WorkSession之外按作品保持框架，章key/序列继续隔离命令。纯显示偏好与业务状态分开；材料页头/状态/行动/恢复槽来自原controller，不复制workflow或拼通用命令。首次读取与目标变更不暗生成。

节点策略保持：提炼稿自动完成；创意显式保存全部方向并选定；大纲保存后通过；设定/章纲本页编辑在专用提交时保存；正文600ms保存，approved仍可编辑并保持批准，approved上游只读。新增导航先接Entry/Creative/Outline与现有配置/坏例guard。

K01使用新大纲专用条件端点及显式CLI文件，原始artifactId/version来自可见候选或成功保存回执，不在确认时GET最新替换。服务端原子核对同一基线；旧通用current-head行为保留，兼容语义写清。

计划切片与提交：W0挂载Workspace的稳定main/书名/正文节点先RED→最小壳GREEN；W1书架真三态、Entry素材离开/解析次序及迟到边界；W2全准备材料页头与guard、K01 shared/HTTP/Store/CLI垂直切片；W3章级、参考/配置/坏例、真实恢复与CSS/JS减动效；W4全门禁、隔离浏览器两章、多端亮暗、知识同步、独立双轴与有限attestation后交付。逻辑提交按片保留原始红绿。

测试seams已由获认可的V01–V10及本轮直接开发授权锁定：公开mounted UI、HTTP/API、shared schema、Store合同与CLI；不新增私有数据库旁路或CSS镜像测试。每片先RED、GREEN＋typecheck，再做安全整理；完整候选再跑repo test/typecheck/build。

## 代码落点

- 前端：稳定显示层、App/Workspace、五Review、入口与书架、辅助、主题/弹窗/样式；位置由详细清单F01–F28追踪。
- 契约：大纲条件请求/响应校验与专用API，保留旧general approve；K01相关Web/CLI/Pipeline/两Store。
- 知识：方案/研究、本页、035/047路由/变化、README中英真实图、handoff、schema与必要CLI/运行说明。

## 测试与验证

W0已完成：Workspace公开挂载用例先复现切章重建main/丢目录选择（W0-red.log，2失败/原10通过），最小作品壳、书名显示缓存和作品级目录选择后12项GREEN，web typecheck退出0（W0-green.log/W0-typecheck.log）。原章级命令与mounted/readSequence/commandSequence保持。计划review PASS只是可行性，不算端到端或正式C5代码review；完整测试与浏览器证据待后续片实际生成。原47测试数和图片不继承为本票验证。

记录根 `/tmp/a4n-workbench-implementation-evidence/`。验收按issue AC1–AC10、详细方案F/K/V/D；真实UI动作与CLI铺数据/核对分开。使用新隔离fake服务与合成数据，不调用真实模型；文学质量/全平台字体/全站无障碍不作未验证承诺。

### 完成审核证据

- **清单与候选**：固定点/source已知；清单blob、T0/T1、精确manifest pending。
- **逐项判定**：C1已有issue/来源/授权/计划；实施与质量/正式review pending，不预写PASS。
- **验收与 TDD**：AC1–AC10；既定公开seams；逐片RED/GREEN pending。
- **本地门禁**：定向/全test/typecheck/build、diff与安全检查 pending。
- **双轴 review**：正式候选Standards/Spec pending；计划双轴PASS不替代。
- **修复与回归**：pending。
- **知识维护**：三份方案复制，本页已建；实际落地与README/handoff/schema/后继路由 pending。
- **发布前裁决**：pending。

## 边界与非目标

K02–K06新增后端能力、丰富摘要/日期、创建幂等/精确回执、任意历史全文、全站自动保存、真正browser历史、工具/Wiki/SSE、已通过上游回改、依赖升级仍后置；只按当前cap呈现Legacy分类/保留/有条件读回。unknown Entry可诚实保留输入并给明确离开路径，不做永久死锁或假安全重试。

保留BC/047阅读和原文/UTF-16、背景字段安全renderer、显式续章、旧章保存后后章状态/衔接提示、上传Skill仅提示文本、原配置快照与坏例来源。不移动/重建用户数据库，不静默包含#46修复。

## 上下文演进

### 2026-10-06 — 从研究方案进入获准首期开发

- **触发证据**：用户“好的我们review一下看下有没有遗漏，没有的话我们就直接开发吧”；两计划轴PASS、无关键阻塞。
- **原假设**：研究/清单只有方案授权，尚不能实施；作品壳需要保留原节点差异与数据保护。
- **决定**：执行W0–W4/F01–F28＋K01；显示层与旧业务控制器分离，新增大纲显式可见基线，保留旧接口。
- **影响**：新实施票49、新隔离工作树与source；按已认可seams TDD，计划review与正式候选review分别记录。
- **上下文处理**：preserve BC/Human/47参数/旧冻结审核与研究依据；replace 当前计划交接为本票实施入口，不修改权威归属。

## 交接结论

首期开工边界已锁定，不需新增普通HIL。继续W0真实RED与最小框架；各片保护验证先于新入口，完成后才正式review与交付。发布/CI/合并/关闭以最后GitHub完成评论及live回读为准。
