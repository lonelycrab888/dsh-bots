import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { FileBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

const maxFileBytes = 20 * 1024 * 1024
const maxDocumentChars = 1_000_000
const maxToolChars = 12_000

async function extractText(name: string, bytes: Buffer, signal: AbortSignal): Promise<string> {
  if (extname(name).toLowerCase() === '.docx') {
    const { extractRawText } = await import('mammoth')
    const result = await extractRawText({ buffer: bytes })
    signal.throwIfAborted()
    return result.value
  }
  if (extname(name).toLowerCase() === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    signal.throwIfAborted()
    const loading = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))),
      enableXfa: false,
    })
    try {
      const pdf = await loading.promise
      const pages: string[] = []
      let length = 0
      for (let i = 1; i <= pdf.numPages && length <= maxDocumentChars; i++) {
        signal.throwIfAborted()
        const page = await pdf.getPage(i)
        const { items } = await page.getTextContent()
        const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
        pages.push(text.trim() && `第 ${i} 页\n${text}`)
        length += text.length
      }
      return pages.join('\n\n')
    } finally {
      await loading.destroy()
    }
  }

  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    if (!text.includes('\0')) return text
  } catch { /* A binary file cannot be decoded as text. */ }
  throw new Error('无法提取此附件的文字。可上传文本、Word .docx 或带文字层的 PDF。')
}

/** Only documents admitted by Harness for this discussion may be read. */
export function registerDocumentReader(ctx: Context, files: readonly FileBlock[], cache: Map<string, string>) {
  const attachments = ctx.get('attachments')
  if (!files.length || !attachments) return
  ctx.tools.register(defineTool({
    name: 'read_uploaded_document',
    description: 'Read text from an uploaded document by its 1-based attachment number. Supports text, Word .docx, and PDFs with a text layer.',
    parameters: {
      number: { type: 'number', required: true, description: '1-based document number from the uploaded document list.' },
      offset: { type: 'number', description: '0-based character offset. Defaults to zero.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, text) => [{ type: 'text', text }],
    },
    async execute({ number, offset = 0 }, { signal }) {
      if (!Number.isSafeInteger(number) || number < 1 || !files[number - 1]) throw new Error('请选择消息中已上传的文档编号。')
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('文字偏移量必须是非负整数。')
      const { attachment } = files[number - 1]
      if (attachment.bytes > maxFileBytes) throw new Error('此文档超过 20 MB，请拆分后上传。')
      const key = `${attachment.attachmentId}:${attachment.name}`
      let text = cache.get(key)
      if (text === undefined) {
        const chunks: Uint8Array[] = []
        for await (const chunk of attachments.readFileStream(attachment, signal)) chunks.push(chunk)
        text = (await extractText(attachment.name, Buffer.concat(chunks), signal)).trim()
        if (!text) throw new Error('附件中没有可提取的文字。扫描版 PDF 需要先识别文字。')
        text = text.length > maxDocumentChars ? text.slice(0, maxDocumentChars) + '\n（文档过长，后续文字已省略。）' : text
        cache.set(key, text)
      }
      const end = Math.min(offset + maxToolChars, text.length)
      const next = end < text.length ? `\n还有后续文字，可从 offset=${end} 继续读取。` : ''
      return `附件 ${number}（${attachment.name}）\n${text.slice(offset, end)}${next}`
    },
  }))
}
