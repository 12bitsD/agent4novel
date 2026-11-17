import { serve } from "@hono/node-server";
import { parseServerConfig } from "./config/server-config.js";
import { createShutdown } from "./runtime/shutdown.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateWebRoot, WebBuildError } from "./runtime/static-web.js";

function startServer(
  config: ReturnType<typeof parseServerConfig>,
  store: { close: () => void },
  mode: "demo" | "live",
  app: { fetch: (request: Request) => Response | Promise<Response> },
): void {
  // serve：处理当前步骤。
  const server = serve(
    { fetch: app.fetch, hostname: config.host, port: config.port },
    (info) => {
      // includes：检查包含关系。
      const host = config.host.includes(":")
        ? `[${config.host}]`
        : config.host;
      // log：写入当前结果。
      console.log(
        `agent4novel server listening on http://${host}:${info.port}`,
      );
      if (mode === "demo") {
        // log：写入当前结果。
        console.log("演示模式:未配置可用模型凭据,使用 FakeStep");
      }
    },
  );
  let shutdownExitCode = 0;
  // createShutdown：构造当前数据。
  // close：释放当前资源。
  // exit：处理当前步骤。
  const stop = createShutdown(server, () => store.close(), {
    exit: (code) => process.exit(code || shutdownExitCode),
  });
  // once：注册单次事件处理。
  process.once("SIGTERM", stop);
  // once：注册单次事件处理。
  process.once("SIGINT", stop);
  // once：注册单次事件处理。
  server.once("error", () => {
    // error：处理当前步骤。
    console.error("agent4novel server failed to listen");
    shutdownExitCode = 1;
    // stop：处理当前步骤。
    stop();
  });
}

async function start(): Promise<void> {
  // Both src/start.ts and the compiled dist/start.js have this stable location.
  // fileURLToPath：处理当前步骤。
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  // parseServerConfig：解析当前输入。
  // bits:allow(BCS011): start 是进程组合根，只读取一次环境并向下传递
  const config = parseServerConfig(process.env, root);
  // validateWebRoot：校验当前条件。
  // join：拼接文本。
  const webRoot = config.serveWeb
    ? validateWebRoot(join(root, "apps/web/dist"))
    : undefined;
  // Import provider configuration inside this error boundary; startup
  // diagnostics never echo its values.
  // import：处理当前步骤。
  const { createProductionApp } = await import("./runtime/production-app.js");
  // import：处理当前步骤。
  const { openPersistentStore } = await import("./runtime/storage.js");
  // openPersistentStore：处理当前步骤。
  const store = openPersistentStore(config);
  try {
    // createProductionApp：构造当前数据。
    const { app, demo } = createProductionApp(store, webRoot, config.dataDir);
    // startServer：执行当前流程。
    startServer(config, store, demo ? "demo" : "live", app);
  } catch (error) {
    // close：释放当前资源。
    store.close();
    throw error;
  }
}

try {
  // start：执行当前流程。
  await start();
} catch (error) {
  // error：处理当前步骤。
  console.error(
    error instanceof WebBuildError
      ? "agent4novel startup failed; frontend build is unavailable; run pnpm build"
      : "agent4novel startup failed; check server, model and storage configuration",
  );
  process.exitCode = 1;
}
