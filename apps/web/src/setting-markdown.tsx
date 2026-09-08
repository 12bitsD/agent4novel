import { settingLimits } from '@agent4novel/contracts'
import { FiniteMarkdown } from './finite-markdown.js'
export function SettingMarkdown({ source }: { source: string }) {
  return <FiniteMarkdown source={source} maxChars={settingLimits.text} />
}
