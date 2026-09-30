# 本机 Docker / CI：生产装配三案

2026-09-30；基线 `b84e8a832ecc8d231ba3532b77ce9c32d4b23d6d`。范围与全部对齐点继承 [MVP决定清单](./mvp-delivery-options.md)，用户已选择本机Docker+CI。

| 方案 | 机制与证据 | 代价/选择 |
|---|---|---|
| A 编译服务端、精简生产依赖 | esbuild打包本地服务端及contracts，第三方运行依赖保持external；pnpm deploy生产依赖与files白名单；仅复制编译结果、六节点SKILL文件、Web资源 | 选择；保持现有公共接缝，需验证资源路径和原生SQLite模块 |
| B 全部包独立tsc产物 | 服务端/契约分别输出JS，修改package exports及开发条件 | 可行但扩张到整个工作区编译与开发模块解析，收益不足 |
| C 生产tsx直接执行源文件 | 运行期转译TS，复制服务端/契约源文件，安装tsx生产依赖 | 简单但生产依赖与源文件范围更大，不利于精简发布物 |

[pnpm官方deploy](https://pnpm.io/cli/deploy)提供独立依赖目录及files白名单；固定当前12.5.1验证，不依赖未来版本的新行为。[Docker多阶段构建](https://docs.docker.com/build/building/multi-stage/)允许最终镜像仅复制选定发布产物。前端与API同源沿既定单容器选择，不引入Nginx或公网入口。

资源定位三案：①依赖启动cwd（在Compose/CLI和测试中易漂移）；②显式部署环境根路径（增加用户配置与错误组合）；③在保留apps/server层级的源/编译入口用import.meta.url定位仓库根，再传给现有config装配。选③，节点SKILL同时复制到编译入口相对的skills目录；测试从不同cwd启动。[Hono Node静态服务说明](https://hono.dev/docs/getting-started/nodejs#serve-static)支持基于import.meta.url的稳定绝对根。

静态路由三案：①Node直接提供Web/API（所选，复用Hono）；②Nginx代理（多一套启动与健康边界）；③Vite生产进程（增加开发依赖，缺少精简发布收益）。只开放Web发布目录，API未知地址继续JSON404，资源缺失不伪装成功；健康响应为最小公开状态，不含作品或配置。

CI三案：①单job全串行（简单但反馈与容器日志混合）；②质量门禁＋容器验收两个job（所选，独立超时/结果）；③多平台/模型矩阵（现阶段成本高，真实模型费用不进入CI）。固定Node24.19.0/pnpm12.5.1，Action固定已核对官方tag的commit；PR/main/manual，只读contents与同分支取消过期运行。[GitHub并发说明](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)支持cancel-in-progress。远端CI实际结果在C7发布后等待，失败修复返回相应门禁；本地成功不能代替远端结果。

验收：HTTP健康/Web/API与目录隔离；可执行编译服务端及生产依赖；Linux容器两章与旧章编辑，重建容器逐字段恢复且不自动模型续跑；最终commit远端quality/container均真实通过。镜像和CI不使用本地供应商密钥或私人素材，测试只用合成数据和临时卷。无需新增人决点。

首次远端quality运行36650338613暴露一个测试执行问题：六个CLI冷启动合用Vitest默认5秒，runner上的总耗时超限，而container job通过。修复三案：A只延长这个组合测试的期限（容易掩盖变慢）；B把六个输入拆为六个独立用例，保留每个子进程和测试各5秒上限及所有原断言（选择，故障可精确定位）；C串行运行全部工作区测试以减轻资源竞争（可行，但拖慢整个质量job且不能解决组合期限的归属）。B不改产品行为或安全校验；原始失败日志保留，重新冻结完整候选、复审和运行真实CI。
