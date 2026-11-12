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
const legacyRouting = !!upgradeFrom && JSON.parse(execFileSync('tar', ['-xOf', resolve(upgradeFrom), 'package/package.json'], { encoding: 'utf8' })).version !== '0.3.1'
const dir = await mkdtemp(join(tmpdir(), 'dsh-bots-smoke-'))
const env = { ...process.env, DSH_HOME: dir }
const session = `dsh-bots-${process.pid}`
const docs = join(dir, 'documents')
const patch = join(dir, 'smoke.patch.yml')
const requestsPath = join(dir, 'fixture-model.jsonl')
let host
let hostOutput = ''

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
  host.stdout.on('data', data => { output += data; hostOutput += data })
  host.stderr.on('data', data => { output += data; hostOutput += data })
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
  const documentPath = join(dir, 'outside-workspace.md')
  await writeFile(documentPath, '# Uploaded source\n\nDOCUMENT-CANARY-617\n')
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
    const upgrading = process.env.DSH_BOTS_SMOKE_UPGRADE
    const legacy = process.env.DSH_BOTS_SMOKE_LEGACY
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
    const summary = log.getByText(legacy ? 'KingBot | 汇总完成' : 'KingBot | 讨论汇总完成', { exact: true })
    await log.getByText(legacy ? '架构师 | 看到了架构说明' : '架构师 | 初步观点', { exact: true }).waitFor()
    await summary.waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 3) throw new Error('First turn should contain an invitation, targeted reply and summary')

    await editor.fill('@审阅员 请点评上一条')
    await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
    await log.getByText(legacy ? '审阅员 | 看到了架构说明' : '审阅员 | 初步观点', { exact: true }).waitFor()
    await summary.nth(1).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Second turn should add an invitation, targeted reply and summary')
    if (upgrading) return

    await editor.fill('@架构师 @审阅员 讨论架构建议')
    await editor.press('Enter')
    await log.getByText('架构师 | 回应 审阅员', { exact: true }).waitFor()
    await log.getByText('审阅员 | 回应 架构师', { exact: true }).waitFor()
    await summary.nth(2).waitFor()
    await page.getByRole('button', { name: /停止生成|Stop generating/i }).waitFor({ state: 'hidden' })
    if (await log.getByText('· 讨论', { exact: true }).count()) throw new Error('Discussion must not add a badge')
  }).toString().replace('process.env.DSH_BOTS_SMOKE_WORKSPACE', JSON.stringify(docs)).replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom)).replace('process.env.DSH_BOTS_SMOKE_LEGACY', String(legacyRouting)))

  const beforeRestart = await requests()
  const normalRoles = ['KingBot', '架构师', 'KingBot', 'KingBot', '审阅员', 'KingBot']
  const discussionRoles = upgradeFrom ? [] : ['KingBot', '审阅员', 'KingBot', '架构师', 'KingBot', '审阅员', 'KingBot', 'KingBot']
  assert.deepEqual(beforeRestart.map(item => item.role), [...normalRoles, ...discussionRoles])
  assert.ok(beforeRestart.every(item => item.tools.every(name => item.discussion && ['read', 'read_image'].includes(name))))
  assert.match(beforeRestart[4].input, legacyRouting ? /架构师 \| 看到了架构说明/u : /架构师 \| 初步观点/u)
  if (!upgradeFrom) {
    const moderatorTurns = beforeRestart.slice(normalRoles.length).filter(item => item.moderator).map(item => JSON.parse(JSON.parse(item.input).最新用户消息))
    assert.equal(moderatorTurns.length, 4)
    assert.deepEqual(moderatorTurns[0].已有讨论, [])
    assert.equal(moderatorTurns[1].已有讨论[0].text, '审阅员 | 初步观点')
    assert.equal(moderatorTurns[2].已有讨论[1].text, '架构师 | 回应 审阅员')
    assert.equal(moderatorTurns[3].允许收束, true)
    const summary = JSON.parse(JSON.parse(beforeRestart.at(-1).input).最新用户消息)
    assert.deepEqual(summary.已有讨论.map(item => item.name), ['审阅员', '架构师', '审阅员'])
  }
  await stopHost()
  const previous = upgradeFrom ? await savedIdentities() : undefined
  if (previous) {
    assert.equal(beforeRestart[0].speaker, previous.king.title)
    assert.match(previous.king.title, /^(Bots King|KingBot)$/)
    run('dsh', ['plugin', '--profile', 'web', 'add', join(dir, archive)])
  }

  browser('goto', await startHost())
  browser('run-code', (async page => {
    const upgrading = process.env.DSH_BOTS_SMOKE_UPGRADE
    const legacy = process.env.DSH_BOTS_SMOKE_LEGACY
    await page.getByRole('button', { name: 'Bots', exact: true }).waitFor()
    if (upgrading) {
      await page.getByRole('button', { name: 'Bots', exact: true }).click()
      await page.getByRole('button', { name: '与 KingBot 对话', exact: true }).click()
      await page.getByText('KingBot · 专属对话', { exact: true }).waitFor()
    }
    const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
    await workspace.waitFor()
    const conversation = page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ })
    if (!await conversation.isVisible() && await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
    await conversation.click()
    const log = page.getByRole('log', { name: '群聊时间线' })
    await log.getByText('KingBot', { exact: true }).first().waitFor()
    if (upgrading) {
      await log.getByText(legacy ? 'KingBot | 汇总完成' : 'KingBot | 讨论汇总完成', { exact: true }).nth(1).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== 6) throw new Error('Upgrade should restore the old replies')
    } else {
      await log.getByText('KingBot | 讨论汇总完成', { exact: true }).nth(2).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== 13) throw new Error('Restart should restore discussion')
    }

    const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
    await editor.fill('@审阅员 重启后继续')
    await editor.press('Enter')
    await log.getByText('KingBot | 讨论汇总完成', { exact: true }).nth(legacy ? 0 : upgrading ? 2 : 3).waitFor()

    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
    await page.getByRole('button', { name: '默认', exact: true, pressed: true }).waitFor()
    if (await log.count()) throw new Error('A default conversation must not show a group timeline')
    await editor.fill('普通会话测试')
    await editor.press('Enter')
    await page.getByRole('paragraph').filter({ hasText: /^默认 \| 已收到$/ }).waitFor()
  }).toString().replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom)).replace('process.env.DSH_BOTS_SMOKE_LEGACY', String(legacyRouting)))

  const afterRestart = await requests()
  assert.deepEqual(afterRestart.map(item => item.role), [...normalRoles, ...discussionRoles, 'KingBot', '审阅员', 'KingBot', '默认'])
  assert.match(afterRestart.at(-3).input, previous ? /请点评上一条/u : /架构师 \| 回应 审阅员/u)
  assert.equal(afterRestart.at(-4).speaker, 'KingBot')
  assert.equal(afterRestart.at(-1).input, '普通会话测试')
  if (previous) {
    assert.deepEqual(await savedIdentities(), { ...previous, king: { ...previous.king, title: 'KingBot' } })
    console.log(`Verified upgrade, KingBot rename, and preserved session identities on DSH ${runtime}.`)
  } else {
    browser('run-code', (async page => {
      await page.getByRole('button', { name: 'Bots', exact: true }).click()
      await page.getByRole('button', { name: '与 KingBot 对话', exact: true }).click()
      await page.getByText('KingBot · 专属对话', { exact: true }).waitFor()
      const log = page.getByRole('log', { name: '群聊时间线' })
      const replies = log.locator('article[data-author=bot] p')
      const send = async text => {
        const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
        await editor.fill(text)
        await editor.press('Enter')
      }
      await send('方案/流程助手、记录助手你都帮我建立一下')
      await replies.last().filter({ hasText: /已创建子 Bot.*方案-流程助手/s }).waitFor()
      await send('方案/流程助手、记录助手你都帮我建立一下')
      await replies.last().filter({ hasText: /已存在，保留原设置.*方案-流程助手/s }).waitFor()
      await send('资料核对助手你帮我建立一下')
      await replies.last().filter({ hasText: /已创建子 Bot.*资料核对助手/s }).waitFor()

      await send('请帮我完成离线清单方案，让合适的成员讨论后给我结论')
      await replies.last().filter({ hasText: /建群方案：清单设计讨论.*建议新建 离线方案审阅员.*目标工作区/s }).waitFor()
      const workspace = (await replies.last().textContent()).match(/目标工作区：([^（\n]+)/)[1]
      if (await page.getByRole('button', { name: '打开群聊' }).count()) throw new Error('A proposal must not create the group before confirmation')
      await send('工作区：不存在的测试目录')
      await replies.last().filter({ hasText: /请用「工作区：完整路径」/ }).waitFor()
      await send('确认建群')
      await replies.last().filter({ hasText: /请先确认目标工作区/ }).waitFor()
      await send(`工作区：${workspace}`)
      await replies.last().filter({ hasText: /同意在该工作区建群并创建上述新 Bot/ }).waitFor()
      await send('确认建群')
      await replies.last().filter({ hasText: /群聊结论：.*KingBot \| 讨论汇总完成/s }).waitFor()
      const opened = page.getByRole('button', { name: '打开群聊', exact: true })
      if (await opened.count() !== 1) throw new Error('Confirmation must create exactly one group')
      await send('确认建群')
      await replies.last().filter({ hasText: /当前没有待确认的建群方案/ }).waitFor()
      await opened.click()
      await log.getByText('KingBot | 讨论汇总完成', { exact: true }).waitFor()
      await log.getByText('架构师 | 回应 离线方案审阅员', { exact: true }).waitFor()
      await log.getByText('完成离线清单方案，比较同步与纯本地方案', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Bots', exact: true }).click()
      await page.getByRole('heading', { name: '离线方案审阅员', exact: true }).waitFor()
      await page.getByRole('button', { name: '与 KingBot 对话', exact: true }).click()
      await send('请新建空白验收群聊，成员为 @架构师')
      await replies.last().filter({ hasText: /建群方案：空白验收群.*本次只建立群聊/s }).waitFor()
      await send('确认建群')
      await replies.last().filter({ hasText: /群成员已就位/ }).waitFor()
    }).toString())
    await stopHost()
    browser('goto', await startHost())
    browser('run-code', (async page => {
      const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
      await workspace.waitFor()
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      await page.getByRole('treeitem', { name: '群聊 · 空白验收群' }).click()
      const room = page.getByRole('region', { name: '群聊', exact: true })
      await room.getByText('仅创建群聊', { exact: true }).waitFor()
      const log = room.getByRole('log', { name: '群聊时间线' })
      if (await log.count()) throw new Error('An empty group must wait for its first message')
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      await editor.fill('检查空白群重启后能否发言')
      await editor.press('Enter')
      await log.getByText('KingBot | 讨论汇总完成', { exact: true }).waitFor()
    }).toString())
    browser('run-code', (async page => {
      const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
      await workspace.waitFor()
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
      const log = page.getByRole('log', { name: '群聊时间线' })
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      const summary = log.getByText('KingBot | 讨论汇总完成', { exact: true })
      await summary.nth(3).waitFor()
      const send = async (text, key = 'Enter') => {
        await editor.and(page.locator('[contenteditable="true"]')).fill(text)
        await editor.press(key)
      }
      await send('@架构师 @审阅员 验收主持恢复：讨论数据索引')
      await summary.nth(4).waitFor()
      await log.getByText('你如何回应 审阅员 的意见？请结合当前议题补充依据。', { exact: false }).waitFor()
      await send('@审阅员 周末怎么烤面包')
      await summary.nth(5).waitFor()
      await send('@架构师 @审阅员 验收实时插话原议题')
      await log.locator('article[data-author=bot]')
        .filter({ has: page.getByText('架构师', { exact: true }) })
        .filter({ has: page.getByText('正在回复…', { exact: true }) }).waitFor()
      await send('@审阅员 验收插话后只核对核心证据', 'Control+Enter')
      await log.getByText('已收到插话，KingBot 将按新消息继续。', { exact: true }).waitFor({ timeout: 5500 })
      await log.getByText('正在汇总结果…', { exact: true }).last().waitFor({ timeout: 5500 })
      await send('@架构师 验收排队正常处理')
      await summary.nth(6).waitFor({ timeout: 5500 })
      await summary.nth(7).waitFor()
      if (await log.getByText(/执行失败.*(?:JSON 格式|还有需要听取的成员)/).count()) throw new Error('Moderator recovery should not abort the discussion')
      await page.locator('input[type=file]').setInputFiles(process.env.DSH_BOTS_SMOKE_DOCUMENT)
      await editor.fill('@审阅员 验收读取拖入文档')
      const sendButton = page.getByRole('button', { name: /^(发送消息|Send message)$/i })
      await sendButton.click()
      await log.getByRole('list', { name: '文档附件' }).getByText('outside-workspace.md', { exact: true }).waitFor()
      await log.getByRole('heading', { name: '文档要点', exact: true }).waitFor()
      await log.getByRole('table').getByRole('cell', { name: 'DOCUMENT-CANARY-617', exact: true }).waitFor()
      await summary.nth(8).waitFor()
    }).toString().replace('process.env.DSH_BOTS_SMOKE_DOCUMENT', JSON.stringify(documentPath)))
    const completed = await requests()
    const moderatorState = item => JSON.parse(JSON.parse(item.input).最新用户消息)
    const recoveries = completed.filter(item => item.moderator && moderatorState(item).议题.includes('验收主持恢复'))
    const retries = recoveries.filter(item => moderatorState(item).上次决定被拒绝)
    assert.equal(retries.length, 2)
    assert.ok(retries.every(item => item.recoveryInstructions))
    assert.equal(moderatorState(recoveries.at(-1)).已有讨论[1].text, '架构师 | 回应 审阅员')
    const independent = completed.filter(item => item.role !== '默认' && JSON.parse(item.input).最新用户消息.includes('周末怎么烤面包'))
    assert.equal(independent.length, 3)
    assert.ok(independent.every(item => !item.seesPreviousTask), 'New topics must not inherit old model messages')
    const redirected = completed.find(item => item.moderator && moderatorState(item).议题.includes('验收插话后只核对核心证据'))
    assert.match(redirected.input, /验收实时插话原议题/)
    assert.match(redirected.input, /审阅员 \| 初步观点/)
    const queued = completed.find(item => item.moderator && moderatorState(item).议题.includes('验收排队正常处理'))
    assert.ok(completed.indexOf(queued) > completed.indexOf(redirected))
    assert.equal(completed.filter(item => item.discussion && item.role === '架构师' && moderatorState(item).议题.includes('验收实时插话原议题')).length, 1)
    assert.equal(completed.filter(item => !item.moderator && item.role === 'KingBot' && JSON.parse(item.input).最新用户消息.includes('验收实时插话原议题')).length, 0)
    const recovery = completed.filter(item => item.role === 'KingBot' && item.input.includes('上次回复校验失败：第 1 个子 Bot'))
    assert.equal(recovery.length, 1)
    const delegated = completed.filter(item => item.moderator && item.input.includes('完成离线清单方案'))
    assert.ok(delegated.length >= 3)
    assert.ok(completed.filter(item => item.role !== '默认').every(item => item.tools.every(name => (!item.moderator && ['read', 'read_image'].includes(name)) || item.discussion && name === 'read_uploaded_document')))
    console.log(`Verified natural Bot creation, dynamic discussion, confirmed group placement, and return of results on DSH ${runtime}.`)
  }
} catch (error) {
  const diagnostics = hostOutput.split('\n').filter(line => /warn|error|dsh-bots|checkpoint/i.test(line)).slice(-20).join('\n')
  if (diagnostics) console.error(diagnostics.replace(/token=[\w-]+/g, 'token=[redacted]'))
  throw error
} finally {
  try { browser('close') } catch {}
  await stopHost()
  console.log(`Isolated smoke data: ${dir}`)
}
