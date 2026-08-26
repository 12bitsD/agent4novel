# 011 预处理重构:Caption + Creative 方向包 + 比较界面(#3c)

> Ticket: [#11](https://github.com/12bitsD/agent4novel/issues/11) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态:✅ 已落地(2026-08-27)

## 实现目的

#3b 的 preprocess 把「理解素材」和「生成方向」混在一次 normalize 调用里。grill(2026-08-27)确认的 gap:

1. **没有提炼产物**——docx 设定集与一句话脑洞走同一条 normalize,「这份素材到底是什么」没有落点;方向生成错了分不清是理解错还是生成错。
2. **方向候选无绑定**——hooks/synopsis/setting/outline 四个平行数组,hooks[0] 与 synopsis[0] 是否同一方向靠隐式对应;作者无法在「方向」粒度上比较和选择。
3. **inputStage 是 caption 思想的残留**——只分类不提炼。

本票把 preprocess 重构为两步:**caption(理解层,提炼稿,自动通过)→ creative(生成层,N 个创意稿,比较视图关卡)**,并把方向比较展示给作者。

## 阶段假设(评审 #19/#20 驳回的依据)

**当前存储生命周期等同于进程生命周期,无持久化数据、外部用户或跨版本兼容要求;迁移与回滚机制推迟至 #9 引入 SQLite 时设计。** #9 之后的 schema 变更必须走 expand → migrate → contract。

## 决策基线(grill 2026-08-27 两轮 + 方案评审)

| # | 决策 | 结论 |
|---|---|---|
| 1 | 流程结构 | caption 步骤 → creative 步骤,pipeline definition 两项,零新基建 |
| 2 | caption 关卡 | 不设关卡,落库即 approved,不直接展示(仅比较视图折叠「素材理解」只读区) |
| 3 | interview | **机制整体移除**(definition 项、awaiting-interview、answer-interview 路由、Entry 问答表单) |
| 4 | creative 生成 | **单次调用直出 N 个创意稿**(`generateObject` structured output);fan-out 留给 #5/#6 按章生成 |
| 5 | 方向个数 | `AgentConfig.directionCount` 默认 2,范围 1~3;**生成时严格校验 `directions.length === directionCount`**,Fake 与 Real 同一校验 |
| 6 | Creative 字段 | title / hook / tags / synopsis / characters / setting / payoffs / outline,全 hint 级;**逐字段 trim/非空/长度/数量上限 + strict()**;各域 hint schema 分别导出(不公共化) |
| 7 | 步骤间传递 | definition 加 `consumes`(只能指向前序产物,启动校验唯一性/禁环);读**最新版本且必须 approved**(最新版 pending 时 stage=awaiting-approval,下游不推进);产出即落库;**advance = 推进到下一个关卡**(链式,循环上限 = definition 长度) |
| 8 | 方向标识 | server 在生成落库时为每个方向注入稳定 **`directionId`**;tab key 与 select 目标均用它(标题可重名、下标可变,不作标识) |
| 9 | 保存与选定 | **两个命令**:`saveCreativeDraft`(永远 pending,存全部方向)+ `selectCreativeDirection`(显式 approved 单方向);均携带 `expectedHeadVersion`,stale → 409;保存/选定期间 UI 互斥禁用 |
| 10 | 比较视图 | 全页「创意海报 v2」:tab 带方向名、编辑本地缓存、脏时浮动保存 pill、底部选定细条(确认提示)、折叠素材理解区;a11y 最低要求(原生 button tab + aria + 焦点管理) |
| 11 | 读模型 | `GET /works/:id` 响应扩展 **`workflowState` + `allowedActions`**(与 artifacts 同一快照);不拆独立 /state 路由(高频轮询或响应过大时再拆) |
| 12 | 失败与重试 | **重试进 #3c**:同输入、同幂等、从失败 step 恢复(caption 已成功不重跑——stage 派生自 artifact 天然成立);**重新生成(带补充想法)留 #12**;Entry 失败后必须能进 Workspace |
| 13 | advance 并发 | per-work 内存互斥锁(**finally 清理**),并发 → 409 `advance-in-progress`;真正事务/lease 归 #9 |
| 14 | advance 返回 | 可穷举 outcome:`advanced | awaiting-approval | complete | failed(stepId, code, retryable, attemptId)`;complete 后重复调用 = no-op |
| 15 | LLM 调用 | `generateObject` + zod(淘汰剥围栏+JSON.parse);显式 token 上限 + timeout + AbortSignal;类型化错误(invalid-output / unavailable / timeout) |
| 16 | HTTP 错误 | `{code, retryable, attemptId, message}`;依赖未就绪/版本冲突 409,内容非法 400/422,模型输出非法 502,不可用/超时 503/504 |
| 17 | 超长素材 | seed 不可变即 snapshot(不另加元结构);**截断统一收在 prompt 组装一处**(caption/creative 共用),按模型 context window 定 budget;前端只做预提示 |
| 18 | PipelineInput | `upstream` 保持 JsonValue(pipeline 泛型);**类型精确性由各 step 的 inputSchema 在边界严格恢复**(runStep 的本职);seed 是所有步骤的固有输入,不占 consumes |
| 19 | 谱系 | 消费的上游版本号记运行日志,不进 artifact 字段 |
| 20 | 可观测性 | 结构化 JSON console 日志(不引库):requestId/workId/stepId/attemptId/model、latency、输入输出 token、finish reason、错误分类、锁冲突;**不落素材/prompt/正文全文**,只记长度与 hash |
| 21 | 版本回看 | MVP 不做,选定动作带确认提示;能力随 #6 详情页 |
| 22 | 领域词 | 提炼稿(caption)/ 创意稿(creative),已进 CONTEXT.md |
| 23 | 触发时机 | Entry 只创建作品并跳创作界面;**advance 由 Workspace 触发**(避免 Entry 请求挂 30~60s 两次 LLM 调用) |
| 24 | directionCount UI | v1 只做配置项默认值,UI 归 #7 |

## 明确不做

- 跨包混搭结构化支持(选定后编辑 + 版本链取回)
- 图片输入(caption 先只吃文本;多模态是未来落点)
- 重新生成入口(带补充想法)、渐进展示、分段提炼、版本回看 UI → [#12](https://github.com/12bitsD/agent4novel/issues/12) / #6
- 迁移/回滚机制(见「阶段假设」)
- directionCount 配置 UI(#7)

## 技术方案 V1

### 现状锚点(commit `fc9667a`)

- pipeline stage **派生自 artifact 状态**,不持久化;artifact **append-only 版本链**,`getWork` 返回各 bucket **最新版本**
- definition 仅 preprocess 一项;`advance` 一次一步;interview 瞬态在 `pendingInterviews` Map
- `PUT /artifacts/preprocess` 人工保存即 approved;web:Entry 问答流、Workspace idea 视图四数组编辑

### 链路

```
Entry 提交 → POST /works(只创建) → 跳创作界面 → Workspace 触发 advance(链式):
  ① caption 步骤:素材(截断) → 提炼稿,落库即 approved
  ② creative 步骤:单次 generateObject(caption + 素材 + directionCount)
     → 注入 directionId → 落库 pending(gateAfter)
→ 创意海报比较视图
   保存 pill = saveCreativeDraft(全部方向,pending)
   「就按这个方向写 →」= selectCreativeDirection(directionId, 单方向 approved)
→ #4 解锁(consumes:['creative'],组装校验恰好 1 方向)
```

definition:

```ts
[
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
]
// 构造时校验:stepId/outputKind 唯一、consumes 只指前序 outputKind、禁自依赖与环
```

### contracts(packages/contracts)

- 新增 `caption.ts`:`captionContentSchema = { inputStage, summary, elements: captionElementSchema[], gaps: string[] }`(inputStages 迁入)
- 新增 `creative.ts`:`creativePackSchema = { directionId, title, hook, tags[], synopsis, characters: characterHintSchema[], setting: settingHintSchema[], payoffs[], outline: outlineHintSchema[] }`;`creativeContentSchema = { directions: pack[].min(1).max(3) }`;各域 hint schema 独立导出(今日同形 `{title, content}`,演进自由)
- 全部 object `.strict()`;字符串 trim + 非空 + 长度上限;数组数量上限;tags 唯一
- 改 `artifacts.ts`:preprocess → caption + creative(6 节点)
- 改 `step.ts`:`agentConfigSchema += directionCount: int 1~3 optional`
- 删 `preprocess.ts`(含 interview schema)

### server

- **pipeline.ts**:definition 加 `consumes` + 启动校验;删 interview 机制;`advance()` 链式循环(上限 = definition 长度)+ per-work 互斥锁(finally 清理,冲突 → `advance-in-progress`);返回可穷举 outcome;consumes 注入 = 读最新版且必须 approved
- **steps/**:`caption/`、`creative/` 替换 `preprocess*`;io 契约同源(Real/Fake);`generateObject` + timeout/AbortSignal;类型化 LLM 错误;creative 输出校验 `directions.length === directionCount` 后注入 directionId
- **fake-step.ts**:caption/creative 两个 fake;Fake 按 config.directionCount 确定性生成 N 个方向
- **routes/works.ts**:
  - 删 `answer-interview`
  - `PUT /api/works/:id/artifacts/creative` = saveCreativeDraft(body: content + `expectedHeadVersion`;**永远 pending**)
  - `POST /api/works/:id/artifacts/creative/select` = selectCreativeDirection(body: `{directionId, expectedHeadVersion}`;落单方向新版本 + approved)
  - `GET /api/works/:id` 扩展 `workflowState + allowedActions`(同快照派生)
  - 错误统一 `{code, retryable, attemptId, message}` + 409/422/502/503 映射
- `/api/config` → `{ demo }`;`index.ts` 装配两步;`seed.ts` 同步新形态
- 结构化 JSON 日志(字段见决策 20)

### web

- **api.ts**:删 answerInterview;`saveCreativeDraft` / `selectCreativeDirection`;DTO 对齐(workflowState/allowedActions、错误形)
- **Entry.tsx**:删问答流;只创建 + 跳转;>100K 字符预提示
- **Workspace.tsx**:只渲染 server 读模型(`ready-to-generate | generating | awaiting-selection | selected | failed` + allowedActions),不重建状态机;`ready-to-generate`/`failed` 给「生成创意稿」按钮(重试 = 同一 advance)
- **CreativePoster.tsx**:海报排版(tags/payoffs chip、hook 焦点、synopsis 段落、characters 卡片、setting 词条、outline 箭头链);编辑全本地缓存;保存 pill 与选定细条互斥禁用;409 时保留 dirty edits 并提示
- **纯状态/command 映射抽离**(如 `creative-compare.ts`):tab↔directionId 绑定、保存全部方向、选定当前方向、409 保留 dirty——**纯函数 + vitest 覆盖,不引浏览器 E2E**

### 测试策略

| 层 | 覆盖点 |
|---|---|
| contracts | caption/creative 收/拒(长度/数量/strict);directionCount 边界 |
| pipeline | 链式 advance;consumes 注入与「最新 pending 不推进」;并发 advance 409;complete no-op;非法 definition 启动失败;directionCount=1 仍需显式 select |
| steps | creative prompt 含素材+caption+directionCount;数量严格校验;类型化错误;Fake 按 N 出包 |
| app(HTTP E2E) | 创建→advance→比较→编辑保存→选定→刷新仍 selected;caption 成功 creative 失败 → 重试只跑 creative;stale version 409;interview 零残留 |
| web(vitest) | creative-compare 纯映射:tab↔directionId、保存全部、选定、409 保 dirty |

### 实施顺序(红绿切片)

1. contracts 增量(caption.ts/creative.ts/directionCount;preprocess 暂留)+ 测试
2. server 切换 + web 最小编译修复(**同一切片,内部顺序:server/fake → 新 route/读模型 → web 最小迁移 → 联合测试;切片结束双绿**,内部 commit 不单独部署)
3. web 创意海报 + creative-compare 纯映射与测试
4. 收尾:删 preprocess 残留、schema.md 6 节点、README/CONTEXT 扫尾

### 边界与错误

- creative 消费时 directions ≠ 1 → 409 `direction-not-selected`
- 并发 advance → 409 `advance-in-progress`;保存/选定 stale → 409 `version-conflict`(web 保留 dirty edits)
- 素材 >100K 字符 → prompt 组装处统一截断 + Entry 预提示
- LLM 非法输出 502 / 超时 504 / 不可用 503;advance outcome `failed` 带 retryable
- caption 成功后 creative 失败 → 重试只跑 creative(stage 派生天然成立)

## 评审留痕(V0 → V1,2026-08-27)

评审 26 条:**采用 24(其中 7 条轻量化裁剪),驳回 2**。

- **驳回 #19(preprocess 存量迁移)/ #20(旧 workflow 状态迁移)**:阶段假设不成立——存储生命周期 = 进程生命周期,无存量、无外部用户;迁移与回滚机制推迟至 #9 设计,此后 schema 变更走 expand → migrate → contract
- **轻量化**:#2 SourceSnapshot 元结构(seed 不可变即 snapshot)/ #6 consumes 版本措辞(机制实为最新版必须 approved)/ #7 seed 为固有输入、谱系走日志 / #8 PipelineInput 宽度(类型在 step inputSchema 边界恢复)/ #9 completion policy 保持缺省 auto / #13 内存级互斥锁(事务归 #9)/ #24 不引日志库
- **评审后两项调整**:#17 读模型不拆 /state 路由,扩展 getWork 同响应(同快照);#21 不能只测 HTTP 层——抽纯状态/command 映射用 vitest 覆盖 tab/directionId/保存/选定/409 等 Web 风险
- **修正**:per-work 互斥锁 finally 清理 + 明确 409 code;采用计数 24/7/2

## 状态记录

- 2026-08-27(grill 第一轮):方向包化方案对齐,issue #11 建立,#4 改挂 blocked by #11,#12 装优化项。
- 2026-08-27(grill 第二轮):推翻 fan-out 改单次直出;interview 整体移除;consumes + 链式 advance;创意海报 v2;新立 #13 设定完整版(block #5);#9 提前至 #5 前。队列:#3c → #4 → #13 → #9 → #5。
- 2026-08-27(技术方案 V0 → 评审 → V1):26 条评审裁决落地(见「评审留痕」),方案定稿,待执行计划。
- 2026-08-27(**已落地**):4 切片执行完毕——切片 0 全应用多巴胺设计系统(styles.css 亮暗双主题 token,用户追加需求);切片 1 contracts 增量;切片 2 server 切换(consumes/链式 advance/互斥锁/两命令/读模型/类型化错误)+ web 最小迁移;切片 3 创意海报 + creative-compare 纯映射;切片 4 删 preprocess + 文档同步。96 测试三端绿,演示模式 E2E 冒烟通过(创建→advance 链式→保存→选定→刷新→stale 409)。真模型 SKILL.md 效果未验,待有 key 后迭代。commits: ff2f06d / d68ae12 / 收尾。
