# ADR-0003 — 本机同源生产服务与整个数据目录卷

状态：Accepted · 2026-09-30 · [#33](https://github.com/12bitsD/agent4novel/issues/33)

用户明确选择本机 Docker + CI；保持本地单用户，不扩展公网服务、鉴权、镜像发布或自动部署。开发继续使用 Vite 与 Hono 的两个端口，生产由一个 Hono/Node 进程提供编译后的 Web 与 API，宿主端口仅绑定 loopback。

服务端编译本地模块及共享契约，第三方生产依赖按锁文件精简部署。六个节点的 SKILL 仍是文件；沿 ADR-0002，不把 Prompt 转为数据库正文或运行时源码转译。发布物保留 `apps/server/dist/start.js` 与 `apps/web/dist` 层级，入口用 `import.meta.url` 定位根，避免 cwd 或用户另配根目录。生产入口只接收运行期环境，镜像不含本地密钥或测试数据。

容器的整个 `/data` 挂到项目命名卷，继承 SQLite 的短事务、条件写入、未知版本安全拒绝及不自动恢复模型调用。后续配置文件也在同一数据目录内管理，备份先停所有访问者并归档整个目录；恢复到新空卷，保留原卷，禁止隐式覆盖/清空。源码 `.data` 与容器卷是独立书架。

替代方案与证据见 [三案研究](../research/local-docker-ci-options.md)：单独反向代理、生产 tsx、全部工作区导出迁移等目前增加的边界超过收益。运行HOW及本票验证由 [Wiki033](../wiki/033-local-docker-ci.md)维护，provider HOW 继续由Wiki016维护。

CI有质量与容器两项独立门禁，只使用无密钥fake和本地mock，实际commit结果必须回读通过才合并。此选择能证明发布物和恢复流程可运行，不表示真实模型质量或完整MVP已经验收。
