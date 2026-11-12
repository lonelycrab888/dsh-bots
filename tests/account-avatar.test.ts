import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { avatarStore, followAccountAvatar, type AccountFrame } from '../src/account-avatar.ts'

test('account avatar accepts both Harness frame shapes and clears while changing credentials', async () => {
  const avatar = avatarStore()
  const controller = new AbortController()
  const events: AccountFrame[] = []
  let wake: (() => void) | undefined
  let accepted = 0
  async function* stream() {
    while (!controller.signal.aborted) {
      if (!events.length) await new Promise<void>(resolve => { wake = resolve })
      const frame = events.shift()
      if (frame) yield frame
    }
  }
  const send = async (value: AccountFrame['value']) => {
    events.push({ value, accept: () => { accepted++ } })
    wake?.()
    await tick()
  }
  let profile: string | null = null
  let loaded = true
  let resolveDelayed: ((loaded: boolean) => void) | undefined
  const following = followAccountAvatar(stream(), async () => profile, async url =>
    url.includes('delayed') ? new Promise(resolve => { resolveDelayed = resolve }) : loaded,
  avatar.publish, controller.signal)
  const signedIn = { status: 'credential-stored' }
  await send({ status: 'signed-out' })
  assert.equal(avatar.getSnapshot(), undefined)
  await send(signedIn)
  assert.equal(avatar.getSnapshot(), undefined)
  profile = 'https://example.test/original.png'
  await send(signedIn)
  assert.equal(avatar.getSnapshot(), profile)
  profile = 'https://example.test/delayed.png'
  await send({ state: signedIn })
  assert.equal(avatar.getSnapshot(), undefined)
  await send({ state: { status: 'signed-out' } })
  resolveDelayed!(true)
  await tick()
  assert.equal(avatar.getSnapshot(), undefined)
  loaded = false
  profile = 'https://example.test/broken.png'
  await send({ state: signedIn })
  assert.equal(avatar.getSnapshot(), undefined)
  loaded = true
  profile = 'https://example.test/new-account.png'
  await send({ state: signedIn })
  assert.equal(avatar.getSnapshot(), profile)
  avatar.failed(profile)
  assert.equal(avatar.getSnapshot(), undefined)
  controller.abort()
  wake?.()
  await following
  assert.equal(accepted, 7)
})
