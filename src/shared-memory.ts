import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, realpathSync, existsSync, chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Group } from './bots.ts'
import { searchTokens } from './workspace-memory.ts'

// Public group history only. Personal conversations and model reasoning are not
// shared facts. Session IDs and row IDs keep similarly named groups distinct.
export class SharedGroupMemory {
  readonly path: string
  private readonly db: DatabaseSync
  constructor(workspace: string) {
    const directory = join(realpathSync(workspace), '.dsh-bots')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (realpathSync(directory) !== directory) throw new Error('群聊记忆目录不能是符号链接。')
    this.path = join(directory, 'group-memory.sqlite')
    if (existsSync(this.path) && realpathSync(this.path) !== this.path) throw new Error('群聊记忆数据库不能是符号链接。')
    this.db = new DatabaseSync(this.path)
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,title TEXT NOT NULL,epoch INTEGER NOT NULL,brief TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages(group_id TEXT NOT NULL,id TEXT NOT NULL,author TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(group_id,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS recall USING fts5(group_id UNINDEXED,id UNINDEXED,tokens);`)
    chmodSync(this.path, 0o600)
    if (!existsSync(join(directory, '.gitignore'))) writeFileSync(join(directory, '.gitignore'), '*\n', { mode: 0o600 })
  }
  close() { this.db.close() }
  sync(id: string, title: string, group: Group, rows = group.rows) {
    if (group.mode === 'king' || group.mode === 'bot') return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR REPLACE INTO groups VALUES(?,?,?,?)').run(id, title, group.sessionEpoch ?? 0, group.brief ?? '')
      for (const row of rows) {
        if (row.author === 'notice' || row.author === 'bot' && (row.privateToKing || row.status === 'working')) continue
        const author = row.author === 'user' ? 'user' : row.botId
        const status = row.author === 'user' ? 'user' : row.status
        const previous = this.db.prepare('SELECT text,status FROM messages WHERE group_id=? AND id=?').get(id, row.id) as {text:string;status:string} | undefined
        if (previous?.text === row.text && previous.status === status) continue
        this.db.prepare('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?)').run(id, row.id, author, row.text, status, row.at ?? Date.now())
        this.db.prepare('DELETE FROM recall WHERE group_id=? AND id=?').run(id, row.id)
        this.db.prepare('INSERT INTO recall VALUES(?,?,?)').run(id, row.id, searchTokens(row.text, Infinity).join(' '))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  read(epoch: number, request: {query?:string;groupId?:string;messageId?:string;offset?:number;page?:number} = {}) {
    const tokens = searchTokens(request.query ?? '').slice(0, 32)
    const where = 'g.epoch=? AND (? IS NULL OR g.id=?) AND (? IS NULL OR m.id=?)'
    const args = [epoch, request.groupId ?? null, request.groupId ?? null, request.messageId ?? null, request.messageId ?? null]
    const page = Math.max(0, Math.floor(request.page ?? 0))
    const rows = (tokens.length && !request.messageId
      ? this.db.prepare(`SELECT m.*,g.title FROM recall r JOIN messages m ON m.group_id=r.group_id AND m.id=r.id JOIN groups g ON g.id=m.group_id WHERE ${where} AND recall MATCH ? ORDER BY bm25(recall),m.at DESC,m.id LIMIT 9 OFFSET ?`).all(...args, tokens.map(token => '"' + token + '"').join(' OR '), page * 8)
      : this.db.prepare(`SELECT m.*,g.title FROM messages m JOIN groups g ON g.id=m.group_id WHERE ${where} ORDER BY m.at DESC,m.id LIMIT 9 OFFSET ?`).all(...args, page * 8)) as {group_id:string;id:string;author:string;text:string;status:string;at:number;title:string}[]
    const offset = Math.max(0, Math.floor(request.offset ?? 0))
    return { messages: rows.slice(0, 8).map(row => ({ groupId: row.group_id, title: row.title, messageId: row.id, author: row.author, status: row.status, at: row.at,
      text: row.text.slice(offset, offset + 1200), ...(offset + 1200 < row.text.length ? {nextOffset:offset + 1200} : {}) })), ...(rows.length > 8 ? {nextPage:page + 1} : {}) }
  }
}
