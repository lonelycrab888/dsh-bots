import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultLibrary, deleteBot, availableMembers, freshCoordinator, parsePlan, selectMembers, validateLibrary, redactDeletedBotIds } from '../src/bots.ts'
import { defaultMemory, forgetBotIds, memoryContext } from '../src/memory.ts'
import { Config } from '../src/config.ts'
import { projection } from '../src/projection.ts'

const worker = { id: 'bot-old-123', name: '研究员', duty: '研究问题', archived: false }
const original = validateLibrary({ ...defaultLibrary, bots: [worker] })
const members = selectMembers([worker.id], original, [], () => 'old-worker-session')

test('delete retires an ID, survives restart and rejects reusing it even under another name', () => {
  const deleted = deleteBot(original, worker.id)
  assert.deepEqual(deleted.bots, [])
  assert.deepEqual(deleted.deletedBotIds, [worker.id])
  assert.deepEqual(Config(JSON.parse(JSON.stringify({ library: deleted }))).library.get(), deleted)
  assert.throws(() => validateLibrary({ ...deleted, bots: [{ ...worker, name: '其他名称' }] }))
  assert.throws(() => deleteBot(deleted, worker.id))
  assert.throws(() => deleteBot(original, 'coordinator'))
  assert.deepEqual(original.bots, [worker])
})

test('recreating the same name does not replace a deleted member in an existing group', () => {
  const replacement = { ...worker, id: 'bot-new-456' }
  const library = validateLibrary({ ...deleteBot(original, worker.id), bots: [replacement] })
  const oldGroup = { members, rows: [] }
  assert.deepEqual(availableMembers(oldGroup, library), [])
  assert.equal(oldGroup.members[0].id, worker.id)
  const newMembers = selectMembers([replacement.id], library, [], () => 'new-worker-session')
  assert.equal(newMembers[0].sessionId, 'new-worker-session')
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ botId: worker.id, task: '旧任务' }] }), newMembers))
  assert.deepEqual(parsePlan(JSON.stringify({ tasks: [{ botId: replacement.id, task: '新任务' }] }), newMembers).tasks[0].botId, replacement.id)
})

test('deletion replaces King context once, preserving the history cutoff across restart', () => {
  const old = freshCoordinator(undefined, 0, 0, () => 'king-original')
  const rotated = freshCoordinator(old, 1, 12, () => 'king-after-delete')
  assert.notEqual(rotated.sessionId, old.sessionId)
  assert.equal(rotated.historyStart, 12)
  const state = projection.stateSchema.parse({ inherited: 0, group: { members, rows: [], coordinator: rotated } })
  assert.deepEqual(freshCoordinator(state.group!.coordinator, 1, 20, () => 'must-not-use'), rotated)
  const next = freshCoordinator(rotated, 2, 24, () => 'king-after-second-delete')
  assert.equal(next.historyStart, 24)
  assert.equal(next.sessionId, 'king-after-second-delete')
})

test('retired IDs leave memory text and evidence without erasing unrelated preferences', () => {
  const memory = { ...defaultMemory, entries: [
    { id: 'memory-1', text: `研究员编号 ${worker.id}`, evidence: `记住 ${worker.id}`, source: 'conversation' as const, archived: false, updatedAt: '2026-11-12T02:00:00.000Z' },
    { id: 'memory-2', text: '回答先给结论', source: 'manual' as const, archived: false, updatedAt: '2026-11-12T02:00:00.000Z' },
  ] }
  const cleared = forgetBotIds(memory, [worker.id])
  assert.doesNotMatch(JSON.stringify(cleared), /bot-old-123/)
  assert.doesNotMatch(memoryContext(cleared), /bot-old-123/)
  assert.deepEqual(cleared.entries[1], memory.entries[1])
  assert.equal(memory.entries[0].text, `研究员编号 ${worker.id}`)
  const full = { ...memory, entries: [{ ...memory.entries[0], text: 'a'.repeat(600), evidence: 'a'.repeat(2000) }] }
  assert.equal(forgetBotIds(full, ['a']).entries[0].text.length, 600)
  assert.equal(redactDeletedBotIds('Bot bot-old', ['Bot', 'bot-old']), '[已删除 Bot] [已删除 Bot]')
  assert.equal(redactDeletedBotIds('bot-old-123 / bot-old', ['bot-old', 'bot-old-123']), '[已删除 Bot] / [已删除 Bot]')
})
