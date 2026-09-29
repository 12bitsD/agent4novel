import type { WorkStore } from './store/work-store.js'
import type { WorkCreateRequest } from '@agent4novel/contracts'

const demoWorks: readonly WorkCreateRequest[] = [
  { seed: '一个都市异能校园故事：主角觉醒读心能力，卷入校园异能者暗战', title: '都市异能：读心校草' },
  { seed: '一个玄幻世界的力量体系设定：九境修炼，灵根分级', title: '玄界九境' },
  { seed: '一个悬疑推理的开篇：小镇连续失踪案，主角是唯一目击者', title: '迷雾镇' },
]

// In-memory test fixture. Production initialization must use seedDemo's atomic bootstrap port.
export function seed(store: WorkStore): void {
  for (const input of demoWorks) store.createWork(input)
}

export function seedDemo(store: { createWorksIfEmpty(inputs: readonly WorkCreateRequest[]): boolean }): boolean {
  return store.createWorksIfEmpty(demoWorks)
}
