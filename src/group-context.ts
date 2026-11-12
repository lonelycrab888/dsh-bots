import { z } from 'zod'
import type { Row } from './bots.ts'

// Conservative multilingual token estimate, not a provider tokenizer. Reserve the
// remainder of the model context for instructions, tool responses and output.
export const contextBudget = 6000
export function tokens(text: string): number {
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|[^\s]/gu) ?? [])
    .reduce((sum, word) => sum + (/^[\x00-\x7f]+$/u.test(word) ? Math.ceil(word.length / 3) : word.length), 0)
}
export function excerpt(text: string, budget: number) {
  let used = 0
  let end = 0
  for (const part of text.matchAll(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|[^\s]/gu)) {
    used += tokens(part[0])
    if (used > budget) break
    end = part.index + part[0].length
  }
  return text.slice(0, end)
}
const factSchema = z.object({ source: z.string(), values: z.array(z.string()) })
const segmentSchema = z.object({
  from: z.string(), to: z.string(), ids: z.array(z.string()),
  digest: z.string(), facts: z.array(factSchema),
})
export const groupCheckpointSchema = z.object({
  version: z.literal(1), botId: z.string(), taskId: z.string().optional(), cursor: z.string().optional(),
  revision: z.number().int(), segments: z.array(segmentSchema),
})
export type GroupCheckpoint = z.infer<typeof groupCheckpointSchema>
export function visibleHistory(rows: readonly Row[]) {
  return rows.filter(row => row.author === 'user' || row.author === 'notice' ||
    row.author === 'bot' && !row.privateToKing && row.status !== 'working')
}
const terms = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9_-]+|[\p{Script=Han}]{2}/gu) ?? [])
export function retrieveHistory(rows: readonly Row[], query: string, ids: string[] = []) {
  const wanted = new Set(ids)
  const keys = terms(query)
  return visibleHistory(rows).map((row, index) => ({ row, index,
    score: wanted.has(row.id) ? 1e6 : [...terms(row.text)].filter(word => keys.has(word)).length,
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.index - a.index).map(item => item.row)
}
function segment(rows: Row[]) {
  return {
    from: rows[0].id, to: rows.at(-1)!.id, ids: rows.map(row => row.id),
    // Extracts are quotations, never model-inferred "confirmed" facts.
    digest: rows.map(row => `[${row.id}] ${row.author === 'bot' ? row.botId : row.author}: ${excerpt(row.text, 70)}`).join('\n'),
    facts: rows.flatMap(row => {
      const values = row.text.match(/(?:\d+(?:\.\d+)?(?:%|元|万元|小时|天)?)|(?:sha256:|nonce[:： ]+|messageId[:： ]+)[\w-]+|(?:\/(?:[^\s/]+\/)*[^\s]+)|(?:不要|不得|不能|必须|更正|纠正)[^。\n]+/gu) ?? []
      return values.length ? [{ source: row.id, values }] : []
    }),
  }
}
export function prepareContext(rows: readonly Row[], botId: string, taskId: string | undefined, query: string, previous?: GroupCheckpoint, budget = contextBudget) {
  const visible = visibleHistory(rows)
  let recentBudget = Math.floor(budget * 0.52)
  const recent: { id: string; author: string; text: string; incomplete?: boolean }[] = []
  let split = visible.length
  while (split > 0) {
    const row = visible[split - 1]
    const cost = tokens(row.text) + tokens(row.id) + 24
    if (cost > recentBudget && recent.length) break
    const text = excerpt(row.text, Math.max(1, recentBudget - tokens(row.id) - 24))
    recent.unshift({ id: row.id, author: row.author === 'bot' ? row.botId : row.author, text,
      ...(row.author === 'bot' && row.status !== 'done' ? { incomplete: true } : {}) })
    recentBudget -= tokens(text) + tokens(row.id) + 24
    split--
    if (text !== row.text || recentBudget <= 0) break
  }
  const older = visible.slice(0, split)
  // Only reuse exact prefix coverage; a changed projection cannot silently skip rows.
  const segments: GroupCheckpoint['segments'] = []
  let offset = 0
  for (const old of previous?.segments ?? []) {
    if (!old.ids.every((id, i) => older[offset + i]?.id === id)) break
    segments.push(old); offset += old.ids.length
  }
  while (offset < older.length) {
    let end = offset + 1, size = tokens(older[offset].text)
    while (end < older.length && end - offset < 16 && size + tokens(older[end].text) < 2000) size += tokens(older[end++].text)
    segments.push(segment(older.slice(offset, end))); offset = end
  }
  const checkpoint: GroupCheckpoint = { version: 1, botId, taskId, cursor: visible.at(-1)?.id,
    revision: (previous?.revision ?? 0) + 1, segments }
  let remaining = Math.floor(budget * 0.40)
  const recalled = retrieveHistory(older, query).slice(0, 6).flatMap(row => {
    if (remaining < 100) return []
    const text = excerpt(row.text, Math.min(600, remaining - tokens(row.id) - 24))
    remaining -= tokens(text) + tokens(row.id) + 24
    return [{ id: row.id, text }]
  })
  const summary = excerpt(segments.map(item => item.digest).join('\n'), Math.max(0, remaining))
  return { checkpoint, input: {
    taskId, summary, summaryKind: '有损原文摘录，非已确认结论；旧议题仅供回查，不沿用其约束。',
    compressedSegments: segments.length, coverage: segments.length ? { from: segments[0].from, to: segments.at(-1)!.to } : undefined,
    recent, recalled, cursor: checkpoint.cursor,
    historyTool: 'read_group_history 可按原消息 ID、关键词或游标回读完整原文，长消息分页；本群记录不会因打断被清除。',
  } }
}
