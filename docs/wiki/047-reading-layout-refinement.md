---
wiki_id: "047"
ticket: 47
ticket_state: active
context_state: current
summary: "收敛正文阅读列、组件比例、短章自然高度与中屏布局"
topics: ["frontend-design", "typography", "responsive-layout", "reading-flow"]
code_paths: ["apps/web/src/styles.css", "apps/web/src/ui.ts", "apps/web/src/pages/Workspace.tsx", "apps/web/src/pages/Workspace.reading-flow.test.tsx"]
symbols: ["WorkSession", "directoryExpanded", "prose-reading", "prose-page", "btnPrimary", "btnSecondary"]
inherits: ["035"]
changed_by: []
read_when: ["refine-reading-layout", "review-medium-width", "review-component-density"]
last_context_reviewed: "2026-10-03"
---

# 047 — 阅读排版与组件比例

## Agent Context

- **读取时机**：调整字体、阅读列、控件密度、目录断点或短正文空间。
- **原始目的**：[#47](https://github.com/12bitsD/agent4novel/issues/47) 承接 #35 已交付界面，回应作者要求进一步优化字体、空间与组件排布。
- **实际落地**：阅读列、组件密度和中屏单列已接入；真实六宽度、亮暗与长短章验收完成，本地完整门禁通过。独立审核和发布证据在下文收口。
- **当前价值**：BC黑白灰工作台、宋体正文和现有操作保护保持；本票只收敛比例与一个目录默认断点。
- **后续变化**：系统字体跨设备、200%缩放与用户间距覆写仍需单独验证；终止发布状态以GitHub回读为准。
- **代码入口**：styles.css/ui.ts管理视觉，WorkSession只调整挂载时的目录断点；正文纯文本和状态机沿用原实现。

## 设计目的

让长文保持连贯阅读，短文按实际内容占用空间；正文、标题与状态共用阅读轴，辅助信息和控件形成一致层级。

## 起始上下文

固定点 `e04b2be8f8d54a6c0b68a6f96395b9010185246f`，source `codex/reading-layout-refinement`，工作分支→PR→main。main无保护、ruleset为空，有quality/container CI；沿用作者此前直接提交与合并授权。#35已合入PR45且live状态closed，本票不改写其原完成审核证据。#46为独立存储风险，不加入本票。

作者原话：“字体，空间，各个组件排布和大小你再思考一下能不能优化的更舒服一些？”概念沿用此前BC选择，不重新要求风格投票；字号、间距和断点由Agent自主判断。两个只读研究分别评估字体与布局，研究输入及选择记录见[排版研究](../research/reading-layout-refinement.md)。

当前浏览器890×750：190px左栏、700px主列，正文37px行高；18字符短章被240px最小高度撑开。目录在该宽度默认展开。长文原始2181字符、33个自然段；两章均为独立演示库数据。用户原标签页留有选段与展开资料，测试使用另一个标签页，避免丢失用户状态。

## 技术方案

采用平衡阅读列与渐进布局：正文桌面20px、手机18px，行距1.8，实际最大宽680px；标题桌面28px、手机26px，常读辅助13px，UI14px。正文、页头、状态沿同一列；编辑与预览文字内宽一致。保留原始换行和单纯文本节点，空行不清洗，UTF-16选段契约不变。

宽桌面三栏，中屏901–1150px保留较窄左栏，900px及以下采用流式单列、横向紧凑作品导航。目录仅在挂载时按901px媒体查询决定默认展开，用户随后选择和resize不互相覆盖。主操作/紧凑工具使用明确的两档密度，小屏常用控件至少44px高。缩短外部重复空间，保持全部错误、衔接提醒和辅助入口。

实际比例：普通宽屏200／自适应／256px，901–1150px左栏176px，≥1600px左栏216px。正文和页头、Workspace级提示共用阅读宽度；编辑框的外描边不占文字内宽，预览取消240px最小高度。主操作桌面40px、紧凑导航32px，≤900px统一44px。书架卡片最小高度220px、内距20px；只读资料的内部标题18px，避免与正文主标题争夺层级。

计划切片：①记录精确视觉RED，增加890px默认折叠的行为RED；②最小断点调整与CSS/token收敛得到GREEN，不改变请求、保存或关卡；③实际长短章、亮暗与六宽度验证，复用既有草稿/unknown回归；④知识和截图同步、三轮校准、独立双轴和有限attestation、一个前端比例逻辑提交交付。纯字号/空白不写镜像CSS的单元测试，使用真实computed style和截图覆盖。

## 代码落点

- styles.css：字体层级、阅读轴、自然正文高度、空间节奏、响应布局及辅助资料局部层级。
- ui.ts：共享主次和紧凑控件密度，避免各页自行扩大按钮。
- Workspace.tsx：唯一目录挂载断点；原切章、状态和异步保护沿用。
- Workspace.reading-flow.test.tsx：目录默认行为、用户展开与编辑内容保留。

## 测试与验证

证据根目录为 `/tmp/a4n-47-evidence/`。四项有效视觉RED：890px流式布局、默认折叠、36px行高和短正文自然高度，记录于 `visual-red.json` 与 `before-890-short.jpg`。早先1280px探针误标窗口，不纳入RED。目录行为测试在768/890/900px得到3项目标失败，901px和原6项通过；最小断点/CSS实现后10项通过，见 `directory-red.log`／`directory-green.log`。

实际浏览器验证使用独立演示实例8795和独立标签页，用户原标签页的选段与展开状态保留。未调用真实模型，未保存测试配置草稿或修改正文：

| AC | 结果与证据 |
| --- | --- |
| AC1 | 桌面标题、提示与正文同轴x352；正文和编辑有效内宽680px、20px/36px。手机编辑335px、18px/32.4px。长章与原文件逐字相同（2181字符、原33段、单纯文本节点）；890px短章18字符自然高度36px。`editor-metrics.json`、`content-equality.json`、`short-final-metrics.json` 与实际图。 |
| AC2 | 六宽度1440/1024/890/768/375/320无横向溢出；≤900默认折叠、实际展开并切历史章。展开后resize1440→320保持作者选择。`responsive-metrics.json`、六宽度截图和目录测试；既有切章/unknown/版本保护完整回归。 |
| AC3 | 手机返回、主次操作、资料和配置常用控件44px；320px完整高级配置、展开只读设定和离开确认均自然换行、无裁切。375px书架三卡均220px高；输入页完整可用。`config-320-expanded.jpg`、`materials-320-expanded.jpg`、`confirmation-320.jpg`、书架和输入页截图。关闭弹窗继续编辑，未丢配置草稿。 |
| AC4 | 实际亮暗长文、短章、编辑/阅读、目录、资料、配置、确认验证；配置折叠保留临时草稿和可见提示，恢复原值未提交。原保存/通过/续章/坏例选段由完整回归覆盖。没有新依赖/CDN/后端改动。实际1440亮暗图已进入README。 |
| AC5 | 三案取舍见research；README双语事实、真实截图、handoff、索引与035后继事件同步。035原冻结审核逐字保留。正式独立审核见下方预留字段。 |

2026-10-03最终代码执行 `pnpm test`、`pnpm typecheck`、`pnpm build` 均退出0：contracts119、CLI182、server391、web165共857项测试。构建仍提示既有DOCX chunk约504.50kB，AI SDK测试夹具仍有模型能力警告；不是新运行失败。每个包原始输出见 `full-*.log`。格式脚本未配置，以类型检查和diff检查覆盖；静态/知识校验与候选安全审计另留输出。

局限：只观察macOS当前浏览器，跨平台字体、200%缩放、用户间距覆写和全面无障碍符合性尚未完整验收。320px重排不能替代这些验证。#46并发首次SQLite初始化风险独立保留，本票没有修复或依赖它。

知识回写后执行三轮自校准：①代码↔行为：唯一交互变化是目录挂载断点，10项定向与完整857项通过，实际视觉读数对应CSS；没有新增请求或正文处理。②代码↔知识：实际680px文字内宽、1.8行距和900px断点与本票／research／双语README一致，035历史参数和冻结审核保留，119个本地链接与实际截图字节核对通过。③候选↔票面：AC1–AC5逐条对应上表，13文件均归属本票；未加入字体下载、阅读模式、持久化偏好或#46修复。证据为 `static-validation.log`、`docs-convergence-validation.log` 与完整门禁。

### 完成审核证据

- **清单与候选**：固定点 `e04b2be8f8d54a6c0b68a6f96395b9010185246f`；source `codex/reading-layout-refinement`→PR→main，清单blob `42116082e8ca2804d826cc00f6578270077f60eb`；T0 `513c85e1e9116b6a31dd03f5cf20dbfea7ed317f`；T1 `2092382accf3f911ae2d5e586e51fab5ea56c1a6`。13文件manifest：README.md/en、Workspace.tsx／reading-flow.test.tsx、styles.css、ui.ts、两张workspace JPG、handoff、research/reading-layout-refinement、Wiki035／047及索引；详见T0-manifest.txt／完整T0.patch。HEAD等于固定点，审核时零本地提交、无unstaged/untracked余项。
- **逐项判定**：C1 PASS（C1.1–C1.8：issue-baseline.json、dependencies.json、main/rulesets-baseline.json、固定点/manifest及上述计划/Human输入；标签ready-for-agent、assignee12bitsD保持，依赖空，Project空）；C2 PASS（C2.1–C2.5：有效目录与视觉红绿、AC表、无状态机/接口旁路，Standards/Spec核对）；C3 PASS（C3.1–C3.6：full-*.log、static-validation.log、两次diff check、候选安全和复用检查）；C4 PASS（C4.1/C4.2/C4.5/C4.6/C4.8/C4.9：本页/双语README/真实图/research/handoff/索引、119个链接与schema及三轮校准；C4.4 research已更新）；C5 PASS（C5.1–C5.7：确切T0/manifest/完整binary patch、空历史和余项、独立两轴原始报告，没有实质修复）。C6.1 N/A（没有确认的行为缺陷需修复，无新增RED遗漏风险）；C6.2 PASS（实质候选保持T0，最终完整门禁与静态检查仍适用）；C6.3 PASS（仅预留8字段转录）；C6.4 PASS（独立精确比较T0→T1、完整T1 delta／空历史／无余项、原始证据映射与安全检查，见c6-4-attestation.txt）。其他N/A：C2.6（已有行为TDD，不走替代）；C4.3 schema/CONTEXT（无数据、不变量或词义变化）；C4.4 ADR（可逆票内视觉，无架构裁决；research已更新）；C4.7 runtime skill/Agent规则（运行/模型/CLI/流程未变）；C7.4 Project（未加入，维持原值）。无隐藏跳过或新增外部权限。
- **验收与 TDD**：#47 AC1–AC5与上表；目录RED三项真实缺失、GREEN10项，视觉四项RED与实际GREEN。CSS不增加镜像实现的单元测试，以真实布局读数与截图验证。
- **本地门禁**：2026-10-03 `pnpm test/typecheck/build`退出0，857项；见full-*.log，Standards另独立运行目录10项通过。既有DOCX chunk／AI SDK夹具警告保留。static-validation.log：diff check、119链接/schema、正文逐字、真实图片字节、安全检查通过；.env.local忽略，13文件无凭据模式、secret/临时库/后端/锁文件夹带。没有格式脚本，不伪称执行格式化；类型/static与diff检查已完成。`git diff --cached --check`及`git diff --check fixed-point T0`退出0；零中间本地历史，完整patch/二进制和精确manifest已回读。
- **双轴 review**：Standards `/root/design35_visual_critique` PASS（standards-review.txt），Spec `/root/reading47_typography_research` PASS（spec-review.txt，AC1–AC5逐条满足），均针对T0且彼此隔离。两位仅提供过只读研究、未参与本候选实现；重新审阅完整delta与原始输出，不沿用研究当审核。无P0–P3阻塞发现；035冻结审核逐字保留，两实际README资产字节核对通过。
- **修复与回归**：没有代码/契约/AC修复。Standards发现旧bookcase-320.jpg为工具缩放图，不可支持375px卡片结论；接受并排除该图，补存bookcase-375-metrics.json及真实375×812的bookcase-375-final.jpg，两轴独立核对三卡343×220。该补证据未改T0或候选事实；原始发现保留。完整门禁适用于实质候选，不因证据转录重复运行全部测试。
- **知识维护**：已更新047、035后继路由与历史边界、research、双语README／真实图片、handoff与Wiki索引；README.zh-CN导航入口保留。035冻结区6138字节与base一致（含审核标题的提取范围SHA256：49d7ac9bac1243fd92a68d928e87376e0397f4308eed59450336fdc1ec6a3d9a）。docs-convergence-validation.log／static-validation.log／三轮校准与两轴报告通过。N/A来源及风险按逐项判定列出；未把跨平台字体/200%/间距覆写或#46未修复风险写成完成。
- **发布前裁决**：独立 reviewer `/root/reading47_typography_research` 对T1给出PASS，2026-10-03，原始c6-4-attestation.txt：唯一变化为预声明8字段且忠实于实际输出，完整候选／空本地历史／无工作区余项通过。剩余风险为当前macOS字体范围、未完整验证的200%缩放／间距覆写及独立#46存储竞争；不将本地结果代替CI。后续仅进行获准字段的终止性比较，提交／CI／合并／关闭从GitHub完成评论与live状态读取。

## 边界与非目标

不引入新阅读模式、字号持久化、字体下载/CDN、正文清洗、生成职责变化、后端协议或#46存储修复。状态表达仍使用文字与边框，不靠淡化隐藏异常。遵循用户明确黑白灰要求，保留对暖色建议的既有豁免。

## 上下文演进

### 2026-10-03 — 从独立参数转为一致的阅读比例

- **触发证据**：作者再次提出字体/空间/组件大小要求，真实890px短章暴露固定空白与中屏左栏问题。
- **原假设**：#35已放大正文、折叠手机目录，但宽度与控件各自合理仍会产生阅读轴错位与中屏挤压。
- **决定**：保留BC和字体家族，选平衡阅读列结合渐进断点，收敛控件密度并取消正文无意义最小高度。
- **影响**：CSS与共享token变化，唯一交互差异为目录默认折叠范围扩到900px；保存、通过、选段与生成不变。
- **上下文处理**：preserve #35原参数、Human决定、字体依据与冻结审核；replace本票当前实现视图，前序通过changed_by指向本页。

## 交接结论

当前范围与实现、实际浏览器结果已收敛，普通参数无需新增Human选择。后续从预留审核字段进入独立双轴与有限attestation；发布完成后沿GitHub完成评论读取实际commit/CI/关闭状态。系统字体与未完整验证的无障碍面保持明确限制。
