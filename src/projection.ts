import { z } from 'zod'
import { botAvatars } from './avatars.ts'
import type { FileBlock } from '@deepseek-ai/dsh-llm'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import { taskSchema, type DiscussionTask } from './tasks.ts'
import type { Group, Member } from './bots.ts'
import { confirmationId, groupProposalSchema, type GroupProposal } from './group-creation.ts'
import { groupChoiceSchema, groupDeliverySchema, type GroupDelivery } from './existing-groups.ts'

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
  z.object({ id: z.string(), author: z.literal('user'), text: z.string(), continues: z.literal(true).optional(), control: z.literal(true).optional(), documents: z.array(document).optional() }),
  z.object({ id: z.string(), author: z.literal('notice'), text: z.string(), sessionId: z.string().optional(), tone: z.literal('info').optional(), taskLink: z.string().optional(), groupReference: z.literal(true).optional() }),
  z.object({
    id: z.string(), author: z.literal('bot'), botId, text: z.string(),
    status: z.enum(['working', 'done', 'error', 'stopped']), taskId: z.string().optional(), resultKind: z.enum(['partial', 'final']).optional(), sessionId: z.string().optional(),
    literal: z.literal(true).optional(), privateToKing: z.literal(true).optional(), groupReference: z.literal(true).optional(),
  }),
])
const group = z.object({ sessionEpoch:z.number().int().nonnegative().optional(), mode: z.enum(['group','king']).optional(), members: z.array(member), coordinator: member.optional(), rows: z.array(row), brief: z.string().optional(), tasks: z.array(taskSchema).optional(), activeTaskId: z.string().optional(), confirmation: z.object({ id: z.string(), ready: z.boolean(), task: z.string().optional() }).optional() })
const stateSchema = z.object({
  inherited: z.number(), group: group.nullable(), pendingGroup: groupProposalSchema.nullish(),
  groupChoice: groupChoiceSchema.nullish(), groupDeliveries: z.array(groupDeliverySchema).optional(),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dshBots: SessionProjectionSummaryExcluded<Group> | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dsh-bots/members': Group['members']
    'plugin:dsh-bots/rows': Group['rows']
    'plugin:dsh-bots/coordinator': Member
    'plugin:dsh-bots/king': { mode: 'king' }
    'plugin:dsh-bots/epoch': { value:number }
    'plugin:dsh-bots/group-proposal': { proposal: GroupProposal | null }
    'plugin:dsh-bots/existing-group-choice': { choice: z.infer<typeof groupChoiceSchema> | null }
    'plugin:dsh-bots/existing-group-delivery': GroupDelivery
    'plugin:dsh-bots/task': { task: DiscussionTask; active: boolean }
    'plugin:dsh-bots/group-brief': { text: string }
  }
}

type Definition = ProjectionDefinition<'dshBots', z.infer<typeof stateSchema>>

export const projection: Definition & { wire: NonNullable<Definition["wire"]> } = {
  key: 'dshBots',
  stateVersion: 13,
  stateSchema: stateSchema as unknown as Definition['stateSchema'],
  init: (_header, inherited) => ({ inherited, group: null }),
  apply(state, event) {
    if (event.seq < state.inherited) return state
    const record = pluginRecordOf(event)
    if(record?.type==='plugin:dsh-bots/epoch' && state.group){
      const parsed=z.object({value:z.number().int().nonnegative()}).safeParse(record.data)
      return parsed.success?{...state,group:{...state.group,sessionEpoch:parsed.data.value}}:state
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
