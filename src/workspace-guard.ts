export const reservedWorkspaceNotice = 'King Arthur 工作区不允许手动新建会话。请从 Roundtable 打开已有 Bot 独聊；需要普通对话或群聊时，请切换到其他工作区。'

export interface CreateConversationRequest {workspaceId?:string;cwd?:string;sessionId?:string;agentPreset?:string}
export interface ConversationCreator {create(request?:CreateConversationRequest):Promise<string>}

// Stop UI New Session before it asks the host to mint a journal or reuse a
// different Bot's blank conversation. Plugin-owned creation uses host APIs.
export function guardWorkspaceCreation(creator:ConversationCreator, selectedPath:()=>Promise<string|undefined>, pathFor:(id:string)=>string|undefined) {
  const descriptor=Object.getOwnPropertyDescriptor(creator,'create')
  const original=creator.create
  const guarded:ConversationCreator['create']=async request=>{
    const selected=await selectedPath()
    const target=request?.workspaceId?pathFor(request.workspaceId):request?.cwd
    if(selected&&target===selected)throw new Error(reservedWorkspaceNotice)
    return original.call(creator,request)
  }
  Object.defineProperty(creator,'create',{configurable:true,writable:true,value:guarded})
  return ()=>{
    // Cordis returns a fresh method proxy on every read; compare the stored
    // descriptor instead so disabling the plugin restores native creation.
    if(Object.getOwnPropertyDescriptor(creator,'create')?.value!==guarded)return
    if(descriptor)Object.defineProperty(creator,'create',descriptor);else delete (creator as Partial<ConversationCreator>).create
  }
}
