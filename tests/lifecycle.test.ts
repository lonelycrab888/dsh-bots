import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchActivation } from '../src/lifecycle.ts'
const tick = () => new Promise(resolve => setImmediate(resolve))
test('disabling, re-enabling and unloading own exactly one disposable UI scope', async () => {
  let enabled = true, refresh = () => {}, mounts = 0, disposed = 0, unsubscribed = 0
  const stop = watchActivation({ read: async () => enabled, subscribe: callback => { refresh = callback; return () => { unsubscribed++ } }, mount: () => { mounts++; return { dispose: () => { disposed++ } } } })
  await tick(); refresh(); await tick(); assert.equal(mounts, 1)
  enabled = false; refresh(); await tick(); assert.equal(disposed, 1)
  enabled = true; refresh(); await tick(); assert.equal(mounts, 2)
  stop(); assert.equal(disposed, 2); assert.equal(unsubscribed, 1)
})
test('an outdated enable result cannot resurrect a disabled or unloaded interface', async () => {
  const pending: ((enabled: boolean) => void)[] = []; let refresh = () => {}, mounts = 0
  const stop = watchActivation({ read: () => new Promise(resolve => pending.push(resolve)), subscribe: callback => { refresh = callback; return () => {} }, mount: () => { mounts++; return { dispose() {} } } })
  refresh(); pending[1](false); await tick(); pending[0](true); await tick(); assert.equal(mounts, 0)
  refresh(); stop(); pending[2](true); await tick(); assert.equal(mounts, 0)
})
