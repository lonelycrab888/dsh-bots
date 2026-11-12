import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { botMentionFormatter } from '../src/mention.ts'
import { peerMessageId, peerReceipt, type PeerEvent } from '../src/peer-messages.ts'
import { projection } from '../src/projection.ts'
import { confirmedGroupRoute } from '../src/existing-groups.ts'

test('the group journal folds independent receipts and keeps directed originals off the wire', () => {
  let state: Parameters<typeof projection.apply>[0] = { inherited: 0, group: { members: [], rows: [] } }
  let seq = 0
  const apply = (data: PeerEvent) => {
    state = projection.apply(state, { type: 'plugin:dsh-bots/peer-message', data, seq: seq++, time: 0, ignorable: true } as SessionEvent)
  }
  const id = peerMessageId('group', 'task', 'sender', 'nonce-123')
  assert.notEqual(id, peerMessageId('other-group', 'task', 'sender', 'nonce-123'))
  const sent = { kind: 'sent', id, taskId: 'task', runId: 'first', from: 'sender', to: ['first', 'second'], visibility: 'directed', text: '私信原文', nonce: 'nonce-123', sentAt: 1 } as const
  apply({ ...sent, to: [...sent.to] })
  apply({ ...sent, to: [...sent.to], text: '重复发送不能覆盖' })
  apply({ kind: 'acknowledged', id, recipient: 'first', runId: 'first', at: 2 })
  apply({ kind: 'delivered', id, recipient: 'outsider', runId: 'first', at: 3 })
  assert.deepEqual(state.peerMessages?.[0].deliveries, {})
  apply({ kind: 'delivered', id, recipient: 'first', runId: 'first', at: 4 })
  apply({ kind: 'acknowledged', id, recipient: 'first', runId: 'first', at: 5 })
  apply({ kind: 'acknowledged', id, recipient: 'first', runId: 'second', at: 6 })
  apply({ kind: 'delivered', id, recipient: 'second', runId: 'second', at: 7 })
  apply({ kind: 'acknowledged', id, recipient: 'second', runId: 'second', at: 8 })
  const message = state.peerMessages![0]
  assert.equal(state.peerMessages?.length, 1)
  assert.deepEqual(message.deliveries, {
    first: { deliveredAt: 4, acknowledgedAt: 5 }, second: { deliveredAt: 7, acknowledgedAt: 8 },
  })
  const first = peerReceipt(message, 'first')
  assert.equal(first.text, sent.text)
  assert.equal(first.nonce, sent.nonce)
  assert.notEqual(first.receiptId, peerReceipt(message, 'second').receiptId)
  assert.doesNotMatch(JSON.stringify(projection.wire.view(state)), /私信原文|nonce-123/u)
  apply({ ...sent, id: 'public', to: [], visibility: 'public', text: '公开原文' })
  assert.deepEqual(state.group?.rows.find(row => row.id === 'public'),
    { id: 'public', author: 'bot', botId: 'sender', taskId: 'task', status: 'done', text: '公开原文' })
})

test('the last confirmed group link survives unrelated turns and subsequent notices', () => {
  const rows = [
    { id: 'one', author: 'notice', text: '创建群聊', sessionId: 'group', taskLink: 'task', groupReference: true },
    { id: 'two', author: 'user', text: '无关话题' },
    { id: 'three', author: 'notice', text: '已发送通知', sessionId: 'group', groupReference: true },
    { id: 'four', author: 'bot', botId: 'king', status: 'done', text: '其他群异步结论', sessionId: 'other' },
  ] as const
  assert.deepEqual(confirmedGroupRoute(rows), { targetId: 'group', taskId: 'task' })
})

test('display mentions are idempotent and protect paths, URLs, and similar Latin names', () => {
  const format = botMentionFormatter(['KingBot', '架构师', '审阅员'])
  const text = 'KingBot请架构师和@审阅员检查 /tmp/架构师.txt 和 @"相对路径/架构师.txt"、@"/tmp/审阅员.md"、https://example.com/KingBot，KingBotX。'
  const result = format(text)
  assert.match(result, /^@KingBot请@架构师和@审阅员/u)
  assert.ok(result.includes('/tmp/架构师.txt'))
  assert.ok(result.includes('@"/tmp/审阅员.md"'))
  assert.ok(result.includes('https://example.com/KingBot，KingBotX。'))
  assert.equal(format(result), result)
})
