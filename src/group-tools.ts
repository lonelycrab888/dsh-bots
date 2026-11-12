import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { groupRequestSchema, type ExistingGroupRequest } from './existing-groups.ts'

export interface KingGroupTools {
  directory(signal: AbortSignal): Promise<unknown>
  operate(request: ExistingGroupRequest, signal: AbortSignal): Promise<unknown>
}
export function registerKingGroupTools(ctx: Context, tools: KingGroupTools) {
  const output = { schema: { type: 'string' as const }, render: (_: unknown, text: string) => [{ type: 'text' as const, text }] }
  ctx.tools.register(defineTool({
    name: 'list_existing_groups',
    description: 'Find accessible existing groups, their workspace and stable IDs, and the last host-confirmed group for this conversation. Use before creating a replacement group.',
    parameters: {}, output,
    async execute(_, { signal }) { return JSON.stringify(await tools.directory(signal)) },
  }))
  ctx.tools.register(defineTool({
    name: 'operate_existing_group',
    description: 'Read progress/history (inspect), deliver a literal notice (send), continue or correct the existing task (update), or start an explicitly new task (task). Use the host-returned group ID as target, or 这个群 for the last confirmed group. Ambiguous targets require clarification. Only the returned host receipt proves delivery.',
    parameters: {
      kind: { type: 'string', enum: ['locate', 'inspect', 'send', 'task', 'update'], required: true },
      target: { type: 'string', required: true }, workspace: { type: 'string' },
      body: { type: 'string', description: 'Exact user notice or task/requirement, without invented instructions.' },
    }, output,
    async execute(args, { signal }) { return JSON.stringify(await tools.operate(groupRequestSchema.parse(args), signal)) },
  }))
}
