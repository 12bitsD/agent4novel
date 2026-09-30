import { openSync, readSync, closeSync } from 'node:fs'
import { CliError } from './client.js'

export function readBoundedText(path: string, limit: number, label: string, strictUtf8 = true): string {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const buffer = Buffer.alloc(limit + 1)
    let length = 0
    while (length < buffer.length) { const read = readSync(descriptor, buffer, length, buffer.length - length, null); if (!read) break; length += read }
    if (length > limit) throw new CliError(`${label} request file exceeds byte limit`, 'payload-too-large')
    try { return strictUtf8 ? new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) : buffer.subarray(0, length).toString('utf8') }
    catch { throw new CliError(`${label} request file must contain valid UTF-8`, 'invalid-input') }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${label} request file could not be read`, 'usage')
  } finally { if (descriptor !== undefined) closeSync(descriptor) }
}
export function readRequestJson(path: string, limit: number, label: string): unknown {
  const text = readBoundedText(path, limit, label)
  try { return JSON.parse(text) } catch { throw new CliError(`${label} request file must contain valid JSON`, 'invalid-input') }
}
