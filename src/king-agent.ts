import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const kingInstructions = `你是 KingBot，用户的通用助手。根据用户当前目标自然交流，回答长度和形式随任务需要调整。沿用宿主的工具、工作区和执行规则。
你还可以创建 Bot、创建群聊和向已有群聊发送消息或交办任务。用户提出这些需求时使用对应工具，以工具回执确认结果。管理功能只是可选能力，按用户需要使用。`

export interface KingAgentTools {
  catalog(): unknown
  history(query?: string, messageId?: string, offset?: number): unknown
  createBots(bots: unknown, signal: AbortSignal): Promise<unknown>
  createGroup(proposal: unknown, signal: AbortSignal): Promise<unknown>
  confirmGroup(action: 'confirm' | 'cancel', signal: AbortSignal): Promise<unknown>
  remember(actions: unknown, signal: AbortSignal): Promise<unknown>
}

export function registerKingAgentTools(ctx: Context, port: KingAgentTools) {
  const output = { schema: { type: 'string' as const }, render: (_: unknown, text: string) => [{ type: 'text' as const, text }] }
  const bot = { type: 'object' as const, properties: { name: { type: 'string' as const, required: true as const }, duty: { type: 'string' as const, required: true as const } }, additionalProperties: false as const }
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'read_group_history',
      description: 'Read archived private-chat messages and group receipts in this King conversation. Search by keyword or exact messageId. Use nextOffset to read the rest of a long message.',
      parameters: { query: { type: 'string' }, messageId: { type: 'string' }, offset: { type: 'number' } }, output,
      async execute({ query, messageId, offset }) { return JSON.stringify(port.history(query, messageId, offset)) },
    })),
    ctx.tools.register(defineTool({
      name: 'list_bots_and_workspaces', description: 'List Bot definitions, available group workspaces and any pending group proposal.', parameters: {}, output,
      async execute() { return JSON.stringify(port.catalog()) },
    })),
    ctx.tools.register(defineTool({
      name: 'create_bots', description: 'Create 1–6 Bots requested by the user. Read the catalog first. Include verbatim evidence from the current user request. Names contain letters, digits, underscores or hyphens, at most 24 characters.',
      parameters: { bots: { type: 'array', required: true, items: { ...bot, properties: { ...bot.properties, evidence: { type: 'string', required: true }, reuse: { type: 'boolean' } } } } }, output,
      async execute(args, { signal }) { return JSON.stringify(await port.createBots(args.bots, signal)) },
    })),
    ctx.tools.register(defineTool({
      name: 'create_group', description: 'Create a group requested by the user. Read the catalog first. Supply existing member IDs and optional new Bots. runTask starts discussion and returns results here. If a workspace is missing, returns a pending proposal for clarification. Include verbatim current-request evidence.',
      parameters: {
        title: { type: 'string', required: true }, topic: { type: 'string', required: true },
        memberIds: { type: 'array', items: { type: 'string' }, required: true },
        newBots: { type: 'array', items: bot }, workspaceId: { type: 'string' },
        runTask: { type: 'boolean' }, evidence: { type: 'string', required: true },
      }, output,
      async execute(args, { signal }) { return JSON.stringify(await port.createGroup(args, signal)) },
    })),
    ctx.tools.register(defineTool({
      name: 'resolve_group_proposal', description: 'Confirm or cancel a pending group proposal following the user’s reply. Use create_group to revise its workspace or members.',
      parameters: { action: { type: 'string', enum: ['confirm', 'cancel'], required: true } }, output,
      async execute(args, { signal }) { return JSON.stringify(await port.confirmGroup(args.action as 'confirm' | 'cancel', signal)) },
    })),
    registerPersonalMemoryTool(ctx, port.remember),
  ]
  return () => disposers.forEach(dispose => dispose())
}

export function registerPersonalMemoryTool(ctx: Context, remember: KingAgentTools['remember']) {
  const output = { schema: { type: 'string' as const }, render: (_: unknown, text: string) => [{ type: 'text' as const, text }] }
  return ctx.tools.register(defineTool({
      name: 'update_personal_memory', description: 'Save explicit long-term preferences or background, or forget an entry on request. Up to 3 actions. Evidence must quote the current user message. Consult the injected memory and respect its enabled/automatic-update settings.',
      parameters: { actions: { type: 'array', required: true, items: { type: 'object', properties: { action: { type: 'string', enum: ['remember', 'forget'], required: true }, id: { type: 'string' }, text: { type: 'string' }, evidence: { type: 'string', required: true } }, additionalProperties: false } } }, output,
      async execute(args, { signal }) { return JSON.stringify(await remember(args.actions, signal)) },
    }))
}
