import { z } from 'zod'
import { coordinatorId, coordinatorName, type Group, type Row } from './bots.ts'

const requestKind = z.enum(['locate', 'inspect', 'send', 'task'])
export const groupRequestSchema = z.object({
  kind: requestKind,
  target: z.string(),
  workspace: z.string().optional(),
  body: z.string().optional(),
})
export type ExistingGroupRequest = z.infer<typeof groupRequestSchema>
export const groupChoiceSchema = z.object({
  requestId: z.string(),
  request: groupRequestSchema,
  candidates: z.array(z.string()),
})
export const groupDeliverySchema = z.object({
  requestId: z.string(),
  receiptId: z.string(),
  targetId: z.string(),
  kind: z.enum(['send', 'task']),
  body: z.string().min(1),
})
export type GroupDelivery = z.infer<typeof groupDeliverySchema>
export interface ExistingGroup {
  id: string
  title: string
  workspaceId: string
  workspace: string
  path: string
}

const quotePattern = /「([^」]*)」|『([^』]*)』|“([^”]*)”|"([^"]*)"/gu
const tokenPattern = /\u0000(\d+)\u0000/gu
const tokenOnly = /^\u0000(\d+)\u0000$/u
const polite = '(?:(?:请|麻烦|帮我|请你)\\s*)*'
const send = '(?:发(?:送)?(?:一句(?:话)?|一?条(?:消息|通知)?|消息|通知)|发送|说(?:一句|一声))'

export function parseExistingGroupRequest(original: string): ExistingGroupRequest | undefined {
  if (original.includes('\0')) return
  const quoted: { raw: string; text: string }[] = []
  const mask = original.trim().replace(quotePattern, (raw, a, b, c, d) => {
    return '\0' + (quoted.push({ raw, text: a ?? b ?? c ?? d }) - 1) + '\0'
  })
  const restore = (part: string) => part.replace(tokenPattern, (_, i) => quoted[Number(i)].raw)
  const unwrap = (part: string) => {
    const token = tokenOnly.exec(part)
    return token ? quoted[Number(token[1])].text : restore(part)
  }
  const make = (kind: ExistingGroupRequest['kind'], rawTarget: string, rawBody?: string): ExistingGroupRequest | undefined => {
    const selected = rawTarget.trim().replace(/[，,]\s*$/u, '')
    const location = /^工作区\s*(.+?)\s*的\s*(.+)$/su.exec(selected)
      ?? /^(.+?)\s*工作区的\s*(.+)$/su.exec(selected)
    const target = (location?.[2] ?? selected).trim()
    const titled = /^(\u0000\d+\u0000)\s*(?:这个群|群聊|群)?(?:里|里面|中|的成员)?$/u.exec(target)
    const name = unwrap(titled?.[1] ?? target).trim()
    if (!name || name.length > 150 || /[\r\n。？！?!]/u.test(name)) return
    const part = rawBody?.trim().replace(/^[：:]\s*/u, '')
    if (part && !tokenOnly.test(part) && /(?:会怎样|会怎么样|可以吗|行吗|能吗|有什么影响)[？?。]*$/u.test(part)) return
    const body = part === undefined ? undefined : unwrap(part)
    return { kind, target: name, ...(location ? { workspace: unwrap(location[1].trim()) } : {}), ...(body ? { body } : {}) }
  }
  const message = new RegExp('^' + polite + '(?:在|往|向|给)\\s*(.+?)\\s*' + send + '\\s*(.*)$', 'su').exec(mask)
  if (message) return make('send', message[1], message[2])
  const follow = /^(?:就发|发这句|正文\s*[:：])\s*(\u0000\d+\u0000)\s*$/u.exec(mask)
  if (follow) return make('send', '这个群', follow[1])
  const task = new RegExp('^' + polite + '(?:让|交给)\\s*(.+?)\\s*(?:讨论|分析|研究|处理|完成)(?:一下)?\\s*(.+)$', 'su').exec(mask)
  if (task) return make('task', task[1], task[2])
  const joined = /^(?:你|KingBot)\s*(?:进(?:入)?|加入|在)\s*(.+?)\s*(?:了吗|了么|吗|没有)[？?]?(?:[，,。；;]\s*(.*))?$/isu.exec(mask)
  if (joined) {
    const message = new RegExp('^' + polite + send + '\\s*(.*)$', 'su').exec(joined[2] ?? '')
    return make(message ? 'send' : 'locate', joined[1], message?.[1])
  }
  const progress = new RegExp('^' + polite + '(?:看(?:一)?下|查看|查(?:一)?下|看看|告诉我)\\s*(.+?)\\s*(?:聊到哪(?:里|儿)?了?|(?:的)?(?:讨论进度|进展|进度|最新(?:发言|消息|结论)|讨论结果))\\s*[了。？！?]*$', 'su').exec(mask)
  if (progress) return make('inspect', progress[1])
  const locate = new RegExp('^' + polite + '(?:查找|找(?:一)?下|找找|打开)\\s*(.+?)(?:群聊|群)\\s*[。！!]?$', 'su').exec(mask)
  if (locate) return make('locate', locate[1] + '群')
  const titledLocate = new RegExp('^' + polite + '(?:查找|找(?:一)?下|找找|打开)\\s*(\\u0000\\d+\\u0000)\\s*[。！!]?$','u').exec(mask)
  if (titledLocate) return make('locate', titledLocate[1])
}

