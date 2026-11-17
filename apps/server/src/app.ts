import { Hono } from "hono";
import { settingExtensionRoutes } from "./routes/setting-extensions.js";
import { worksRoutes } from "./routes/works.js";
import type { Pipeline } from "./pipeline/pipeline.js";
import type { WorkStore } from "./store/work-store.js";
import {
  appConfigSchema,
  healthSchema,
  type AppConfig,
} from "@agent4novel/contracts";
import { contractJson, responseUnavailable } from "./contract-response.js";
import { staticWeb } from "./runtime/static-web.js";
import { authorConfigRoutes } from "./routes/author-config.js";
import type { AuthorConfigService } from "./config/author-config-service.js";
import { badExampleRoutes } from "./routes/bad-examples.js";
import type { BadExampleRepository } from "./bad-examples/repository.js";

// demo = 无 LLM key 的演示模式
export type AppMeta = AppConfig;

export type AppDeps = {
  store: WorkStore;
  pipeline: Pipeline;
  meta: AppMeta;
  webRoot?: string;
  authorConfig?: AuthorConfigService;
  badExamples?: BadExampleRepository;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  // onError：处理当前步骤。
  // responseUnavailable：处理当前步骤。
  app.onError((_error, c) => responseUnavailable(c));
  // notFound：处理当前步骤。
  // json：构造 JSON 响应。
  app.notFound((c) =>
    c.json(
      { code: "not-found", message: "route not found", retryable: false },
      404,
    ),
  );
  // get：读取值。
  // contractJson：处理当前步骤。
  app.get("/api/config", (c) => contractJson(c, appConfigSchema, deps.meta));
  // get：读取值。
  // contractJson：处理当前步骤。
  app.get("/api/health", (c) =>
    contractJson(c, healthSchema, { status: "ok" }),
  );
  // route：处理当前步骤。
  // worksRoutes：处理当前步骤。
  app.route("/", worksRoutes(deps));
  // route：处理当前步骤。
  // settingExtensionRoutes：处理当前步骤。
  app.route("/", settingExtensionRoutes(deps.store));
  if (deps.authorConfig) {
    // route：处理当前步骤。
    // authorConfigRoutes：处理当前步骤。
    app.route("/", authorConfigRoutes(deps.authorConfig));
  }
  if (deps.badExamples) {
    // route：处理当前步骤。
    // badExampleRoutes：处理当前步骤。
    app.route("/", badExampleRoutes(deps.badExamples));
  }
  if (deps.webRoot) {
    // use：注册中间件。
    // staticWeb：处理当前步骤。
    app.use("*", staticWeb(deps.webRoot));
  }
  return app;
}
