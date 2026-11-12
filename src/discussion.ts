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

export type DiscussionIntent = { kind: 'continue' | 'pause' | 'clarify' } | { kind: 'redirect'; task: string }

const pauseOnly = /^(?:请|麻烦|先|现在|赶紧|马上|立即|可以|就|大家|各位|先让大家|让大家|KingBot|主Bot|[，,\s])*(?:(?:停止|暂停|终止|中止|结束|打断)(?:(?:这轮|本轮|当前|现在的|这次|一下|群聊)\s*)*(?:讨论|发言|派发|回复|任务|生成)?|(?:先)?(?:停|等|缓|等等|停停)(?:一?下|一?会儿?|一?阵|一?分钟)?|到此为止|先到这(?:里|儿)?|(?:不用|不要|别)(?:再|继续)?(?:派发|发言|讨论|继续)(?:任务|了)?)(?:一下|了|吧|好吗|好不好)?[。.!！?？\s]*$/iu
const interruptCues = /(?:停(?:止|顿|下|一[下会])|暂停|别.{0,8}(?:继续|发言|派发|往下|说|聊)|不要.{0,8}(?:继续|发言|派发|往下)|不用.{0,8}(?:继续|发言|派发|往下|做了)|等(?:等|一下|会儿)|慢着|先听我|我(?:自己|先)来|歇(?:一歇|会儿)|先别忙|放一放|先搁置|暂时不|到此为止|先到这|中[止断]|打断|终止|结束(?:现在的|当前|这轮|本轮)?讨论|换(?:个|一个|成|一下|个新的)?(?:方向|任务|话题|思路|议题)|改成|转(?:向|到)|跑偏了|方向不对|取消(?:现在的|当前|这轮|本轮)?(?:讨论|任务)|接下来先)|\b(?:stop|pause|hold on|wait|switch|redirect|change direction|new topic|new task|drop that|set that aside|end (?:the )?discussion)\b/iu

export function explicitDiscussionPause(text: string): boolean {
  const command = text.normalize('NFKC').trim().replace(/^@(?:KingBot|主Bot|Bots\s+King)\s*[，,：:\s]*/i, '')
  return pauseOnly.test(command) ||
    /^(?:(?:这|那)(?:块|部分|个(?:事|话题)|项(?:任务)?)\s*)?(?:先\s*)?(?:放一放|搁置一下)[。.!！\s]*$/u.test(command) ||
    /^(?:please\s+)?(?:stop|pause|hold on|wait|stop now|(?:stop|pause|end) (?:the |this )?(?:discussion|conversation|task)|no more (?:discussion|replies))[.!?\s]*$/i.test(command)
}

export function keepsDiscussionGoing(text: string): boolean {
  return /^(?:(?:别|不要|不用)(?:停下|停止|暂停|停)(?:讨论|发言)?[，,\s]*(?:请)?(?:继续|接着)(?:说|讲|讨论|分析)?|(?:don't|do not) (?:stop|pause)[,;\s]+(?:please )?(?:continue|keep going))[。.!！\s]*$/iu.test(text.normalize('NFKC').trim())
}

export function mayRedirectDiscussion(text: string): boolean {
  const direct = text.normalize('NFKC').replace(/\x60{3}[\s\S]*?(?:\x60{3}|$)|^\s*>[^\n]*|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|\x60[^\x60\n]*\x60/gmu, ' ')
  return !keepsDiscussionGoing(direct) && interruptCues.test(direct)
}

export function parseDiscussionIntent(output: string, message: string): DiscussionIntent {
  const value = JSON.parse(output.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')) as { kind?: unknown; task?: unknown } | null
  if (value?.kind === 'pause' || value?.kind === 'clarify') return { kind: value.kind }
  if (value?.kind === 'redirect' && typeof value.task === 'string') {
    const task = value.task.trim()
    // A redirect is a new user task, not a task invented by the classifier.
    if (task && message.includes(task)) return { kind: 'redirect', task }
  }
  if (value?.kind === 'continue') return { kind: 'continue' }
  throw new Error('无法判断当前消息是否在变更讨论')
}
