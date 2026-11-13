import { realpathSync } from 'node:fs'
export const reservedWorkspaceNotice = 'Bots 工作区仅用于与主 Bot 和子 Bot 独立对话，不能新建普通对话或群聊。请从 Bots 页面进入主 Bot 对话，或切换到其他工作区。'
export function isKingWorkspace(cwd: string | undefined, selected: {path:string} | null | undefined): boolean {
  if (!cwd || !selected) return false
  try { return realpathSync(cwd) === realpathSync(selected.path) } catch { return false }
}
export function assertRootCreation(selected: {path:string;sessionId:string} | null | undefined, request: {cwd?:string;sessionId:string;origin?:string;source:string}, botSessionIds: readonly string[] = []) {
  if (request.origin !== 'subagent' && request.source === 'startup' && isKingWorkspace(request.cwd,selected) && request.sessionId !== selected!.sessionId && !botSessionIds.includes(request.sessionId)) throw new Error(reservedWorkspaceNotice)
}
