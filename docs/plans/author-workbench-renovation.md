# 作者编稿台：全量核查与详细改造方案

核查日期：2026-10-06（Asia/Shanghai）。代码基线：main `5ba9fe38062120231d42b8b64a8fc4b5e3cd1e23`；方案分支：`codex/author-workbench-design`。

本文承接[交互研究与路线比较](../research/author-workbench-interaction-plan.md)，是本轮详细改造清单的入口。用户认可方案方向并要求防遗漏核查；本轮交付方案，没有修改产品代码、开实施票、提交或发布。代码、测试定义、共享契约和公开路由已核查；未来验收场景没有写成已通过。

## 1. 目标、范围与读取方式

主线保持：**作品一直在桌上，AI递交下一份内容，作者负责修改、把关和决定何时继续。** 采用稳定作品框架＋产物适配，迁移时复用公共组件；首版动效采用局部CSS。

本次详细核查分为四层：

1. 所有可达页面、材料与辅助入口，见F01–F28。
2. 行为、API、CLI及存储接缝，见K01–K06；与首期相关的配套和后置能力分别说明。
3. 验证面，见V01–V10；每次开放新入口先验证对应保护。
4. 文档、记录与交付，见D01–D06。

编号用于后续需求→代码→测试→证据追踪，不是已创建的GitHub票号。每项区分“源码事实”“推荐任务”“待验证”；后续正式WHAT/AC仍进入GitHub issue，词义、数据形状、历史意图继续分别由CONTEXT/schema/Wiki承担。

首期涵盖一致框架、所有既有材料的呈现、真实状态与行动、内部导航保护、资料/配置/坏例、入口素材与文件读取保护、多端与减少动效。大纲可见版本条件按K01配套处理。详细待办、创建幂等、全部编辑自动保存、日期、历史版本读取、原生视图过渡是独立增强，不伪装为首期已有功能。

## 2. 已定约束与职责

- 保留BC黑白灰、像素品牌、宋体正文与无衬线界面。047的20/18px、1.8行距、桌面680px阅读轴和小屏常用44px控制继续作为起点；不重新选择字体。
- 作品身份与材料位置持续可见。当前阅读目标与服务器当前工作目标分开，历史回看不推动生成。
- 保存记录编辑，通过决定下游依据。已通过正文仍可编辑并保持通过；已通过创意稿、大纲、设定和章纲继续只读。提炼稿自动完成，没有人工关卡。
- 正文通过后停留阅读，下一章由作者显式开始；章纲通过与随后正文生成的结果分别表达。
- 外壳只组织显示，不自行拼写请求、回填基线、判断批准、推导下一章或重试；原控制器/API/服务端继续拥有业务权威。
- 状态反馈与动效分开。动画完成、请求已发出、HTTP200或模型自述都不是保存/通过生效的充分证据。
- 新的材料导航必须先接入未保存/锁定/未知请求保护，再开放给作者。

## 3. 推荐结构与身份生命周期

建议新增两类显示组件，路径为拟议位置，不代表已经存在：

| 显示层 | 拟议代码位置 | 接收内容 | 不承担的职责 |
| --- | --- | --- | --- |
| 作品框架 | `apps/web/src/WorkShell.tsx` | 作品身份、阅读/工作目标、导航、材料与辅助槽 | 模型调用、审批或第二套workflow状态机 |
| 材料框架 | `apps/web/src/MaterialFrame.tsx` | 材料标题、真实状态、内容、主次行动、恢复提示 | 通用保存/通过命令工厂、权限猜测 |
| 展示描述/适配 | 可同组件组织，确需共用再新增 `workbench-presentation.ts` | 将各控制器差异翻译为一致角色 | 丢弃节点保存差异、独立存储另一份业务状态 |

作品框架按作品ID稳定；章级WorkSession继续保留原作品/章key。保存导致版本变化时，编辑控件不应仅因版本号被重挂载。同章查看资料、主题或布局变化不改变编辑会话。真正换作品/换章时，先走guard，随后旧目标回调失去接收资格。

创意稿和大纲的编辑状态当前在页面内。新增主稿面切换有两条可行路线：保留原编辑器挂载、临时查看只读材料；或将必要状态提升到当前作用域的控制层。推荐先保留编辑器/侧栏参阅，确需主稿面切换时再迁移必要状态；不能只上报dirty后直接卸载编辑器，期待取消或返回能恢复输入。

统一显示描述至少有：作品ID；材料kind/章号/产物ID/版本；阅读模式与工作目标；本页编辑的实际保存状态；是否通过；在途操作目标；允许的主次行动与恢复行动。通过状态与保存状态独立，不能拿已落库基线的状态代表本页最新输入。

