import { fixtureLibrary } from './fixtures.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/config.ts'
import { defaultLibrary, discussionTopic, freshCoordinator, parsePlan, resolveTargets, selectMembers, validateLibrary } from '../src/bots.ts'
import { projection } from '../src/projection.ts'

test('catalog validates identity, duties, reserved names, normalized duplicates and integer limits', () => {
  const valid = validateLibrary(fixtureLibrary)
  assert.equal(valid.maxMembers, 4)
  for (const maxMembers of [0, 13, 1.5, NaN]) assert.throws(() => validateLibrary({ ...valid, maxMembers }))
  for (const name of ['', '主Bot', '主bot', 'a b', '@测试']) assert.throws(() => validateLibrary({ ...valid, bots: [{ ...valid.bots[0], name }] }))
  assert.throws(() => validateLibrary({ ...valid, bots: [valid.bots[0], { ...valid.bots[1], name: valid.bots[0].name }] }))
  assert.throws(() => validateLibrary({ ...valid, bots: [{ ...valid.bots[0], duty: '   ' }] }))
  assert.throws(() => validateLibrary({ ...valid, bots: [valid.bots[0], { ...valid.bots[1], id: valid.bots[0].id }] }))
})
test('volatile host config seeds defaults and rejects invalid writes before persistence', () => {
  const config = Config({})
  assert.deepEqual(config.library.get(), defaultLibrary)
  const custom = { ...defaultLibrary, maxMembers: 2, bots: [...defaultLibrary.bots, { id: 'custom', name: '测试专家', duty: '验收', archived: false }] }
  assert.deepEqual(Config({ library: custom }).library.get(), custom)
  assert.throws(() => Config({ library: { ...custom, maxMembers: 13 } }))
  assert.throws(() => Config({ library: { ...custom, bots: [...custom.bots, custom.bots[0]] } }))
})
test('member selection enforces current limit and archive state, snapshots mutable definitions', () => {
  const library = structuredClone(fixtureLibrary)
  library.maxMembers = 1
  assert.throws(() => selectMembers(['architect', 'reviewer'], library, [], () => 'id'))
  library.bots[0].archived = true
  assert.throws(() => selectMembers(['architect'], library, [], () => 'id'))
  const selected = selectMembers(['reviewer'], library, [], () => 'saved')
  library.bots[1].name = '新名称'
  assert.equal(selected[0].name, '审阅员')
  assert.equal(selectMembers(['reviewer'], library, selected, () => 'new')[0].sessionId, 'saved')
})
const members = selectMembers(['architect', 'reviewer'], fixtureLibrary, [], () => 'id')
test('mention routing handles Chinese punctuation and rejects unknown members', () => {
  assert.deepEqual(resolveTargets('请设计一个方案', members), [])
  assert.deepEqual(resolveTargets('@主Bot 请派发', members), [])
  assert.deepEqual(resolveTargets('@架构师，@审阅员 请协作', members), members)
  assert.deepEqual(resolveTargets('请协作：@架构师；@审阅员 检查', members), members)
  assert.deepEqual(resolveTargets('联系 test@example.com', members), [])
  assert.deepEqual(resolveTargets('@reviewer @审阅员 检查', members), [members[1]])
  assert.deepEqual(resolveTargets('请看 @notes.txt @src/ @"review @owner notes.txt" @审阅员.', members), [members[1]])
  assert.deepEqual(resolveTargets('请看 @README 和 @架构师', members, name => name === 'README'), [members[0]])
  assert.throws(() => resolveTargets('@不存在 检查', members))
})
test('legacy discussion prefixes still accept plain topic text', () => {
  assert.equal(discussionTopic('讨论： @架构师 @审阅员 交换意见'), '@架构师 @审阅员 交换意见')
  assert.equal(discussionTopic('Discuss: compare the options\nthen review'), 'compare the options\nthen review')
  assert.equal(discussionTopic('讨论：  '), '')
  assert.equal(discussionTopic('请讨论：怎么选'), undefined)

})
test('plans cannot dispatch nonmembers, duplicate tasks or override explicit targets', () => {
  const plan = { tasks: [{ botId: 'reviewer', task: '检查' }] }
  assert.deepEqual(parsePlan(JSON.stringify(plan), members, [members[1]]), plan)
  assert.deepEqual(parsePlan('```json\n' + JSON.stringify(plan) + '\n```', members), plan)
  assert.throws(() => parsePlan(JSON.stringify(plan), members, [members[0]]))
  assert.throws(() => parsePlan('{"tasks":[{"botId":"outsider","task":"x"}]}', members))
  assert.throws(() => parsePlan(JSON.stringify({ tasks: [plan.tasks[0], plan.tasks[0]] }), members))
  assert.throws(() => parsePlan('{"tasks":[]}', members))
  assert.throws(() => parsePlan('not json', members))
  assert.deepEqual(parsePlan('{"reply":"你好"}', members), { tasks: [], reply: '你好' })
})
test('projection accepts custom member IDs and old state without a coordinator', () => {
  const old = { inherited: 0, group: { members, rows: [{ id: 'old', author: 'bot', botId: 'architect', text: '历史', status: 'done' }] } }
  assert.equal(projection.stateSchema.safeParse(old).success, true)
  const custom = structuredClone(old)
  custom.group.members[0].id = 'custom-id'
  custom.group.rows[0].botId = 'custom-id'
  assert.equal(projection.stateSchema.safeParse(custom).success, true)
})

