import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localFileLink } from '../src/file-links.ts'
import { readGroupDocument } from '../src/group-files.ts'
import type { Group } from '../src/bots.ts'

test('file links preserve Chinese names, spaces, relative paths and source locations', () => {
  for (const [href, path] of [
    ['./output/report.pdf','./output/report.pdf'], ['/tmp/%E6%8A%A5%E5%91%8A%20one.docx','/tmp/报告 one.docx'],
    ['file:///tmp/a%2520b.zip','/tmp/a%20b.zip'], ['sandbox:/mnt/data/report.csv','/mnt/data/report.csv'],
    ['report.md#L12','report.md'], ['/tmp/source.ts:12:3','/tmp/source.ts'],
    ['file:///C:/reports/one.pdf','C:/reports/one.pdf'], ['C:\\reports\\one.pdf','C:\\reports\\one.pdf'],
  ]) assert.equal(localFileLink(href),path)
})

test('web, executable, malformed and network links are never treated as local downloads', () => {
  for (const href of ['https://example.com/a.pdf','http://example.com','mailto:a@b.com','javascript:alert(1)','data:text/html,hello',
    '//example.com/report','file://server/share/a.pdf','%00a.pdf','bad%ZZ.pdf','#heading','?page=1',undefined]) {
    assert.equal(localFileLink(href),undefined,href)
  }
})

const data=Buffer.from([0,255,128,10,42])
const ref={attachmentId:('sha256:'+'a'.repeat(64)) as `sha256:${string}`,name:'报告.bin',bytes:data.length}
const group:Group={members:[],rows:[{id:'upload',author:'user',text:'attached',documents:[{type:'file',attachment:ref}]}]}

test('group document download returns exact original binary bytes and filename', async()=>{
  const result=await readGroupDocument(group,'upload',0,async function*(attachment){assert.equal(attachment,ref);yield data.subarray(0,2);yield data.subarray(2)})
  assert.equal(result.name,'报告.bin');assert.deepEqual(Buffer.from(result.data,'base64'),data)
})

test('group document download cannot address another group, missing row or arbitrary attachment', async()=>{
  let reads=0
  const read=async function*(){reads++;yield data}
  for(const [room,row,index] of [[group,'other',0],[group,'upload',1],[group,'upload',-1],[group,'upload',0.5],[{members:[],rows:[]},'upload',0]] as const) {
    await assert.rejects(()=>readGroupDocument(room as Group,row,index,read),/找不到/)
  }
  assert.equal(reads,0)
})

test('incomplete and oversized document downloads fail instead of reporting success',async()=>{
  await assert.rejects(()=>readGroupDocument(group,'upload',0,async function*(){yield data.subarray(1)}),/不完整/)
  await assert.rejects(()=>readGroupDocument(group,'upload',0,async function*(){yield new Uint8Array(20*1024*1024+1)}),/上限/)
})