身份同时区分作品级（提炼稿/创意稿/大纲/设定）和章级（章纲/正文），全书材料不注入章号。需要分开三个目标：作者正在看什么、服务器最后确认的工作章/步骤、当前在途请求的目标。开始第三章尚未落库时，工作读模型可能仍是第二章；不能据此重写原请求目标。

纯主题/布局/折叠不额外发写请求、不重复正常读取；首次按需读配置或文件仍可按既有接口执行。辅助区的展开偏好可以归作品框架，编辑数据与在途请求仍按原owner保护；改变配置生命周期时，key/onGuard/取消接收资格必须一起验证。

## 4. 前端页面与组件改造清单

### 4.1 框架、导航与公共反馈

| ID | 当前核查 | 具体改造任务 | 位置与保留约束 | 验收关联 |
| --- | --- | --- | --- | --- |
| F01 应用外壳 | App共用品牌/主题，三类页面直接替换 | 统一进入作品前后的位置表达、跳到主内容、加载/不可用状态；身份栏替代重复书名 | [App](../../apps/web/src/App.tsx)、[main](../../apps/web/src/main.tsx)；进入或刷新不生成 | V01/V06/V08 |
| F02 稳定作品框架 | 作品与三栏由章级WorkSession渲染 | 作品壳置于章级会话外；导航、稿面和辅助保持角色；移动端流式重排 | [Workspace](../../apps/web/src/pages/Workspace.tsx)；保留章级隔离及两目标 | V01/V02/V08 |
| F03 材料框架/适配 | 各Review自行渲染页头或底部动作 | 共享页头、保存提示、行动与恢复槽；内容编辑器保持各自结构；只保留一份主要内容与主行动 | 五类Review、拟MaterialFrame；动作回调仍来自原控制器 | V02/V04/V07 |
| F04 guard汇总 | Workspace含设定/章纲/正文/配置/坏例与生成保护，缺创意/大纲输入 | 增加owner明确的dirty/locked/unknown报告；所有内部换材料/章/作品与离开走同一判断；注销旧owner | Workspace、CreativePoster、OutlineReview、Entry；未知结果不能被“放弃”写成撤销 | V01/V03/V05 |
| F05 URL与重入 | 初始读取work/chapter/view；replaceState，无popstate流程 | 保留现有链接；新材料地址需校验非法/缺失回退；刷新只读。首期受控导航稳定，真实Back/Forward按K06另定义 | App、[chapter-view](../../apps/web/src/chapter-view.ts)；beforeunload不等于同文档导航guard | V01/V05/V06 |
| F06 状态/恢复反馈 | 专用节点和Legacy恢复能力不同；生成可能HTTP200＋failed | 统一位置与语言，分别表达保存/通过/生成；合法拒绝、未知和冲突区分；只渲染实际可用恢复行动 | Workspace、各review/api/reducer、[request-deadline](../../apps/web/src/request-deadline.ts)；长等待保持原内容 | V03/V04/V07 |
| F07 行动与用语 | 创意/大纲主操作在底部，正文在页头 | 统一稿面页头行动；长页仅紧凑行动行可达；说明组合动作结果；状态语句短而准确 | Review、[ui](../../apps/web/src/ui.ts)、styles；自动完成不称作者批准，文件上传不称配置生效 | V04/V07/V08 |

### 4.2 书架、统一入口与导入

| ID | 当前核查 | 具体改造任务 | 位置与保留约束 | 验收关联 |
| --- | --- | --- | --- | --- |
| F08 书架读取 | 初始空数组同时代表读取中和真实空态 | 明确读取/空/失败；失败有可达恢复；不闪出假的“暂无作品” | [Bookcase](../../apps/web/src/pages/Bookcase.tsx)、api.listWorks | V01/V03/V07 |
| F09 作品卡片/进入 | 卡片有标题、素材预览、完成章数 | 与作品壳建立同一身份；整卡键盘可进入；继续打开当前工作，不暗调模型 | Bookcase、App；具体待办/最近编辑日期受K02/K04约束 | V01/V06/V08 |
| F10 创建前素材 | 输入/标题在本页，返回直离开；创建与生成分开 | 统一稿面关系；加未提交素材离开确认；创建在途/未知保留输入；只有合法响应确定作品身份 | [Entry](../../apps/web/src/pages/Entry.tsx)、api.createWork；不自动生成，不造保存/版本标记 | V01/V03/V06 |
| F11 文件解析 | parseFile异步返回后追加，没有解析次序/卸载协调 | 增加读取中和操作身份；明确按选择顺序追加，或只接最新选择；迟到结果不写另目标；创建前等待或明确取消接收 | Entry、[file-parser](../../apps/web/src/file-parser.ts)；保留TXT/MD/DOCX/PDF与失败粘贴替代、原截取提示 | V01/V03/V07 |

