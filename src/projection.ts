import { z } from 'zod'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import type { Group, Member } from './bots.ts'

const botId = z.string()
const member = z.object({ id: botId, name: z.string(), duty: z.string(), sessionId: z.string() })
const row = z.union([
  z.object({ id: z.string(), author: z.enum(['user', 'notice']), text: z.string() }),
  z.object({
    id: z.string(), author: z.literal('bot'), botId, text: z.string(),
    status: z.enum(['working', 'done', 'error', 'stopped']),
  }),
])
const group = z.object({ members: z.array(member), coordinator: member.optional(), rows: z.array(row) })
const stateSchema = z.object({ inherited: z.number(), group: group.nullable() })

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
  }
}

type Definition = ProjectionDefinition<'dshBots', z.infer<typeof stateSchema>>

export const projection: Definition & { wire: NonNullable<Definition["wire"]> } = {
  key: 'dshBots',
  stateVersion: 2,
  stateSchema: stateSchema as unknown as Definition['stateSchema'],
  init: (_header, inherited) => ({ inherited, group: null }),
  apply(state, event) {
    if (event.seq < state.inherited) return state
    const record = pluginRecordOf(event)
    if (record?.type === 'plugin:dsh-bots/members') {
      const parsed = z.array(member).safeParse(record.data)
      return parsed.success
        ? { ...state, group: parsed.data.length ? { members: parsed.data, coordinator: state.group?.coordinator, rows: state.group?.rows ?? [] } : null }
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
    view: state => state.group,
  },
}
