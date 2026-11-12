import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { MemberRun, toolOutcome } from '../src/member-runtime.ts'

test('model silence, host wait, and the child hard limit have independent causes', async () => {
  for (const [expected, model, limits] of [
    ['model-timeout', true, { modelQuiet: 5, hostQuiet: 100, childTotal: 150 }],
    ['host-wait', false, { modelQuiet: 100, hostQuiet: 5, childTotal: 150 }],
    ['child-deadline', false, { modelQuiet: 100, hostQuiet: 150, childTotal: 5 }],
  ] as const) {
    const run = new MemberRun(new AbortController().signal, () => {}, limits)
    try {
      if (model) run.beginModel()
      await assert.rejects(run.race(() => delay(50)), reason => reason === expected)
      assert.equal(run.result(false, false).outcome, expected)
    } finally { run.dispose() }
  }
})

test('user cancellation and a saved question stop waiting immediately', async () => {
  const user = new AbortController()
  const run = new MemberRun(user.signal, () => {})
  try {
    const pending = run.race(() => delay(30))
    user.abort('new user message')
    await assert.rejects(pending, reason => reason === 'new user message')
    assert.equal(run.result(false, true).outcome, 'stopped')
  } finally { run.dispose() }
  const question = new MemberRun(new AbortController().signal, () => {})
  try {
    const pending = question.race(() => delay(30))
    question.stop('user-question')
    await assert.rejects(pending, reason => reason === 'user-question')
    assert.equal(question.result(false, false).outcome, 'user-question')
  } finally { question.dispose() }
  assert.equal(toolOutcome('APPROVAL_UNAVAILABLE'), 'approval-denied')
  assert.equal(toolOutcome('ETIMEDOUT'), 'tool-timeout')
  assert.equal(toolOutcome('UNKNOWN_TOOL'), undefined)
})
