import assert from 'node:assert/strict'
import { test } from 'node:test'
import { botAvatars, fillAvatars } from '../src/avatars.ts'
import { createRequestedBots, defaultLibrary, updateLibrary, type Bot } from '../src/bots.ts'
import { validateGroupMembers } from '../src/group-creation.ts'

const bot = (index: number): Bot => ({ id: 'bot-' + index, name: '助手-' + index, duty: '整理资料', archived: index === 0 })

test('20th child succeeds and every creation path rejects over-limit batches without mutating the library', () => {
  const old = { ...defaultLibrary, bots: Array.from({ length: 19 }, (_, i) => bot(i)) }
  const full = updateLibrary(old, { ...old, bots: [...old.bots, bot(19)] })
  assert.equal(full.bots.length, 20)
  assert.equal(new Set(full.bots.map(item => item.avatar)).size, 20)
  assert.throws(() => updateLibrary(full, { ...full, bots: [...full.bots, bot(20)] }), /剩余 0 个名额/)
  const user = '请创建两个助手'
  let id = 0
  assert.throws(() => createRequestedBots(old, [
    { name: '新甲', duty: '审核', evidence: user }, { name: '新乙', duty: '核查', evidence: user },
  ], user, () => 'new-' + id++), /剩余 1 个名额/)
  assert.throws(() => validateGroupMembers({
    title: '小组', topic: '核查', members: [], newBots: [{ name: '新甲', id: 'new', duty: '审核' }], sessionId: 'group', runTask: false,
  }, full), /剩余 0 个名额/)
  assert.equal(old.bots.length, 19)
  assert.ok(old.bots.every(item => !item.avatar))
})

test('older libraries over 20 remain editable and persisted avatars are stable', () => {
  const old = { ...defaultLibrary, bots: Array.from({ length: 23 }, (_, i) => bot(i)) }
  const migrated = updateLibrary(old, old)
  assert.equal(migrated.bots.length, 23)
  assert.equal(new Set(migrated.bots.map(item => item.avatar)).size, 20)
  const copy = JSON.parse(JSON.stringify(migrated))
  assert.deepEqual(updateLibrary(copy, copy), migrated)
  assert.throws(() => updateLibrary(migrated, { ...migrated, bots: [...migrated.bots.slice(0, 20), bot(24)] }), /剩余 0/)
  const first = fillAvatars([{ avatar: botAvatars[0] }, {}], () => 0)
  assert.deepEqual(first.map(item => item.avatar), [botAvatars[0], botAvatars[1]])
})
