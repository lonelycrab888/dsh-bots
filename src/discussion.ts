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

const newTopic = /(?:换(?:个|一个)?(?:话题|任务)|(?:另一个|另一个新的|新)任务|重新开始|另起话题|与(?:刚才|上面|之前|前面|上一轮).{0,10}无关|不(?:必|用|要)参考(?:上|前|之前|刚才))|\b(?:new (?:topic|task)|unrelated (?:question|topic|task)|switch topics?|start over)\b/iu
const followUp = /(?:继续(?:讨论|分析|补充|细化|说|讲|[。！!？?]|$)|(?:上|前)一(?:条|轮|个(?:方案|建议))|刚才(?:的|说|提|那|讨论)|(?:这|那)(?:个|项|套|一)(?:方案|建议|结论|设计)|(?:该|此)(?:方案|建议|结论|设计)|接着(?:上面|刚才|之前|说|讲)|沿用(?:前|刚才|上)|(?:基于|参考|回应|补充|点评|展开|细化|复核|总结)(?:一下)?(?:上面|前面|刚才|之前|上述|前述)|重启后继续)|\b(?:continue (?:that|the discussion|from)|previous (?:reply|answer|proposal|discussion)|as (?:above|discussed)|following up on|build on (?:that|the previous))\b/iu

export function continuesDiscussion(text: string, steering: boolean): boolean {
  return !newTopic.test(text) && (steering || followUp.test(text))
}

export function discussionInstructions(mayClose: boolean, correction?: string): string {
  const action = '{"kind":"speak","botId":"候选成员的 id","question":"一个问题"}'
  return [
    '你是本场群聊的主持人 KingBot。依据当前议题和已经出现的发言决定下一位最能推进讨论的成员。每次只邀请一位，追问依据、回应分歧或补充缺失的观点。',
    correction && `上一条决定被拒绝（${correction}）。请直接从本轮可发言中重新选一位，复制其 id，输出一个完整的 JSON 对象。`,
    mayClose && !correction
      ? `只输出 ${action}。信息足够时也可以输出 {"kind":"close"}。`
      : `本次必须从本轮可发言中选一位，只输出 ${action}。`,
  ].filter(Boolean).join('\n')
}
