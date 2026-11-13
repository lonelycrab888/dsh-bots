import { groupCheckpointSchema, type GroupCheckpoint } from './group-context.ts'
import { z } from 'zod'
import { memberExecutionSchema } from './member-runtime.ts'
import { botAvatars } from './avatars.ts'
import type { FileBlock } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import { taskSchema, type DiscussionTask } from './tasks.ts'
import type { Group, Member } from './bots.ts'
import { confirmationId, groupProposalSchema, type GroupProposal } from './group-creation.ts'
import { peerEventSchema, peerMessageSchema, peerReceiptId, type PeerEvent } from './peer-messages.ts'
import { groupChoiceSchema, groupDeliverySchema, groupTaskUpdateSchema, type GroupDelivery, type GroupTaskUpdate } from './existing-groups.ts'

const botId = z.string()
const member = z.object({ id: botId, name: z.string(), duty: z.string(), avatar: z.enum(botAvatars).optional(), sessionId: z.string(), contextWorkspace: z.string().optional(), contextRevision: z.number().int().nonnegative().optional(), historyStart: z.number().int().nonnegative().optional() })
const document = z.object({
  type: z.literal('file'),
  attachment: z.object({
    attachmentId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    name: z.string(),
    bytes: z.number().int().nonnegative(),
  }),
}).transform(value => value as FileBlock)
const row = z.union([
  z.object({ at: z.number().optional(), id: z.string(), author: z.literal('user'), text: z.string(), continues: z.literal(true).optional(), control: z.literal(true).optional(), documents: z.array(document).optional() }),
  z.object({ at: z.number().optional(), id: z.string(), author: z.literal('notice'), text: z.string(), sessionId: z.string().optional(), tone: z.literal('info').optional(), taskLink: z.string().optional(), groupReference: z.literal(true).optional() }),
  z.object({
    at: z.number().optional(), id: z.string(), author: z.literal('bot'), botId, text: z.string(), reasoning: z.string().optional(),
    status: z.enum(['working', 'done', 'error', 'stopped', 'waiting']), execution: memberExecutionSchema.optional(), taskId: z.string().optional(), resultKind: z.enum(['partial', 'final']).optional(), sessionId: z.string().optional(),
    literal: z.literal(true).optional(), privateToKing: z.literal(true).optional(), groupReference: z.literal(true).optional(),
  }),
])
const group = z.object({ sessionEpoch:z.number().int().nonnegative().optional(), mode: z.enum(['group','king','bot']).optional(), botId: z.string().optional(), members: z.array(member), coordinator: member.optional(), rows: z.array(row), brief: z.string().optional(), tasks: z.array(taskSchema).optional(), activeTaskId: z.string().optional(), confirmation: z.object({ id: z.string(), ready: z.boolean(), task: z.string().optional() }).optional() })
const stateSchema = z.object({
  checkpoints: z.array(groupCheckpointSchema).optional(), inherited: z.number(), group: group.nullable(), pendingGroup: groupProposalSchema.nullish(),
  groupTaskUpdates: z.array(groupTaskUpdateSchema).optional(), peerMessages: z.array(peerMessageSchema).optional(), groupChoice: groupChoiceSchema.nullish(), groupDeliveries: z.array(groupDeliverySchema).optional(),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dshBots: SessionProjectionSummaryExcluded<Group> | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-bots/checkpoint': GroupCheckpoint
    'plugin:dsh-bots/members': Group['members']
    'plugin:dsh-bots/rows': Group['rows']
    'plugin:dsh-bots/coordinator': Member
    'plugin:dsh-bots/bot': { botId: string }
    'plugin:dsh-bots/king': { mode: 'king' }
    'plugin:dsh-bots/epoch': { value:number }
    'plugin:dsh-bots/group-proposal': { proposal: GroupProposal | null }
    'plugin:dsh-bots/existing-group-choice': { choice: z.infer<typeof groupChoiceSchema> | null }
    'plugin:dsh-bots/existing-group-delivery': GroupDelivery
    'plugin:dsh-bots/group-task-update': GroupTaskUpdate
    'plugin:dsh-bots/peer-message': PeerEvent
    'plugin:dsh-bots/task': { task: DiscussionTask; active: boolean }
    'plugin:dsh-bots/group-brief': { text: string }
  }
}

