import { z } from 'zod'
import { isCoordinatorName, normalizeName, requestedBotDefinition, updateLibrary, type Library } from './bots.ts'

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
  requestKey: z.string().optional(),
  title: groupActionSchema.shape.title,
  topic: groupActionSchema.shape.topic,
  members: z.array(z.object({ id: z.string(), name: z.string() })).max(12),
  newBots: z.array(requestedBotDefinition.extend({ id: z.string() })).max(6),
  workspaceId: z.string().optional(),
  sessionId: z.string(),
  confirmationId: z.string().optional(),
  runTask: z.boolean(),
})
export type GroupProposal = z.infer<typeof groupProposalSchema>

export function confirmationId(proposal: GroupProposal) {
  return proposal.confirmationId ?? proposal.sessionId
}

export function isGroupRevision(user: string) {
  return /(?:换成|换为|换掉|改成|改到|改为|再加(?:上)?|加上|去掉|移除|删掉|改名|换个(?:名字|工作区)|只(?:用|留|要)|不(?:用|要|再)新建)|\b(?:replace .+ with|swap|remove|rename|add .+ to the group|change .+ to|move it to)\b/iu.test(user)
}

export function proposeGroup(raw: unknown, user: string, library: Library, workspaces: GroupWorkspace[], uuid: () => string, previous?: GroupProposal): GroupProposal {
  const result = groupActionSchema.safeParse(raw)
  if (!result.success) throw new Error('建群方案需要包含群名、任务摘要、成员或新 Bot 建议，以及本轮原文依据')
  const action = result.data
  if (!user.normalize('NFKC').includes(action.evidence.normalize('NFKC'))) throw new Error('建群方案缺少本轮用户原文依据')
  if (/(?:不要|别|不用|不必|无需|暂不|只让你)[^。；;，,]{0,12}(?:建群|建.{0,4}群|拉.{0,4}群|开.{0,4}群)|\b(?:do not|don.t|never) (?:create|start) (?:a )?group\b/iu.test(user)) {
    throw new Error('用户暂不需要建群，请直接回应本轮请求')
  }
  if (!action.runTask && !previous && !/建群|群聊|讨论群|开.{0,4}群|建.{0,5}群|拉.{0,5}群|组.{0,5}群|group chat/iu.test(user)) {
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
  const exact = /(?:唯一|仅(?:指定|用|邀请|添加|选)|只(?:指定|用|邀请|添加|选)|\b(?:only|sole)\s+(?:child|invite|include|member))/iu.test(user)
  if (exact && named.length && (action.newBots.length || members.some(member => !named.includes(normalizeName(member.name))))) {
    throw new Error('用户限定了群成员，请只使用点名的成员')
  }
  const names = new Set(library.bots.map(bot => normalizeName(bot.name)))
  const newBots = action.newBots.map(bot => {
    const key = normalizeName(bot.name)
    if (isCoordinatorName(bot.name) || key === normalizeName('主Bot') || names.has(key)) {
      throw new Error(`“${bot.name}”是保留名称或已存在，请调整建议的新 Bot`)
    }
    names.add(key)
    return { ...bot, id: `bot-${uuid()}` }
  })
  const normalized = user.normalize('NFKC')
  const paths = workspaces.filter(workspace => normalized.includes(workspace.path.normalize('NFKC')))
  const namedWorkspaces = workspaces.filter(workspace => normalized.includes(workspace.title.normalize('NFKC')))
  const workspaceId = paths.length === 1 ? paths[0].id
    : namedWorkspaces.length > 1 ? undefined
    : namedWorkspaces[0]?.id ?? workspaces.find(workspace => workspace.id === action.workspaceId)?.id
      ?? previous?.workspaceId
      ?? (workspaces.length === 1 ? workspaces[0].id : undefined)
  const proposal: GroupProposal = {
    title: previous && !/(?:群名|名字|改名|rename|title)/iu.test(user) ? previous.title : action.title.replace(/\s+/g, ' '),
    topic: previous && !/(?:议题|任务|目标|topic|task|goal)/iu.test(user) ? previous.topic : action.topic,
    members,
    newBots,
    runTask: previous?.runTask ?? action.runTask,
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
  return {
    ids: [...proposal.members, ...proposal.newBots].map(member => member.id),
    added,
    library: updateLibrary(library, { ...library, bots: [...library.bots, ...added.map(bot => ({ ...bot, archived: false }))] }),
  }
}

export function groupReply(user: string, pending = true) {
  const text = user.normalize('NFKC').trim().replace(/[。.!！]+$/u, '')
  if (/^(?:(?:好[的吧]?|行|可以)[，,\s]+)?(?:确认建群|确认创建群聊|同意建群|可以建群|就这么建|就这样建|就按(?:这个|上面(?:的)?)?(?:方案)?建(?:群)?|confirm group|go ahead and create it)(?:吧|就行|即可)?$/iu.test(text) ||
      pending && /^(?:就这么定|按这个来)(?:吧|就行|即可)?$/u.test(text)) return { kind: 'confirm' } as const
  if (/^(?:取消建群|取消创建群聊|先不建群(?:了)?|不建群了|不用建了|别建了|先不建了|算了[，,\s]*先不建(?:了)?|cancel group)$/iu.test(text)) return { kind: 'cancel' } as const
  const workspace = /^(?:(?:工作区|workspace)\s*:\s*|(?:建在|改到|放在|就放在)\s*)(.+?)(?:吧|就行)?$/iu.exec(text)
  if (workspace && pending) return { kind: 'workspace', name: workspace[1].trim() } as const
}

function workspaceLabel(workspace: GroupWorkspace, all: GroupWorkspace[]) {
  return all.some(other => other.id !== workspace.id && other.title === workspace.title)
    ? `${workspace.title}（${workspace.path}）` : workspace.title
}

export function describeGroupProposal(proposal: GroupProposal, workspaces: GroupWorkspace[]) {
  const target = workspaces.find(workspace => workspace.id === proposal.workspaceId)
  const existing = proposal.members.map(member => member.name).join('、')
  const newBots = proposal.newBots.map(bot => `\`${bot.name}\`（${bot.duty}）`).join('、')
  const names = [existing && `邀请 ${existing}`, newBots && `新建 ${newBots} 加入`].filter(Boolean).join('，并')
  const place = target ? `在「${workspaceLabel(target, workspaces)}」` : ''
  const task = proposal.runTask ? '，建好后开始讨论并把结论带回这里' : ''
  const summary = `建议${place}建立「${proposal.title}」，${names}${task}。`
  if (target) return `${summary} 可以这样建吗？`
  if (!workspaces.length) return `${summary} 请先在侧栏添加一个普通工作区。`
  return `${summary} 放在哪个工作区（${workspaces.map(item => workspaceLabel(item, workspaces)).join('、')}）？`
}

export function describeGroupChange(proposal: GroupProposal, previous: GroupProposal, workspaces: GroupWorkspace[]) {
  const before = [...previous.members, ...previous.newBots].map(bot => bot.name)
  const after = [...proposal.members, ...proposal.newBots].map(bot => bot.name)
  const added = after.filter(name => !before.includes(name))
  const removed = before.filter(name => !after.includes(name))
  const target = workspaces.find(workspace => workspace.id === proposal.workspaceId)
  const updates = [
    proposal.title !== previous.title && `群名改为「${proposal.title}」`,
    added.length && `加入 ${added.join('、')}`,
    removed.length && `移除 ${removed.join('、')}`,
    target && proposal.workspaceId !== previous.workspaceId && `工作区改为「${workspaceLabel(target, workspaces)}」`,
  ].filter(Boolean).join('，')
  if (!target) return describeGroupProposal(proposal, workspaces)
  const newBots = proposal.newBots.filter(bot => !previous.newBots.some(old => old.name === bot.name && old.duty === bot.duty))
  const approval = newBots.length ? `同意新建${newBots.map(bot => ` \`${bot.name}\`（${bot.duty}）`).join('、')}并建群吗？` : '按修改后的方案建群吗？'
  return updates ? `${updates}。 ${approval}` : approval
}
