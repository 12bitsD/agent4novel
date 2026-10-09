import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  beatArtifactSchema,
  beatVariantSelectionRequestSchema,
  beatVariantSelectionResponseSchema,
  stepExperimentRecordInputSchema,
  stepExperimentRecordInvocationSchema,
  stepExperimentRecordResultSchema,
  stepExperimentRecordMetaSchema,
} from '@agent4novel/contracts'
import { cliBin as bin, cliTestEnv } from './cli-process.js'

const artifactA = { id: 'beat-a', workId: 'work-test', kind: 'beat' as const, chapter: 1, version: 1, humanStatus: 'pending' as const, createdAt: '2026-10-10T00:00:00.000Z', content: { title: '旧章纲', goal: '旧目标', writingPlan: [{ itemId: 'item-old', title: '旧安排', content: '旧内容' }], ending: '旧落点' } }
const artifactB = { ...artifactA, id: 'beat-b', version: 2, content: { ...artifactA.content, title: '新章纲', goal: '新目标' } }

async function invoke(args: string[], baseUrl: string) {
  const child = spawn(bin, args, { env: cliTestEnv({ A4N_BASE_URL: baseUrl, A4N_CLI_TIMEOUT_MS: '10000' }), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''; let stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

describe('E20 CLI/Harness acceptance: beat variant selection', () => {
  it('has a strict selection request and a complete comparison receipt', () => {
    expect(beatVariantSelectionRequestSchema.shape.choice).toBeDefined()
    expect(beatVariantSelectionResponseSchema.shape.comparison).toBeDefined()
  })

  it('drives the real CLI against the production fixture and keeps A/B plus pending selection observable', async () => {
    const server = spawn(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'), fileURLToPath(new URL('../../server/test/fixtures/beat-cli-server.ts', import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] })
    const directory = mkdtempSync(join(tmpdir(), 'a4n-beat-variant-cli-')); let output = ''
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture start deadline exceeded')), 10_000)
        server.once('exit', code => { clearTimeout(timer); reject(new Error(`fixture exited ${code}`)) })
        server.stdout.on('data', chunk => { output += String(chunk); const line = output.split('\n').find(line => line.includes('"fixtureReady":true')); if (line) { clearTimeout(timer); resolve(JSON.parse(line).port) } })
      })
      const cli = (args: string[]) => invoke([...args, '--url', `http://127.0.0.1:${port}`], `http://127.0.0.1:${port}`)
      const created = JSON.parse((await cli(['create', '--seed', '合成素材：以日常对话建立关系。'])).stdout)
      for (const args of [['advance', created.id], ['select', created.id], ['advance', created.id], ['approve', created.id, 'outline'], ['advance', created.id]]) expect((await cli(args)).code).toBe(0)
      const setting = JSON.parse((await cli(['get', created.id, '--kind', 'setting'])).stdout); const file = join(directory, 'request.json')
      writeFileSync(file, JSON.stringify({ content: setting.content, expectedHeadVersion: setting.version })); expect((await cli(['approve-setting', created.id, '--file', file])).code).toBe(0); expect((await cli(['advance', created.id])).code).toBe(0)
      const old = beatArtifactSchema.parse(JSON.parse((await cli(['get', created.id, '--kind', 'beat', '--chapter', '1'])).stdout))
      writeFileSync(file, JSON.stringify({ chapter: 1, expectedArtifactId: old.id, expectedHeadVersion: old.version, content: old.content, instructions: '把第二个安排写得更具体。' }))
      const regenerated = JSON.parse((await cli(['regenerate-beat', created.id, '--file', file])).stdout)
      expect(regenerated.comparison).toMatchObject({ original: old, candidate: regenerated.artifact }); expect(regenerated.artifact.humanStatus).toBe('pending'); expect(regenerated.artifact.version).toBe(old.version + 1)
      const selection = { chapter: 1, expectedArtifactId: regenerated.artifact.id, expectedHeadVersion: regenerated.artifact.version, originalArtifactId: old.id, originalVersion: old.version, originalContent: old.content, choice: 'new' }
      writeFileSync(file, JSON.stringify(selection)); const selected = await cli(['select-beat-variant', created.id, '--file', file]); expect(selected.code, selected.stderr).toBe(0)
      const receipt = beatVariantSelectionResponseSchema.parse(JSON.parse(selected.stdout)); expect(receipt.comparison).toEqual({ original: old, candidate: regenerated.artifact }); expect(receipt.artifact).toMatchObject({ id: regenerated.artifact.id, version: regenerated.artifact.version, humanStatus: 'pending' }); expect(receipt.selection.writeOutcome).toBe('not-committed')
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(selection)
    } finally { server.kill('SIGTERM'); rmSync(directory, { recursive: true, force: true }) }
  }, 30_000)

  it('exposes the regeneration source and actual transport in run-step records', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'a4n-beat-record-cli-')); const recordDir = join(directory, 'beat-run'); const provider = createServer(async (_req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'mock-beat-record', model: 'LongCat-2.0', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: '模型新章纲', goal: '推进', writingPlan: [{ title: '行动', content: '继续追踪' }], ending: '留下线索' }) }, finish_reason: 'stop' }] }))
    })
    provider.listen(0, '127.0.0.1'); await once(provider, 'listening'); const address = provider.address(); if (!address || typeof address === 'string') throw new Error('missing provider address')
    try {
      const inputFile = join(directory, 'input.json'); const promptFile = join(directory, 'system.md'); const configFile = join(directory, 'config.json')
      const outline = { arcs: [1, 2, 3].map(i => ({ arcId: `arc-${i}`, title: '弧线', conflict: '冲突', development: '发展', resolution: '收束', segments: [
        { segmentId: `${i}-1`, title: '点一', summary: '发生', outcome: '变化' }, { segmentId: `${i}-2`, title: '点二', summary: '发生', outcome: '变化' },
      ] })) }
      const setting = { overview: '城市', world: [{ itemId: 'world-1', title: '规则', content: '现实' }], characters: [{ itemId: 'character-1', title: '主角', content: '追查' }], factions: [], relationships: [], extensions: [] }
      writeFileSync(inputFile, JSON.stringify({ seed: '实验素材', chapter: 1, upstream: { outline, setting }, regeneration: { content: artifactA.content, instructions: '保留旧线索并加快行动。' } }))
      writeFileSync(promptFile, '受保护的 Beat system prompt'); writeFileSync(configFile, JSON.stringify({ thinking: 'disabled', temperature: 0.4, topP: 0.6 }))
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(bin, ['run-step', 'beat', '--input-file', inputFile, '--system-prompt-file', promptFile, '--config-file', configFile, '--record-dir', recordDir], { env: cliTestEnv({ A4N_MODEL: 'longcat:LongCat-2.0', LONGCAT_API_KEY: 'synthetic-step-key', LONGCAT_BASE_URL: `http://127.0.0.1:${address.port}/v1`, A4N_LLM_TIMEOUT_MS: '5000' }), stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += String(chunk) }); child.stderr.on('data', chunk => { stderr += String(chunk) }); child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }))
      })
      expect(result.code, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'succeeded', stepId: 'beat', recording: { status: 'complete', dir: recordDir } })
      expect(readdirSync(recordDir).sort()).toEqual(['input.json', 'invocation.json', 'meta.json', 'result.json'])
      const recordedInput = stepExperimentRecordInputSchema.parse(JSON.parse(readFileSync(join(recordDir, 'input.json'), 'utf8'))); const invocation = stepExperimentRecordInvocationSchema.parse(JSON.parse(readFileSync(join(recordDir, 'invocation.json'), 'utf8'))); const recordedResult = stepExperimentRecordResultSchema.parse(JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8'))); const meta = stepExperimentRecordMetaSchema.parse(JSON.parse(readFileSync(join(recordDir, 'meta.json'), 'utf8')))
      expect(recordedInput.input.regeneration).toEqual({ content: artifactA.content, instructions: '保留旧线索并加快行动。' }); expect(recordedInput.sources.inputPath).toBe(inputFile); expect(recordedInput.sources.systemPromptPath).toBe(promptFile); expect(recordedInput.sources.configPath).toBe(configFile); expect(invocation.captured).toBe(true); expect(invocation.system).toContain('受保护的 Beat system prompt'); expect(invocation.prompt).toContain('保留旧线索并加快行动'); expect(invocation.effectiveConfig).toMatchObject({ model: 'longcat:LongCat-2.0', thinking: 'disabled', temperature: 0.4, topP: 0.6 }); expect(recordedResult).toMatchObject({ status: 'succeeded', content: { title: '模型新章纲' } }); expect(meta).toMatchObject({ complete: true, status: 'complete', stepId: 'beat' }); expect(statSync(join(recordDir, 'input.json')).mode & 0o777).toBe(0o600)
    } finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  }, 30_000)
})