test('renaming the coordinator retains the existing session and history boundary', () => {
  const existing = { id: 'coordinator', name: 'Bots King', duty: '旧职责', sessionId: 'saved', contextRevision: 3, contextWorkspace: '/bots', historyStart: 4 }
  const renamed = freshCoordinator(existing, 3, 15, () => assert.fail('A rename must not allocate a session'), '/bots')
  assert.equal(renamed.name, 'King Arthur')
  assert.equal(renamed.sessionId, existing.sessionId)
  assert.equal(renamed.historyStart, existing.historyStart)
  assert.deepEqual(resolveTargets('@King Arthur 请汇总', members), [])
  assert.deepEqual(resolveTargets('@king arthur，@审阅员 请检查', members), [members[1]])
  assert.deepEqual(resolveTargets('@KingBot 请汇总', members), [])
  assert.deepEqual(resolveTargets('（@King Arthur） @King Arthur.', members), [])
  assert.throws(()=>resolveTargets('@King ArthurX 请检查',members))
  const legacyChild = { ...members[0], name: 'KingBot' }
  assert.deepEqual(resolveTargets('@KingBot 请检查', [legacyChild]), [legacyChild])
  assert.equal(validateLibrary({ ...fixtureLibrary, bots: [{ ...fixtureLibrary.bots[0], name: 'KingBot' }] }).bots[0].name, 'KingBot')
})

test('native mention source filters by current group and preserves file-reference searches', async () => {
  const { groupMentionSource } = await import('../src/mention.ts')
  const source = groupMentionSource(id => id === 'group' ? { members: [members[0]], rows: [] }
    : id === 'king' ? { mode: 'king', members: [members[1]], rows: [] } : null, async () => fixtureLibrary)
  const request = { query: '架构', drilled: false, signal: new AbortController().signal }
  const [candidate] = await source.candidates({ sessionId: 'group' }, request)
  assert.deepEqual(candidate, { name: '架构师', section: '群聊成员' })
  assert.deepEqual(source.onPick({ candidate, action: 'pick' }), { text: '@架构师 ' })
  assert.deepEqual(await source.candidates({ sessionId: 'group' }, { ...request, query: '审阅' }), [])
  assert.deepEqual(await source.candidates({ sessionId: 'group' }, { ...request, quoted: true }), [])
  assert.deepEqual(await source.candidates({ sessionId: 'king' }, request), [])
  assert.deepEqual(await source.candidates({ sessionId: 'plain' }, request), [])
})

test('a custom display name takes precedence over a member ID alias', () => {
  const custom = { id: 'custom-reviewer', name: 'reviewer', duty: '自定义职责', sessionId: 'custom' }
  assert.deepEqual(resolveTargets('@reviewer 检查', [...members, custom]), [custom])
  assert.deepEqual(resolveTargets('@审阅员 检查', [...members, custom]), [members[1]])
})

test('fresh, partial and explicitly empty profiles have no child Bots or preloaded memories', () => {
  for (const input of [{}, { library: {} }, { library: { maxMembers: 8 } }, { library: { maxMembers: 4, bots: [] } }]) {
    const config = Config(input)
    assert.deepEqual(config.library.get().bots, [])
    assert.deepEqual(config.kingMemory.get().entries, [])
    assert.throws(() => selectMembers(['architect'], config.library.get(), [], () => 'id'))
    assert.throws(() => selectMembers(['reviewer'], config.library.get(), [], () => 'id'))
  }
  const custom = { ...defaultLibrary, bots: [{ id: 'bot-user-123', name: '用户创建', duty: '整理资料', archived: false }] }
  const restored = Config(JSON.parse(JSON.stringify({ library: custom })))
  assert.deepEqual(restored.library.get(), custom)
  assert.deepEqual(Config({ library: { ...custom, bots: [] } }).library.get().bots, [])
})

test('dispatch uses only current user-created member IDs and rejects remembered legacy IDs', () => {
  const custom = { ...defaultLibrary, bots: [{ id: 'bot-user-456', name: '自选成员', duty: '检查方案', archived: false }] }
  const current = selectMembers([custom.bots[0].id], custom, [], () => 'new-session')
  const plan = { tasks: [{ botId: current[0].id, task: '检查边界条件' }] }
  assert.deepEqual(parsePlan(JSON.stringify(plan), current), plan)
  for (const id of ['architect', 'reviewer', 'bot-from-another-group']) {
    assert.throws(() => parsePlan(JSON.stringify({ tasks: [{ botId: id, task: '旧编号任务' }] }), current))
  }
})


test('King Arthur preserves a structured existing-group operation and rejects mixed creation', () => {
  const action = { kind: 'send', target: '已有群', body: '验证通知' }
  assert.deepEqual(parsePlan(JSON.stringify({ existingGroupAction: action }), []).existingGroupAction, action)
  assert.throws(() => parsePlan(JSON.stringify({ existingGroupAction: action, groupAction: { title: '替代群' } }), []))
  assert.equal(parsePlan('{"reply":"你好","existingGroupAction":null}', []).existingGroupAction, undefined)
})
