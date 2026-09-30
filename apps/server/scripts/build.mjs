import { build } from 'esbuild'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const serverRoot = new URL('../', import.meta.url)
const output = new URL('dist/', serverRoot)
const manifest = JSON.parse(await readFile(new URL('package.json', serverRoot), 'utf8'))
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await build({
  entryPoints: [fileURLToPath(new URL('src/start.ts', serverRoot))],
  outfile: fileURLToPath(new URL('start.js', output)),
  bundle: true, platform: 'node', format: 'esm', target: 'node22.13',
  external: Object.keys(manifest.dependencies).filter(name => name !== '@agent4novel/contracts'),
})
// Bundled import.meta.url resolves beside start.js. Prompts remain files (ADR-0002).
await cp(new URL('src/steps/skills/', serverRoot), new URL('skills/', output), { recursive: true })
