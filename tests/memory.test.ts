import { fixtureLibrary } from './fixtures.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/config.ts'
import { resolveTargets, parsePlan, selectMembers, defaultLibrary } from '../src/bots.ts'
import { applyMemoryActions, defaultMemory, memoryContext, validateMemory } from '../src/memory.ts'

const now = '2026-11-12T02:00:00.000Z'
const user = '请记住：我的演示项目代号是 KING-913。'
const fact = '用户的演示项目代号是 KING-913。'
const actions = [{ action: 'remember', text: fact, evidence: '我的演示项目代号是 KING-913' }]
const save = () => applyMemoryActions(defaultMemory, actions, user, 'group-a', () => 'memory-1', now)

test('old configs gain empty King memory without losing the existing Bot library', () => {
  const old = Config({ library: fixtureLibrary })
  assert.deepEqual(old.library.get(), fixtureLibrary)
  assert.deepEqual(old.kingMemory.get(), defaultMemory)
})
test('memory survives a serialized config roundtrip and is available independently of its source group', () => {
  const saved = save()
  assert.equal(saved.changed, 1)
  assert.equal(saved.state.entries[0].sourceSession, 'group-a')
  const loaded = Config(JSON.parse(JSON.stringify({ library: defaultLibrary, kingMemory: saved.state })))
  const restored = validateMemory(loaded.kingMemory.get())
  assert.match(memoryContext(restored), /KING-913/)
  assert.equal(restored.entries[0].source, 'conversation')
  assert.equal(defaultMemory.entries.length, 0)
})
test('duplicate memories are idempotent and updates retain the same identity', () => {
  const first = save().state
  const duplicate = applyMemoryActions(first, actions, user, 'group-b', () => 'new-id', now)
  assert.equal(duplicate.changed, 0)
  const update = applyMemoryActions(first, [{ action: 'remember', id: 'memory-1', text: '代号改为 KING-914', evidence: '代号改为 KING-914' }], '我的代号改为 KING-914', 'group-b', () => 'new-id', now)
  assert.equal(update.state.entries.length, 1)
  assert.equal(update.state.entries[0].id, 'memory-1')
  assert.match(update.state.entries[0].text, /KING-914/)
})
test('unfounded or partially invalid action batches cannot mutate stored memory', () => {
  const state = save().state
  const before = JSON.stringify(state)
  assert.throws(() => applyMemoryActions(state, [{ action: 'remember', text: '捏造的背景', evidence: '不存在的用户原文' }], user, 'group-b', () => 'new-id', now))
  assert.throws(() => applyMemoryActions(state, [{ action: 'forget', id: 'memory-1', evidence: '请忘记代号' }, { action: 'forget', id: 'missing', evidence: '请忘记代号' }], '请忘记代号', 'group-b', () => 'id', now))
  assert.equal(JSON.stringify(state), before)
})
test('forget requires an explicit request, archives the entry and prevents automatic resurrection', () => {
  const state = save().state
  assert.throws(() => applyMemoryActions(state, [{ action: 'forget', id: 'memory-1', evidence: '我的演示项目代号' }], user, 'group-b', () => 'new-id', now))
  const removed = applyMemoryActions(state, [{ action: 'forget', id: 'memory-1', evidence: '请忘记演示项目代号' }], '请忘记演示项目代号', 'group-b', () => 'new-id', now).state
  assert.equal(removed.entries[0].archived, true)
  assert.doesNotMatch(memoryContext(removed), /KING-913/)
  assert.throws(() => applyMemoryActions(removed, actions, user, 'group-c', () => 'new-id', now))
  const restored = validateMemory({ ...removed, entries: removed.entries.map(entry => ({ ...entry, archived: false })) })
  assert.match(memoryContext(restored), /KING-913/)
})
test('disable and read-only mode suppress automatic writes; disable also suppresses memory injection', () => {
  const state = save().state
  const disabled = { ...state, enabled: false }
  assert.doesNotMatch(memoryContext(disabled), /KING-913/)
  assert.equal(applyMemoryActions(disabled, actions, user, 'group-b', () => 'id', now).changed, 0)
  const readOnly = { ...state, autoRemember: false }
  assert.match(memoryContext(readOnly), /KING-913/)
  assert.equal(applyMemoryActions(readOnly, actions, user, 'group-b', () => 'id', now).changed, 0)
})
test('memory storage enforces identity and content bounds without a fixed memory-count limit', () => {
  const state = save().state
  assert.throws(() => validateMemory({ ...state, entries: [state.entries[0], state.entries[0]] }))
  assert.throws(() => validateMemory({ ...state, entries: [{ ...state.entries[0], text: 'x'.repeat(601) }] }))
  const full = { ...state, entries: Array.from({ length: 200 }, (_, i) => ({ ...state.entries[0], id: `id-${i}`, text: `事实-${i}` })) }
  assert.equal(applyMemoryActions(full, actions, user, 'group-b', () => 'new-id', now).state.entries.length, 201)
  assert.equal(full.entries.length, 200)
})
test('Bots King handles its spaced name and the legacy alias without matching a child', () => {
  const members = selectMembers(['architect'], fixtureLibrary, [], () => 'session')
  for (const input of ['@Bots King 你好', '@bots king，请记住', '@主Bot 请记住']) assert.deepEqual(resolveTargets(input, members), [])
  assert.deepEqual(resolveTargets('@Bots King @架构师 请设计', members), members)
  assert.deepEqual(parsePlan(JSON.stringify({ tasks: [], reply: '等待保存', memoryActions: actions }), members).memoryActions, actions)
})

test('memory acknowledgements distinguish remembered and forgotten entries', () => {
  const stored = save()
  assert.equal(stored.remembered, 1)
  assert.equal(stored.forgotten, 0)
  const removed = applyMemoryActions(stored.state, [{ action: 'forget', id: 'memory-1', evidence: '请忘记演示代号' }], '请忘记演示代号', 'group-b', () => 'new-id', now)
  assert.equal(removed.remembered, 0)
  assert.equal(removed.forgotten, 1)
})
