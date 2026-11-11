import { watchActivation } from './lifecycle.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { coordinatorId, coordinatorName, coordinatorDuty, validateLibrary, type Bot, type BotId, type Group, type Library, type BotModel } from './bots.ts'
import styles from './style.css'
import { MAX_MEMORIES, validateMemory, type KingMemory, type MemoryEntry } from './memory.ts'
import { insertMention, type CurrentInput, type InsertionActions } from './mention.ts'

export const inject = ['slots', 'sessions', 'conversation', 'remote', 'remote.commands', 'remote.settings', 'remote.session', 'remote.pluginManager']

type ProjectionHook = (key: 'dshBots') => Group | null | undefined
type Choose = (ids: BotId[]) => Promise<void>

function BotsIcon({ size }: { size: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M12 3v3M9 3h6M5 9l-2 2v6l2 2M19 9l2 2v6l-2 2"/><rect x="5" y="6" width="14" height="15" rx="5"/><path d="M8 11l2 1M16 11l-2 1M9 16q3 2 6 0"/></svg>
}

interface CatalogSnapshot { library: Library; kingMemory: KingMemory; revision: number; writable: boolean }
interface CatalogAPI {
  models(): Promise<ModelGroup[]>
  load(): Promise<CatalogSnapshot>
  save(library: Library, revision: number): Promise<CatalogSnapshot>
  saveMemory(memory: KingMemory, revision: number): Promise<CatalogSnapshot>
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

function KingCard({ snapshot, busy, save, models, saveModel }: { snapshot: CatalogSnapshot; busy: boolean; models: ModelGroup[]; saveModel(model?: BotModel): void; save(memory: KingMemory, message: string): Promise<boolean> }) {
  const [expanded, setExpanded] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState<{ id?: string; text: string }>()
  const memory = snapshot.kingMemory
  const count = memory.entries.filter(entry => !entry.archived).length
  return <article className="dsh-bots-king">
    <div className="dsh-bots-name"><span className="dsh-bots-avatar" data-bot="coordinator">K</span><h2>Bots King</h2><span className="dsh-bots-badge">主 Bot · 自动加入</span></div>
    <p>{coordinatorDuty}</p><code>@Bots King</code>
    <ModelPicker value={snapshot.library.kingModel} groups={models} disabled={busy || !snapshot.writable} onChange={saveModel} />
    <div className="dsh-bots-toolbar">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起长期记忆' : '管理长期记忆'} · {count}/{MAX_MEMORIES}</button>
      <span>{memory.enabled ? '跨群聊记忆已开启' : '跨群聊记忆已关闭'}</span>
    </div>
    {expanded && <div className="dsh-bots-memory">
      <p className="dsh-bots-hint">同一桌面配置的群聊共享，重启后保留。仅 Bots King 直接读取；它可能将相关信息用于任务分派。移出长期记忆不会删除原聊天记录。</p>
      <label><input type="checkbox" aria-label="启用 Bots King 长期记忆" checked={memory.enabled} disabled={busy || !snapshot.writable}
        onChange={event => void save({ ...memory, enabled: event.target.checked }, event.target.checked ? 'Bots King 长期记忆已启用。' : '长期记忆已关闭，已存内容保留但不再注入。')} />启用长期记忆</label>
      <label><input type="checkbox" aria-label="从群聊自动更新长期记忆" checked={memory.autoRemember} disabled={busy || !memory.enabled || !snapshot.writable}
        onChange={event => void save({ ...memory, autoRemember: event.target.checked }, '自动记忆设置已保存。')} />从群聊记住明确要求、稳定偏好与长期背景</label>
      <p className="dsh-bots-hint">可以说“@Bots King 请记住：……”或“@Bots King 请忘记……”。不需要导入全部历史。</p>
      <div className="dsh-bots-toolbar">
        <button type="button" disabled={busy || !!draft || !snapshot.writable || count >= MAX_MEMORIES} onClick={() => setDraft({ text: '' })}>添加长期记忆</button>
        <label><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />显示已移出记忆</label>
      </div>
      {draft && <form className="dsh-bots-editor" onSubmit={async event => {
        event.preventDefault()
        const entry: MemoryEntry = { id: draft.id ?? crypto.randomUUID(), text: draft.text, source: 'manual', archived: false, updatedAt: new Date().toISOString() }
        const entries = draft.id ? memory.entries.map(item => item.id === draft.id ? entry : item) : [...memory.entries, entry]
        if (await save({ ...memory, entries }, '长期记忆已保存，Bots King 下次回复时生效。')) setDraft(undefined)
      }}>
        <label>记忆内容<textarea aria-label="长期记忆内容" value={draft.text} rows={3} required maxLength={600} disabled={busy} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
        <div className="dsh-bots-actions"><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>取消记忆编辑</button><button type="submit" disabled={busy || !draft.text.trim()}>保存长期记忆</button></div>
      </form>}
      <div className="dsh-bots-memory-list">
        {memory.entries.filter(entry => showArchived || !entry.archived).map(entry => <article key={entry.id}>
          <p>{entry.text}</p>
          <small>{entry.archived ? '已移出 · ' : ''}{entry.source === 'manual' ? '手动设置' : '来自群聊'} · {new Date(entry.updatedAt).toLocaleString()}</small>
          {entry.evidence && <details><summary>查看记忆依据</summary><p>{entry.evidence}</p></details>}
          <div className="dsh-bots-actions">
            {!entry.archived && <button type="button" disabled={busy || !!draft || !snapshot.writable} onClick={() => setDraft({ id: entry.id, text: entry.text })}>编辑记忆</button>}
            <button type="button" disabled={busy || !!draft || !snapshot.writable} onClick={() => void save({ ...memory, entries: memory.entries.map(item => item.id === entry.id ? { ...item, archived: !item.archived, updatedAt: new Date().toISOString() } : item) }, entry.archived ? '记忆已恢复。' : '已移出长期记忆，可在已移出列表中恢复。')}>{entry.archived ? '恢复记忆' : '移出记忆'}</button>
          </div>
        </article>)}
      </div>
      {!count && <p>暂无有效长期记忆。可手动添加，或在群聊中告诉 Bots King 要记住什么。</p>}
    </div>}
  </article>
}

function BotLibrary({ catalog }: { catalog: CatalogAPI }) {
  const [models, setModels] = useState<ModelGroup[]>([])
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>()
  const [edit, setEdit] = useState<Bot>()
  const [limit, setLimit] = useState('4')
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
      setEdit(undefined)
      setStatus(message)
    } catch (error) { setError(`${messageOf(error)}。若配置已在其他窗口更改，请刷新后再编辑。`) }
    finally { setBusy(false) }
  }
  async function saveMemory(memory: KingMemory, message: string): Promise<boolean> {
    if (!snapshot) return false
    setBusy(true); setError(''); setStatus('')
    try {
      const next = await catalog.saveMemory(validateMemory(memory), snapshot.revision)
      setSnapshot(next)
      setStatus(message)
      return true
    } catch (error) {
      setError(`${messageOf(error)}。配置可能已在其他群聊更新，请刷新后再试。`)
      return false
    } finally { setBusy(false) }
  }
  return <section className="dsh-bots-library dsh-bots">
    <h1>Bots</h1>
    <p className="dsh-bots-hint">定义各成员的名称和职责。Bots King 自动加入群聊，负责分派任务与汇总结果。</p>
    {error && <p role="alert" className="dsh-bots-error">{error}</p>}
    {status && <p role="status">{status}</p>}
    <div className="dsh-bots-toolbar">
      <button type="button" disabled={busy} onClick={() => void load()}>刷新配置</button>
      <button type="button" className="dsh-bots-primary" disabled={busy || !snapshot?.writable || !!edit}
        onClick={() => { setEdit({ id: `bot-${crypto.randomUUID()}`, name: '', duty: '', archived: false }); setStatus(''); setError('') }}>新建 Bot</button>
    </div>
    {!snapshot ? <p>正在加载 Bot 定义…</p> : <>
      <KingCard snapshot={snapshot} busy={busy || !!edit} save={saveMemory} models={models} saveModel={model => void save({ ...snapshot.library, kingModel: model }, 'Bots King 模型已保存，下次执行生效。')} />
      <form className="dsh-bots-settings" onSubmit={event => {
        event.preventDefault()
        void save({ ...snapshot.library, maxMembers: Number(limit) }, '群聊人数上限已保存。')
      }}>
        <label>每个群聊最多加入的子 Bot 数
          <input aria-label="群聊子 Bot 数上限" type="number" min="1" max="12" step="1" value={limit}
            disabled={busy || !!edit || !snapshot.writable} onChange={event => setLimit(event.target.value)} />
        </label>
        <button disabled={busy || !!edit || !snapshot.writable} type="submit">保存人数上限</button>
        <small>范围 1–12，不含自动加入的 Bots King。仅影响新建群聊；已有群聊保持原成员。</small>
      </form>
      {edit && <form className="dsh-bots-editor" onSubmit={event => {
        event.preventDefault()
        const found = snapshot.library.bots.some(bot => bot.id === edit.id)
        const definitions = found ? snapshot.library.bots.map(bot => bot.id === edit.id ? edit : bot) : [...snapshot.library.bots, edit]
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
      <label className="dsh-bots-archive-filter"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />显示已停用 Bot</label>
      <div className="dsh-bots-cards">
        {snapshot.library.bots.filter(bot => showArchived || !bot.archived).map(bot => <article key={bot.id}>
          <div className="dsh-bots-name"><span className="dsh-bots-avatar" data-bot={bot.id}>{bot.name[0]}</span><h2>{bot.name}{bot.archived ? '（已停用）' : ''}</h2></div>
          <p className="dsh-bots-duty" tabIndex={0}>{bot.duty}</p><code>@{bot.name}</code>
          <ModelPicker value={bot.model} groups={models} disabled={busy || !!edit || !snapshot.writable} onChange={model => void save({ ...snapshot.library, bots: snapshot.library.bots.map(item => item.id === bot.id ? { ...item, model } : item) }, '模型已保存，下次执行生效。')} />
          <div className="dsh-bots-actions">
            <button type="button" aria-label={`编辑 ${bot.name}`} disabled={busy || !!edit || !snapshot.writable} onClick={() => { setEdit({ ...bot }); setError(''); setStatus('') }}>编辑</button>
            <button type="button" aria-label={`${bot.archived ? '恢复' : '停用'} ${bot.name}`} disabled={busy || !!edit || !snapshot.writable}
              onClick={() => void save({ ...snapshot.library, bots: snapshot.library.bots.map(item => item.id === bot.id ? { ...item, archived: !item.archived } : item) }, bot.archived ? 'Bot 已恢复。' : 'Bot 已停用，可勾选“显示已停用 Bot”恢复。已有群聊保持不变。')}>{bot.archived ? '恢复' : '停用'}</button>
          </div>
        </article>)}
      </div>
      {!snapshot.library.bots.some(bot => !bot.archived) && <p>还没有可选的 Bot，请先创建或恢复一个。</p>}
      <p className="dsh-bots-hint">编辑或停用不会改写已有群聊中的成员职责与历史回复。</p>
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
  return <div className="dsh-bots dsh-bots-mode">
    <div className="dsh-bots-segment" role="group" aria-label="对话模式">
      <button type="button" aria-pressed={!group && !editing} disabled={saving} onClick={() => { setEditing(false); setError(''); if (group) void save([]) }}>默认</button>
      <button type="button" aria-pressed={!!group || editing} disabled={saving} onClick={() => void open()}>群聊</button>
    </div>
    {editing && library && <div className="dsh-bots-picker">
      <p>Bots King 自动加入 · 已选 {selected.length}/{library.maxMembers} 名子 Bot</p>
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

function GroupTimeline({ useProjection, inputActions, mention }: {
  useProjection: ProjectionHook
  inputActions: InsertionActions
  mention: (name: string, actions: InsertionActions) => void
}) {
  const group = useProjection('dshBots')
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
    const alignMembers = () => {
      if (!card) return
      const bounds = card.getBoundingClientRect()
      const own = element.getBoundingClientRect()
      if (!bounds.width) return
      element.style.setProperty('--bots-members-width', `${bounds.width}px`)
      element.style.setProperty('--bots-members-offset', `${bounds.left - own.left - parseFloat(getComputedStyle(element).paddingLeft)}px`)
    }
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(alignMembers)
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
      alignMembers()
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(scroll, { childList: true, subtree: true })
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); element.style.removeProperty('--bots-members-width'); element.style.removeProperty('--bots-members-offset'); scroll.classList.remove('dsh-bots-group-scroll'); marked.forEach(item => item.classList.remove('dsh-bots-layout-chain')); element.hidden = false }
  }, [!!group])
  const timeline = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    const log = timeline.current
    if (log && follow.current) log.scrollTop = log.scrollHeight
  }, [group?.rows])
  if (!group) return null

  return <section ref={room} className="dsh-bots dsh-bots-room" aria-label="群聊">
    <div className="dsh-bots-members">
      <strong>群聊</strong>
      {[...(group.coordinator ? [{ ...group.coordinator, name: coordinatorName, duty: coordinatorDuty }] : []), ...group.members].map(member => <button key={member.id} type="button"
        title={member.duty} onPointerDown={event => event.preventDefault()} onClick={() => {
          mention(member.name, inputActions)
        }}>
        <span className="dsh-bots-avatar" data-bot={member.id}>{member.name[0]}</span>
        @{member.name}
      </button>)}
    </div>
    {group.rows.length === 0
      ? <p className="dsh-bots-hint">直接描述任务，由 Bots King 分派并汇总；也可以 @ 指定成员。</p>
      : <div className="dsh-bots-timeline" ref={timeline} role="log" aria-label="群聊时间线"
          onScroll={event => {
            const log = event.currentTarget
            follow.current = log.scrollHeight - log.clientHeight - log.scrollTop < 48
          }}>
          {group.rows.map(row => {
            if (row.author === 'notice') return <p key={row.id} role="status" className="dsh-bots-error">{row.text}</p>
            const bot = row.author === 'bot' ? (row.botId === coordinatorId ? { id: coordinatorId, name: coordinatorName } : group.members.find(member => member.id === row.botId)) : undefined
            return <article key={row.id} className="dsh-bots-message" data-author={row.author}>
              <span className="dsh-bots-avatar" data-bot={bot?.id}>{bot?.name[0] ?? '你'}</span>
              <div>
                <strong>{bot?.name ?? '你'}</strong>
                <p className={row.author === 'bot' && row.status === 'error' ? 'dsh-bots-error' : undefined}>
                  {row.author === 'bot' && row.status === 'working' ? row.text || '正在回复…' : row.text}
                </p>
              </div>
            </article>
          })}
        </div>}
  </section>
}

