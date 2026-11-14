import { createReadStream } from 'node:fs'
import { createZstdDecompress } from 'node:zlib'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { projection } from './projection.ts'

// Observational v4 reader: never materialize the decompressed journal or retain
// assistant/tool transcripts. The path comes only from persistence.stat, not UI.
export async function readGroupLog(path: string, header: SessionHeader, signal: AbortSignal) {
  signal.throwIfAborted()
  const source = createReadStream(path, { signal, highWaterMark: 64 * 1024 })
  const decoded = path.endsWith('.zstd') ? source.pipe(createZstdDecompress()) : source
  source.on('error', error => decoded.destroy(error))
  const cancel = () => decoded.destroy(signal.reason instanceof Error ? signal.reason : new Error('已取消读取'))
  signal.addEventListener('abort', cancel, { once: true })
  let state = projection.init(header, 0 as never), title: string | undefined
  let first = true, seq = 0, length = 0, inherited = Boolean(header.isSeeded)
  let pieces: Buffer[] = []
  try {
    for await (const chunk of decoded) {
      signal.throwIfAborted()
      let start = 0
      while (start < chunk.length) {
        const end = chunk.indexOf(10, start)
        const part = chunk.subarray(start, end < 0 ? chunk.length : end)
        length += part.length
        if (length > 16 * 1024 * 1024) throw new Error('单条会话记录超过安全读取上限；原日志已保留。')
        pieces.push(part)
        if (end < 0) break
        const value = JSON.parse(Buffer.concat(pieces, length).toString('utf8'))
        pieces = []; length = 0; start = end + 1
        if (first) {
          first = false
          if (value.type !== 'session' || value.version !== 4 || value.id !== header.id) throw new Error('群聊日志格式需要由宿主迁移后再读取。')
          continue
        }
        if (!value || value.seq !== seq++ || typeof value.type !== 'string') throw new Error('群聊日志序列不完整；原日志已保留。')
        if(inherited){if(value.type==='session/end-seed'&&value.data?.inherited===true)inherited=false;continue}
        if (value.type === 'session/title' && typeof value.data?.title === 'string') title = value.data.title
        if (value.type.startsWith('plugin:dsh-bots/')) state = projection.apply(state, value as SessionEvent)
      }
    }
    if(inherited)throw new Error('群聊日志缺少继承边界。')
    if (first) throw new Error('群聊日志缺少头部。')
    // A last non-newline-terminated row is an uncommitted physical tail.
    return { cwd: header.cwd, origin: header.origin, group: state.group, title }
  } finally {
    signal.removeEventListener('abort', cancel)
    decoded.destroy(); source.destroy()
  }
}