文件解析两种策略都可行。推荐维持“追加”语义并按选择顺序处理、明确在途状态；取消仅撤销UI接收资格，不能声称底层解析任务已终止。变更为仅接最新文件时须在票面和界面解释，不静默丢掉前一次导入。

### 4.3 全书准备与逐章写作

| ID | 当前核查 | 具体改造任务 | 位置与保留约束 | 验收关联 |
| --- | --- | --- | --- | --- |
| F12 创意稿 | 多方向编辑，显式保存全部方向，选定后只读 | 保留比较/选中身份；行动移共享槽；接未保存/在途guard；提炼稿只读；选定与生成大纲结果分开 | [CreativePoster](../../apps/web/src/pages/CreativePoster.tsx)、[creative-compare](../../apps/web/src/creative-compare.ts)、api；方向数量由真实数据决定 | V02/V03/V04 |
| F13 大纲 | 弧线/剧情点编辑，先保存脏输入再通用通过 | 保留层次/增删/重排和输入；接guard；行动与真实保存反馈统一；可见版本承诺依赖K01 | [OutlineReview](../../apps/web/src/pages/OutlineReview.tsx)、[outline-review](../../apps/web/src/outline-review.ts)、api | V02/V03/V04/V05 |
| F14 设定 | 卡片/补充栏目本页编辑，通过时一次提交；只读参阅用同renderer | 统一稿面/行动/错误和恢复槽；明确本页修改未落库；校验定位可达 | [SettingReview](../../apps/web/src/pages/SettingReview.tsx)、[setting-review](../../apps/web/src/setting-review.ts)、[setting-api](../../apps/web/src/setting-api.ts)；不造独立保存按钮 | V02/V03/V04/V07 |
| F15 章纲 | 计划与意见本页编辑，整份再生，通过后衔接正文 | 保留安排顺序；意见与通过区分；通过成功/正文生成失败分别反馈；等待期间原章纲可查 | [BeatReview](../../apps/web/src/pages/BeatReview.tsx)、[beat-review](../../apps/web/src/beat-review.ts)、[beat-api](../../apps/web/src/beat-api.ts)；只读已通过章纲 | V02/V03/V04 |
| F16 正文稿面 | 自动保存，预览单纯文本，已通过正文仍可编辑 | 以当前正文布局为适配基准；保持同textarea/原文/选段；编辑预览同有效内宽；异常近稿面 | [ProseReview](../../apps/web/src/pages/ProseReview.tsx)、[prose-review](../../apps/web/src/prose-review.ts)、[prose-api](../../apps/web/src/prose-api.ts)；不拆段、不清洗、不重开通过 | V02/V03/V05/V07/V08 |
| F17 显式续章 | 使用目标章和前章id/version，未知冻结原请求 | 通过正文后停留；开始下一章仍明确一次意图；核对/重试不自动改成最新基线或下一下一章 | Workspace.beginNextChapter/continueAfterBeat；服务器互斥与提交基线保持 | V03/V04/V05/V10 |
| F18 章节与回看 | 阅读章号与currentChapter独立；历史正文保存仍通过 | 同时表达阅读位置与工作位置；返回当前工作先走guard；目录一份；resize保留作者展开选择 | Workspace、chapter-view、App；历史回看不暗生成、不重写后章 | V01/V02/V05/V08/V10 |

提炼稿纳入F12/F19，只读说明“自动整理完成”，不新增人工通过关卡。创意稿保存全部方向仍保持待选定；设定与章纲没有独立草稿保存。适配层显示真实差异，不把所有材料套成正文自动保存。

### 4.4 参考、配置、坏例与公共交互

