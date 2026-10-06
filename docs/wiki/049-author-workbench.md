---
wiki_id: "049"
ticket: 49
ticket_state: active
context_state: current
summary: "作者编稿台首期：稳定作品框架、真实材料交接与可见版本护栏"
topics: ["frontend-design", "workbench", "material-handoff", "navigation-guards", "outline-approval"]
code_paths: ["apps/web/src/WorkShell.tsx", "apps/web/src/MaterialFrame.tsx", "apps/web/src/pages/Workspace.tsx", "apps/web/src/pages", "packages/contracts/src", "apps/server/src/routes/works.ts", "apps/cli/src"]
symbols: ["WorkShell", "MaterialFrame", "WorkSession", "approveOutline", "OutlineApprovalRequest"]
inherits: ["047", "043", "019", "004"]
changed_by: []
read_when: ["review-workbench", "change-material-handoff", "review-outline-approval", "debug-navigation-guards"]
last_context_reviewed: "2026-10-06"
---

# 049 — 作者编稿台与材料交接

## Agent Context

- **读取时机**：改造作品框架、材料页头、保存/通过/生成交接、导航保护或大纲版本条件。
- **原始目的**：[#49](https://github.com/12bitsD/agent4novel/issues/49)落实已认可的作者编稿台方向。作者要求独立review无遗漏后直接开发。
- **实际落地**：W0–W4与K01代码已落地，完整本地门禁和隔离浏览器两章验收通过；正式候选双轴与发布结果由审核证据及GitHub回读持有。
- **当前价值**：作品身份持续、材料变化、作者把关；B框架＋适配＋CSS，沿用各节点控制器与真实权限。
- **后续变化**：后置契约和工具/Wiki不联动；不据本地门禁推断CI、merge或issue关闭。
- **代码入口**：WorkShell/MaterialFrame组织呈现，Workspace/各Review执行原业务；新大纲条件请求涉及共享契约、Pipeline/Store和CLI。

## 设计目的

让作者感到同一作品始终在场，AI递交材料，作者修改、通过并决定下一章；状态和行动在所有材料中可预测，输入与基线受保护。

## 起始上下文

固定点main `5ba9fe38062120231d42b8b64a8fc4b5e3cd1e23`；实施source `codex/49-author-workbench`→PR→main。main无保护、rulesets空，现有quality/container CI；沿用本会话已审核PR提交/合并授权。#49为新首期票，OPEN、ready-for-agent、assignee12bitsD、无Project/依赖，完成时保持元数据（Project N/A）。

现有工作树供用户预览8795且保留三份自有方案草稿；新managed工作树 `/Users/user/.codex/worktrees/author-workbench/agent4novel`隔离实现与验收，复制三份已获准方案。原用户checkout/服务/数据和secret保留。仅复制本票资料，未把用户文件夹带。

原方案与范围见[详细清单](../plans/author-workbench-renovation.md)及[路线研究](../research/author-workbench-interaction-plan.md)。2026-10-06独立Standards/Spec对计划分别PASS且相互隔离；原始报告在 `/tmp/a4n-workbench-implementation-evidence/plan-standards.txt`、`plan-spec.txt`。F28澄清：运行/异常信息不输出执行prompt/secret，作者自己的Prompt/Skill输入、预览、版本文件查看保留。

C1依据：issue-baseline.json、dependencies.json、rulesets.json及source/status快照；用户条件授权已满足。三路线研究与普通grill推荐保留：稳定壳/适配；侧栏只读不卸原编辑器；文件按选择顺序追加；K01显式artifactId＋version。无需重新HIL字体/参数。

## 技术方案

WorkShell按作品ID稳定，章级WorkSession仍按作品/章key隔离。书名显示缓存、作品级目录选择避免读取间隙失去位置；命令、权限、旧响应接收资格仍由原owner控制。MaterialFrame只组织材料标题、状态、主次行动、正文和恢复区，不生成通用写入命令。

真实保存策略保持：Caption自动approved；Creative显式保存全部方向pending再选定；Outline显式保存pending再通过；Setting/Beat页内修改在完整提交时生效；Prose600ms自动保存，approved保存仍approved。approved上游只读。创意已通过内容独立同步，版本变化不重挂可编辑控件。

Entry按文件选择顺序读入，读取中阻止创建，取消只停止UI接收；创建请求同步锁防双发。未知创建保留输入、不重发，可核对书架并明确放弃页面。Creative/Outline的写请求30s、核对读取10s，拒绝外来命令错误包冒充当前拒绝。外部通过与迟到读回不重置脏稿：原编辑器保活，本页副本只读，并保持离开保护；只有明确载入才放弃。自己的成功选定/通过会明确释放guard并继续原交接。Creative/Outline上报dirty/locked，离开、切章与beforeunload保护；unknown保留原提交和草稿，GET只观察当前材料，显式载入前确认丢弃本页。不承诺原请求精确回执。

K01专用POST由共享严格请求/响应校验：作者可见ID/version，4096B请求，返回同ID/version/createdAt的approved Outline。Pipeline调用两个Store既有原子setStatus条件，不增加迁移；同已通过目标重放不清除后续生成失败。新Web和approve-outline CLI使用冻结基线，CLI不GET回填或重发；旧通用approve保持current-head语义。当前协议形状见[数据模型](../schema.md#大纲可见版本通过)。

资料按当前approved head只读，展开关联aria-controls；配置收起保活，坏例保留原文/hash/UTF-16来源。正文仍单文本节点，不套Markdown。局部CSS只在材料进入时补充反馈；关闭动画不改变状态，校验定位JS滚动按减少动效改auto。BC字体、680px/20px与小屏18px、1.8行距继续适用。

公开seams与切片沿用已认可V01–V10：mounted UI、共享schema、HTTP、Store、CLI。W0先稳定壳；W1入口/导航；W2准备材料及K01；W3章节/辅助/减动效；W4真实页面、门禁、文档与独立审核。

## 代码落点

- [WorkShell](../../apps/web/src/WorkShell.tsx)、[MaterialFrame](../../apps/web/src/MaterialFrame.tsx)：显示边界；[Workspace](../../apps/web/src/pages/Workspace.tsx)：章级控制器、guard与交接。
- [Entry](../../apps/web/src/pages/Entry.tsx)、[Bookcase](../../apps/web/src/pages/Bookcase.tsx)：创建素材/文件接收与读取三态；CreativePoster/OutlineReview与material-operation：Legacy保留及恢复分类。
- [outline-approval](../../packages/contracts/src/outline-approval.ts)、Pipeline.approveOutline、works route、Web api、CLI命令：K01显式可见基线。
- ReferenceMaterials/SettingReview/BeatReview/ProseReview、ui.focusMaterialField/styles：材料槽、原文、焦点和减动效。
- 详细F01–F28/K01/V01–V10/D01–D06追踪入口在[完整方案](../plans/author-workbench-renovation.md)，外部路线依据在[research](../research/author-workbench-interaction-sources.md)。

## 测试与验证

证据根为 `/tmp/a4n-workbench-implementation-evidence/`。计划review不是实现review；本轮未使用旧测试数、旧截图或CLI输出代替真实页面。使用独立8801生产/demo服务和新SQLite目录，不读取真实key或调用付费模型。

| AC | 代码/验收入口 | 本轮证据 |
| --- | --- | --- |
| 1 | WorkShell/WorkNavigation；reading-flow、autosave、continuation | W0-red两项真实失败→W0-green12项；stable main/书名/目录，现有输入/迟到保护回归 |
| 2 | MaterialFrame、五Review、只读Caption资料 | W2-material-red→green；真实UI六种材料；原保存策略各自保留 |
| 3 | 原Setting/Beat/Prose控制器、generation/continuation测试 | 浏览器脑洞到两章双关卡，正文停留后显式下一章；unknown/迟到回归 |
| 4 | Entry.safety/Bookcase公开挂载 | W1各RED→GREEN；Entry18＋Bookcase6涵盖空/读取/失败/重试、文件错序/取消、并发/未知/迟到 |
| 5 | Workspace.material-guards、config-navigation、LegacyMaterial.recovery | W2-guards/legacy-recovery及W4-external-head红绿；取消保留、同步锁、核对只GET、载入需确认，外部推进和迟到读回不丢新编辑 |
| 6 | shared/HTTP两Store/CLI/OutlineReview.version | K01-http/replay/cli/web红绿及边界测试；丢回复、stale、CAS、匹配approved重放、兼容 |
| 7 | 原文/finite renderer/config/bad-example回归 | 真键盘选段与坏例保存、版本来源；主题/资料/配置保活；HTTP安全分类；无prompt/secret打印 |
| 8 | styles/ui、MaterialMotion、reading-flow | 最终构建1440/1024/890/768/375/320亮暗长短章无横溢；20/18px、680px实测；JS reduce-auto测试与CSS核查 |
| 9 | repo scripts与production browser | pnpm test/typecheck/build退出0；121 contracts＋407 server＋198 CLI＋208 web；browser-before/after旧章修改证明后章Artifact逐字段不变 |
| 10 | 本页、035/047/004路由、README中英/真实图、handoff/schema/运行skill | 文档检查、旧冻结audit字节比较、三轮校准；最终C5/C6与远端待收口 |

本地完整门禁：COREPACK_ENABLE_AUTO_PIN=0 pnpm test、pnpm typecheck、pnpm build，原始输出final-test/typecheck/build.log。依赖安装退出0。构建仅保留已有DOCX分包504.50kB警告；未静默升级React或分包策略。先前完整web暴露创意选定后的只读同步缺陷，W2-regression-green修复；正式首轮review确认三项P2：旧写入无期限、错命令4xx误归属、外部通过清脏稿。W4-legacy-boundary-red六项与W4-external-head-red三项有效失败后已修复，定向GREEN/typecheck与当前完整门禁重跑通过；首次迟到读回夹具没有触发GET的失败保留为fixture证据，不冒充行为RED。坏例测试等待WebCrypto摘要后的可观察POST，保留失败输出，未改产品协议。第一次前端类型检查的fixture chapter字段错误已修正，不冒充行为RED。

浏览器确认：Entry取消离开保留素材；创建只进入待生成；Creative保存/确认方向；专用大纲通过；Setting→Beat→Prose；第一、二章通过；已通过历史正文编辑仍approved、后章原文/版本不变且衔接提示；配置收起保留、显式保存；键盘编辑/预览/选段/标记坏例；URL reload只读。responsive-light/dark/long.json与实际截图记录屏宽和DOM测量。自动未知保护通过fetch边界测试验证，不伪称真实网络断线全部手工复现。系统IME、辅助技术、跨系统字体与大规模长篇性能仍未认证。

修复后的三轮自校准再次完成：①代码↔行为/测试：权限和原控制器分离，保存差异与unknown无自动回放；②代码↔Wiki/词义：协议仅schema拥有，当前与历史来源分开；③完整候选↔AC/范围：F01–F28/K01已映射，K02–K06新增能力未夹带。正式独立review从冻结tree开始。

### 完成审核证据

- **清单与候选**：固定点 `5ba9fe38062120231d42b8b64a8fc4b5e3cd1e23`；source codex/49-author-workbench→PR→main。双轴最终 T0 `e0f4558f4158141d59e562ad8de50e93855d97b4`；pre-attestation T1 `fedf8acec1b2c089186f895002632fa0069291ea`；清单blob `42116082e8ca2804d826cc00f6578270077f60eb`。精确54文件manifest为candidate-manifest-v2.txt，5筆本地提交与完整patch见candidate-audit-v2.txt；只在这八字段收口，不记录T2自引用。
- **逐项判定**：C1.1–C1.8 PASS：issue-baseline/current、dependencies/rulesets/main-before、Human授权、计划双轴与独立工作树。C2.1–C2.5 PASS：公开RED/GREEN、跨包协议/并发与逐片manifest/patch/逻辑提交；C2.6 N/A（本票有行为，不适用纯文档替代）。C3.1–C3.6 PASS：934项全门禁、定向回归、diff/static、安全/范围/全部5笔历史审计、质量校准。C4.1–C4.9 PASS：知识更新、document-check-v2.log272本地链接/规范字段/标题及三轮校准；C4.3 CONTEXT部分N/A（无新领域词，schema已更新），C4.4 ADR部分N/A（无不可逆决定，research已更新），C4.7 docs/agents规则部分N/A（规则未变，runtime skill已更新）。C5.1–C5.7 PASS：e0f完整冻结、两种diffcheck、历史审计、独立双轴、原发现修复并重新冻结复审。C6.1–C6.2 PASS：三项P2已修复，9项新增行为RED、对应GREEN/typecheck及934项门禁，当前T0获独立复审；C6.3–C6.4 PASS：仅八字段收口，T0→T1结构/来源/历史/范围/余项由独立reviewer核对；初始转录错误已纠正，仅预留字段更新。C1–C5分节PASS及N/A分支如上。C1.8/C7.4 Project部分N/A（未加入，保持现有标签/assignee/依赖）。
- **验收与 TDD**：AC1–AC10按上表满足候选侧要求；代码、公开mounted/HTTP/Store/CLI与实际浏览器证据映射保留。W0/W1/W2/W3/K01与W4红绿日志在证据根；fixture类型/读取触发错误与有效行为RED分开。
- **本地门禁**：最终pnpm test/typecheck/build退出0，final-*.log，121 contracts/407 server/198 CLI/208 web共934，是本次快照。独立Standards定向70，Spec Web78/HTTP16/CLI16及原并发探针通过。git diff --cached --check与git diff --check base T0通过，完整54文件/5笔历史无secret、临时、票外或symlink变化；env/data仍ignored。文档272链接/schema/旧audit字节通过。DOCX504.50kB既有构建警告；仓库未设单独lint/formatter脚本，以现有typecheck/diff等覆盖。
- **双轴 review**：Standards与Spec独立PASS，均审e0f4558f4158141d59e562ad8de50e93855d97b4，未参与实现、互不读取报告。初始Standards正式FAIL在initial-standards.txt；初始Spec在旧T0被替换后为interim/PENDING并记录已确认P2，原文在initial-spec.txt。两者状态分别保留，不伪造初始Spec正式FAIL。最终两轴对e0f的PASS在final-standards/spec.txt，Spec正式消息由root忠实归档。
- **修复与回归**：P2旧写入无期限与错命令4xx误归属由b28d7ad修复，W4-legacy-boundary-red6失败→green27及type0；P2外部批准清脏稿及迟到推进卸载由176d1b3修复，W4-external-head-red3有效失败→green19/type0，自己确认后的正常交接与最终浏览器回归通过。原始失败、fixture纠正与前次完整门禁pre-review-*.log保留；当前完整门禁重跑通过。
- **知识维护**：本页、004/035/047后继路由、Wiki索引、schema K01、README中英与真实亮暗JPEG、handoff、CLI运行skill更新。CONTEXT/ADR/规范N/A理由见逐项字段；research/plan已版本化。旧035/047审核区逐字节preserve，原意图/Human/rationale保留。修复后三轮代码↔测试、代码↔知识、全候选↔AC/范围再次完成。
- **发布前裁决**：独立 `/root/design35_reading_flow` 对T1 `fedf8acec1b2c089186f895002632fa0069291ea` 给出C6.4 PASS（attestation-T1.txt）；`/root/design35_visual_critique` 对同一修正T1独立PASS（attestation-T1-corrected-standards.txt）。完整来源/历史/范围/余项及八字段外字节一致已确认。旧cb9的状态转录FAIL与纠正来源保留，不复用旧树裁决。剩余范围：K02–K06新增契约、#46、长篇质量独立；演示UI不证明真实模型质量，物理IME/跨系统/全面辅助技术认证未覆盖。无新增权限或费用。

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

可继承稳定作品框架、材料呈现和各节点真实保存策略；K01不改变旧general approve语义。完整门禁及浏览器是本轮事实；发布/CI/合并/关闭由最后GitHub完成评论和live回读确认。后置创建幂等、历史全文/日期、长篇Wiki/tools和#46继续独立处理，不自动关闭。
