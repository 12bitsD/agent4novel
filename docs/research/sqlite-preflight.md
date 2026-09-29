# #9 SQLite 开工预检与三个纵向切片

2026-09-30；当前 #19 候选冻结中。只读了仓库与 #9 已收敛票面，没有改动仓库、依赖、lockfile、远端或用户服务；没有读取 `.env` 内容。以下是预检、SQL 机制实验与建议计划，**不是 #9 已实现或 AC 通过证明**。

## 已锁定范围

沿 [ADR-0002](https://github.com/12bitsD/agent4novel/blob/main/docs/adr/0002-storage-sqlite-skills-as-files.md) 与 [#9](https://github.com/12bitsD/agent4novel/issues/9)：SQLite / better-sqlite3，作品行＋按版本产物行，JSON content/inputs，保留配置、全部版本、状态、输入引用；沿用 WorkStore 与公开 head 视图。无旧内存迁移、历史版本 UI、任务队列、自动续跑 LLM、Skill 数据库副本。#19 的 `artifactSchema/workSchema/workDetailSchema`、StoreContractError、安全 HTTP 输出是衔接入口。

## 实际环境、选型与安装政策

- `node --version` = `v24.19.0`；darwin/arm64，Node module ABI 137。
- `COREPACK_ENABLE_AUTO_PIN=0 pnpm --version` = `12.5.1`；npm 不在 PATH。仓库 lockfile 版本 9.0，packageManager/Node engine 尚未固定；本轮未改。
- npm registry 实际元数据：better-sqlite3 `13.0.3`，Node `>=22`；依赖 node-addon-api；无 install/postinstall，`gypfile:false`，包内带八种平台预编译文件。`@types/better-sqlite3` `9.6.0`。本机实际加载得到 SQLite `3.53.4`，`SELECT 40+2` = 42。[官方项目的支持范围与安装说明](https://github.com/WiseLibs/better-sqlite3#installation)
- 建议此次首次引入固定上述已实验版本（不是升级已有 SQLite）。pnpm 12 使用 `allowBuilds`，不使用已移除的 onlyBuiltDependencies。实验明确 `better-sqlite3: false`：使用包内预编译，禁止生命周期构建，干净安装及 frozen-lockfile 均成功。仓库原有 esbuild 的未裁决 build 也会令安装失败，应在 #9 必要安装收口时明确列白名单；不要关闭 strictDepBuilds 或允许所有包构建。[pnpm 官方 build 设置](https://pnpm.io/settings/build#allowbuilds)
- 首次实验错误：添加 `--ignore-workspace` 同时忽略了临时目录本身的 allowBuilds，故返回 `ERR_PNPM_IGNORED_BUILDS`；依赖虽已下载，不能当安装成功。移除该 flag 并在另一个全新目录复验，安装 exit 0。没有改全局策略。
- 包内有 linux-x64/linux-arm64 与 musl 预编译，不等于 Linux 已实测；Docker/Linux 实测交给 #33。本机 Colima 未启动，本轮没有启动它。

可复现材料：

- `/tmp/a4n-9-preflight-4sxpb8nx/`：package.json、pnpm-workspace.yaml、lockfile、失败 install.log、成功 install-frozen.log、native-smoke.json、sqlite-probe.mjs/result/stderr。
- `/tmp/a4n-9-clean-install-iblt3bai/`：相同固定 manifest 的首次成功 install.log 与 native-smoke.json。

```sh
cd /tmp/a4n-9-clean-install-iblt3bai
COREPACK_ENABLE_AUTO_PIN=0 pnpm install --frozen-lockfile --reporter=append-only
node --input-type=module -e 'import Database from "better-sqlite3"; const db=new Database(":memory:"); console.log(db.prepare("SELECT sqlite_version() AS sqlite, 42 AS answer").get()); db.close()'
cd /tmp/a4n-9-preflight-4sxpb8nx
node sqlite-probe.mjs
```

第三条每次创建新的 `/tmp/a4n-9-sqlite-probe-*` 数据目录，启动并终止自己创建的子进程；不碰项目服务。

## 建议 migration v1

`works`：id TEXT PK、title/seed/created_at TEXT NOT NULL、config TEXT NOT NULL + JSON 合法性；`artifacts`：id TEXT PK、work_id FK、kind、chapter（作品级 NULL）、version、content、human_status、created_at、inputs（可空 JSON）。使用 STRICT 表、外键开启、版本与章号上限 Number.MAX_SAFE_INTEGER。SQL 只守结构/地址/唯一性，六 kind 内容仍由共享 Zod 校验，不复制成 SQL 字段树。

两个需要显式防住的 SQLite 规则：普通 UNIQUE 将 NULL 视为不同值；CHECK 结果为 NULL 不算失败。因此不要只写 `(work_id,kind,chapter,version)` UNIQUE，也不要省略 `chapter IS NOT NULL`。采用下面两条 partial unique indexes，以及严格 kind/chapter CHECK。[SQLite 约束](https://www.sqlite.org/lang_createtable.html#unique_constraints)、[partial indexes](https://www.sqlite.org/partialindex.html)、[STRICT 表](https://www.sqlite.org/stricttables.html)

```sql
CREATE UNIQUE INDEX artifact_work_version
  ON artifacts(work_id, kind, version) WHERE chapter IS NULL;
CREATE UNIQUE INDEX artifact_chapter_version
  ON artifacts(work_id, kind, chapter, version) WHERE chapter IS NOT NULL;
CHECK (
 (kind IN ('caption','creative','outline','setting') AND chapter IS NULL)
 OR
 (kind IN ('beat','prose') AND chapter IS NOT NULL
  AND chapter BETWEEN 1 AND 9007199254740991)
)
```

迁移用 `PRAGMA user_version`（首版 0→1）并在同一个 immediate 事务内建表/索引和更新版本；再次打开幂等。比代码新的版本、非空但未识别的 schema、迁移错误均安全拒绝，不自动清库/降级。开始迁移后要在事务内重新读取版本，以防两连接同时初始化。建议 WAL＋synchronous FULL、5 秒有界 busy timeout；备份／Docker 卷必须覆盖整个数据目录，运行期间不可只拷贝主文件。长 LLM 请求始终在事务外。

## Store 写入与 CAS

单次持久写按以下顺序：BEGIN IMMEDIATE → 检查 work → 读当前目标 head → 比较 expected id/version/status → 比较实际上游 preconditions → 构造并用共享 schema 验证候选 → insert/update → COMMIT。版本冲突沿用 `version-conflict`，上游变更沿用 `upstream-changed`；不能将所有 SQL 错误冒充可重试冲突。数据非法与损坏不带内容出错。`.transaction(...).immediate()` 会把异常回滚；已用独立进程竞争验证一成功、一冲突。[better-sqlite3 事务](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function)、[SQLite BEGIN IMMEDIATE](https://www.sqlite.org/lang_transaction.html)

append 保存全新 id/version；save 同样追加并保留 humanStatus/inputs；finalize 修改原行 content/status，保留 id/version/createdAt；setStatus 只改 head，继续拒绝 Setting/Beat/Prose 的旁路通过。读当前 head 后 JSON.parse，再 shared schema；不在 getWork 扫全部历史。列表与章目录结果保持既有行为与稳定排序。数据库连接由装配层关闭；不要求把 lifecycle 混入每个 WorkStore 业务方法。

实现前须收口的实际代码缝隙（普通工程决策，不需新增 Human 选择）：

1. `pipeline.ts` 非 gate 产物（Caption）目前 append→setStatus；`routes/works.ts` Creative select 也 append→setStatus。分别 autocommit 会有进程崩溃后留下中间 pending 的窗口。
2. Creative/Outline 路由的 expectedHeadVersion 比较在 append 调用外；不能把它误写成 SQLite 事务内 CAS 已覆盖。
3. 推荐小幅扩展 Store 的原子追加选项／命令，将“追加最终状态＋preconditions”在单次提交表达，并为旧路由传入条件；限制通过通道，不能让该选项成为 Beat/Prose/Setting 的旁路。比新增通用 transaction(callback) 横穿领域层更窄。两适配器共用行为测试覆盖；如选不同实现，记录同等原子性证据。

## 三个纵向 TDD 切片

| 切片 | RED 的用户可见行为 | 最小 GREEN 与验收 | 提交边界 |
|---|---|---|---|
| 1 数据库开闭与读取 | 当前无 SQLite adapter；关闭新开后作品/产物不存在；非法库不能安全拒绝 | v1 migration、WorkStore基础create/list/get/head、完整json/shared校验、连接关闭；共享 Store 套件参数化；损坏内容/未来schema失败，旧库不被重建 | adapter骨架＋迁移＋共享fixture |
| 2 原子版本与关卡 | 同baseline双写、状态变化后旧save、上游修改后提交、复合append/approve不能满足持久原子性 | 全部 Store methods、事务CAS、候选先验证，复合提交收口；错误零行数变化、finalize同版、save新版本、空pending允许但空approved拒绝；两连接和独立进程竞争 | 写入语义＋必要调用接入＋定向测试 |
| 3 生产装配与真实重启 | 服务重新启动书架/两章丢失，seed每次重复；恢复后上下文引用不完整 | 默认 SQLite 路径可配置；demo seed 显式且幂等；独立fake HTTP/CLI进程完成两章与历史编辑，杀进程并重启同库，逐字段回读；无自动模型重跑；全仓门禁与文档 | runtime wiring＋重启集成＋Wiki/README/schema/skill |

共享测试只依赖 WorkStore 公共方法；原 `store-validation.test.ts` 直接篡改 private Map 的损坏 fixture 不可照搬，应将跨适配器行为套件与适配器专属损坏注入分开。通过 SQLite 原生连接注入的非法 JSON 内容只在测试专属文件执行。原始源码与 secret 不作为实验输入。

## 真实项目重启测试方法（待 #9 实现）

1. 创建专属临时目录/DB；fake 六 Step；HTTP 绑定 loopback 随机端口。新建 SQLite 版本 fixture，避免 import 会加载开发者 `.env.local` 的 index；不得调用用户 :8787/:5173。
2. 经真实 CLI→HTTP 创建作品并跑完两章关卡；已通过第一章正文再保存，使第二章有衔接提示；另保留一项 pending 草稿，保存原文中的空白和全部 id/version/status/inputs。
3. 记录 CLI/readback snapshot、数据库各版本行数及版本序列。收到成功响应后对自己 child SIGTERM 并 wait close；第二个 child 用同路径新连接启动。重复 readback，严格比较两个 snapshot 与历史行数、config、chapterCount/工作章/提示；验证 seed 未增、未触发fake step计数。
4. 另做 SIGKILL 后恢复；对已提交内容可见、未提交写入不可见分别有定向证据。pending不能因重启自动approved，读页面不调用LLM。
5. 复用 shared Store 测试＋CLI续写集成；最后仓库 pnpm test/typecheck/build。Linux/容器验收在 #33实际运行，不用此mac探针代替。

## 本轮已执行的机制实验结果

`sqlite-probe-result.json`：migrationRollback=true；chapterNullRejected=true；workAddressUniqueness=true；committedSurvivesSIGKILL=true；uncommittedRolledBack=true；concurrentCas=[committed,version-conflict]；finalRows=2。两次被 SIGKILL 的均为探针自己 fork 的 Node 子进程；reader/cas 也是独立进程。首次未显式防 chapter NULL 的 SQL 草案被发现不严，修正后实际检查拒绝；正式实现仍须先写项目 RED。

限制：本轮未建立项目 SQLiteStore、未改包依赖、未跑项目 restart、未启动Docker、未做性能承诺。也未用数据库保存或发送真实作品。用户已明确选择本机Docker+CI；当前没有待Human产品选择。