| ID | 当前核查 | 具体改造任务 | 位置与保留约束 | 验收关联 |
| --- | --- | --- | --- | --- |
| F19 创作资料 | 只取当前已通过head，本章章纲按所读章过滤 | 统一只读顺序、触发/内容关联、焦点返回和hiddenKinds去重；少量按需渲染 | [ReferenceMaterials](../../apps/web/src/pages/ReferenceMaterials.tsx)；资料回看不开放已通过编辑；当时生成版本依K05 | V02/V06/V07/V08 |
| F20 作者配置/文件 | 作品配置显式保存；UUID冻结，上传后仍须保存配置 | 辅助槽定位一致；收起保留编辑与未知提示；模型/偏好/节点覆盖/Prompt/Skill/版本文件入口完整 | [AuthorConfigPanel](../../apps/web/src/pages/AuthorConfigPanel.tsx)、api、[author-config契约](../../packages/contracts/src/author-config.ts)；不改已发操作的配置快照 | V02/V03/V04/V06 |
| F21 坏例/批注 | 来源版本/hash/UTF-16选段；备注本地；标记冻结与分页 | 保持正文近旁角色；收起不解除guard；恢复、分页、查看来源可达；切章前处理选段/备注 | [BadExamplesPanel](../../apps/web/src/pages/BadExamplesPanel.tsx)、ProseReview、[bad-example契约](../../packages/contracts/src/bad-example.ts)；不自动分析/重定位样本 | V02/V03/V07 |
| F22 确认弹窗 | 默认取消焦点，Tab环，Esc/背景均取消；原触发节点存在才返回 | 公共文案与锁定理由；取消保留输入；目标切换后有合法焦点落点；动作与退出动画时序分开 | [ConfirmDialog](../../apps/web/src/ConfirmDialog.tsx)、各调用方；仅确认执行写入，关弹窗不是取消服务器任务 | V01/V03/V04/V06 |
| F23 主题入口 | 系统/浅/深偏好，本地存储失败仍可切换 | 公共壳保持一份主题入口与组件身份；主题不重启编辑/模型/保存 | [ThemeControl](../../apps/web/src/ThemeControl.tsx)、App；继续浏览器偏好，不写作品数据 | V02/V06/V08 |
| F24 视觉与阅读 | 灰阶token、阅读轴、主次按钮与多处局部覆盖 | 统一稿面/资料/状态/行动角色；删冲突覆盖与重复说明，保留原内容；短章自然高度 | [styles](../../apps/web/src/styles.css)、ui及各Review；不靠颜色或动画表达唯一状态 | V07/V08 |
| F25 动效/减动效 | CSS关闭transition/animation；部分校验调用显式smooth滚动 | 仅换材料/展开/通过留痕；当前输入/选区不移动；JS滚动同样按偏好选择即时行为 | styles、SettingReview等调用方；先锁定操作再播效果，完成效果不解除业务锁 | V02/V06/V08 |
| F26 导航/字段可访问性 | 已有名称、地标、status/alert，新增壳会改变树与顺序 | 唯一主标题、skip-link、标签、aria-current/expanded、禁用理由和状态通告；触摸目标与错误定位 | App/Frame/Confirm/全部Review；状态通告不抢输入焦点，不写全面认证已通过 | V06/V07/V08 |
| F27 响应/请求边界 | API校验响应，超时不证明服务器未执行 | 适配统一恢复文案，保留work/章/id/version与原载荷；错目标、畸形4xx、5xx、HTTP200业务失败分别处理 | api、setting/beat/prose-api、request-deadline、各controller；前端不自动回放写操作 | V03/V05/V10 |
| F28 演示/运行信息 | 入口读取运行配置；高级配置可查看实际配置 | 保留演示与真实模式的准确说明；挪动入口后模式信息仍可达；读取失败不假称已连接模型 | Entry/AuthorConfigPanel/api.getConfig、Frame；运行/异常信息不显示密钥、完整执行prompt或供应商原始异常；作者自有文件预览保留 | V07/V10 |

F28是呈现迁移要求，不新增模型、Token设置或运行状态服务。未来显示更精确的模型在途/保存时间/来源信息，需要真实数据支持，不能靠视觉说明推导。

## 5. 数据契约、服务端、CLI与存储

### K01 大纲通过绑定作者可见版本：配套安全切片

**源码事实**：当前通用approve请求只有kind/chapter。Pipeline.approve读取服务端当前head，并在Store.setStatus传入head条件，因此已有服务端请求处理内的CAS；它仍不能证明作者之前看到的版本就是被通过的版本。这里不能笼统写“大纲完全没有CAS”。

**推荐任务**：从确认候选或保存成功回执取得原始版本；服务端提交事务重核同一作者基线，不在确认/重试时GET最新版本替换原意图。同版本重复已通过的响应、冲突和未知恢复需定义。

两条可行兼容路线：新增大纲专用条件请求/端点，保留旧通用接口明确的当前head语义；或扩展通用请求并协调调用方迁移。推荐先评估专用请求，使新Web/CLI明确绑定版本；旧接口是否收紧必须在实施票决定。新材料动作不能先无条件宣称所有节点都已具备此能力。

