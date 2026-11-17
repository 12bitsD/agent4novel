// 独立 server 进程入口。stdin 接收实验请求，stdout 只返回单个 JSON 结果。
import {
  stepExperimentRequestSchema,
  stepExperimentResponseSchema,
} from "@agent4novel/contracts";
import { loadLocalEnv } from "./config/local-env.js";
import { stepWorkerErrorCode } from "./step-lab-error.js";

async function main() {
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    // isBuffer：校验当前条件。
    // from：构造数组。
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 1024 * 1024) {
      // error：处理当前步骤。
      // stringify：序列化数据。
      console.error(JSON.stringify({ code: "payload-too-large" }));
      process.exitCode = 1;
      return;
    }
    // push：追加元素。
    parts.push(bytes);
  }
  let raw: unknown;
  try {
    // parse：解析输入。
    // toString：转换当前数据。
    // concat：处理当前步骤。
    raw = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    // error：处理当前步骤。
    // stringify：序列化数据。
    console.error(JSON.stringify({ code: "invalid-input" }));
    process.exitCode = 1;
    return;
  }
  // safeParse：校验并解析输入。
  const parsed = stepExperimentRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // error：处理当前步骤。
    // stringify：序列化数据。
    console.error(JSON.stringify({ code: "invalid-input" }));
    process.exitCode = 1;
    return;
  }
  // loadLocalEnv：读取当前数据。
  loadLocalEnv();
  // This worker serves one request: validate its selected model at runtime
  // startup.
  // The normal server still rejects an unconfigured A4N_MODEL.
  if (parsed.data.config?.model !== undefined) {
    process.env.A4N_MODEL = parsed.data.config.model;
  }
  // Production safeLog 使用 console.log；仅本 worker 将诊断导向 stderr。
  // error：处理当前步骤。
  console.log = (...args: unknown[]) => console.error(...args);
  // import：处理当前步骤。
  const { runIsolatedStep } = await import("./steps/isolated-runner.js");
  // runIsolatedStep：执行当前流程。
  const result = await runIsolatedStep(parsed.data);
  // safeParse：校验并解析输入。
  const response = stepExperimentResponseSchema.safeParse(result);
  if (!response.success) {
    // error：处理当前步骤。
    // stringify：序列化数据。
    console.error(JSON.stringify({ code: "invalid-response" }));
    process.exitCode = 1;
    return;
  }
  // write：写入当前结果。
  // stringify：序列化数据。
  process.stdout.write(JSON.stringify(response.data) + "\n");
  if (result.kind === "failed") {
    process.exitCode = 1;
  }
}
// catch：处理异步失败。
// main：处理当前步骤。
main().catch((error: unknown) => {
  // error：处理当前步骤。
  // stringify：序列化数据。
  // stepWorkerErrorCode：处理当前步骤。
  console.error(JSON.stringify({ code: stepWorkerErrorCode(error) }));
  process.exitCode = 1;
});
