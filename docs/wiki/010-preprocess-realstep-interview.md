---
wiki_id: "010"
ticket: 10
ticket_state: done
context_state: historical
summary: "历史记录：首个 RealStep 与 interview/preprocess 两阶段方案；interview、preprocess 产物、DeepSeek-only provider 和当时的 outline 形态均已废弃，禁止作为当前 HOW。"
topics: ["historical-preprocess", "historical-interview", "real-step-origin", "prompt-skill", "pipeline-input", "schema-validation", "provider-history"]
code_paths: ["packages/contracts/src/caption.ts", "packages/contracts/src/creative.ts", "packages/contracts/src/setting.ts", "packages/contracts/src/outline.ts", "apps/server/src/steps/caption-step.ts", "apps/server/src/steps/creative-step.ts", "apps/server/src/steps/llm.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/errors.ts", "apps/server/src/routes/works.ts"]
symbols: ["Step", "runStep", "PipelineInput", "KnownError", "createCaptionStep", "createCreativeStep", "ModelRuntime"]
inherits: ["002", "003"]
changed_by: ["011", "004", "016"]
read_when: ["trace-real-step-origin", "understand-removed-interview-flow", "investigate-preprocess-migration", "avoid-obsolete-provider-assumptions"]
last_context_reviewed: "2026-09-04"
---

# 010 — 历史：首个 RealStep、interview 与 preprocess（已被替代）

## Agent Context

- **读取时机**：仅追溯首个 RealStep、已删除 interview、preprocess 迁移或旧 provider 假设时读取；不要作为当前 HOW。
- **原始目的**：在 003 的人工链路上接入真实 LLM Step，用批量问答补齐素材后生成可把关 preprocess。
- **实际落地**：两阶段 preprocess、内存 `pendingInterview`、answer/approve API、DeepSeek-only registry、fake fallback 和文件化 prompt 均曾完成。
- **当前价值**：`runStep` 校验、prompt 归 skill、模型测试不联网、类型化错误、先建 Work 再生成，以及 setting 四维结构仍可继承。
- **后续变化**：011 以 `caption → creative` 取代 preprocess/interview；004 取代章节式 outline；016 取代 DeepSeek-only provider HOW。
- **代码入口**：当前实现从 [`caption.ts`](../../packages/contracts/src/caption.ts)、[`creative.ts`](../../packages/contracts/src/creative.ts)、[`pipeline.ts`](../../apps/server/src/pipeline/pipeline.ts) 和 [`llm.ts`](../../apps/server/src/steps/llm.ts) 开始。

## 设计目的

