import { readFileSync } from "node:fs";
import {
  artifactKinds,
  beatLimits,
  proseLimits,
  creativeLimits,
  diagnosticQuerySchema,
  authorConfigLimits,
  authorConfigSaveSchema,
  agentFileUploadSchema,
  outlineApprovalRequestBytes,
} from "@agent4novel/contracts";
import type { ArtifactKind } from "@agent4novel/contracts";
import { CliError, createClient, parseCliTimeoutMs } from "./client.js";
import type { Client } from "./client.js";
import {
  list,
  create,
  get,
  advance,
  select,
  saveOutline,
  approve,
  approveOutline,
  approveSetting,
  regenerateCreative,
  startChapter,
  runProseCommand,
  selectBeatVariant,
  runBeatCommand,
  logs,
  smoke,
} from "./commands.js";
import { runLocalStep } from "./local-step.js";
import { helpFor, parseCommandLine } from "./command-line.js";
import { readBoundedText, readRequestJson } from "./request-file.js";
import {
  badExampleRequestSchema,
  badExampleQuerySchema,
  badExampleLimits,
} from "@agent4novel/contracts";

// agent4novel CLI(#14):Agent 从命令行驱动全链路。stdout 只出 JSON;进度/错误走 stderr。
// 用法:pnpm cli <command> [args] [--key value]
// server 地址 --url 或 A4N_BASE_URL(默认 http://localhost:8787)

function readSeed(flags: Record<string, string>): string {
  if (flags["seed-file"]) {
    return readFileSync(flags["seed-file"], "utf8");
  }
  if (flags.seed) {
    return flags.seed;
  }
  throw new CliError("missing --seed or --seed-file", "usage");
}

function requireKind(value: string | undefined): ArtifactKind {
  if (value && (artifactKinds as readonly string[]).includes(value)) {
    return value as ArtifactKind;
  }
  throw new CliError("Invalid artifact kind; use --help", "usage");
}

type ChapterCommand =
  | "start-chapter"
  | "approve-beat"
  | "regenerate-beat"
  | "select-beat-variant"
  | "regenerate-creative"
  | "approve-prose"
  | "save-prose"
  | "regenerate-prose";

function isChapterCommand(command: string): command is ChapterCommand {
  return [
    "start-chapter",
    "approve-beat",
    "regenerate-beat",
    "select-beat-variant",
    "regenerate-creative",
    "approve-prose",
    "save-prose",
    "regenerate-prose",
  ].includes(command);
}

async function runBadExampleCommand(
  command: string,
  client: Client,
  pos: string[],
  flags: Record<string, string>,
): Promise<unknown> {
  if (command === "mark-bad-example") {
    const parsed = badExampleRequestSchema.safeParse(
      readRequestJson(flags.file, badExampleLimits.requestBytes, "Bad example"),
    );
    if (!parsed.success) {
      throw new CliError("Invalid bad-example request", "invalid-input");
    }
    return client.markBadExample(pos[0], parsed.data);
  }
  if (command === "bad-example") {
    return client.getBadExample(pos[0], pos[1]);
  }
  const query = Object.fromEntries(
    ["chapter", "after"]
      .filter((key) => flags[key] !== undefined)
      .map((key) => [
        key,
        /^[1-9][0-9]*$/.test(flags[key]) ? Number(flags[key]) : NaN,
      ]),
  );
  const parsed = badExampleQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new CliError("Invalid bad-example query", "usage");
  }
  return client.listBadExamples(pos[0], parsed.data);
}

async function runAuthorConfigCommand(
  command: string,
  client: Client,
  pos: string[],
  flags: Record<string, string>,
): Promise<unknown> {
  if (command === "agent-config") {
    return client.getAuthorConfig(pos[0]);
  }
  if (command === "get-agent-file") {
    return client.getAgentFile(pos[0], pos[1]);
  }
  if (command === "save-agent-config") {
    const parsed = authorConfigSaveSchema.safeParse(
      readRequestJson(flags.file, 196_608, "Configuration"),
    );
    if (!parsed.success) {
      throw new CliError(
        "Invalid author configuration request",
        "invalid-input",
      );
    }
    return client.saveAuthorConfig(pos[0], parsed.data);
  }
  const parsed = agentFileUploadSchema.safeParse({
    requestId: flags["request-id"],
    kind: command === "upload-skill" ? "skill" : "prompt",
    text: readBoundedText(
      flags.file,
      authorConfigLimits.fileBytes,
      "Agent file",
    ),
  });
  if (!parsed.success) {
    throw new CliError("Invalid agent file request", "invalid-input");
  }
  return client.uploadAgentFile(pos[0], parsed.data);
}

async function runWorkCommand(
  command: string,
  client: Client,
  pos: string[],
  flags: Record<string, string>,
): Promise<unknown> {
  if (command === "config") {
    return client.getConfig();
  }
  if (command === "list") {
    return list(client);
  }
  if (command === "create") {
    return create(client, {
      seed: readSeed(flags),
      ...(flags.title ? { title: flags.title } : {}),
    });
  }
  if (command === "get") {
    return get(
      client,
      pos[0],
      flags.kind ? requireKind(flags.kind) : undefined,
      flags.chapter === undefined ? undefined : Number(flags.chapter),
    );
  }
  if (command === "advance") {
    return advance(client, pos[0]);
  }
  return select(client, pos[0], pos[1]);
}

