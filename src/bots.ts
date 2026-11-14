import type { MemberExecution } from './member-runtime.ts'
import { z } from 'zod'
import { botAvatars, fillAvatars, type BotAvatar } from './avatars.ts'
import type { DiscussionTask } from './tasks.ts'
import type { FileBlock } from '@deepseek-ai/dsh-llm'

export const coordinatorId = 'coordinator'
export const coordinatorName = 'King Arthur'
export const legacyCoordinatorName = 'Bots King'
export const previousCoordinatorName = 'KingBot'
export const coordinatorDuty = '理解用户目标，按成员职责派发任务，汇总结果，并维护跨群聊的个人长期记忆。'
// New profiles start without child Bots. Existing libraries remain user-owned.
export const defaultLibrary: Library = { maxMembers: 4, bots: [], deletedBotIds: [] }
export const normalizeName = (name: string) => name.normalize('NFKC').toLocaleLowerCase()
export const isCoordinatorName = (name: string) => [normalizeName(coordinatorName), 'king-arthur'].includes(normalizeName(name.trim()))
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
  avatar: z.enum(botAvatars).optional(),
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
export const maxChildBots = 20

export function updateLibrary(previous: Library, value: unknown): Library {
  const next = validateLibrary(value)
  const old = new Map(previous.bots.map(bot => [bot.id, bot]))
  const added = next.bots.filter(bot => !old.has(bot.id)).length
  const retained = next.bots.length - added
  const available = Math.max(0, maxChildBots - retained)
  if (added > available) throw new Error(`子 Bot 上限为 ${maxChildBots} 个（含已停用成员），剩余 ${available} 个名额。`)
  return { ...next, bots: fillAvatars(next.bots.map(bot => ({ ...bot, avatar: old.get(bot.id)?.avatar }))) }
}

export interface Member { id: BotId; name: string; duty: string; avatar?: BotAvatar; sessionId: string; contextWorkspace?: string; contextRevision?: number; historyStart?: number }
export type Row = (
  | { id: string; author: 'user'; text: string; continues?: true; control?: true; documents?: FileBlock[] }
  | { id: string; author: 'notice'; text: string; sessionId?: string; tone?: 'info'; taskLink?: string; groupReference?: true }
  | { id: string; author: 'bot'; botId: BotId; text: string; reasoning?: string; status: 'working' | 'done' | 'error' | 'stopped' | 'waiting'; execution?: MemberExecution; taskId?: string; resultKind?: 'partial' | 'final'; sessionId?: string; literal?: true; privateToKing?: true; groupReference?: true }
) & { at?: number }
export interface Group { totalRows?:number; sessionEpoch?:number; mode?: 'group' | 'king' | 'bot'; botId?: string; members: Member[]; coordinator?: Member; rows: Row[]; brief?: string; tasks?: DiscussionTask[]; activeTaskId?: string; confirmation?: { id: string; ready: boolean; task?: string } }

/** An empty result asks the coordinator to select members. */
export function resolveTargets(text: string, members: readonly Member[], isWorkspaceEntry?: (name: string) => boolean): Member[] {
  // The native composer serializes file references as @path or @"path with spaces".
  // A dot or slash inside the token must not turn its prefix into a Bot name.
  const unquoted = text.replace(/@"[^"\r\n]+"/gu, ' ')
    .replace(/@(?:King\s+Arthur|Bots\s+King)(?=$|[\s）)】\]，。？！、,:：;；!?]|\.(?=$|\s))/giu, '@主Bot')
  const tokens = Array.from(unquoted.matchAll(/(?:^|[\s（(【\[，。？！、,:：;；!?])@([\p{L}\p{N}_-]+)(?=$|[\s）)】\]，。？！、,:：;；!?]|\.(?=$|\s))/gu), match => match[1])
  const result = new Set<Member>()
  for (const token of tokens) {
    const name = normalizeName(token)
    if (name === normalizeName('主Bot')) continue
    const namedMember = members.find(candidate => normalizeName(candidate.name) === name)
    if (!namedMember && (isCoordinatorName(token) || normalizeName(token) === normalizeName(previousCoordinatorName))) continue
    const member = namedMember ?? members.find(candidate => candidate.id === token.toLowerCase())
    if (!member && isWorkspaceEntry?.(token)) continue
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
    return { id: bot.id, name: bot.name, duty: bot.duty, ...(bot.avatar ? { avatar: bot.avatar } : {}), sessionId: previous.find(member => member.id === id)?.sessionId ?? uuid() }
  })
}
export interface Plan { tasks: { botId: string; task: string }[]; reply?: string; memoryActions?: unknown; botActions?: unknown; groupAction?: unknown; existingGroupAction?: unknown }
export function discussionTopic(text: string): string | undefined {
  return /^\s*(?:讨论|discuss)\s*[:：]([\s\S]*)$/iu.exec(text)?.[1].trim()
}

