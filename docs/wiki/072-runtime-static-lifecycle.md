---
wiki_id: "072"
ticket: 72
ticket_state: active
context_state: current
summary: "静态资源异步路径校验、构建资产缓存与启动退出生命周期证据"
topics: ["static-web", "performance", "cache-control", "startup", "shutdown"]
code_paths: ["apps/server/src/runtime/static-web.ts", "apps/server/src/start.ts", "apps/server/test/static-web.test.ts", "apps/server/test/server-startup.test.ts"]
symbols: ["staticWeb", "Cache-Control", "EADDRINUSE", "createShutdown"]
inherits: ["033", "043", "001"]
changed_by: []
read_when: ["optimize-static-web", "set-static-cache", "verify-listen-failure"]
last_context_reviewed: "2026-11-13"
---

# 072 — 静态资源与启动退出边界

## Agent Context

- **读取时机**：修改静态文件 serving、缓存头、生产启动、listen error 或 shutdown 时。
- **原始目的**：#72 承接 #67 的后端治理，要求减少每个静态请求的同步文件系统工作，并证明启动/退出资源回收可靠。
- **实际落地**：异步 realpath/stat，hash 资产长期缓存、HTML no-cache，真实 EADDRINUSE 后 Store 可重开，shutdown 回归通过。
- **当前价值**：Wiki 043 的路径安全、单次解码、realpath containment、symlink/API/HEAD/range 约束不放宽。
- **后续变化**：无。
- **代码入口**：`runtime/static-web.ts`、`start.ts`、`runtime/shutdown.ts`。

## 设计目的

降低静态请求同步 I/O 与浏览器重复下载，同时让监听失败和进程退出的 Store/连接清理有真实进程证据。

## 起始上下文

旧 wrapper 每次 GET/HEAD 执行同步 realpath/stat，未设置 Cache-Control。serveStatic 的 onFound 可在返回前补响应头。start.ts 已在 listen error 进入 shutdown，但缺少真实 EADDRINUSE 后数据库立即可重开的集成证据。

## 技术方案

请求期路径校验改为 fs/promises，并以 `O_NOFOLLOW` 打开、dev/inode 同一性和打开后 realpath 复核绑定实际读取；GET/HEAD/range 从同一文件描述符流式返回，避免校验后路径替换。仅在成功响应上，对 `assets/` 下符合构建指纹约定 `名称-至少八位 hash.扩展名` 的文件设置 `public, max-age=31536000, immutable`，HTML 按请求目标设置 `no-cache`；416/API miss/未知资源不继承缓存。真实双进程验证端口冲突后的 Store 重开。

## 代码落点

- `apps/server/src/runtime/static-web.ts`：异步校验与缓存头。
- `apps/server/test/static-web.test.ts`：路径安全、缓存、HEAD/range/API miss。
- `apps/server/test/server-startup.test.ts`、`shutdown.test.ts`：真实 listen/shutdown 生命周期。

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `c060be489c21d6646fff1b59615a8eb71d8951b2`，前序 #68–#71 已落地；T0/T1 待候选。
- **逐项判定**：C1/C2 已完成；C3–C6 待最终门禁与独立审查收口。
- **验收与 TDD**：issue #72；缓存头 RED 为旧实现缺失，随后通过；realpath/open 竞态、目录/成功流/取消句柄关闭、suffix/非法 range、合法 HTML symlink、EADDRINUSE、close-before-exit 均通过。
- **本地门禁**：`static-web.test.ts`、`static-web-race.test.ts`、`server-startup.test.ts`、`shutdown.test.ts` 共 23 项及 server typecheck 通过；最终全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、production/container smoke 与 `git diff --check <fixed-point>` 均通过。
- **双轴 review**：已关闭路径泄露、缓存污染、fd 泄漏、suffix range、启动清理和测试时序发现；最终候选待复核。
- **修复与回归**：校验/打开同一性、成功响应缓存、fd 生命周期和启动测试清理均已定向回归。
- **知识维护**：本页新建；Wiki 033/043 changed_by 已链接；schema/CONTEXT/ADR/README N/A（无形状、领域词、不可逆选型或用户操作变化）。
- **发布前裁决**：pending；默认仅本地分支。

## 边界与非目标

不缓存路径到内容、不替换静态目录、不放宽 symlink/containment/API miss、不新增公网缓存或鉴权；若 listen/close 已正确只补证据，不重写生命周期。

## 上下文演进

### 2026-11-13 — 建立静态与生命周期治理票据

- **触发证据**：静态请求存在同步 realpath/stat 与缓存策略缺失，listen failure 只有代码路径没有真实端口冲突证据。
- **原假设**：本地静态文件简单 serving 足够，但重复同步 I/O 与下载可在不改变安全边界时消除。
- **决定**：异步路径校验、hash 资产缓存和真实进程生命周期验证。
- **影响**：静态请求性能与响应缓存头；公开 API 和路径安全不变。
- **上下文处理**：preserve Wiki 033/043 的运行与安全约束，本页记录增量治理。

## 交接结论

实施后应以完整静态攻击回归、缓存头、真实端口冲突和 shutdown 测试证明；未完成独立 review 和全量门禁前不视为交付。
