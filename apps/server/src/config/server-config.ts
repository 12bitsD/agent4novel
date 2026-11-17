import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { isIP } from "node:net";

// fileURLToPath：处理当前步骤。
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export type ServerConfig = {
  dataDir: string;
  databasePath: string;
  host: string;
  port: number;
  seedDemo: boolean;
  serveWeb: boolean;
};

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    // charCodeAt：处理当前步骤。
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export class ServerConfigError extends Error {
  readonly code = "server-config-invalid";
}

function parseDataDir(env: NodeJS.ProcessEnv, root: string): string {
  const rawDirectory = env.A4N_DATA_DIR ?? "";
  // containsControlCharacter：处理当前步骤。
  if (containsControlCharacter(rawDirectory)) {
    throw new ServerConfigError("A4N_DATA_DIR contains invalid characters");
  }
  // resolve：完成异步调用。
  // trim：处理当前步骤。
  return resolve(root, rawDirectory.trim() || ".data");
}

function parseFlag(env: NodeJS.ProcessEnv, name: string): string {
  // trim：处理当前步骤。
  const flag = env[name]?.trim() || "0";
  if (flag !== "0" && flag !== "1") {
    throw new ServerConfigError(`${name} must be 0 or 1`);
  }
  return flag;
}

function validHostname(host: string): boolean {
  if (host.length > 253) {
    return false;
  }
  // every：检查全部匹配。
  // split：处理当前步骤。
  // test：处理当前步骤。
  return host
    .split(".")
    .every((label) =>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
    );
}

function isLoopback(host: string): boolean {
  // isIP：校验当前条件。
  // split：处理当前步骤。
  return (
    host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 && host.split(".")[0] === "127")
  );
}

function parseHost(env: NodeJS.ProcessEnv, container: string): string {
  // trim：处理当前步骤。
  const host = env.A4N_HOST?.trim() || "127.0.0.1";
  // isIP：校验当前条件。
  // validHostname：校验当前条件。
  if (!isIP(host) && !validHostname(host)) {
    throw new ServerConfigError("A4N_HOST must be an IP address or hostname");
  }
  // isLoopback：校验当前条件。
  if (!isLoopback(host) && !(container === "1" && host === "0.0.0.0")) {
    throw new ServerConfigError(
      "A4N_HOST must be loopback or the explicit container listener",
    );
  }
  return host;
}

function parsePort(env: NodeJS.ProcessEnv): number {
  // trim：处理当前步骤。
  const rawPort = env.A4N_PORT?.trim() || "8787";
  // Number：转换数值。
  const port = Number(rawPort);
  // test：处理当前步骤。
  // isSafeInteger：校验安全整数。
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port > 65535) {
    throw new ServerConfigError(
      "A4N_PORT must be an integer in the allowed port range",
    );
  }
  return port;
}

export function parseServerConfig(
  env: NodeJS.ProcessEnv,
  root = repositoryRoot,
): ServerConfig {
  // parseDataDir：解析当前输入。
  const dataDir = parseDataDir(env, root);
  // parseFlag：解析当前输入。
  const container = parseFlag(env, "A4N_CONTAINER");
  // parseHost：解析当前输入。
  const host = parseHost(env, container);
  // parsePort：解析当前输入。
  const port = parsePort(env);
  // parseFlag：解析当前输入。
  const seed = parseFlag(env, "A4N_SEED_DEMO");
  // parseFlag：解析当前输入。
  const web = parseFlag(env, "A4N_SERVE_WEB");
  // join：拼接文本。
  return {
    dataDir,
    databasePath: join(dataDir, "agent4novel.sqlite"),
    host,
    port,
    seedDemo: seed === "1",
    serveWeb: web === "1",
  };
}
