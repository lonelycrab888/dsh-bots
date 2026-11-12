import { z } from 'zod'

export const coordinatorId = 'coordinator'
export const coordinatorName = 'KingBot'
export const legacyCoordinatorName = 'Bots King'
export const coordinatorDuty = '理解用户目标，按成员职责派发任务，汇总结果，并维护跨群聊的个人长期记忆。'
// New profiles start without child Bots. Existing libraries remain user-owned.
export const defaultLibrary: Library = { maxMembers: 4, bots: [], deletedBotIds: [] }
export const normalizeName = (name: string) => name.normalize('NFKC').toLocaleLowerCase()
export const isCoordinatorName = (name: string) => normalizeName(name.trim()) === normalizeName(coordinatorName)
export const botModelSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().trim().min(1).max(120).optional() })
export type BotModel = z.infer<typeof botModelSchema>
export function modelForBot(library: { readonly kingModel?: BotModel; readonly bots: readonly Readonly<Bot>[] }, id: string, fallback: BotModel & { reasoningEffort?: string }) {
  return (id === coordinatorId ? library.kingModel : library.bots.find(bot => bot.id === id)?.model) ?? fallback
}
const definition = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1, '请填写 Bot 名称').max(24, '名称最多 24 个字符')
    .regex(/^[\p{L}\p{N}_-]+$/u, '名称仅支持中英文、数字、下划线和连字符'),
  duty: z.string().trim().min(1, '请填写职责').max(6000, '职责最多 6000 个字符'),
  model: botModelSchema.optional(),
  archived: z.boolean().default(false),
})
export const librarySchema = z.object({
  kingModel: botModelSchema.optional(),
  maxMembers: z.number().int().min(1).max(12).default(4),
  deletedBotIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).default([]),
  bots: z.array(definition).max(100).default([]),
}).superRefine((value, ctx) => {
  // Older libraries could already contain a child named KingBot.
  const names = new Set([normalizeName(legacyCoordinatorName), normalizeName('主Bot')])
  const ids = new Set([coordinatorId, ...value.deletedBotIds])
  if (value.deletedBotIds.includes(coordinatorId) || new Set(value.deletedBotIds).size !== value.deletedBotIds.length) ctx.addIssue({ code: 'custom', message: '已删除 Bot 标识必须唯一，不能包含主 Bot。' })
  for (const bot of value.bots) {
    const name = normalizeName(bot.name)
    if (names.has(name) || ids.has(bot.id)) ctx.addIssue({ code: 'custom', message: 'Bot 名称和标识必须唯一，不能使用主 Bot 的保留名称或已删除的编号。' })
    names.add(name)
    ids.add(bot.id)
  }
})
export type Library = z.infer<typeof librarySchema>
export type Bot = Library['bots'][number]
export type BotId = string
export function validateLibrary(value: unknown): Library {
  const parsed = librarySchema.safeParse(value)
  if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join('；'))
  return parsed.data
}
export interface Member { id: BotId; name: string; duty: string; sessionId: string; contextWorkspace?: string; contextRevision?: number; historyStart?: number }
export type Row =
  | { id: string; author: 'user' | 'notice'; text: string }
  | { id: string; author: 'bot'; botId: BotId; text: string; status: 'working' | 'done' | 'error' | 'stopped'; phase?: 'discussion' }
export interface Group { sessionEpoch?:number; mode?: 'group' | 'king'; members: Member[]; coordinator?: Member; rows: Row[] }

/** An empty result asks the coordinator to select members. */
export function resolveTargets(text: string, members: readonly Member[]): Member[] {
  const tokens = Array.from(text.replace(/@Bots\s+King(?=$|[\s，。？！、,:：;；!?])/giu, '@主Bot').matchAll(/(?:^|[\s，。？！、,:：;；!?])@([\p{L}\p{N}_-]+)/gu), match => match[1])
  const result = new Set<Member>()
  for (const token of tokens) {
    const name = normalizeName(token)
    if (name === normalizeName('主Bot')) continue
    const namedMember = members.find(candidate => normalizeName(candidate.name) === name)
    if (!namedMember && isCoordinatorName(token)) continue
    const member = namedMember ?? members.find(candidate => candidate.id === token.toLowerCase())
    if (!member) throw new Error(`@${token} 不在当前群聊。请点名已加入的 Bot。`)
    result.add(member)
  }
  return [...result]
}

