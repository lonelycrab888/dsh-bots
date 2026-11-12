import { z } from 'zod'
import { isCoordinatorName, normalizeName, requestedBotDefinition, validateLibrary, type Library } from './bots.ts'

export interface GroupWorkspace { id: string; title: string; path: string }

const groupActionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  topic: z.string().trim().min(1).max(1800),
  memberIds: z.array(z.string()).max(12).default([]),
  newBots: z.array(requestedBotDefinition).max(6).default([]),
  workspaceId: z.string().nullish(),
  runTask: z.boolean().default(false),
  evidence: z.string().trim().min(2).max(2000),
})

export const groupProposalSchema = z.object({
  title: groupActionSchema.shape.title,
  topic: groupActionSchema.shape.topic,
  members: z.array(z.object({ id: z.string(), name: z.string() })).max(12),
  newBots: z.array(requestedBotDefinition.extend({ id: z.string() })).max(6),
  workspaceId: z.string().optional(),
  sessionId: z.string(),
  runTask: z.boolean(),
})
export type GroupProposal = z.infer<typeof groupProposalSchema>

export function proposeGroup(raw: unknown, user: string, library: Library, workspaces: GroupWorkspace[], uuid: () => string, revising: boolean): GroupProposal {
  const result = groupActionSchema.safeParse(raw)
  if (!result.success) throw new Error('建群方案需要包含群名、任务摘要、成员或新 Bot 建议，以及本轮原文依据')
  const action = result.data
  if (!user.normalize('NFKC').includes(action.evidence.normalize('NFKC'))) throw new Error('建群方案缺少本轮用户原文依据')
  if (/(?:不要|别|不用|不必|无需|暂不|只让你)[^。；;，,]{0,12}(?:建群|建.{0,4}群|拉.{0,4}群|开.{0,4}群)|\b(?:do not|don.t|never) (?:create|start) (?:a )?group\b/iu.test(user)) {
    throw new Error('用户暂不需要建群，请直接回应本轮请求')
  }
  if (!action.runTask && !revising && !/建群|群聊|讨论群|开.{0,4}群|建.{0,5}群|拉.{0,5}群|组.{0,5}群|group chat/iu.test(user)) {
    throw new Error('请先说明要建立什么群聊')
  }
  const members = [...new Set(action.memberIds)].map(id => {
    const bot = library.bots.find(bot => bot.id === id && !bot.archived)
    if (!bot) throw new Error('建议的成员中有不可用的 Bot，请从现有的启用成员中选择')
    return { id, name: bot.name }
  })
  const named = [...user.matchAll(/(?:^|[\s，。？！、,:：;；!?])@([\p{L}\p{N}_-]+)/gu)].map(match => normalizeName(match[1]))
  const omitted = library.bots.find(bot => !bot.archived && named.includes(normalizeName(bot.name)) && !action.memberIds.includes(bot.id))
  if (omitted) throw new Error(`方案遗漏了用户点名的“${omitted.name}”`)
  const names = new Set(library.bots.map(bot => normalizeName(bot.name)))
  const newBots = action.newBots.map(bot => {
    const key = normalizeName(bot.name)
    if (isCoordinatorName(bot.name) || key === normalizeName('主Bot') || names.has(key)) {
      throw new Error(`“${bot.name}”是保留名称或已存在，请调整建议的新 Bot`)
    }
    names.add(key)
    return { ...bot, id: `bot-${uuid()}` }
  })
  const workspaceId = workspaces.find(workspace => workspace.id === action.workspaceId)?.id
    ?? (workspaces.length === 1 ? workspaces[0].id : undefined)
  const proposal: GroupProposal = {
    title: action.title.replace(/\s+/g, ' '),
    topic: action.topic,
    members,
    newBots,
    runTask: action.runTask,
    sessionId: `session-${uuid()}`,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }
  validateGroupMembers(proposal, library)
  return proposal
}

export function validateGroupMembers(proposal: GroupProposal, library: Library) {
  const count = proposal.members.length + proposal.newBots.length
  if (count < (proposal.runTask ? 2 : 1)) throw new Error(proposal.runTask ? '讨论任务至少需要两名子 Bot，请补充合适的成员建议' : '群聊至少需要一名子 Bot')
  if (count > library.maxMembers) throw new Error(`当前群聊最多可加入 ${library.maxMembers} 名子 Bot`)
  for (const member of proposal.members) {
    if (!library.bots.some(bot => bot.id === member.id && bot.name === member.name && !bot.archived)) {
      throw new Error(`“${member.name}”的设置已变更，请让 KingBot 更新方案后重新确认`)
    }
  }
  const added = proposal.newBots.filter(bot => {
    const saved = library.bots.find(item => item.id === bot.id || normalizeName(item.name) === normalizeName(bot.name))
    if (!saved) return true
    if (saved.id !== bot.id || saved.name !== bot.name || saved.duty !== bot.duty || saved.archived) {
      throw new Error(`“${bot.name}”的设置已变更，请让 KingBot 更新方案后重新确认`)
    }
    return false
  })
  if (library.bots.length + added.length > 100) throw new Error('Bot 定义库最多保存 100 个成员（含已停用成员）')
  return {
    ids: [...proposal.members, ...proposal.newBots].map(member => member.id),
    added,
    library: validateLibrary({ ...library, bots: [...library.bots, ...added.map(bot => ({ ...bot, archived: false }))] }),
  }
}

export function groupReply(user: string) {
  const text = user.normalize('NFKC').trim().replace(/[。.!！]+$/u, '')
  if (/^(?:确认建群|确认创建群聊|同意建群|可以建群|就按(?:这个|上面(?:的)?)?(?:方案)?建群|confirm group)(?:吧|就行|即可)?$/iu.test(text)) return { kind: 'confirm' } as const
  if (/^(?:取消建群|取消创建群聊|先不建群|不建群了|cancel group)$/iu.test(text)) return { kind: 'cancel' } as const
  const workspace = /^(?:(?:工作区|workspace)\s*:\s*|(?:建在|改到|放在)\s*)(.+)$/iu.exec(text)
  if (workspace) return { kind: 'workspace', name: workspace[1].trim() } as const
}

export function describeGroupProposal(proposal: GroupProposal, workspaces: GroupWorkspace[]) {
  const target = workspaces.find(workspace => workspace.id === proposal.workspaceId)
  return [
    `建群方案：${proposal.title}`,
    `议题：${proposal.topic}`,
    `现有成员：${proposal.members.map(member => member.name).join('、') || '无'}`,
    ...proposal.newBots.map(bot => `建议新建 ${bot.name}：${bot.duty}`),
    proposal.runTask ? '建群后将组织成员讨论，并把结论带回这里。' : '本次只建立群聊。',
    target ? `目标工作区：${target.title}（${target.path}）` : '请先选择目标工作区。',
    workspaces.length
      ? `可用工作区：\n${workspaces.map(workspace => `• ${workspace.title}（${workspace.path}）`).join('\n')}`
      : '请先在侧栏添加一个普通工作区。',
    '回复「工作区：名称或路径」可选择或更改工作区。',
    target && (proposal.newBots.length ? '同意在该工作区建群并创建上述新 Bot，请回复「确认建群」。' : '同意在该工作区建群，请回复「确认建群」。'),
    '回复「取消建群」可取消。',
  ].filter(Boolean).join('\n')
}
