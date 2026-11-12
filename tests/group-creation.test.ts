import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explicitDiscussionPause, keepsDiscussionGoing, mayRedirectDiscussion, parseDiscussionIntent, parseDiscussionStep } from '../src/discussion.ts'
import { confirmationId, describeGroupChange, describeGroupProposal, groupReply, isGroupRevision, proposeGroup, validateGroupMembers } from '../src/group-creation.ts'
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
  const proposal = proposeGroup(action, request, library, workspaces, () => String(++id))
  assert.equal(proposal.workspaceId, undefined)
  assert.equal(library.bots.length, fixtureLibrary.bots.length)
  assert.match(describeGroupProposal(proposal, workspaces), /新建 资料-整理助手.*放在哪个工作区/s)
  assert.match(describeGroupProposal({ ...proposal, workspaceId: 'b' }, workspaces), /在「项目（\/work\/b）」.*可以这样建吗/s)
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
  assert.throws(() => proposeGroup({ ...action, memberIds: ['absent'] }, request, library, workspaces, () => 'id'), /不可用/)
  assert.throws(() => proposeGroup({ ...action, memberIds: ['reviewer'] }, request, library, workspaces, () => 'id'), /遗漏/)
  assert.throws(() => proposeGroup({ ...action, newBots: [] }, request, library, workspaces, () => 'id'), /至少需要两名/)
  const exact = '请建群，唯一成员是 @架构师'
  assert.throws(() => proposeGroup({ ...action, evidence: exact }, exact, library, workspaces, () => 'id'), /限定了群成员/)
})

test('ambiguous workspace names require a choice and revisions invalidate the prior confirmation', () => {
  const library = structuredClone(fixtureLibrary)
  let id = 0
  const nextId = () => String(++id)
  const ambiguous = '请在项目建群'
  const first = proposeGroup({ ...action, workspaceId: 'a', evidence: ambiguous }, ambiguous, library, workspaces, nextId)
  assert.equal(first.workspaceId, undefined)
  const precise = '请在 /work/b 建群'
  const selected = proposeGroup({ ...action, workspaceId: 'a', evidence: precise }, precise, library, workspaces, nextId)
  assert.equal(selected.workspaceId, 'b')
  const change = '把资料整理助手换成审阅员'
  assert.ok(isGroupRevision(change))
  const revised = proposeGroup({ ...action, topic: change, memberIds: ['architect', 'reviewer'], newBots: [], evidence: change }, change, library, workspaces, nextId, selected)
  assert.equal(revised.workspaceId, 'b')
  assert.equal(revised.topic, selected.topic)
  assert.notEqual(confirmationId(revised), confirmationId(selected))
  assert.match(describeGroupChange(revised, selected, workspaces), /加入 审阅员.*移除 资料-整理助手/)
  assert.deepEqual(groupReply('好，就这么建。'), { kind: 'confirm' })
  assert.deepEqual(groupReply('先不建了'), { kind: 'cancel' })
  assert.equal(groupReply('按这个来', false), undefined)
  for (const text of ['“就这么建”是什么意思', '别按这个方案建群', '如果确认建群会怎样']) assert.equal(groupReply(text), undefined)
})

test('discussion controls distinguish a direct pause from resuming and quoting one', () => {
  assert.ok(explicitDiscussionPause('这块先放一放。'))
  assert.ok(keepsDiscussionGoing('别停，继续说'))
  assert.equal(mayRedirectDiscussion('别停，继续说'), false)
  assert.equal(mayRedirectDiscussion('请解释“停止讨论”的含义'), false)
  assert.equal(explicitDiscussionPause('请解释“停止讨论”的含义'), false)
  assert.ok(mayRedirectDiscussion('换个方向吧'))
  assert.deepEqual(parseDiscussionIntent('{"kind":"clarify"}', '换个方向吧'), { kind: 'clarify' })
  assert.throws(() => parseDiscussionIntent('{"kind":"redirect","task":"自己编的任务"}', '换个方向吧'), /无法判断/)
})

test('moderation admits one eligible speaker at a time and rejects premature closure', () => {
  assert.deepEqual(parseDiscussionStep('{"kind":"speak","botId":"reviewer","question":"你怎么看？"}', ['reviewer'], false),
    { kind: 'speak', botId: 'reviewer', question: '你怎么看？' })
  assert.throws(() => parseDiscussionStep('{"kind":"speak","botId":"architect","question":"继续"}', ['reviewer'], false), /允许发言/)
  assert.throws(() => parseDiscussionStep('{"kind":"close"}', ['reviewer'], false), /继续主持/)
  assert.deepEqual(parseDiscussionStep('{"kind":"close"}', [], true), { kind: 'close' })
})
