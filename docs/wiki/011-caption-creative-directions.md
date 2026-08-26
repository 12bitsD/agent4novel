# 011 预处理重构:Caption + Creative 方向包 + 比较界面(#3c)

> Ticket: [#11](https://github.com/12bitsD/agent4novel/issues/11) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态:已对齐,待执行计划

## 实现目的

#3b 的 preprocess 把「理解素材」和「生成方向」混在一次 normalize 调用里。grill(2026-08-27)确认的 gap:

1. **没有提炼产物**——docx 设定集与一句话脑洞走同一条 normalize,「这份素材到底是什么」没有落点;方向生成错了分不清是理解错还是生成错。
2. **方向候选无绑定**——hooks/synopsis/setting/outline 四个平行数组,hooks[0] 与 synopsis[0] 是否同一方向靠隐式对应;作者无法在「方向」粒度上比较和选择。
3. **inputStage 是 caption 思想的残留**——只分类不提炼。

本票把 preprocess 重构为两步:**caption(理解层,提炼稿,自动通过)→ creative(生成层,N 个创意稿,比较视图关卡)**,并把方向比较展示给作者。

## 决策基线(grill 2026-08-27 拍板,两轮)

| # | 决策 | 结论 | Why |
|---|---|---|---|
| 1 | 流程结构 | caption 步骤 → creative 步骤,pipeline definition 两项,零新基建 | 理解/生成分层;理解错误在最便宜的点可纠正 |
| 2 | caption 关卡 | **不设关卡**,落库即 approved,不直接展示(仅比较视图里折叠「素材理解」只读区) | 作者见到的第一个产物是创意稿;减少一次点击 |
| 3 | interview | **机制整体移除**(definition interview 项、awaiting-interview 状态、answer-interview 路由、Entry 问答表单全删) | 识别>回忆:对不会写作的作者,看两个创意稿做选择比答 3-5 个问题门槛低;缺口由「比较选定+编辑+#12 重新生成」覆盖 |
| 4 | creative 生成 | **单次调用直出 N 个创意稿**(prompt = caption + 原始素材) | 创意稿是 hint 级产物,单次输出能力内;差异化在同一上下文里最强;比 fan-out 快近一半、实现最简。fan-out/sub-agent 模式留给 #5/#6 按章生成 |
| 5 | 方向个数 | `AgentConfig.directionCount`,默认 **2**,提示词插值;schema 校验 1~3 | 产品参数进配置(AgentConfig 第一个住户) |
| 6 | Creative 字段 | title / hook / tags / synopsis / characters / setting / payoffs / outline,**全 hint 级** | 装「选方向所需 + 下游种子」,不装细版 |
| 7 | 步骤间传递 | definition 条目加 **`consumes`** 显式声明;输入统一**从 store 读最新 approved**;产出即 await 落库;**advance = 推进到下一个关卡**(无关卡步骤链式执行) | 单一输入路径(内存直传与重启恢复同一条);crash-safe;存储耗时占比 <0.01%,延迟预算花在并发/prompt/流式 |
| 8 | 比较视图 | 创作界面内**全页「创意海报」**:tab 带方向名切换、编辑本地缓存、脏时浮动「保存」pill(双包落库 pending)、底部浮动细条「就按这个方向写 →」(单包落库 approved) | 浏览与选定分离——选定是流程动作(approved→解锁大纲),不能由 tab 点击隐式触发 |
| 9 | 选定机制 | 编辑即通过的细化:**creative 多包保存 = pending,单包保存 = approved**;被放弃的包留版本链 | 零新状态字段;后悔药在数据层免费 |
| 10 | approve 校验 | creative 被消费时恰好 1 包,校验在消费方输入组装处,不满足抛 KnownError → 400 | store 不感知形状的原则不破 |
| 11 | 中间态 | 阻塞 + loading(创作界面直达比较视图) | 本地单用户可接受;渐进展示留优化项 |
| 12 | 数据模型 | preprocess kind 拆为 **caption + creative** 两个 kind(5 节点 → 6 节点) | schema.md 同步 |
| 13 | 领域词 | Caption = **提炼稿**,Creative = **创意稿**(已进 CONTEXT.md) | 词汇红线 |
| 14 | 版本回看 | MVP 不做;选定在 UI 层是单向门,选定动作带确认提示;回退能力随 #6 详情页 | 范围控制;版本链数据层已支持 |
| 15 | 超长素材 | caption 输入硬截 **100K 字符** + UI 告知 | 覆盖 99% 场景;分段提炼记优化项 |
| 16 | 生成触发 | Entry 提交即自动 advance,创作界面 loading 直达比较视图 | 沿用现状,减少一次点击 |
| 17 | directionCount UI | v1 只做配置项默认值,不暴露 UI | UI 归 #7 Agent 配置 |

## 明确不做

- 跨包混搭不做结构化支持(选定后编辑 + 版本链取回;「爽点和设定不在一个方向上」是低频作者级操作)
- 图片输入(caption 先只吃文本;多模态是 caption 步骤的未来落点)
- 失败重试策略、重新生成入口(带补充想法输入框)、渐进展示 → issue [#12](https://github.com/12bitsD/agent4novel/issues/12)
- 版本回看 UI(决策 14,随 #6)
- 超长素材分段提炼再合并(决策 15 的优化路径,记 #12)
- directionCount 配置 UI(决策 17,随 #7)

## 技术方案

### 链路

```
Entry 提交(txt/md/docx/pdf 解析文本,>100K 字符截断+告知)
  → advance(推进到下一关卡,链式执行):
    ① caption 步骤:素材 → 提炼稿,落库即 approved
    ② creative 步骤:单次调用(caption + 原始素材)→ N 个创意稿
       gateAfter → 落库 pending
  → 创作界面:创意海报比较视图
    保存 pill = 双包新版本 pending;「就按这个方向写 →」= 单包 approved
  → #4 大纲步骤解锁(consumes: ['creative'],输入组装校验恰好 1 包)
```

### contracts

- `preprocess.ts` 拆为 `caption.ts` + `creative.ts`;`preprocessContentSchema`、interview 相关 schema(questions/answer)删除
- **captionSchema**:`{ inputStage: '脑洞|设定|主线|模板', summary: string, elements: Hint[], gaps: string[] }`(Hint = `{title, content}` 复用)
- **creativeSchema**:`{ title, hook, tags: string[], synopsis, characters: Hint[], setting: Hint[], payoffs: string[], outline: Hint[] }`;creative 产物 = `{ directions: creativeSchema[] }`(长度 1~3)
- `agentConfigSchema` 加 `directionCount: z.number().int().min(1).max(3).optional()`

### server

- **pipeline**:`PipelineDefinitionEntry` 加 `consumes?: ArtifactKind[]`;删 `interview` 项与 `pendingInterviews` 瞬态、`awaiting-interview` 状态、`answerInterview`;`advance()` 改为循环推进(无关卡步骤链式执行,产出即落库,遇 gateAfter/complete 停);`PipelineStage` 移除 `awaiting-interview`
- **步骤**:`steps/caption/`(SKILL.md + step)+ `steps/creative/`(SKILL.md + step)替换 `steps/preprocess*`;creative step = 单次 generateText(prompt 插值 directionCount、caption、素材)→ JSON.parse 剥围栏 → zod 校验
- **路由**:删 `answer-interview`;`PUT /api/works/:id/artifacts/preprocess` → `PUT .../artifacts/creative`(保存时按包数定状态:>1 包 pending,=1 包 approved);approve/advance 保留;`/api/config` 去掉 interview 字段
- **FakeStep**:caption fake(固定提炼稿)+ creative fake(两个固定创意稿),演示模式与测试全 fake 不联网
- `seed.ts` 演示数据同步新形态

### web

- **比较视图**(创作界面内,creative pending 时):tab(带方向名)切换 / 编辑本地缓存 / 脏时浮动保存 pill / 底部「就按这个方向写 →」(带确认提示)/ 折叠「素材理解」只读区
- **创意海报排版**:tag/爽点 chip 化、hook 引号焦点、synopsis 段落、人物卡片横排、设定词条式、主线箭头链
- Entry:删问答表单,提交后跳创作界面自动 advance(loading)
- idea 视图改为单包详情视图(选定后可编辑)

### 形状不变量(schema.md 同步)

- caption / creative:per-work,`chapter` 必须为 undefined
- creative approved 时 `directions` 恰好 1(消费方输入组装校验)

## 测试策略

- seam 不变:store / step 两个接缝;FakeStep 按新结构出样例
- 覆盖点:caption 自动通过(落库 approved);creative 单次调用产出双包(schema 校验);directionCount 插值与 1~3 校验;consumes 输入组装(creative 拿到 caption 内容;directions ≠ 1 → 400);保存规则(双包 pending / 单包 approved);advance 链式推进到关卡;旧 interview 路径零残留

## 实施顺序(红绿切片)

1. contracts:caption/creative schema + AgentConfig.directionCount + 测试
2. server pipeline:consumes + 链式 advance + interview 机制拆除 + 测试
3. server steps:caption/creative(Real + Fake)+ SKILL.md ×2 + 测试
4. 路由与 config:PUT creative(包数定状态)、删 answer-interview、/api/config 瘦身 + app 测试
5. web:Entry 简化 + 比较视图(创意海报)+ 单包详情 + api.ts 对齐
6. schema.md / CONTEXT.md / README / seed.ts 收尾同步

## 边界与错误

- creative 消费时 directions ≠ 1 → KnownError → 400「请先选定一个方向」
- 素材 >100K 字符 → 截断 + UI 告知
- creative 单包时「保存」pill 行为 = approved(规则一致)
- 模型输出脏 JSON / schema 不符 → 步骤失败 500 兜底(现状模式;重试入口归 #12)

## 状态记录

- 2026-08-27(grill 第一轮):方向包化方案对齐(14 项决策),issue #11 建立,#4 改挂 blocked by #11,#12 装优化项。
- 2026-08-27(grill 第二轮,深化修订):**推翻** LLM tool-call fan-out(4/6/7 项)——创意稿 hint 级,单次调用直出更快、差异化更强、实现更简,fan-out 留给 #5/#6;interview 从「挂 caption」改为**机制整体移除**;步骤间传递定案 consumes + 统一读 store + 链式 advance;比较视图定案「创意海报 v2」;保存规则细化(多包 pending/单包 approved);新增版本回看挂账(14)、超长截断(15)、设定完整版 gap → issue #13(block #5)。队列修订:#3c → #4 → #13 → #9 → #5。
