import { excerpt } from './group-context.ts'
import { z } from 'zod'
import type { Group, Row } from './bots.ts'
import { continuesDiscussion, coordinatorMessage, followsCurrentDiscussion } from './discussion.ts'

export const taskActions = ['resume', 'summarize', 'finish'] as const
export type TaskAction = typeof taskActions[number]
export const taskActionLabel: Record<TaskAction, string> = {
  resume: '继续讨论',
  summarize: '汇总已有结果',
  finish: '结束任务',
}

export const taskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  title: z.string(),
  status: z.enum(['ready', 'running', 'paused', 'complete', 'ended']),
  createdAt: z.number(),
  updatedAt: z.number(),
  revision: z.number().int(),
  runId: z.string().optional(),
  origin: z.string().optional(),
  returnOrigins: z.array(z.string()).optional(),
  userPriority: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
  question: z.object({ rowId: z.string(), botId: z.string(), text: z.string() }).optional(),
  sourceRows: z.array(z.string()),
  attempts: z.array(z.object({ rowId: z.string(), botId: z.string(), name: z.string(), question: z.string() })),
  operations: z.array(z.object({ id: z.string(), rowId: z.string(), bot: z.string(), tool: z.string(), target: z.string().optional() })),
  verifiedOperations: z.array(z.object({ bot: z.string(), tool: z.string(), target: z.string().optional() })).optional(),
})
export type DiscussionTask = z.infer<typeof taskSchema>
export type TaskOperation = DiscussionTask['operations'][number]

export function newTask(id: string, goal: string, origin?: string, title?: string): DiscussionTask {
  const cleaned = goal.replace(/(?:^|\s)@[\p{L}\p{N}_-]+/gu, '').trim().replace(/\s+/gu, ' ')
  return {
    id, goal, title: title ?? Array.from(cleaned).slice(0, 38).join(''),
    status: 'ready', createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
    ...(origin ? { origin } : {}), sourceRows: [], attempts: [], operations: [],
  }
}

export function taskControl(text: string): { action: TaskAction; query: string; verified?: boolean } | undefined {
  const value = coordinatorMessage(text).replace(/[。.!！]+$/u, '')
  const checked = /^(?:已核对|已确认操作结果|结果已核对)[，,。\s]*(?:请)?继续(?:讨论|任务)?\s*(.*)$/u.exec(value)
  if (checked) return { action: 'resume', query: checked[1], verified: true }
  const summary = /^(?:请)?(?:汇总已有结果|总结现有结果|先汇总|总结当前进展|summarize progress)(?:[，,:：\s]*(.*))?$/iu.exec(value)
  if (summary) return { action: 'summarize', query: summary[1] ?? '' }
  const finish = /^(?:请)?(?:结束(?:这个|当前|本轮)?任务|到这里就结束任务|end (?:the )?task)(?:[，,:：\s]*(.*))?$/iu.exec(value)
  if (finish) return { action: 'finish', query: finish[1] ?? '' }
  const resume = /^(?:请)?(?:继续(?:讨论|推进|处理)?|接着讨论|恢复讨论|resume)(?:[，,:：\s]*(.*))?$/iu.exec(value)
  if (resume && continuesDiscussion(value, true) && !/^(?:分析|核对|读取|检查|解释|说|讲)/u.test(resume[1] ?? '')) return { action: 'resume', query: resume[1] ?? '' }
}

function grams(text: string): Set<string> {
  const clean = text.normalize('NFKC').toLowerCase()
    .replace(/(?:昨天的?|前天的?|今天的?|之前的?|刚才的?|上一轮|这个|本轮|当前|讨论|任务|方案|继续|请|the |yesterday)/gu, '')
  const found = new Set<string>()
  for (const match of clean.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0]
    if (/\p{Script=Han}/u.test(word)) {
      let previous = ''
      for (const character of word) {
        if (previous) found.add(previous + character)
        previous = character
        if (found.size >= 4096) break
      }
    } else found.add(word.slice(0, 128))
    if (found.size >= 4096) break
  }
  return found
}

export function findTask(group: Group, text: string, explicit = false): DiscussionTask | 'ambiguous' | undefined {
  const tasks = (group.tasks ?? []).filter(task => task.status !== 'ended')
  if (!tasks.length) return
  const active = tasks.find(task => task.id === group.activeTaskId)
  const query = text.trim().replace(/^(?:@[\p{L}\p{N}_-]+[\s，,:：]+)+/u, '')
  if (!query) {
    if (!explicit) return
    if (active) return active
    const unfinished = tasks.filter(task => task.status !== 'complete')
    if (unfinished.length === 1) return unfinished[0]
    if (unfinished.length > 1 || tasks.length > 1) return 'ambiguous'
    return tasks[0]
  }
  const exact = tasks.find(task => task.id === query || task.title === query || task.goal === query)
  if (exact) return exact
  if (active && (followsCurrentDiscussion(query) || explicit && /^(?:组织|推进|处理)[\s\S]*(?:当前|现有结果|开始时|原议题)/u.test(query))) return active
  const older = /昨天|前天|yesterday/iu.test(query)
  const previous = /刚才|上一轮|前一轮|本轮|当前|这个|this discussion/iu.test(query)
  const correction = /^(?:请)?(?:更正|纠正|补充约束|确认(?:决定|采用)|我确认)/u.test(query)
  if (!explicit && !older && !correction && !continuesDiscussion(query, false) && !/^(?:请)?继续/u.test(query)) return
  const tokens = grams(query)
  const matches = tasks.map(task => {
    const title = grams(task.title)
    const body = grams(task.goal)
    const score = [...tokens].reduce((total, token) => total + (title.has(token) ? 3 : body.has(token) ? 1 : 0), 0)
    return { task, score }
  }).filter(item => item.score >= 3).sort((a, b) => b.score - a.score)
  if (matches.length && matches[0].score > (matches[1]?.score ?? 0)) return matches[0].task
  if (matches.length) return 'ambiguous'
  if (previous || !explicit && !older) return active
  if (older) {
    const days = /前天/u.test(query) ? 2 : 1
    const day = new Date()
    day.setDate(day.getDate() - days)
    const candidates = tasks.filter(task => new Date(task.createdAt).toDateString() === day.toDateString())
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) return 'ambiguous'
  }
  const unfinished = tasks.filter(task => task.status !== 'complete')
  if (explicit && !older && unfinished.length === 1 && /^(?:按|注意|优先|限制|只|先|改用|但|不|请)/u.test(query)) return unfinished[0]
  return explicit ? 'ambiguous' : undefined
}

