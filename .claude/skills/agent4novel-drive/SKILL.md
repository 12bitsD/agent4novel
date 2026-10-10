---
name: agent4novel-drive
description: 用命令行驱动 agent4novel 创作链路、独立运行节点和对照 SP，安全配置模型与生成参数，准备测试 case、查 LLM 遥测、读前端页面。测试链路、分析产物质量或排查 LLM 失败时使用。
---

# 驱动 agent4novel

本项目的创作链路用 CLI(`./apps/cli/bin/a4n`)驱动,**不要手搓 curl**。只有 `select`／`save-outline` 自动回填 `expectedHeadVersion`；`approve-outline`、Setting、Beat、Prose和start-chapter的专用写命令使用请求文件中的显式基线，不替换成最新head。正常结果的stdout是纯JSON，进度与错误走stderr。HTTP/传输错误会exit≠0，但`advance`/`start-chapter`即使HTTP200也可能返回`kind: "failed"`，必须同时检查JSON outcome。

模型与 provider 配置的唯一 HOW 是 [`docs/wiki/016-model-runtime-provider-config.md`](../../../docs/wiki/016-model-runtime-provider-config.md)；源码持久化与恢复见 [Wiki 009](../../../docs/wiki/009-sqlite-persistence.md)，本机容器、卷恢复与CI见 [Wiki 033](../../../docs/wiki/033-local-docker-ci.md)。本 skill 只保留运行时操作,不要在其他入口复制配置规则。

## 启动服务

本机容器用 `docker compose up --build -d --wait`，Web/API同源默认8787，宿主只绑定127.0.0.1；真实模型显式用 `docker compose --env-file .env.local up --build -d --wait`。保留同一Compose项目名和整个数据卷；它与源码`.data`是两个书架。不要打印含真实key的Compose展开配置/inspect。CLI仍在安装了工作区依赖的宿主执行，通过`--url`连接服务；容器中没有开发CLI/tsx。源码运行继续以下步骤。

```bash
test -f .env.local || cp .env.example .env.local   # 首次初始化；不要覆盖已有本地 key
chmod 600 .env.local
# 用本地编辑器填写所需 key；不要把 key 写进命令、日志或聊天，也不要打印 .env.local
pnpm dev                         # server :8787 + web :5173
```

Live 模式会把生成所需的素材和上游产物发送给所选远程 provider。

服务默认读取项目根目录的 `.data/agent4novel.sqlite`；用 `A4N_DATA_DIR` 指向明确的数据目录。首次启动不自动放入示例作品；需要空库示例时显式设置 `A4N_SEED_DEMO=1`，初始化在事务中执行，非空库不重复添加。测试应使用独立临时目录和端口，勿把 smoke 写入用户作品库；不要停止或清空仍持有作品的旧版内存服务。备份前停止所有访问同一数据目录的进程，复制整个目录；恢复前先保留现有目录的备份，具体步骤看 Wiki 009。

## 独立运行节点与对照 SP

作品的作者配置使用 [Wiki 007](../../../docs/wiki/007-author-agent-config.md) 的独立版本接口；凭据/Base URL继续由Wiki016持有。配置文件例为 `{"requestId":"<UUID>","expectedRevision":0,"document":{"preferences":{"style":"简洁自然"},"defaults":{},"steps":{}}}`；先读agent-config，使用看到的revision，不自动回填。上传文件需显式request-id；同一冻结请求可由作者明确重试，不自动重发。网络/5xx/不匹配回执为unknown，先读配置/文件检查；旧幂等回执不表示服务器仍停在该revision。只有保存配置后选择才生效，运行中的操作冻结实际配置和文件文本；上传只作指导，不执行工具。

```bash
./apps/cli/bin/a4n agent-config <workId>
./apps/cli/bin/a4n upload-prompt <workId> --file guidance.md --request-id <UUID>
./apps/cli/bin/a4n upload-skill <workId> --file SKILL.md --request-id <UUID>
./apps/cli/bin/a4n save-agent-config <workId> --file config-request.json
./apps/cli/bin/a4n get-agent-file <workId> <fileId>
```

