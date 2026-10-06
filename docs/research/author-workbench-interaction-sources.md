# 作者编稿台：交互、状态与动效资料

核验日期：2026-10-04。基线 main `5ba9fe38062120231d42b8b64a8fc4b5e3cd1e23`。本篇仅提供方案依据，不实现前端、不升级依赖，也不宣称浏览器或无障碍验收已完成。沿用 BC 黑白灰、现有字体与“作者的编稿台”概念。

## 建议与适用边界

推荐首版采用**持久的编稿台骨架＋局部 CSS 动效**：作品导航、正在处理的内容、该内容的资料各有稳定位置；展开工具不重建正文会话，状态反馈不依赖动画。原生 View Transition 可在已允许的视图切换上做独立小验证，通过后渐进加入；升级 React 19.3 是第三条可行路线，但不作为本轮默认前置条件。这是对项目风险和范围的设计判断，不是外部资料证明的实现效果。

## 已核实事实

**项目版本与身份。** [manifest](../../apps/web/package.json) 写 `^19.0.0`；[lockfile](../../pnpm-lock.yaml) 的实际 React/React DOM 是 **19.2.8**，类型为 19.2.x。独立在 web 包内导入实际模块，得到 `version:19.2.8`、`ViewTransition:undefined`、`Activity:symbol`、`startTransition:function`，没有运行应用或调用模型。因此当前不能直接使用 `<ViewTransition>`。React 官方于 **2026-09-09** 发布 19.3，明确宣布 View Transitions 转为稳定；当前参考页显示 v19.3。最新官方示例与项目安装能力必须分开，不能继续泛称其“只能 Canary 使用”，也不能把该示例粘贴为当前可运行代码。[S1][S2]

React 将状态关联到树中的组件位置和身份；移除、替换类型或更换 `key` 会重建对应状态。官方给出 CSS 隐藏或把重要状态上提等保留方式，也指出保留很多隐藏 DOM 的成本。[S3] 项目 [WorkNavigation](../../apps/web/src/pages/Workspace.tsx) 按作品和章节为 `WorkSession` 设置 key，当前章级隔离不能因动效而取消；同一章内查看资料则不应意外触发新的会话身份。这是源码事实及其设计约束，不是此次已改造的能力。

**隐藏不等于暂停方式相同。** 官方 `Activity` 在隐藏时保留状态和 DOM，但清理 Effects，显示时重建 Effects。[S4] 项目虽然已导出 Activity，也不能把现有配置隐藏逻辑直接替换为它：自动保存计时、订阅或未知请求核对若依赖 Effect，其暂停影响必须另测。仅收起视觉工具，首版仍优先保持现有组件身份与行为；确需暂停的后台内容再单独定义生命周期。

**原生与 React 动效不是同一个接缝。** 浏览器 `document.startViewTransition()` 接收视图更新回调；MDN 示例检测 API，不支持时直接执行同一更新。[S5] `skipTransition()` 跳过动画但仍执行更新回调，因此跳过动画不等于取消保存或生成。[S6] React 的 `flushSync` 可迫使 DOM 同步提交，但官方提醒它可能影响性能、运行待处理 Effects 或显露 Suspense fallback，应少用。[S7] 当前若尝试原生 API，需证明 React 提交时序确实满足快照要求，不能只调用 `setState` 就假定截图已经是新视图。

**导航和反馈。** W3C 一致导航要求重复导航维持相对顺序，允许用户主动改变；它不规定必须三栏，也不要求各屏幕像素位置相同。[S8] 状态消息应通过角色或属性被辅助技术识别，并可在不夺取焦点时通知用户。[S9] 对本项目的推断是：作品导航和资料入口保持可预测顺序；“保存中、已保存、结果未确认”有一处真实文字反馈，重试入口仍可找到。成功闪动、面板滑动和持续转圈都不能替代结果语义。

`prefers-reduced-motion: reduce` 表示用户已请求减少运动，MDN 提供按此降低或替换动效的方法。[S10] 当前 React ViewTransition 文档也明确其不会自动禁用该类动画。[S2] 本项目拟对减少动效关闭位移、缩放与视图过渡，保留即时状态文字和焦点提示；具体时长和是否保留淡入属于设计参数，需原型验证。

## 可借鉴的产品职责

