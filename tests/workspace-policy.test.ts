import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertRootCreation, isKingWorkspace } from '../src/workspace-policy.ts'

test('King workspace rejects new root chats including symlink aliases, but permits children, recovery and other workspaces',()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-policy-')), path=join(root,'Bots'), other=join(root,'Other'), alias=join(root,'alias')
  mkdirSync(path);mkdirSync(other);symlinkSync(path,alias)
  const selected={path,sessionId:'king'}
  try {
    for(const cwd of [path,alias])assert.throws(()=>assertRootCreation(selected,{cwd,sessionId:'ordinary',source:'startup'}),/不能新建/)
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'child',source:'startup',origin:'subagent'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'king',source:'resume'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'historical',source:'resume'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:other,sessionId:'group',source:'startup'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'bot-session',source:'startup'},['bot-session']))
    assert.throws(()=>assertRootCreation(selected,{cwd:path,sessionId:'second-bot-session',source:'startup'},['bot-session']),/不能新建/)
    assert.equal(isKingWorkspace(alias,selected),true);assert.equal(isKingWorkspace(other,selected),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
