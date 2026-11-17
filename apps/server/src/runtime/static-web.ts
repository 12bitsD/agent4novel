import { constants, createReadStream, realpathSync, statSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";
import { getMimeType } from "hono/utils/mime";
import type { Context, MiddlewareHandler, Next } from "hono";

export class WebBuildError extends Error {
  readonly code = "web-build-missing";
  constructor() {
    // super：初始化父类错误。
    super("frontend build is unavailable");
  }
}

export function validateWebRoot(directory: string): string {
  try {
    // realpathSync：处理当前步骤。
    const root = realpathSync(directory);
    // realpathSync：处理当前步骤。
    // join：拼接文本。
    const index = realpathSync(join(root, "index.html"));
    // contained：处理当前步骤。
    // isFile：校验当前条件。
    // statSync：处理当前步骤。
    if (!contained(root, index) || !statSync(index).isFile()) {
      throw new WebBuildError();
    }
    return root;
  } catch {
    throw new WebBuildError();
  }
}

function contained(root: string, target: string): boolean {
  // relative：处理当前步骤。
  const path = relative(root, target);
  // startsWith：执行当前流程。
  // isAbsolute：校验当前条件。
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

type ByteRange = {
  start: number;
  end: number;
  status: 200 | 206;
  size: number;
};
function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null {
  if (!header) {
    return { start: 0, end: size - 1, status: 200, size };
  }
  // exec：处理当前步骤。
  const match = /^bytes=(\d+)?-(\d+)?$/.exec(header);
  if (!match) {
    return null;
  }
  let start: number;
  let end = size - 1;
  if (match[1] === undefined) {
    // Number：转换数值。
    const suffix = match[2] ? Number(match[2]) : 0;
    if (suffix <= 0) {
      return null;
    }
    // max：处理当前步骤。
    start = Math.max(size - suffix, 0);
  } else {
    // Number：转换数值。
    start = Number(match[1]);
    if (match[2]) {
      // Number：转换数值。
      end = Number(match[2]);
    }
  }
  // min：处理当前步骤。
  end = Math.min(end, size - 1);
  if (start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end, status: 206, size };
}

function staticPath(rawPath: string): string | null {
  // test：处理当前步骤。
  if (/%2f/i.test(rawPath)) {
    return null;
  }
  let path: string | undefined;
  try {
    // decodeURIComponent：解码 URI 组件。
    path = decodeURIComponent(rawPath);
  } catch (error) {
    void error;
  }
  if (path === undefined) {
    return null;
  }
  // startsWith：执行当前流程。
  // includes：检查包含关系。
  // includes：检查包含关系。
  // some：检查任一匹配。
  // split：处理当前步骤。
  // startsWith：执行当前流程。
  if (
    path === "/api" ||
    path.startsWith("/api/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part.startsWith("."))
  ) {
    return null;
  }
  return path;
}

async function closeFile(
  handle: Awaited<ReturnType<typeof open>> | undefined,
): Promise<void> {
  if (!handle) {
    return;
  }
  try {
    // close：释放当前资源。
    await handle.close();
  } catch (error) {
    void error;
  }
}

async function openStaticFile(root: string, path: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // join：拼接文本。
    const candidate = join(root, path === "/" ? "index.html" : path);
    // stat：处理当前步骤。
    const expected = await stat(candidate);
    // realpath：处理当前步骤。
    const file = await realpath(candidate);
    // contained：处理当前步骤。
    if (!contained(root, file)) {
      return undefined;
    }
    // open：处理当前步骤。
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    // stat：处理当前步骤。
    const stats = await handle.stat();
    // realpath：处理当前步骤。
    const unchanged =
      stats.dev === expected.dev &&
      stats.ino === expected.ino &&
      (await realpath(file)) === file;
    // isFile：校验当前条件。
    if (!stats.isFile() || !unchanged) {
      // closeFile：释放当前资源。
      await closeFile(handle);
      return undefined;
    }
    return { handle, file, size: stats.size };
  } catch (error) {
    // closeFile：释放当前资源。
    await closeFile(handle);
    throw error;
  }
}

function staticHeaders(
  c: Context,
  path: string,
  file: string,
  range: ByteRange,
): void {
  // header：处理当前步骤。
  // getMimeType：读取当前数据。
  c.header("Content-Type", getMimeType(file) || "application/octet-stream");
  // header：处理当前步骤。
  // String：转换字符串。
  c.header(
    "Content-Length",
    String(range.status === 206 ? range.end - range.start + 1 : range.size),
  );
  if (range.status === 206) {
    // header：处理当前步骤。
    c.header("Accept-Ranges", "bytes");
    // header：处理当前步骤。
    c.header(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${range.size}`,
    );
  }
  if (path === "/" || path === "/index.html") {
    // header：处理当前步骤。
    c.header("Cache-Control", "no-cache");
  } else   // test：处理当前步骤。
  if (/\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(path)) {
    // header：处理当前步骤。
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }
}

function trackStream(
  stream: ReturnType<typeof createReadStream>,
  handle: Awaited<ReturnType<typeof open>>,
): void {
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    // catch：处理异步失败。
    // close：释放当前资源。
    void handle.close().catch((error) => {
      void error;
    });
  };
  // once：注册单次事件处理。
  stream.once("end", close);
  // once：注册单次事件处理。
  stream.once("close", close);
  // once：注册单次事件处理。
  stream.once("error", close);
}

async function invalidRange(
  c: Context,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<Response> {
  // closeFile：释放当前资源。
  await closeFile(handle);
  // json：构造 JSON 响应。
  return c.json(
    {
      code: "invalid-range",
      message: "requested range is not satisfiable",
      retryable: false,
    },
    416,
  );
}

async function serveFile(
  c: Context,
  next: Next,
  root: string,
  path: string,
): Promise<Response | void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    // openStaticFile：处理当前步骤。
    const file = await openStaticFile(root, path);
    if (!file) {
      // next：处理当前步骤。
      return next();
    }
    handle = file.handle;
    // parseRange：解析当前输入。
    // header：处理当前步骤。
    const range = parseRange(c.req.header("range"), file.size);
    if (!range) {
      // invalidRange：处理当前步骤。
      const response = await invalidRange(c, handle);
      handle = undefined;
      return response;
    }
    // staticHeaders：处理当前步骤。
    staticHeaders(c, path, file.file, range);
    if (c.req.method === "HEAD" || file.size === 0) {
      // closeFile：释放当前资源。
      await closeFile(handle);
      handle = undefined;
      // body：处理当前步骤。
      return c.body(null, range.status);
    }
    // createReadStream：构造当前数据。
    stream = createReadStream("", {
      fd: handle.fd,
      autoClose: false,
      start: range.start,
      end: range.end,
    });
    // trackStream：处理当前步骤。
    trackStream(stream, handle);
    handle = undefined;
    // body：处理当前步骤。
    // toWeb：转换当前数据。
    return c.body(
      Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
      range.status,
    );
  } catch (error) {
    void error;
    // destroy：处理当前步骤。
    stream?.destroy();
    // closeFile：释放当前资源。
    await closeFile(handle);
    // next：处理当前步骤。
    return next();
  }
}

export function staticWeb(directory: string): MiddlewareHandler {
  // validateWebRoot：校验当前条件。
  const root = validateWebRoot(directory);
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      // next：处理当前步骤。
      return next();
    }
    // staticPath：处理当前步骤。
    const path = staticPath(c.req.path);
    if (!path) {
      // next：处理当前步骤。
      return next();
    }
    // serveFile：处理当前步骤。
    return serveFile(c, next, root, path);
  };
}
