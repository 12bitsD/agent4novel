---
name: agent4novel-drive
description: 用命令行驱动 agent4novel 创作链路、独立运行节点和对照 SP，安全配置模型与生成参数，准备测试 case、查 LLM 遥测、读前端页面。测试链路、分析产物质量或排查 LLM 失败时使用。
---

# 驱动 agent4novel

本项目的创作链路用 CLI(`./apps/cli/bin/a4n`)驱动,**不要手搓 curl**。只有 `select`／`save-outline` 自动回填 `expectedHeadVersion`；Setting、Beat、Prose和start-chapter的专用写命令使用请求文件中的显式基线，不替换成最新head。正常结果的stdout是纯JSON，进度与错误走stderr。HTTP/传输错误会exit≠0，但`advance`/`start-chapter`即使HTTP200也可能返回`kind: "failed"`，必须同时检查JSON outcome。

模型与 provider 配置的唯一 HOW 是 [`docs/wiki/016-model-runtime-provider-config.md`](../../../docs/wiki/016-model-runtime-provider-config.md)。本 skill 只保留运行时操作,不要在其他入口复制配置规则。

## 启动服务

```bash
test -f .env.local || cp .env.example .env.local   # 首次初始化；不要覆盖已有本地 key
chmod 600 .env.local
# 用本地编辑器填写所需 key；不要把 key 写进命令、日志或聊天，也不要打印 .env.local
pnpm dev                         # server :8787 + web :5173
```

Live 模式会把生成所需的素材和上游产物发送给所选远程 provider。

## 独立运行节点与对照 SP