改造位置：[work-requests](../../packages/contracts/src/work-requests.ts)、[public-api](../../packages/contracts/src/public-api.ts)、[works routes](../../apps/server/src/routes/works.ts)、[Pipeline](../../apps/server/src/pipeline/pipeline.ts)、[WorkStore](../../apps/server/src/store/work-store.ts)、[InMemoryStore](../../apps/server/src/store/in-memory-store.ts)、[SqliteStore](../../apps/server/src/store/sqlite-store.ts)、Web api/OutlineReview，以及[CLI commands](../../apps/cli/src/commands.ts)、[client](../../apps/cli/src/client.ts)、[command-line](../../apps/cli/src/command-line.ts)、[main](../../apps/cli/src/main.ts)与CLI smoke。不能只更新Web后漏掉直接Client调用和帮助说明。

退出证据：A读v1，B保存v2，A通过v1被拒且保留A稿；A先保存为v2后B写v3，也不能偷换批准v3；重复/丢回复不追加错误版本；两Store与Web/CLI行为一致。K01在正式首期承诺“绑定可见版本”前是前置依赖，不靠换壳解决。

### K02 书架具体待办与兼容：可单独补充

当前摘要只有id/title/seedPreview/chapterCount；Web和CLI都用strict schema。首期“打开继续写作”沿用原入口即可。若展示具体工作章/待办，推荐服务器投影currentChapter/workflowState/nextStepId，不能从完成章数猜测。

推荐明确opt-in丰富摘要或独立端点，保留原列表；同版本同步升级也是可选路线。直接在原响应加字段会使旧严格客户端拒绝，新schema能读旧响应不等于双向兼容。需覆盖contracts、routes、两个Store的投影、Web/CLI list与客户端fixture。

位置与K01的列表/共享契约/Store相同，另涉及服务端[chapter-view](../../apps/server/src/chapter-view.ts)。验证未生成首章、章纲/正文待把关、历史修改后衔接、失败/重启、非法/缺失字段及新旧客户端矩阵；避免浏览器逐卡N+1拉详情。

该摘要只表示最后已确认的材料与下一步，不承诺跨进程持久的模型在途状态或失败历史。

### K03 创建幂等与结果查询：后置；若承诺安全重试则前置

目前create每次新作品ID，丢回复时无稳定操作ID。新增能力需要冻结载荷与requestId、同key/同载荷回同作品、异载荷复用key冲突、按操作身份查询；作品与回执须同事务保存。不能同名/同脑洞去重，也不能在每次重试生成新key。

位置：work-requests/api/Entry，works routes/Pipeline或创建服务、WorkStore/InMemory/Sqlite、[sqlite-schema](../../apps/server/src/store/sqlite-schema.ts)、CLI create/查询/flags/文件契约/help，schema与运行说明。旧seed/title请求的兼容语义、浏览器请求身份如何保留、持久回执生命周期需在此票明确。

验收必须包括并发、丢回复、重启回放只一作品、同key异载荷、写失败无半份结果、查询暂时404后请求才完成、未来/损坏schema拒绝及迁移；#46初始化竞争不静默并入。首期只保留输入并准确提示不确定，不装万能安全重试。

### K04 日期与排序：独立信息能力

已有Work/Artifact.createdAt；同版本定稿保留原createdAt。现摘要无日期，也没有作品updated_at。仅显示“创建于”可投影已有字段；“最近保存/编辑”必须先定义包括哪些成功活动，再持久化活动时间/事件并与成功提交同事务更新。

位置：artifact-envelope/摘要schema、两个Store/sqlite-schema、配置/坏例写入服务（若纳入活动范围）、Bookcase/CLI list与docs。验证通过同版本、配置保存、坏例、失败/no-op、时间相同与重启。不能用MAX(artifact.createdAt)冒充全部保存时间。

### K05 生成输入身份与历史全文：独立只读契约

章级产物记录可选inputs身份/版本；ReferenceMaterials读取当前approved head。当前公开GET和WorkStore没有任意artifact版本全文读取；受管Prompt/Skill或坏例读取不是产物历史读取。

首期标“当前已通过资料”，可显示确有记录的输入版本和衔接提示。若要打开生成当时全文，须新增只读Store方法、API/schema、归属校验、Web/CLI读取；历史缺inputs时如实缺失，不能回退到当前head冒充原输入。

位置：artifact-envelope、Pipeline输入记录、WorkStore/InMemory/Sqlite、works routes、ReferenceMaterials/Web api、CLI get/新查询、schema。验证前章正文v1改v2后，后章inputs仍指v1；当前资料为v2，历史读取若实现必须真读v1。非章级产物来源记录、#20版本比较和#21章节重生分别定义。

### K06 Legacy恢复：前端能力可分片，精确回执另需契约

创意/大纲保存有headVersion及append CAS，UI没有正文式冻结/读回。第一步可前端冻结原基线/载荷、区分拒绝/未知、保留编辑，受控读回只作有条件判断；精确按operationId查结果需要后端回执，不把相似内容当原请求成功。

