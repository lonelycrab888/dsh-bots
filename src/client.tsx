import { taskActionLabel, taskActions, taskDigest, type DiscussionTask, type TaskAction } from './tasks.ts'
import { avatarImages, kingAvatar } from './avatar-images.ts'
import type { BotAvatar } from './avatars.ts'
import type { ResetOptions, PendingReset } from './reset.ts'
import { KING_REMOTE } from './king-remote.ts'
import { watchActivation } from './lifecycle.ts'
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { coordinatorId, coordinatorName, isCoordinatorName, maxChildBots, validateLibrary, deleteBot, type Bot, type BotId, type Group, type Library, type BotModel } from './bots.ts'
import styles from './style.css'
import type { MemoryPage } from './workspace-memory.ts'
import { validateMemory, forgetBotIds, type KingMemory } from './memory.ts'
import { groupMentionSource, type GroupMentionSource } from './mention.ts'
import { avatarStore, followAccountAvatar, preloadAvatar, type AccountFrame } from './account-avatar.ts'

export const inject = ['slots', 'sessions', 'inputTriggers', 'remote', 'remote.commands', 'remote.settings', 'remote.session', 'remote.pluginManager', 'workspaces', 'uiWorkspace', 'remote.directoryPicker']

type ProjectionHook = (key: 'dshBots') => Group | null | undefined
type Choose = (ids: BotId[]) => Promise<void>

function BotsIcon({ size }: { size: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M12 3v3M9 3h6M5 9l-2 2v6l2 2M19 9l2 2v6l-2 2"/><rect x="5" y="6" width="14" height="15" rx="5"/><path d="M8 11l2 1M16 11l-2 1M9 16q3 2 6 0"/></svg>
}

interface CatalogSnapshot { resetPending?:PendingReset|null; workspace?: {path:string;sessionId:string}; library: Library; kingMemory: KingMemory; revision: number; writable: boolean }
interface CatalogAPI {
  reset(options:ResetOptions,revision:number):Promise<void>
  pickDirectory():Promise<string|null>
  setWorkspace(path:string,revision:number):Promise<void>
  openKing():Promise<void>
  memory<T=unknown>(request:Record<string,unknown>):Promise<T>
  subscribe(refresh: () => void): () => void
  remove(id: string, snapshot: CatalogSnapshot): Promise<CatalogSnapshot>
  models(): Promise<ModelGroup[]>
  load(): Promise<CatalogSnapshot>
  save(library: Library, revision: number): Promise<CatalogSnapshot>
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

interface ModelGroup { id: string; name: string; models: { id: string; name: string; reasoning?: { efforts: { id: string; name: string }[]; defaultEffort?: string } }[] }
function ModelPicker({ value, groups, disabled, onChange }: { value?: BotModel; groups: ModelGroup[]; disabled: boolean; onChange(value?: BotModel): void }) {
  const key = (model: BotModel) => JSON.stringify([model.provider, model.model])
  const known = !value || groups.some(group => group.id === value.provider && group.models.some(model => model.id === value.model))
  const reasoning = groups.find(group => group.id === value?.provider)?.models.find(model => model.id === value?.model)?.reasoning
  const efforts = reasoning?.efforts ?? []
  return <div className="dsh-bots-model-options"><label className="dsh-bots-model">使用模型<select aria-label="Bot 使用模型" disabled={disabled} value={value ? key(value) : ''} onChange={event => {
    const pair = event.target.value ? JSON.parse(event.target.value) as string[] : undefined
    onChange(pair ? { provider: pair[0], model: pair[1] } : undefined)
  }}><option value="">跟随当前对话</option>
    {!known && value && <option value={key(value)}>不可用：{value.provider} / {value.model}</option>}
    {groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={key({ provider: group.id, model: model.id })}>{model.name}</option>)}</optgroup>)}
  </select></label>
  <label className="dsh-bots-model">思考强度<select aria-label="Bot 思考强度" disabled={disabled || !value || !efforts.length} value={value?.reasoningEffort ?? ''} onChange={event => {
    if (value) onChange({ ...value, reasoningEffort: event.target.value || undefined })
  }}>
    <option value="">{!value ? '跟随当前对话（指定模型后可调整）' : !efforts.length ? '模型未提供可选档位' : `模型默认${reasoning?.defaultEffort ? ` · ${efforts.find(item => item.id === reasoning.defaultEffort)?.name ?? reasoning.defaultEffort}` : ''}`}</option>
    {value?.reasoningEffort && !efforts.some(item => item.id === value.reasoningEffort) && <option value={value.reasoningEffort}>已不可用：{value.reasoningEffort}</option>}
    {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
  </select></label></div>
}

function KingCard({ snapshot, busy, models, saveModel, catalog, reload }: { snapshot: CatalogSnapshot; busy: boolean; models: ModelGroup[]; saveModel(model?: BotModel): void; catalog: CatalogAPI; reload(): Promise<void> }) {
  const [path, setPath] = useState(snapshot.workspace?.path ?? '')
  useEffect(()=>{setPath(snapshot.workspace?.path ?? '')},[snapshot.workspace?.path])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [memoryOpen, setMemoryOpen] = useState(false)
  async function run(action: () => Promise<unknown>) {
    setWorking(true); setError('')
    try { await action() } catch(error) { setError(messageOf(error)) } finally { setWorking(false) }
  }
  const disabled=busy || working || !snapshot.writable
  return <article className="dsh-bots-king">
    <div className="dsh-bots-name"><Avatar id={coordinatorId} name={coordinatorName} /><h2>KingBot</h2><span className="dsh-bots-badge">主 Bot · 专属对话与长期记忆</span></div>
    <p>与你单独讨论任务、创建并命名子 Bot。记忆保存在你选择的工作区，供主 Bot 的独聊和群聊共同检索。</p>
    {!snapshot.workspace && <p className="dsh-bots-hint">请选择 KingBot 的专属工作区；选择工作区不会清空已有子 Bot。</p>}
    <label className="dsh-bots-model">主 Bot 工作区<input aria-label="KingBot 工作区目录" value={path} onChange={event=>setPath(event.target.value)} placeholder="选择或填写已有文件夹的绝对路径" disabled={disabled}/></label>
    <div className="dsh-bots-toolbar">
      <button type="button" disabled={disabled} onClick={()=>void run(async()=>{const selected=await catalog.pickDirectory();if(selected)setPath(selected)})}>选择文件夹</button>
      <button type="button" disabled={disabled || !path.trim()} onClick={()=>void run(async()=>{await catalog.setWorkspace(path.trim(),snapshot.revision);await reload()})}>{snapshot.workspace ? '切换工作区' : '启用工作区'}</button>
    </div>
    {snapshot.workspace && <><small>记忆位置：{snapshot.workspace.path}/.dsh-bots/king-memory.sqlite</small>
      <div className="dsh-bots-toolbar"><button className="dsh-bots-primary" disabled={disabled} onClick={()=>void run(()=>catalog.openKing())}>与 KingBot 对话</button><button disabled={disabled} onClick={()=>setMemoryOpen(!memoryOpen)}>{memoryOpen?'收起记忆管理':'管理工作区记忆'}</button></div>
      <p className="dsh-bots-hint">可以说：“帮我创建两个子 Bot，一个负责架构，一个负责验收，名称和能力描述由你拟定。”此工作区仅供主 Bot 使用，不能新建普通对话或群聊；其他工作区的群聊会共享这份记忆。</p>
    </>}
    <ModelPicker value={snapshot.library.kingModel} groups={models} disabled={disabled} onChange={saveModel}/>
    {error && <p role="alert" className="dsh-bots-error">{error}</p>}
    {memoryOpen && snapshot.workspace && <WorkspaceMemoryPanel catalog={catalog} snapshot={snapshot} reload={reload}/>}
  </article>
}

