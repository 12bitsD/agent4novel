---
wiki_id: "033"
ticket: 33
ticket_state: done
context_state: current
summary: "本机同源Web/API生产镜像、整个SQLite数据目录卷与无密钥GitHub CI。"
topics: ["docker", "production-build", "ci", "volume-recovery"]
code_paths: ["Dockerfile", "compose.yaml", ".github/workflows/**", "apps/server/src/runtime/**", "apps/server/scripts/**", "scripts/**", "apps/cli/test/command-entry.test.ts", "package.json"]
symbols: ["createApp", "parseServerConfig", "A4N_DATA_DIR", "A4N_SERVE_WEB"]
inherits: ["009", "016", "014"]
changed_by: ["007", "008"]
read_when: ["run-local-container", "debug-production-build", "verify-ci", "restore-container-volume"]
last_context_reviewed: "2026-09-30"
---

# 033 — 本机 Docker Compose 与 GitHub CI

## Agent Context

- **读取时机**：构建/运行本机容器、CI或恢复数据卷。
- **原始目的**：[#33](https://github.com/12bitsD/agent4novel/issues/33)把Docker/CI从#7拆出，交付本机单用户可运行产物。
- **实际落地**：compiled server＋精简依赖、同源静态Web/健康接口、非root镜像和Compose已落地；本机Linux容器两章、旧章修改、重建与整个目录备份恢复通过。quality/container workflow已配置；[PR37](https://github.com/12bitsD/agent4novel/pull/37)已合并，#33已关闭，最终源提交两项[CI](https://github.com/12bitsD/agent4novel/actions/runs/36653441274)均成功。
- **当前价值**：继承#9整个数据目录、v1迁移、短事务、显式seed与不自动续跑；部署范围由用户明确选择。
- **后续变化**：[Wiki007](./007-author-agent-config.md)扩展恢复联验，验证作者配置与Prompt/Skill文件；[Wiki008](./008-bad-example-collection.md)再覆盖不可变坏例及SQLite v3恢复。公网/账号/镜像发布/自动部署不在本票。
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

config RED4项真实缺行为（返回缺Web字段/开关未校验）后GREEN15；定向static/config/startup22通过及typecheck。修复后全仓当前测试741（contracts100/server350/CLI171/Web120）、typecheck与build通过；仍有既有Web单chunk>500KB警告。frozen安装成功。远端首次quality的组合测试超时修复后，定向90项与全仓质量/编译mock再次通过；容器代码未变，已有完整本地/初次远端container证据有效。正式冻结前补最终候选验证与三轮校准，不以这些快照代替独立审核。

三轮自校准（2026-09-30）：①代码↔行为/测试，健康/静态/配置失败路径与编译mock、容器重建和新卷归档恢复一致，沿既有Store/Pipeline/CLI；②代码↔知识，README区分两个书架、显式Compose运行期配置与源码加载，schema只新增健康契约，ADR0003保存跨票发布物层级，旧009审核区字节不变；③完整候选↔AC，全部实现映射AC1–6，无公网/工具/作者配置/坏例扩票，远端实际CI保留C7强制门禁。质量清理结论：复用Hono/contractJson与既有条件写入，无第二状态机；资源定位职责归生产入口，白名单和日志边界清晰；生产只装需要的依赖/构建结果，CI按两job隔离反馈。文档schema/181个本地链接/双语事实/旧审核区/凭据扫描已通过；无独立格式/lint脚本，用typecheck、node --check和diff --check验证。

补充三轮自校准（第二次CI修复候选）：①六输入断言不变，10秒子进程/30秒测试为夹具期限，root按包串行；定向90/Mac741/完整受限Linux741通过，无产品校验或请求期限变化；②研究与Wiki保存两次失败、首次局部Linux非RED限制及三案组合，新审核字段重置，旧009审核区保持；③32-file候选仍覆盖AC1–6，旧两轮CI失败不合并，新commit两job成功才关闭。复用既有CLI公共测试接缝，无新应用抽象；牺牲测试并发速度换取资源归属与更稳的冷启动验收，不承诺性能已优化。

### 完成审核证据

- **清单与候选**：清单blob `42116082e8ca2804d826cc00f6578270077f60eb`；固定点 `b84e8a832ecc8d231ba3532b77ce9c32d4b23d6d`；T0 `0663f52c92929cae2c68572014ddf27b23f00d16`；T1 `8573b3eeed841367042b9fdc0cb067fe6b00c961`。32文件manifest-budget.txt；已有26e4dd4/b9fb674两笔提交与旧审核材料保留，全历史/完整patch/工作区已独立审核。
- **逐项判定**：C1.1–C1.8 PASS：issue/依赖/Project/授权/claim/分支/三案/TDD/范围/元数据终态，独立live回读一致；C2.1–C2.5 PASS：原真实行为RED→GREEN与AC/边界，测试资源/夹具修复保持公共CLI接缝，C2.6 N/A（有行为且TDD已做）；C3.1–C3.6 PASS：当前全门禁/完整Linux与安全资源来源/质量结论；C4.1–C4.9 PASS：知识/双语/181links/旧audit/三校准，C4.3 CONTEXT N/A无新词；C5.1–C5.7 PASS：32files/精确tree/全部两commit与staged完整patch/新独立双轴，旧tree结论不代替新审核；C6.1/C6.2 PASS：R01与两次CI触发修复、当前定向/全量/受限Linux/typecheck/build/mock、重跑独立双轴；新增行为RED N/A（测试夹具/资源与文档，未改产品行为），不以环境超时或局部PASS冒充产品RED。C6.3本次忠实受控转录，C6.4 pending。C7两次quality超时/container成功；实际新commit两job成功才merge/close，无N/A或替代。
- **验收与 TDD**：AC映射与原static/config真实RED→GREEN见上；ci-second-failed.log是本次触发证据。夹具预算/测试资源整理不改产品行为，C6.1新行为RED N/A，原产品TDD保留；首次2CPU Linux678项局部试验通过且未复现，不称RED；完整Linux741与定向90通过。
- **本地门禁**：2026-09-30 ci-budget-targeted.log90/ci-budget-typecheck.log PASS；完整pnpm test741（100/350/171/120）/typecheck/build及compiled mock PASS（full-*-budget.log/production-smoke-budget.log）；2CPU、4GiB上限、断外网Linux完整741 PASS（linux-budget-green.log）。原镜像/服务/workflow代码未改，原完整容器恢复与两次远端container仍是对应相同实现的历史证据，新commit结果待C7。补充linux-budget-verified.log完整741/exit0；linux-budget-command.json实际argv及linux-budget-container-limits.json安全inspect确认NanoCpus2000000000/Memory4294967296/networknone/只读mount，与执行输出匹配。无独立lint，类型/语法/whitespace及安全检查；既有Web chunk警告；secret忽略且无泄露。
- **双轴 review**：原R01修复、旧双轴/attestation/terminal原始报告保留；root test资源策略及夹具预算是新实质候选；当前T0的standards-review-budget.md和spec-review-budget.md独立PASS，零actionable发现。两轴各自CLI90 PASS，机械normalize确认除夹具/注释外输入/断言/逻辑同字节；完整候选/两commit/delta/无余项/旧audit/安全及Linux资源来源/完整741输出均独立核对。無拒绝发现/新人决，新CI仍C7条件。
- **修复与回归**：六输入独立用例保留；第二次CI单例及续章组合超时后，根test指定workspace-concurrency=1，command-entry每子进程10秒/每测试30秒。全部输入/错误/无HTTP/安全输出/文件不变断言一致，无skip/retry，应用请求和job期限不变；Mac及完整Linux门禁通过，不能替代新远端CI。
- **知识维护**：Wiki033追加第二次失败/选型事件，research三案组合及局部试验限制；schema/双语README/ADR/handoff/skill事实未漂移，旧009审核区字节不变。C4.3 CONTEXT N/A（无新领域词）；C2.6 N/A（原产品行为已TDD）；本次测试夹具调整/文档直接校验。补充三校准见上文，无新人决。
- **发布前裁决**：独立 reviewer `/root/sqlite_spec_review` 在 attestation-budget.md 对清单blob `42116082e8ca2804d826cc00f6578270077f60eb`、固定点 `b84e8a832ecc8d231ba3532b77ce9c32d4b23d6d`、T0 `0663f52c92929cae2c68572014ddf27b23f00d16` → T1 `8573b3eeed841367042b9fdc0cb067fe6b00c961` 给出 C6.4 PASS：仅四个预留字段受控转录，32文件、两笔历史提交、工作区、安全、旧audit和原始门禁/双轴来源均一致。C1–C5 分节PASS（逐项N/A见上）；C6.1/C6.2修复与全门禁/重新双轴PASS，C6.3忠实转录PASS，C6.4独立attestation PASS。本次C6.5仅一次填入T1及此裁决；C6.6独立终止核验、C6.7安全manifest与新commit实际quality/container两job成功仍待发布流程，不提前宣称整节C6或ticket完成。两次真实CI失败及678局部试验保留，不能用本地或旧container成功代替新commit CI；本机单用户、遥测窗口、未保存页面编辑、停止全目录备份/不保证降级等限制保留。

## 边界与非目标

本机单用户；无公网服务/鉴权/云资源/TLS/registry/自动部署。#7作者配置、#8坏例另票；#28/#29继续后置。原内存服务不迁移/停止。CI不调用真实provider，不把工程成功称为小说质量或公网已上线。数据卷删除和旧库降级不属于启动/升级默认动作。

## 上下文演进

### 2026-09-30 — 本机部署与作者配置分票

- **触发证据**：用户要求Docker与CI，但原#7持有作者配置AC；用户进一步明确选择本机部署终点。
- **原假设**：新增部署方向可直接附在#7一起开发。
- **决定**：独立#33，先验证SQLite生产装配与容器恢复，保留#7原AC与后续队列。
- **影响**：本票原生依赖#9；生产运行、容器/CI和配置迭代有独立验收。
- **上下文处理**：preserve原产品决定和#7作者配置目的，新增本票入口，不把后续能力写成已实现。

### 2026-09-30 — 远端冷启动测试期限按用例归属

- **触发证据**：PR37初次run36650338613的container成功，quality在CLI畸形文件组合测试的5秒总期限失败；六个独立冷启动共用同一预算。
- **原假设**：本机组合测试约1.4秒，默认期限足够。
- **决定**：三案评估后按六种输入拆为独立用例，保留每进程与每用例的5秒限制、零HTTP/无泄露/文件不变全部断言；不用放宽校验或重试掩盖失败。
- **影响**：测试数量增加5，产品代码不变；返回C3/C5/C6重新审核后重跑真实CI，失败前候选不合并。
- **上下文处理**：preserve原始RED/GREEN与首次审核/CI失败材料；replace本票当前候选证据。研究与原始日志保留原因。

### 2026-09-30 — 共享runner资源与冷启动夹具预算

- **触发证据**：第二次run36651606459仍在独立byte-limit和续章组合测试的5秒失败，container成功。
- **原假设**：第一次按输入拆分且保留5秒就足够；局部Linux678项通过，但缺Web test目录且未复现远端，不能证明假设。
- **决定**：新三案组合选择按工作区串行与有界冷启动夹具预算：每进程10秒、每测试30秒，保留所有行为/安全断言，不skip或retry；不改应用请求/CI job期限。
- **影响**：本地完整741与2CPU/4GiB上限、断外网Linux完整741通过；新实质候选重新走双轴/有限attestation，仍须新commit真实CI。根pnpm test执行策略变化，生成/保存/关卡不变。
- **上下文处理**：preserve第一次研究/修复及两次原始失败，replace当前候选证据和“拆分足够”假设；研究保留被新证据推翻的理由。

### 2026-09-30 — 作者配置接入版本文件

- **触发证据**：#7 的生产配置、文件校验、操作快照和整目录恢复测试。
- **原假设**：原票交付时只有旧Work.config/数据库和运行期配置。
- **决定**：当前作者配置与受管文件见[Wiki007](./007-author-agent-config.md)，provider HOW仍由016持有，部署HOW仍由033持有。
- **影响**：严格SQLitev1迁移v2，备份含prompts目录；保存只影响下次操作，不改旧产物。
- **上下文处理**：preserve原始目的、历史失败和完成审核证据；replace顶部当前路由事实。

### 2026-09-30 — 坏例纳入整个目录恢复联验

- **触发证据**：#8引入SQLite v3坏例表，当前container smoke覆盖pending标记、随后改写/通过、同请求回执、重建及停止后整目录备份恢复。
- **原假设**：恢复联验只需要作品、产物、关卡及作者配置文件。
- **决定**：复用现有容器验收增加不可变坏例；不另建存储或备份机制。
- **影响**：当前恢复范围见[Wiki008](./008-bad-example-collection.md)，部署和卷职责保持。
- **上下文处理**：preserve本票原始意图及完成审核证据；replace当前恢复导航，扩展验证入口。

## 交接结论

本地容器、编译发布物与最终源提交远端CI均已验证，PR37合并且#33关闭；终止状态由issue/PR/job回读。#7继承同一整个数据目录与编译发布物资源定位；完整MVP仍要配置、坏例和父票联验。
