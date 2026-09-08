# 单章章纲设计方法研究

日期与来源访问日期：2026-09-05。服务于 #5 单章章纲设计讨论。本文是外部证据与选型建议，不是已批准方案，也不替代 issue、领域模型、schema 或 Wiki 的权威内容。

## 问题与已确认边界

本次要判断的是：当前一章在进入正文前，怎样表达完整、可审阅的写作计划。

用户已确认逐章按需规划，不批量预生成后续章纲；当前章章纲完整生成。全书大纲以 arc/segment 表达，与章节解耦；setting 是整书基准。这些是本次比较的产品约束，不是从外部创作工具推导出的结论。

“概览 + 有序场景卡 + 结尾钩子”尚未获批。下述推荐对这一提议作了修订，字段名和实际数据形状仍待设计确认。

## 先区分层级

全书 outline 处理跨章节的发展；chapter 是当前规划和交付范围；scene 是局部叙事单位，一章可以包含一个或多个 scene。beat 在不同方法里可能指整部故事的重要节点，也可能指场景内部的推进，或 AI 工具中的一条写作指令。因此不能把不同来源的 beat 视为同一种实体，也不能把一个章纲限定成一个场景。Sudowrite 明确支持一章一个或多个场景，Novelcrafter 则把 scene beat 用作正文生成指令。[Sudowrite Scenes & Draft](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/scenes--draft/49p5MTVxTKkVFEC5rVUzpY)、[Novelcrafter Generating Prose](https://www.novelcrafter.com/help/docs/write/generating-prose)

## 叙事方法比较

| 方法 | 来源实际支持什么 | 对 agent4novel 的适用性判断 |
| --- | --- | --- |
| 场景与反应段（Scene / Sequel） | Randy Ingermanson 对 Dwight Swain 方法的讲解区分行动中的 Goal / Conflict / Disaster，以及反应中的 Reaction / Dilemma / Decision。这是讲解者的一手文章，不是对 Swain 原著的直接核验。[来源](https://www.advancedfictionwriting.com/articles/writing-the-perfect-scene/) | 可帮助生成器安排行动后的情绪、权衡和决定，避免只有事件清单；适合作为可选构思提示，不应强制每张卡失败或每章完整走两套结构。 |
| Story Grid 五项 | 官方提出 Inciting Incident、Turning Point Progressive Complication、Crisis、Climax、Resolution，用来检查故事事件的因果与变化。[来源](https://storygrid.com/five-commandments-of-storytelling/) | 适合检查“为什么推进到下一步、人物如何作出选择、结果改变什么”；直接把五项全部变成每张卡的必填字段会增加负担，且不能据此认定一个场景就是一章。 |
| Save the Cat! 15 beats | 官方入门页以 Opening Image 到 Final Image 组织整部故事的 15 个节点。[来源](https://savethecat.com/get-started) | 可给全书或较大叙事范围提供参考；不宜把完整 15 项机械套进当前每一章，也不要求把 arc/segment 重新绑定章节。 |

上述方法提供创作与检查视角，没有在本项目中进行效果实验。它们不能单独决定章纲的存储格式。

## 创作工具比较

| 工具 | 官方可核实的做法 | 值得借鉴及边界 |
| --- | --- | --- |
| Sudowrite | Draft 前先写或生成编号场景列表；生成可依据关联 Outline 的章节摘要；场景长短可调。Extra Instructions 把 cliffhanger 列为可选指令。[Scenes & Draft](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/scenes--draft/49p5MTVxTKkVFEC5rVUzpY) | 当前章先形成可读的有序安排，再生成正文，是直接相关的产品先例；它的章节摘要来源和场景粒度无需照搬，钩子也不必一律悬崖式结尾。 |
| Novelcrafter | 正文生成中的 scene beat 是用户输入的指令，可选择 inputs 与 prompt。AI Context 可含 codex、snippets、scene summaries、完整 scenes。[Generating Prose](https://www.novelcrafter.com/help/docs/write/generating-prose)、[术语表](https://www.novelcrafter.com/help/reference/terms/novelcrafter) | 支持将局部写作指令与参考上下文区分；这些文档不证明所有上下文默认都会注入，也不意味着一条 scene beat 等于整章计划。 |
| Novelcrafter 的规划视图 | Matrix 区分 scene summary、scene contents 与手工关联的 codex，并支持场景 POV 和 subplot 的并排查看。[Planning with the Matrix](https://www.novelcrafter.com/help/docs/plan/planning-with-the-matrix) | 可借鉴“局部安排有顺序、关联参考资料、区分摘要与正文”的思想。完整矩阵界面、关联体系和独立场景产物不是本次建议。 |
| Scrivener | Synopsis 可作为章节 mini-outline，也可作为 scene 或章节片段的计划；同一摘要出现在 Inspector、Corkboard 和 Outliner。官方建议随实际写作更新摘要。[10 Things You Can Do with Synopses](https://www.literatureandlatte.com/blog/10-things-you-can-do-with-synopses-in-your-scrivener-projects) | 说明标题与自由说明已能支持组织和审阅；卡片是呈现方式，不能据此推导一套必填叙事字段。计划与已写内容可能发生偏差，应明确区分其含义。 |

Sudowrite 在 2025-02-23 的官方更新中宣布由 Beats 转向 Scenes，同时声称内部测试的正文质量有所改善。本文只把前者作为产品演进事实；后者没有可复核的实验设计与结果，不能作为 agent4novel 质量提升的证据。[官方更新](https://feedback.sudowrite.com/changelog/notebook-setting-the-scene-for-better-prose)

## 推荐：中等结构化的当前章写作计划

在已确认约束下，优先推荐“章标题 + 本章目标 + 写作安排（有序标题／说明卡）+ 章末落点与承接”。这是研究判断，尚待 Human 确认；不是最终字段 schema。

| 组成 | 需要回答的问题 |
| --- | --- |
| 章标题 | 当前这章如何识别与浏览？ |
| 本章目标 | 这一章要推进什么，预期让读者理解或感受到什么？ |
| 写作安排 | 按什么顺序写，人物做什么、得知什么或如何反应，前后怎样衔接？每条用标题和自由说明表达。 |
| 章末落点与承接 | 本章结束时预期局势发生什么变化，停在哪里，留下什么期待或待续问题？ |

写作安排可以包含行动、对话、过渡与内心反应。不要求每张卡对应一次地点变化，不规定固定张数，也不把反应或过渡硬塞进“目标—冲突—失败”。保留有序结构，是为了让作者检查先后和遗漏；保留自由说明，是为了容纳不同章节的叙事需要。这些理由是适用性判断，尚未实测。

章末设计应写清预期变化与承接，可以承载钩子，但不强制每章出现悬崖式转折。相较此前“结尾钩子”的说法，“章末落点与承接”更准确地表达本次建议的范围。

纯自由文本概要也可行，编辑简单，但顺序和局部缺口更依赖人工从段落中辨认。固定五项或六项场景表适合偏好这些方法的作者，但作为全题材必填结构会增加填写与改写负担。为每章套全书 15 beats 则混淆尺度。推荐方案在自由度与可检查性之间取中间位置，不宣称其普遍最优。

## 产品与证据边界

建议将叙事方法放入 Agent 生成提示和人工审阅指导，不引入新的叙事质量语义硬拦截；既有的内容冲突澄清仍留给 #18，不能将一般创作品质评估都归入该票。计划中的章末落点不等于正文中已经发生的事实，正文后的实际推进协议留给 #6 确定。

本建议不新增多级 scene/beat 产物、独立场景关卡、生成次数要求或 SQL 表。卡片首先描述信息呈现与编辑方式，不自动成为新的领域实体。

本次只新增这篇研究笔记，没有修改已批准的 Wiki、schema、CONTEXT、issue 或代码，没有运行服务、模型或测试。所查主要是英文写作工具与叙事指南：官方产品文档提供实际功能的证据，创作方法体现作者主张与组织思路；二者都不能直接证明在中文网文、当前所用模型上的生成质量，也不能证明哪种设计对作者编辑负担最优。

建议后续在方案验证阶段，用行动、对话、过渡三类章节比较自由概要、固定场景表和本推荐方案：记录计划遗漏、人工编辑负担，以及正文是否越过计划边界或把未来事件提前写出。此处仅提出验证方向，没有开展真实 LLM 对照实验。