function DirectoryManagement({snapshot,catalog,disabled,done,showArchived,setShowArchived}:{snapshot:CatalogSnapshot;catalog:CatalogAPI;disabled:boolean;done():Promise<void>;showArchived:boolean;setShowArchived(value:boolean):void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState('')
  const [selected,setSelected]=useState<ResetOptions>({members:false,memory:false,sessions:false})
  const resetId=useId()
  const pending=snapshot.resetPending,options=pending?.options??selected
  async function submit(){
    setBusy(true);setError('');setStatus('')
    try{await catalog.reset(options,snapshot.revision);await done();setOpen(false);setConfirmation('');setSelected({members:false,memory:false,sessions:false});setStatus('所选数据已重置。若已解除旧会话关联，请重新选择工作区。')}
    catch(e){setError(messageOf(e));await done().catch(()=>{})}finally{setBusy(false)}
  }
  return <section className="dsh-bots-directory-management" aria-label="Bots 目录管理">
    <div className="dsh-bots-directory-options">
      <label className="dsh-bots-archive-filter"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />显示已停用 Bot</label>
      <button type="button" className="dsh-bots-reset-toggle" aria-expanded={open} aria-controls={open ? resetId : undefined} disabled={disabled||busy} onClick={()=>{setOpen(!open);setConfirmation('');setError('')}}>重置 Bots 数据</button>
    </div>
    {pending&&<p role="alert">上次重置尚未完成，请打开重置面板继续完成原先选择的项目。</p>}
    {open&&<div id={resetId} className="dsh-bots-editor dsh-bots-reset">
      <strong>选择要重置的项目</strong>
      {([['members','Bots 成员','删除所有子 Bot，包含已停用成员；保留 KingBot 和人数上限。旧编号不能复用。'],['memory','主 Bot 记忆','清空当前工作区全部有效及已移出记忆和旧版迁移记忆；保留记忆开关。需先选择工作区。'],['sessions','旧会话关联','解除主 Bot 工作区与会话绑定，旧群聊改为只读；之后重新选择工作区并创建专属对话。']] as const).map(([key,title,description])=><label key={key}><span><input type="checkbox" aria-label={`重置${title}`} checked={options[key]} disabled={busy||!!pending||(key==='memory'&&!snapshot.workspace)} onChange={e=>{setSelected({...selected,[key]:e.target.checked});setConfirmation('')}}/>{title}</span><small>{description}</small></label>)}
      <p>只重置勾选项目。此操作不能在插件中撤销；原聊天历史、已导出的文件和其他工作区的记忆文件不会删除。重置后使用新的 Bot 执行上下文。</p>
      <label>输入 RESET 确认<input aria-label="重置确认文字" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>
      <div className="dsh-bots-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>取消重置</button><button type="button" disabled={disabled||busy||confirmation!=='RESET'||!Object.values(options).some(Boolean)} onClick={()=>void submit()}>{busy?'正在重置…':pending?'继续未完成的重置':'确认重置所选数据'}</button></div>
    </div>}
    {error&&<p role="alert" className="dsh-bots-error">{error}</p>}{status&&<p role="status">{status}</p>}
  </section>
}

function WorkspaceMemoryPanel({catalog,snapshot,reload}:{catalog:CatalogAPI;snapshot:CatalogSnapshot;reload():Promise<void>}) {
  const [page,setPage]=useState<MemoryPage>()
  const [query,setQuery]=useState(''), [search,setSearch]=useState('')
  const [archived,setArchived]=useState(false),[offset,setOffset]=useState(0)
  const [draft,setDraft]=useState<{id?:string;text:string}>()
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('')
  async function load(){setBusy(true);setError('');try{setPage(await catalog.memory<MemoryPage>({action:'list',query:search,archived,offset}))}catch(e){setError(messageOf(e))}finally{setBusy(false)}}
  useEffect(()=>{void load()},[search,archived,offset,snapshot.workspace?.path])
  async function edit(entry:Record<string,unknown>){if(!page)return;setBusy(true);setError('');try{await catalog.memory({action:'edit',entry,revision:page.revision});setDraft(undefined);await load()}catch(e){setError(messageOf(e));setBusy(false)}}
  async function settings(change:Record<string,boolean>){setBusy(true);setError('');try{await catalog.memory({action:'settings',...change});await reload()}catch(e){setError(messageOf(e))}finally{setBusy(false)}}
  return <div className="dsh-bots-memory">
    <p>已保存 {page?.active ?? '…'} 条有效记忆，无固定条数上限。每次只检索相关条目，固定记忆优先进入上下文。</p>
    <label><input type="checkbox" checked={snapshot.kingMemory.enabled} disabled={busy} onChange={e=>void settings({enabled:e.target.checked})}/>启用长期记忆</label>
    <label><input type="checkbox" checked={snapshot.kingMemory.autoRemember} disabled={busy} onChange={e=>void settings({autoRemember:e.target.checked})}/>从主 Bot 对话与群聊自动更新记忆</label>
    <form onSubmit={e=>{e.preventDefault();setOffset(0);setSearch(query)}} className="dsh-bots-toolbar"><input aria-label="搜索工作区记忆" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索记忆内容"/><button disabled={busy}>搜索记忆</button></form>
    <label><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);setOffset(0)}}/>查看已移出记忆</label>
    <div className="dsh-bots-toolbar"><button disabled={busy} onClick={()=>setDraft({text:''})}>添加长期记忆</button><button disabled={busy} onClick={()=>void load()}>刷新记忆</button><button disabled={busy} onClick={()=>void catalog.memory<{path:string}>({action:'export'}).then(result=>setStatus(`已导出：${result.path}`)).catch(e=>setError(messageOf(e)))}>导出记忆</button></div>
    {draft && <form className="dsh-bots-editor" onSubmit={e=>{e.preventDefault();void edit(draft)}}><label>记忆内容<textarea aria-label="长期记忆内容" value={draft.text} maxLength={600} required onChange={e=>setDraft({...draft,text:e.target.value})}/></label><div className="dsh-bots-actions"><button type="button" onClick={()=>setDraft(undefined)}>取消记忆编辑</button><button disabled={busy||!draft.text.trim()}>保存长期记忆</button></div></form>}
    {error && <p role="alert" className="dsh-bots-error">{error}</p>}{status && <p role="status">{status}</p>}
    <div className="dsh-bots-memory-list">{page?.entries.map(entry=><article key={entry.id}><p>{entry.text}</p><small>{entry.pinned?'固定 · ':''}{entry.source==='manual'?'手动':'来自对话'} · {new Date(entry.updatedAt).toLocaleString()}</small><div className="dsh-bots-actions"><button disabled={busy} onClick={()=>setDraft({id:entry.id,text:entry.text})}>编辑记忆</button><button disabled={busy} onClick={()=>void edit({id:entry.id,pinned:!entry.pinned})}>{entry.pinned?'取消固定':'固定记忆'}</button><button disabled={busy} onClick={()=>void edit({id:entry.id,archived:!entry.archived})}>{entry.archived?'恢复记忆':'移出记忆'}</button></div></article>)}</div>
    {!page?.entries.length && <p>暂无匹配的记忆。</p>}<div className="dsh-bots-toolbar"><button disabled={busy||!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button><span>{page?.entries.length?offset+1:0}–{offset+(page?.entries.length??0)} / {page?.total??0}</span><button disabled={busy||offset+50>=(page?.total??0)} onClick={()=>setOffset(offset+50)}>下一页</button></div>
  </div>
}