文件≤32KiB，库≤64文件，每步≤4Skill，frontmatter和装配预算由服务端校验；CLI核对实际文件完整hash/字节数及资源归属。备份同时包含SQLite和prompts目录，不能只恢复数据库。Web配置/文件GET等待10秒、写入30秒；CLI读沿普通300秒，写30秒（显式CLI超时仍优先）；不修改生成期限。源码Step更新需新进程，编译Web更新需build和浏览器reload。

对照单个节点时，先读 [Wiki 014 单节点实验](../../../docs/wiki/014-agent-cli-telemetry.md#单节点实验-run-step)，按节点补齐 upstream content。完整 monorepo 安装依赖后可直接运行，无需启动 HTTP server；worker 使用真实 provider，不创建或修改作品。

```bash
./apps/cli/bin/a4n run-step caption --seed-file seed.txt --system-prompt-file caption-sp.md
./apps/cli/bin/a4n run-step setting --input-file setting-input.json --config-file generation.json
./apps/cli/bin/a4n run-step prose --input-file prose-input.json --config-file generation.json
```

需要保存一次节点的私有实际调用时，为本次运行指定一个**尚不存在**的目录；不要复用或覆盖旧目录：

```bash
./apps/cli/bin/a4n run-step caption --seed-file seed.txt \
  --system-prompt-file caption-sp.md --record-dir .data/experiments/round-1/a
```

记录目录是Harness的一次读取资源，固定包含 `input.json`、`invocation.json`、`result.json`、`meta.json`。先读 `meta.json`：只有 `complete:true` 且 `status:"complete"` 才能把本次结果视为完整；再按 `meta.files` 一次读齐另外三份。`input.json` 是实际输入和来源路径，`invocation.json` 是 `callLlm` 传给SDK的实际 system/prompt、严格的 `effectiveConfig`（model、directionCount、thinking、temperature、topP）和有效选项，`result.json` 是最终节点结果（含结构ID）或安全的 failed/unknown，`meta.json` 关联版本、运行身份、时间和完成语义。没有捕获的信息明确为 `null`；不能从源文件重建未发生或未捕获的调用，未传的选项也不能猜 provider 默认值。`effectiveConfig` 不包含凭据或完整配置文件。目录为0700、文件为0600；目标或任一父级是符号链接、目录已存在或路径不安全时，CLI在调用provider前拒绝。

用两个新目录做A/B：复用同一份合成输入，只替换明确的SP或选项，分别读取四文件后比较 `meta`、`invocation` 和 `result`。comment写在记录目录旁的 `comments.md`，不修改机器记录；复跑先核对 `input`/来源，再用原有 `run-step` 和新的 `--record-dir` 发起，原记录只读保留。CLI timeout/worker failure 的目录若只有部分证据，读取时按 `meta.complete:false` 和 `result.status:"unknown"` 处理，不把迟到结果冒充成功。

Beat和Prose都要求正安全整数chapter。Beat的upstream为`{outline, setting}`，Prose为`{beat:<同章完整章纲content>, setting:<完整设定content>}`；chapter>1时两者还必须提供`upstream.previousChapter:{chapter, beat, prose}`，其中章号恰为目标减1，第一章禁止该字段。可选`regeneration`使用当前节点草稿和instructions；Prose重写草稿可为空，模型输出须完整非空。前章内容计入实际输入总预算，超限拒绝。独立输入不证明来自作品当前已通过版本；需验证生产关卡时走作品命令。边界见 [续章契约](../../../docs/schema.md#后续章6-续写契约)。

修改 thinking、temperature、topP、模型或等待时间前读 [Wiki 016](../../../docs/wiki/016-model-runtime-provider-config.md#生成参数与单节点覆盖)。`--thinking on|off`、`--temperature`、`--top-p` 逐字段覆盖配置文件，`--top-k` 明确不支持。固定输入对照 SP 时，保存返回的 content、telemetry.generation、promptHash 与 systemHash；成功 content 已过生产 schema，失败按 stderr JSON 与非零退出处理。文件限制、必需上游、timeout 和安全输出以 Wiki 014/016 为准。

## 手工采集正文坏例

先用get读取已保存Prose正文，生成显式请求文件`{requestId:<UUID>,chapter,sourceArtifactId,sourceVersion,sourceHash:<完整正文SHA256>,start,end,text,note?}`；start/end是UTF-16位置，选完整Unicode。CLI不自动替换来源或基线。正文pending/approved均可；先前正文写入未知时先对账，不使用未保存的本页文字。

```bash
./apps/cli/bin/a4n mark-bad-example <workId> --file sample.json
./apps/cli/bin/a4n bad-examples <workId> --chapter 1
./apps/cli/bin/a4n bad-examples <workId> --chapter 1 --after <nextCursor>
./apps/cli/bin/a4n bad-example <workId> <requestId>
```

每页50、选段最多10000字符、备注2000、请求196608字节。原请求重试返回原样本；不要为未知结果自动换UUID，不同备注需新UUID。网络/5xx/畸形或不匹配回执为unknown，先按ID GET核对，404不证明先前请求不会完成。只有显式要求时重试同一文件，不自动POST。写等待30秒、读沿普通300秒，显式CLI超时仍优先。保存后正文变化不改原快照；样本随SQLite及整目录备份恢复，无LLM分析或自动改写。协议见[Wiki008](../../../docs/wiki/008-bad-example-collection.md)。

## CLI 命令

先用 `./apps/cli/bin/a4n --help` 或 `<command> --help` / `-h` 查看语法、请求形状与副作用；帮助在任何 I/O 前返回。参数错误返回安全 `usage` JSON 并非零退出：修正命令后再执行，勿把未知参数当作已生效配置。`create` / `smoke` 的 `--seed` 与 `--seed-file` 恰好选一个。独立帮助 token 优先，字面值用 `--seed=--help`；严格语法边界见 [Wiki 025](../../../docs/wiki/025-cli-command-safety.md)。

```bash
./apps/cli/bin/a4n list                          # 作品列表
./apps/cli/bin/a4n create --seed-file seed.txt --title "标题"
./apps/cli/bin/a4n get <workId>                  # 快照:workflowState + allowedActions + 产物
./apps/cli/bin/a4n get <workId> --kind outline   # 只取某产物(含 content)
./apps/cli/bin/a4n advance <workId>              # 推进当前工作章到下一关卡(默认最长 1820s)
./apps/cli/bin/a4n start-chapter <workId> --file chapter-request.json # 显式开始指定下一章
./apps/cli/bin/a4n select <workId> [directionId] # 选定创意方向(缺省取第一个)
./apps/cli/bin/a4n save-outline <workId> --file draft.json
./apps/cli/bin/a4n approve-outline <workId> --file outline-approval.json # 原始可见 ID／版本
./apps/cli/bin/a4n approve <workId> outline      # 旧兼容：通过服务器当前 head
./apps/cli/bin/a4n get <workId> --kind setting   # 读取 pending 基线及版本
./apps/cli/bin/a4n approve-setting <workId> --file request.json
./apps/cli/bin/a4n get <workId> --kind beat --chapter <chapter>
./apps/cli/bin/a4n regenerate-beat <workId> --file request.json
./apps/cli/bin/a4n approve-beat <workId> --file request.json
./apps/cli/bin/a4n get <workId> --kind prose --chapter <chapter>
./apps/cli/bin/a4n save-prose <workId> --file request.json
./apps/cli/bin/a4n regenerate-prose <workId> --file request.json
./apps/cli/bin/a4n approve-prose <workId> --file request.json
./apps/cli/bin/a4n config                        # 只读运行模式与公开配置
./apps/cli/bin/a4n logs <workId> --request-id <UUID> # 请求关联诊断；也可用 --attempt-id
./apps/cli/bin/a4n smoke --seed-file seed.txt    # 默认首章探针，不继续开始第二章
```

`pnpm -s cli ...` 等价(必须带`-s`，否则pnpm横幅污染stdout)。server地址用`--url`或`A4N_BASE_URL`覆盖；`--timeout-ms`或CLI进程环境变量`A4N_CLI_TIMEOUT_MS`覆盖全部请求等待上限。未覆盖时普通请求300s、advance1820s、start-chapter920s、Beat/Prose通过及Prose保存30s、Beat/Prose重写920s、恢复GET10s；期限包含响应body读取。

通过大纲优先使用 `approve-outline`：从作者实际确认的大纲，或成功保存回执取得 `id/version`，写入 `{"expectedArtifactId":"<大纲ID>","expectedHeadVersion":1}` 后显式提交文件。命令只 POST 一次，不自动 GET、回填新基线或重发；失败／未知时保留文件，先手动 `get <workId> --kind outline` 核对原目标，再决定后续动作。匹配已通过目标只说明其状态，不追认原请求。旧 `approve <workId> outline` 保持服务器当前 head 语义，不提供作者可见版本保证。完整边界见[大纲可见版本通过](../../../docs/schema.md#大纲可见版本通过)，输入与副作用用 `approve-outline --help` 核对。

`approve-setting` 的文件必须是完整 `{ "content": <整份设定>, "expectedHeadVersion": <读取时版本> }`。已有项保留 ID，新增项省略 ID；通过后同 id/version 只读，没有独立保存草稿命令。命令最多自动回读一次、不自动重写；失败保留输入文件，新进程见到 approved 只报告现状，不追认旧请求。恢复规则统一见 [Wiki 013](../../../docs/wiki/013-setting-generation-review.md#提交结果确认)。

Beat 文件是 `{ chapter, expectedArtifactId, expectedHeadVersion, content }`，chapter绑定已存在目标章的正安全整数，再生额外要求 `instructions`（允许空串）。通过需要完整内容，再生允许尚未填完的字段；两者都保留已有卡片 ID，新卡省略 ID。文件上限 1 MiB，不能用 regenerate 创建不存在的章纲。结果返回 `artifact/command/workflow/telemetry`；错误在 stderr 给结构化 JSON 并非零退出，包含恢复状态与可执行动作。结果未知时最多自动 GET 一次，不自动 POST；不可据空日志、LLM ok 或新版存在就认定旧命令成功。详细规则只读 [Wiki 005](../../../docs/wiki/005-beat-generation-review.md#7-创作界面保留旧内容只有确认结果才替换)。

Prose文件沿用章号/id/version基线，content为`{text}`；save额外必须有`expectedHumanStatus:'pending'|'approved'`，regenerate额外有instructions。文件≤1MiB且为严格UTF-8/JSON。save追加新id/version并保留基线状态；pending可保存空草稿，approved保存与approve都要求非空全文。approve保持原id/version/createdAt；approved不能重新approve；普通整章重写只用于pending，修改approved正文使用save。已完成章的两阶段重生是例外，见下方#21规则。保留请求文件，遇到409先回读而非回填新基线。CLI对unknown最多自动GET一次，用共享恢复契约核对保存的下一版本、状态和逐字符全文；不自动重复POST。恢复冲突时由作者决定是否加载服务器版本，详细契约见 [Wiki 022](../../../docs/wiki/022-prose-generation-review.md)。

`start-chapter`文件形如`{"chapter":2,"expectedPreviousProseId":"<前章正文ID>","expectedPreviousProseVersion":2}`，为严格UTF-8 JSON且≤1MiB。命令只发送校验后的三字段请求；目标必须为连续下一章且前章正文approved。结果未知时不自动回读或重发，先手动get检查；不得改成新的章号或最新基线猜测重试。已存在目标只返回当前状态，不重复生成或覆盖。后续章使用该章Beat/Prose命令把关，advance只推进工作章。详细行为见 [Wiki 006](../../../docs/wiki/006-chapter-continuation.md)。

#19 起，公开响应和六类产物内容统一校验。`invalid-response`、畸形错误包或资源身份不匹配不证明写入失败，即使 HTTP 为 4xx；保留原请求，按对应命令回读，不自动重发。合法命令错误中的 `writeOutcome: unknown` 优先于 HTTP 状态。独立 `run-step` 的成功内容也按 stepId 校验；共享边界与安全失败见 [Wiki 019](../../../docs/wiki/019-contract-governance.md)。

`advance`或`start-chapter`返回`kind: "failed"`时，先读内联telemetry或运行logs，再根据retryable及writeOutcome决定后续动作；unknown先回读，不能因报错就认定没有落库。再次advance按当前关卡状态推进，已落库产物不会自动重跑。Pipeline不自动重试；Setting、Beat、Prose还显式设置SDK maxRetries:0，其他步骤沿用SDK默认请求重试行为。

## 已完成章的两阶段重生

#21 为已有 approved Beat/Prose 的当前章或历史章增加明确的章级动作；先从 `get` 的目标 chapter `allowedActions` 判断，不能根据全局 workflow 猜测历史章权限。`regenerate-chapter` 阶段复用 `regenerate-beat` 文件命令，额外携带 `regeneration:{mode:"chapter-regeneration",expectedBeat:{artifactId,version},expectedProse:{artifactId,version}}`，普通请求的 beat ID/version 必须与 expectedBeat 相同。只追加 pending Beat，旧正文和后续章保留；通过新 Beat 后目标章出现 `regenerate-chapter-prose`，同一绑定改为新 Beat/旧 Prose，复用 `regenerate-prose`（普通 prose ID/version 与 expectedProse 相同）。新 Prose 仍须显式通过，不自动生成后续章。未知结果沿已有冻结请求/readback流程，禁止自动换成最新基线。

旧版本可由 Harness 读取 `GET /api/works/:id/artifacts/{beat|prose}/{chapter}/versions/:version?artifactId=...`，必须同时指定已知的kind、chapter、artifactId、version；返回完整Artifact，404不证明旧请求没有执行。此入口不是历史列表或回退操作。缺少旧正文 beat 输入来源时不得推断章纲重生已经完成，第二阶段保持不可用。方案和机器验收入口见 [Wiki021](../../../docs/wiki/021-chapter-regeneration.md)。

## 遥测:分析每次 LLM 调用

`advance` 的响应里**内联** `telemetry` 数组——本次推进期间每个 step 的:

```
{ requestId?, stepId, ok, latencyMs, inputTokens, outputTokens, finishReason, error,
  generation?, promptHash, systemHash, attemptId, configRevision?, configFiles? }
```

- `systemHash` 是本次实际 SP 内容的 hash：默认来自生产 SKILL.md，自定义 SP 时来自传入内容；generation 记录实际解析的公开生成参数。
- 作者配置调用的configRevision与configFiles（ID、完整hash）记录操作快照；systemHash包含内置任务指导和作者指导，不记录指导文本或凭据。独立run-step不自动读取某作品的作者配置。
- 失败排查:`logs <workId>` 回看当前窗口;`finishReason=length` = 输出被 token 上限截断;`finishReason=stop` 但 `ok=false` = 内容没过 schema；只暴露安全分类、长度与字段路径，不输出原始 text/cause/provider message
- requestId / attemptId 可串联 `llm.call`、`llm.error`、命令摘要和响应。
- 日志响应包含 `telemetry`、`commands`、`window`；LLM 与命令各保留全局最近 1000 条，过滤不会扩大窗口。`processInstanceId` 随进程重启变化；截断和空结果都不是未执行证明。

## 前端页面

创意保存/选定、大纲保存及可见版本通过的Web写等待30秒，核对作品读取10秒。超时只终止本页等待，不证明服务端未落库；保留原提交和本页内容，显式核对后再决定载入。外部版本变化或迟到读回不丢本页脏稿，载入服务器材料需确认放弃。

web 是 React SPA:`curl http://localhost:5173/` 只能拿到 HTML 壳 + 脚本标签,**看不到渲染后内容**。要内容一律走 API(CLI 就是封装);只有需要确认页面结构/样式资源时才读 HTML。`/api/*` 由 vite 代理到 8787。

生产作品保存在 SQLite；同一数据目录中的已提交作品、各版本产物、状态和输入引用可跨 server 重启读取。未保存页面编辑不恢复，telemetry 仍是进程内窗口。重启不自动续跑模型：先用 get 读取作品与目标产物，再按原冻结请求和恢复规则决定动作；空日志不能证明未写入。通过后的正文默认阅读，进入编辑后保存仍 approved；Setting／Beat 通过后仍只读。#28/#29 检索工具、长期记忆与作品 Wiki 均未接入当前逐章流程。Web 用作品/章号链接恢复阅读；切章不会改变当前工作章或触发生成。旧章正文修改保留后章状态，needsContinuityReview 只提示衔接，不能据此自动重写或重审。

Web首次生成遇到unknown（包括HTTP200业务结果）时保留原类型/章号，锁定切章和再次生成；通过“刷新作品”显式GET看到原目标后恢复。回读失败或缺少目标仍不代表未落库，不自动重发。起章unknown另保留冻结请求，允许作者重试同一目标/基线。返回书架的放弃确认会提示已发请求可能继续处理。

## 工作流状态机(读模型,GET /works/:id)

生产先完成caption → creative → outline → setting，再逐章执行Beat → Prose双关卡。currentChapter表示工作章，chapters给各章状态、allowedActions和needsContinuityReview；读取历史章不改变工作进度。生成间隙为ready-to-generate，用nextStepId判断下一步；每章prose-approved后停止，只有start-chapter才开始下一章。旧定义保留outline-approved/setting-approved/beat-approved。Beat专用通过API只定稿；Web显式“通过章纲并生成正文”动作才继续生成，CLI单独advance。页面打开／刷新／切章不生成。pending正文允许save-draft/approve/regenerate，approved允许save-draft；已完成的当前章和历史章另可有regenerate-chapter，重生章纲通过后为regenerate-chapter-prose。当前完成章另有start-next-chapter，历史章不提供起章动作。实际输入在生成中变化时提交被拒绝；先回读当前产物与诊断，再明确重试。

## 每次测试的标准动作

```bash
pnpm test && pnpm typecheck          # 双绿门禁
./apps/cli/bin/a4n smoke --seed-file <素材>   # 链路探针(demo 秒回;真模型通常需要数分钟)
```

测试与 typecheck 使用 fake 或 mock provider transport，不调用真实 provider；CLI 集成会启动临时 loopback 服务。真模型耗时取决于 provider、素材与手动重试,不要把注释里的时间当成承诺。

默认`smoke`创建作品、选第一个方向、生成并通过大纲，修改设定总览后通过，再修改并通过Beat，生成正文v1、save作者全文为v2 pending、同id/v2通过。最终GET逐字符检查实际Setting/Beat/Prose、prose-approved且无第二章。它验证链路，不等于人工质量验收。成功stdout含steps/final；失败stderr保留部分steps、模式和可用诊断，用[smoke]进度定位最后动作。需要手动重试和保留中间产物时改用逐条命令。续章验收另外执行start-chapter，覆盖两章完整关卡及第三章启动，并回读旧章确认隔离；可执行CLI→HTTP的集成证据及真实节点边界见 [Wiki 006](../../../docs/wiki/006-chapter-continuation.md)。不要把首章smoke成功写成多章或长篇质量已验证。