对照单个节点时，先读 [Wiki 014 单节点实验](../../../docs/wiki/014-agent-cli-telemetry.md#单节点实验-run-step)，按节点补齐 upstream content。完整 monorepo 安装依赖后可直接运行，无需启动 HTTP server；worker 使用真实 provider，不创建或修改作品。

```bash
./apps/cli/bin/a4n run-step caption --seed-file seed.txt --system-prompt-file caption-sp.md
./apps/cli/bin/a4n run-step setting --input-file setting-input.json --config-file generation.json
./apps/cli/bin/a4n run-step prose --input-file prose-input.json --config-file generation.json
```

Beat和Prose都要求正安全整数chapter。Beat的upstream为`{outline, setting}`，Prose为`{beat:<同章完整章纲content>, setting:<完整设定content>}`；chapter>1时两者还必须提供`upstream.previousChapter:{chapter, beat, prose}`，其中章号恰为目标减1，第一章禁止该字段。可选`regeneration`使用当前节点草稿和instructions；Prose重写草稿可为空，模型输出须完整非空。前章内容计入实际输入总预算，超限拒绝。独立输入不证明来自作品当前已通过版本；需验证生产关卡时走作品命令。边界见 [续章契约](../../../docs/schema.md#后续章6-续写契约)。

修改 thinking、temperature、topP、模型或等待时间前读 [Wiki 016](../../../docs/wiki/016-model-runtime-provider-config.md#生成参数与单节点覆盖)。`--thinking on|off`、`--temperature`、`--top-p` 逐字段覆盖配置文件，`--top-k` 明确不支持。固定输入对照 SP 时，保存返回的 content、telemetry.generation、promptHash 与 systemHash；成功 content 已过生产 schema，失败按 stderr JSON 与非零退出处理。文件限制、必需上游、timeout 和安全输出以 Wiki 014/016 为准。

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
./apps/cli/bin/a4n approve <workId> outline      # 通过产物
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

`approve-setting` 的文件必须是完整 `{ "content": <整份设定>, "expectedHeadVersion": <读取时版本> }`。已有项保留 ID，新增项省略 ID；通过后同 id/version 只读，没有独立保存草稿命令。命令最多自动回读一次、不自动重写；失败保留输入文件，新进程见到 approved 只报告现状，不追认旧请求。恢复规则统一见 [Wiki 013](../../../docs/wiki/013-setting-generation-review.md#提交结果确认)。

Beat 文件是 `{ chapter, expectedArtifactId, expectedHeadVersion, content }`，chapter绑定已存在目标章的正安全整数，再生额外要求 `instructions`（允许空串）。通过需要完整内容，再生允许尚未填完的字段；两者都保留已有卡片 ID，新卡省略 ID。文件上限 1 MiB，不能用 regenerate 创建不存在的章纲。结果返回 `artifact/command/workflow/telemetry`；错误在 stderr 给结构化 JSON 并非零退出，包含恢复状态与可执行动作。结果未知时最多自动 GET 一次，不自动 POST；不可据空日志、LLM ok 或新版存在就认定旧命令成功。详细规则只读 [Wiki 005](../../../docs/wiki/005-beat-generation-review.md#7-创作界面保留旧内容只有确认结果才替换)。

Prose文件沿用章号/id/version基线，content为`{text}`；save额外必须有`expectedHumanStatus:'pending'|'approved'`，regenerate额外有instructions。文件≤1MiB且为严格UTF-8/JSON。save追加新id/version并保留基线状态；pending可保存空草稿，approved保存与approve都要求非空全文。approve保持原id/version/createdAt；approved不能重新approve或regenerate，修改使用save。保留请求文件，遇到409先回读而非回填新基线。CLI对unknown最多自动GET一次，用共享恢复契约核对保存的下一版本、状态和逐字符全文；不自动重复POST。恢复冲突时由作者决定是否加载服务器版本，详细契约见 [Wiki 022](../../../docs/wiki/022-prose-generation-review.md)。

`start-chapter`文件形如`{"chapter":2,"expectedPreviousProseId":"<前章正文ID>","expectedPreviousProseVersion":2}`，为严格UTF-8 JSON且≤1MiB。命令只发送校验后的三字段请求；目标必须为连续下一章且前章正文approved。结果未知时不自动回读或重发，先手动get检查；不得改成新的章号或最新基线猜测重试。已存在目标只返回当前状态，不重复生成或覆盖。后续章使用该章Beat/Prose命令把关，advance只推进工作章。详细行为见 [Wiki 006](../../../docs/wiki/006-chapter-continuation.md)。

#19 起，公开响应和六类产物内容统一校验。`invalid-response`、畸形错误包或资源身份不匹配不证明写入失败，即使 HTTP 为 4xx；保留原请求，按对应命令回读，不自动重发。合法命令错误中的 `writeOutcome: unknown` 优先于 HTTP 状态。独立 `run-step` 的成功内容也按 stepId 校验；共享边界与安全失败见 [Wiki 019](../../../docs/wiki/019-contract-governance.md)。

`advance`或`start-chapter`返回`kind: "failed"`时，先读内联telemetry或运行logs，再根据retryable及writeOutcome决定后续动作；unknown先回读，不能因报错就认定没有落库。再次advance按当前关卡状态推进，已落库产物不会自动重跑。Pipeline不自动重试；Setting、Beat、Prose还显式设置SDK maxRetries:0，其他步骤沿用SDK默认请求重试行为。

## 遥测:分析每次 LLM 调用

`advance` 的响应里**内联** `telemetry` 数组——本次推进期间每个 step 的:

```
{ requestId?, stepId, ok, latencyMs, inputTokens, outputTokens, finishReason, error,
  generation?, promptHash, systemHash, attemptId }
```

- `systemHash` 是本次实际 SP 内容的 hash：默认来自生产 SKILL.md，自定义 SP 时来自传入内容；generation 记录实际解析的公开生成参数。
- 失败排查:`logs <workId>` 回看当前窗口;`finishReason=length` = 输出被 token 上限截断;`finishReason=stop` 但 `ok=false` = 内容没过 schema；只暴露安全分类、长度与字段路径，不输出原始 text/cause/provider message
- requestId / attemptId 可串联 `llm.call`、`llm.error`、命令摘要和响应。
- 日志响应包含 `telemetry`、`commands`、`window`；LLM 与命令各保留全局最近 1000 条，过滤不会扩大窗口。`processInstanceId` 随进程重启变化；截断和空结果都不是未执行证明。

## 前端页面

web 是 React SPA:`curl http://localhost:5173/` 只能拿到 HTML 壳 + 脚本标签,**看不到渲染后内容**。要内容一律走 API(CLI 就是封装);只有需要确认页面结构/样式资源时才读 HTML。`/api/*` 由 vite 代理到 8787。

当前作品和telemetry都在内存里。正文自动保存成功后可浏览器刷新恢复，server重启后测试case仍会消失；准备多步case时保持同一server进程。通过后的正文默认阅读，进入编辑后保存仍approved；Setting／Beat通过后仍只读。#9才负责跨server重启恢复，#28/#29检索工具、长期记忆与作品Wiki均未接入当前逐章流程。Web用作品/章号链接恢复阅读；切章不会改变当前工作章或触发生成。旧章正文修改保留后章状态，needsContinuityReview只提示衔接，不能据此自动重写或重审。

Web首次生成遇到unknown（包括HTTP200业务结果）时保留原类型/章号，锁定切章和再次生成；通过“刷新作品”显式GET看到原目标后恢复。回读失败或缺少目标仍不代表未落库，不自动重发。起章unknown另保留冻结请求，允许作者重试同一目标/基线。返回书架的放弃确认会提示已发请求可能继续处理。

## 工作流状态机(读模型,GET /works/:id)

生产先完成caption → creative → outline → setting，再逐章执行Beat → Prose双关卡。currentChapter表示工作章，chapters给各章状态、allowedActions和needsContinuityReview；读取历史章不改变工作进度。生成间隙为ready-to-generate，用nextStepId判断下一步；每章prose-approved后停止，只有start-chapter才开始下一章。旧定义保留outline-approved/setting-approved/beat-approved。Beat专用通过API只定稿；Web显式“通过章纲并生成正文”动作才继续生成，CLI单独advance。页面打开／刷新／切章不生成。pending正文允许save-draft/approve/regenerate，approved允许save-draft，当前完成章另有start-next-chapter，历史章不提供此动作。实际输入在生成中变化时提交被拒绝；先回读当前产物与诊断，再明确重试。

## 每次测试的标准动作

```bash
pnpm test && pnpm typecheck          # 双绿门禁
./apps/cli/bin/a4n smoke --seed-file <素材>   # 链路探针(demo 秒回;真模型通常需要数分钟)
```

测试与 typecheck 使用 fake 或 mock provider transport，不调用真实 provider；CLI 集成会启动临时 loopback 服务。真模型耗时取决于 provider、素材与手动重试,不要把注释里的时间当成承诺。

默认`smoke`创建作品、选第一个方向、生成并通过大纲，修改设定总览后通过，再修改并通过Beat，生成正文v1、save作者全文为v2 pending、同id/v2通过。最终GET逐字符检查实际Setting/Beat/Prose、prose-approved且无第二章。它验证链路，不等于人工质量验收。成功stdout含steps/final；失败stderr保留部分steps、模式和可用诊断，用[smoke]进度定位最后动作。需要手动重试和保留中间产物时改用逐条命令。续章验收另外执行start-chapter，覆盖两章完整关卡及第三章启动，并回读旧章确认隔离；可执行CLI→HTTP的集成证据及真实节点边界见 [Wiki 006](../../../docs/wiki/006-chapter-continuation.md)。不要把首章smoke成功写成多章或长篇质量已验证。
