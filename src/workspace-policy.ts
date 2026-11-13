import { realpathSync } from 'node:fs'
import { reservedWorkspaceNotice } from './workspace-guard.ts'
export { reservedWorkspaceNotice } from './workspace-guard.ts'
export function isKingWorkspace(cwd: string | undefined, selected: {path:string} | null | undefined): boolean {
  if (!cwd || !selected) return false
  try { return realpathSync(cwd) === realpathSync(selected.path) } catch { return false }
}
export function assertRootCreation(selected: {path:string;sessionId:string} | null | undefined, request: {cwd?:string;sessionId:string;origin?:string;source:string}, botSessionIds: readonly string[] = []) {
  if (request.origin !== 'subagent' && request.source === 'startup' && isKingWorkspace(request.cwd,selected) && request.sessionId !== selected!.sessionId && !botSessionIds.includes(request.sessionId)) throw new Error(reservedWorkspaceNotice)
}
