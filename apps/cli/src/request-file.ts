import { openSync, readSync, closeSync } from "node:fs";
import { CliError } from "./client.js";

function readBytes(path: string, limit: number, label: string): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!read) {
        break;
      }
      length += read;
    }
    if (length > limit) {
      throw new CliError(
        `${label} request file exceeds byte limit`,
        "payload-too-large",
      );
    }
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(`${label} request file could not be read`, "usage");
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export function readBoundedText(
  path: string,
  limit: number,
  label: string,
  encoding: "strict" | "replace" = "strict",
): string {
  const buffer = readBytes(path, limit, label);
  try {
    if (encoding === "replace") {
      return buffer.toString("utf8");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new CliError(
      `${label} request file must contain valid UTF-8`,
      "invalid-input",
    );
  }
}

export function readRequestJson(
  path: string,
  limit: number,
  label: string,
): unknown {
  const text = readBoundedText(path, limit, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(
      `${label} request file must contain valid JSON`,
      "invalid-input",
    );
  }
}
