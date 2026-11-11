import { z } from 'zod'
import { validateLibrary, type Library } from './bots.ts'
import { forgetBotIds, type KingMemory } from './memory.ts'
import type { KingWorkspace } from './config.ts'

export const resetOptions = z.object({ members:z.boolean(), memory:z.boolean(), sessions:z.boolean() }).strict()
  .refine(value=>value.members||value.memory||value.sessions,'请至少选择一个重置项目。')
export type ResetOptions = z.infer<typeof resetOptions>
export interface PendingReset { options:ResetOptions; workspace:KingWorkspace|null }
export interface ResetState {
  library:Library; kingMemory:KingMemory; kingWorkspace:KingWorkspace|null
  resetEpoch:number; sessionEpoch:number; resetPending:PendingReset|null
}
export interface ResetPort {
  read():{state:ResetState;revision:number}
  commit(patch:Partial<ResetState>,revision:number):Promise<void>
  clearMemory(workspace:KingWorkspace|null):Promise<void>
  forgetSessions(workspace:KingWorkspace|null):Promise<void>
}
// Persist intent first: interruption can be resumed without losing the old path
// or allowing a half-reset conversation to execute. Side effects are idempotent.
export async function finishReset(port:ResetPort) {
  const pending=port.read().state.resetPending
  if(!pending)return
  if(pending.options.memory)await port.clearMemory(pending.workspace)
  if(pending.options.sessions)await port.forgetSessions(pending.workspace)
  await port.commit({resetPending:null},port.read().revision)
}
export async function performReset(port:ResetPort,raw:unknown,revision:number) {
  const options=resetOptions.parse(raw),current=port.read()
  if(current.revision!==revision)throw new Error('配置已变更，请刷新后重试。')
  if(current.state.resetPending){await finishReset(port);return}
  if(options.memory&&!current.state.kingWorkspace)throw new Error('请先选择要清空记忆的主 Bot 工作区。')
  const state=current.state,ids=options.members?state.library.bots.map(bot=>bot.id):[]
  const library=options.members?validateLibrary({...state.library,bots:[],deletedBotIds:[...new Set([...state.library.deletedBotIds,...ids])]}):state.library
  const kingMemory=options.memory?{...state.kingMemory,entries:[]}:forgetBotIds(state.kingMemory,ids)
  await port.commit({library,kingMemory,kingWorkspace:options.sessions?null:state.kingWorkspace,
    resetEpoch:state.resetEpoch+1,sessionEpoch:state.sessionEpoch+Number(options.sessions),
    resetPending:{options,workspace:state.kingWorkspace}},revision)
  await finishReset(port)
}
export function sessionIsCurrent(group:{sessionEpoch?:number},epoch:number){return (group.sessionEpoch??0)===epoch}
