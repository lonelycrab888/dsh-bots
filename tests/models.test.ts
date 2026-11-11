import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/config.ts'
import { defaultLibrary, modelForBot, validateLibrary } from '../src/bots.ts'
test('per-Bot routes persist, follow current model by default, and omit incompatible effort on override', () => {
  const fallback = { provider: 'native', model: 'default', reasoningEffort: 'high' }
  const library = validateLibrary({ ...defaultLibrary, kingModel: { provider: 'api-a', model: 'main' }, bots: defaultLibrary.bots.map(bot => ({ ...bot, model: { provider: 'api-b', model: 'worker' } })) })
  assert.deepEqual(modelForBot(library, 'coordinator', fallback), library.kingModel)
  assert.deepEqual(modelForBot(library, 'architect', fallback), { provider: 'api-b', model: 'worker' })
  assert.deepEqual(modelForBot(defaultLibrary, 'architect', fallback), fallback)
  const config = Config(JSON.parse(JSON.stringify({ library })))
  assert.deepEqual(config.library.get().bots[0].model, library.bots[0].model)
  assert.throws(() => Config({ library: { ...defaultLibrary, kingModel: { provider: 'bad' } } }))
  assert.equal(Config({ library: { ...library, kingModel: undefined } }).library.get().kingModel, undefined)
})
test('reasoning effort persists per Bot and the native fallback is never mutated', () => {
  const fallback = { provider: 'native', model: 'default', reasoningEffort: 'high' }
  const route = { provider: 'api', model: 'worker', reasoningEffort: 'low' }
  const library = validateLibrary({ ...defaultLibrary, kingModel: route, bots: defaultLibrary.bots.map(bot => ({ ...bot, model: route })) })
  const restored = Config(JSON.parse(JSON.stringify({ library }))).library.get()
  assert.equal(modelForBot(restored, 'coordinator', fallback).reasoningEffort, 'low')
  assert.equal(modelForBot(restored, 'architect', fallback).reasoningEffort, 'low')
  assert.equal(fallback.reasoningEffort, 'high')
  assert.throws(() => validateLibrary({ ...library, kingModel: { ...route, reasoningEffort: '' } }))
})
