import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { zstdDecompressSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const { engines } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const upgradeFrom = process.env.DSH_BOTS_UPGRADE_FROM
const dir = await mkdtemp(join(tmpdir(), 'dsh-bots-smoke-'))
const env = { ...process.env, DSH_HOME: dir }
const session = `dsh-bots-${process.pid}`
const docs = join(dir, 'documents')
const patch = join(dir, 'smoke.patch.yml')
const requestsPath = join(dir, 'fixture-model.jsonl')
let host

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000 })
}

function browser(...args) {
  const result = run('npx', ['--yes', '--package', '@playwright/cli@0.1.24', 'playwright-cli', `-s=${session}`, ...args], dir)
  if (result.includes('### Error')) throw new Error(result.replace(/token=[\w-]+/g, 'token=[redacted]'))
  return result
}

async function startHost() {
  host = spawn('dsh', ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0'], {
    cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  host.stdout.on('data', data => { output += data })
  host.stderr.on('data', data => { output += data })
  const deadline = Date.now() + 20_000
  while (host.exitCode === null && Date.now() < deadline) {
    const url = /dsh web: (https?:\/\/\S+)/.exec(output)?.[1]
    if (url) return url
    await delay(100)
  }
  throw new Error(`DSH Web did not start: ${output.replace(/token=[\w-]+/g, 'token=[redacted]')}`)
}

async function stopHost() {
  if (!host || host.exitCode !== null || host.signalCode !== null) return
  const exited = once(host, 'exit')
  host.kill('SIGTERM')
  await exited
}

async function requests() {
  return (await readFile(requestsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
}

async function savedIdentities() {
  const sessions = join(dir, 'sessions')
  const paths = await readdir(sessions, { recursive: true })
  let group, king
  for (const path of paths.filter(path => /session\.v\d+\.jsonl(?:\.zstd)?$/.test(path))) {
    const bytes = await readFile(join(sessions, path))
    const text = (path.endsWith('.zstd') ? zstdDecompressSync(bytes) : bytes).toString()
    if (!text.includes('plugin:dsh-bots/')) continue
    const events = text.trim().split('\n').map(line => JSON.parse(line))
    const record = type => events.findLast(event => event.type === type)?.data
    const id = path.split('/').at(-2)
    const title = record('session/title')?.title
    if (title === '群聊 · @架构师 给出架构说明') {
      group = {
        id,
        coordinator: record('plugin:dsh-bots/coordinator').sessionId,
        children: record('plugin:dsh-bots/members').map(member => member.sessionId),
      }
    }
    if (record('plugin:dsh-bots/king')) king = { id, title }
  }
  assert.ok(group && king, 'Both the group and the dedicated coordinator session must be saved')
  return { group, king }
}

try {
  const runtime = run('dsh', ['--version']).trim()
  assert.ok(engines.dsh.split(' || ').includes(runtime), `Unsupported DSH smoke runtime: ${runtime}`)
  await mkdir(docs)
  const archive = run('npm', ['pack', '--silent', '--pack-destination', dir]).trim()
  run('dsh', ['--profile', 'web', '--dump-config'])
  run('dsh', ['plugin', '--profile', 'web', 'add', upgradeFrom ? resolve(upgradeFrom) : join(dir, archive)])
  await writeFile(patch, `- id: agent-default-model
  config:
    provider: bots-fixture
    model: fixture
- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(docs)}
- insert:
    - id: bots-fixture-model
      name: ${JSON.stringify(decodeURIComponent(new URL('scripts/fixture-model.mjs', root).pathname))}
`)

  browser('open', await startHost(), '--browser=chrome')
  browser('run-code', (async page => {
    const preview = page.getByRole('button', { name: /^(继续|Continue)$/ })
    await page.getByRole('button', { name: 'Bots', exact: true }).waitFor()
    if (await preview.isVisible()) await preview.click()
    await page.getByRole('button', { name: 'Bots', exact: true }).click()
    await page.getByText('尚未创建子 Bot。点击“新建 Bot”定义名称和职责，再创建群聊。', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: /^(KingBot|Bots King) 工作区目录$/ }).fill(process.env.DSH_BOTS_SMOKE_WORKSPACE)
    await page.getByRole('button', { name: '启用工作区', exact: true }).click()
    await page.getByRole('button', { name: /^与 (KingBot|Bots King) 对话$/ }).waitFor()
    for (const [name, duty] of [['架构师', '提出技术方案'], ['审阅员', '审阅方案并提出验收建议']]) {
      await page.getByRole('button', { name: '新建 Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Bot 名称', exact: true }).fill(name)
      await page.getByRole('textbox', { name: 'Bot 职责', exact: true }).fill(duty)
      await page.getByRole('button', { name: '保存 Bot', exact: true }).click()
      await page.getByRole('heading', { name, exact: true }).waitFor()
    }
    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
    await page.getByRole('button', { name: '群聊', exact: true }).click()
    await page.getByRole('checkbox', { name: /架构师/ }).check()
    await page.getByRole('checkbox', { name: /审阅员/ }).check()
    await page.getByRole('button', { name: '确认成员' }).click()
    await page.getByRole('region', { name: '群聊', exact: true }).waitFor()

    const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
    await page.getByRole('button', { name: /@架构师/ }).click()
    await editor.getByText('@架构师').waitFor()
    await editor.fill('@架构师 给出架构说明')
    await editor.press('Enter')
    const log = page.getByRole('log', { name: '群聊时间线' })
    await log.getByText('架构师 | 看到了架构说明', { exact: true }).waitFor()
    await log.getByText('KingBot | 汇总完成', { exact: true }).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 3) throw new Error('First turn should contain plan, targeted reply and summary')

    await editor.fill('@审阅员 请点评上一条')
    await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
    await log.getByText('审阅员 | 看到了架构说明', { exact: true }).waitFor()
    await log.getByText('KingBot | 汇总完成', { exact: true }).nth(1).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Second turn should add plan, targeted reply and summary')
    if (process.env.DSH_BOTS_SMOKE_UPGRADE) return

    await page.getByRole('button', { name: '发起讨论' }).click()
    await editor.getByText('讨论：', { exact: true }).waitFor()
    await editor.fill('讨论：@架构师 只有一个点名')
    await editor.press('Enter')
    await log.getByText(/讨论至少需要两名子 Bot/).waitFor()

    await editor.fill('讨论：@架构师 @审阅员 各给建议，然后互评')
    await editor.press('Enter')
    await log.getByText('架构师 | 点评 审阅员', { exact: true }).waitFor()
    await log.getByText('审阅员 | 点评 架构师', { exact: true }).waitFor()
    await log.getByText('KingBot | 讨论汇总完成', { exact: true }).waitFor()
    if (await log.getByText('· 讨论', { exact: true }).count() !== 2) throw new Error('Both peer replies must be labeled as discussion')
  }).toString().replace('process.env.DSH_BOTS_SMOKE_WORKSPACE', JSON.stringify(docs)).replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom)))

  const beforeRestart = await requests()
  const normalRoles = ['KingBot', '架构师', 'KingBot', 'KingBot', '审阅员', 'KingBot']
  const discussionRoles = upgradeFrom ? [] : ['KingBot', '架构师', '审阅员', '架构师', '审阅员', 'KingBot']
  assert.deepEqual(beforeRestart.map(item => item.role), [...normalRoles, ...discussionRoles])
  assert.ok(beforeRestart.every(item => item.tools.length === 0))
  assert.match(beforeRestart[4].input, /架构师 \| 看到了架构说明/u)
  if (!upgradeFrom) {
    const peerReviews = beforeRestart.filter(item => item.review).map(item => JSON.parse(JSON.parse(item.input).最新用户消息))
    assert.equal(peerReviews.length, 2)
    assert.deepEqual(peerReviews[0].本轮初答.map(item => item.name), ['架构师', '审阅员'])
    assert.deepEqual(peerReviews[0].已有互评, [])
    assert.match(peerReviews[1].已有互评[0].text, /架构师 \| 点评 审阅员/u)
    const summary = JSON.parse(JSON.parse(beforeRestart.at(-1).input).最新用户消息)
    assert.deepEqual(summary.本轮互评.map(item => item.name), ['架构师', '审阅员'])
  }
  await stopHost()
  const previous = upgradeFrom ? await savedIdentities() : undefined
  if (previous) {
    assert.equal(beforeRestart[0].speaker, 'Bots King')
    assert.equal(previous.king.title, 'Bots King')
    run('dsh', ['plugin', '--profile', 'web', 'add', join(dir, archive)])
  }

  browser('goto', await startHost())
  browser('run-code', (async page => {
    const upgrading = process.env.DSH_BOTS_SMOKE_UPGRADE
    if (upgrading) {
      await page.getByRole('button', { name: 'Bots', exact: true }).click()
      await page.getByRole('button', { name: '与 KingBot 对话', exact: true }).click()
      await page.getByText('KingBot · 专属对话', { exact: true }).waitFor()
    }
    const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
    await workspace.waitFor()
    if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
    await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
    const log = page.getByRole('log', { name: '群聊时间线' })
    await log.getByText('KingBot', { exact: true }).first().waitFor()
    if (upgrading) {
      await log.getByText('KingBot | 汇总完成', { exact: true }).nth(1).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Upgrade should restore the old replies')
    } else {
      await log.getByText('KingBot | 讨论汇总完成', { exact: true }).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== 12) throw new Error('Restart should restore dispatch and discussion')
      if (await log.getByText('· 讨论', { exact: true }).count() !== 2) throw new Error('Restart should retain discussion labels')
    }

    const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
    await editor.fill('@审阅员 重启后继续')
    await editor.press('Enter')
    await log.getByText('KingBot | 汇总完成', { exact: true }).nth(2).waitFor()

    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
    await page.getByRole('button', { name: '默认', exact: true, pressed: true }).waitFor()
    if (await log.count()) throw new Error('A default conversation must not show a group timeline')
    await editor.fill('普通会话测试')
    await editor.press('Enter')
    await page.getByRole('paragraph').filter({ hasText: /^默认 \| 已收到$/ }).waitFor()
  }).toString().replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom)))

  const afterRestart = await requests()
  assert.deepEqual(afterRestart.map(item => item.role), [...normalRoles, ...discussionRoles, 'KingBot', '审阅员', 'KingBot', '默认'])
  assert.match(afterRestart.at(-3).input, previous ? /请点评上一条/u : /架构师 \| 点评 审阅员/u)
  assert.equal(afterRestart.at(-4).speaker, 'KingBot')
  assert.equal(afterRestart.at(-1).input, '普通会话测试')
  if (previous) {
    assert.deepEqual(await savedIdentities(), { ...previous, king: { ...previous.king, title: 'KingBot' } })
    console.log(`Verified upgrade, KingBot rename, and preserved session identities on DSH ${runtime}.`)
  } else {
    console.log(`Verified named dispatch, peer discussion, restart, and default chat on DSH ${runtime}.`)
  }
} finally {
  try { browser('close') } catch {}
  await stopHost()
  console.log(`Isolated smoke data: ${dir}`)
}