async function runOutlineCommand(
  command: string,
  client: Client,
  pos: string[],
  flags: Record<string, string>,
): Promise<unknown> {
  if (command === "save-outline") {
    const content = JSON.parse(readFileSync(flags.file, "utf8")) as Parameters<
      typeof saveOutline
    >[2];
    return saveOutline(client, pos[0], content);
  }
  if (command === "approve") {
    return approve(client, pos[0], requireKind(pos[1]));
  }
  if (command === "approve-outline") {
    return approveOutline(
      client,
      pos[0],
      readRequestJson(flags.file, outlineApprovalRequestBytes, "Outline"),
    );
  }
  let source: string;
  try {
    source = readFileSync(flags.file, "utf8");
  } catch {
    throw new CliError("Unable to read the setting request file", "usage");
  }
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new CliError(
      "Setting request file must contain valid JSON",
      "invalid-input",
    );
  }
  return approveSetting(client, pos[0], input);
}

function proseCommand(
  command: ChapterCommand,
): command is "approve-prose" | "save-prose" | "regenerate-prose" {
  return ["approve-prose", "save-prose", "regenerate-prose"].includes(command);
}

function chapterInput(command: ChapterCommand, flags: Record<string, string>) {
  const isProse = proseCommand(command);
  const limit = isProse ? proseLimits.bodyBytes : beatLimits.bodyBytes;
  let label = "Beat";
  if (command === "start-chapter") {
    label = "Chapter";
  } else if (isProse) {
    label = "Prose";
  }
  const source = readBoundedText(
    flags.file,
    limit,
    label,
    isProse || command === "start-chapter" ? "strict" : "replace",
  );
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new CliError(
      `${label} request file must contain valid JSON`,
      "invalid-input",
    );
  }
}

async function runChapterCommand(
  command: ChapterCommand,
  client: Client,
  pos: string[],
  flags: Record<string, string>,
): Promise<unknown> {
  if (command === "regenerate-creative") {
    return regenerateCreative(
      client,
      pos[0],
      readRequestJson(flags.file, creativeLimits.bodyBytes, "Creative"),
    );
  }
  const input = chapterInput(command, flags);
  if (command === "start-chapter") {
    return startChapter(client, pos[0], input);
  }
  if (command === "select-beat-variant") {
    return selectBeatVariant(client, pos[0], input);
  }
  if (proseCommand(command)) {
    return runProseCommand(client, pos[0], command, input);
  }
  return runBeatCommand(client, pos[0], command, input);
}

type CommandInvocation = {
  client: Client;
  pos: string[];
  flags: Record<string, string>;
  timeoutMs?: number;
  log: (line: string) => void;
};

async function runUtilityCommand(
  command: string,
  invocation: CommandInvocation,
): Promise<unknown> {
  const client = invocation.client;
  const pos = invocation.pos;
  const flags = invocation.flags;
  const log = invocation.log;
  if (command === "logs") {
    const query = diagnosticQuerySchema.safeParse({
      requestId: flags["request-id"],
      attemptId: flags["attempt-id"],
    });
    if (!query.success) {
      throw new CliError("Invalid diagnostic filters", "usage");
    }
    return logs(client, pos[0], query.data);
  }
  return smoke(
    client,
    {
      seed: readSeed(flags),
      ...(flags.title ? { title: flags.title } : {}),
    },
    log,
  );
}

async function executeCommand(
  command: string,
  invocation: CommandInvocation,
): Promise<unknown> {
  const client = invocation.client;
  const pos = invocation.pos;
  const flags = invocation.flags;
  const timeoutMs = invocation.timeoutMs;
  switch (command) {
    case "run-step":
      return runLocalStep(pos[0], flags, timeoutMs);
    case "mark-bad-example":
    case "bad-example":
    case "bad-examples":
      return runBadExampleCommand(command, client, pos, flags);
    case "agent-config":
    case "get-agent-file":
    case "save-agent-config":
    case "upload-skill":
    case "upload-prompt":
      return runAuthorConfigCommand(command, client, pos, flags);
    case "config":
    case "list":
    case "create":
    case "get":
    case "advance":
    case "select":
      return runWorkCommand(command, client, pos, flags);
    case "save-outline":
    case "approve":
    case "approve-outline":
    case "approve-setting":
      return runOutlineCommand(command, client, pos, flags);
    case "logs":
    case "smoke":
      return runUtilityCommand(command, invocation);
    default:
      if (isChapterCommand(command)) {
        return runChapterCommand(command, client, pos, flags);
      }
      throw new CliError("Unknown command; use --help", "usage");
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Help is discovery, even when mixed with incomplete or invalid invocation
  // data.
  if (
    argv.every((token) => token === "--") ||
    argv.includes("--help") ||
    argv.includes("-h")
  ) {
    console.error(helpFor(argv));
    return;
  }
  const { _, flags } = parseCommandLine(argv);
  const [command, ...pos] = _;
  const baseUrl =
    flags.url ?? process.env.A4N_BASE_URL ?? "http://localhost:8787";
  // bits:allow(BCS011): main 是 CLI 组合根，环境值在此解析并注入 client
  const timeoutMs = parseCliTimeoutMs(
    flags["timeout-ms"] ?? process.env.A4N_CLI_TIMEOUT_MS,
  );
  const client = createClient({ baseUrl, timeoutMs });
  const log = (line: string) => console.error(line);

  const result = await executeCommand(command, {
    client,
    pos,
    flags,
    timeoutMs,
    log,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(
      JSON.stringify({
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        ...(err.attemptId ? { attemptId: err.attemptId } : {}),
        ...(err.issues ? { issues: err.issues } : {}),
        ...err.details,
      }),
    );
  } else {
    console.error(
      JSON.stringify({ code: "internal", message: "CLI command failed" }),
    );
  }
  process.exitCode = 1;
});
