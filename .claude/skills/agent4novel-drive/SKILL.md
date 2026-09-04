---
name: agent4novel-drive
description: 用命令行启动并驱动 agent4novel 全链路(建作品/推进/选定/保存/通过)、安全配置模型、准备测试 case、查 LLM 遥测、读前端页面。测试链路、分析产物质量、切换 DeepSeek/LongCat 或排查 LLM 失败时都应使用。
---

# 驱动 agent4novel

本项目的创作链路用 CLI(`./apps/cli/bin/a4n`)驱动,**不要手搓 curl**。只有 `select`／`save-outline` 自动回填 `expectedHeadVersion`；`approve-setting` 必须使用请求文件中的显式版本，不替换成最新 head。正常结果的 stdout 是纯 JSON,进度与错误走 stderr。HTTP/传输错误会 exit≠0,但 `advance` 即使 HTTP 200 也可能返回 `kind: "failed"`,所以必须同时检查 JSON outcome。

模型与 provider 配置的唯一 HOW 是 [`docs/wiki/016-model-runtime-provider-config.md`](../../../docs/wiki/016-model-runtime-provider-config.md)。本 skill 只保留运行时操作,不要在其他入口复制配置规则。

## 启动服务

```bash
test -f .env.local || cp .env.example .env.local   # 首次初始化；不要覆盖已有本地 key
chmod 600 .env.local
# 用本地编辑器填写所需 key；不要把 key 写进命令、日志或聊天，也不要打印 .env.local
pnpm dev                         # server :8787 + web :5173
```

Live 模式会把生成所需的素材和上游产物发送给所选远程 provider。

## CLI 命令

```bash
./apps/cli/bin/a4n list                          # 作品列表
./apps/cli/bin/a4n create --seed-file seed.txt --title "标题"
./apps/cli/bin/a4n get <workId>                  # 快照:workflowState + allowedActions + 产物
./apps/cli/bin/a4n get <workId> --kind outline   # 只取某产物(含 content)
./apps/cli/bin/a4n advance <workId>              # 推进到下一关卡(完整请求默认最长 1820s)
./apps/cli/bin/a4n select <workId> [directionId] # 选定创意方向(缺省取第一个)
./apps/cli/bin/a4n save-outline <workId> --file draft.json
./apps/cli/bin/a4n approve <workId> outline      # 通过产物
./apps/cli/bin/a4n get <workId> --kind setting   # 读取 pending 基线及版本
./apps/cli/bin/a4n approve-setting <workId> --file request.json
./apps/cli/bin/a4n logs <workId>                 # LLM 遥测回看
./apps/cli/bin/a4n smoke --seed-file seed.txt    # 一键全链路探针
```

`pnpm -s cli ...` 等价(必须带 `-s`,否则 pnpm 横幅污染 stdout)。server 地址用 `--url` 或 `A4N_BASE_URL` 覆盖;`--timeout-ms` 或 CLI 进程环境变量 `A4N_CLI_TIMEOUT_MS` 会覆盖全部请求的等待上限。未覆盖时普通请求默认 300s,只有 `advance` 默认 1820s。

`approve-setting` 的文件必须是完整 `{ "content": <整份设定>, "expectedHeadVersion": <读取时版本> }`。已有项保留 ID，新增项省略 ID；通过后同 id/version 只读，没有独立保存草稿命令。命令最多自动回读一次、不自动重写；失败保留输入文件，新进程见到 approved 只报告现状，不追认旧请求。恢复规则统一见 [Wiki 013](../../../docs/wiki/013-setting-generation-review.md#提交结果确认)。

`advance` 返回 `kind: "failed"` 时,先读响应内联 telemetry 或运行 `logs`,再根据 `retryable` 决定是否再次手动执行 `advance`。再次执行只会从失败 step 继续,不会自动重跑已成功且已落库的 step。Pipeline 不自动重试；Setting 还显式设置 SDK `maxRetries: 0`，其他步骤沿用 SDK 默认请求重试行为。

## 遥测:分析每次 LLM 调用

`advance` 的响应里**内联** `telemetry` 数组——本次推进期间每个 step 的:

```
{ stepId, ok, latencyMs, inputTokens, outputTokens, finishReason, error,
  promptHash, systemHash, attemptId }
```

- `systemHash` 是 SKILL.md 内容 hash:prompt 改没改,对 hash 就知道
- 失败排查:`logs <workId>` 回看全部记录;`finishReason=length` = 输出被 token 上限截断;`finishReason=stop` 但 `ok=false` = 内容没过 schema(server stdout 的 `llm.error` 行还有 `causeMessage` 详情)
- attemptId 可串联 server stdout 里的 `llm.call`/`llm.error` 日志

## 前端页面

web 是 React SPA:`curl http://localhost:5173/` 只能拿到 HTML 壳 + 脚本标签,**看不到渲染后内容**。要内容一律走 API(CLI 就是封装);只有需要确认页面结构/样式资源时才读 HTML。`/api/*` 由 vite 代理到 8787。

当前作品和 telemetry 都在内存里。server 重启后测试 case 会消失;准备多步 case 时保持同一 server 进程。

## 工作流状态机(读模型,GET /works/:id)

当前生产链为 caption → creative → outline → setting。读模型依次经过 `awaiting-selection`、`awaiting-outline-review`、`awaiting-setting-review`，最终为 `setting-approved`；各生成间隙是 `ready-to-generate`，用 `nextStepId` 判断下一步，不从已有产物猜测。`outline-approved` 仅保留给旧三步定义。LLM 失败 → `failed`，可重试时再次 advance；`allowedActions` 告诉你当前能干什么。

## 每次测试的标准动作

```bash
pnpm test && pnpm typecheck          # 双绿门禁
./apps/cli/bin/a4n smoke --seed-file <素材>   # 链路探针(demo 秒回;真模型通常需要数分钟)
```

测试与 typecheck 使用 fake 或 mock transport,不会调用真实 provider。真模型耗时取决于 provider、素材与手动重试,不要把注释里的时间当成承诺。

`smoke` 会创建作品、选第一个创意方向、生成并通过大纲，再生成设定、修改总览并一次通过，回读验证 `setting-approved`。它适合验证链路，不等于人工质量验收。成功时 stdout 有完整 `steps` 与 `final`;失败时没有部分 `steps` 结果,用 stderr 的 `[smoke]` 进度定位最后完成的动作,再读最终 error JSON。需要重试与保留中间产物时,改用逐条 CLI 命令。
