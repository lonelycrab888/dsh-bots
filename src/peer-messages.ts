import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'

export const sendPeerTool = 'send_group_message'
export const acknowledgePeerTool = 'acknowledge_group_message'

const nonceSchema = z.string().min(8).max(96)
export const peerSendInput = z.object({
  visibility: z.enum(['public', 'directed']),
  recipientIds: z.array(z.string()).max(20).optional(),
  text: z.string().min(1).max(4000).refine(text => Boolean(text.trim())),
  nonce: nonceSchema,
  senderTimestamp: z.string().max(64).optional(),
})
export type PeerSendInput = z.infer<typeof peerSendInput>

const sent = z.object({
  kind: z.literal('sent'),
  id: z.string(),
  taskId: z.string(),
  runId: z.string(),
  from: z.string(),
  visibility: peerSendInput.shape.visibility,
  to: z.array(z.string()),
  text: z.string(),
  nonce: nonceSchema,
  senderTimestamp: z.string().optional(),
  sentAt: z.number(),
})
export const peerEventSchema = z.discriminatedUnion('kind', [
  sent,
  z.object({ kind: z.enum(['delivered', 'acknowledged']), id: z.string(), recipient: z.string(), runId: z.string(), at: z.number() }),
])
export type PeerEvent = z.infer<typeof peerEventSchema>
export const peerMessageSchema = sent.extend({
  deliveries: z.record(z.string(), z.object({ deliveredAt: z.number(), acknowledgedAt: z.number().optional() })),
})
export type PeerMessage = z.infer<typeof peerMessageSchema>

export function peerMessageId(group: string, task: string, sender: string, nonce: string) {
  return 'msg-' + createHash('sha256').update(JSON.stringify([group, task, sender, nonce])).digest('hex').slice(0, 32)
}

export function peerReceiptId(messageId: string, recipient: string) {
  return 'ack-' + createHash('sha256').update(JSON.stringify([messageId, recipient])).digest('hex').slice(0, 32)
}

export function sameSend(message: PeerMessage, input: PeerSendInput, to: string[]) {
  return message.text === input.text && message.visibility === input.visibility &&
    message.senderTimestamp === input.senderTimestamp && JSON.stringify(message.to) === JSON.stringify(to)
}

export function peerReceipt(message: PeerMessage, recipient: string) {
  const delivery = message.deliveries[recipient]
  return {
    receiptId: peerReceiptId(message.id, recipient), messageId: message.id,
    recipientId: recipient, fromId: message.from, text: message.text, nonce: message.nonce,
    sentAt: new Date(message.sentAt).toISOString(),
    deliveredAt: new Date(delivery.deliveredAt).toISOString(),
    acknowledgedAt: new Date(delivery.acknowledgedAt!).toISOString(),
    ...(message.senderTimestamp ? { senderTimestamp: message.senderTimestamp } : {}),
  }
}

export interface PeerTools {
  send(input: PeerSendInput, signal: AbortSignal): Promise<unknown>
  acknowledge(id: string, signal: AbortSignal): Promise<unknown>
}

export interface PeerChannel {
  tools: PeerTools
  members: { id: string; name: string }[]
  inbox(): PeerMessage[]
  receipts(): ReturnType<typeof peerReceipt>[]
  deliver(inbox: PeerMessage[]): Promise<void>
  redact(text: string): string
}

export function registerPeerTools(ctx: Context, channel: PeerTools) {
  const output = {
    schema: { type: 'string' as const },
    render: (_: unknown, text: string) => [{ type: 'text' as const, text }],
  }
  ctx.tools.register(defineTool({
    name: sendPeerTool,
    description: 'Post publicly as yourself or deliver a directed message to other child Bots in the current group. The host assigns a message ID and records its state. Sending does not imply delivery or acknowledgement.',
    parameters: {
      visibility: { type: 'string', enum: ['public', 'directed'], required: true },
      recipientIds: { type: 'array', items: { type: 'string' }, description: 'Member IDs from the current group. Required for directed messages. Omit for public posts.' },
      text: { type: 'string', required: true, description: 'Message body, at most 4000 characters.' },
      nonce: { type: 'string', required: true, description: 'A unique reference for this send (8 to 96 characters). Reuse it with identical arguments when retrying.' },
      senderTimestamp: { type: 'string', description: 'Optional sender-supplied timestamp. The host timestamps are recorded separately.' },
    },
    output,
    async execute(input, { signal }) {
      const parsed = peerSendInput.safeParse(input)
      if (!parsed.success) throw new Error('请填写发送范围、正文和本次发送的 nonce。')
      return JSON.stringify(await channel.send(parsed.data, signal))
    },
  }))
  ctx.tools.register(defineTool({
    name: acknowledgePeerTool,
    description: 'Acknowledge a directed message that the host actually included in your model input. Use its exact message ID.',
    parameters: { messageId: { type: 'string', required: true } },
    output,
    async execute({ messageId }, { signal }) {
      return JSON.stringify(await channel.acknowledge(messageId, signal))
    },
  }))
}
