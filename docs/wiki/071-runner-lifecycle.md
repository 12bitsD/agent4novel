---
wiki_id: "071"
ticket: 71
ticket_state: active
context_state: current
summary: "独立 runner 统一终态回收、父进程信号清理与安全错误分类"
topics: ["runner", "lifecycle", "reliability", "timeout", "signals"]
code_paths: ["apps/cli/src/local-step.ts", "apps/server/src/step-lab-main.ts", "apps/server/src/step-lab-error.ts", "apps/cli/test/local-step-lifecycle.test.ts"]
symbols: ["runLocalStep", "stepWorkerErrorCode"]
inherits: ["014", "051", "016"]
changed_by: []
read_when: ["fix-runner-timeout", "reap-step-worker", "classify-worker-error"]
last_context_reviewed: "2026-11-13"
---

# 071 — 独立 runner 生命周期与错误分类

## Agent Context

- **读取时机**：修改 run-step 子进程、CLI 超时/信号、worker 顶层异常或记录恢复语义时。
- **原始目的**：本票 issue 为 [#71](https://github.com/12bitsD/agent4novel/issues/71)，承接 #67，避免 SIGTERM 被忽略后 worker 滞留，以及未知异常被误报为配置错误。
- **实际落地**：统一 settled/cleanup、SIGTERM→宽限→SIGKILL→await close、父进程信号回收和安全错误分类；非零退出仅接受 schema-valid failed response。
- **当前价值**：`result.status=unknown` 与 `meta.status=incomplete` 不变；杀 worker 不宣称 provider 已取消。
- **后续变化**：无。
- **代码入口**：`apps/cli/src/local-step.ts`、`apps/server/src/step-lab-main.ts`。

## 设计目的

让每个 runner 退出路径都有确定终态，不遗留子进程、定时器或信号监听器；配置错误与内部 worker 故障保持可区分且不泄露内部文本。

## 起始上下文

旧 CLI 在 timeout/stdout 超限时只调用一次 `child.kill('SIGTERM')` 并立即 reject，没有等待 close、升级或父进程信号清理。worker 顶层 catch 将全部异常映射 `llm-config-invalid`。Wiki 014/051 要求 unknown/incomplete 记录和安全 JSON 不变。

## 技术方案

在 runLocalStep 内建立独立 closed promise 与统一 settled/cleanup。错误路径先标记 unknown，再按 SIGTERM、短宽限、SIGKILL、await close 回收后拒绝；正常 close 直接解析。父进程 SIGINT/SIGTERM 走同一路径，清理监听器后重发信号恢复默认退出语义。顶层只将 ModelConfigError 映射 llm-config-invalid。

## 代码落点

- `apps/cli/src/local-step.ts`：runner 生命周期。
- `apps/server/src/step-lab-main.ts`、`step-lab-error.ts`：顶层错误分类。
- `apps/cli/test/local-step-lifecycle.test.ts`、`apps/server/test/step-lab-error.test.ts`：fault-injection 与错误分类。

## 测试与验证

### 完成审核证据

- **清单与候选**：固定点 `c060be489c21d6646fff1b59615a8eb71d8951b2`，前序 #68/#69/#70 已落地；实现提交 `eabbc88`；T0 `c9c1a73aeccc1c6c692052fa4fbc40cc3a985e31`；T1 `ce154d05ca304347f11a08de9c8a7de9625ae8f0`。
- **逐项判定**：C1–C5 PASS；C6.1/C6.2 PASS，C6.3 已转录，C6.4 PASS（独立 reviewer agent-24），C6.5 已记录，C6.6/C6.7 待最终比较与提交。
- **验收与 TDD**：issue #71；旧实现只 SIGTERM 且父进程不回收先 RED；fault-injection 证明 SIGTERM→SIGKILL→close，运行中 kill error 不伪造 close，父进程信号回收；非零 success/malformed 输出拒绝，合法 failed response 保留。
- **本地门禁**：CLI 17 项、server 23 项及双 typecheck 通过；真实 transport timeout 的 unknown/incomplete 保持；最终全量 `pnpm test`、`pnpm typecheck`、`pnpm build`、production/container smoke 与 `git diff --check <fixed-point>` 均通过。
- **双轴 review**：已关闭 kill error 竞态、非零 close 绕过和 runtime 顶层导入副作用，增量复现无剩余发现。
- **修复与回归**：统一 closed/settled，spawn failure 与运行 error 分离，close 后拒绝；错误分类测试无 provider 初始化副作用。
- **知识维护**：本页与 Wiki index 新建；Wiki 014/016/051 changed_by 已链接；schema/CONTEXT/ADR/research/README/运行 skill N/A；handoff 已更新当前治理范围与 #73/#74 阻塞。
- **发布前裁决**：C6.4 独立 reviewer PASS；清单 blob `42116082e8ca2804d826cc00f6578270077f60eb`、固定点与 T1 已转录，C6.5 完成。C6.6/C6.7 待最终比较与提交；C7 仅本地分支，不 push/远端 merge/关闭 issue。

## 边界与非目标

不改变 StepExperimentResponse、unknown/incomplete 记录、模型 timeout、stdout/stderr 限制或 provider 语义；不引入后台任务队列，不把 worker 终止当成远端取消证明。

## 上下文演进

### 2026-11-13 — 建立 runner 终态治理票据

- **触发证据**：旧错误路径只有单次 SIGTERM 和立即 reject，顶层错误分类过宽。
- **原假设**：普通 worker 会被 SIGTERM 终止，但原生层卡死或忽略信号时句柄可让 CLI 持续存活。
- **决定**：所有退出路径统一回收并等待终态，父进程信号复用同一机制。
- **影响**：仅 CLI/worker 生命周期与错误分类。
- **上下文处理**：preserve Wiki 014/051 的记录与诊断边界，本页记录生命周期硬化。

## 交接结论

实施后应以 fault-injection 证明 SIGKILL 和 close 等待、父进程回收、错误分类与单次 JSON 输出；未完成独立 review 和全量门禁前不视为交付。
