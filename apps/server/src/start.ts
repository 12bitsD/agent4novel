import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { consumeGuards } from './pipeline/consume-guards.js'
import { Pipeline } from './pipeline/pipeline.js'
import type { ArtifactStep, PipelineDefinitionEntry } from './pipeline/pipeline.js'
import { seed } from './seed.js'
import { createCaptionStep } from './steps/caption-step.js'
import { createCreativeStep } from './steps/creative-step.js'
import { createOutlineStep } from './steps/outline-step.js'
import { createSettingStep } from './steps/setting-step.js'
import { createFakeCaptionStep, createFakeCreativeStep, createFakeOutlineStep, createFakeSettingStep } from './steps/fake-step.js'
import { modelRuntime } from './steps/llm.js'
import { InMemoryStore } from './store/in-memory-store.js'

const store = new InMemoryStore()
seed(store)

// 无可用模型凭据 → fake 演示模式（不报错、不触网）。
const demo = modelRuntime.mode === 'demo'

const steps = new Map<string, ArtifactStep>([
  ['caption', demo ? createFakeCaptionStep() : createCaptionStep()],
  ['creative', demo ? createFakeCreativeStep() : createCreativeStep()],
  ['outline', demo ? createFakeOutlineStep() : createOutlineStep()],
  ['setting', demo ? createFakeSettingStep() : createSettingStep()],
])
// #3c:caption(提炼稿,落库即 approved)→ creative(创意稿,gateAfter = 比较视图)
// #4:outline(大纲,consumes 选定单方向 creative,gateAfter = 大纲 review)
// #13:setting(完整设定,消费三个 approved 上游,gateAfter = 设定 review)
const definition: PipelineDefinitionEntry[] = [
  { stepId: 'caption', outputKind: 'caption' },
  { stepId: 'creative', outputKind: 'creative', consumes: ['caption'], gateAfter: { kind: 'creative' } },
  { stepId: 'outline', outputKind: 'outline', consumes: ['creative'], gateAfter: { kind: 'outline' } },
  { stepId: 'setting', outputKind: 'setting', consumes: ['caption', 'creative', 'outline'], gateAfter: { kind: 'setting' } },
]
const pipeline = new Pipeline({
  store,
  steps,
  definition,
  // Work.config 是作品级覆盖；未设置 model 时由 ModelRuntime 使用启动默认值。
  resolveConfig: (work) => work.config,
  consumeGuards,
})

const app = createApp({ store, pipeline, meta: { demo } })

serve({ fetch: app.fetch, port: 8787 }, (info) => {
  console.log(`agent4novel server listening on http://localhost:${info.port}`)
  if (demo) console.log('演示模式:未配置可用模型凭据,使用 FakeStep')
  else console.log(`模型:${modelRuntime.defaultModelId}`)
})
