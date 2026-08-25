import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { Pipeline } from './pipeline/pipeline.js'
import type { ArtifactStep, PipelineDefinitionEntry } from './pipeline/pipeline.js'
import { seed } from './seed.js'
import { createFakePreprocessStep } from './steps/fake-step.js'
import { hasLlmKey } from './steps/llm.js'
import { createPreprocessStep } from './steps/preprocess-step.js'
import { InMemoryStore } from './store/in-memory-store.js'

const store = new InMemoryStore()
seed(store)

// 无 key → fake 演示模式（不报错）；interview 开关 v1 硬编码 true
const demo = !hasLlmKey()
const interview = true

const steps = new Map<string, ArtifactStep>([
  ['preprocess', demo ? createFakePreprocessStep() : createPreprocessStep()],
])
const definition: PipelineDefinitionEntry[] = [
  { stepId: 'preprocess', outputKind: 'preprocess', gateAfter: { kind: 'preprocess' }, interview },
]
const pipeline = new Pipeline({ store, steps, definition, resolveConfig: () => ({}) })

const app = createApp({ store, pipeline, meta: { demo, interview } })

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`agent4novel server listening on http://localhost:${info.port}`)
  if (demo) console.log('演示模式：未配置 DEEPSEEK_API_KEY，使用 FakeStep')
})