function Avatar({ id, name, avatar }: { id?: string; name: string; avatar?: BotAvatar }) {
  const source = id === coordinatorId ? kingAvatar : avatar && avatarImages[avatar]
  return <span className="dsh-bots-avatar" aria-hidden="true">
    {source ? <img src={source} alt="" /> : name[0]}
  </span>
}

function BotLibrary({ catalog }: { catalog: CatalogAPI }) {
  const [models, setModels] = useState<ModelGroup[]>([])
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>()
  const [edit, setEdit] = useState<Bot>()
  const [selection, setSelection] = useState<string>()
  const [limit, setLimit] = useState('4')
  const [pendingDelete, setPendingDelete] = useState<Bot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  async function load() {
    setBusy(true)
    setError('')
    try {
      const next = await catalog.load()
      setSnapshot(next)
      setModels(await catalog.models())
      setLimit(String(next.library.maxMembers))
      setPendingDelete(undefined)
      setEdit(undefined)
    } catch (error) { setError(messageOf(error)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [catalog])
  async function save(library: Library, message: string) {
    if (!snapshot) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const next = await catalog.save(validateLibrary(library), snapshot.revision)
      setSnapshot(next)
      setLimit(String(next.library.maxMembers))
      setPendingDelete(undefined)
      setEdit(undefined)
      setStatus(message)
    } catch (error) { setError(`${messageOf(error)}。若配置已在其他窗口更改，请刷新后再编辑。`) }
    finally { setBusy(false) }
  }
  async function confirmDelete() {
    if (!snapshot || !pendingDelete) return
    setBusy(true); setError(''); setStatus('')
    try {
      const next = await catalog.remove(pendingDelete.id, snapshot)
      setSnapshot(next); setPendingDelete(undefined); setSelection(undefined)
      setStatus('Bot 已删除，旧编号已停用。重建同名 Bot 将使用新编号；请新建群聊选择新成员。')
    } catch (error) { setError(`${messageOf(error)}。请刷新后重试。`) }
    finally { setBusy(false) }
  }
  const selected = snapshot?.library.bots.find(bot => bot.id === selection)
  const inDirectory = !selection && !edit
  const back = () => { setSelection(undefined); setEdit(undefined); setPendingDelete(undefined); setError(''); setStatus('') }
  return <section className="dsh-bots-library dsh-bots" data-directory={inDirectory || undefined}>
    <h1>{inDirectory ? 'Bots 定义' : edit && !selected ? '新建 Bot' : 'Bot 设置'}</h1>
    {!inDirectory && <button type="button" onClick={back}>返回 Bots 定义</button>}
    {error && <p role="alert" className="dsh-bots-error">{error}</p>}
    {status && <p role="status">{status}</p>}
    {!snapshot ? <p>正在加载 Bot 定义…</p> : <>
      {inDirectory && <>
        <div className="dsh-bots-toolbar dsh-bots-directory-toolbar">
          <button type="button" disabled={busy} onClick={() => void load()}>刷新配置</button>
          <button type="button" className="dsh-bots-primary" disabled={busy || !snapshot.writable || snapshot.library.bots.length >= maxChildBots}
            onClick={() => { setEdit({ id: `bot-${crypto.randomUUID()}`, name: '', duty: '', archived: false }); setStatus(''); setError('') }}>新建 Bot</button>
          <span>{snapshot.library.bots.length} / {maxChildBots} 个子 Bot</span>
        </div>
        <div className="dsh-bots-directory">
          <button type="button" className="dsh-bots-directory-king" onClick={() => setSelection(coordinatorId)}>
            <Avatar id={coordinatorId} name={coordinatorName} /><h2>{coordinatorName}</h2>
          </button>
          {snapshot.library.bots.filter(bot => showArchived || !bot.archived).map(bot => <button key={bot.id} type="button" className="dsh-bots-directory-member" onClick={() => setSelection(bot.id)}>
            <Avatar id={bot.id} name={bot.name} avatar={bot.avatar} /><h2>{bot.name}</h2>
            {bot.archived && <small>已停用</small>}
          </button>)}
        </div>
        {!snapshot.library.bots.length && <p className="dsh-bots-directory-empty">尚未创建子 Bot。点击“新建 Bot”定义名称和职责，再创建群聊。</p>}
        <DirectoryManagement snapshot={snapshot} catalog={catalog} disabled={busy || !snapshot.writable} done={load} showArchived={showArchived} setShowArchived={setShowArchived} />
      </>}
      {selection === coordinatorId && <>
        <KingCard snapshot={snapshot} busy={busy} catalog={catalog} reload={load} models={models} saveModel={model => void save({ ...snapshot.library, kingModel: model }, 'KingBot 模型已保存，下次执行生效。')} />
        <form className="dsh-bots-settings" onSubmit={event => {
          event.preventDefault()
          void save({ ...snapshot.library, maxMembers: Number(limit) }, '群聊人数上限已保存。')
        }}>
          <label>每个群聊最多加入的子 Bot 数
            <input aria-label="群聊子 Bot 数上限" type="number" min="1" max="12" step="1" value={limit}
              disabled={busy || !snapshot.writable} onChange={event => setLimit(event.target.value)} />
          </label>
          <button disabled={busy || !snapshot.writable} type="submit">保存人数上限</button>
        </form>
      </>}
      {edit && <form className="dsh-bots-editor" onSubmit={event => {
        event.preventDefault()
        const existing = snapshot.library.bots.find(bot => bot.id === edit.id)
        if (isCoordinatorName(edit.name) && !isCoordinatorName(existing?.name ?? '')) {
          setError('KingBot 是主 Bot 的保留名称。')
          return
        }
        const definitions = existing ? snapshot.library.bots.map(bot => bot.id === edit.id ? edit : bot) : [...snapshot.library.bots, edit]
        void save({ ...snapshot.library, bots: definitions }, 'Bot 已保存，新建群聊时可选择。')
      }}>
        <h2>{snapshot.library.bots.some(bot => bot.id === edit.id) ? '编辑 Bot' : '新建 Bot'}</h2>
        <label>名称<input aria-label="Bot 名称" value={edit.name} maxLength={24} required disabled={busy}
          placeholder="例如：测试专家" onChange={event => setEdit({ ...edit, name: event.target.value })} /></label>
        <small>中英文、数字、下划线或连字符；名称用于 @ 点名。</small>
        <label>职责<textarea aria-label="Bot 职责" value={edit.duty} maxLength={6000} required rows={5} disabled={busy}
          placeholder="描述负责的工作、输出要求和边界" onChange={event => setEdit({ ...edit, duty: event.target.value })} /></label>
        <ModelPicker value={edit.model} groups={models} disabled={busy} onChange={model => setEdit({ ...edit, model })} />
        <div className="dsh-bots-actions">
          <button type="button" disabled={busy} onClick={() => setEdit(undefined)}>取消编辑</button>
          <button className="dsh-bots-primary" type="submit" disabled={busy || !edit.name.trim() || !edit.duty.trim()}>保存 Bot</button>
        </div>
      </form>}
      {pendingDelete && <section className="dsh-bots-editor" role="alertdialog" aria-label={`删除 ${pendingDelete.name}`}>
        <h2>删除「{pendingDelete.name}」？</h2>
        <p>删除后不能恢复此定义，旧编号永久停用。正在进行的群聊轮次会中止；主 Bot 下次回复会重新建立调度上下文。历史消息保留，但删除前的对话不再注入新的调度上下文。长期记忆中的旧编号也会清理。</p>
        <div className="dsh-bots-actions">
          <button type="button" disabled={busy} onClick={() => setPendingDelete(undefined)}>取消删除</button>
          <button type="button" disabled={busy || !snapshot.writable} onClick={() => void confirmDelete()}>确认删除</button>
        </div>
      </section>}
      {selected && !edit && [selected].map(bot => <article className="dsh-bots-editor" key={bot.id}>
          <div className="dsh-bots-name"><Avatar id={bot.id} name={bot.name} avatar={bot.avatar} /><h2>{bot.name}{bot.archived ? '（已停用）' : ''}</h2></div>
          <p className="dsh-bots-duty" tabIndex={0}>{bot.duty}</p><code>@{bot.name}</code>
          <ModelPicker value={bot.model} groups={models} disabled={busy || !!edit || !snapshot.writable} onChange={model => void save({ ...snapshot.library, bots: snapshot.library.bots.map(item => item.id === bot.id ? { ...item, model } : item) }, '模型已保存，下次执行生效。')} />
          <div className="dsh-bots-actions">
            <button type="button" aria-label={`编辑 ${bot.name}`} disabled={busy || !!edit || !snapshot.writable} onClick={() => { setEdit({ ...bot }); setError(''); setStatus('') }}>编辑</button>
            <button type="button" aria-label={`${bot.archived ? '恢复' : '停用'} ${bot.name}`} disabled={busy || !!edit || !snapshot.writable}
              onClick={() => void save({ ...snapshot.library, bots: snapshot.library.bots.map(item => item.id === bot.id ? { ...item, archived: !item.archived } : item) }, bot.archived ? 'Bot 已恢复。' : 'Bot 已停用，可勾选“显示已停用 Bot”恢复。已有群聊保持不变。')}>{bot.archived ? '恢复' : '停用'}</button>
            <button type="button" aria-label={`删除 ${bot.name}`} disabled={busy || !!edit || !snapshot.writable} onClick={() => { setPendingDelete(bot); setError(''); setStatus('') }}>删除</button>
          </div>
        </article>)}
    </>}
  </section>
}

function ModePicker({ useProjection, choose, catalog }: { useProjection: ProjectionHook; choose: Choose; catalog: CatalogAPI }) {
  const group = useProjection('dshBots')
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<BotId[]>([])
  const [library, setLibrary] = useState<Library>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(ids: BotId[]) {
    setSaving(true); setError('')
    try { await choose(ids); setEditing(false) }
    catch (failure) { setError(messageOf(failure)) }
    finally { setSaving(false) }
  }
  async function open() {
    setError(''); setSaving(true)
    try {
      const next = (await catalog.load()).library
      setLibrary(next)
      setSelected(group?.members.filter(member => next.bots.some(bot => !bot.archived && bot.id === member.id)).map(bot => bot.id) ?? [])
      setEditing(true)
    } catch (error) { setError(messageOf(error)) }
    finally { setSaving(false) }
  }
  if (group?.mode === 'king') return null
  return <div className="dsh-bots dsh-bots-mode">
    <div className="dsh-bots-segment" role="group" aria-label="对话模式">
      <button type="button" aria-pressed={!group && !editing} disabled={saving} onClick={() => { setEditing(false); setError(''); if (group) void save([]) }}>默认</button>
      <button type="button" aria-pressed={!!group || editing} disabled={saving} onClick={() => void open()}>群聊</button>
    </div>
    {editing && library && <div className="dsh-bots-picker">
      <p>KingBot 自动加入 · 已选 {selected.length}/{library.maxMembers} 名子 Bot</p>
      <fieldset disabled={saving}>
        <legend>选择群聊成员</legend>
        {library.bots.filter(bot => !bot.archived).map(bot => <label key={bot.id}>
          <input type="checkbox" checked={selected.includes(bot.id)} disabled={!selected.includes(bot.id) && selected.length >= library.maxMembers} onChange={event => {
            const checked = event.currentTarget.checked
            setSelected(previous => checked ? [...previous, bot.id] : previous.filter(id => id !== bot.id))
          }} />
          <span><strong>{bot.name}</strong><small>{bot.duty}</small></span>
        </label>)}
      </fieldset>
      {!library.bots.some(bot => !bot.archived) && <p>请先在 Bots 页面创建成员。</p>}
      <div className="dsh-bots-actions">
        <button type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button>
        <button type="button" className="dsh-bots-primary" disabled={saving || !selected.length || selected.length > library.maxMembers} onClick={() => void save(selected)}>确认成员</button>
      </div>
    </div>}
    {error && <span role="alert" className="dsh-bots-error">{error}</span>}
  </div>
}

const markdownPlugins = [remarkGfm]
const markdownComponents = {
  img: ({ alt }: { alt?: string }) => alt ? <span>{alt}</span> : null,
  a: ({ href, children }: React.ComponentProps<'a'>) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
}
const MarkdownReply = memo(function MarkdownReply({ text }: { text: string }) {
  // Some models wrap an entire formatted answer in an md fence.
  const body = /^\s*```(?:md|markdown)[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(text)?.[1] ?? text
  const formatted = /(?:^|\n)[ \t]{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|[>|]|```|~~~)|(?:\*\*|__|~~|`)[^\n]+|\[[^\]]+\]\(|[*_][^*_\n]+[*_]/.test(body)
  if (!formatted) return <p>{body}</p>
  return <div className="dsh-bots-markdown"><Markdown skipHtml remarkPlugins={markdownPlugins} components={markdownComponents}>{body}</Markdown></div>
})

function GroupConfirmation({ confirmation, choose }: {
  confirmation: NonNullable<Group['confirmation']>
  choose(id: string, confirm: boolean): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(confirm: boolean) {
    setPending(true)
    setError('')
    try { await choose(confirmation.id, confirm) }
    catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  return <div aria-label="建群确认" className="dsh-bots-hint">
    {confirmation.task && <details><summary>查看群聊任务</summary><p>{confirmation.task}</p></details>}
    <div className="dsh-bots-actions">
      {confirmation.ready && <button type="button" className="dsh-bots-primary" disabled={pending} onClick={() => void submit(true)}>确认建群</button>}
      <button type="button" disabled={pending} onClick={() => void submit(false)}>取消方案</button>
    </div>
    {error && <span role="alert" className="dsh-bots-error">{error}</span>}
  </div>
}

function TaskPanel({ group, choose, source }: {
  group: Group
  choose(task: DiscussionTask, action: TaskAction): Promise<void>
  source(id: string): void
}) {
  const [selected, setSelected] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const tasks = group.tasks ?? []
  const task = tasks.find(item => item.id === selected)
    ?? tasks.find(item => item.id === group.activeTaskId)
    ?? tasks.at(-1)
  if (!task) return null
  const digest = taskDigest(task, group.rows)
  const resumable = task.status === 'ready' || task.status === 'paused'
  const labels = { ready: '待开始', running: '讨论中', paused: '已暂停', complete: '已汇总', ended: '已结束' }
  async function submit(current: DiscussionTask, action: TaskAction) {
    setPending(true); setError('')
    try { await choose(current, action) }
    catch (error) { setError(messageOf(error)) }
    finally { setPending(false) }
  }
  return <aside className="dsh-bots-task" aria-label="议题与进度">
    {resumable && <div className="dsh-bots-task-status">
      <p>{labels[task.status]} · {task.title} · 已收到 {digest.completed.length} 条发言{task.operations.length ? ` · ${task.operations.length} 项待核对` : ''}</p>
      <div className="dsh-bots-actions">
        {taskActions.map(action => <button key={action} type="button" disabled={pending || action === 'resume' && !!task.operations.length}
          onClick={() => void submit(task, action)}>{taskActionLabel[action]}</button>)}
      </div>
    </div>}
    {error && <p role="alert" className="dsh-bots-error">{error}</p>}
    <details>
      <summary>查看议题摘要</summary>
      {tasks.length > 1 && <label>议题 <select aria-label="选择议题" value={task.id} onChange={event => { setSelected(event.target.value); setError('') }}>
        {[...tasks].reverse().map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>}
      <dl>
        <dt>原始目标</dt><dd>{task.goal}</dd>
        {digest.constraints.length > 0 && <><dt>约束</dt><dd><ul>{digest.constraints.map(row => <li key={row.id}>{row.text} <button type="button" onClick={() => source(row.id)}>原消息</button></li>)}</ul></dd></>}
        {digest.decisions.length > 0 && <><dt>用户确认和更正</dt><dd><ul>{[...digest.decisions].reverse().map(row => <li key={row.id}>{row.text} <button type="button" onClick={() => source(row.id)}>原消息</button></li>)}</ul></dd></>}
        {digest.result && <><dt>已保存汇总</dt><dd><MarkdownReply text={digest.result.text} /><button type="button" onClick={() => source(digest.result!.id)}>原汇总</button></dd></>}
        {digest.completed.length > 0 && <><dt>发言依据</dt><dd><ul>{digest.completed.map(row => <li key={row.rowId}><button type="button" onClick={() => source(row.rowId)}>{row.name} · {row.question}</button></li>)}</ul></dd></>}
        {digest.questions.length > 0 && <><dt>待解决问题</dt><dd><ul>{[...new Set(digest.questions)].map(question => <li key={question}>{question}</li>)}</ul></dd></>}
        {task.operations.length > 0 && <><dt>待核对操作</dt><dd><ul>{task.operations.map(operation => <li key={operation.id}>{operation.bot} · {operation.tool}{operation.target ? ` · ${operation.target}` : ''}</li>)}</ul><p>核对后可发送「已核对，继续」。</p></dd></>}
        {digest.documents.length > 0 && <><dt>附件</dt><dd><ul>{digest.user.flatMap(row => (row.documents ?? []).map((file, index) => <li key={`${row.id}:${index}`}><button type="button" onClick={() => source(row.id)}>{file.attachment.name}</button></li>))}</ul></dd></>}
      </dl>
    </details>
  </aside>
}

function GroupTimeline({ useProjection, openSession, catalog, chooseGroup, chooseTask, accountAvatar }: {
  catalog: CatalogAPI
  useProjection: ProjectionHook
  openSession: (id: string) => void
  chooseGroup(id: string, confirm: boolean): Promise<void>
  chooseTask(task: DiscussionTask, action: TaskAction): Promise<void>
  accountAvatar: ReturnType<typeof avatarStore>
}) {
  const group = useProjection('dshBots')
  const userAvatar = useSyncExternalStore(accountAvatar.subscribe, accountAvatar.getSnapshot)
  const [library, setLibrary] = useState<Library>()
  useEffect(() => {
    let disposed = false, generation = 0
    const refresh = async () => {
      const version = ++generation
      try {
        const snapshot = await catalog.load()
        if (!disposed && version === generation) setLibrary(snapshot.library)
      } catch { /* Host dispatch still rejects deleted members if configuration is unavailable. */ }
    }
    const stop = catalog.subscribe(() => { void refresh() })
    void refresh()
    return () => { disposed = true; stop() }
  }, [catalog])
  const room = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!group || !room.current) return
    const scroll = room.current.closest('[data-conversation-scroll]')
    if (!scroll) return
    const marked: HTMLElement[] = []
    let node = room.current.parentElement
    while (node && node !== scroll) { marked.push(node); node = node.parentElement }
    const element = room.current
    let card: Element | null = null
    let frame = 0
    const alignWithComposer = () => {
      if (!card) return
      const bounds = card.getBoundingClientRect()
      const own = element.getBoundingClientRect()
      if (!bounds.width) return
      element.style.setProperty('--bots-conversation-width', `${bounds.width}px`)
      element.style.setProperty('--bots-conversation-offset', `${bounds.left - own.left}px`)
    }
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(alignWithComposer)
    })
    resize.observe(element)
    const sync = () => {
      // Only the native Chat view owns data-chat-flow. Other tabs keep their own layout.
      const active = scroll.closest('[data-content-phase]')?.getAttribute('data-content-phase') === 'hero' || !!scroll.querySelector('[data-chat-flow]')
      scroll.classList.toggle('dsh-bots-group-scroll', active)
      marked.forEach(item => item.classList.toggle('dsh-bots-layout-chain', active))
      element.hidden = !active
      const nextCard = scroll.querySelector('[data-composer-card]')
      if (nextCard !== card) { if (card) resize.unobserve(card); card = nextCard; if (card) resize.observe(card) }
      alignWithComposer()
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(scroll, { childList: true, subtree: true })
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); element.style.removeProperty('--bots-conversation-width'); element.style.removeProperty('--bots-conversation-offset'); scroll.classList.remove('dsh-bots-group-scroll'); marked.forEach(item => item.classList.remove('dsh-bots-layout-chain')); element.hidden = false }
  }, [!!group])
  const timeline = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const log = timeline.current
    if (log && follow.current) log.scrollTop = log.scrollHeight
  }, [group?.rows])
  if (!group) return null
  return <section ref={room} className="dsh-bots dsh-bots-room" aria-label={group.mode === 'king' ? 'KingBot 专属对话' : '群聊'}>
    {group.mode !== 'king' && <TaskPanel group={group} choose={chooseTask} source={id => {
      const row = timeline.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
      row?.scrollIntoView({ block: 'nearest' })
      row?.focus({ preventScroll: true })
    }} />}
    {group.rows.length === 0
      ? <p className="dsh-bots-hint">{group.brief ?? (group.mode==='king'?'可以请 KingBot 创建子 Bot、筹建群聊，或把任务交给群聊讨论。':'发消息后，KingBot 会根据成员的发言主持讨论。可以用 @ 指定参与成员。')}</p>
      : <div className="dsh-bots-timeline" ref={timeline} role="log" aria-label="群聊时间线"
          onScroll={event => {
            const log = event.currentTarget
            follow.current = log.scrollHeight - log.clientHeight - log.scrollTop < 48
          }}>
          {group.brief && <p className="dsh-bots-hint">{group.brief}</p>}
          {group.rows.map(row => {
            if (row.author === 'notice') return row.sessionId
              ? <p key={row.id} role="status" className="dsh-bots-hint">{row.text} <button type="button" onClick={() => openSession(row.sessionId!)}>打开群聊</button></p>
              : <p key={row.id} role="status" className={row.tone === 'info' ? 'dsh-bots-hint' : 'dsh-bots-error'}>{row.text}</p>
            const bot = row.author === 'bot' ? (row.botId === coordinatorId ? { id: coordinatorId, name: coordinatorName } : group.members.find(member => member.id === row.botId)) : undefined
            const name = row.author === 'user' ? '你' : bot?.name ?? 'Bot'
            return <article key={row.id} className="dsh-bots-message" data-author={row.author} data-row-id={row.id} tabIndex={-1}>
              {row.author === 'user' && group.mode !== 'king' && userAvatar
                ? <span className="dsh-bots-avatar dsh-bots-account-avatar" aria-hidden="true">
                    <img src={userAvatar} referrerPolicy="no-referrer" alt="" onError={() => accountAvatar.failed(userAvatar)} />
                  </span>
                : <Avatar id={bot?.id} name={name} avatar={library?.bots.find(item => item.id === bot?.id)?.avatar ?? (bot && 'avatar' in bot ? bot.avatar : undefined)} />}
              <div className="dsh-bots-bubble">
                <strong>{name}</strong>
                {row.author === 'bot' && row.status === 'done' && !row.literal
                  ? <MarkdownReply text={row.text} />
                  : <p className={row.author === 'bot' && row.status === 'error' ? 'dsh-bots-error' : undefined}>
                      {row.author === 'bot' && row.status === 'working' ? row.text || '正在回复…' : row.text}
                    </p>}
                {row.author === 'bot' && row.sessionId && <button type="button" onClick={() => openSession(row.sessionId!)}>打开群聊</button>}
                {row.author === 'user' && !!row.documents?.length && (
                  <ul className="dsh-bots-attachments" aria-label="文档附件">
                    {row.documents.map(({ attachment }, index) => <li key={index}>{attachment.name}</li>)}
                  </ul>
                )}
              </div>
            </article>
          })}
          {group.confirmation && <GroupConfirmation key={group.confirmation.id} confirmation={group.confirmation} choose={chooseGroup} />}
        </div>}
  </section>
}

interface AccountClient { version: string; locale: string; timezoneOffsetSeconds: number }
interface ClientContext {
  on(event: string, callback: () => void): () => void
  plugin(plugin: { inject?:string[]; apply(ctx: ClientContext): void }): { dispose(): unknown }
  effect(setup: () => () => void): void
  inject(deps: string[], setup: (ctx: ClientContext) => void): void
  get(key: 'accountUi'): { clientMetadata(locale: string): AccountClient } | undefined
  remoteAccess: { whenAccess(action: string, setup: () => Generator<() => unknown, void>): void }
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  uiWorkspace: {openSession(id:string):void}
  workspaces: {create(input:{path:string}):Promise<{workspaceId:string;path:string}>}
  sessions: {
    create(input:{workspaceId:string}):Promise<string>
    binding(id: string): {
      session: {
        getSnapshot(): { blank: boolean }
        projections: { faceOf(key: 'dshBots'): { getSnapshot(): Group | null | undefined } }
      }
    } | undefined
  }
  remote: {
    $mount(contribution:unknown):Promise<()=>Promise<void>>
    dshBots:{saveCatalog(request:Record<string,unknown>):Promise<{ok:true;value:{kind:"success"|"error";text:string}}|{ok:false;error:{message:string}}>;reset(request:Record<string,unknown>):Promise<{ok:true;value:{kind:'success'|'error';text:string}}|{ok:false;error:{message:string}}>;manage(id:string,request:Record<string,unknown>):Promise<{ok:true;value:{kind:'success'|'error';text:string}}|{ok:false;error:{message:string}}>}
    directoryPicker:{pick():Promise<{ok:true;value:string|null}|{ok:false;error:{message:string}}>}
    $on(event: string, callback: () => void): () => void
    $stream(options: { name: string; open(signal: AbortSignal): unknown; ended(): Error; carrierFailed(): void }): AsyncIterable<AccountFrame> & { dispose(): unknown }
    account: {
      watch(signal: AbortSignal): unknown
      getProfile(client: AccountClient): Promise<{ ok: true; value: { status: 'ready'; value: { avatarUrl?: string | null } } | { status: 'failed' } | null } | { ok: false }>
    }
    pluginManager: { listBundles(): Promise<{ ok: true; value: { name: string; enabled: boolean }[] } | { ok: false; error: { message: string } }> }
    session: { modelCatalog(): Promise<{ ok: true; value: { groups: ModelGroup[] } } | { ok: false; error: { message: string } }> }; settings: {
    describe(): Promise<{ ok: true; value: { writable: boolean; namespaces: { ns: string; value: { library?: unknown; kingMemory?: unknown; resetPending?:PendingReset|null; kingWorkspace?: {path:string;sessionId:string} }; revision: number }[] } } | { ok: false; error: { message: string } }>
    mutate(ns: string, ops: { op: 'set'; path: string[]; value: unknown }[], revision: number): Promise<{ ok: true; value: { value: { library?: unknown; kingMemory?: unknown; resetPending?:PendingReset|null; kingWorkspace?: {path:string;sessionId:string} }; revision: number } } | { ok: false; error: { message: string } }>
    update(ns: string, patch: unknown, revision: number): Promise<{ ok: true; value: { value: { library?: unknown; kingMemory?: unknown; resetPending?:PendingReset|null; kingWorkspace?: {path:string;sessionId:string} }; revision: number } } | { ok: false; error: { message: string } }>
  }; commands: {
    execute(id: string, line: string, attachments: []): Promise<
      { ok: true; value?: { result: { kind: 'error' | 'success'; text?: string } } }
      | { ok: false; error: { message: string } }>
  } }
  inputTriggers: { registerSource(source: GroupMentionSource): () => void }
}

// A package's browser module can outlive its host bundle. Own all visual effects
// in a disposable child scope and follow the native bundle enable state.
export async function apply(ctx: ClientContext) {
  await ctx.remote.$mount(KING_REMOTE)
  ctx.effect(() => watchActivation({
    async read() {
      const result = await ctx.remote.pluginManager.listBundles()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.some(bundle => bundle.name === 'dsh-bots' && bundle.enabled)
    },
    subscribe(refresh) {
      const off = ctx.remote.$on('plugin-manager/changed', refresh)
      const reset = ctx.on('connection/reset', refresh)
      return () => { off(); reset() }
    },
    mount: () => ctx.plugin({ inject:['remote.dshBots'], apply: mountClient }),
  }))
}

function mountClient(ctx: ClientContext) {
  const accountAvatar = avatarStore()
  ctx.inject(['remote.account', 'remoteAccess'], scoped => {
    scoped.remoteAccess.whenAccess('account/watch', function* () {
      const lifetime = new AbortController()
      let generation = 0
      const stream = scoped.remote.$stream({
        name: 'dsh-bots-account-avatar',
        open: signal => scoped.remote.account.watch(signal),
        ended: () => new Error('account stream ended'),
        carrierFailed: () => { generation++; accountAvatar.publish() },
      })
      yield () => { lifetime.abort(); accountAvatar.publish(); return stream.dispose() }
      void followAccountAvatar(stream, async () => {
        const epoch = generation
        const locale = document.documentElement.lang || navigator.language
        const client = scoped.get('accountUi')?.clientMetadata(locale) ?? {
          version: '0.2.2-rc.1', locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        }
        const result = await scoped.remote.account.getProfile(client)
        if (epoch === generation && result.ok && result.value?.status === 'ready') return result.value.value.avatarUrl
      }, async (url, signal) => {
        const epoch = generation
        return await preloadAvatar(url, signal) && epoch === generation
      }, accountAvatar.publish, lifetime.signal).catch(() => {})
    })
  })
  async function command<T>(id:string, request:Record<string,unknown>):Promise<T> {
    const result=await ctx.remote.dshBots.manage(id,request)
    if(!result.ok)throw new Error(result.error.message)
    if(result.value.kind==='error')throw new Error(result.value.text)
    return JSON.parse(result.value.text) as T
  }
  const catalog: CatalogAPI = {
    async reset(options,revision){
      const result=await ctx.remote.dshBots.reset({options,revision,confirmation:'RESET'})
      if(!result.ok)throw new Error(result.error.message)
      if(result.value.kind==='error')throw new Error(result.value.text)
    },
    async pickDirectory(){const result=await ctx.remote.directoryPicker.pick();if(!result.ok)throw new Error(result.error.message);return result.value},
    async setWorkspace(path,revision){
      const existing=await catalog.load()
      if(existing.workspace?.path===path){await catalog.openKing();return}
      const selected=await ctx.workspaces.create({path})
      if(existing.workspace?.path===selected.path){await catalog.openKing();return}
      const id=await ctx.sessions.create({workspaceId:selected.workspaceId})
      await command(id,{action:'configure',path:selected.path,revision})
    },
    async openKing(){
      const snapshot=await catalog.load()
      if(!snapshot.workspace)throw new Error('请先选择主 Bot 工作区。')
      ctx.uiWorkspace.openSession(snapshot.workspace.sessionId)
      void command(snapshot.workspace.sessionId, { action: 'recover-results' }).catch(() => {})
    },
    async memory<T>(request:Record<string,unknown>):Promise<T>{
      const snapshot=await catalog.load()
      if(!snapshot.workspace)throw new Error('请先选择主 Bot 工作区。')
      return command<T>(snapshot.workspace.sessionId,request)
    },
    subscribe: refresh => ctx.remote.$on('settings/document-updated', refresh),
    async remove(id, snapshot) {
      const library = deleteBot(snapshot.library, id)
      const kingMemory = forgetBotIds(snapshot.kingMemory, [id])
      const result = await ctx.remote.settings.mutate('dsh-bots', [
        { op: 'set', path: ['library'], value: library },
        { op: 'set', path: ['kingMemory'], value: kingMemory },
      ], snapshot.revision)
      if (!result.ok) throw new Error(result.error.message)
      return catalog.load()
    },
    async models() {
      const result = await ctx.remote.session.modelCatalog()
      if (!result.ok) throw new Error(result.error.message)
      return result.value.groups
    },
    async load() {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) throw new Error(result.error.message)
      const entry = result.value.namespaces.find(entry => entry.ns === 'dsh-bots')
      if (!entry) throw new Error('Bot 配置未加载，请检查宿主插件版本。')
      return { resetPending:entry.value.resetPending, workspace: entry.value.kingWorkspace ?? undefined, library: validateLibrary(entry.value.library), kingMemory: validateMemory(entry.value.kingMemory), revision: entry.revision, writable: result.value.writable }
    },
    async save(library, revision) {
      const result = await ctx.remote.dshBots.saveCatalog({ library, revision })
      if (!result.ok) throw new Error(result.error.message)
      if (result.value.kind === 'error') throw new Error(result.value.text)
      return catalog.load()
    },
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  })
  ctx.effect(() => ctx.inputTriggers.registerSource(groupMentionSource(
    sessionId => ctx.sessions.binding(sessionId)?.session.projections.faceOf('dshBots').getSnapshot(),
    async () => (await catalog.load()).library,
  )))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'dsh-bots', order: 15, label: () => 'Bots 定义',
  }, BotsIcon))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-bots', inject: () => ({ catalog }) }, BotLibrary))
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: 'dsh-bots', order: 100,
    inject: (sessionId: string) => ({
      catalog,
      async choose(ids: BotId[]) {
        const session = ctx.sessions.binding(sessionId)?.session
        if (!session?.getSnapshot().blank) throw new Error('请先打开一个空白会话。')
        const result = await ctx.remote.commands.execute(sessionId, `/dsh-bots ${ids.length ? ids.join(',') : 'default'}`, [])
        if (!result.ok) throw new Error(result.error.message)
        if (!result.value) throw new Error('Bots 宿主插件未加载。')
        if (result.value.result.kind === 'error') throw new Error(result.value.result.text)
      },
    }),
  }, ModePicker))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-bots-timeline', order: 90,
    inject: (sessionId: string) => ({
      catalog,
      accountAvatar,
      openSession: (id: string) => ctx.uiWorkspace.openSession(id),
      async chooseTask(task: DiscussionTask, action: TaskAction) {
        const result = await ctx.remote.dshBots.manage(sessionId, { action: 'task-action', taskAction: action, taskId: task.id, revision: task.revision })
        if (!result.ok) throw new Error(result.error.message)
        if (result.value.kind === 'error') throw new Error(result.value.text)
      },
      async chooseGroup(confirmationId: string, confirm: boolean) {
        const result = await ctx.remote.dshBots.manage(sessionId, { action: confirm ? 'confirm-group' : 'cancel-group', confirmationId })
        if (!result.ok) throw new Error(result.error.message)
        if (result.value.kind === 'error') throw new Error(result.value.text)
      },
    }),
  }, GroupTimeline))
}
