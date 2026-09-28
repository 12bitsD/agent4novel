// Test-only HTTP host: production commands/guards with deterministic upstream Steps.
// --live-prose explicitly opts into the configured remote provider for Prose only.
import { loadLocalEnv } from '../../src/config/local-env.js'
const live = process.argv.includes('--live-prose')
if (live) loadLocalEnv()
const { serve } = await import('@hono/node-server')
const { createApp } = await import('../../src/app.js')
const { Pipeline } = await import('../../src/pipeline/pipeline.js')
const { consumeGuards } = await import('../../src/pipeline/consume-guards.js')
const { InMemoryStore } = await import('../../src/store/in-memory-store.js')
const fake = await import('../../src/steps/fake-step.js')
const { createProseStep } = await import('../../src/steps/prose-step.js')
const { modelRuntime } = await import('../../src/steps/llm.js')
if (live && modelRuntime.mode !== 'live') throw new Error('Live Prose validation requires an existing configured provider')
const store = new InMemoryStore()
const pipeline = new Pipeline({ store, consumeGuards, resolveConfig: () => ({ directionCount: 1 }),
  steps: new Map([
    ['caption', fake.createFakeCaptionStep()], ['creative', fake.createFakeCreativeStep()],
    ['outline', fake.createFakeOutlineStep()], ['setting', fake.createFakeSettingStep()],
    ['beat', fake.createFakeBeatStep()], ['prose', live ? createProseStep() : fake.createFakeProseStep()],
  ]), definition: [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
    { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
    { stepId: 'prose', outputKind: 'prose', chapter: 1, consumes: ['beat', 'setting'], gateAfter: { kind: 'prose', chapter: 1 } },
  ],
})
serve({ fetch: createApp({ store, pipeline, meta: { demo: !live } }).fetch, hostname: '127.0.0.1', port: Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 0) }, info => {
  console.log(JSON.stringify({ fixtureReady: true, port: info.port, upstreamMode: 'fake', proseMode: live ? 'live' : 'demo' }))
})