export const groupTitle = (name: string) => name.normalize('NFKC').trim().replace(/^群聊\s*[·•・]\s*/u, '')
const comparable = (name: string) => groupTitle(name).toLocaleLowerCase()
export const isGroupReference = (name: string) => /^(?:这个群(?:聊)?|该群(?:聊)?|这群)$/u.test(name)

export function matchingGroups(groups: ExistingGroup[], request: ExistingGroupRequest): ExistingGroup[] {
  const name = comparable(request.target)
  const scope = request.workspace ? workspaceMatches(groups, request.workspace) : groups
  const exact = scope.filter(group => comparable(group.title) === name)
  if (exact.length) return exact
  return scope.filter(group => comparable(group.title) === name.replace(/群(?:聊)?$/u, ''))
}

export function workspaceMatches(groups: ExistingGroup[], raw: string): ExistingGroup[] {
  const value = raw.normalize('NFKC').trim().replace(/^(?:在\s*)?(?:工作区\s*[:：]?\s*)?|[。！!]$/gu, '').trim()
  const unquote = (name: string) => name.replace(/^[「『“"]|[」』”"]$/gu, '').trim()
  const variants = new Set([unquote(value), unquote(value.replace(/工作区$/u, ''))])
  return groups.filter(group => variants.has(group.workspace.normalize('NFKC')) || variants.has(group.path.normalize('NFKC')))
}

export function deliveryRowId(requestId: string) { return 'existing-group:' + requestId }
export function queuedGroupTask(taskId: string) { return taskId.startsWith('existing-group:') }

function shortText(text: string, limit: number) {
  const paragraphs = text.trim().split(/\n\s*\n/u)
  const first = paragraphs[0] ?? ''
  if (first.length > limit) return first.slice(0, limit) + '…'
  return first + (paragraphs.length > 1 ? '…' : '')
}

export function groupProgress(group: Group): string {
  const task = group.tasks?.find(item => item.id === group.activeTaskId)
  const latest = group.rows.findLast((row): row is Extract<Row, { author: 'bot' }> =>
    row.author === 'bot' && row.status === 'done' && !!row.resultKind && (!task || row.taskId === task.id))
  const rows = group.rows.filter(row => (!task || row.id === task.runId || row.author === 'bot' && row.taskId === task.id)
    && (row.author === 'user' && !row.control || row.author === 'bot' && row.status === 'done' && (row.botId !== coordinatorId || row.literal)))
  const label = { ready: '待开始', running: '讨论中', paused: '已暂停', complete: '已汇总', ended: '已结束' }
  return [
    task ? `当前议题「${task.title}」 · ${label[task.status]}` : undefined,
    latest && `${latest.resultKind === 'final' ? '已有结论' : '阶段结果'}：${shortText(latest.text, 420)}`,
    ...(!latest ? rows.slice(-3).map(row =>
      `${row.author === 'user' ? '你' : row.author === 'bot' ? group.members.find(bot => bot.id === row.botId)?.name ?? '成员' : coordinatorName}：${shortText(row.text, 220)}`) : []),
  ].filter(Boolean).join('\n') || '这个群还没有可查看的发言或结论。'
}
