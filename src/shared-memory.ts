import { createHash } from 'node:crypto'
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
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,revision TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS recall USING fts5(group_id UNINDEXED,id UNINDEXED,tokens);`)
    if (!(this.db.prepare('PRAGMA table_info(messages)').all() as {name:string}[]).some(column=>column.name==='digest')) this.db.exec('ALTER TABLE messages ADD COLUMN digest TEXT')
    chmodSync(this.path, 0o600)
    if (!existsSync(join(directory, '.gitignore'))) writeFileSync(join(directory, '.gitignore'), '*\n', { mode: 0o600 })
  }
  imported(id:string,revision:string) { return (this.db.prepare('SELECT revision FROM imports WHERE id=?').get(id) as {revision:string}|undefined)?.revision===revision }
  markImported(id:string,revision:string) { this.db.prepare('INSERT OR REPLACE INTO imports VALUES(?,?)').run(id,revision) }
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
        const digest=createHash('sha256').update(row.text).digest('hex')
        const previous = this.db.prepare('SELECT digest,status FROM messages WHERE group_id=? AND id=?').get(id,row.id) as {digest:string;status:string}|undefined
        if(previous?.digest===digest && previous.status===status)continue
        this.db.prepare('INSERT OR REPLACE INTO messages VALUES(?,?,?,?,?,?,?)').run(id,row.id,author,row.text,status,row.at ?? Date.now(),digest)
        this.db.prepare('DELETE FROM recall WHERE group_id=? AND id=?').run(id, row.id)
        // Index bounded overlapping chunks, including the tail of long originals.
        for(let offset=0;offset<row.text.length;offset+=3840) this.db.prepare('INSERT INTO recall VALUES(?,?,?)').run(id,row.id,searchTokens(row.text.slice(offset,offset+4096),4096).join(' '))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  read(epoch: number, request: {query?:string;groupId?:string;messageId?:string;offset?:number;page?:number} = {}) {
    const tokens = searchTokens(request.query ?? '').slice(0, 32)
    const where = 'g.epoch=? AND (? IS NULL OR g.id=?) AND (? IS NULL OR m.id=?)'
    const args = [epoch, request.groupId ?? null, request.groupId ?? null, request.messageId ?? null, request.messageId ?? null]
    const page = Number.isSafeInteger(request.page) ? Math.max(0,Math.min(1_000_000,request.page!)) : 0
    const offset = Number.isSafeInteger(request.offset) ? Math.max(0,request.offset!) : 0
    const select = 'm.group_id,m.id,m.author,substr(m.text,?,1200) AS text,length(m.text) AS total,m.status,m.at,g.title'
    const rows = this.db.prepare(`SELECT ${select} FROM messages m JOIN groups g ON g.id=m.group_id WHERE ${where} ${tokens.length && !request.messageId
      ? 'AND EXISTS (SELECT 1 FROM recall r WHERE r.group_id=m.group_id AND r.id=m.id AND recall MATCH ?)' : ''} ORDER BY m.at DESC,m.id LIMIT 9 OFFSET ?`)
      .all(offset+1,...args,...(tokens.length && !request.messageId ? [tokens.map(token=>'"'+token+'"').join(' OR ')] : []),page*8) as {group_id:string;id:string;author:string;text:string;total:number;status:string;at:number;title:string}[]
    return { messages: rows.slice(0,8).map(row=>({groupId:row.group_id,title:row.title,messageId:row.id,author:row.author,status:row.status,at:row.at,
      text:row.text,...(offset+1200<row.total ? {nextOffset:offset+1200}: {})})),...(rows.length>8 ? {nextPage:page+1}: {}) }
  }
}
