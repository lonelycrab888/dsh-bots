import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliveryRowId, groupProgress, matchingGroups, parseExistingGroupRequest, workspaceMatches } from '../src/existing-groups.ts'
import { projection } from '../src/projection.ts'
import { newTask } from '../src/tasks.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const directory = [
  { id: 'first', title: '群聊 · 功能测试', workspaceId: 'a', workspace: '默认工作区', path: '/tmp/a' },
  { id: 'second', title: '功能测试', workspaceId: 'b', workspace: '项目', path: '/tmp/b' },
]

test('existing group requests preserve literal text and distinguish inquiry, inspection, and delegation', () => {
  const quote = '  明天下午两点开会\n请带 **材料**。 '
  assert.deepEqual(parseExistingGroupRequest(`在『功能测试』发一句「${quote}」`), { kind: 'send', target: '功能测试', body: quote })
  assert.deepEqual(parseExistingGroupRequest('你进『功能测试』群了吗，帮我发一条'), { kind: 'send', target: '功能测试' })
  assert.deepEqual(parseExistingGroupRequest('看一下『群聊 · 功能测试』聊到哪了'), { kind: 'inspect', target: '群聊 · 功能测试' })
  assert.deepEqual(parseExistingGroupRequest('让这个群讨论排期，办完告诉我'), { kind: 'task', target: '这个群', body: '排期，办完告诉我' })
  assert.deepEqual(parseExistingGroupRequest('就发『原文？』'), { kind: 'send', target: '这个群', body: '原文？' })
  assert.deepEqual(parseExistingGroupRequest('帮我在工作区『项目』的『功能测试』发送通知：『按期上线』'), {
    kind: 'send', target: '功能测试', workspace: '项目', body: '按期上线',
  })
  for (const text of [
    '怎么在『功能测试』发一句『开会』？', '不要在『功能测试』发一句『开会』',
    '「在『功能测试』发一句『开会』」', '在『功能测试』发一句『开会』会怎样？',
  ]) assert.equal(parseExistingGroupRequest(text), undefined, text)
})

test('same-name groups stay ambiguous until workspace selection', () => {
  const request = parseExistingGroupRequest('你在『群聊 · 功能测试』里吗？')!
  assert.deepEqual(matchingGroups(directory, request).map(group => group.id), ['first', 'second'])
  assert.deepEqual(workspaceMatches(directory, '在「项目」工作区').map(group => group.id), ['second'])
  assert.deepEqual(workspaceMatches(directory, '工作区：/tmp/a').map(group => group.id), ['first'])
  assert.deepEqual(matchingGroups(directory, { ...request, target: '未知' }), [])
})

test('a duplicate delivery record is inert and queued tasks leave the active topic selected', () => {
  const event = (type: string, data: unknown, seq: number) => ({ type, data, seq, time: 0, ignorable: true }) as SessionEvent
  const king = { inherited: 0, group: { mode: 'king' as const, members: [], rows: [] } }
  const request = { requestId: 'rpc-1', receiptId: 'row:plan', targetId: 'target', kind: 'send', body: '发送原文' }
  const stored = projection.apply(king, event('plugin:dsh-bots/existing-group-delivery', request, 0))
  const replay = projection.apply(stored, event('plugin:dsh-bots/existing-group-delivery', { ...request, body: '覆盖' }, 1))
  assert.deepEqual(replay.groupDeliveries, [request])
  assert.equal(deliveryRowId(request.requestId), 'existing-group:rpc-1')
  const current = { ...newTask('first', '已有议题'), status: 'paused' as const }
  const next = newTask(deliveryRowId('rpc-2'), '新议题', 'king')
  const group = { inherited: 0, group: { members: [], rows: [], tasks: [current], activeTaskId: current.id } }
  const queued = projection.apply(group, event('plugin:dsh-bots/task', { task: next, active: false }, 0))
  assert.equal(queued.group?.activeTaskId, 'first')
  assert.equal(queued.group?.tasks?.[1].status, 'ready')
  assert.match(groupProgress(queued.group!), /已有议题.*已暂停/u)
})