Scrivener 官方介绍左侧 Binder 提供项目概览、中央 Editor 承载写作、右侧 Inspector 提供备注等信息；Binder/Inspector 可以隐藏以专注，Editor 是三者中保持可见的部分。[S11] Inspector 的官方说明涵盖梗概、笔记、元数据、快照和评论等资料。[S12]

这里只借**组织／编写／查看上下文**的职责分离，不照搬其功能清单。项目可将作品与章节导航视作“目录夹”，当前产物作为“稿件”，资料区呈现与当前稿件有关的已通过材料；作者配置是生成参数，不能冒充稿件本身。自动保存和审批状态继续来自本项目的权威读模型。Scrivener 的快照、导出与离线能力不因此成为本项目承诺；这也不是产品采购推荐。

## 三条可行路线

| 路线 | 机制与收益 | 成本、降级与选择 |
| --- | --- | --- |
| A：稳定骨架＋CSS（首版推荐） | 继续使用 19.2.8；先明确组件身份与业务状态归属，局部边界、透明度或小范围展开提示帮助辨认变化；正文和操作区始终可用 | 手工定义哪些变化值得动画，复杂跨位置共享元素效果有限；减少运动时即时切换。无新增依赖，也不改变切章与请求保护 |
| B：A＋原生视图过渡 | 功能检测后，仅为资料切换或已批准的导航做快照过渡；缺少 API 时走 A 的同一状态更新 | 增加 React 提交时序、焦点、快速连点和快照命名协调；需要独立浏览器小验证。动画失败只退回即时呈现，不重发业务请求；不是全站自动套用 |
| C：升级至稳定 React 19.3 | 经独立升级验收后，用框架 ViewTransition 协调指定视图边界；如需要隐藏状态保留，再评估 Activity | 更新依赖、类型与锁文件，重新验收 Effects、输入、请求和浏览器降级。React 官方页说明其协调原生过渡，不应再另起一套手工调用争抢；首版不默默升级。[S2] |

A 与 B 可以组合；C 是后续替代 B 的框架路线，不能把两套协调器叠到同一动画。三条路线的业务结果相同：动画只解释已发生的视觉变化，不能授予操作权限、改变章级身份或成为操作成功条件。

## 实施前最小验证

先做 A 的一个完整场景：编辑正文→展开资料→收起→切换主题；草稿、选段与版本不变，键盘能回到触发入口，关闭动效仍能解释状态。另验证有修改／未知请求时切章被原规则拦截，错误和恢复控制不被收起工具遮蔽。

B 的独立验证只使用合成数据：支持与不支持 API、减少运动、快速连点、取消动画、异步内容返回和焦点恢复各跑一次。通过条件是目标视图只提交一次、失败不丢内容或重复请求；未通过则首版停留 A。C 先核对升级后实际导出与类型，再跑同样场景和既有业务回归。此次仅完成资料与当前包导出核验，尚无上述原型、端到端、跨浏览器或辅助技术通过证据。

## 第一方来源

以下均于2026-10-04读取；发布日期按原页面，不把旧产品文章解释为最新版本全功能保证。

- [S1 React 19.3 发布，2026-09-09](https://react.dev/blog/2026/09/09/react-19-3)
- [S2 React ViewTransition 当前参考页，v19.3](https://react.dev/reference/react/ViewTransition)
- [S3 React：保留与重置状态](https://react.dev/learn/preserving-and-resetting-state)
- [S4 React Activity：隐藏时的状态与 Effects](https://react.dev/reference/react/Activity)
- [S5 MDN：使用 View Transition API 与功能检测](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using)
- [S6 MDN：skipTransition](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition/skipTransition)
- [S7 React flushSync：同步提交与代价](https://react.dev/reference/react-dom/flushSync)
- [S8 W3C WCAG 2.2：一致导航说明](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html)
- [S9 W3C WCAG 2.2：状态消息说明](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [S10 MDN：prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [S11 Literature & Latte：Tame the Scrivener Window，2021-05-19](https://www.literatureandlatte.com/blog/tame-the-scrivener-window)
- [S12 Literature & Latte：Get to Know the Scrivener Inspector，2022-11-30](https://www.literatureandlatte.com/blog/get-to-know-the-scrivener-inspector)
