---
wiki_id: "003"
ticket: 3
ticket_state: done
context_state: mixed
summary: "记录统一入口、文件导入、作品创建和创作界面人工编辑链路的首轮实现；入口与版本化基础仍在，preprocess 契约和 idea 编辑页已被后续流程取代。"
topics: ["entry", "workspace", "file-import", "artifact-editing", "json-value", "versioning"]
code_paths: ["packages/contracts/src/artifacts.ts", "apps/server/src/store/in-memory-store.ts", "apps/server/src/routes/works.ts", "apps/web/src/pages/Entry.tsx", "apps/web/src/file-parser.ts", "apps/web/src/pages/Workspace.tsx", "apps/web/src/App.tsx"]
symbols: ["JsonValue", "WorkDetail", "createWork", "parseFile", "ACCEPTED_FILE_TYPES", "Entry", "Workspace"]
inherits: ["002"]
changed_by: ["010", "011", "004"]
read_when: ["change-entry-flow", "change-file-import", "trace-manual-artifact-editing", "understand-json-value-migration", "trace-workspace-origin"]
last_context_reviewed: "2026-09-04"
---

# 003 — 统一入口与创作界面首轮人工链路

## Agent Context

- **读取时机**：修改作品创建、上传解析、入口导航，或追溯 `JsonValue` 与整份版本化编辑为何引入时读取。
- **原始目的**：先用零 Agent 链路打通“输入素材 → 创建作品 → 编辑结构化产物 → 保存新版本”。
- **实际落地**：启动界面、txt/md/docx/pdf 解析、作品 API、三视图导航、首版 idea 编辑区和历史 `preprocess` 保存均完成。
- **当前价值**：先落 Work 再生成、解析失败可回退粘贴、`JsonValue` content 和 store 追加版本仍可复用。
- **后续变化**：010 记录首个 RealStep 历史；当前 preprocess 替代方案看 011，outline 看 004。当前 Workspace 由 server 读模型驱动。
- **代码入口**：[`Entry.tsx`](../../apps/web/src/pages/Entry.tsx)、[`file-parser.ts`](../../apps/web/src/file-parser.ts)、[`Workspace.tsx`](../../apps/web/src/pages/Workspace.tsx)。

## 设计目的

这张票把入口和产物编辑从 Agent 生成中解耦：没有模型也能创建作品、导入素材并写入版本链，后续 Agent 只替换内容产生方式。对应 [ticket #3](https://github.com/12bitsD/agent4novel/issues/3) 与 [spec #1](https://github.com/12bitsD/agent4novel/issues/1)。

## 起始上下文

- 继承 002 的 contracts/server/web 骨架；人工确定启动界面、书架、创作界面三视图，首版不引 router。
- `kind` 表示 Pipeline 节点，`content` 要承载结构化 JSON；整份编辑追加新版本。当时纯人工保存直接 `approved`，该语义后来不适用于 creative/outline 草稿。
- 领域词和当前数据形状分别以 [`CONTEXT.md`](../../CONTEXT.md)、[`docs/schema.md`](../schema.md) 为准。

## 技术方案

### 结构化产物与创建顺序

本票把 `Artifact.content` 从 string 扩为递归 `JsonValue`，并增加 `jsonValueSchema`；这个跨端边界仍有效。当时卖点、梗概、设定 hint 和大纲 hint 被合并为单个 `preprocess`，该过渡模型已经删除，当前枚举看 [`artifacts.ts`](../../packages/contracts/src/artifacts.ts)。

`POST /api/works` 接收 `{ seed, title? }`；空白标题回退到 seed 前缀。作品先写入 store，再进入生成，因此跳转或模型失败不会丢 seed。历史 `PUT .../artifacts/preprocess` 曾整份追加并直接 approved；当前 creative/outline 使用独立命令、乐观锁和关卡，不得照搬。

### 文件导入与导航

`parseFile` 对调用方只暴露 `{ ok, text } | { ok, error }`：txt/md 直读，docx/pdf 动态加载解析器；失败提示用户粘贴文本，不阻断创建。`ACCEPTED_FILE_TYPES` 与分发逻辑同源。

pdfjs-dist v6 类型没有 `PDFDocumentProxy.destroy()`，首轮已移除该调用，后续不要凭旧 API 加回。`App.tsx` 用 `bookcase | entry | workspace` 判别联合切换视图；当前 Workspace 读取 `workflowState`/`allowedActions`，前端不重建 Pipeline 状态机。

## 代码落点

创建与导入看 [`Entry.tsx`](../../apps/web/src/pages/Entry.tsx) 和 [`file-parser.ts`](../../apps/web/src/file-parser.ts)；HTTP 命令看 [`works.ts`](../../apps/server/src/routes/works.ts)；当前创作读模型看 [`Workspace.tsx`](../../apps/web/src/pages/Workspace.tsx)。其余候选由 frontmatter 提供。

## 测试与验证

- 首轮验证创建作品、整份追加版本、旧版本保留、人工状态、chapter 不变量和解析成功/失败；无模型 HTTP 冒烟与 typecheck 通过。
- 结构化 content 在读侧用 `safeParse`，不能盲 cast；`readJsonBody`、web `request`、`ACCEPTED_FILE_TYPES` 各自保持单一来源。
- 空白与缺省 title 都回退 seed 前缀。
- Entry 解析失败的 UI 分支当时没有组件测试；修改该交互时应补回归覆盖。

## 边界与非目标

- 解析失败必须保留粘贴文本恢复路径；旧产物版本首轮没有读取 UI/API。
- “人工保存即 approved”只属于历史 preprocess；当前 draft/select/approve 以 011、004 为准。
- Step、RealStep、正式生成、SQLite 和 router 是本票当时的非目标，不代表当前状态。

## 上下文演进

### 2026-08-24 — 零 Agent 入口落地并收紧边界

- **触发证据**：真实生成未接入，但入口、上传和版本化编辑需要先形成接缝；评审又发现领域词、空 title、重复请求和盲 cast 漂移。
- **原假设**：string content 与局部实现足以支撑创作页。
- **决定**：引入 `JsonValue` 和 preprocess 整份版本；统一领域词，抽请求/解析单源，补 title 回退并使用 `safeParse`。
- **影响**：生成链后来沿用作品、上传和版本基础，跨层错误也更早暴露。
- **上下文处理**：preserve；保留统一入口、文件导入、JsonValue 与版本化编辑的动机和实现边界。

### 2026-08-25..2026-08-28 — preprocess 与 Workspace 被替代

- **触发证据**：单个 preprocess 无法区分素材理解与方向生成，平行字段也无法绑定候选方向。
- **原假设**：四字段 preprocess 和 idea tab 可以长期承接人工与 Agent 流程。
- **决定**：010 接入首个 RealStep；011 随后删除 interview 并拆为 `caption → creative`；004 加入 outline review，Workspace 改读 server 状态。
- **影响**：本页只继续拥有入口、上传、`JsonValue` 和导航的由来；preprocess schema、PUT 和 idea 编辑器均属历史。
- **上下文处理**：replace；用 011/004 的当前生成链和 Workspace 读模型替换旧 preprocess 与 idea 编辑器说明，保留入口演进原因。

## 交接结论

修改 Entry/文件导入可直接使用本页；修改生成或 Workspace 状态时转到 011、004 与当前 contracts/server 读模型。