本票证明 Pipeline 的 `Step` seam 可以承载真实模型，也暴露 preprocess 与 interview 的结构性问题。对应 [ticket #10](https://github.com/12bitsD/agent4novel/issues/10) 与 [spec #1](https://github.com/12bitsD/agent4novel/issues/1)；当前实现分别转到 [011](./011-caption-creative-directions.md)、[004](./004-outline-arcs-segments.md)、[016](./016-model-runtime-provider-config.md)。

## 起始上下文

- 继承 002 的 Step/Pipeline seam 与 003 的 Entry、`JsonValue` 和版本化编辑。
- 当时假设 preprocess 可同时完成“理解素材”和“生成方向”，interview 用一批问题补输入；Agent 产物 pending，人工保存 approved。
- prompt 文件化遵循 [ADR-0002](../adr/0002-storage-sqlite-skills-as-files.md)，编排遵循 [ADR-0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md)。

## 技术方案

### 历史流程

```text
Entry 创建作品
  → advance(preprocess, phase=questions)
  → pendingInterview（仅内存）
  → answer-interview（执行 normalize 并追加 preprocess pending）
  → 人工编辑或 approve
```

作品先落 store，避免模型或页面失败丢 seed。当时 `PipelineInput` 扩为 `{ workId, seed, phase, answers? }`；当前已改成 `{ workId, seed, upstream }` + definition `consumes`，不要恢复 phase、answers 或 Pipeline 内 interview 状态。

### 历史契约与去向

| 当时设计 | 当前处理 |
|---|---|
| `preprocess`: inputStage + hooks/synopsis/setting/outline 平行数组 | 已删除；理解进 caption，完整方向包进 creative，见 011 |
| `outline`: `chapters[]` 每章 number/title/summary | 已替换为 `arcs[] → segments[]`，见 004 |
| `setting`: worldview/powerSystem/factions/characters/extra | 仍保留在 [`setting.ts`](../../packages/contracts/src/setting.ts) |

`inputStage` 也被 caption 继承。当前 schema 只看 [`caption.ts`](../../packages/contracts/src/caption.ts)、[`creative.ts`](../../packages/contracts/src/creative.ts)、[`outline.ts`](../../packages/contracts/src/outline.ts) 和 `setting.ts`。

### RealStep 边界与已删除表面

首版用 DeepSeek registry、`generateText`、preprocess skill 与 Zod；无 key 时装配 `FakeStep`。provider 细节已废弃，但四个边界仍有效：代码只插值输入，完整 prompt 属于 `SKILL.md`；fake/real 共用 schema；Step 从 `JsonValue` 恢复具体类型；Pipeline 不读取 credential。

本票曾增加 `advance`、`answer-interview`、`approve` 和带 interview 标记的 config，并在 Entry/Workspace 展示问答与列表编辑。`answer-interview`、interview 状态/UI 和 preprocess 路由现均已删除；当前 provider/runtime 只看 016。

## 代码落点

继承机制看 [`pipeline.ts`](../../apps/server/src/pipeline/pipeline.ts) 与 [`errors.ts`](../../apps/server/src/errors.ts)；当前替代步骤看 [`caption-step.ts`](../../apps/server/src/steps/caption-step.ts)、[`creative-step.ts`](../../apps/server/src/steps/creative-step.ts)；provider 看 [`llm.ts`](../../apps/server/src/steps/llm.ts)。

## 测试与验证

当时用 fake 跑通 create → questions → answer/normalize → preprocess pending → approve；RealStep 以 mock model 验证 prompt 和 schema，从不联网。真 key 与当时模型名未验证，不能外推为当前运行证据。

必须保留的失败教训：一次 typecheck 被 shell 管道末端 `grep` 吞掉退出码，三个 TypeScript 错误随提交进入历史后才 amend。验证不得让过滤器覆盖原进程状态；需启用 `pipefail` 或分开检查退出码。

评审还固化了：prompt 协议归 skill、错误按 `KnownError.code` 而非 message 前缀、关卡用“通过/待把关”、step I/O schema 在 fake/real/test 间共享。

## 边界与非目标

- `preprocess`、`pendingInterview`、`answer-interview` 是已删除概念，不是待恢复功能；其重启丢失问题通过删除流程消失，而非持久化。
- setting 形态保留，outline 形态已替换；本票当时只设计二者 schema，没有实现生成。
- DeepSeek-only 检测和模型 cast 只代表历史；当前 demo/live、覆盖和 credential 错误由 `ModelRuntime` 拥有。

## 上下文演进

### 2026-08-24..2026-08-26 — 首个 RealStep 落地并固化边界

- **触发证据**：003 已有人工链路但无真实生成；实现又暴露 I/O 重复、prompt 散落、字符串错误分支和校验命令失真。
- **原假设**：interview + normalize 足以承载预处理，各 Step 可自述 I/O，过滤后输出可代表 typecheck。
- **决定**：落地两阶段 RealStep；共享 I/O schema，prompt 回 skill，错误改 `KnownError.code`，验证保留原退出码。
- **影响**：真实模型首次贯通全链路；可继承边界保留，瞬态 interview 与过宽 preprocess 随后被删除。
- **上下文处理**：preserve；保留 RealStep、共享 I/O schema、文件化 prompt、类型化错误与验证门禁的起始依据。

### 2026-08-27 — preprocess 与 interview 被 011 取代

- **触发证据**：normalize 混合理解与方向生成，四组平行数组无法绑定同一候选。
- **原假设**：inputStage 加多实例数组足以表达可比较、可把关的预处理。
- **决定**：拆成自动通过 caption 与待选 CreativePack 数组，删除 interview、preprocess artifact、route/state/UI。
- **影响**：本票流程、schema 和 API 不再可用；skill、schema、fake/real seam 与类型化错误被继承。
- **上下文处理**：replace；用 011 的 caption/creative 与选定关卡替换旧 preprocess/interview 当前说明，保留旧方案为何失败。

### 2026-08-28..2026-08-29 — outline 与 provider 所有权移交

- **触发证据**：章节摘要不适合全书 review；项目也需要多 provider、凭据、Base URL 和两层 timeout。
- **原假设**：`chapters[]` 与 DeepSeek-only registry 可继续代表当前实现。
- **决定**：004 改用弧线/剧情点；016 引入多 provider `ModelRuntime`。
- **影响**：本页不再拥有 outline 或 provider HOW，“真 key 待验证”也只是历史状态。
- **上下文处理**：replace；用 004/016 分别替换 outline 与 provider 的当前 HOW，保留 setting 形态来源和历史验证边界。

## 交接结论

本页只用于历史追溯；当前实现只继承 schema 边界、文件化 prompt、离线模型测试、类型化错误与 setting 形态。
