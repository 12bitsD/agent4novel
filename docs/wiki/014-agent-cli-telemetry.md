# 014 — Agent 可用性基建:CLI + 遥测内联 + 项目级 skill(#14)

> Ticket: [#14](https://github.com/12bitsD/agent4novel/issues/14) · 状态:✅ 已落地(2026-08-28)

## 实现目的

#4 真机实测证明全链路可纯 curl 驱动,但 Agent 手工拼请求 + 回填 `expectedHeadVersion` 易错;LLM 观测只进 stdout,调用方拿不到;outline 步骤在 v4-flash 上失败率 ~50%,无诊断字段可查。本票让「打开本项目的 Agent」能直接用命令行驱动全链路、拿到每一步的延迟/token/失败原因,并顺手根治 outline 失败。

## 阶段假设

沿用 wiki 011:存储生命周期 = 进程生命周期。遥测账本因此是**进程内环形缓冲**(容量 1000),不落盘;持久化随 #9 SQLite 再议。

## 决策基线(2026-08-28,与用户逐条对齐)

| # | 决策 | 结论 |
|---|---|---|
| 1 | CLI 形态 | `apps/cli` 薄封装 server REST;**stdout 恒为纯 JSON**,进度/错误走 stderr;exit≠0 即失败 |
| 2 | 直跑入口 | `apps/cli/bin/a4n`(sh 包装,直接引用本包 tsx loader)——绕过 pnpm 脚本横幅污染 stdout;`pnpm cli` 需 `-s` 才干净 |
| 3 | 乐观锁 | `select`/`save-outline` 内部先 GET 快照自动回填 `expectedHeadVersion`,Agent 不记账;一次快照同时供方向解析 |
| 4 | 遥测内联 | **advance 响应内联本次推进的 LLM 遥测**(账本 cursor 前后差集)——一次调用 = 结果+观测,Agent 感知步骤最少(用户拍板:比事后查日志更优) |
| 5 | 遥测回看 | `GET /api/works/:id/telemetry` + CLI `logs` 命令;跨次分析、崩溃前排障用 |
| 6 | prompt 版本可追 | 每条遥测带 `systemHash`(SKILL.md 内容 hash12)与 `promptHash`;改 prompt 后产物可区分 |
| 7 | 失败诊断 | `llm.error` 补 `finishReason/outputTokens/textTail/causeName/causeMessage`;text 只记尾 200 字符,不落全文 |
| 8 | 日志不落盘 | JSONL 文件方案放弃:与阶段假设重复(进程级),查询端点已覆盖;#9 时统一进库 |
| 9 | smoke 探针 | CLI `smoke` = create→advance→select(第一方向)→advance→approve outline→终态;每次测试先跑它验证链路通 |
| 10 | 项目级 skill | `.claude/skills/agent4novel-drive/`,打开本项目的 Agent 自动获得;含前端 HTML 直取的边界说明 |
| 11 | outline 修复 | `maxOutputTokens` 提为 callLlm 可选参(默认 8000),outline 传 16000(实测厂商接受);SKILL.md 加篇幅纪律(4~6 弧、字段字数上限) |

## outline 失败根因(排查记录)

现象:v4-flash 下 outline 累计 3/7 失败,均 `AI_NoObjectGeneratedError`。用本票的遥测抓到**两种失败模式**:

| 模式 | 证据 | 性质 |
|---|---|---|
| **截断** | finishReason=`length`,outputTokens=8000/8001(撞满上限) | 产物写得太长,JSON 被切断 → 无法解析 |
| **schema 偏差** | finishReason=`stop`,outputTokens=4373 | 正常收尾但内容不过校验;具体 zod issue 待下次触发时从 `causeMessage` 捕获 |

修复:上限 8000→16000(探针 4/4 通过;修复前同输入 1/4 失败且即截断)+ prompt 篇幅纪律。schema 偏差模式留 `causeMessage` 日志守株待兔。

## 技术方案(已落地)

- **contracts**:`telemetry.ts` 新增 `LlmTelemetry`(stepId/attemptId/model/ok/latencyMs/tokens/finishReason/error/promptChars/promptHash/systemHash)
- **server**:
  - `steps/telemetry.ts`:进程内环形账本(recordTelemetry / telemetryCursor / telemetryFor / resetTelemetry)
  - `llm-call.ts`:成败两路都记遥测 + console 日志;新增 `workId`、`maxOutputTokens` 参数
  - `routes/works.ts`:advance 响应挂 `telemetry`(cursor 差集);新增 `GET /api/works/:id/telemetry`
  - `outline-step.ts`:maxOutputTokens 16000;`skills/outline/SKILL.md` 篇幅纪律
- **cli**(`apps/cli`,9 命令):list / create / get / advance / select / save-outline / approve / logs / smoke;`client.ts`(可注入 fetch)+ `commands.ts` + `main.ts`;`bin/a4n` 直跑入口
- **skill**:`.claude/skills/agent4novel-drive/SKILL.md`
- **测试**:cli 7(client/commands:headVersion 回填、缺省方向、错误映射、smoke 序列、logs 透传);server +1(telemetry 内联 + 查询口 + 404);总 132 绿

## 明确不做

- 日志落盘/聚合分析平台(#9 之后再说)
- advance 异步化/SSE 进度(#5 长链路时再评)
- web 界面展示遥测(Agent 向设施,UI 暂不展示)

## 状态记录

- 2026-08-28:与用户对齐定案(遥测内联 > 事后查日志);CLI + 账本 + 查询口 + outline 修复一次落地;真机验证:CLI 驱动全链路(work-7~14),探针定位截断根因,16000 上限 4/4 通过。132 测试绿。
