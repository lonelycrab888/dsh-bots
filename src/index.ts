import { performReset, finishReset, sessionIsCurrent, resetOptions, type ResetPort } from './reset.ts'
import { WorkspaceVisibility, type WorkspaceRegistryPort } from './workspace-visibility.ts'
import { assertRootCreation, isKingWorkspace, reservedWorkspaceNotice } from './workspace-policy.ts'
import { modelForBot, availableMembers, redactDeletedBotIds, freshCoordinator } from './bots.ts'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { KING_REMOTE, kingRequest } from './king-remote.ts'
import { WorkspaceMemory } from './workspace-memory.ts'
import { realpathSync, existsSync, statSync } from 'node:fs'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendPluginRecord, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import { memoryContext, memoryInstructions, validateMemory, type KingMemory } from './memory.ts'
import { coordinatorId, coordinatorName, coordinatorDuty, legacyCoordinatorName, discussionTopic, isBotCreationRequest, parsePlan, resolveTargets, selectMembers, validateLibrary, createRequestedBots, type Group, type Member, type Row } from './bots.ts'
import { projection } from './projection.ts'
import type { Config, KingWorkspace } from './config.ts'
import { describeGroupProposal, groupReply, proposeGroup, validateGroupMembers } from './group-creation.ts'
import { parseDiscussionStep } from './discussion.ts'
export { Config } from './config.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-bots/group-created': { kind: 'dsh-bots/group-created' }
  }
}

export const name = 'dsh-bots'
export const inject = ['agents', 'commands', 'sessionProjections', 'sessions', 'sessionPersistence', 'systemPrompt', 'tools', 'settings', 'typert', 'workspaceRegistry']