type Definition = ProjectionDefinition<'dshBots', z.infer<typeof stateSchema>>

export const projection: Definition & { wire: NonNullable<Definition["wire"]> } = {
  key: 'dshBots',
  stateVersion: 18,
  stateSchema: stateSchema as unknown as Definition['stateSchema'],
  init: (_header, inherited) => ({ inherited, group: null }),
  apply(state, event) {
    if (event.seq < state.inherited) return state
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:dsh-bots/checkpoint' && state.group && state.group.mode !== 'king') {
      const parsed = groupCheckpointSchema.safeParse(record.data)
      if (!parsed.success) return state
      const old = state.checkpoints?.find(item => item.botId === parsed.data.botId)
      if (old && old.revision >= parsed.data.revision) return state
      return { ...state, checkpoints: [...(state.checkpoints ?? []).filter(item => item.botId !== parsed.data.botId), parsed.data] }
    }
    if(record?.type==='plugin:dsh-bots/epoch' && state.group){
      const parsed=z.object({value:z.number().int().nonnegative()}).safeParse(record.data)
      return parsed.success?{...state,group:{...state.group,sessionEpoch:parsed.data.value}}:state
    }
    if (record?.type === 'plugin:dsh-bots/bot') {
      const parsed = z.object({botId:z.string()}).safeParse(record.data)
      return parsed.success ? {...state,group:{mode:'bot',botId:parsed.data.botId,members:[],rows:[]}} : state
    }
    if (record?.type === 'plugin:dsh-bots/king') return { ...state, group: { ...state.group, mode: 'king', members: [], rows: state.group?.rows ?? [] } }
    if (record?.type === 'plugin:dsh-bots/group-proposal' && state.group?.mode === 'king') {
      const parsed = z.object({ proposal: groupProposalSchema.nullable() }).safeParse(record.data)
      return parsed.success ? { ...state, pendingGroup: parsed.data.proposal } : state
    }
    if (record?.type === 'plugin:dsh-bots/existing-group-choice' && state.group?.mode === 'king') {
      const parsed = z.object({ choice: groupChoiceSchema.nullable() }).safeParse(record.data)
      return parsed.success ? { ...state, groupChoice: parsed.data.choice } : state
    }
    if (record?.type === 'plugin:dsh-bots/existing-group-delivery' && state.group?.mode === 'king') {
      const parsed = groupDeliverySchema.safeParse(record.data)
      if (!parsed.success || state.groupDeliveries?.some(item => item.requestId === parsed.data.requestId)) return state
      return { ...state, groupDeliveries: [...state.groupDeliveries ?? [], parsed.data] }
    }
    if (record?.type === 'plugin:dsh-bots/group-task-update' && state.group && state.group.mode !== 'king') {
      const parsed = groupTaskUpdateSchema.safeParse(record.data)
      if (!parsed.success || state.groupTaskUpdates?.some(update => update.id === parsed.data.id)) return state
      return { ...state, groupTaskUpdates: [...state.groupTaskUpdates ?? [], parsed.data] }
    }
    if (record?.type === 'plugin:dsh-bots/peer-message' && state.group && state.group.mode !== 'king') {
      const parsed = peerEventSchema.safeParse(record.data)
      if (!parsed.success) return state
      const event = parsed.data
      const messages = state.peerMessages ?? []
      const index = messages.findIndex(message => message.id === event.id)
      const memberName = (id: string) => '@' + (state.group!.members.find(member => member.id === id)?.name ?? 'Bot')
      if (event.kind === 'sent') {
        if (index >= 0) return state
        const timestamp = new Date(event.sentAt).toISOString()
        const rows: Group['rows'] = []
        if (event.visibility === 'public') rows.push({
          id: event.id, author: 'bot', botId: event.from, text: event.text, status: 'done', taskId: event.taskId,
        })
        rows.push({
          id: event.id + ':sent', author: 'notice', tone: 'info',
          text: event.visibility === 'public' ? `公开消息 ${event.id} · ${timestamp}`
            : `${memberName(event.from)} → ${event.to.map(memberName).join('、')} · 定向消息已排队 · ${event.id} · ${timestamp}`,
        })
        return { ...state, peerMessages: [...messages, { ...event, deliveries: {} }], group: { ...state.group, rows: [...state.group.rows, ...rows] } }
      }
      const message = messages[index]
      if (!message?.to.includes(event.recipient)) return state
      const delivery = message.deliveries[event.recipient]
      if (event.kind === 'delivered' ? delivery : !delivery || delivery.acknowledgedAt !== undefined) return state
      const timestamp = new Date(event.at).toISOString()
      const receiptId = peerReceiptId(event.id, event.recipient)
      const notice: Group['rows'][number] = {
        id: receiptId + ':' + event.kind, author: 'notice', tone: 'info',
        text: event.kind === 'delivered' ? `${memberName(event.recipient)} 已收到定向消息 ${event.id} · ${timestamp}`
          : `${memberName(event.recipient)} 已确认定向消息 ${event.id} · 回执 ${receiptId} · ${timestamp}`,
      }
      const updated = { ...message, deliveries: { ...message.deliveries, [event.recipient]: event.kind === 'delivered'
        ? { deliveredAt: event.at } : { ...delivery!, acknowledgedAt: event.at } } }
      return {
        ...state, peerMessages: messages.map((entry, offset) => offset === index ? updated : entry),
        group: { ...state.group, rows: [...state.group.rows, notice] },
      }
    }
    if (record?.type === 'plugin:dsh-bots/task' && state.group && state.group.mode !== 'king') {
      const parsed = z.object({ task: taskSchema, active: z.boolean() }).safeParse(record.data)
      if (!parsed.success) return state
      const tasks = new Map((state.group.tasks ?? []).map(task => [task.id, task]))
      tasks.set(parsed.data.task.id, parsed.data.task)
      return { ...state, group: { ...state.group, tasks: [...tasks.values()], ...(parsed.data.active ? { activeTaskId: parsed.data.task.id } : {}) } }
    }
    if (record?.type === 'plugin:dsh-bots/group-brief' && state.group) {
      const parsed = z.object({ text: z.string() }).safeParse(record.data)
      return parsed.success ? { ...state, group: { ...state.group, brief: parsed.data.text } } : state
    }
    if (record?.type === 'plugin:dsh-bots/members') {
      const parsed = z.array(member).safeParse(record.data)
      return parsed.success
        ? { ...state, group: parsed.data.length ? { ...state.group, members: parsed.data, rows: state.group?.rows ?? [] } : null }
        : state
    }
    if (record?.type === 'plugin:dsh-bots/coordinator' && state.group) {
      const parsed = member.safeParse(record.data)
      return parsed.success ? { ...state, group: { ...state.group, coordinator: parsed.data } } : state
    }
    if (record?.type !== 'plugin:dsh-bots/rows' || !state.group) return state
    const parsed = z.array(row).safeParse(record.data)
    if (!parsed.success) return state
    const rows = new Map(state.group.rows.map(value => [value.id, value]))
    for (const value of parsed.data) rows.set(value.id, value)
    return { ...state, group: { ...state.group, rows: [...rows.values()] } }
  },
  wire: {
    summary: false,
    viewSchema: group.nullable() as unknown as NonNullable<Definition['wire']>['viewSchema'],
    view: state => state.group && state.pendingGroup ? {
      ...state.group,
      confirmation: {
        id: confirmationId(state.pendingGroup), ready: Boolean(state.pendingGroup.workspaceId),
        ...(state.pendingGroup.runTask ? { task: state.pendingGroup.topic } : {}),
      },
    } : state.group,
  },
}
