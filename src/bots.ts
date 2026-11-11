import { z } from 'zod'

export const bots = [
  { id: 'architect', name: '架构师', duty: '提出技术方案，说明模块职责、关键取舍和可验证的实施步骤。', archived: false },
  { id: 'reviewer', name: '审阅员', duty: '审阅方案或现有回复，指出遗漏、边界条件和验证方法。', archived: false },
]
export const coordinatorId = 'coordinator'
export const coordinatorName = 'Bots King'
export const coordinatorDuty = '理解用户目标，按成员职责派发任务，汇总结果，并维护跨群聊的个人长期记忆。'
export const defaultLibrary = { maxMembers: 4, bots }
export const normalizeName = (name: string) => name.normalize('NFKC').toLocaleLowerCase()
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
  maxMembers: z.number().int().min(1).max(12),
  bots: z.array(definition).max(100),
}).superRefine((value, ctx) => {
  const names = new Set([normalizeName(coordinatorName), normalizeName('主Bot')])
  const ids = new Set([coordinatorId])
  for (const bot of value.bots) {
    const name = normalizeName(bot.name)
    if (names.has(name) || ids.has(bot.id)) ctx.addIssue({ code: 'custom', message: 'Bot 名称和标识必须唯一，且不能使用 Bots King 的名称。' })
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
export interface Member { id: BotId; name: string; duty: string; sessionId: string }
export type Row =
  | { id: string; author: 'user' | 'notice'; text: string }
  | { id: string; author: 'bot'; botId: BotId; text: string; status: 'working' | 'done' | 'error' | 'stopped' }
export interface Group { members: Member[]; coordinator?: Member; rows: Row[] }

/** An empty result asks the coordinator to select members. */
export function resolveTargets(text: string, members: readonly Member[]): Member[] {
  const tokens = Array.from(text.replace(/@Bots\s+King(?=$|[\s，。？！、,:：;；])/giu, '@主Bot').matchAll(/(?:^|[\s，、,;；])@([\p{L}\p{N}_-]+)/gu), match => match[1])
  const result = new Set<Member>()
  for (const token of tokens) {
    if ([normalizeName(coordinatorName), normalizeName('主Bot')].includes(normalizeName(token))) continue
    const member = members.find(candidate => normalizeName(candidate.name) === normalizeName(token))
      ?? members.find(candidate => candidate.id === token.toLowerCase())
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
export interface Plan { tasks: { botId: string; task: string }[]; reply?: string; memoryActions?: unknown }
export function parsePlan(output: string, members: Member[], required: Member[] = []): Plan {
  const source = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let input: unknown
  try { input = JSON.parse(source) } catch { throw new Error('Bots King 没有返回有效的任务分派 JSON。') }
  const plan = z.object({ tasks: z.array(z.object({ botId: z.string(), task: z.string().trim().min(1).max(6000) })).max(members.length), reply: z.string().max(12000).optional(), memoryActions: z.unknown().optional() }).parse(input)
  const ids = plan.tasks.map(task => task.botId)
  if (new Set(ids).size !== ids.length || ids.some(id => !members.some(member => member.id === id))) throw new Error('Bots King 分派了重复或未加入群聊的成员。')
  if (required.length && (required.some(member => !ids.includes(member.id)) || ids.some(id => !required.some(member => member.id === id)))) throw new Error('任务分派必须严格覆盖用户点名的成员。')
  if (!ids.length && !plan.reply?.trim()) throw new Error('Bots King 未提供任务或直接答复。')
  return plan
}
