// Test-only HTTP host: production commands/guards with deterministic upstream Steps.
// --live-beat explicitly opts into the configured remote provider for Beat only.
import { loadLocalEnv } from '../../src/config/local-env.js'
const live = process.argv.includes('--live-beat')
if (live) loadLocalEnv()
const { serve } = await import('@hono/node-server')
const { createApp } = await import('../../src/app.js')
const { Pipeline } = await import('../../src/pipeline/pipeline.js')
const { consumeGuards } = await import('../../src/pipeline/consume-guards.js')
const { InMemoryStore } = await import('../../src/store/in-memory-store.js')
const fake = await import('../../src/steps/fake-step.js')
const { createBeatStep } = await import('../../src/steps/beat-step.js')
const { modelRuntime } = await import('../../src/steps/llm.js')
if (live && modelRuntime.mode !== 'live') throw new Error('Live Beat validation requires an existing configured provider')
const store = new InMemoryStore()
const pipeline = new Pipeline({ store, consumeGuards, resolveConfig: () => ({ directionCount: 1 }),
  steps: new Map([
    ['caption', fake.createFakeCaptionStep()], ['creative', fake.createFakeCreativeStep()],
    ['outline', fake.createFakeOutlineStep()], ['setting', fake.createFakeSettingStep()],
    ['beat', live ? createBeatStep() : fake.createFakeBeatStep()],
  ]), definition: [
    { stepId: 'caption', outputKind: 'caption' },
    { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
    { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
    { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
    { stepId: 'beat', outputKind: 'beat', chapter: 1, consumes: ['outline', 'setting'], gateAfter: { kind: 'beat', chapter: 1 } },
  ],
})
serve({ fetch: createApp({ store, pipeline, meta: { demo: !live } }).fetch, hostname: '127.0.0.1', port: Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 0) }, info => {
  console.log(JSON.stringify({ fixtureReady: true, port: info.port, upstreamMode: 'fake', beatMode: live ? 'live' : 'demo' }))
})
