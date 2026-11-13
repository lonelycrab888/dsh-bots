import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupSmallTalkReply, moderatorReplyContext, followsCurrentDiscussion, resolveDiscussionIntent, explicitDiscussionPause, keepsDiscussionGoing, mayRedirectDiscussion, parseDiscussionIntent, parseDiscussionStep } from '../src/discussion.ts'
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
  assert.match(describeGroupProposal(proposal, workspaces), /新建 `资料-整理助手`.*放在哪个工作区/s)
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


test('explicit continuation bypasses classification and technical failures retain their own status', async () => {
  const fail = async () => { throw new Error('model timeout') }
  for (const text of [
    '可以，就按照你说的做',
    '@KingBot 整合当前调研专家的所有结果，继续组织大家按照开始时的议题讨论。',
    '@KingBot 继续组织大家基于现有结果按照开始时的议题讨论。',
  ]) {
    assert.ok(followsCurrentDiscussion(text))
    assert.deepEqual(await resolveDiscussionIntent(text, true, fail), { kind: 'continue' })
  }
  for (const text of ['先停一下', '换个新任务，继续讨论当前方案', '请解释“可以，就按照你说的做”的含义', '不要按照你说的做']) assert.equal(followsCurrentDiscussion(text), false)
  assert.deepEqual(await resolveDiscussionIntent('新的具体问题', true, fail), { kind: 'unavailable' })
  assert.deepEqual(await resolveDiscussionIntent('新的具体问题', true, async () => 'invalid json'), { kind: 'unavailable' })
  assert.deepEqual(await resolveDiscussionIntent('换个方向吧', true, async () => '{"kind":"clarify"}'), { kind: 'clarify' })
  assert.deepEqual(await resolveDiscussionIntent('可以，就按照你说的做', false, fail), { kind: 'unavailable' })
})


test('long moderator summaries retain their final proposed next step', () => {
  const suggestion = '下一步先写立项书初稿，可以吗？'
  const text = '已确认研究范围。' + '详细调研依据。'.repeat(2000) + suggestion
  const context = moderatorReplyContext(text)
  assert.ok(context.startsWith('已确认研究范围。'))
  assert.ok(context.endsWith(suggestion))
  assert.ok(context.length < text.length)
  assert.equal(moderatorReplyContext(suggestion), suggestion)
})


test('group greetings and thanks reply directly, while tasks and member mentions keep normal routing',()=>{
 for(const text of ['你好','你好！','大家好','@KingBot 你好','谢谢','@主Bot 在吗？','Hi everyone!','你是谁']) assert.ok(groupSmallTalkReply(text),text)
 for(const text of ['你好，请帮我写初稿','谢谢，继续讨论','@调研专家 你好','@调研专家 @审阅员 你好','可以，就按你说的做','请解释“你好”的意思','hello world 程序怎么写','早期项目分析','好的，继续','好','可以']) assert.equal(groupSmallTalkReply(text),undefined,text)
})