interface ClientContext {
  on(event: string, callback: () => void): () => void
  plugin(plugin: { apply(ctx: ClientContext): void }): { dispose(): unknown }
  effect(setup: () => () => void): void
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  sessions: {
    binding(id: string): {
      ctx: unknown
      session: {
        getSnapshot(): { blank: boolean }
      }
    } | undefined
  }
  remote: {
    $on(event: string, callback: () => void): () => void
    pluginManager: { listBundles(): Promise<{ ok: true; value: { name: string; enabled: boolean }[] } | { ok: false; error: { message: string } }> }
    session: { modelCatalog(): Promise<{ ok: true; value: { groups: ModelGroup[] } } | { ok: false; error: { message: string } }> }; settings: {
    describe(): Promise<{ ok: true; value: { writable: boolean; namespaces: { ns: string; value: { library?: unknown; kingMemory?: unknown }; revision: number }[] } } | { ok: false; error: { message: string } }>
    mutate(ns: string, ops: { op: 'set'; path: string[]; value: unknown }[], revision: number): Promise<{ ok: true; value: { value: { library?: unknown; kingMemory?: unknown }; revision: number } } | { ok: false; error: { message: string } }>
    update(ns: string, patch: unknown, revision: number): Promise<{ ok: true; value: { value: { library?: unknown; kingMemory?: unknown }; revision: number } } | { ok: false; error: { message: string } }>
  }; commands: {
    execute(id: string, line: string, attachments: []): Promise<
      { ok: true; value?: { result: { kind: 'error' | 'success'; text?: string } } }
      | { ok: false; error: { message: string } }>
  } }
  conversation: {
    input: { for(ctx: unknown): CurrentInput }
  }
}

