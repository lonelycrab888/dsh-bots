import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = new URL('../', import.meta.url)
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

try {
  assert.equal(run('dsh', ['--version']).trim(), '0.2.2-rc.1')
  await mkdir(docs)
  const archive = run('npm', ['pack', '--silent', '--pack-destination', dir]).trim()
  run('dsh', ['--profile', 'web', '--dump-config'])
  run('dsh', ['plugin', '--profile', 'web', 'add', join(dir, archive)])
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
    await page.getByRole('textbox', { name: 'Bots King 工作区目录', exact: true }).fill(process.env.DSH_BOTS_SMOKE_WORKSPACE)
    await page.getByRole('button', { name: '启用工作区', exact: true }).click()
    await page.getByRole('button', { name: '与 Bots King 对话', exact: true }).waitFor()
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
    await log.getByText('Bots King | 汇总完成', { exact: true }).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 3) throw new Error('First turn should contain plan, targeted reply and summary')

    await editor.fill('@审阅员 请点评上一条')
    await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
    await log.getByText('审阅员 | 看到了架构说明', { exact: true }).waitFor()
    await log.getByText('Bots King | 汇总完成', { exact: true }).nth(1).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Second turn should add plan, targeted reply and summary')
  }).toString().replace('process.env.DSH_BOTS_SMOKE_WORKSPACE', JSON.stringify(docs)))

  const beforeRestart = await requests()
  assert.deepEqual(beforeRestart.map(item => item.role), ['Bots King', '架构师', 'Bots King', 'Bots King', '审阅员', 'Bots King'])
  assert.ok(beforeRestart.every(item => item.tools.length === 0))
  assert.match(beforeRestart[4].input, /架构师 \| 看到了架构说明/u)
  await stopHost()

  browser('goto', await startHost())
  browser('run-code', (async page => {
    await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
    const log = page.getByRole('log', { name: '群聊时间线' })
    await log.getByText('架构师 | 看到了架构说明', { exact: true }).waitFor()
    await log.getByText('审阅员 | 看到了架构说明', { exact: true }).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Restart should restore both rounds including main Bot')

    const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
    await editor.fill('@审阅员 重启后继续')
    await editor.press('Enter')
    await log.getByText('审阅员 | 看到了架构说明', { exact: true }).nth(1).waitFor()
    await log.getByText('Bots King | 汇总完成', { exact: true }).nth(2).waitFor()

    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
    await page.getByRole('button', { name: '默认', exact: true, pressed: true }).waitFor()
    if (await log.count()) throw new Error('A default conversation must not show a group timeline')
    await editor.fill('普通会话测试')
    await editor.press('Enter')
    await page.getByText('默认 | 已收到', { exact: true }).waitFor()
  }).toString())

  const afterRestart = await requests()
  assert.deepEqual(afterRestart.map(item => item.role), ['Bots King', '架构师', 'Bots King', 'Bots King', '审阅员', 'Bots King', 'Bots King', '审阅员', 'Bots King', '默认'])
  assert.match(afterRestart[7].input, /请点评上一条/u)
  console.log('Verified native composer, named replies, persistent group history, and default chat.')
} finally {
  try { browser('close') } catch {}
  await stopHost()
  console.log(`Isolated smoke data: ${dir}`)
}
