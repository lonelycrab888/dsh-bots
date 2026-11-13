import type { FileBlock } from '@deepseek-ai/dsh-llm'
import type { Group } from './bots.ts'
import { maxDocumentBytes } from './documents.ts'

/** Only resolve stored references belonging to the authorized group; never accept a caller's hash. */
export async function readGroupDocument(group: Group | null | undefined, rowId: string, index: number,
  read: (ref: FileBlock['attachment']) => AsyncIterable<Uint8Array>) {
  const row = group?.rows.find(row => row.id === rowId)
  const ref = row?.author === 'user' && Number.isInteger(index) && index >= 0 ? row.documents?.[index]?.attachment : undefined
  if (!ref) throw new Error('此群聊中找不到该附件。')
  if (ref.bytes > maxDocumentBytes) throw new Error('附件超过 20 MB 下载上限。')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of read(ref)) {
    bytes += chunk.length
    if (bytes > maxDocumentBytes) throw new Error('附件超过 20 MB 下载上限。')
    chunks.push(chunk)
  }
  if (bytes !== ref.bytes) throw new Error('附件内容不完整，请重新上传。')
  return { name: ref.name, data: Buffer.concat(chunks).toString('base64') }
}
