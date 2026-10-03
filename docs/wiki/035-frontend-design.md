---
wiki_id: "035"
ticket: 35
ticket_state: done
context_state: mixed
summary: "已交付的 B/C 黑白灰工作台与主题选择；阅读比例和目录断点由 047 后续细化"
topics: ["frontend-design", "monochrome", "typography", "accessibility"]
code_paths: ["apps/web/src/styles.css", "apps/web/src/ui.ts", "apps/web/src/ThemeControl.tsx", "apps/web/src/App.tsx", "apps/web/src/pages/**"]
symbols: ["App", "ThemeControl", "Bookcase", "Entry", "WorkSession", "AuthorConfigPanel", "ConfirmDialog"]
inherits: ["006", "007", "043"]
changed_by: ["047"]
read_when: ["redesign-frontend", "review-typography", "test-theme", "review-mobile-layout"]
last_context_reviewed: "2026-10-03"
---

# 035 — 黑白灰写作工作台

## Agent Context

- **读取时机**：设计、改造或评审核心创作页面的视觉、字体、亮暗主题及窄屏布局。
- **原始目的**：落实 [#35](https://github.com/12bitsD/agent4novel/issues/35) 的极简黑白灰、像素字体与中文阅读要求。
- **实际落地**：BC 工作台、亮暗主题、正文限宽与手机折叠目录已交付；Human 首版反馈已实施。#35 的本地验证与冻结审核证据见下文，PR45 合并和关闭结果见 [完成评论](https://github.com/12bitsD/agent4novel/issues/35#issuecomment-5966160627)。
- **当前价值**：正文为主角，章节和创作设置为辅助；沿用现有关卡、保存、通过和续章保护。
- **后续变化**：[Wiki047](./047-reading-layout-refinement.md) 细化阅读列、字号比例、短章高度和中屏布局；本页 20px／1.85／36em 与 700px 目录初始断点属于 #35 交付历史。BC 方向、主题机制、字体家族及业务保护继续适用。
- **代码入口**：styles.css 与 ui.ts 管视觉；App 管页面入口，WorkSession 管按章隔离与配置保护。

## 设计目的

把现有彩色点缀与分散样式统一为黑白灰写作界面。短标签可以承担像素风格，中文长篇正文以阅读体验为先。不得靠颜色或动画单独表达保存、错误、禁用或未知状态。

## 起始上下文

固定点 `19a30524fd0e7f34b3c5a8a99bb3bd4959b8ae2a`，复审修复 PR44 已合入 main。复用干净的 managed worktree，source `codex/35-frontend-redesign` → PR → main。用户本次授权重新设计并关闭 #35；上一轮明确授权已审核 PR 的批准/合并。仍按完整完成清单逐项交付，不预先闭票。

开工回读 #35 OPEN、needs-triage、无 Project/评论/原生 blocker；已 claim 12bitsD。视觉对齐后再将本票标为 ready-for-agent，完成时保留 assignee、ready-for-agent 及未加入 Project。现有 main 无分支保护/rulesets，quality/container CI 必须按实际交付提交核对。

## 技术方案

同一概念为“作者的写作工作台”，正文是信息主角。先比较三种黑白灰版式：A 阅读纸面、B 终端工作台、C 强对比硬边；字体默认限于品牌和短标签，正文采用系统中文阅读字体。字体三案和官方许可证、覆盖、体积、回退见 [font research](../research/frontend-font-options.md)；默认 Fusion Pixel 12px 比例简体中文，仅用于品牌/短标题，不引入运行时外部 CDN。字体方案与版式 A/B/C 独立，不把字体候选编号误作视觉选择。

2026-10-03 Human 原话“感觉BC舒服些”。按 skill 的模糊反馈规则不追问；收敛为 B 的桌面工作台主辅分区、C 的硬边与黑白对比，减少装饰。首版看图后，Human 授权收敛导航、重复说明和阅读字体，详见第二轮变化事件。#35 交付时桌面为章节目录／正文／资料和配置三栏；手机流式单列，目录默认折叠，保留全部辅助入口。目录初始状态按挂载时的700px视口决定，缩放不会强制改写用户展开状态；切章仍按原章级 session 隔离。亮暗默认跟随系统，可手动选择并在当前浏览器记住；存储失败仍能切换。主题切换不得丢失页面草稿或触发生成。配置折叠保留组件，避免丢失草稿及冻结请求。

#35 交付时像素字仅用于品牌；书名、标题和操作使用常规无衬线，正文使用中文宋体与拉丁衬线回退。正文桌面20px／1.85、最大36em（720px），手机18px／1.85、左右20px；编辑和预览共用参数，保留原始纯文本换行。页头只有一份章号与保存状态，已通过章的主动作是原有的“开始下一章”，待通过章突出“通过正文”。目录、资料与常规说明降低视觉重量；错误、未知和衔接提醒仍完整保留。阅读比例与响应断点的后续实现、验证和边界改从 [Wiki047](./047-reading-layout-refinement.md) 读取，不把本段历史参数当作现行值。

按用户已确认的黑白灰要求，对 frontend-design 的带色温建议作明确豁免；视觉状态仍必须具备文本、边框、形状和焦点提示。桌面主辅分区，小屏减少辅助信息并切单列，不压缩正文。亮暗共用语义 token，动画可关闭。

计划提交边界：①视觉方案与字体研究；②主题/token/共享控件及必要的主题行为 RED→GREEN；③书架、统一入口与所有产物/配置/坏例的统一布局，复用既有公共组件测试；④浏览器真实路径、窄/宽屏与亮/暗截图、README真实截图、Wiki和知识同步，三轮校准与独立双轴/有限 attestation 后交付。

工程 gap 自主比较：主题采用“仅系统 CSS／浏览器本地偏好／服务端作品偏好”三案，选浏览器偏好，避免视觉配置进入作品数据；窄屏采用“隐藏辅助／模态抽屉／流式单列”三案，选单列保留所有入口、目录局部滚动；确认采用“保留原生弹窗／统一现有 ConfirmDialog／新增弹窗库”三案，选复用现有组件，获得取消焦点与键盘恢复，避免额外依赖。创意稿选定与大纲通过的原生弹窗在 IAB 实际走查中阻塞工具；记录为工具限制而非业务失败。统一后的行为另做有效 RED→GREEN，保持原文、提交顺序与版本条件。

## 代码落点

- `styles.css`／`ui.ts`：亮暗语义灰阶、字体、双字号正文、共享焦点/状态、响应式三栏与单列。原角色 token 映射灰阶以兼容旧公共样式；不引入新的颜色含义。
- `ThemeControl.tsx`／`App.tsx`：系统／浅色／深色、本浏览器偏好与失败回退；主题控制独立于页面状态，切换不重建创作页面。品牌与跳转到主要内容共用壳。
- `Workspace.tsx`：作品导航／当前内容／辅助三栏；原生目录折叠，单一导航；续章按钮移入正文页头的 `primaryAction`。仅首次打开挂载配置，折叠用 `hidden` 保留组件与 guard。目录及主动作沿用原 `allowedActions`、作品/章号 key 和条件请求。
- `Bookcase`／`Entry`／`CreativePoster`／`OutlineReview`：表面与动作区统一；可访问字段、普通方向按钮 group 与 pressed 状态；复用 `ConfirmDialog`，捕获原草稿/版本，取消不写入。
- `SettingReview`／`BeatReview`／`ProseReview`／`AuthorConfigPanel`／`ReferenceMaterials`／`BadExamplesPanel`：布局 hooks 与字体边界；正文保留单个纯文本 DOM 与原 Range 偏移，不改选段哈希、命令或保存状态。
- `apps/web/public/fonts/`：完整本地 WOFF2 和上游四份许可证；字体依据见 research。

## 测试与验证

原始票面、远端边界、设计稿和研究存 `/tmp/a4n-35-evidence/`。初始三稿在 1440×1000 真实浏览器视口截屏，截图 a/b/c.jpg，HTML a/b/c.html；该阶段只验证本地字体加载和桌面无横向溢出，尚未检查字体请求失败、窄屏或实际产品；后续实装结果见下文。截图明确为原创示例内容，不作为运行作品或 README 真实产品截图。浏览器 fullPage 捕获会改变 viewport，后改用统一显式尺寸的普通截图，保存后已 reset 临时 viewport。

样式本身以真实 HTML 渲染、灰度主次、字体回退、焦点/禁用/错误与响应式检查验证；新增可执行行为必须从公开组件测试取得有效 RED→GREEN。复用 Web 的保存/通过/未知恢复/按章隔离回归，并执行仓库完整 test/typecheck/build。浏览器测试使用独立本地数据/端口及 demo，不调用真实 provider 或修改用户作品库。

2026-10-03 首版草稿与历史证据：

- ThemeControl 有效行为 RED（手动选择不生效）→ 3 项 GREEN，另验证 App 切主题不重建输入或生成；配置折叠有有效 RED→GREEN，草稿、原冻结请求和导航 guard 保留。缺模块的初次失败仅作脚手架记录，不冒充有效行为 RED。
- 入口／方向／大纲字段 3 项可访问性 RED→GREEN；创意稿选定与大纲通过的 3 项页内确认 RED→GREEN，包括取消焦点、Escape 恢复、原内容与版本、原保存/通过顺序。证据位于 `/tmp/a4n-35-evidence/` 的 theme-behavior-red、theme-green、config-collapse-red/green、entry-pages-red/green、entry-dialog-red/green 日志。
- 最终草稿全仓库 `pnpm test` 847 项、`pnpm typecheck`、`pnpm build` 均 PASS，原始输出为 full-*-final-draft.log。构建仍有 DOCX 依赖 chunk 超过 500kB 的既有警告；不新增包或改锁文件。
- 隔离 production demo／SQLite 8795，CLI 首章 smoke PASS。真实 UI 完成开始第二章、编辑/通过章纲、正文生成/自动保存、主题切换、配置折叠/保存、正文通过、历史章编辑和后章衔接提示、书架与新建/创意稿生成。CLI 精确回读保存内容及 approved 状态：browser-final-work.json。它不证明真实模型质量。
- 375px 输入、创意稿、大纲、设定、正文和高级配置检查 `scrollWidth === innerWidth`；正文实际 18px，桌面 19px，阅读系统中文 serif。1440×1000 亮暗截图和375×812阅读截图保存于 evidence；README 使用实际亮暗图，未裁切或拼接。
- 字体成功加载；暂时移开隔离构建里的字体后刷新，`document.fonts.check` false，品牌与书架仍可读，随后恢复原文件。字体缺字统计采用固定上游版本，不宣称全量中文覆盖；未安装 FontTools 或执行二进制 cmap 校验。200%浏览器缩放尚未验证。
- 原生确认弹窗曾阻塞 IAB 输入，首版只能验证公共组件与 CLI 推进后的大纲/设定渲染，未把这些记录为浏览器确认。后续临时页清理后，新页恢复输入；页内弹窗实际取消/确认与剩余前置操作已在第二轮完成，见下文。该失败经验保留，不用于推断产品命令是否成功。
- README 双语事实/真实截图、Wiki schema/链接、字体hash/许可证、前序006/007/043 frozen审核区逐字节检查 PASS（docs-validation-final.log）。独立初步静态风险审查无新增发现，明确不作正式 C5 PASS。

2026-10-03 第二轮最终候选：

- 目录折叠、元信息去重及页头主动作的有效 RED 为5项缺失行为失败，另1项原异常保留测试通过；GREEN共6项通过。定向回归69项与Web typecheck通过，日志 `workspace-reading-flow-red/green/regression/typecheck.log`。正文编辑与预览共用行距，未改变 Range/UTF-16选段与请求数据。
- 全仓库 `pnpm test` 853项、`pnpm typecheck`、`pnpm build` PASS，最终输出 `full-test-final.log`、`full-typecheck-final.log`、`full-build-final.log`；保留DOCX依赖504.50kB构建警告，不增加依赖或修改锁文件。
- 实际演示作品经浏览器保存2181字符、33段原创排版文本，CLI逐字核对仍approved/version3。桌面实际20px/37px行高/720px宽；手机18px/33.3px行高/335px宽，375×812首屏正文起点约y561，有衔接提示时仍显示开头。桌面起点约y329。两屏无横向溢出，正文DOM保持单个纯文本子节点。
- 最终亮暗桌面截图为 `workspace-light-reading-final.jpg`／`workspace-dark-reading-final.jpg`；手机首屏为 `workspace-mobile-reading-final.jpg`，未滚动裁剪。README已换为对应实际第二轮图。截图为演示作品和经编辑示例，不证明真实模型质量。字体仍按原本地资产及系统回退；没有验证所有系统字体或200%浏览器缩放。
- 新独立作品由真实浏览器完成创建→创意生成→编辑方向→页内确认取消/Escape与确认→编辑大纲→页内确认取消与确认→设定通过→章纲通过并生成正文→正文通过→页头开始第二章→第二章双关卡通过。CLI回读 `browser-flow-final.json`；原长期阅读作品回读 `browser-reading-final.json`。目录展开、历史章阅读、配置编辑后折叠/主题切换保留草稿且续章禁用、配置保存再恢复合法动作，均实际验证。原始操作摘要在 `browser-complete-flow.txt`。

三轮自校准：①代码与行为／测试一致，853项回归及实际双章覆盖新旧动作、草稿和状态保护；②代码与Wiki／术语一致，书名普通字体、正文参数、单一目录与资料只读边界已回写，不改变领域词或数据形状；③完整候选映射AC1–AC5，变化仅限现有前端视觉/入口、相应测试、资产与文档，原服务、作品库、provider、依赖与后端均未变。

### 十二项设计自查

| 项 | 草稿结果 |
|---|---|
| 1 风格声明 | PASS：BC 黑白灰工作台，全核心页面共用 token。 |
| 2 概念关系 | PASS：目录定位章节，正文承担主内容，资料/配置辅助创作。 |
| 3 token 语义 | PASS：底/内容/凹面、主/次墨色、边线；140ms 仅按钮装饰。 |
| 4 灰度主次 | PASS：本身为灰阶，正文标题、字号与中央宽度构成主角。 |
| 5 文案强调 | PASS：状态与操作说明各表达一个动作或事实。 |
| 6 数字/标题 | PASS：全局 tabular-nums、普通标题紧排；像素字体不紧排或合成粗体。 |
| 7 无动画可读 | PASS：动效仅 hover，reduced-motion 关闭后文字/边框完整。 |
| 8 诚实状态 | PASS：空态/未知/失败沿用真实状态；截图明确演示与编辑样例。 |
| 9 最小/最大屏 | PASS：第二轮375与1440长章真实首屏、无水平溢出；手机首屏出现正文，辅助功能保留入口。 |
| 10 内容/界面区别 | PASS：正文独立中文阅读字体，界面使用常规 sans。 |
| 11 反馈注释 | PASS：2026-10-03 BC与第二轮导航/字体反馈、日期及理由写入 styles.css／Workspace／ProseReview；按Human授权自主选择参数，不增加细节确认。 |
| 12 反模式 | PASS（豁免）：黑白灰是用户指定；无彩虹、假条目、emoji 系统或动效状态。 |

### 完成审核证据

- **清单与候选**：清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `19a30524fd0e7f34b3c5a8a99bb3bd4959b8ae2a`；双轴候选 T0 `5901e5300372e1e63259d3df465fbfd464ca1ae0`；pre-attestation tree（T1）`aaaadc0c2cd7013c52d07e127c6c087866cca9f4`。38个文件的staged manifest为 `candidate-manifest.txt`，完整二进制patch为 `candidate-full.patch`；全部证据位于 `/tmp/a4n-35-evidence/`。source为 `codex/35-frontend-redesign`，PR→main；T2不回写本候选。
- **逐项判定**：C1 PASS（C1.1–C1.8）：`issue-baseline/claimed/aligned-readback/round2-readback.json`、`dependencies.json`、`main.json/rulesets.json`与本页Human裁决、计划、固定点和范围；完成终态保留assignee 12bitsD、ready-for-agent、无Project，不联动其他票。C2 PASS（C2.1–C2.5）：本页各行为RED/GREEN、最终回归和逐AC映射；C2.6 N/A（本票有可执行行为，纯文档替代条款不适用）。C3 PASS（C3.1–C3.6）：最终全仓库门禁、candidate两种diff check、安全扫描、原始日志、38文件完整性；复用既有组件和业务接缝，正文单一纯文本，无重复状态机、额外依赖或联网。C4 PASS（C4.1/C4.2/C4.4–C4.6/C4.8/C4.9）：数字Wiki/索引、research、双语README真实截图、handoff、schema/链接校验和三轮校准；C4.3 N/A（数据形状与领域词未变，schema/CONTEXT不受影响）；C4.7 N/A（运行/CLI/provider/交付流程未变，运行skill与Agent规则不受影响）。C4.4的ADR条件未触发，票内可逆视觉决定已在research/Wiki记录。C5 PASS（C5.1–C5.7）：T0完整候选与两轴独立报告；固定点..HEAD为空，HEAD→T0已审计，staged外无余项，无review修复。C6.1 N/A（双轴无阻塞发现，不制造修复测试）；C6.2 PASS（最终门禁对应未再修改的实现）；C6.3 PASS（T1阶段仅转录本节预留字段，T1及发布前裁决保持pending）；C6.4 PASS（独立 `design35_spec_final` 对T0→T1精确范围、来源、完整候选、历史和余项核对通过，原始 `attestation-t1.txt`）。未测试所有平台系统字体、全部字符或200%缩放，作为显示差异风险，不用它们替代本次375/1440验收；不包含真实模型质量结论。
- **验收与 TDD**：#35 AC1 PASS（全核心页面统一灰阶与主辅分区，styles/ui和各页面；实际全前置及两章）；AC2 PASS（主动作/选中/焦点/禁用/错误/保存有文字和边线，异常与未知完整保留）；AC3 PASS（本地字体和4许可证、来源/hash/覆盖/回退；2181字符正文、375/1440亮暗图、18/20px与限宽）；AC4 PASS（真实浏览器创建、方向/大纲取消确认、设定/章纲/正文通过、页头续章、历史阅读、配置草稿保护；原版本与unknown回归）；AC5 PASS（双语README真实演示图及Wiki035交接）。有效RED/GREEN日志：`theme-behavior-red/theme-green`、`config-collapse-red/green`、`entry-pages-red/green`、`entry-dialog-red/green`、`workspace-reading-flow-red/green`；缺模块脚手架失败未作为RED。新增目录/去重/页头6项：5项缺失行为RED、1项异常保留原通过，全部GREEN。
- **本地门禁**：2026-10-03 `pnpm test` 853项、`pnpm typecheck`、`pnpm build`全部PASS（`full-test-final.log`、`full-typecheck-final.log`、`full-build-final.log`）；Web定向回归69项与typecheck通过。`git diff --cached --check`与`git diff --check <fixed-point> <T0>` PASS；Cubic 11许可证的一处上游行尾空格已归一，版权/条文不变；无依赖或锁文件改动。文本凭据/注入接缝/意外联网及ignored secret/data核对通过（`candidate-security.log`和Standards报告）；字体原二进制hash、许可证、README截图、前序006/007/043 frozen审核区和152本地链接校验PASS（`docs-validation-final-reading.log`）。既有DOCX 504.50kB构建警告与AI SDK mock警告保留，不作为真实provider调用证据。隔离demo 8795/独立SQLite完成浏览器两章与2181字符逐字回读，未操作原8787/5173服务或用户数据。
- **双轴 review**：未参与实现的 `design35_standards_final` Standards PASS；独立 `design35_spec_final` Spec PASS，AC1–AC5全部满足。原始报告 `standards-review.txt`、`spec-review.txt`；两轴均对应T0、互不读取对方报告，无确认的P0–P3缺陷或未满足AC。交付Agent接受结论，无待修复项；这些报告不代替后续attestation、CI或live关闭状态。
- **修复与回归**：双轴没有提出修复项。实现阶段修复确认框原生弹窗的工具阻塞、配置折叠草稿丢失风险、目录首屏占用与常规提示重复，均有对应行为/渲染验证；整仓门禁在最终实现后通过。后续变化只允许本节证据字段收口，若行为或文档事实改变则重新冻结审核。系统字体形态、200%缩放与真实长篇质量保留原未验证边界。
- **知识维护**：已更新Wiki035、直接前序006/007/043的当前路由/变化事件、Wiki索引、字体research、双语README/实际亮暗图、handoff；旧冻结审计字节不变。schema/CONTEXT N/A（无模型或词汇变化），ADR N/A（无不可逆跨票决定），运行skill/Agent规则 N/A（运行与流程无变化）。个人Work Wiki只消费既有输出风格，没有复制项目进度或改变知识归属。三轮校准已在本页分别记录。前序票的发布记录不重写。
- **发布前裁决**：C6.4 attestation PASS，2026-10-03，未参与实现的独立 reviewer `design35_spec_final`，对应T1 `aaaadc0c2cd7013c52d07e127c6c087866cca9f4`。原始 `attestation-t1.txt` 确认T0→T1仅改变这8项预留字段、字段外字节相同；转录忠实于原始来源、完整diff和38文件manifest一致、本地历史为空、index等于T1且无余项，两种diff检查通过。C1–C5分节及C6.1–C6.4证据、N/A与系统字体/200%缩放/demo质量边界均准确。后续C6.5–C6.7及最终C6判定、commit/PR/CI/关闭条件在GitHub完成评论保存，不在Wiki自记录T2或提前宣称远端完成。

## 边界与非目标

不改变后端协议、作品数据、模型/Prompt、关卡规则、正文自动保存、配置显式保存、原请求恢复、通过后编辑和章节隔离。不给未实现的检索/Wiki/统计编造入口，不自动生成或重写作品，不操作用户原服务、密钥或数据。新增导航不能绕过脏编辑/未知请求保护。

## 上下文演进

### 2026-10-03 — #47 细化阅读比例与中屏布局

- **触发证据**：#35 已由 PR45 合入 main 并关闭；作者继续要求优化“字体，空间，各个组件排布和大小”。#47 的 890px 短章基线显示左栏挤压、最小高度空白和阅读轴错位。
- **原假设**：#35 的 20px／1.85／36em 与手机折叠目录已改善首屏，尚未统一中屏、短章和各类控件的比例。
- **决定**：后续变化由 [Wiki047](./047-reading-layout-refinement.md) 承接，保留 BC 黑白灰、系统宋体／无衬线与像素品牌；本页改为 mixed，不继续承担当前阅读参数说明。
- **影响**：#47 收敛阅读列、标题与控件密度、短正文自然高度和 900px 单列布局；主题机制、单一正文与原版本／未知请求保护继续继承。#47 的本地候选与发布状态分开记录，终态以 GitHub 回读为准。
- **上下文处理**：preserve 本页原 Human 选择、第二轮原话、20px／1.85／36em 参数、700px 初始断点与冻结完成审核字节；replace 路由和当前交接入口，通过 changed_by 指向 047，不重写 #35 发布前证据。

### 2026-10-03 — 第二轮正文阅读与导航收敛

- **触发证据**：实装首版 375×812 首屏未显示正文，桌面正文上方存在重复章号、通过和保存说明。Human 提出“字体和大小，字号，行宽这些对阅读体验会有比较大的影响，导航页和重复说明改进掉，然后字体这些你看着怎么优化更有质感一些”。
- **原假设**：三栏与窄屏流式单列保留所有入口即可保证正文主次；实际手机导航占用过多首屏，长书名像素字断行，常规状态说明形成额外留白。
- **决定**：保持 BC 黑白灰；自主比较统一无衬线、正文宋体与界面无衬线组合、完整本地正文库三案，采用第二组合与像素品牌。桌面20px／1.85，正文最大36em；手机18px／1.85、左右20px。手机目录默认折叠，正文页头元信息去重，续章动作移至页头，辅助资料紧凑展示。参数以实际长章和亮暗截图验证后收敛。
- **影响**：新增目录折叠和正文页头行为验收，保留单一纯文本正文、原始换行和所有版本／未知请求保护；不新增全文字体下载或编辑器依赖。真实浏览器操作已在新临时页恢复，剩余流程继续验收。
- **上下文处理**：preserve 用户 BC 选择、首版测试和旧弹窗失败经验；replace 当前字体／首屏布局说明，保留首版截图作为对照；工程细节由 Agent 自主实施，本事件不是新的人工作业要求。

### 2026-10-03 — Human 选择 BC 组合

- **触发证据**：同概念三种 HTML 实际截图后，用户回复“感觉BC舒服些”。
- **原假设**：单一 B 推荐方向等待用户看图选择。
- **决定**：结合 B 工作台结构与 C 的清晰边界；像素品牌、普通中文正文、系统／亮／暗主题；工程细节自主落地。
- **影响**：主题控制新增公开行为测试，布局保留业务命令与导航保护；产品首版截图及十二项自查在触点二验收。
- **上下文处理**：preserve 用户原话、三稿与字体研究；replace 待选状态，不把 mockup 记为运行作品。

### 2026-10-03 — 从视觉待办进入看图对齐

- **触发证据**：用户指定 frontend-design skill 并要求完成、关闭 #35。
- **原假设**：票面原来只记录待办，像素字体范围、亮暗状态和统一样式尚未具体确定。
- **决定**：先制作同一概念的三个 HTML 设计方向，把视觉取舍集中到一次看图对齐；工程细节自主研究，不逐项询问。
- **影响**：覆盖书架、统一入口与全部核心创作页面；后端及业务保护沿用当前实现。
- **上下文处理**：preserve 原黑白灰/像素/中文阅读意图与既有人工决定；后续以明确事件更新选定方案和实际落地。

## 交接结论

#35 已交付并关闭，PR45、CI 和终止结果见 [GitHub 完成评论](https://github.com/12bitsD/agent4novel/issues/35#issuecomment-5966160627)。本页继续解释 BC 方向、主题和字体取舍，并完整保留本票发布前审核；阅读比例与中屏布局从 [Wiki047](./047-reading-layout-refinement.md) 接手，不能用 #35 的测试或审核替代 #47 完成证据。像素仍只限品牌，不加入全文字库或编辑器；系统宋体在不同设备的形态可能不同。旧原生弹窗失败是历史工具限制，第二轮页内确认已实际验证，不混用组件或 CLI 证据。
