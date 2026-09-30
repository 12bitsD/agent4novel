---
wiki_id: "033"
ticket: 33
ticket_state: active
context_state: current
summary: "本机同源Web/API生产镜像、整个SQLite数据目录卷与无密钥GitHub CI。"
topics: ["docker", "production-build", "ci", "volume-recovery"]
code_paths: ["Dockerfile", "compose.yaml", ".github/workflows/**", "apps/server/src/runtime/**", "apps/server/scripts/**", "scripts/**"]
symbols: ["createApp", "parseServerConfig", "A4N_DATA_DIR", "A4N_SERVE_WEB"]
inherits: ["009", "016", "014"]
changed_by: []
read_when: ["run-local-container", "debug-production-build", "verify-ci", "restore-container-volume"]
last_context_reviewed: "2026-09-30"
---

# 033 — 本机 Docker Compose 与 GitHub CI

## Agent Context

- **读取时机**：构建/运行本机容器、CI或恢复数据卷。
- **原始目的**：[#33](https://github.com/12bitsD/agent4novel/issues/33)把Docker/CI从#7拆出，交付本机单用户可运行产物。
- **实际落地**：compiled server＋精简依赖、同源静态Web/健康接口、非root镜像和Compose已落地；本机Linux容器两章、旧章修改、重建与整个目录备份恢复通过。quality/container workflow已配置；远端实际commit的CI在C7发布后核对，当前不宣称已通过。
- **当前价值**：继承#9整个数据目录、v1迁移、短事务、显式seed与不自动续跑；部署范围由用户明确选择。
- **后续变化**：#7配置与文件版本、#8坏例仍后续；公网/账号/镜像发布/自动部署不在本票。
- **代码入口**：Hono公开应用、生产装配、server构建、Docker/Compose、质量/容器CI及验收脚本。

## 设计目的

作者用Compose启动前后端与SQLite，在本机浏览器使用。数据独立于容器，重建后可继续编辑已保存作品；CI使用fake合成案例证明对应commit的工程可运行性。WHAT/AC以issue为准。

## 起始上下文

- 固定点 `b84e8a832ecc8d231ba3532b77ce9c32d4b23d6d`，#9 PR36已合并关闭，开始时工作区clean。
- `codex/33-local-docker-ci` → PR → main；用户已授权逐票loop，唯一当前产品选择为本机Docker+CI。
- #33 OPEN/ready-for-agent，2026-09-30 claim给12bitsD；Project agent4novel Development / Backlog，完成保持标签、assignee和Project，保留native #9 CLOSED关系。
- main无保护/rulesets、required checks/reviews为空，Actions enabled且当前workflows=0；新增quality/container将作为本票合并前门禁。发布前再次回读。C1–C6审实现/本地候选，远端实际CI在C7发布后等待且通过才merge/close，不能提前记为已执行。
- Matt flow未提供本地入口，按用户授权进行等价三案研究与自主收敛，所有关键决定见研究清单；无新增人决缺口。
- 读取#9当前数据目录/恢复边界、schema、CONTEXT、ADR0002和现行app/start/资源loader。开工Docker CLI可用、Colima未运行；启动既有Colima后发现缺Compose，安装官方v5.5.1 Darwin arm64 CLI插件并校验发布sha256。Node24.19.0镜像manifest和实际构建已核对。原用户8787/5173、凭据及作品不触碰。

## 技术方案

三方案及证据见 [生产装配研究](../research/local-docker-ci-options.md)：选择compiled server＋精简生产依赖、入口稳定资源定位、Node同源静态服务、两job CI，沿用既定单容器/数据目录卷。

跨票发布物层级、整个数据目录卷和后续配置文件的约束记录于 [ADR-0003](../adr/0003-local-production-runtime.md)。

- 服务端编译本地模块和contracts，第三方生产依赖由固定锁文件装配；发布白名单仅dist及所需资源。六节点SKILL保持文件权威。
- `A4N_SERVE_WEB`显式启用Web发布目录；开发Vite代理继续现有方式。启动不读取生产镜像中的secret文件；密钥只由运行期环境注入。
- 静态目录用绝对路径，API未知路由不回退HTML，路径越界与私密文件不公开；健康检查只给最小公开状态。缺失Web构建明确安全失败。
- Docker多阶段镜像、Node非root用户、localhost宿主端口、独立整个数据目录卷；默认无key演示，不隐式seed；备份停服务后复制整个目录，恢复先保全原目录。
- CI固定Node/pnpm与Action commit，frozen安装、test/typecheck/build；单独容器job fake两章/旧章编辑/容器重建恢复，timeout/只读contents/concurrency取消旧运行，不注入供应商key。

### 实现前TDD与提交计划

1. 已有createApp上的真实HTTP RED：缺少健康/HTML资源；GREEN接入窄静态端口/健康契约，补API404、HEAD、绝对路径、缺资源和目录隔离；typecheck双绿。
2. 编译/发布物：补稳定根定位、白名单/资源复制；从外部cwd运行编译服务端与精简生产依赖，验证健康、Web和所需SKILL。声明式构建配置用实际构建/启动验证，不计缺文件或命令为行为RED。
3. Compose/镜像：启动已有Colima，owned临时project/随机端口/合成输入；CLI推进两章与历史修改、重建容器严格比较快照，检查镜像层无secret/私有测试和数据文件。不删除用户卷。
4. CI/文档：固定workflow、确定性配置检查与全仓门禁；同步双语README、Wiki、运行skill、handoff；三轮自校准、独立双轴和有限attestation后发布，等待真实CI，失败回到门禁，成功才merge/close。

root实现本票；独立评审按canonical清单委派给未参与实现的reviewer。计划为一个一致交付逻辑提交；如CI暴露新缺陷，再保留独立修复RED/GREEN并重新冻结审查。

### 维护操作

前提：Docker引擎运行，`docker compose version`可用；Git下载仓库。Compose固定容器host0.0.0.0、内部8787和`/data`，只将宿主127.0.0.1端口映射出来；不支持公网部署。plain `docker compose up --build -d --wait`进入无key演示，真实模型用`docker compose --env-file .env.local up --build -d --wait`，provider字段仍按[Wiki016](./016-model-runtime-provider-config.md#配置契约)配置。宿主端口改`A4N_HTTP_PORT`；默认8787。模型密钥不经过Docker构建参数或COPY。

`docker compose ps`查看健康，`docker compose logs app`检查安全启动报错；健康接口`/api/health`仅返回`{status:"ok"}`。显式Web开关但缺构建会提示`frontend build is unavailable; run pnpm build`；无效模型/存储/监听配置安全拒绝且不回显输入。源码开发仍用Vite5173+API8787。编译发布`pnpm build`后可`pnpm --filter @agent4novel/server start`运行演示；该入口只使用进程环境，不自动加载`.env.local`。CLI在安装依赖的宿主执行`./apps/cli/bin/a4n ... --url http://127.0.0.1:8787`。

数据卷名按Compose项目生成，源码`.data`与容器卷是独立书架。保持原项目名，`stop`或不带卷删除参数的`down`都保留作品。下面仅对自己的作品操作，备份前确认页面已保存并停止所有访问该卷的进程；为每次备份选新的文件名：

```bash
docker compose stop
mkdir -p backups
docker compose run --rm --no-deps -T --entrypoint tar app -cf - -C /data . > backups/books-YYYYMMDD.tar
```

此归档包括整个数据目录而非仅sqlite主文件。恢复先保全原项目卷，换一个尚未使用的项目名，例如`agent4novel-restored`。以下空目录检查拒绝覆盖已有恢复卷；只使用自己选定的可信备份。原服务须停止，避免宿主端口冲突：

```bash
docker compose -p agent4novel-restored run --build --rm --no-deps -T --entrypoint sh app -c 'test -z "$(ls -A /data)" && tar -xf - -C /data' < backups/books-YYYYMMDD.tar
docker compose -p agent4novel-restored up -d --wait
```

后续维护该恢复书架时继续使用同一个`-p agent4novel-restored`。更新先停止并备份整个卷，再`git pull --ff-only`和对应项目的`docker compose up --build -d --wait`；不删除卷、不隐式seed或续跑模型。未知/更高SQLite版本安全拒绝；旧程序降级没有保证，先保全卷，选择兼容程序或在新项目恢复备份。

CI配置见workflow；quality执行frozen安装/全测试/typecheck/build/编译本地mock验证，container执行真实镜像两章及停服务归档恢复。PR/main/manual触发，两job超时、有同分支取消策略且contents只读；不获取供应商key、不做镜像发布或自动部署。远端对应commit的job结果必须回读成功才merge/close。

## 代码落点

- [app](../../apps/server/src/app.ts)与[静态服务](../../apps/server/src/runtime/static-web.ts)：窄公开目录、严格健康响应、API404、私密路径/越界拒绝。
- [start](../../apps/server/src/start.ts)、[配置](../../apps/server/src/config/server-config.ts)、[生产装配](../../apps/server/src/runtime/production-app.ts)：稳定根定位、Web开关、先验证资源再打开数据库，继续既有shutdown。
- [构建](../../apps/server/scripts/build.mjs)、[Dockerfile](../../Dockerfile)、[Compose](../../compose.yaml)：编译本地模块和contracts，复制六SKILL，生产依赖白名单、非root、loopback和整个目录卷。
- [workflow](../../.github/workflows/ci.yml)、[编译验证](../../scripts/production-smoke.mjs)、[容器验证](../../scripts/container-smoke.mjs)：真实SDK/本地mock、CLI双关卡及精确历史比较/停服务卷归档恢复，测试拥有的项目/卷独立清理。

## 测试与验证

2026-09-30证据目录 `/tmp/a4n-33-evidence/`；本地Node24.19.0/pnpm12.5.1、Colima Linux arm64/Compose5.5.1。fake、真实SDK本地mock、Linux容器和远端CI分别记录，不调用真实provider。

| AC | 当前候选证据 |
|---|---|
| 1 启动与同源 | static RED缺健康/HTML/缺build报错，GREEN4例；production-smoke从foreign cwd验证Web/健康与SDK；container-smoke真实健康与资源路径 |
| 2 精简镜像与卷 | Docker实际多阶段构建成功，nonroot与无server源码/测试/tsx/secret检查；dist六SKILL及整目录命名卷 |
| 3 两章重建恢复 | container-smoke-backup通过；CLI两章通过、旧章修改衔接提示、容器down/up后WorkView/list/全部SQL历史严格相等，遥测/命令账本空；停止后整目录备份与新卷恢复同样一致 |
| 4 CI配置 | 固定Node/pnpm与Action SHA、frozen安装、两job；本地执行相同质量/编译mock/容器脚本；真实远端结果待C7 |
| 5 CI无key及实际执行 | workflow只读contents、超时和同分支取消；脚本清空继承模型字段并只用本地mock/无keyfake；实际远端commit job在C7发布后取得，未取得前禁止merge/close |
| 6 文档 | 双语README、Wiki/索引、schema健康契约、skill、handoff、前序009/016路由与操作说明；旧009审核区不变 |

config RED4项真实缺行为（返回缺Web字段/开关未校验）后GREEN15；定向static/config/startup22通过及typecheck。全仓当前测试736（contracts100/server350/CLI166/Web120）、typecheck与build通过；仍有既有Web单chunk>500KB警告。frozen安装成功。正式冻结前补最终候选验证与三轮校准，不以这些快照代替独立审核。

三轮自校准（2026-09-30）：①代码↔行为/测试，健康/静态/配置失败路径与编译mock、容器重建和新卷归档恢复一致，沿既有Store/Pipeline/CLI；②代码↔知识，README区分两个书架、显式Compose运行期配置与源码加载，schema只新增健康契约，ADR0003保存跨票发布物层级，旧009审核区字节不变；③完整候选↔AC，全部实现映射AC1–6，无公网/工具/作者配置/坏例扩票，远端实际CI保留C7强制门禁。质量清理结论：复用Hono/contractJson与既有条件写入，无第二状态机；资源定位职责归生产入口，白名单和日志边界清晰；生产只装需要的依赖/构建结果，CI按两job隔离反馈。文档schema/180个本地链接/双语事实/旧审核区/凭据扫描已通过；无独立格式/lint脚本，用typecheck、node --check和diff --check验证。

### 完成审核证据

- **清单与候选**：清单blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `b84e8a832ecc8d231ba3532b77ce9c32d4b23d6d`；T0 `35c39b0dc60490832c3a87d327d09ee7c3ed5616`；T1 `87bd1bf68ca0ad557daa7398f93a7c4051c41ed4`。31个精确文件见 `/tmp/a4n-33-evidence/manifest.txt`，候选完整diff/两类diff checks已回读；fixed-point..HEAD无本地提交、无unstaged/untracked余项。完成字段之外不改候选。
- **逐项判定**：C1.1–C1.8 PASS：issue/依赖/Project快照、claim、固定点/分支、用户本机Docker+CI决定、三案研究及版本化TDD计划；C2.1–C2.5 PASS：真实static/config RED→GREEN、全包验证及AC映射，C2.6 N/A（本票有行为变化，已执行RED/GREEN）；C3.1–C3.6 PASS：最终质量输出、node语法、diff/凭据/日志/忽略规则与质量清理；C4.1–C4.9 PASS：Wiki/schema/双语README/ADR/research/handoff/skill/结构链接及三轮自校准，C4.3 CONTEXT N/A（未增加领域词，健康契约已写schema）；C5.1–C5.7 PASS：精确manifest、完整patch/空本地历史、独立双轴及R01新tree复核；C6.1/C6.2 PASS：文档发现直接修复、知识校验与新冻结候选两轴PASS；C6.3为本次受控忠实证据转录，C6.4 pending。全部输出在同一证据目录。C7实际远端CI待发布后取得，不列N/A、不提前记为PASS，失败返回相应门禁，成功才merge/close。
- **验收与 TDD**：issue #33 AC1–3及6的代码/本地结果见上表；AC4/5配置与本地同脚本验证已通过，真实commit的远端quality/container保留C7强制条件。`static-red.log`3项因缺HTTP健康/HTML/缺build拒绝行为失败→`static-green.log`4通过；`config-red.log`4项缺字段/开关/非法校验→`runtime-green.log`定向22通过。声明式容器/CI配置通过实际构建启动和脚本验证，不以缺文件/命令冒充RED。生产SDK仅自建loopback mock；真实供应商未调用。
- **本地门禁**：2026-09-30 Node24.19.0/pnpm12.5.1；`pnpm install --frozen-lockfile` PASS（frozen-install.log）；最终`pnpm test`736 PASS（contracts100/server350/CLI166/Web120，full-test.log）、`pnpm typecheck`/`pnpm build` PASS（full-typecheck.log/full-build.log）；`node scripts/production-smoke.mjs` PASS（production-smoke-final.log）；`node scripts/container-smoke.mjs` Linux arm64真实非root/同源/两章/旧章编辑/重建/整个目录归档新卷恢复PASS（container-smoke-final.log）。全部修改源JS用node --check验证，两类git diff --check PASS；无独立lint/format脚本，由类型/语法/whitespace覆盖。仅既有Web docx chunk>500KB警告；不表示质量/公网部署完成。`.env.local`和`.data`仍忽略，无实际凭据/私有素材/供应商响应泄露。
- **双轴 review**：未参与本票实现且彼此隔离的 `/root/sqlite_standards_review` 和 `/root/sqlite_spec_review`，原始报告standards-review.md/spec-review.md保留。Standards原T0前候选发现R01[P2] Wiki016顶部配置入口不准确，已接受修复；新T0的standards-review-fixed.md与spec-review-fixed.md均PASS，零剩余actionable发现。两轴独立22项runtime与compiled SDK本地mock PASS；精确31-file diff/空提交历史/工作区/旧009审核区均核对。Spec明确AC5实际CI为C7待验，不能用本地结果替代。
- **修复与回归**：R01仅Wiki016 reviewed日期及Agent Context实际落地/后续变化3行，准确区分源码加载`.env.local`与编译/容器运行期环境并路由033；无行为变化，C6.1行为RED N/A（文档修复直接结构/事实校验）。docs-validation-fixed.json为31files/181本地链接/schema/双语事实/凭据/旧audit字节不变PASS；新完整T0独立双轴复核PASS，原行为门禁适用。未拒绝任何发现、无新增Human裁决。
- **知识维护**：本票Wiki/索引/009完成状态与后继入口/016启动边界、健康schema、双语README、handoff、运行skill均更新；ADR0003与三案research保存生产布局/整个目录卷及选型，沿ADR0002文件Prompt权威；CONTEXT未变（C4.3无新领域词）。既有009完成审核区逐字节相同。三轮自校准及复用/可读性/边界/效率结论见上文。剩余限制为本机单用户、诊断不跨重启、未保存内容不恢复、整目录备份须停止所有访问者、旧库降级不保证、远端CI等待C7。
- **发布前裁决**：2026-09-30 未参与实现的 `/root/sqlite_spec_review` 对上述T1独立attestation PASS（`/tmp/a4n-33-evidence/attestation.md`与attestation-integrity.json）。清单blob/固定点/T0/T1均准确；C1–C5分节PASS（相关N/A与证据如上），C6.1/C6.2文档修复及新完整tree复核PASS，C6.3忠实受控转录PASS，C6.4精确比较T0→T1仅预留8字段内7项变化、全候选/空本地历史/工作区/凭据/证据映射PASS。独立确认736tests/181links/31files、R01原始发现保留及修复、旧009审核块字节不变与原始输出一致。remaining风险仍为上列边界及实际远端quality/container待C7，成功前禁止merge/close；失败回到相应门禁。本次一次性写入T1与裁决，终止比较结果、提交/CI/merge/关闭记录留GitHub完成评论，不写自身最终tree或提前宣称整节C6已通过。

## 边界与非目标

本机单用户；无公网服务/鉴权/云资源/TLS/registry/自动部署。#7作者配置、#8坏例另票；#28/#29继续后置。原内存服务不迁移/停止。CI不调用真实provider，不把工程成功称为小说质量或公网已上线。数据卷删除和旧库降级不属于启动/升级默认动作。

## 上下文演进

### 2026-09-30 — 本机部署与作者配置分票

- **触发证据**：用户要求Docker与CI，但原#7持有作者配置AC；用户进一步明确选择本机部署终点。
- **原假设**：新增部署方向可直接附在#7一起开发。
- **决定**：独立#33，先验证SQLite生产装配与容器恢复，保留#7原AC与后续队列。
- **影响**：本票原生依赖#9；生产运行、容器/CI和配置迭代有独立验收。
- **上下文处理**：preserve原产品决定和#7作者配置目的，新增本票入口，不把后续能力写成已实现。

## 交接结论

本地容器与编译发布物已验证；远端对应commit的CI和最终交付状态由issue/PR/job回读，当前不提前宣称已完成。#7继承同一整个数据目录与编译发布物资源定位；完整MVP仍要配置、坏例和父票联验。
