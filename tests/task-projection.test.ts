import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newTask, taskDigest } from '../src/tasks.ts'
import { projection } from '../src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const pluginEvent = (type: string, data: unknown, seq: number) => ({ type, data, seq, time: 0, ignorable: true }) as SessionEvent

test('task checkpoints can replay independently of unrelated group rows', () => {
  const task = newTask('task', '样本量上限 50', 'king')
  task.sourceRows = ['request']
  task.attempts = [{ rowId: 'response', botId: 'architect', name: '架构师', question: '估计样本量' }]
  task.status = 'paused'
  const group = {
    inherited: 0,
    group: { members: [], rows: [] },
  }
  const saved = projection.apply(group, pluginEvent('plugin:dsh-bots/task', { task, active: true }, 0))
  const rebuilt = projection.apply(saved, pluginEvent('plugin:dsh-bots/rows', [
    { id: 'request', author: 'user', text: '样本量上限 50' },
    { id: 'response', author: 'bot', botId: 'architect', text: '50 可行', status: 'done', taskId: 'task' },
  ], 1))
  assert.equal(rebuilt.group?.activeTaskId, 'task')
  assert.equal(rebuilt.group?.tasks?.[0].origin, 'king')
  assert.equal(taskDigest(rebuilt.group!.tasks![0], rebuilt.group!.rows).completed[0].text, '50 可行')
})

test('native Bot identity and model reasoning survive projection replay and wire transport', () => {
  const state = projection.apply({inherited:0,group:null}, pluginEvent('plugin:dsh-bots/bot',{botId:'architect'},0))
  assert.equal(state.group?.mode,'bot')
  assert.equal(state.group?.botId,'architect')
  const group = {inherited:0,group:{members:[],rows:[]}}
  const saved = projection.apply(group,pluginEvent('plugin:dsh-bots/rows',[{id:'r',author:'bot',botId:'architect',status:'done',text:'Answer',reasoning:'Model reasoning'}],1))
  const row = saved.group?.rows[0]
  assert.ok(row?.author==='bot')
  assert.equal(row.reasoning,'Model reasoning')
})
