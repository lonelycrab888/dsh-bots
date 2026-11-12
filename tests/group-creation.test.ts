import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDiscussionStep } from '../src/discussion.ts'
import { describeGroupProposal, groupReply, proposeGroup, validateGroupMembers } from '../src/group-creation.ts'
import { fixtureLibrary } from './fixtures.ts'

const workspaces = [
  { id: 'a', title: '项目', path: '/work/a' },
  { id: 'b', title: '项目', path: '/work/b' },
]
const request = '请建群，让 @架构师 和一位合适的助手讨论这个任务'
const action = {
  title: '测试群',
  topic: '比较两个方案并给出结论',
  memberIds: ['architect'],
  newBots: [{ name: '资料/整理助手', duty: '补充缺少的资料' }],
  runTask: true,
  evidence: request,
}

test('group proposals require a workspace choice and keep suggested Bots separate until confirmation', () => {
  const library = structuredClone(fixtureLibrary)
  let id = 0
  const proposal = proposeGroup(action, request, library, workspaces, () => String(++id), false)
  assert.equal(proposal.workspaceId, undefined)
  assert.equal(library.bots.length, fixtureLibrary.bots.length)
  assert.match(describeGroupProposal(proposal, workspaces), /建议新建 资料-整理助手/)
  assert.doesNotMatch(describeGroupProposal(proposal, workspaces), /请回复「确认建群」/)
  assert.match(describeGroupProposal({ ...proposal, workspaceId: 'b' }, workspaces), /目标工作区：项目（\/work\/b）.*确认建群/s)
  assert.deepEqual(groupReply('工作区：/work/b'), { kind: 'workspace', name: '/work/b' })
  assert.deepEqual(groupReply('就按这个方案建群吧'), { kind: 'confirm' })
  assert.equal(groupReply('嗯'), undefined)
  const saved = validateGroupMembers(proposal, library)
  assert.equal(saved.added.length, 1)
  assert.equal(saved.ids[0], 'architect')
  assert.deepEqual(validateGroupMembers(proposal, saved.library).added, [])
})

test('group proposals reject unavailable or omitted members and a task with no discussion partner', () => {
  const library = structuredClone(fixtureLibrary)
  assert.throws(() => proposeGroup({ ...action, memberIds: ['absent'] }, request, library, workspaces, () => 'id', false), /不可用/)
  assert.throws(() => proposeGroup({ ...action, memberIds: ['reviewer'] }, request, library, workspaces, () => 'id', false), /遗漏/)
  assert.throws(() => proposeGroup({ ...action, newBots: [] }, request, library, workspaces, () => 'id', false), /至少需要两名/)
})

test('moderation admits one eligible speaker at a time and rejects premature closure', () => {
  assert.deepEqual(parseDiscussionStep('{"kind":"speak","botId":"reviewer","question":"你怎么看？"}', ['reviewer'], false),
    { kind: 'speak', botId: 'reviewer', question: '你怎么看？' })
  assert.throws(() => parseDiscussionStep('{"kind":"speak","botId":"architect","question":"继续"}', ['reviewer'], false), /允许发言/)
  assert.throws(() => parseDiscussionStep('{"kind":"close"}', ['reviewer'], false), /继续主持/)
  assert.deepEqual(parseDiscussionStep('{"kind":"close"}', [], true), { kind: 'close' })
})
