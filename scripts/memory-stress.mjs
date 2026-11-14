// Isolated synthetic legacy journal. Run with a small V8 heap; never user data.
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createZstdCompress } from 'node:zlib'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { readGroupLog } from '../src/group-log.ts'

const directory=await mkdtemp(join(tmpdir(),'roundtable-memory-stress-'))
try {
  const path=join(directory,'session.v4.jsonl.zstd')
  const compressor=createZstdCompress()
  const done=pipeline(compressor,createWriteStream(path))
  const header={type:'session',version:4,id:'stress',createdAt:'2026-11-14T00:00:00Z',isSeeded:false,delegationDepth:0}
  let bytes=0,seq=0
  async function write(value){const line=JSON.stringify(value)+'\n';bytes+=Buffer.byteLength(line);if(!compressor.write(line))await once(compressor,'drain')}
  const event=(type,data)=>({type,data,seq:seq++,time:'2026-11-14T00:00:00Z',ignorable:true})
  await write(header)
  await write(event('plugin:dsh-bots/members',[{id:'a',name:'A',duty:'test',sessionId:'child'}]))
  const reasoning='synthetic reasoning '.repeat(3400)
  for(let i=0;i<5000;i++)await write(event('plugin:dsh-bots/rows',[{id:'same',author:'bot',botId:'a',status:'working',text:'',reasoning:reasoning+i}]))
  await write(event('plugin:dsh-bots/rows',[{id:'same',author:'bot',botId:'a',status:'done',text:'FINAL-CANARY'}]))
  compressor.end();await done
  const result=await readGroupLog(path,header,new AbortController().signal)
  assert.equal(result.group.rows.length,1);assert.equal(result.group.rows[0].text,'FINAL-CANARY')
  assert(result.group.rows[0].reasoning.length<33000)
  console.log(JSON.stringify({logicalMiB:+(bytes/1048576).toFixed(1),compressedKiB:+((await stat(path)).size/1024).toFixed(1),heapMiB:+(process.memoryUsage().heapUsed/1048576).toFixed(1),rows:result.group.rows.length}))
}finally{await rm(directory,{recursive:true,force:true})}