位置：creative-compare/outline-review/API、Review、Workspace和CLI Client错误边界；大纲通过恢复依赖K01。先定义各恢复行动的真实证据，再增加共享槽。

浏览器历史另对应F05：当前App用replaceState、没有popstate协调。默认保留可刷新旧链接和受控内部导航；若首期要完整Back/Forward，必须在新导航开放前接guard、取消后恢复URL/目标且无历史循环。beforeunload只能辅助整页离开，移动端不保证可靠，不能代替持久化或同文档导航保护；依据[MDN说明](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)，本轮核验日期2026-10-06。

## 6. 全前端文件归属：防止漏改或误改

| 文件组 | 本轮处理 | 关联 |
| --- | --- | --- |
| App/main/Workspace/五Review/Bookcase/Entry | 框架、槽、导航与反馈主落点 | F01–F18 |
| ReferenceMaterials/AuthorConfigPanel/BadExamplesPanel | 辅助位置与生命周期/guard | F19–F21 |
| ConfirmDialog/ThemeControl/styles/ui | 公共交互、视觉、响应式与焦点 | F22–F28 |
| creative-compare/outline-review/setting-review/beat-review/prose-review/chapter-view | 原业务与派生状态保留，必要接guard/适配；不全量重写 | F04/F12–F18/K06 |
| api/setting-api/beat-api/prose-api/request-deadline | 保留校验、身份和未知；新增契约时定点修改 | F27/K01–K06 |
| file-parser/docx/pdf | 保留深层解析/格式边界，只在调用方协调在途与接收资格 | F11 |
| setting-markdown/finite-markdown | 保留受限安全renderer，不改为innerHTML或让正文走Markdown | F14/F19/V07 |
| 各现有测试 | 按下节复用；定向测试后再完整门禁 | V01–V10 |
| 新显示层与测试 | 路径建议见第3节，数量以真正职责为准 | F02/F03 |

全文件组依据`apps/web/src`及`apps/web/test`清单核对。这里没有宣布所有文件都要改；保留项也进入回归，防止“统一框架”误动解析、纯文本、安全与原业务。

## 7. 测试与验收矩阵

以下“已有”指读过源码/测试定义，不是本轮运行通过。新增是未来有效RED→GREEN和浏览器场景。

| ID | 验证面 | 已有入口 | 必须新增/强化与证据 |
| --- | --- | --- | --- |
| V01 | 进入与全部未保存导航 | App.continuation/prose、Workspace.continuation/config-navigation、EntryPages | 创建素材/创意/大纲/设定/章纲/正文/配置/坏例逐一离开、换材料、章、作品；取消保留全部。输入值、POST数、实际UI |
| V02 | 控制器、光标与保存 | Workspace.autosave、reading-flow、ThemeControl/App.theme | 同textarea身份、保存中继续输入、旧响应回收、主题/资料/布局往返、中文输入法；挂载断言＋真实输入验证 |
| V03 | 未知、合法拒绝与迟到 | api-contract、setting/beat/prose-api/reducers、Workspace.generation/continuation | 网络/5xx/畸形4xx/错目标/一次读回失败/旧请求晚完成；原输入/请求/版本保留，不自动写重放 |
| V04 | 本份通过与下份生成 | Workspace.beat/prose/continuation、BeatReview、EntryPages | 通过成功后生成失败或未知、丢通过回执、双击；两结果分开；正文通过停留，显式下一章 |
| V05 | 条件版本与两目标 | server Store/prose-routes/process、Workspace.autosave/continuation | 多客户端旧基线拒绝、历史读写不改工作进度、旧章改后后章保留/提示；K01新大纲版本条件两Store/CLI |
| V06 | 键盘、焦点与重入 | ConfirmDialog、EntryPages、App.theme/continuation、配置测试 | 新地标/Tab顺序/Skip/Esc/遮罩/收起返回触发器、触发器被卸载后的落点；URL刷新不生成，历史策略按K06边界 |
| V07 | 原文、来源与安全 | ProseReview.bad-examples、prose-save、setting-markdown/file-parser | emoji/重复选段/空行/hash/版本不变；只标已保存选段；只读不执行HTML/链接；上传错序、模式诚实，状态通告不夺焦点 |
| V08 | 多端、阅读与减少动效 | reading-flow/styles/ThemeControl定义 | 320/375/768/890/1024/1440亮暗，长短正文/长书名/长标签/错误/配置/资料；有效内宽、44px常用控制、JS/CSS降级、无横溢或遮挡 |
| V09 | 保留/迁移与重启 | sqlite-store/restart/process、config/bad-example tests | 原已保存作品/配置/文件/坏例保持；新契约迁移按K项；刷新恢复边界不夸大为未提交编辑或模型调用恢复 |
| V10 | 完整入口与发布 | server fixtures、CLI continuation/integration、production/container-smoke | 页面实际走完脑洞→全书准备→两章双关卡→旧章编辑→恢复。CLI铺夹具/核对，不能替代页面通过操作；实际CI与远端结果 |

