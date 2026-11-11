import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, realpathSync, chmodSync, writeFileSync, existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyMemoryActions, memoryEntrySchema, validateMemory, forgetBotIds, type KingMemory, type MemoryEntry } from './memory.ts'

// Chinese bigrams supplement word tokens; no external embedding service is needed.
export function searchTokens(text: string): string[] {
  const words = text.normalize('NFKC').toLowerCase().match(/[a-z0-9_-]{2,}|[\p{Script=Han}]+/gu) ?? []
  return [...new Set(words.flatMap(word => /\p{Script=Han}/u.test(word)
    ? Array.from(word).slice(0, -1).map((char, i) => char + Array.from(word)[i + 1]) : [word]))].slice(0, 256)
}
export interface MemoryPage { entries: MemoryEntry[]; total: number; active: number; revision: number; path: string }
export class WorkspaceMemory {
  readonly db: DatabaseSync
  readonly path: string
  readonly workspace: string
  constructor(workspace: string) {
    this.workspace = workspace
    if (!isAbsolute(workspace)) throw new Error('请选择绝对路径工作区。')
    const root = realpathSync(workspace)
    const directory = join(root, '.dsh-bots')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (realpathSync(directory) !== directory) throw new Error('记忆目录不能是指向其他位置的符号链接。')
    this.path = join(directory, 'king-memory.sqlite')
    if (existsSync(this.path) && realpathSync(this.path) !== this.path) throw new Error('记忆数据库不能是符号链接。')
    this.db = new DatabaseSync(this.path)
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES('revision','0');
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,text TEXT NOT NULL,tokens TEXT NOT NULL,archived INTEGER NOT NULL,pinned INTEGER NOT NULL,updated TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS recall USING fts5(id UNINDEXED,tokens);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,operation TEXT NOT NULL,payload TEXT NOT NULL);`)
    chmodSync(this.path, 0o600)
    if (!existsSync(join(directory, '.gitignore'))) writeFileSync(join(directory, '.gitignore'), '*\n', { mode: 0o600 })
    if (!existsSync(join(directory, 'README.md'))) writeFileSync(join(directory, 'README.md'), '# Bots King memory\n\nking-memory.sqlite stores workspace memories, a full-text index, revision counters and an audit log. Manage entries in Bots → Bots King. Close Harness before copying the database and its WAL files. Uninstalling the plugin preserves this directory.\n', { mode: 0o600 })
  }
  close() { this.db.close() }
  revision() { return Number((this.db.prepare("SELECT value FROM meta WHERE key='revision'").get() as { value: string }).value) }
  private all(): MemoryEntry[] { return (this.db.prepare('SELECT payload FROM memories ORDER BY updated DESC,id').all() as { payload: string }[]).map(row => memoryEntrySchema.parse(JSON.parse(row.payload))) }
  private transaction<T>(operation: string, expected: number | undefined, work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (expected !== undefined && expected !== this.revision()) throw new Error('记忆已在其他会话中更新，请刷新后重试。')
      const result = work()
      this.db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run()
      this.db.prepare('INSERT INTO audit(at,operation,payload) VALUES(?,?,?)').run(new Date().toISOString(), operation, JSON.stringify(result))
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private put(entry: MemoryEntry) {
    const tokens = searchTokens(entry.text).join(' ')
    this.db.prepare('INSERT OR REPLACE INTO memories VALUES(?,?,?,?,?,?,?)').run(entry.id,entry.text,tokens,Number(entry.archived),Number(entry.pinned ?? false),entry.updatedAt,JSON.stringify(entry))
    this.db.prepare('DELETE FROM recall WHERE id=?').run(entry.id)
    if (!entry.archived) this.db.prepare('INSERT INTO recall VALUES(?,?)').run(entry.id,tokens)
  }
  reset() {
    this.db.exec('PRAGMA secure_delete=ON')
    this.transaction('reset', undefined, () => {
      this.db.exec('DELETE FROM memories; DELETE FROM recall; DELETE FROM audit;')
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES('legacy-imported','1')").run()
      return { cleared:true }
    })
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }
  importLegacy(memory: KingMemory) {
    if (this.db.prepare("SELECT value FROM meta WHERE key='legacy-imported'").get()) return
    this.transaction('import-legacy', undefined, () => {
      for (const entry of memory.entries) if (!this.db.prepare('SELECT id FROM memories WHERE id=?').get(entry.id)) this.put(entry)
      this.db.prepare("INSERT INTO meta VALUES('legacy-imported','1')").run()
      return { count: memory.entries.length }
    })
  }
  list(query = '', archived = false, offset = 0, limit = 50): MemoryPage {
    offset = Math.max(0, Math.floor(offset)); limit = Math.max(1, Math.min(100, Math.floor(limit)))
    const pattern = '%' + query.toLowerCase().replace(/[\\%_]/g, char => '\\' + char) + '%'
    const where = "archived=? AND lower(text) LIKE ? ESCAPE '\\'"
    const entries = (this.db.prepare(`SELECT payload FROM memories WHERE ${where} ORDER BY pinned DESC,updated DESC,id LIMIT ? OFFSET ?`).all(Number(archived),pattern,limit,offset) as { payload: string }[]).map(row => JSON.parse(row.payload) as MemoryEntry)
    const total = Number((this.db.prepare(`SELECT count(*) AS n FROM memories WHERE ${where}`).get(Number(archived),pattern) as { n: number }).n)
    const active = Number((this.db.prepare('SELECT count(*) AS n FROM memories WHERE archived=0').get() as { n: number }).n)
    return { entries, total, active, revision: this.revision(), path: this.path }
  }
  recall(query: string, settings: Pick<KingMemory,'enabled'|'autoRemember'>): { state: KingMemory; revision: number } {
    if (!settings.enabled) return { state: { ...settings, entries: [] }, revision: this.revision() }
    const tokens = searchTokens(query).slice(0, 48)
    const pinned = this.db.prepare('SELECT payload FROM memories WHERE archived=0 AND pinned=1 ORDER BY updated DESC LIMIT 8').all() as { payload: string }[]
    const matches = tokens.length ? this.db.prepare('SELECT m.payload FROM recall JOIN memories m ON m.id=recall.id WHERE recall MATCH ? AND m.archived=0 ORDER BY bm25(recall),m.updated DESC LIMIT 16').all(tokens.map(token => '"'+token+'"').join(' OR ')) as { payload: string }[] : []
    const recent = this.db.prepare('SELECT payload FROM memories WHERE archived=0 ORDER BY updated DESC LIMIT 6').all() as { payload: string }[]
    const entries: MemoryEntry[] = []; const ids = new Set<string>(); let chars = 0
    for (const row of [...pinned,...matches,...recent]) {
      const entry = JSON.parse(row.payload) as MemoryEntry
      if (ids.has(entry.id) || chars + entry.text.length > 9000) continue
      ids.add(entry.id); entries.push(entry); chars += entry.text.length
    }
    return { state: { ...settings, entries }, revision: this.revision() }
  }
  applyActions(raw: unknown, user: string, session: string, settings: Pick<KingMemory,'enabled'|'autoRemember'>, revision: number) {
    return this.transaction('model-memory', revision, () => {
      const before = this.all()
      const existing = new Map(before.map(entry => [entry.id, JSON.stringify(entry)]))
      const result = applyMemoryActions({ ...settings, entries: before },raw,user,session,randomUUID,new Date().toISOString())
      for (const entry of result.state.entries) if (existing.get(entry.id) !== JSON.stringify(entry)) this.put(entry)
      return { remembered: result.remembered, forgotten: result.forgotten, changed: result.changed }
    })
  }
  edit(action: { id?: string; text?: string; archived?: boolean; pinned?: boolean }, revision: number) {
    return this.transaction('manual-memory', revision, () => {
      const row = action.id ? this.db.prepare('SELECT payload FROM memories WHERE id=?').get(action.id) as { payload: string } | undefined : undefined
      if (action.id && !row) throw new Error('记忆不存在，请刷新。')
      const entry = memoryEntrySchema.parse({ ...(row ? JSON.parse(row.payload) : { id: randomUUID(), source:'manual', archived:false }), ...action, id: action.id ?? randomUUID(), updatedAt:new Date().toISOString() })
      this.put(entry); return entry
    })
  }
  retireIds(ids: readonly string[]) {
    const key = JSON.stringify(ids)
    if ((this.db.prepare("SELECT value FROM meta WHERE key='retired-ids'").get() as { value:string } | undefined)?.value === key) return
    this.transaction('retire-bot-ids', undefined, () => {
      const before = this.all(); const after = forgetBotIds({ enabled:true, autoRemember:true, entries:before },ids).entries
      after.forEach((entry,i) => { if (JSON.stringify(entry)!==JSON.stringify(before[i])) this.put(entry) })
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES('retired-ids',?)").run(key)
      return { retired:ids.length }
    })
  }
  export() {
    const file = join(this.workspace,'.dsh-bots',`memory-export-${Date.now()}.json`)
    writeFileSync(file,JSON.stringify({ schema:1, exportedAt:new Date().toISOString(), entries:this.all() },null,2),{mode:0o600})
    return file
  }
}
