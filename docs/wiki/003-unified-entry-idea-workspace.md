# 003 — 统一入口 + 创作界面 idea 状态（#3a，纯人工链路）

> Ticket: [#3](https://github.com/12bitsD/agent4novel/issues/3) · Spec: [#1](https://github.com/12bitsD/agent4novel/issues/1) · 状态：已实现

## 实现目的

纯人工链路（零 agent）：把"输入 → 作品 → 产物可编辑"彻底打通。作者在启动界面输入脑洞 / 上传文档 → 创建作品 → 直接跳创作界面，在 idea 状态下手写卖点 / 梗概 / 设定 / 大纲(场景)，整份保存为 preprocess 产物（JSON、版本化）。它把 agent 的接入面（API / 编辑 / 上传 / 创作界面）全部备好，#3b 只剩"接上 agent"。

## 决策基线

- 对齐结论（grill）：三界面模型（启动 / 书架 / 创作）；step 零感知、kind=节点名、content=JsonValue；编辑=整份 JSON 新版本；人工保存=approved
- 契约变更：`ArtifactKind` 6→5 节点（preprocess / outline / setting / beat / prose）；`content: string → JsonValue`
- 领域词汇用 [CONTEXT.md](../../CONTEXT.md)；存储映射同步 [schema.md](../schema.md)
- provider 结论在 #3b 用（[research](../research/llm-provider-strategy.md)），本票不接 LLM

## 技术方案

### 契约变更（packages/contracts）

- `artifactKinds = ['preprocess','outline','setting','beat','prose']`
- `perWorkKinds = ['preprocess','outline','setting']`；`perChapterKinds = ['beat','prose']`
- 新增 `JsonValue` 类型（递归：string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }）
- `Artifact.content: JsonValue`；其余类型不动

### 数据模型（docs/schema.md 同步）

- 卖点 / 梗概 / 设定 / 大纲(场景) 不再是独立产物，而是 **preprocess 产物的 JSON 字段**：
  `{ hook: string, synopsis: string, setting: string, outline: string }`（本票单实例；多实例候选形态在 #3b 对齐时定死）
- outline / setting 的**完整版**仍是独立产物（kind=outline / setting），由后续票的节点生成；preprocess 里的是 hint（粗）

### 存储（server/src/store）

- `InMemoryStore` 逻辑不变（版本化、形状不变量、setStatus 作用最新版），只把 `content` 类型改为 JsonValue
- preprocess 为 per-work kind（禁 chapter），沿用现有形状不变量校验

### API（server/src/routes）

- `POST /api/works` `{ seed: string, title?: string }` → 201 + Work（title 缺省取 seed 前 20 字）
- `PUT /api/works/:id/artifacts/preprocess` `{ content: JsonValue }` → zod 校验 `{ hook, synopsis, setting, outline }` 四字符串 → `appendArtifact`（version+1）→ `setStatus(approved)`（人工保存即确认）→ 返回新 Artifact
- 作品不存在 → 404；content 校验失败 → 400
- GET 两个端点不变

### 启动界面（web/src/pages/Entry.tsx）

- 输入框（textarea，可继续编辑补充）+ 上传按钮（file input）
- 解析：txt/md 原生 `File.text()`；docx 用 `mammoth`；pdf 用 `pdfjs-dist`（Vite 需配 worker）
- 解析成功 → 文本追加进输入框；失败 → 提示"粘贴文本代替"，不阻断创建
- 「创建」→ `POST /api/works` → 跳创作界面

### 创作界面（web/src/pages/Workspace.tsx）

- **status tab 骨架**：`const STATUSES = ['idea','beat','prose']`（数据驱动，将来可加）；beat/prose 显示"后续版本"占位
- **idea 状态**：seed 常驻展示（只读参考）+ 卖点 / 梗概 / 设定 / 大纲(场景) 四个可编辑区块
- 「保存」→ `PUT artifacts/preprocess`（整份 JSON 新版本）；显示当前版本号
- 简单版布局（分区 + 文本框）；卡片组 / 多实例 / tab 视觉细化留待创作界面设计定案

### 书架（web/src/pages/Bookcase.tsx）

- 加「新建」按钮 → 启动界面

### 导航（App.tsx）

- `useState` 三视图切换：bookcase / entry / workspace（无 router；router 留 #6）

## 测试策略

- mock 存储、无 step；好测试 = 只测外部行为
- 覆盖：契约类型（JsonValue content）、`POST /api/works`、`PUT` 整份保存 version+1 且旧版本保留、人工保存后 humanStatus=approved、形状不变量（preprocess 禁 chapter）、上传解析函数单测（mock 文件内容）、解析失败 fallback 路径

## 实施顺序（红绿切片）

1. contracts：5 节点 + JsonValue + 测试 → schema.md 同步
2. store：content 改 JsonValue + 测试
3. server：POST works + PUT preprocess + 测试
4. web：Entry 启动界面 + 解析函数（先测后实现）+ 书架「新建」+ 导航
5. web：Workspace 创作界面（status tab 骨架 + idea 四区块 + 保存）
6. 全量测试 + typecheck + `pnpm dev` 验证三界面链路
7. commit → 3 轮校准 → /code-review

## 边界与错误

- 上传解析失败 → fallback 提示粘贴（不阻断创建）
- PUT content 校验失败 → 400；作品不存在 → 404
- preprocess 产物带 chapter → 存储形状不变量抛错（沿用）

## 明确不做

- step / pipeline / advance / interview / RealStep → #3b
- 大纲 / 章纲 / 正文生成与按章 review → #4 / #5
- 卡片组 / 多实例候选 / tab 视觉细化 → 创作界面设计定案后
- SQLite → #9；Agent 配置 UI → #7；router → #6

## 技术默认

pnpm · tsx · tsc · vitest · zod · Hono · Vite+React（useState 导航）· mammoth · pdfjs-dist

## 状态记录

- 2026-08-24：实现完成。33 测试全绿（contracts 6 / server 22 / web 5），typecheck 全绿；HTTP 验证 POST → PUT v1 → v2 → GET 全链路。
- 偏差：新增 `jsonValueSchema`（contracts），pipeline 步骤输出 schema 用它校验 JsonValue——wiki 未列，属必要补充。
- 偏差：TDD 未严格"先红后绿"（测试与实现同批写），行为覆盖完整；后续票按红绿执行。
- 偏差：pdfjs-dist v6 类型无 `PDFDocumentProxy.destroy()`，移除该清理调用（一次性提取，无碍）。
- demo 链随 5 节点改造重排为 3 步（见 wiki 002 状态记录）。
- code-review 修复：CONTEXT.md 词条漂移（统一入口/书架改指启动界面/创作界面，新增两词条；卖点去掉过时 code id）；书架按钮"新建"→"开始创作"；创作界面 status tab 加领域词标签（idea/章纲/正文）；works.ts 抽 readJsonBody、api.ts 抽 request、file-parser 导出 ACCEPTED_FILE_TYPES 单一来源；createWork 空 title 回退 seed 前缀（修 Spec 轴发现的 `??` 漏洞）；读侧 content 用 safeParse 替代盲 cast。
- 已知缺口（记录在案）：Entry 的解析失败 UI 分支未被组件测试覆盖（测试基建留待统一）；旧版本仅内部保留、暂无读取端点（#3a 范围内，review UI 时补）。