export function parsePlan(output: string, members: Member[], required: Member[] = [], minTasks = 0): Plan {
  const source = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let input: unknown
  try { input = JSON.parse(source) } catch { throw new Error('King Arthur 没有返回有效的 JSON。') }
  const parsed = z.object({ tasks: z.array(z.object({ botId: z.string(), task: z.string().trim().min(1).max(6000) })).max(members.length).default([]), reply: z.string().max(12000).optional(), memoryActions: z.unknown().optional(), botActions: z.unknown().optional(), groupAction: z.unknown().optional(), existingGroupAction: z.unknown().optional() }).safeParse(input)
  if (!parsed.success) throw new Error('King Arthur 的回复格式有误，需要提供任务列表或文字答复')
  const plan = parsed.data
  if (plan.botActions == null || (Array.isArray(plan.botActions) && plan.botActions.length === 0)) delete plan.botActions
  if (plan.groupAction == null) delete plan.groupAction
  if (plan.existingGroupAction == null) delete plan.existingGroupAction
  if (plan.existingGroupAction !== undefined && (plan.groupAction !== undefined || plan.botActions !== undefined)) throw new Error('操作已有群不能同时新建群或成员。')
  const ids = plan.tasks.map(task => task.botId)
  if (new Set(ids).size !== ids.length || ids.some(id => !members.some(member => member.id === id))) throw new Error('King Arthur 分派了重复或未加入群聊的成员。')
  if (required.length && (required.some(member => !ids.includes(member.id)) || ids.some(id => !required.some(member => member.id === id)))) throw new Error('任务分派必须严格覆盖用户点名的成员。')
  if (ids.length < minTasks) throw new Error('讨论至少需要给两名子 Bot 分派任务。')
  if (!ids.length && !plan.reply?.trim() && plan.botActions === undefined && plan.groupAction === undefined && plan.existingGroupAction === undefined) throw new Error('King Arthur 未提供任务或直接答复。')
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
  return { id: coordinatorId, name: coordinatorName, duty: coordinatorDuty, sessionId: uuid(), contextRevision: revision, ...(workspace === undefined ? {} : { contextWorkspace: workspace }), historyStart: rowCount }
}

const creationVerb = /创建|新建|建立|搭建|设立|新增|添加|增加|建(?=个|一|几|两|[二三四五六\d]|下|好|起来)|(?:帮我|给我)(?:加|配|弄|来)(?=一|个|几|两|[二三四五六\d])|\b(?:create|add|set up|make|build)\b/giu
const creationTarget = /智能体|成员|助手|助理|代理|\b(?:bots?|agents?|assistants?)\b|(?:这|那)(?:些|几个|两位|两个)|(?:上面|上述|刚才)(?:的|提到的)?(?:几|两|[二三四五六\d])/iu
const indirectPrefix = /(?:不要|不用|不必|无需|不想|不打算|不需要|暂不|别|如何|怎么|怎样|是否|教我|假设|举例)[^，,]*$|\b(?:do not|don.t|never|how (?:do|to|can)|whether to|show me how to)\b[^,]*$/iu

export function isBotCreationRequest(user: string): boolean {
  const text = user.normalize('NFKC').replace(/\x60{3}[\s\S]*?(?:\x60{3}|$)|^\s*>[^\n]*/gmu, ' ')
    .replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|\x60[^\x60\n]*\x60/gu, quote =>
      [...quote.matchAll(creationVerb)].length ? ' ' : quote)
  return text.split(/[。！？!?；;\n]/u).some(sentence => creationTarget.test(sentence) &&
    [...sentence.matchAll(creationVerb)].some(match => !indirectPrefix.test(sentence.slice(0, match.index))))
}

