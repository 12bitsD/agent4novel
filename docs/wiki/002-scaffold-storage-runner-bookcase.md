---
wiki_id: "002"
ticket: 2
ticket_state: done
context_state: mixed
summary: "记录项目最初的可运行骨架，以及至今仍有效的存储、Step 和 Pipeline 边界；具体产物契约与运行链已由后续 wiki 演进。"
topics: ["scaffold", "storage", "step-contract", "pipeline", "workflow-gates", "bookcase"]
code_paths: ["packages/contracts/src/artifacts.ts", "packages/contracts/src/step.ts", "apps/server/src/store/work-store.ts", "apps/server/src/store/in-memory-store.ts", "apps/server/src/pipeline/pipeline.ts", "apps/server/src/routes/works.ts", "apps/web/src/pages/Bookcase.tsx"]
symbols: ["Artifact", "Work", "WorkStore", "InMemoryStore", "Step", "runStep", "Pipeline"]
inherits: []
changed_by: ["003", "010", "011", "014", "016"]
read_when: ["understand-project-foundation", "change-storage-contract", "change-step-contract", "change-pipeline-gates", "trace-bookcase-origin"]
last_context_reviewed: "2026-09-04"
---

# 002 — 脚手架、存储、Pipeline 骨架与书架

## Agent Context

- **读取时机**：理解项目纵向骨架，或修改存储、`Step`、Pipeline 关卡和书架读模型时读取。
- **原始目的**：用 fake 数据和 fake step 打通 contracts → store → Pipeline → Hono API → React 书架。
- **实际落地**：monorepo、首版产物契约、`WorkStore`/`InMemoryStore`、可注入 Pipeline、两类关卡、作品 API 和书架均完成。
- **当前价值**：存储与步骤是 seam、Pipeline 是深模块、产物追加版本、输入输出在边界校验等原则仍有效。
- **后续变化**：003 加入口；010/011 接入并重构生成链；014 加 CLI/遥测；016 接管 provider。本页的首版枚举和 demo 链不是当前契约。
- **代码入口**：[`step.ts`](../../packages/contracts/src/step.ts)、[`work-store.ts`](../../apps/server/src/store/work-store.ts)、[`pipeline.ts`](../../apps/server/src/pipeline/pipeline.ts)。

## 设计目的

这张票交付一条不依赖真实 LLM 的最小可运行链路。后续写作节点只需实现 `Step` 并扩展 Pipeline definition，不应重复建设存储、关卡和 HTTP 骨架。对应 [ticket #2](https://github.com/12bitsD/agent4novel/issues/2) 与 [spec #1](https://github.com/12bitsD/agent4novel/issues/1)。

## 起始上下文

- 编排采用 AI SDK + 薄 TypeScript workflow，见 [ADR-0001](../adr/0001-orchestration-ai-sdk-thin-workflow.md)；Pipeline 集中规则，不充当可替换 seam。
- 存储最终方向为 SQLite，但首轮用内存实现验证接口；prompt/skill 使用文件，见 [ADR-0002](../adr/0002-storage-sqlite-skills-as-files.md)。领域词和当前模型分别以 [`CONTEXT.md`](../../CONTEXT.md)、[`docs/schema.md`](../schema.md) 为准。

## 技术方案

### 模块边界

只有两类实现是替换点：`WorkStore`（首轮 `InMemoryStore`）和 `Step`（`FakeStep`/RealStep）。Pipeline 接收 store、steps、definition 和 `resolveConfig`，集中拥有顺序、依赖、关卡与推进语义，不自行创建依赖。

### Step、存储与版本

`Step` 声明 `inputSchema`、`outputSchema` 和 `run(input, config)`；`runStep` 在调用前后分别解析输入与输出。prompt、skill 和模型调用留在具体 Step 内，`AgentConfig` 作为显式策略输入。

`InMemoryStore` 按 `(workId, kind, chapter)` 保存版本数组，写入只追加，详情读取各 bucket 最新版本。必须守住：

- per-work 产物不得带 `chapter`；per-chapter 产物必须带 `chapter`。
- `setStatus` 只作用于最新版。
- `getWork` 返回 `WorkDetail | undefined`，不是首版注释曾写的 `Work`。

当前 `ArtifactKind` 直接查看 [`artifacts.ts`](../../packages/contracts/src/artifacts.ts)；本票最初的 kind 和后来的 `preprocess` 快照都不是当前契约。

### Pipeline、API 与书架

状态由已有产物与人工状态推导。`advance` 运行下一步、追加产物并按 definition 停在关卡；首版同时实现 `gateAfter` 与 `gateBefore`，专门证明两个方向都由状态机强制执行。当前链路与装配以 [`start.ts`](../../apps/server/src/start.ts) 为准。

首轮 API 只提供作品列表/详情并注入示例作品；书架通过 `/api` 代理读取摘要。创建与创作界面由 003 加入。

## 代码落点

契约边界看 [`step.ts`](../../packages/contracts/src/step.ts)，存储 seam 看 [`work-store.ts`](../../apps/server/src/store/work-store.ts)，集中编排看 [`pipeline.ts`](../../apps/server/src/pipeline/pipeline.ts)；其余候选路径由 frontmatter 的 `code_paths` 提供。

## 测试与验证

- `runStep` 必须拒绝非法输入和输出。
- store 覆盖版本递增、最新版状态和 chapter 不变量。
- Pipeline 覆盖顺序、关卡阻断、通过后解封、终态幂等及非法 definition。
- 落地时测试、typecheck 和本地 server/web/proxy 冒烟通过；当时未严格保留每个红绿瞬间，后续票改用更小切片。

## 边界与非目标

- 终态 `advance` 幂等；遇 pending gate 拒绝且无副作用。
- 不存在产物、违反 chapter 不变量、重复/未注册 step 必须响亮失败。
- 本票不实现真实 LLM、SQLite、创作界面或 router；这是历史范围。当前内存 store 仍随 server 重启丢失。

## 上下文演进

### 2026-08-22 — 首个纵向骨架落地

- **触发证据**：后续写作步骤都需要同一条可启动、可验证的基础链路。
- **原假设**：两步 demo 足以验证 Pipeline。
- **决定**：使用四个 `FakeStep` 覆盖 `gateAfter` 与 `gateBefore`，并注入 store 和 steps。
- **影响**：关卡机制与写作节点解耦，后续扩链无需重写 runner。
- **上下文处理**：preserve；保留 WorkStore/Step 接缝、Pipeline 深模块与关卡解耦的初始理由，供后续扩链继续约束实现。

### 2026-08-24..2026-08-29 — 结构化产物与真实运行链演进

- **触发证据**：人工编辑需要结构化内容；preprocess 又混合了素材理解与方向生成，真实模型还需要可观测、可配置入口。
- **原假设**：string content、单个 preprocess 和 fake-only demo 足以承接后续流程。
- **决定**：003 引入 `JsonValue`；011 拆为 `caption → creative`；014 增加 CLI/遥测；016 收敛 ModelRuntime/provider。
- **影响**：本页只继续拥有底层模块边界；当前 artifact、definition、API 和运行命令由后续文档与代码拥有。
- **上下文处理**：replace；用后续 Wiki 与当前代码入口替换旧 artifact、definition、API 和运行说明，同时保留底层模块边界的由来。

## 交接结论

修改底层架构时保留三项约束：`WorkStore` 与 `Step` 是 seam，Pipeline 是集中规则的深模块，跨模块数据必须过 schema。当前工作流、CLI 和 provider 分别继续读 011、004、014、016。
