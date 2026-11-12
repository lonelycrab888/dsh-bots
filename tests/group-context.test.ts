import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareContext, retrieveHistory, tokens, excerpt } from '../src/group-context.ts'
import type { Row } from '../src/bots.ts'

test('long group memory compresses with exact sources and recovers early facts after restart', () => {
  const rows: Row[] = Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, author: 'user', text: `议题 ${i}：预算 ${i}.45 元，不得联网。${'讨论细节包含待确认依据。'.repeat(20)}` }))
  const before = JSON.stringify(rows)
  const a = prepareContext(rows, 'a', 'task-a', '预算 14.45')
  assert(a.checkpoint.segments.length > 0)
  assert(a.checkpoint.segments.some(segment => segment.facts.some(fact => fact.values.includes('14.45'))))
  assert(tokens(JSON.stringify(a.input)) < 6500)
  assert.equal(retrieveHistory(rows, '', ['m14'])[0].text, rows[14].text)
  const restored = prepareContext(rows, 'a', 'task-a', '预算', JSON.parse(JSON.stringify(a.checkpoint)))
  assert.deepEqual(restored.checkpoint.segments, a.checkpoint.segments)
  assert.equal(JSON.stringify(rows), before)
  const other = prepareContext([{ id: 'other', author: 'user', text: '另一个群' }], 'a', 'other-task', '预算')
  assert.equal(other.checkpoint.segments.length, 0)
  assert(!JSON.stringify(other.input).includes('14.45'))
})

test('partial output retained, private history excluded, and paging preserves originals', () => {
  const rows: Row[] = [
    { id: 'private', author: 'bot', botId: 'a', status: 'done', privateToKing: true, text: 'secret nonce' },
    { id: 'partial', author: 'bot', botId: 'b', status: 'stopped', text: '尚未完成 987.65' },
    { id: 'fix', author: 'user', text: '更正：必须保留 123.456，不得使用旧数值。' },
  ]
  const memory = prepareContext(rows, 'b', 'task', '更正')
  assert(!JSON.stringify(memory).includes('secret'))
  assert(memory.input.recent.some(row => row.id === 'partial' && row.incomplete))
  const original = '中文精确 123.456 /tmp/document.md '.repeat(1000)
  let offset = 0, result = ''
  while (offset < original.length) { const page = excerpt(original.slice(offset), 100); assert(page.length); result += page; offset += page.length }
  assert.equal(result, original)
})