所有未来改动先跑定向验证，再按仓库脚本执行test/typecheck/build、diff/范围/安全检查。真实浏览器证据与CLI、模拟数据和真实模型分开。无需为这轮界面改造调用真实模型证明文学质量，也不沿用旧857项或旧截图当新框架通过。

必要人工验证：连续四条作者路径；窄宽亮暗与减少动效；中文输入与选区；键盘完整操作。辅助技术、跨系统字体和大规模性能没有实测时必须列限制，不能以DOM单测替代。

## 8. 建议工作包、依赖与退出条件

| 包 | 范围 | 前置依赖 | 交付/退出条件 |
| --- | --- | --- | --- |
| W0 风险样片 | F02/F03/F06/F16最小正文框架、状态/恢复展示契约 | 本方案范围锁定 | V02/V06/V07先证明不重挂载、不额外写入或重复读取、不改变文本/选段；否则调整身份边界 |
| W1 入口与导航护栏 | F01/F04/F05/F08–F11 | W0；创建/历史策略明确 | 书架真三态、素材离开、上传错序/迟到和URL重入；受控导航不绕guard |
| W2 全书准备 | F07/F12–F15/F19及对应适配 | W1；新切换先guard；若承诺可见版本则K01 | 全书准备按真实保存规则交接；确认取消不丢输入；通过与生成分别表达 |
| W3 逐章与辅助 | F17/F18/F20–F23/F27/F28 | W2；冻结目标与配置/坏例guard完整 | 两章、旧章编辑、配置/选段与未知恢复贯通，后章不自动重写 |
| W4 视觉、可达性与交付 | F24–F26/V01–V10/D01–D06 | 每包保护已经通过；非最后才首测 | 实際界面与所有门禁、独立审核、文档及远端回读完成 |
| 后续独立增强 | K02–K06的新增契约部分、下面后置项 | 各项承诺/兼容/生命周期确定 | 只对有契约和实测的能力开放入口 |

F06共享状态与恢复槽由W0建立，W1–W3逐节点接入并用V03/V04/V07验证；恢复动作仍来自各原控制器。每包都带基础样式、真实状态和保护测试。W4是完整收口，动效/焦点/异常并非最后才接入。每个包可成为独立实施票；只在范围与验收真的完成后关闭，不把“已列计划”或“组件已抽取”当完工。

## 9. 文档、上下文与工具改造

| ID | 落点 | 需更新的内容/触发条件 |
| --- | --- | --- |
| D01 | 新实施票Wiki＋Wiki索引 | 每项F/K/V映射到WHAT/AC/代码/证据，记录实际落地与变化；035/047原Human/参数/冻结audit字节保留，只补后继路由 |
| D02 | README.md/en＋真实workspace图片 | 作者入口、保存策略差异、资料/配置/坏例、恢复和限制；中英事实一致，截图明确演示/人工编辑，不塞逐票门禁 |
| D03 | docs/handoff.md | 当前包、已定规则、遗留与下一步；关闭以GitHub实际回读，不把草稿计划写成已开发 |
| D04 | docs/schema.md、CONTEXT、ADR | K项真实字段/不变量或词义/架构变化才更新；纯显示层记N/A，不复制权威；新不可逆决定另ADR |
| D05 | CLI帮助/测试与运行skill | 仅K项确实改变命令/操作时更新，命令发现零副作用、stdout纯JSON、版本文件原样保留；运行HOW仍指016 |
| D06 | 完成清单与记录 | 正式实施走C1–C7、三轮校准、独立双轴、有限证据收口、当前候选CI/合并/关闭回读；本次核查没有实现PASS或发布结论 |

## 10. 明确后置与尚未证实事项

以下已盘点，但不静默加入首期：全部产物自动保存/跨会话本页编辑恢复；创建安全重试与任务持久查询；最近编辑时间/排序；任意历史全文、#20版本比较/#21章节重生；书级Wiki/工具检索/#17设定后改；SSE/逐字模型中间态；原生共享元素或React升级；跨进程生成lease；大规模长篇性能与全面无障碍认证。书架详细待办可先独立小票，基础入口不依赖它。

未证实的关键点都有验证归属：新框架实际挂载树/继续输入→W0/V02；完整browser history→F05/V06；上传错序→F11/V01/V07；大纲可见基线→K01/V05；丰富摘要兼容与读取成本→K02/V10；创建幂等迁移→K03/V09；时间与历史来源→K04/K05；新界面连续性和阅读效果→W4/人工验收。

