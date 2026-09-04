import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { settingLimits } from '@agent4novel/contracts'

type MarkdownNode = {
  type: string; children?: MarkdownNode[]; value?: string; ordered?: boolean | null; start?: number | null
  position?: { start: { offset?: number }; end: { offset?: number } }
}

function renderMarkdown(source: string): ReactNode {
  if (source.length > settingLimits.text) return source
  try {
    const root = fromMarkdown(source)
    const stack: { node: MarkdownNode; depth: number }[] = [{ node: root, depth: 0 }]
    let count = 0
    while (stack.length) {
      const { node, depth } = stack.pop()!
      if (++count > 30_000 || depth > 64) return source
      for (const child of node.children ?? []) stack.push({ node: child, depth: depth + 1 })
    }
    const render = (node: MarkdownNode, key: number): ReactNode => {
      const children = () => node.children?.map(render)
      switch (node.type) {
        case 'root': return <Fragment key={key}>{children()}</Fragment>
        case 'text': return node.value
        case 'paragraph': return <p key={key}>{children()}</p>
        case 'break': return <br key={key} />
        case 'strong': return <strong key={key}>{children()}</strong>
        case 'emphasis': return <em key={key}>{children()}</em>
        case 'blockquote': return <blockquote key={key}>{children()}</blockquote>
        case 'list': return node.ordered
          ? <ol key={key} start={Number.isSafeInteger(node.start) && node.start! >= 0 ? node.start! : undefined}>{children()}</ol>
          : <ul key={key}>{children()}</ul>
        case 'listItem': return <li key={key}>{children()}</li>
        default: {
          const start = node.position?.start.offset
          const end = node.position?.end.offset
          if (start === undefined || end === undefined || start < 0 || end > source.length || end < start) throw new Error('Missing source range')
          return source.slice(start, end)
        }
      }
    }
    return render(root, 0)
  } catch { return source }
}

export const SettingMarkdown = memo(function SettingMarkdown({ source }: { source: string }) {
  const content = useMemo(() => renderMarkdown(source), [source])
  return <div className="setting-markdown">{content}</div>
})
