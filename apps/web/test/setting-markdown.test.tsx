import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingMarkdown } from '../src/setting-markdown.js'

describe('受限 Markdown 预览', () => {
  it('临时编辑超长正文在解析前降级为原文；过深嵌套同样保留源码', () => {
    const source = '**粗体**'.repeat(4_000)
    const html = renderToStaticMarkup(<SettingMarkdown source={source} />)
    expect(html.includes('<strong>')).toBe(false)
    expect(html).toContain(source)
    const nested = '> '.repeat(70) + '结尾'
    const deep = renderToStaticMarkup(<SettingMarkdown source={nested} />)
    expect(deep).not.toContain('<blockquote>')
    expect(deep).toContain('&gt; '.repeat(70) + '结尾')
  })
  it('支持段落、强调、引用、列表；不允许元素保持源码可见而不加载资源', () => {
    const html = renderToStaticMarkup(<SettingMarkdown source={'一段 **粗体** 与 *斜体*。\n\n> 引用\n\n3. 三\n4. 四\n\n- 列表\n\n# 标题\n\n[链接](https://example.com) ![图](https://example.com/a.png)\n\n<script>alert(1)</script>\n\n`代码`'} />)
    expect(html).toContain('<strong>粗体</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<ol start="3">')
    expect(html).toContain('<ul>')
    expect(html).toContain('# 标题')
    expect(html).toContain('[链接](https://example.com)')
    expect(html).toContain('![图](https://example.com/a.png)')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('`代码`')
    expect(html).not.toMatch(/<(?:a|img|script|h1|code)\b/)
  })
})
