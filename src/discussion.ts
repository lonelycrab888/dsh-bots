import { z } from 'zod'

const step = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('speak'), botId: z.string(), question: z.string().trim().min(1).max(1200) }),
  z.object({ kind: z.literal('close') }),
])

export function parseDiscussionStep(output: string, eligible: readonly string[], mayClose: boolean) {
  let value: unknown
  try { value = JSON.parse(output.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')) }
  catch { throw new Error('主持决定需要使用 JSON 格式') }
  const parsed = step.safeParse(value)
  if (!parsed.success) throw new Error('请只选择下一位发言者和一个问题，或者结束讨论')
  if (parsed.data.kind === 'close' && !mayClose) throw new Error('还有需要听取的成员，请继续主持讨论')
  if (parsed.data.kind === 'speak' && !eligible.includes(parsed.data.botId)) throw new Error('请从本轮允许发言的成员中选择下一位')
  return parsed.data
}