## 11. 精确代码定位附录

以下行号属于本次固定点，用于定位当前逻辑；改造后按symbol重新核对，不把旧行号当新实现证据。

| 入口 | 当前定位与重点 |
| --- | --- |
| App | initialView:9、navigate:19、公共壳:46；URL与三类页面 |
| Workspace | WorkNavigation:28、WorkSession:37、acceptWork:84、refresh:125、dirty/locked:143、beforeunload:157；章key与旧响应隔离 |
| Workspace命令 | runSetting:201、continueAfterBeat:217、runBeat:229、正文命令:266、beginNextChapter:296、autosave effect:342 |
| Bookcase | state/effect:13、卡片:35、空态:52 |
| Entry | onFiles:35、submit:50、返回:69；输入、解析和创建 |
| CreativePoster | doSave:154、选定逻辑:169、底部行动:341 |
| OutlineReview | doSave:48、doApprove:66、通用approve调用:80、底部行动:264 |
| SettingReview/BeatReview | 设定校验滚动:26、页头:63；章纲页头:40、计划/意见/整份动作 |
| ProseReview | select/selectPreview:29–40、页头:43、恢复行动:59、纯文本/textarea:65–70 |
| ReferenceMaterials | 组件:14、当前approved head:16、只读renderer:36 |
| AuthorConfigPanel | guard:28、run:50、UI:129、Skill读取:153、上传后保存提示:160 |
| BadExamplesPanel | 组件:8、submit:43、冻结/核对/分页 |
| 公共组件 | ConfirmDialog effect:12/keyDown:19；ThemeControl effect:13；ui fieldStyle:6/btnPrimary:28/btnSecondary:40 |
| 样式 | styles.css tokens:9、工作台:80、正文:140、窄屏:191、reduce:215 |
| API/契约 | api invalidResponse:17/listWorks:107/createWork:114/approve:147；work-requests summary:11/approve:26 |
| 服务端 | works列表:328/创建:330/详情:344/通过:498；Pipeline.approve:476/setStatus条件:484 |
| CLI | commands.approve:73/client.approve:197/smoke approve:238；还需main、command-line与Client合同 |

## 12. 核查方法、来源与交付状态

本轮从页面/组件、状态与契约、质量与文档三条线并行只读核查，合并后按实际文件组复核。主源码为本页全部链接；其中Store/Pipeline/CLI接缝也已定位，现有测试定义已阅读。

报告中的源码字段、保存策略、权限与挂载边界是静态核查事实；缺少某种协调机制所提示的竞态是未来复现/验收目标，不等于此次已触发故障。新框架、各新增契约、CSS/JS效果和浏览器体验均未实现或实测。没有启动新服务、调用模型、读取用户secret或更改用户数据库。

当前交付：本详细方案、原路线研究及第一方资料。没有提交、推送、PR、闭票或开发结果。未来授权实施时将选定工作包及契约策略写入正式票面再开始；普通视觉参数、文件拆分和可逆工程细节按本方案推荐自主收敛，扩大保存策略/兼容语义/数据生命周期时才升级关键产品裁决。

防遗漏复核已完成：页面/组件线与状态/契约线均确认覆盖充分，未发现阻止本轮方案交付的关键遗漏。页面复核指出F06共享状态/恢复槽缺工作包责任，已补入W0并明确W1–W3接入与V03/V04/V07验证。契约复核确认服务端CAS与可见版本、严格客户端兼容、创建回执、日期与历史输入的边界准确。复核没有运行产品测试；所有未来效果仍须按各工作包证明。

### 2026-10-06 — 实施授权与方案复核

用户要求“review一下看下有没有遗漏，没有的话我们就直接开发”。独立计划Standards/Spec分别PASS、无关键阻塞，条件授权成立。首期进入[#49](https://github.com/12bitsD/agent4novel/issues/49)，源分支codex/49-author-workbench；W0–W4/F01–F28＋必要K01执行，后置范围保持。此前“仅研究/方案、没有实现授权”是该阶段历史，不覆盖这次新授权；代码、实际验证和后续交付从[Wiki049](../wiki/049-author-workbench.md)续写，不能把方案PASS当成新产品通过。

普通取舍已收敛：保留编辑器挂载、资料侧参阅；文件按选择顺序追加；大纲专用请求带artifactId＋version且CLI文件显式，旧接口保留current-head语义。F28限制仅运行/异常信息，作者自己的Prompt/Skill输入、预览和版本读取不删除。已认可的公开UI/API/契约/Store/CLI验证接缝沿用，不重开普通HIL。
