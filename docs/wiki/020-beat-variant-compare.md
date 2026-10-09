---
ticket: 20
title: 章纲重新生成后的新旧版本比较与选择
ticket_state: active
status: "in-progress"
priority: phase2
source_issue: https://github.com/12bitsD/agent4novel/issues/20
fixed_point: d6b529802811c48560f5de1107ffad3acff72aa8
read_when:
  - change-beat-regeneration
  - change-beat-comparison
  - review-issue-20
---

# 020 — 章纲再生后的比较与选择

## Agent Context

本票承接 #5 的当前章 `beat` 章纲再生，不是全书 `outline`，也不是 #21 通过正文后的章节重生。目标是在当前 pending beat 重新生成后，把再生前的作者可见快照 A 与新结果 B 一起交给作者比较；任何选择都不自动通过。

本轮采用的对齐：

- 只处理当前章节、当前 pending beat；已通过或非当前关卡在模型前拒绝。
- 再生成功追加 B，A 不覆盖；响应提供 A/B 完整快照，Web 比较视图可定位字段差异。
- 选择 B 保留 B 为当前 pending；选择 A 不回滚/删除历史，而是经服务端核对 A 身份与内容后追加 A-copy C pending；之后作者必须显式通过当前选择。
- 选择、通过和再生均做 identity/version CAS；旧请求、竞争变化或已通过边界返回 409。
- 模型失败与 unknown 不写半包、不自动选择或自动重试；冻结请求与比较材料保留给 Agent/作者核对。
- 不做 SSE、统一历史 UI、SQLite 新表、自动评分或下游级联。

## 冻结验收与 Eval

受保护材料（实施 Agent 不得修改）：

- `packages/contracts/test/beat-variant-selection.eval.test.ts`
- `apps/server/test/beat-variant-selection.eval.test.ts`
- `apps/web/src/pages/Workspace.beat-compare.eval.test.tsx`
- `apps/cli/test/beat-variant-cli.eval.test.ts`

| Eval | 标准 | 可观察证据 |
|---|---|---|
| E20.1 | A 再生为 B，A/B 完整可读且 B pending | HTTP response compare receipt + GET head + history identity |
| E20.2 | 选择 B 不自动 approve，随后 approve 只接受 B | selection response + approve CAS |
| E20.3 | 选择 A 追加 C pending，A/B/C 历史保留，随后 approve 只接受 C | selection response + artifact versions |
| E20.4 | stale/approved/非当前/缺失身份在模型前拒绝；并发选择 409 | request/step counter + status/code |
| E20.5 | failure/unknown 不追加半包、不自动选择，冻结请求/比较材料保留 | no new head + Web locked/recovery assertion |
| E20.6 | Harness 可通过严格 CLI/HTTP 与 run-step 读取输入、输出、来源身份 | CLI contract + real Step/run-step record |

固定点：`d6b529802811c48560f5de1107ffad3acff72aa8`。验收方法修订提交：`a3abe18`（包含 `b1c1b0e`、`d3d2eda`、`90d7776d`、`689c962d`）。四个受保护文件 SHA-256 为：contracts `cddcb53f7f4964ea69e984c4e97c98a474170850cb5cb24de14c23a9eaff3f2c`、server `a7fc7e71445dca32606500e206ffbedc9ce89fbb83a633dac0a64cfaa8f2eba3`、web `9a0c57b46e77b4ac5444b6d1a06b21d71bcea87ea283875bcc590235edacdda7`、CLI `51fdadcb9ddb4c5ea710e694e5ba58813c3eec8c88206d3082787f088c69e507`。当前只冻结验收方法，尚未宣称实现完成；后续由实施 Agent 只改生产文件和非受保护测试，主 Agent独立运行本页验收、全量门禁与双轴 review。

## 代码落点（候选）

`packages/contracts` 的 beat compare/select receipt；`WorkStore` 的历史 identity 读取；Pipeline/HTTP/CLI；`BeatReview`/`Workspace` 比较入口。优先复用现有 `regenerateBeat`、beat CAS、command observability 和 `run-step`，不扩展为通用历史服务。

## 非目标与风险

不支持已通过 beat 回退、不承诺跨服务重启的历史比较、不以客户端传入内容替代服务端 identity 核对；unknown 结果只能显式读取核对。若远端容器 CI 仍受 Docker Hub 限流，必须记录真实结果，不能伪造 PASS。

## 完成审核证据

- 固定点与 T0/T1/T2：pending。
- E20.1–E20.6：方法已冻结，执行 pending。
- C1–C7：实现、review、attestation、PR/CI/issue 回读 pending。
