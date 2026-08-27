---
name: agent4novel-drive
description: 用命令行驱动 agent4novel 全链路(建作品/推进/选定/保存/通过)、查 LLM 遥测、读前端页面。需要测试链路通不通、分析产物质量、排查 LLM 失败时使用。
---

# 驱动 agent4novel(#14)

本项目的一切能力都能从命令行驱动,**不要手搓 curl**——用 CLI(`./apps/cli/bin/a4n`),它自动回填 `expectedHeadVersion`、stdout 恒为纯 JSON(可直接管道给 jq/python)、exit≠0 即失败。

## 启动服务

```bash
# server(8787):真模型
DEEPSEEK_API_KEY=sk-... pnpm --filter @agent4novel/server dev
# 无 key 时自动演示模式(FakeStep,秒回,不触网)——验证链路用这个

# web(5173),可选
pnpm --filter @agent4novel/web dev
```

## CLI 命令

```bash
./apps/cli/bin/a4n list                          # 作品列表
./apps/cli/bin/a4n create --seed-file seed.txt --title "标题"
./apps/cli/bin/a4n get <workId>                  # 快照:workflowState + allowedActions + 产物
./apps/cli/bin/a4n get <workId> --kind outline   # 只取某产物(含 content)
./apps/cli/bin/a4n advance <workId>              # 推进到下一关卡(长请求,最长 300s)
./apps/cli/bin/a4n select <workId> [directionId] # 选定创意方向(缺省取第一个)
./apps/cli/bin/a4n save-outline <workId> --file draft.json
./apps/cli/bin/a4n approve <workId> outline      # 通过产物
./apps/cli/bin/a4n logs <workId>                 # LLM 遥测回看
./apps/cli/bin/a4n smoke --seed-file seed.txt    # 一键全链路探针
```

`pnpm -s cli ...` 等价(必须带 `-s`,否则 pnpm 横幅污染 stdout)。server 地址用 `--url` 或 `A4N_BASE_URL` 覆盖。

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

## 工作流状态机(读模型,GET /works/:id)

`ready-to-generate`(可 advance)→ `awaiting-selection`(创意稿待选定)→ `awaiting-outline-review`(大纲待通过)→ `outline-approved`(锁定,只读);任何一步 LLM 失败 → `failed`(重试 = 再 advance,只重跑失败步)。`allowedActions` 字段直接告诉你当前能干什么。

## 每次测试的标准动作

```bash
pnpm test && pnpm typecheck          # 双绿门禁
./apps/cli/bin/a4n smoke --seed-file <素材>   # 链路探针(demo 模式秒回;真模型 ~2min)
```

smoke 任一步失败会以 `{code, message}` 退出非零;`steps` 数组里能看到走到哪一步断的。