export function selectMembers(ids: string[], library: { readonly maxMembers: number; readonly bots: readonly Readonly<Bot>[] }, previous: Member[], uuid: () => string): Member[] {
  if (new Set(ids).size !== ids.length) throw new Error('请勿重复选择成员。')
  if (ids.length > library.maxMembers) throw new Error(`每个群聊最多选择 ${library.maxMembers} 名子 Bot。`)
  return ids.map(id => {
    const bot = library.bots.find(bot => bot.id === id && !bot.archived)
    if (!bot) throw new Error('所选 Bot 已停用或不存在，请重新选择。')
    return { id: bot.id, name: bot.name, duty: bot.duty, sessionId: previous.find(member => member.id === id)?.sessionId ?? uuid() }
  })
}
export interface Plan { tasks: { botId: string; task: string }[]; reply?: string; memoryActions?: unknown; botActions?: unknown }
export function discussionTopic(text: string): string | undefined {
  return /^\s*(?:讨论|discuss)\s*[:：]([\s\S]*)$/iu.exec(text)?.[1].trim()
}

export function parsePlan(output: string, members: Member[], required: Member[] = [], minTasks = 0): Plan {
  const source = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let input: unknown
  try { input = JSON.parse(source) } catch { throw new Error('KingBot 没有返回有效的任务分派 JSON。') }
  const plan = z.object({ tasks: z.array(z.object({ botId: z.string(), task: z.string().trim().min(1).max(6000) })).max(members.length), reply: z.string().max(12000).optional(), memoryActions: z.unknown().optional(), botActions: z.unknown().optional() }).parse(input)
  const ids = plan.tasks.map(task => task.botId)
  if (new Set(ids).size !== ids.length || ids.some(id => !members.some(member => member.id === id))) throw new Error('KingBot 分派了重复或未加入群聊的成员。')
  if (required.length && (required.some(member => !ids.includes(member.id)) || ids.some(id => !required.some(member => member.id === id)))) throw new Error('任务分派必须严格覆盖用户点名的成员。')
  if (ids.length < minTasks) throw new Error('讨论至少需要给两名子 Bot 分派任务。')
  if (!ids.length && !plan.reply?.trim()) throw new Error('KingBot 未提供任务或直接答复。')
  return plan
}

/** IDs are retired permanently; a recreated name must receive a fresh identity. */
export function deleteBot(library: Library, id: string): Library {
  if (id === coordinatorId || !library.bots.some(bot => bot.id === id)) throw new Error('该子 Bot 已不存在，请刷新配置。')
  return validateLibrary({ ...library, bots: library.bots.filter(bot => bot.id !== id), deletedBotIds: [...library.deletedBotIds, id] })
}

export function availableMembers(group: Group, library: Pick<Library, 'bots' | 'deletedBotIds'>): Member[] {
  return group.members.filter(member => library.bots.some(bot => bot.id === member.id) && !library.deletedBotIds.includes(member.id))
}

export function redactDeletedBotIds(text: string, ids: readonly string[], replacement = '[已删除 Bot]'): string {
  if (!ids.length) return text
  const pattern = [...ids].sort((a, b) => b.length - a.length).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.replace(new RegExp(pattern, 'g'), () => replacement)
}

export function freshCoordinator(existing: Member | undefined, revision: number, rowCount: number, uuid: () => string, workspace?: string): Member {
  if (existing && existing.contextWorkspace === workspace && (existing.contextRevision ?? 0) === revision) return { ...existing, name: coordinatorName, duty: coordinatorDuty }
  return { id: coordinatorId, name: coordinatorName, duty: coordinatorDuty, sessionId: uuid(), contextRevision: revision, contextWorkspace: workspace, historyStart: rowCount }
}

export function createRequestedBots(library: Library, raw: unknown, user: string, uuid: () => string) {
  const actions = z.array(z.object({ name: definition.shape.name, duty: definition.shape.duty, evidence: z.string().trim().min(3).max(2000) })).min(1).max(6).parse(raw)
  if (!/(创建|新建|新增|增加|create|add)/iu.test(user) || !/(bot|agent|智能体|成员|助手)/iu.test(user)) throw new Error('只有用户明确要求创建 Bot 时才会新增成员。')
  const created = actions.map(action => {
    if (!user.normalize('NFKC').includes(action.evidence.normalize('NFKC'))) throw new Error('创建 Bot 缺少本轮用户原文依据。')
    if (isCoordinatorName(action.name)) throw new Error('KingBot 是主 Bot 的保留名称。')
    return { id: `bot-${uuid()}`, name: action.name, duty: action.duty, archived: false }
  })
  return { library: validateLibrary({ ...library, bots:[...library.bots,...created] }), created }
}