function cleanRequestedName(name: string) {
  const normalized = name.normalize('NFKC').trim()
  return /^[\p{L}\p{N}_-]+$/u.test(normalized)
    ? normalized
    : normalized.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
}

export const requestedBotDefinition = z.object({
  name: z.string().transform(cleanRequestedName).pipe(definition.shape.name),
  duty: definition.shape.duty,
})
const requestedBots = z.array(requestedBotDefinition.extend({
  evidence: z.string().trim().min(3).max(2000),
  reuse: z.boolean().optional(),
})).min(1).max(6)

export function createRequestedBots(library: Library, raw: unknown, user: string, uuid: () => string) {
  if (!isBotCreationRequest(user)) throw new Error('本轮还没有明确的创建请求。可以说“帮我建立一个资料整理助手”')
  const parsed = requestedBots.safeParse(raw)
  if (!parsed.success) {
    const [issue] = parsed.error.issues
    const [index, field] = issue.path
    const requirements = {
      name: '名称需为 1–24 个字符，支持中英文、数字、下划线和连字符',
      duty: '职责需为 1–6000 个字符的说明',
      evidence: '请引用本轮创建请求的原话',
    } as const
    const detail = requirements[field as keyof typeof requirements]
    throw new Error(typeof index === 'number' && detail ? `第 ${index + 1} 个子 Bot：${detail}` : '每次可创建 1–6 个子 Bot')
  }
  const userText = user.normalize('NFKC')
  const existing = new Set<Bot>()
  const conflicts = new Map<string, string>()
  const byName = new Map(library.bots.map(bot => [normalizeName(bot.name), bot]))
  const pending = new Map<string, { name: string; duty: string }>()
  for (const { name, duty, evidence, reuse } of parsed.data) {
    if (!userText.includes(evidence.normalize('NFKC'))) throw new Error('创建 Bot 缺少本轮用户原文依据')
    const key = normalizeName(name)
    if (isCoordinatorName(name) || key === normalizeName('主Bot')) throw new Error(`“${name}”是主 Bot 的保留名称`)
    const saved = byName.get(key)
    if (saved) {
      if (reuse || saved.duty.normalize('NFKC') === duty.normalize('NFKC')) existing.add(saved)
      else conflicts.set(key, saved.name)
      continue
    }
    if (conflicts.has(key)) continue
    const other = pending.get(key)
    if (other && other.duty !== duty) {
      pending.delete(key)
      conflicts.set(key, other.name)
      continue
    }
    pending.set(key, other ?? { name, duty })
  }
  const pendingBots = Array.from(pending.values(), bot => ({ ...bot, id: `bot-${uuid()}`, archived: false }))
  const updated = updateLibrary(library, { ...library, bots: [...library.bots, ...pendingBots] })
  return { library: updated, created: updated.bots.slice(library.bots.length), existing: [...existing], conflicts: [...conflicts.values()] }
}

export function updateRequestedBot(library: Library, raw: unknown, user: string) {
  const request = z.object({
    botId: definition.shape.id,
    name: definition.shape.name.optional(),
    duty: definition.shape.duty.optional(),
    evidence: z.string().trim().min(3).max(6000),
  }).strict().parse(raw)
  const bot = library.bots.find(item => item.id === request.botId)
  if (!bot) throw new Error('请选择已有的子 Bot。')
  if (request.name === undefined && request.duty === undefined) throw new Error('请提供新名称或新职责。')
  const source = request.evidence.normalize('NFKC')
  const original = user.normalize('NFKC').replace(/(?:```|~~~)[\s\S]*?(?:(?:```|~~~)|$)|^\s*>[^\n]*/gmu, ' ')
  const position = original.indexOf(source)
  const before = original.slice(0, position).split(/[。！？!?；;\n，,]/u).at(-1) ?? ''
  const command = source.replace(/“[^”]*”|「[^」]*」|"[^"]*"|`[^`]*`/gu, ' ')
  const editVerb = /改名|更名|重命名|改成|改为|修改|更新|调整|设为|\b(?:rename|change|update|set)\b/giu
  const edit = editVerb.exec(command)
  if (position < 0 ||
      !source.includes(bot.name.normalize('NFKC')) ||
      !edit || indirectPrefix.test(before + command.slice(0, edit.index))) {
    throw new Error('请引用本轮明确要求修改该子 Bot 的原文。')
  }
  if (request.name !== undefined &&
      (isCoordinatorName(request.name) || !source.includes(request.name.normalize('NFKC')))) {
    throw new Error('新名称必须出现在用户请求中，且不能使用主 Bot 的保留名称。')
  }
  const updated = {
    ...bot,
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.duty !== undefined ? { duty: request.duty } : {}),
  }
  return { bot: updated, library: validateLibrary({ ...library, bots: library.bots.map(item => item.id === bot.id ? updated : item) }) }
}

