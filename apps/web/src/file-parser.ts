export type FileLike = {
  name: string
  type?: string
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export type ParseResult = { ok: true; text: string } | { ok: false; error: string }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 把用户上传的文件解析成文本。
 * 格式分发（txt/md 直读、docx、pdf）与错误归一化全部藏在这里；
 * caller 只面对 ParseResult，永远不碰 mammoth / pdfjs。
 */
export async function parseFile(file: FileLike): Promise<ParseResult> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const isDocx = ext === 'docx' || file.type === DOCX_MIME
  const isPdf = ext === 'pdf' || file.type === 'application/pdf'
  try {
    if (isDocx) {
      const { extractDocxText } = await import('./docx.js')
      return { ok: true, text: await extractDocxText(await file.arrayBuffer()) }
    }
    if (isPdf) {
      const { extractPdfText } = await import('./pdf.js')
      return { ok: true, text: await extractPdfText(await file.arrayBuffer()) }
    }
    return { ok: true, text: await file.text() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
