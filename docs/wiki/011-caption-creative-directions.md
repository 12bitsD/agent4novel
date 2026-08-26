# 011 预处理重构:Caption + Creative 方向包 + 比较界面(#3c)

> Ticket: [#11](https://github.com/12bitsD/agent4novel/issues/11) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态:已对齐,待写技术方案细化

## 实现目的

#3b 的 preprocess 把「理解素材」和「生成方向」混在一次 normalize 调用里。grill(2026-08-27)确认的 gap:

1. **没有提炼产物**——docx 设定集与一句话脑洞走同一条 normalize,「这份素材到底是什么」没有落点;方向生成错了分不清是理解错还是生成错。
2. **方向候选无绑定**——hooks/synopsis/setting/outline 四个平行数组,hooks[0] 与 synopsis[0] 是否同一方向靠隐式对应;作者无法在「方向」粒度上比较和选择。
3. **inputStage 是 caption 思想的残留**——只分类不提炼。

本票把 preprocess 重构为两步:**caption(理解层,提炼稿,自动通过)→ creative(生成层,N 个方向包,比较界面关卡)**,并把方向比较展示给作者。

## 决策基线(grill 2026-08-27 拍板)

| # | 决策 | 结论 | Why |
|---|---|---|---|
| 1 | 流程结构 | caption 步骤 → creative 步骤,pipeline definition 两项,零新基建 | 理解/生成分层;理解错误在最便宜的点可纠正 |
| 2 | caption 关卡 | **不设关卡**,自动通过,不直接展示 | 作者见到的第一个产物是 Creative;减少一次点击 |
| 3 | interview 归属 | 挂 caption 步骤,问题针对提炼稿缺口 | 比对着原始输入问更准 |
| 4 | fan-out 控制 | **LLM tool-call** 调起子 Agent(非代码确定性 fan-out) | 方向个数与素材判断交给模型,代码只做硬封顶 |
| 5 | 方向个数 | `AgentConfig.directionCount`,默认 **2**,提示词插值 + tool 实现硬封顶 | 产品参数进配置(AgentConfig 第一个住户),模型只执行 |
| 6 | 子 Step 粒度 | **一方向 = 一 subAgent**,一次调用出整包 | 包内一致性由构造保证;默认 3 次调用(1 主 + 2 子) |
| 7 | 子 Step 输入 | **原始素材 + 该方向**(不是只有方向摘要) | 子 Agent 回到一手信息提炼,方向只起锚作用,防转述损耗 |
| 8 | Creative 字段 | title / hook / tags / synopsis / characters / setting / payoffs / outline hint,**全 hint 级** | 装「选方向所需 + 下游种子」,不装细版 |
| 9 | 展示 | **专门比较界面**,两包并排 | 不会写作的作者凭一句话卖点无法想象全书,需要包级比较 |
| 10 | 选定机制 | **编辑即通过**:删包 + 整份保存 = approved;版本链留被放弃方向 | 零新状态;后悔药免费(append-only 版本链) |
| 11 | approve 校验 | creative 被消费时恰好 1 包,校验在消费方输入组装处,不满足抛 KnownError → 400 | store 不感知形状的原则不破 |
| 12 | 中间态 | 阻塞 + loading | 本地单用户可接受;渐进展示留优化项 |
| 13 | 数据模型 | preprocess kind 拆为 **caption + creative** 两个 kind(5 节点 → 6 节点) | schema.md 同步 |
| 14 | 领域词 | Caption = **提炼稿**,Creative = **创意稿**(进 CONTEXT.md) | 词汇红线 |

## 明确不做

- 跨包混搭不做结构化支持(选定后编辑 + 版本链取回)——「爽点和设定不在一个方向上」是低频作者级操作
- 图片输入(caption 先只吃文本;多模态是 caption 步骤的未来落点)
- 失败重试策略、重新生成入口、渐进展示 → issue [#12](https://github.com/12bitsD/agent4novel/issues/12),后续 grill
- 失败时降级单包——单包时比较名存实亡,倾向整步失败(待 #12 grill 定案)

## 技术方案(骨架,开工前细化)

```
原始输入(txt/md/docx/pdf 解析文本)
  → ① caption 步骤(SKILL.md:caption)
      questions 阶段:针对提炼稿缺口反向 interview(迁移自 preprocess)
      normalize 阶段:原始输入+问答 → 提炼稿,落库自动 approved
  → ② creative 步骤(SKILL.md:creative)
      主调用:提炼稿 → N 个方向(directionCount,默认 2)
      子 Agent ×N(LLM tool-call,并发):{原始素材 + 方向} → 整包 Creative
      └─ gateAfter:比较界面
  → 作者选定(删包保存 = approved,恰好 1 包)
  → #4 大纲步骤解锁
```

- **Creative schema(目标形)**:`{ title, hook, tags[], synopsis, characters[], setting[], payoffs[], outline[] }`,creative 产物 = `{ directions: Creative[] }`(pending 时 1~3 包,approved 时恰好 1 包)
- **pipeline definition**:`caption(auto-approve,interview)` → `creative(gateAfter)`;`PipelineInput` 需拓宽携带上游产物(caption → creative 的输入组装),具体形态在技术方案细化时定
- **FakeStep** 复现双方向包结构,演示模式与测试全 fake 不联网

## 测试策略

- seam 不变:store / step 两个接缝;FakeStep 按方向包结构出样例
- 覆盖点:caption 自动通过;directionCount 插值与硬封顶;子 Agent 输入 = 原始素材+方向;creative approve 校验(2 包 → 消费 400);编辑即选定后版本链可查旧包

## 实施顺序(红绿切片,开工前细化)

待执行计划阶段切。

## 边界与错误

- creative 消费时 directions ≠ 1 → KnownError → 400「请先在比较界面选定方向」
- 子调用失败 → 整步失败(倾向,待 #12 定案),不落半成品包
- interview 瞬态重启丢失(既有,#9 持久化时解决)

## 状态记录

- 2026-08-27:grill 对齐完成(14 项决策见「决策基线」),issue #11 建立,#4 改挂 blocked by #11;优化项(失败重试/重新生成/渐进展示)拆 #12。待写细化技术方案 → 执行计划。
