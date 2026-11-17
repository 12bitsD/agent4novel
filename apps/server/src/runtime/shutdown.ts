import type { ServerType } from "@hono/node-server";

export function createShutdown(
  server: ServerType,
  closeStore: () => void,
  options: { graceMs?: number; exit?: (code: number) => void } = {},
): () => void {
  let stopping = false;
  let finished = false;
  const exit = options.exit ?? process.exit;
  return () => {
    if (stopping) {
      return;
    }
    stopping = true;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      // clearTimeout：取消定时任务。
      clearTimeout(deadline);
      let code = 0;
      try {
        // closeStore：释放当前资源。
        closeStore();
      } catch {
        code = 1;
      }
      // exit：处理当前步骤。
      exit(code);
    };
    // setTimeout：注册定时任务。
    const deadline = setTimeout(() => {
      if ("closeAllConnections" in server) {
        // closeAllConnections：释放当前资源。
        server.closeAllConnections();
      }
      // finish：处理当前步骤。
      finish();
    }, options.graceMs ?? 5_000);
    // unref：处理当前步骤。
    deadline.unref();
    // close：释放当前资源。
    server.close(finish);
  };
}
