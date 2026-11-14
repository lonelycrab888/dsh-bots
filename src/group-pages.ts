import { taskDigest } from './tasks.ts'
import type { Group, Row } from './bots.ts'
export const groupPageSize = 80
export function groupPage(rows: readonly Row[], request: {before?:string;around?:string} = {}) {
  const at=request.around ? rows.findIndex(row=>row.id===request.around) : -1
  const before=request.before ? rows.findIndex(row=>row.id===request.before) : rows.length
  if (request.before && before<0 || request.around && at<0) throw new Error('找不到该历史消息，请返回最新记录重试。')
  const end=at>=0 ? Math.min(rows.length,at+Math.floor(groupPageSize/2)) : before
  const start=Math.max(0,end-groupPageSize)
  return {rows:rows.slice(start,end),hasMore:start>0}
}
export function groupWindow(group: Group | null) {
  return group && group.mode!=='king' && group.mode!=='bot'
    ? {...group,rows:groupPage(group.rows).rows,totalRows:group.rows.length} : group
}

export function taskSummary(group: Group, taskId: string) {
  const task = group.tasks?.find(item => item.id === taskId)
  if (!task) throw new Error('找不到该议题。')
  const digest = taskDigest(task, group.rows)
  const userPreview = (rows: typeof digest.user) => rows.slice(-16).map(row => ({...row,text:row.text.slice(0,1200)}))
  return {...digest,
    completedCount:digest.completed.length,
    completed:digest.completed.slice(-32).map(item=>({...item,text:''})),
    user:userPreview(digest.user), constraints:userPreview(digest.constraints), decisions:userPreview(digest.decisions),
    pending:digest.pending.slice(-32),questions:digest.questions.slice(-16).map(text=>text.slice(0,1200)),
    documents:digest.documents.slice(-16),
    result:digest.result ? {...digest.result,reasoning:undefined,text:digest.result.text.slice(0,4000)} : undefined,
  }
}
export type TaskSummary = ReturnType<typeof taskSummary>