export function requestedBotDeletion(library: Library, raw: unknown, user: string): Bot[] {
  const request = z.union([
    z.object({ botId: definition.shape.id }).strict(),
    z.object({ botIds: z.array(definition.shape.id).min(1).max(100) }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ]).parse(raw)
  let command = user.normalize('NFKC').trim().replace(/[。.!！]+$/u, '').trim()
  command = command.replace(/^(?:@?King\s+Arthur[\s,，:：]+)?(?:(?:请|帮我|帮忙|麻烦你?|能不能|可以|能否)\s*)*/iu, '')

  // Recognize command structure before resolving names. Quoted examples,
  // negation, questions about how to delete and mixed scopes fail closed.
  const verb = '(?:删掉|删除|删了|删|移除|清空|清掉|清理掉|清理|全删|清除)'
  const leading = new RegExp('^' + verb + '\\s*(.+?)$', 'iu')
  const trailing = new RegExp('^(?:把|将)\\s*(.+?)\\s*(全都|全部|通通|统统|都|一起)?\\s*' + verb + '(?:掉|了|干净)?$', 'iu')
  const phrase = command.replace(/(?:吧|就行|一下)$/u, '').trim()
  const reversed = trailing.exec(phrase)
  const target = (reversed?.[1] ?? leading.exec(phrase)?.[1]
    ?? /^(?:please\s+)?(?:delete|remove)\s+(.+)$/iu.exec(command)?.[1])
    ?.trim().replace(/(?:吧|就行|一下)$/u, '').trim()
  const childLabel = '(?:子\\s*(?:bots?|机器人|智能体|助手)|child\\s+bots?)'
  const allTarget = new RegExp('^(?:(?:现在的?|现有的?|当前的?)?\\s*(?:所有|全部|全体|每个|all)\\s*(?:的|the)?\\s*' +
    childLabel + '|' + childLabel + '\\s*(?:全都|全部|通通|统统|都)?)$', 'iu')
  if ('all' in request) {
    const explicitScope = /所有|全部|全体|每个|全都|通通|统统|都|\ball\b/iu.test(target ?? '')
      || /^(?:全都|全部|通通|统统|都)$/u.test(reversed?.[2] ?? '')
      || /清空|全删|删干净|clear\s+out/iu.test(phrase)
    if (!target || !allTarget.test(target) || !explicitScope) throw new Error('请明确说明要删除全部子 Bot。')
    return library.bots
  }

  const names = target?.split(/\s*(?:、|,|，|和|与|以及|\band\b)\s*/iu).map(name => normalizeName(
    name.replace(new RegExp('^' + childLabel + '\\s+', 'iu'), '')
      .replace(/(?:这个|那个)(?:子\s*)?Bot$/iu, '').trim()
      .replace(/^[@＠]/u, '').replace(/^[「『“"'](.+)[」』”"']$/u, '$1'),
  ))
  const ids = 'botId' in request ? [request.botId] : request.botIds
  const bots = ids.map(id => library.bots.find(bot => bot.id === id))
  if (!names || names.length !== ids.length || new Set(ids).size !== ids.length ||
      !bots.every((bot): bot is Bot => !!bot && names.includes(normalizeName(bot.name)))) {
    throw new Error('请明确指出要删除的子 Bot 名称，或说明要删除全部子 Bot。')
  }
  return bots
}