export function taskRows(task: DiscussionTask, rows: readonly Row[]): Row[] {
  const sources = new Set([...task.sourceRows, ...task.attempts.map(attempt => attempt.rowId)])
  return rows.filter(row => sources.has(row.id) || row.author === 'bot' && row.taskId === task.id && row.status === 'done')
}

export function taskDigest(task: DiscussionTask, rows: readonly Row[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const completed = task.attempts.flatMap(attempt => {
    const row = byId.get(attempt.rowId)
    return row?.author === 'bot' && row.status === 'done' ? [{ ...attempt, text: row.text }] : []
  })
  // Before v0.4, the verification gate saved corrections only on the timeline.
  // Recover those exact rejected messages when the preceding task row identifies their owner.
  const sources = new Set(task.sourceRows)
  let owner: string | undefined
  for (const row of rows) {
    if (sources.has(row.id)) owner = task.id
    if (row.author === 'bot' && row.taskId) owner = row.taskId
    if (owner !== task.id || row.author !== 'user') continue
    const reply = byId.get(`${row.id}:verify`)
    if (reply?.author === 'bot' && reply.text.startsWith('还有操作结果待核对。')) sources.add(row.id)
  }
  const user = rows.filter(row => sources.has(row.id)).flatMap(row => {
    return row.author === 'user' ? [row] : []
  })
  const pending = task.attempts.filter(attempt => !completed.some(item => item.rowId === attempt.rowId))
  const result = rows.findLast((row): row is Extract<Row, { author: 'bot' }> =>
    row.author === 'bot' && row.taskId === task.id && !!row.resultKind && row.status === 'done')
  const constraints = user.filter(row => /约束|限制|只(?:能|用|考虑|比较)|必须|不要|不得|上限|至少|最多|预算|不能|limit|only|must/iu.test(row.text))
  const decisions = user.filter(row => /确认|更正|纠正|最终采用|决定|agree|correct/iu.test(row.text))
  const questions = pending.map(item => item.question)
  const open = result?.text.match(/(?:^|\n)(?:#+\s*)?(?:待解决问题|仍待确认|待确认问题)[:：\s]*([^#]+)$/u)?.[1]?.trim()
  if (open) questions.push(open)

  return {
    completed, user, pending, result, constraints, decisions, questions,
    documents: user.flatMap(row => row.documents ?? []),
  }
}

export function modelTopic(task: DiscussionTask, rows: readonly Row[]): string {
  const digest = taskDigest(task, rows)
  return JSON.stringify({
    原始目标: excerpt(task.goal, 1000), 原始消息: task.sourceRows[0] ?? task.id,
    最近用户要求: digest.user.slice(-6).map(row => ({ 原文: excerpt(row.text, 500), 来源: row.id })),
    约束: digest.constraints.slice(-8).map(row => ({ 原文: excerpt(row.text, 300), 来源: row.id })),
    用户确认和更正: digest.decisions.slice(-8).map(row => ({ 原文: excerpt(row.text, 300), 来源: row.id })),
    已保存汇总: digest.result && { 原文: excerpt(digest.result.text, 1000), 来源: digest.result.id },
    待解决问题: digest.questions.slice(-6),
    待用户回答: task.question?.text,
    附件: digest.documents.map(file => file.attachment.name),
    待核对操作: task.operations.map(({ bot, tool, target }) => ({ bot, tool, target })),
    用户已核对的操作勿重复执行: task.verifiedOperations,
  })
}

export function resultRowId(taskId: string, resultId: string) {
  return `${taskId}:returned:${resultId}`
}

const readOnlyTools = new Set(['read', 'read_image', 'glob', 'grep', 'ls', 'skill', 'web_search', 'web_fetch', 'read_uploaded_document', 'read_group_history'])
export function operationMayChangeState(name: string) {
  return !readOnlyTools.has(name)
}

/** Older versions could retain read-only tool calls after interruption. */
export function unresolvedOperations(task: DiscussionTask) {
  return task.operations.filter(operation => operationMayChangeState(operation.tool))
}

export function verifiedOperation({ bot, tool, target }: TaskOperation) {
  return { bot, tool, ...(target !== undefined ? { target } : {}) }
}
