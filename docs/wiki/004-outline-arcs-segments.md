# 004 — 大纲生成:弧线 + 剧情点两层结构(#4)

> Ticket: [#4](https://github.com/12bitsD/agent4novel/issues/4) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态:✅ 已落地(2026-08-28)

## 实现目的

spec 故事 7/8:作者要工具基于梗概生成全书大纲并 review/编辑,**以便锁死全书结构**。

本票推翻 #3b 的旧基线(「分章大纲,每章一句话」)。grill(2026-08-28)确认的新认知:

1. **大纲与章节解耦**——大纲是故事弧线层(英雄之旅式的冲突→发展→解决),不是 150 行章节一句话。章数规划推迟到 #5:拿出大纲的一段,才规划这段写几章。
2. **两层分工**——弧线给作者把方向(全书张力曲线),剧情点给 #5 当章纲切片的执行工作包,也给作者做局部编辑的单位。只有弧线则切片粒度太粗(#5 隐式再切,作者把不了关);只有剧情点则平铺几十个点,张力曲线被淹没。
3. ** review 粒度对了才好把关**——十几段弧线一屏读完;150 行章节没法 review。token 难题(单次 generateObject 装不下全部章节)随之消解,不需要 chapterCount 配置。

完成后 definition 变为 3 项,创意稿选定后自动链式生成大纲,作者在大纲关卡把关,通过后全书叙事结构锁定,成为 #13(设定)/#5(按章循环)的上游。

## 阶段假设

沿用 wiki 011:**当前存储生命周期等同于进程生命周期,无持久化数据、外部用户或跨版本兼容要求;迁移与回滚机制推迟至 #9 引入 SQLite 时设计。** outline contract 从 `{chapters[]}` 重写为两层形态不做任何兼容。

## 决策基线(grill 2026-08-28)

| # | 决策 | 结论 |
|---|---|---|
| 1 | 大纲形态 | **与章节解耦的两层结构**:弧线(arc)+ 剧情点(segment)。推翻 #3b「分章每章一句话」,CONTEXT/schema/contract/issue AC 连带改写 |
| 2 | 两层分工 | 弧线 = 一个冲突的完整生命周期(提出→发展→解决),消费者是**作者把方向**;剧情点 = 弧线内一个情节推进步骤,消费者是 **#5 章纲切片**与作者的局部编辑 |
| 3 | 弧线字段 | `{标题, 核心冲突, 冲突发展, 矛盾解决}`;「矛盾解决」prompt 要求写清**收束后的局势**——它是下一弧的起点 |
| 4 | 剧情点字段 | `{标题, 概要, 落点}`;**落点** = 本段结束时局势变成什么样,长线一致性锚点(#5 拿到切片即同时拿到起点与终点) |
| 5 | 字段纪律 | 只放大下游自己推断不出来的东西;场景/钩子/爽点节奏是章纲层职责,不重复放;人物走文本提名,不做结构化引用(详情归 #13 设定) |
| 6 | 标识 | server 注入稳定 `arcId`/`segmentId`(同 directionId 模式),编辑回传/上下移/#5 切片引用均靠它;web 永不生成 |
| 7 | 数量边界 | 弧线 3~8 条,每弧剧情点 2~8 个,schema min/max 卡死;无 chapterCount 类配置 |
| 8 | 领域词 | **弧线(arc)/ 剧情点(segment)** 进 CONTEXT.md;beats(撞章纲 beat)、爽点(撞 creative payoffs)弃用 |
| 9 | 输入 | `consumes: ['creative']`(恰好 1 方向守卫 #3c 已就位);seed 为固有输入;素材与 creative 不符在 creative 关卡解决,不透传到 outline |
| 10 | 触发 | 作者选定创意稿后,web 在 select 成功响应后**自动调 advance**(select 请求本身不挂起等 LLM);失败走已有 failed 态重试 |
| 11 | 保存语义 | `PUT /artifacts/outline` = 保存草稿,永远 pending,带 expectedHeadVersion 乐观锁;**单独「通过」** = 复用通用 `POST /approve {kind:'outline'}`,零新命令 |
| 12 | 读模型 | 最小扩展:`awaiting-outline-review` / `outline-approved`;`selected` 成为不可达态,**从枚举移除**(同 generating 的处置);泛化留 #5 |
| 13 | 编辑边界 | 弧线/剧情点都可增删改 + **上下移按钮**(纯函数好测);不做拖拽 |
| 14 | 级联关系 | 弧线改动 → 其下剧情点前提失效:v1 只在弧线编辑区放 UI 轻提示,不做级联校验;级联重生成归 #12(与其他节点的重生成一起设计) |
| 15 | 重选方向 | 当前链路不考虑:creative 选定后只读,回溯机制是 #6/#12 的事 |
| 16 | 呈现 | 弧线时间线卡片(强调色轮转:珊瑚→紫→青→琥珀→粉)+ 剧情点行内列表 + 顶部选定方向摘要窄条(可折叠)+ 底部保存 pill/通过细条(复用创意海报模式);通过后同版式只读 |

## 明确不做

- 分章大纲/章数配置(章数归 #5)
- 拖拽调序、张力曲线可视化
- 弧线改动的级联重生成(#12)、回溯重选方向(#6/#12)
- 人物/设定的结构化引用(#13 之后再说)
- 大纲的 fan-out/多方案(单次直出,同 creative 决策 4)

## 技术方案 V1

### 现状锚点(commit `d89199a`)

- definition 2 项:`caption(无关卡)→ creative(consumes caption, gateAfter)`;链式 advance、互斥锁、consumeGuards(creative 恰好 1 方向)、failed 读模型已就位
- `outline.ts` 还是旧形态 `{chapters:[{number,title,summary}]}`,无 strict/trim/上限,**无步骤注册**
- `workflowOf`(routes/works.ts)把 pipeline stage 硬编码映射到 creative 流四态:`awaiting-approval → 'awaiting-selection'`、`complete → 'selected'`——加 outline 后必须按 `pendingGate.kind` 分派
- 通用 `POST /approve {kind}` 已存在,仅对 creative 关闭(409);outline 可直接用
- web:Workspace 按 workflowState 渲染;CreativePoster 的保存 pill/底部细条/确认弹窗模式可复用

### 链路

```
创意海报「就按这个方向写」→ select 成功(单方向 approved)
  → web 自动调 advance(链式):
    ③ outline 步骤:consumes creative(守卫:恰好 1 方向)+ seed
       → 单次 generateObject 直出弧线×剧情点 → 注入 arcId/segmentId
       → 落库 pending(gateAfter)
  → 大纲 review 视图(awaiting-outline-review)
     保存 pill = PUT /artifacts/outline(草稿,pending,版本+1)
     「通过大纲 →」(带确认)= POST /approve {kind:'outline'}
  → outline-approved:只读,#4 终点(definition 目前到此 complete)
```

definition:

```ts
[
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
  { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
]
```

### contracts(packages/contracts)

- **重写 `outline.ts`**:
  - `outlineSegmentSchema = { segmentId, title, summary, outcome }`(剧情点:标题/概要/落点)
  - `outlineArcSchema = { arcId, title, conflict, development, resolution }`(弧线:标题/核心冲突/冲突发展/矛盾解决)
  - `outlineContentSchema = { arcs: min(3).max(8) }`,每弧 `segments: min(2).max(8)`
  - 全部 `.strict()` + trim + 非空 + 长度上限(标题 ≤30,文本字段 ≤500 量级,与 caption/creative 同标准)
- 改 `artifacts.ts`:`workflowStates` 移除 `'selected'`,新增 `'awaiting-outline-review' | 'outline-approved'`(5 态:ready-to-generate / awaiting-selection / awaiting-outline-review / outline-approved / failed)
- 旧的 `chapters[]` 形态整体删除(阶段假设:无兼容)

### server

- **`steps/outline-io.ts`**:`outlineLlmOutputSchema` = 弧线/剧情点均**不含 id** 的形态(同 creative 的 directionId 处理)
- **`steps/outline-step.ts`**:单次 generateObject;校验数量边界后注入 id——`arcId = ${workId}-arc-${i+1}`,`segmentId = ${arcId}-seg-${j+1}`;输入组装从 upstream 取 creative(单方向包)
- **`steps/skills/outline/SKILL.md`**:英雄之旅式弧线骨架 + 中文网文节奏;「矛盾解决」须写收束后局势(下一弧起点);剧情点「落点」必填;输入 = 选定方向包全文 + seed
- **`steps/fake-step.ts`**:`createFakeOutlineStep()` 确定性产出(如 3 弧 × 3 剧情点)
- **`routes/works.ts`**:
  - 新增 `PUT /api/works/:id/artifacts/outline`(saveOutlineDraft):body `{content, expectedHeadVersion}`;永远 pending;复用 assertHead 乐观锁
  - **保存时 id 规整**:body 的 id 可缺省(新增项没有 id),server 保留已注入的 id、给新项补注入;存储形态 id 必填
  - `workflowOf` 改为按 `state.pendingGate?.kind` 分派:
    - `ready` → failed(有 failure)/ ready-to-generate `['generate']`
    - `awaiting-approval` + gate creative → awaiting-selection `['save-draft','select','generate']`
    - `awaiting-approval` + gate outline → awaiting-outline-review `['save-draft','approve']`
    - `complete` → outline-approved `['save-draft']`
    - `blocked` → ready-to-generate `[]`
- **`index.ts`**:definition 加第 3 项;steps 注册 outline(demo ? fake : real)
- token 预算:3~8 弧 × 2~8 剧情点,输出量级在既有 maxOutputTokens 8000 内,不调

### web

- **`api.ts`**:`saveOutlineDraft(content, expectedHeadVersion)`;`approve(kind)`(通用);DTO 对齐新 workflowStates
- **`outline-review.ts`(纯函数,类比 creative-compare)**:状态 = `{arcs, drafts, dirty, saving, approving}`;commands = editArcField / editSegment / addSegment / removeSegment / moveSegment(up/down) / addArc / removeArc / savePayload / beginSave / beginApprove / on409(保 dirty);id 处理:新增项无 id,提交时交给 server 补注入。**vitest 覆盖,不引浏览器 E2E**
- **`pages/OutlineReview.tsx`**:按决策 16 的版式——顶部选定方向摘要窄条(方向名+hook+tags,可折叠);弧线纵向时间线卡片,强调色轮转;弧线四字段「提出→发展→收束」三段流排版,编辑区带轻提示「弧线的改动可能需要同步调整其下剧情点」(决策 14);剧情点行内列表(行内编辑、删除、上下移、+ 加一段);底部固定细条:脏时「保存草稿」pill +「通过大纲 →」(window.confirm,同 select);保存/通过互斥禁用;409 保留 dirty 并提示
- **`pages/Workspace.tsx`**:awaiting-outline-review / outline-approved → OutlineReview(后者只读);ready-to-generate 按钮文案按进度切换(creative 未 approved →「生成创意稿」;已 approved →「生成大纲」);**select 成功后自动调 advance**(决策 10),generating 仍为本地瞬态
- 沿用设计系统 token,内联样式只许 var(--*)

### 测试策略

| 层 | 覆盖点 |
|---|---|
| contracts | outline 收/拒(strict 多余键、空串、超长、数量边界 2/9 弧、1/9 剧情点);workflowStates 5 态 |
| pipeline | 3 项 definition 链式(caption 自动过 → creative 关卡停 → approve 后 → outline 关卡停);creative 未选定(2 方向 approved 异常路径)→ outline 不推进(守卫 blocked) |
| steps | outline prompt 含方向包+seed;id 注入位置正确;数量越界拒;fake 确定性出结构 |
| app(HTTP E2E) | 创建→advance→select→advance→outline pending→保存(版本+1 仍 pending,新增剧情点被补 id)→approve→complete;保存 stale 409;`selected` 不再出现 |
| web(vitest) | outline-review 纯映射:增删改/上下移/保存载荷/409 保 dirty/新增项无 id 提交 |

### 实施顺序(红绿切片)

1. contracts:outline.ts 重写 + workflowStates + 测试
2. server:outline-io/step/SKILL/fake + definition 第 3 项 + PUT outline 路由(id 规整)+ workflowOf 重映射 + 测试(**切片结束双绿**,web 暂以只读 JSON 呈现 outline)
3. web:outline-review 纯映射 + OutlineReview 视图 + Workspace 接线 + select 后自动 advance + 测试
4. 收尾:schema.md 同步(形态表 outline 行 + 人工保存语义行)+ handoff 刷新 + README roadmap

### 边界与错误

- creative 未选定(守卫不过)→ getState blocked / advance failed `direction-not-selected`(409 语义已在)
- 保存 stale → 409 version-conflict(web 保 dirty);并发 advance → 409 advance-in-progress
- LLM 非法输出 502 / 超时 504 / 不可用 503;重试 = 同一 advance(creative 已 approved 不重跑)
- 大纲 approved 后再编辑:UI 只读(决策 16),不再发 `save-draft` action;裸 API 保存仍可行(版本链天然支持),再编辑入口留 #6 详情页

## 评审留痕(落地后两轴 code-review + 真机实测,2026-08-28)

- **真机实测(deepseek-v4-flash)**:caption 3s / creative 49s 5K tokens / outline 54s 7K tokens,产出质量达标(弧线递进、落点链接续成立)。**抓到真 bug**:AI SDK v7 校验错误真名是 `AI_NoObjectGeneratedError`(带前缀),llm-call 映射只认无前缀名 → 已改 `name.includes` 并更测试
- **修**:workflowOf 按 gate kind 显式分派(隐式 else 会在 #13 错标);outline 数量边界常量单源(`outlineArcCount`/`outlineSegmentCount`);保存时 id 补注入改「现存最大序号+1」(与生成时位置编号同格式,原 uuid 后缀偏离决策 6);顶部窄条补 tags chips(决策 16);测试名残留 'selected' 清理
- **有意保留**:doApprove 脏时先存再通过(与 creative save-then-select 同模式);outline-step 对 upstream 的二次 parse(与 creative-step 同模式,接口层类型恢复);CreativePoster readonly prop(#6 回溯即用);outline-review 的 id 运行时守卫(有 hack-cast 测试覆盖)
- **误报**:守卫异常路径测试已在 pipeline.test.ts(评审者漏查)

## 状态记录

- 2026-08-28(grill):推翻 #3b「分章每章一句话」旧基线,确立「与章节解耦的两层结构」;16 项决策收敛(见决策基线)。命名撞车记录:beats 撞章纲 beat、爽点撞 creative payoffs,定 **弧线/剧情点**。隐形关系显式化:弧线改动级联剧情点,v1 轻提示,级联重生成归 #12。
- 2026-08-28(方案 V1):技术方案起草定稿,issue #4 AC 同步改写,待 /plan 执行。
- 2026-08-28(**已落地**):3 切片执行(切片 1+2 合并提交——contracts 破坏性变更与 server 切换天然耦合,单个绿提交)。演示模式 curl 全链路冒烟通过(创建→advance→select→advance→outline pending→保存补 id→approve→outline-approved)。124 测试绿(contracts 35 / server 65 / web 24)。顺手修复:README 双语残留的 interview 文案(#3c 清漏)。真模型 SKILL.md 效果未验,待有 key 后迭代。commits: 8897cd9(切片 1+2)/ 2aa61a2(切片 3)/ 收尾。