// A package's browser module can outlive its host bundle. Own all visual effects
// in a disposable child scope and follow the native bundle enable state.
export function apply(ctx: ClientContext) {
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
    mount: () => ctx.plugin({ apply: mountClient }),
  }))
}

function mountClient(ctx: ClientContext) {
  const catalog: CatalogAPI = {
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
      return { library: validateLibrary(entry.value.library), kingMemory: validateMemory(entry.value.kingMemory), revision: entry.revision, writable: result.value.writable }
    },
    async saveMemory(memory, revision) {
      const result = await ctx.remote.settings.update('dsh-bots', { kingMemory: memory }, revision)
      if (!result.ok) throw new Error(result.error.message)
      return { library: validateLibrary(result.value.value.library), kingMemory: validateMemory(result.value.value.kingMemory), revision: result.value.revision, writable: true }
    },
    async save(library, revision) {
      const result = await ctx.remote.settings.mutate('dsh-bots', [{ op: 'set', path: ['library'], value: library }], revision)
      if (!result.ok) throw new Error(result.error.message)
      return { library: validateLibrary(result.value.value.library), kingMemory: validateMemory(result.value.value.kingMemory), revision: result.value.revision, writable: true }
    },
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'dsh-bots', order: 15, label: () => 'Bots',
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
      mention(name: string, actions: InsertionActions) {
        const binding = ctx.sessions.binding(sessionId)
        if (binding) insertMention(name, actions, ctx.conversation.input.for(binding.ctx))
      },
    }),
  }, GroupTimeline))
}
