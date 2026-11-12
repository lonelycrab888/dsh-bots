import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newTask, findTask, modelTopic, resultRowId, taskControl, taskDigest, taskRows, operationMayChangeState } from '../src/tasks.ts'
import type { Group, Row } from '../src/bots.ts'
import type { FileBlock } from '@deepseek-ai/dsh-llm'

test('named old topic keeps its latest correction and attachment source beyond recent unrelated rows', () => {
  const sample = newTask('a', '样本量计算，先按上限 60 人设计', undefined, '样本量方案')
  const layout = newTask('b', '选择目录展示布局', undefined, '界面布局')
  const document = { type: 'file', attachment: { name: '样本.csv', attachmentId: 'sha256:' + 'a'.repeat(64), bytes: 10 } } as FileBlock
  const rows: Row[] = [
    { id: 'first', author: 'user', text: '样本量计算，预算限制 60 人', documents: [document] },
    { id: 'second', author: 'user', text: '更正：我确认样本量上限改为 50 人' },
    ...Array.from({ length: 18 }, (_, i): Row => ({ id: 'other-' + i, author: 'user', text: '设计界面' })),
  ]
  sample.sourceRows.push('first', 'second')
  layout.sourceRows.push('other-0')
  const group: Group = { members: [], rows, tasks: [sample, layout], activeTaskId: 'b' }
  assert.equal(findTask(group, '昨天的样本量方案', true), sample)
  assert.equal(findTask(group, '做一个离线存储方案'), undefined)
  assert.equal(findTask(group, '', true), 'ambiguous')
  assert.deepEqual(taskRows(sample, rows).map(row => row.id), ['first', 'second'])
  assert.equal(taskDigest(sample, rows).documents[0], document)
  assert.match(modelTopic(sample, rows), /上限改为 50 人/)
  assert.doesNotMatch(modelTopic(sample, rows), /设计界面/)
  assert.equal(findTask({ members: [], rows: [], tasks: [] }, '昨天的样本量方案', true), undefined)
})

test('recovery derives completed work and outstanding attempts from the same saved rows', () => {
  const task = newTask('a', '分析两个方案', 'king')
  task.attempts.push({ rowId: 'one', botId: 'a', name: '甲', question: '比较预算' }, { rowId: 'two', botId: 'b', name: '乙', question: '补充风险' })
  task.operations.push({ id: 'operation', rowId: 'two', bot: '乙', tool: 'write', target: 'report.md' })
  const rows: Row[] = [
    { id: 'one', author: 'bot', botId: 'a', status: 'done', text: '预算 100 元' },
    { id: 'two', author: 'bot', botId: 'b', status: 'working', text: '正在写入' },
    { id: 'result', author: 'bot', botId: 'coordinator', status: 'done', taskId: 'a', resultKind: 'partial', text: '现有证据' },
  ]
  const digest = taskDigest(task, rows)
  assert.deepEqual(digest.completed.map(row => row.rowId), ['one'])
  assert.deepEqual(digest.questions, ['补充风险'])
  assert.equal(digest.result?.id, 'result')
  assert.equal(resultRowId(task.id, 'result'), resultRowId(task.id, 'result'))
  assert.notEqual(resultRowId(task.id, 'result'), resultRowId(task.id, 'final'))
  assert.equal(operationMayChangeState('write'), true)
  assert.equal(operationMayChangeState('bash'), true)
  assert.equal(operationMayChangeState('read'), false)
  assert.deepEqual(taskControl('已核对，继续'), { action: 'resume', query: '', verified: true })
  assert.deepEqual(taskControl('汇总已有结果'), { action: 'summarize', query: '' })
  assert.deepEqual(taskControl('结束任务'), { action: 'finish', query: '' })
})
