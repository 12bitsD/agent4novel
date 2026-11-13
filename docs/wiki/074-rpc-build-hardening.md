---
wiki_id: "074"
ticket: 74
ticket_state: planned
context_state: current
summary: "RPC 请求边界与生产构建硬化（等待 #15 基线，未实施）"
topics: ["hono-rpc", "body-limit", "production-build", "reliability", "security"]
code_paths: ["apps/server/src/rpc-input.ts", "apps/server/src/routes/**", "apps/server/scripts/build.mjs", "Dockerfile"]
symbols: ["typedJson", "payload-too-large", "tsconfig.api.json"]
inherits: ["015", "033", "073"]
changed_by: []
read_when: ["harden-rpc-body-limits", "fix-rpc-docker-build", "atomic-server-build"]
last_context_reviewed: "2026-11-13"
---

# 074 — RPC 请求边界与生产构建硬化（阻塞）

## Agent Context

- **读取时机**：#15 基线固定后，修改 typed input、写路由 body limit、declaration Docker 输入或构建产物替换时。
- **原始目的**：#67 要求修复 RPC 候选的重复/无界 body 读取和生产构建输入/原子性缺口。
- **实际落地**：未实施；问题与最小修复已交接 #15 评论，不在治理分支夹带其未提交工作。
- **当前价值**：33 路由 manifest、wire matrix、Setting golden 和专属错误 envelope 是必须保留的边界。
- **后续变化**：等待 #15 和 #73 基线。
- **代码入口**：`rpc-input.ts`、链式 routes、`scripts/build.mjs`、Dockerfile。

## 设计目的

确保任何 JSON parse 前执行真实 byte limit，typed metadata 与 handler 只读取一次；写路由都有明确预算，declaration 的 Docker 输入完整，构建失败不破坏旧 dist。

## 起始上下文

当前未提交 RPC 候选存在：typedJson clone().json() 与 handler 双重解析、setting-extension 限额前完整读取、五个 works 写接口无明确 byte budget、历史 artifactId 重复参数未拒绝、declaration tsconfig 未复制进 Docker build context、build 先删除 dist 再做后续检查。

## 技术方案

后续建立一次 bounded read/一次业务解析接缝，保留 Beat/Prose/Setting 400/413/422 专属分类；补 create、Creative save/select、Outline save、通用 approve 限额；拒绝重复 artifactId。构建在 staging 完成 bundle/declaration/pack/consumer 检查，成功后替换 dist。

## 代码落点

当前未修改。范围仅限 #15 的 RPC 文件、Docker/build 输入和相应测试。

## 测试与验证

### 完成审核证据

- **清单与候选**：仅计划，无候选 tree。
- **逐项判定**：C1 已完成问题/依赖核对；C2–C7 N/A（等待 #15、#73，未实施）。
- **验收与 TDD**：计划 chunked/错误 Content-Length/limit±1、body 单次读取、33 路由 manifest、wire/golden、真实 container smoke 和构建故障注入。
- **本地门禁**：未执行，不得记 PASS。
- **双轴 review**：未执行。
- **修复与回归**：未实施。
- **知识维护**：本页记录阻塞；#15 已收到具体问题交接评论。
- **发布前裁决**：blocked by #15、#73，不进入发布。

## 边界与非目标

不恢复旧 loop 路由、不改变 Hono RPC 类型、REST/CLI/Agent 行为或专属错误语义；不通过删除 handler 校验来换取“单次解析”。

## 上下文演进

### 2026-11-13 — 记录外部依赖

- **触发证据**：所有目标文件属于当前未提交 #15 候选，Docker declaration 输入缺口会阻断真实容器构建。
- **原假设**：可在治理分支并行修复，但这会覆盖或夹带用户现有 RPC 工作。
- **决定**：问题先交接 #15，待其形成已提交基线后再实施。
- **影响**：本项保持未完成，不影响 M1–M5 已验证结果。
- **上下文处理**：preserve 风险、错误契约与验收矩阵，明确未实施状态。

## 交接结论

#15 基线固定后先恢复 route inventory/wire/golden，再实施请求和构建硬化；在此之前不得宣称当前 RPC 候选问题已治理。
