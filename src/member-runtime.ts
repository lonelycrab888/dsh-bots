import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'

export const askGroupUserTool = 'ask_group_user'
export const memberStageSchema = z.enum(['starting', 'model', 'reading', 'tool', 'approval'])
export type MemberStage = z.infer<typeof memberStageSchema>
const outcomeSchema = z.enum([
  'completed', 'error', 'stopped', 'model-timeout', 'tool-timeout',
  'child-deadline', 'host-wait', 'user-question', 'approval-denied',
])
export type MemberOutcome = z.infer<typeof outcomeSchema>
export const memberExecutionSchema = z.object({
  startedAt: z.number(), finishedAt: z.number().optional(),
  stage: memberStageSchema, tool: z.string().optional(), outcome: outcomeSchema.optional(),
})
export type MemberExecution = z.infer<typeof memberExecutionSchema>

type Stop = 'model-timeout' | 'child-deadline' | 'host-wait' | 'user-question'
const limits = { modelQuiet: 30_000, hostQuiet: 45_000, childTotal: 120_000 }
const timeoutCodes = new Set(['TIMEOUT', 'TOOL_TIMEOUT', 'EXEC_TIMEOUT', 'ETIMEDOUT', 'ERR_SCRIPT_EXECUTION_TIMEOUT'])
const approvalCodes = new Set(['APPROVAL_REJECTED', 'APPROVAL_CANCELLED', 'APPROVAL_UNAVAILABLE',
  'SANDBOX_ESCALATION_REJECTED', 'SANDBOX_ESCALATION_UNAVAILABLE'])

export function toolOutcome(code: string) {
  return timeoutCodes.has(code) ? 'tool-timeout' : approvalCodes.has(code) ? 'approval-denied' : undefined
}

export function stageText(stage: MemberStage, tool?: string) {
  if (stage === 'model') return '正在生成…'
  if (stage === 'reading') return '正在读取文件…'
  if (stage === 'approval') return `需要审批${tool ? ' · ' + tool : ''}…`
  if (stage === 'tool' && tool) return `正在使用 ${tool}…`
  return '正在回复…'
}

export function outcomeText(execution: MemberExecution, fallback: string) {
  const suffix = execution.tool ? `（${execution.tool}）` : ''
  switch (execution.outcome) {
    case 'stopped': return '已停止。'
    case 'model-timeout': return '子 Bot 模型无有效输出，模型等待已超时。'
    case 'tool-timeout': return `子 Bot 工具返回超时${suffix}。`
    case 'child-deadline': return `子 Bot 已达到单次运行时限。最后阶段：${stageText(execution.stage, execution.tool).replace(/…$/u, '')}。`
    case 'host-wait': return `KingBot 等待成员结果到期${suffix}，该成员尚未交回结果。`
    case 'approval-denied': return `宿主拒绝该操作${suffix}。需要交互审批时，请在普通对话发起并按宿主提示确认。`
    default: return fallback
  }
}

export class MemberRun {
  private readonly controller = new AbortController()
  private readonly deadline: ReturnType<typeof setTimeout>
  private hostTimer?: ReturnType<typeof setTimeout>
  private modelTimer?: ReturnType<typeof setTimeout>
  private modelActive = false
  private readonly startedAt = Date.now()
  private stage: MemberStage = 'starting'
  private tool?: string
  private failure?: { outcome: 'tool-timeout' | 'approval-denied'; tool: string }
  readonly signal: AbortSignal
  private readonly show: (execution: MemberExecution) => void
  private readonly wait: typeof limits

  constructor(userSignal: AbortSignal, show: (execution: MemberExecution) => void, wait = limits) {
    this.show = show
    this.wait = wait
    this.signal = AbortSignal.any([userSignal, this.controller.signal])
    this.deadline = setTimeout(() => this.stop('child-deadline'), wait.childTotal)
    this.renewHost()
  }

  snapshot(outcome?: MemberOutcome): MemberExecution {
    return {
      startedAt: this.startedAt, stage: this.stage, ...(this.tool ? { tool: this.tool } : {}),
      ...(outcome ? { outcome, finishedAt: Date.now() } : {}),
    }
  }

  progress(stage = this.stage, tool = this.tool) {
    if (this.signal.aborted) return
    if (stage !== this.stage || tool !== this.tool) {
      this.stage = stage
      this.tool = tool
      this.show(this.snapshot())
    }
    this.renewHost()
  }

  beginModel() {
    this.modelActive = true
    this.progress('model', '')
    this.modelOutput()
  }

  modelOutput() {
    if (!this.modelActive || this.signal.aborted) return
    this.progress()
    clearTimeout(this.modelTimer)
    this.modelTimer = setTimeout(() => this.stop('model-timeout'), this.wait.modelQuiet)
  }

  endModel() {
    this.modelActive = false
    clearTimeout(this.modelTimer)
  }

  noteToolFailure(outcome: 'tool-timeout' | 'approval-denied', tool: string) {
    this.failure = { outcome, tool }
  }

  stop(reason: Stop) {
    this.controller.abort(reason)
  }

  result(success: boolean, userStopped: boolean) {
    if (userStopped) return this.snapshot('stopped')
    if (this.controller.signal.aborted) return this.snapshot(this.controller.signal.reason as Stop)
    if (!success && this.failure) return { ...this.snapshot(this.failure.outcome), tool: this.failure.tool }
    return this.snapshot(success ? 'completed' : 'error')
  }

  async race<T>(start: () => Promise<T>) {
    this.signal.throwIfAborted()
    let cancel: () => void
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => reject(this.signal.reason)
      this.signal.addEventListener('abort', cancel, { once: true })
    })
    try { return await Promise.race([start(), interrupted]) }
    finally { this.signal.removeEventListener('abort', cancel!) }
  }

  dispose() {
    clearTimeout(this.deadline)
    clearTimeout(this.hostTimer)
    this.endModel()
  }

  private renewHost() {
    clearTimeout(this.hostTimer)
    this.hostTimer = setTimeout(() => this.stop('host-wait'), this.wait.hostQuiet)
  }
}

export function registerGroupQuestion(ctx: Context, ask: (question: string, signal: AbortSignal) => Promise<string>) {
  ctx.tools.register(defineTool({
    name: askGroupUserTool,
    description: 'Ask the user one concrete question when a missing fact or choice blocks the current group task. The host saves the question, pauses the discussion, and resumes with the user’s answer.',
    parameters: { question: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    execute({ question }, { signal }) {
      const text = question.trim()
      if (!text || text.length > 500) throw new Error('请输入一条具体问题，最多 500 字。')
      return ask(text, signal)
    },
  }))
}
