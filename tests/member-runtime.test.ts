import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { MemberRun, toolOutcome } from '../src/member-runtime.ts'

test('model silence, host wait, and the child hard limit have independent causes', async () => {
  for (const [expected, model, limits] of [
    ['model-timeout', true, { modelQuiet: 5, hostQuiet: 100, childTotal: 150 }],
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


test('host waiting does not cancel the child or restart its operation', async () => {
  let waiting = false
  const run = new MemberRun(new AbortController().signal, state => { waiting ||= Boolean(state.waiting) }, { firstToken: 80, modelQuiet: 30, hostQuiet: 5, childTotal: 200 })
  try {
    run.beginModel()
    await run.race(() => delay(20))
    assert(waiting)
    assert(!run.signal.aborted)
    run.modelOutput()
    run.appendText('partial 123.45')
    assert.equal(run.partialText(), 'partial 123.45')
    assert.equal(run.result(true, false).outcome, 'completed')
  } finally { run.dispose() }
})

test('real progress renews idle time but never removes the total bound', async () => {
  const run = new MemberRun(new AbortController().signal, () => {}, { firstToken: 100, modelQuiet: 20, hostQuiet: 10, childTotal: 65 })
  const progress = setInterval(() => run.modelOutput(), 5)
  try {
    run.beginModel()
    await assert.rejects(run.race(() => delay(150)), reason => reason === 'child-deadline')
    assert(run.snapshot().lastActivityAt! > run.snapshot().startedAt)
  } finally { clearInterval(progress); run.dispose() }
})


test('default total limit is disabled; explicit stop still cancels ongoing progress', async () => {
  const user = new AbortController()
  const run = new MemberRun(user.signal, () => {}, { firstToken: 50, modelQuiet: 50, hostQuiet: 5, childTotal: 0 })
  const progress = setInterval(() => run.modelOutput(), 5)
  try {
    run.beginModel()
    await run.race(() => delay(90))
    assert.equal(run.snapshot().budgets?.childTotal, 0)
    assert(!run.signal.aborted)
    const waiting = run.race(() => delay(50))
    user.abort('stop')
    await assert.rejects(waiting, reason => reason === 'stop')
  } finally { clearInterval(progress); run.dispose() }
})