export async function apply(ctx: Context, config: Config) {
  const groups = await ctx.sessionProjections.register(projection)
  const lifetime = new AbortController()
  const activeTurns = new Map<AbortController, string>()
  const stores = new Map<string, WorkspaceMemory>()
  const visibility = new WorkspaceVisibility(ctx.get('workspaceRegistry') as unknown as WorkspaceRegistryPort)
  let resetting=false
  const resetPort:ResetPort={
    read:()=>({state:{library:validateLibrary(config.library.get()),kingMemory:validateMemory(config.kingMemory.get()),kingWorkspace:config.kingWorkspace.get(),resetEpoch:config.resetEpoch.get(),sessionEpoch:config.sessionEpoch.get(),resetPending:config.resetPending.get()},revision:ctx.settings.describe().find(entry=>entry.ns==='dsh-bots')!.revision}),
    commit:async(patch,revision)=>{await ctx.settings.update('dsh-bots',patch,revision)},
    clearMemory:async(selected)=>{
      if(!selected||!existsSync(selected.path))return
      const store=stores.get(selected.path)??new WorkspaceMemory(selected.path);stores.set(selected.path,store);store.reset()
    },
    forgetSessions:async(selected)=>{if(selected)await visibility.forget(selected.path)},
  }
  let recovery:Promise<void>|undefined,recoveryError=''
  // Settings only exposes a namespace once its Cordis fiber is active.
  ctx.on('internal/status',fiber=>{
    if(fiber!==ctx.fiber||fiber.state!==2||recovery)return
    resetting=true
    recovery=(async()=>{
      await finishReset(resetPort)
      const selected=config.kingWorkspace.get()
      if(!selected)return
      if(existsSync(selected.path))await visibility.show(selected.path,selected.sessionId)
      else{
        await visibility.forget(selected.path)
        await resetPort.commit({kingWorkspace:null,sessionEpoch:config.sessionEpoch.get()+1,resetEpoch:config.resetEpoch.get()+1},resetPort.read().revision)
      }
    })().catch(error=>{recoveryError=error instanceof Error?error.message:String(error)}).finally(()=>{resetting=false})
  })
  ctx.effect(()=>async()=>{
    lifetime.abort()
    const selected=config.kingWorkspace.get()
    if(selected)await visibility.hide(selected.path)
  })
  const workspace = () => {
    const raw = config.kingWorkspace.get()
    if (!raw?.path || !raw.sessionId) throw new Error('请先在 Bots 页面选择 KingBot 的专属工作区。')
    return raw
  }
  const storeFor = () => {
    const selected = workspace()
    let store = stores.get(selected.path)
    if (!store) { store = new WorkspaceMemory(selected.path); stores.set(selected.path, store) }
    store.retireIds(config.library.get().deletedBotIds)
    return store
  }
  const contextRevision=()=>config.library.get().deletedBotIds.length+config.resetEpoch.get()
  const generation = () => JSON.stringify([contextRevision(),config.sessionEpoch.get(),config.kingWorkspace.get()?.path ?? ''])
  ctx.effect(() => () => { for (const store of stores.values()) store.close(); stores.clear() })
  ctx.on('settings/document-updated', ns => {
    if (ns !== 'dsh-bots') return
    const revision = generation()
    for (const [controller, started] of activeTurns) if (started !== revision) controller.abort()
  })
  ctx.effect(() => () => lifetime.abort())

  async function saveMemories(base: KingMemory, actions: unknown, text: string, parent: Agent, signal: AbortSignal, revision: number): Promise<string> {
    signal.throwIfAborted()
    const result = storeFor().applyActions(actions,text,String(parent.id),base,revision)
    return result.changed ? `长期记忆已更新：保存 ${result.remembered} 条，移出 ${result.forgotten} 条。` : '已有相同记忆，本轮没有重复保存。'
  }

  const kingService = {
    ctx,
    async reset(input:unknown){
      try{
        await recovery
        const request=z.object({options:resetOptions,revision:z.number().int(),confirmation:z.literal('RESET')}).parse(input)
        if(resetting||activeTurns.size)throw new Error('请先停止正在执行的 Bot 任务，再重置。')
        resetting=true
        try{await performReset(resetPort,request.options,request.revision);recoveryError=''}finally{resetting=false}
        return {kind:'success',text:JSON.stringify({reset:true})}
      }catch(error){return {kind:'error',text:error instanceof Error?error.message:String(error)}}
    },
    async manage(agent: Agent, input: unknown) {
      try {
        await recovery
        if(recoveryError)throw new Error('工作区恢复未完成：'+recoveryError+'。可使用重置功能解除旧会话关联。')
        if(resetting||config.resetPending.get())throw new Error('重置尚未完成，请先在 Bots 页面重试重置。')
        const request = kingRequest.parse(input)
        if (agent.session.header.origin === 'subagent') throw new Error('请在主 Bot 专属窗口操作。')
        if (request.action === 'configure' || request.action === 'bind') {
          if (agent.status !== 'idle' || ctx.agents.turnBoundaryOf(agent.session).lastTurn !== 0) throw new Error('请使用新建的主 Bot 对话。')
          const path = realpathSync(request.path ?? workspace().path)
          if ((agent.session.header.cwd ? realpathSync(agent.session.header.cwd) : '') !== path) throw new Error('会话工作区与所选目录不一致。')
          if (activeTurns.size) throw new Error('请先停止正在执行的群聊，再切换工作区。')
          const entry = ctx.settings.describe().find(entry => entry.ns === 'dsh-bots')!
          if (request.revision !== undefined && request.revision !== entry.revision) throw new Error('配置已变更，请刷新。')
          const store = stores.get(path) ?? new WorkspaceMemory(path); stores.set(path,store)
          if (!config.kingWorkspace.get()?.legacyImported) store.importLegacy(validateMemory(config.kingMemory.get()))
          const previousWorkspace=config.kingWorkspace.get()
          const selected: KingWorkspace = { path, sessionId:String(agent.id), legacyImported:true }
          await ctx.settings.update('dsh-bots',{kingWorkspace:selected},entry.revision)
          appendPluginRecord(agent.session,'plugin:dsh-bots/king',{mode:'king'})
          appendPluginRecord(agent.session,'plugin:dsh-bots/epoch',{value:config.sessionEpoch.get()})
          ensureCoordinator(agent)
          ctx.get('sessionTitle')?.rename(agent.session, coordinatorName)
          await ctx.sessions.flush(agent.session)
          await visibility.show(path,selected.sessionId)
          if(previousWorkspace&&previousWorkspace.path!==path)await visibility.hide(previousWorkspace.path)
          return { kind:'success', text:JSON.stringify(selected) }
        }
        if (groups.stateOf(agent.session).group?.mode !== 'king' || (agent.session.header.cwd ? realpathSync(agent.session.header.cwd) : '') !== workspace().path) throw new Error('请打开当前工作区的 KingBot 专属对话。')
        const store = storeFor()
        if (request.action === 'settings') {
          const entry=ctx.settings.describe().find(entry=>entry.ns==='dsh-bots')!
          await ctx.settings.update('dsh-bots',{kingMemory:{enabled:request.enabled ?? config.kingMemory.get().enabled,autoRemember:request.autoRemember ?? config.kingMemory.get().autoRemember}},entry.revision)
        }
        if (request.action === 'edit') {
          const action=z.object({id:z.string().optional(),text:z.string().trim().min(1).max(600).optional(),archived:z.boolean().optional(),pinned:z.boolean().optional()}).parse(request.entry)
          if (request.revision===undefined) throw new Error('请先读取记忆版本。')
          store.edit(action,request.revision)
        }
        const value=request.action==='export' ? {path:store.export()} : store.list(request.query,request.archived,request.offset)
        return { kind:'success', text:JSON.stringify(value) }
      } catch(error) { return {kind:'error',text:error instanceof Error?error.message:String(error)} }
    },
  }
  ctx.provide('dshBots', Object.assign(kingService, {typertRemote:bindTypertRemote(kingService,'dshBots')}))
  ctx.typert.register({package:'dsh-bots',face:'host',schemas:[],model:{services:[],events:[],objects:[]},invocations:KING_REMOTE.descriptors})

  function addRows(agent: Agent, rows: Row[]) {
    appendPluginRecord(agent.session, 'plugin:dsh-bots/rows', rows)
  }

  async function checkpointBotSession(agent: Agent) {
    // The sidebar reads the host's cached title on cold sessions. Checkpoint
    // plugin-only turns before they can be mistaken for a blank conversation.
    const cache = ctx.get('sessionProjectionCache') as { write(session: Agent['session']): Promise<void> } | undefined
    try {
      if (cache) {
        await cache.write(agent.session)
        return
      }
    } catch (error) {
      ctx.logger.warn(`dsh-bots: could not checkpoint the session title: ${String(error)}`)
    }
    await ctx.sessions.flush(agent.session)
  }

  ctx.commands.register({
    name: 'dsh-bots',
    description: '为当前空白会话选择群聊成员。',
    input: { hint: '<default|Bot IDs>' },
    recordInput: false,
    async handler({ agent, rawInput }) {
      if(resetting||config.resetPending.get())return {kind:'error',text:'请先完成重置。'}
      if (agent.session.header.origin === 'subagent' || agent.status !== 'idle'
          || ctx.agents.turnBoundaryOf(agent.session).lastTurn !== 0) {
        return { kind: 'error', text: '请在新建会话发出第一条消息前选择群聊模式。' }
      }
      if (isKingWorkspace(agent.session.header.cwd, config.kingWorkspace.get())) return {kind:'error',text:reservedWorkspaceNotice}
      const input = rawInput.trim()
      const ids = input === 'default' ? [] : [...new Set(input.split(','))]
      const previous = groups.stateOf(agent.session).group?.members ?? []
      let members: Member[]
      try {
        members = selectMembers(ids, config.library.get(), previous, randomUUID)
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
      appendPluginRecord(agent.session, 'plugin:dsh-bots/members', members)
      if (members.length){appendPluginRecord(agent.session,'plugin:dsh-bots/epoch',{value:config.sessionEpoch.get()});ensureCoordinator(agent)}
      await ctx.sessions.flush(agent.session)
      return { kind: 'success' }
    },
  })

  // On restore a committed user message stays visible even if the process died
  // before the matching model reply settled. Never replay a billable request.
  ctx.on('agent/created', async ({ agent, source }) => {
    assertRootCreation(config.kingWorkspace.get(), {cwd:agent.session.header.cwd,sessionId:String(agent.id),origin:agent.session.header.origin,source})
    if (agent.session.header.origin === 'subagent') return undefined
    const group = groups.stateOf(agent.session).group
    const titles = ctx.get('sessionTitle')
    const rename = group?.mode === 'king' && String(agent.id) === config.kingWorkspace.get()?.sessionId
      && titles?.get(agent.session)?.title === legacyCoordinatorName
    if (rename) titles?.rename(agent.session, coordinatorName)
    const pending = group?.rows.flatMap<Row>(row =>
      row.author === 'bot' && row.status === 'working'
        ? [{ ...row, status: 'stopped', text: '上一轮在宿主关闭时中断。' }]
        : [])
    if (pending?.length) addRows(agent, pending)
    if (rename || pending?.length) await ctx.sessions.flush(agent.session)
    return undefined
  })

  ctx.on('agent/pre-step', async ({ agent, messages, signal, modelSelection }, next) => {
    const existingGroup=groups.stateOf(agent.session).group
    if(agent.session.header.origin!=='subagent'&&existingGroup&&(resetting||config.resetPending.get()||!sessionIsCurrent(existingGroup,config.sessionEpoch.get()))){
      const text=resetting||config.resetPending.get()?'重置尚未完成，请在 Bots 页面重试。':'旧会话关联已重置，此会话仅保留历史。请从 Bots 页面创建新的主 Bot 对话，或在其他工作区新建群聊。'
      addRows(agent,[{id:randomUUID(),author:'notice',text}]);await ctx.sessions.flush(agent.session);return {kind:'reject'}
    }
    if (agent.session.header.origin !== 'subagent' && isKingWorkspace(agent.session.header.cwd,config.kingWorkspace.get()) && groups.stateOf(agent.session).group?.mode !== 'king') {
      if (!groups.stateOf(agent.session).group) throw new Error(reservedWorkspaceNotice)
      for (const message of messages.filter(item=>item.source.kind==='user')) {
        const text=message.content.flatMap(block=>block.type==='text'?[block.text]:[]).join('\n')
        addRows(agent,[{id:message.id,author:'user',text},{id:`${message.id}:reserved`,author:'notice',text:reservedWorkspaceNotice}])
      }
      await ctx.sessions.flush(agent.session)
      return {kind:'reject'}
    }
    if (!groups.stateOf(agent.session).group) return next()

    // Reject the root model step after routing the native composer input.
    // An empty accepted batch can be refilled by other pre-step listeners.
    const userMessages = messages.filter(message => message.source.kind === 'user')
    const turnSignal = AbortSignal.any([signal, lifetime.signal])
    for (const message of userMessages) {
      const group = groups.stateOf(agent.session).group
      if (!group) break
      const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
      if (text && group.rows.length === 0 && !group.brief) {
        const label = Array.from(text.replace(/\s+/gu, ' ')).slice(0, 30).join('')
        ctx.get('sessionTitle')?.rename(agent.session, group.mode === 'king' ? coordinatorName : `群聊 · ${label}`)
      }
      if (message.content.some(block => block.type !== 'text')) {
        addRows(agent, [
          { id: message.id, author: 'user', text: text || '（附件）' },
          { id: `${message.id}:notice`, author: 'notice', text: '群聊原型只支持文本，附件没有发送给 Bot。' },
        ])
        await ctx.sessions.flush(agent.session)
        continue
      }
      if (text) await dispatch(agent, group, message.id, text, modelSelection, turnSignal)
    }
    return { kind: 'reject' }
  })

  function ensureCoordinator(agent: Agent): Member {
    const group = groups.stateOf(agent.session).group!
    const member = freshCoordinator(group.coordinator, contextRevision(), group.rows.length, randomUUID, config.kingWorkspace.get()?.path)
    if (JSON.stringify(member) !== JSON.stringify(group.coordinator)) {
      if (group.mode !== 'king' && group.members.length && member.sessionId !== group.coordinator?.sessionId) {
        appendPluginRecord(agent.session, 'plugin:dsh-bots/members', group.members.map(bot => ({ ...bot, sessionId: randomUUID() })))
      }
      appendPluginRecord(agent.session, 'plugin:dsh-bots/coordinator', member)
    }
    return member
  }

  function groupWorkspaces() {
    const king = config.kingWorkspace.get()
    return ctx.workspaceRegistry.list().filter(workspace => {
      if (isKingWorkspace(workspace.path, king)) return false
      try { return statSync(workspace.path).isDirectory() } catch { return false }
    })
  }

  async function replyToGroupProposal(parent: Agent, reply: NonNullable<ReturnType<typeof groupReply>>, planner: Extract<Row, { author: 'bot' }>, signal: AbortSignal) {
    const proposal = groups.stateOf(parent.session).pendingGroup
    if (!proposal) return '当前没有待确认的建群方案。可以先告诉 KingBot 想讨论什么或完成什么任务。'
    if (reply.kind === 'cancel') {
      appendPluginRecord(parent.session, 'plugin:dsh-bots/group-proposal', { proposal: null })
      return '已取消建群方案。'
    }
    const workspaces = groupWorkspaces()
    if (reply.kind === 'workspace') {
      const matches = workspaces.filter(workspace => workspace.title.normalize('NFKC') === reply.name || workspace.path.normalize('NFKC') === reply.name)
      const { workspaceId: _previousWorkspaceId, ...details } = proposal
      const selected = matches.length === 1 ? { ...details, workspaceId: matches[0].id } : details
      appendPluginRecord(parent.session, 'plugin:dsh-bots/group-proposal', { proposal: selected })
      const description = describeGroupProposal(selected, workspaces)
      return matches.length === 1 ? description : '请用「工作区：完整路径」选择一个普通工作区。\n\n' + description
    }
    const workspace = workspaces.find(workspace => workspace.id === proposal.workspaceId)
    if (!workspace) return '请先确认目标工作区。\n\n' + describeGroupProposal(proposal, workspaces)
    const sessions = ctx.get('sessionController')
    if (!sessions) throw new Error('当前宿主无法创建会话，请从桌面或 Web 的工作区新建群聊')

    const sessionId = SessionId(proposal.sessionId)
    const alreadyStored = await ctx.sessionPersistence.stat(sessionId)
    let target = ctx.agents.get(sessionId)
    if (!target && alreadyStored) {
      const resolved = await sessions.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      target = resolved.agent
    }
    if (target && target.session.header.cwd !== workspace.path) throw new Error('这份建群方案已绑定另一个工作区，请重新拟定方案')
    signal.throwIfAborted()
    const entry = ctx.settings.describe().find(entry => entry.ns === 'dsh-bots')!
    const members = validateGroupMembers(proposal, validateLibrary(config.library.get()))
    if (members.added.length) {
      await ctx.settings.mutate('dsh-bots', [{ op: 'set', path: ['library'], value: members.library }], entry.revision)
    }
    signal.throwIfAborted()
    if (!target) {
      const created = await sessions.create({ sessionId, workspaceId: workspace.id })
      if (created.sessionId !== sessionId) throw new Error('群聊会话身份已变更，请重新拟定建群方案')
      target = ctx.agents.get(sessionId)
      if (!target) throw new Error('新群聊已登记，请回复「确认建群」继续初始化')
    } else if (!workspace.sessionIds.includes(sessionId)) {
      await workspace.attachSession(sessionId)
    }
    if (!groups.stateOf(target.session).group?.brief) {
      const saved = groups.stateOf(target.session).group?.members ?? []
      if (ctx.agents.turnBoundaryOf(target.session).lastTurn !== 0) throw new Error('目标会话已开始，请重新拟定建群方案')
      appendPluginRecord(target.session, 'plugin:dsh-bots/members', selectMembers(members.ids, members.library, saved, randomUUID))
      appendPluginRecord(target.session, 'plugin:dsh-bots/epoch', { value: config.sessionEpoch.get() })
      ensureCoordinator(target)
      appendPluginRecord(target.session, 'plugin:dsh-bots/group-brief', { text: proposal.topic })
      ctx.get('sessionTitle')?.rename(target.session, `群聊 · ${proposal.title}`)
      await checkpointBotSession(target)
    }
    if (!proposal.runTask && ctx.agents.turnBoundaryOf(target.session).lastTurn === 0) {
      // Harness hides and reuses blank sessions. This internal activation is
      // intercepted by the group pre-step hook without dispatching a message.
      target.followup(createUserMessage({ source: { kind: 'dsh-bots/group-created' }, content: [] }))
      await target.whenIdle()
      await checkpointBotSession(target)
    }
    appendPluginRecord(parent.session, 'plugin:dsh-bots/group-proposal', { proposal: null })
    const opened = `已在「${workspace.title}」创建群聊「${proposal.title}」。`
    addRows(parent, [{ id: `${planner.id}:group`, author: 'notice', text: opened, sessionId }])
    await ctx.sessions.flush(parent.session)
    if (!proposal.runTask) return '群成员已就位，可以打开群聊发送消息。'

    signal.throwIfAborted()
    if (target.status !== 'idle' || ctx.agents.turnBoundaryOf(target.session).lastTurn !== 0) {
      return '群聊中已有新消息，请打开群聊继续任务。'
    }
    addRows(parent, [{ ...planner, text: '群聊正在讨论，完成后会在这里返回结论…' }])
    const mentions = [...proposal.members, ...proposal.newBots].map(member => `@${member.name}`).join(' ')
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: `${mentions}\n${proposal.topic.replace(/@/g, '＠')}` }],
    })
    const cancel = () => target.cancel({ kind: 'user' })
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      target.followup(message)
      await target.whenIdle()
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', cancel)
    }
    const summary = groups.stateOf(target.session).group?.rows.find(row => row.id === `${message.id}:summary`)
    return summary?.author === 'bot' && summary.status === 'done'
      ? `群聊结论：\n${summary.text}`
      : '群聊已建立，本次讨论未产生完整结论。请打开群聊查看进度或继续讨论。'
  }

  async function dispatch(parent: Agent, group: Group, id: string, text: string, model: ModelSelection, signal: AbortSignal) {
    signal.throwIfAborted()
    try {
      const selected = workspace()
      if (group.mode === 'king' && (parent.session.header.cwd ? realpathSync(parent.session.header.cwd) : '') !== selected.path) throw new Error('工作区已切换，请从 Bots 页面打开当前主 Bot 对话。')
    } catch(error) {
      addRows(parent,[{id,author:'user',text},{id:`${id}:notice`,author:'notice',text:(error as Error).message}])
      await ctx.sessions.flush(parent.session); return
    }
    const main = ensureCoordinator(parent)
    group = { ...groups.stateOf(parent.session).group!, coordinator: main, members: availableMembers(groups.stateOf(parent.session).group!, validateLibrary(config.library.get())) }
    addRows(parent, [{ id, author: 'user', text }])
    const discussing = group.mode !== 'king' && group.members.length > 0
    const topic = discussing ? discussionTopic(text) ?? text : text
    let required: Member[]
    try {
      required = group.mode === 'king' ? [] : resolveTargets(topic, group.members)
      if (!topic) throw new Error('请填写要讨论的议题。')
    } catch (error) {
      addRows(parent, [{ id: `${id}:notice`, author: 'notice', text: (error as Error).message }])
      await ctx.sessions.flush(parent.session)
      return
    }
    text = redactDeletedBotIds(text, config.library.get().deletedBotIds)
    const controller = new AbortController()
    const revision = generation()
    activeTurns.set(controller, revision)
    signal = AbortSignal.any([signal, controller.signal])
    const planner: Extract<Row, { author: 'bot' }> = { id: `${id}:plan`, author: 'bot', botId: main.id, status: 'working', text: discussing ? '正在组织讨论…' : '正在思考…' }
    const current = () => ({ ...groups.stateOf(parent.session).group!, members: group.members })
    addRows(parent, [planner])
    async function runMember(member: Member, row: Extract<Row, { author: 'bot' }>, prompt: string, instructions?: string) {
      signal.throwIfAborted()
      addRows(parent, [row])
      await ctx.sessions.flush(parent.session)
      let result: typeof row
      try {
        const reply = await askBot(parent, current(), member, prompt, model, signal, instructions)
        result = { ...row, status: 'done', text: reply }
      } catch (error) {
        result = { ...row, status: signal.aborted ? 'stopped' : 'error', text: signal.aborted ? '已停止。' : (error as Error).message }
      }
      addRows(parent, [result])
      await ctx.sessions.flush(parent.session)
      return result
    }

    async function summarize(prompt: string, instructions: string) {
      signal.throwIfAborted()
      const summary: Row = { id: `${id}:summary`, author: 'bot', botId: main.id, status: 'working', text: '正在汇总结果…' }
      addRows(parent, [summary])
      await ctx.sessions.flush(parent.session)
      const answer = await askBot(parent, current(), main, prompt, model, signal, instructions)
      addRows(parent, [{ ...summary, status: 'done', text: answer }])
    }

    async function moderate(subject: string) {
      const participants = required.length ? required : group.members
      const transcript: { botId: string; name: string; question: string; status: string; text: string }[] = []
      const invitations = new Map<string, number>()
      const maxTurns = participants.length === 1 ? 1 : participants.length + 2
      for (let turn = 0; turn < maxTurns; turn++) {
        signal.throwIfAborted()
        const uncalled = participants.filter(member => !invitations.has(member.id))
        let eligible = participants.filter(member => (invitations.get(member.id) ?? 0) < 2)
        if (required.length && uncalled.length >= maxTurns - turn) eligible = uncalled
        if (!eligible.length) break
        const last = transcript.at(-1)?.botId
        if (eligible.length > 1) eligible = eligible.filter(member => member.id !== last)
        const distinctReplies = new Set(transcript.filter(item => item.status === 'done').map(item => item.botId)).size
        const covered = required.length ? uncalled.length === 0 : invitations.size >= 2
        const mayClose = covered && (distinctReplies >= 2 || uncalled.length === 0)
        const prompt = JSON.stringify({
          议题: subject,
          本轮可发言: eligible.map(({ id, name, duty }) => ({ id, name, duty })),
          尚未发言: uncalled.map(member => member.name),
          允许收束: mayClose,
          已有讨论: transcript,
        })
        const instructions = '你是本场群聊的主持人 KingBot。不要预先列出步骤或分派任务清单。每次先听取已有发言，再决定下一位最能推进讨论的成员，围绕其职责提出一个开放问题、请其回应分歧或追问证据。允许收束且信息足够时结束。只输出 {"kind":"speak","botId":"ID","question":"问题"} 或 {"kind":"close"}。'
        const parse = (output: string) => parseDiscussionStep(output, eligible.map(member => member.id), mayClose)
        let step
        const output = await askBot(parent, current(), main, prompt, model, signal, instructions)
        try {
          step = parse(output)
        } catch (error) {
          step = parse(await askBot(parent, current(), main, `${prompt}\n上次主持决定：${(error as Error).message}。请修正。`, model, signal, instructions))
        }
        if (step.kind === 'close') break
        const speaker = eligible.find(member => member.id === step.botId)!
        invitations.set(speaker.id, (invitations.get(speaker.id) ?? 0) + 1)
        addRows(parent, [{ ...planner, id: turn ? `${id}:moderator:${turn}` : planner.id, status: 'done', text: `请 @${speaker.name} 发言：${step.question}` }])
        const result = await runMember(speaker,
          { id: `${id}:discussion:${turn}`, author: 'bot', botId: speaker.id, status: 'working', text: '正在回复…' },
          JSON.stringify({ 议题: subject, KingBot主持提问: step.question, 已有讨论: transcript }),
          '你正在参加 KingBot 主持的讨论。回答当前问题，并尽可能针对已有发言给出赞同、质疑、修正或补充及理由。可以点名其他成员。只发一条推进讨论的回复。')
        transcript.push({ botId: speaker.id, name: speaker.name, question: step.question, status: result.status, text: result.text.slice(0, 1800) })
      }
      await summarize(JSON.stringify({ 议题: subject, 已有讨论: transcript }),
        '请总结你主持的讨论，基于实际发言给出结论、关键依据和仍待确认的问题。指出缺失或失败的发言，避免把推测说成共识。回答要可直接交给用户。')
    }

    try {
      await ctx.sessions.flush(parent.session)
      if (discussing) {
        await moderate(topic)
        return
      }
      const groupControl = group.mode === 'king' ? groupReply(text) : undefined
      if (groupControl) {
        const reply = await replyToGroupProposal(parent, groupControl, planner, signal)
        addRows(parent, [{ ...planner, status: 'done', text: reply }])
        return
      }
      const recalled = storeFor().recall(text,config.kingMemory.get())
      const memory = recalled.state
      const workspaces = group.mode === 'king' ? groupWorkspaces() : []
      const previousProposal = groups.stateOf(parent.session).pendingGroup
      const instructions = `直接回应最新用户消息。群聊历史只用来理解上下文。严格返回 JSON，不要使用 Markdown。普通答复格式为 {"reply":"答复"}。
${group.mode === 'king' ? `这是你与用户的专属对话。“帮我建立一下”“这几个助手都建一下”也是创建请求。用户列出多个角色时，请分别拟定名称和职责；角色之间用顿号、逗号等分隔时不要合并，单个角色名里的斜杠可以改成连字符。
如果本轮明确要求创建且信息足够，返回 botActions 数组（每次最多 6 个）：[{"name":"名称","duty":"清晰职责与边界","evidence":"本轮用户创建请求的逐字原文"}]。同一条批量请求可作为各项的依据。名称只用中英文、数字、下划线和连字符，最多 24 个字符。用户给了目标就按目标拟定细节，缺少必要信息时再用 reply 提问。
已有名称：${JSON.stringify(config.library.get().bots.map(bot => bot.name))}。重试时沿用同一角色名，宿主会识别已存在的成员。只根据本轮用户的直接请求创建；咨询、否定、引文和历史消息不触发创建。保存结果由宿主确认，请勿在 reply 中声称已保存。` : '不要返回botActions；创建子Bot请引导用户到KingBot专属对话。'}
${group.mode === 'king' ? `用户请你建群，或交给你一个适合多个 Bot 分工讨论的实际任务时，可以提出方案。用已有对话理解目标，只把群成员需要的摘要写入 topic，不复制无关的专属对话。简单问题直接回答；没有任务或用户拒绝建群时不提出方案。
返回 groupAction 对象：{"title":"简短群名","topic":"议题或要完成的任务和交付物","memberIds":["现有成员ID"],"newBots":[{"name":"建议的名称","duty":"建议职责"}],"workspaceId":null,"runTask":false,"evidence":"本轮用户直接请求的逐字原文"}。明确指定成员时按用户选择；未指定时从启用名单挑合适成员。能力有缺口时把需要的角色放入 newBots，等用户确认。建群方案中不要同时返回 botActions。仅建群时 runTask=false；有需要完成的任务时 runTask=true，至少推荐两名子 Bot。明确指定工作区时选择对应 ID，否则留空由用户选择。所有方案都须确认工作区后才能执行。
可用成员：${JSON.stringify(config.library.get().bots.filter(bot => !bot.archived).map(({ id, name, duty }) => ({ id, name, duty })))}。普通工作区：${JSON.stringify(workspaces.map(({ id, title }) => ({ id, title })))}。当前待确认方案：${JSON.stringify(previousProposal ?? null)}。` : '不要返回 groupAction；请引导用户到 KingBot 专属对话筹建群聊。'}
${memory.enabled && memory.autoRemember ? memoryInstructions : '长期记忆自动更新已关闭，不要返回memoryActions，也不要声称已记住或忘记。'}`
      const creating = group.mode === 'king' && isBotCreationRequest(text)
      const prepare = (output: string) => {
        const plan = parsePlan(output, [])
        if (plan.groupAction !== undefined) {
          if (group.mode !== 'king' || plan.botActions !== undefined) throw new Error('建群方案只能在 KingBot 专属对话中提交，新成员建议请写入 groupAction.newBots')
          const proposal = proposeGroup(plan.groupAction, text, validateLibrary(config.library.get()), workspaces, randomUUID, !!previousProposal)
          return { plan, proposal, creation: undefined }
        }
        if (plan.botActions === undefined) {
          if (creating && /已(?:成功)?(?:建立|创建|添加|新建)|(?:建立|创建|添加)成功|\b(?:i have|i've|successfully) (?:created|added)\b/iu.test(plan.reply ?? '')) {
            throw new Error('KingBot 没有提交待保存的成员，请通过 botActions 提交')
          }
          return { plan, creation: undefined }
        }
        if (group.mode !== 'king') throw new Error('请在 KingBot 专属对话中创建子 Bot')
        const entry = ctx.settings.describe().find(entry => entry.ns === 'dsh-bots')!
        const result = createRequestedBots(validateLibrary(config.library.get()), plan.botActions, text, randomUUID)
        return { plan, creation: { result, revision: entry.revision } }
      }
      let output = await askBot(parent, current(), main, text, model, signal, instructions, memory)
      let prepared: ReturnType<typeof prepare>
      try {
        prepared = prepare(output)
      } catch (error) {
        signal.throwIfAborted()
        output = await askBot(parent, current(), main, `原始请求：${text}\n上次回复校验失败：${(error as Error).message}。请按原始请求修正 JSON，原文依据只从原始请求提取。`, model, signal, instructions, memory)
        prepared = prepare(output)
      }
      const { plan, creation, proposal } = prepared
      let botStatus = ''
      if (proposal) {
        appendPluginRecord(parent.session, 'plugin:dsh-bots/group-proposal', { proposal })
        botStatus = describeGroupProposal(proposal, workspaces)
      }
      if (creation) {
        signal.throwIfAborted()
        const { result, revision } = creation
        const sections: string[] = []
        if (result.created.length) {
          await ctx.settings.mutate('dsh-bots', [{ op: 'set', path: ['library'], value: result.library }], revision)
          sections.push('已创建子 Bot：\n' + result.created.map(bot => `• ${bot.name}：${bot.duty}`).join('\n'))
        }
        if (result.existing.length) {
          sections.push('已存在，保留原设置：\n' + result.existing.map(bot => `• ${bot.name}${bot.archived ? '（已停用，可在 Bots 页恢复）' : ''}`).join('\n'))
        }
        botStatus = [...sections, '可在 Bots 定义页查看成员。'].join('\n\n')
      }
      let memoryStatus = ''
      let memoryFailed = false
      if (plan.memoryActions !== undefined && !(Array.isArray(plan.memoryActions) && plan.memoryActions.length === 0)) {
        try { memoryStatus = await saveMemories(memory, plan.memoryActions, text, parent, signal, recalled.revision) }
        catch (error) {
          signal.throwIfAborted()
          memoryFailed = true
          memoryStatus = `长期记忆未保存：${(error as Error).message}`
        }
      }
      addRows(parent, [{ ...planner, status: memoryFailed ? 'error' : 'done', text: [botStatus, memoryStatus].filter(Boolean).join('\n') || plan.reply! }])
    } catch (error) {
      const pending = current().rows.filter((row): row is Row & { author: 'bot' } => row.author === 'bot' && row.status === 'working')
      addRows(parent, pending.map(row => ({ ...row, status: signal.aborted ? 'stopped' : 'error', text: signal.aborted ? '已停止，未执行的任务不会继续派发。' : `执行失败：${(error as Error).message}。请重试。` })))
      if (!pending.length) addRows(parent, [{ id: `${id}:notice`, author: 'notice', text: signal.aborted ? '已停止，后续任务未派发。' : `执行失败：${(error as Error).message}` }])
    } finally {
      activeTurns.delete(controller)
      await ctx.sessions.flush(parent.session)
    }
  }

  async function askBot(parent: Agent, group: Group, member: Member, text: string, model: ModelSelection, signal: AbortSignal, instructions = '执行 KingBot 分派给你的任务，只输出给群聊的回复。', memorySnapshot?: KingMemory) {
    signal.throwIfAborted()
    if (member.id !== coordinatorId && !config.library.get().bots.some(bot => bot.id === member.id)) throw new Error('该 Bot 已删除，任务已取消。')
    const startedRevision = contextRevision()
    if (group.coordinator?.contextWorkspace !== config.kingWorkspace.get()?.path || (group.coordinator?.contextRevision ?? 0) !== startedRevision) throw new Error('成员已删除，本轮已取消，请重新发送。')
    model = modelForBot(config.library.get(), member.id, model) as ModelSelection
    const sessionId = SessionId(member.sessionId)
    const setup: AgentSetup = childCtx => {
      childCtx.tools.restrict({ allow: [] })
      if (member.id === coordinatorId) {
        childCtx.systemPrompt.section({
          name: 'dsh-bots-personal-memory', order: 1010, interpolate: false,
          text: redactDeletedBotIds(memoryContext(memorySnapshot ?? storeFor().recall(text,config.kingMemory.get()).state), config.library.get().deletedBotIds),
        })
      }
      childCtx.systemPrompt.section({
        name: 'dsh-bots-role', order: 1000, interpolate: false,
        text: redactDeletedBotIds(`你是群聊中的「${member.name}」。你的职责是：${member.duty}\n用自己的身份回应最新用户消息。群聊历史仅用于参考。${instructions}`, config.library.get().deletedBotIds),
      })
    }
    const options = {
      parentAgent: parent, signal, setup,
      agentOptions: { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort },
    }
    const stored = await ctx.sessionPersistence.stat(sessionId)
    const handle = stored
      ? await ctx.agents.resume({ ...options, resumeSessionId: sessionId })
      : await ctx.agents.create({
        ...options, sessionId,
        meta: { origin: 'subagent', parentSession: parent.id, cwd: parent.session.header.cwd },
      })
    const child = handle.agent
    const parts: string[] = []
    let failure: string | undefined
    const observe = ctx.on('session/event', (session, event) => {
      if (session !== child.session) return
      if (event.type === 'assistant/message' && !event.data.interrupted) {
        for (const block of event.data.message.content) {
          if (block.type === 'text') parts.push(block.text)
        }
      }
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
        failure = event.data.reason.error.message
      }
    })
    const cancel = () => child.cancel({ kind: 'user' })
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      child.model.select(model)
      ctx.get('sessionTitle')?.rename(child.session, `Bot · ${member.name}`)
      const history = group.rows.slice(group.coordinator?.historyStart ?? 0).filter(row => row.author === 'user' || row.author === 'bot' && row.status === 'done')
        .slice(-12)
        .map(row => ({
          from: row.author === 'bot' ? (row.botId === coordinatorId ? coordinatorName : group.members.find(bot => bot.id === row.botId)?.name) : '用户',
          text: row.text.slice(0, 1800),
        }))
      if (startedRevision !== contextRevision()) throw new Error('成员已删除，本轮已取消，请重新发送。')
      child.followup(createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: redactDeletedBotIds(JSON.stringify({ 群聊议题: group.brief, 群聊历史: history, 最新用户消息: text }), config.library.get().deletedBotIds) }],
      }))
      await child.whenIdle()
      await ctx.sessions.flush(child.session)
      signal.throwIfAborted()
      if (failure) throw new Error(failure)
      if (startedRevision !== contextRevision()) throw new Error('成员已删除，本轮已取消，请重新发送。')
      const reply = redactDeletedBotIds(parts.join('\n').trim(), config.library.get().deletedBotIds)
      if (!reply) throw new Error('模型没有返回文本回复。')
      return reply
    } finally {
      observe()
      signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  }
}
