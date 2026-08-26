import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { Pipeline } from './pipeline/pipeline.js'
import type { ArtifactStep, PipelineDefinitionEntry } from './pipeline/pipeline.js'
import { seed } from './seed.js'
import { createCaptionStep } from './steps/caption-step.js'
import { createCreativeStep } from './steps/creative-step.js'
import { createFakeCaptionStep, createFakeCreativeStep } from './steps/fake-step.js'
import { hasLlmKey } from './steps/llm.js'
import { InMemoryStore } from './store/in-memory-store.js'

const store = new InMemoryStore()
seed(store)

// 无 key → fake 演示模式(不报错)
const demo = !hasLlmKey()

const steps = new Map<string, ArtifactStep>([
  ['caption', demo ? createFakeCaptionStep() : createCaptionStep()],
  ['creative', demo ? createFakeCreativeStep() : createCreativeStep()],
])
// #3c:caption(提炼稿,落库即 approved)→ creative(创意稿,gateAfter = 比较视图)
const definition: PipelineDefinitionEntry[] = [
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
]
const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })

const app = createApp({ store, pipeline, meta: { demo } })

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`agent4novel server listening on http://localhost:${info.port}`)
  if (demo) console.log('演示模式:未配置 DEEPSEEK_API_KEY,使用 FakeStep')
})
