import assert from 'node:assert/strict'
import semver from 'semver'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { constants as zlibConstants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const { engines, name: packageName } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const upgradeFrom = process.env.DSH_BOTS_UPGRADE_FROM
const oldPackage = upgradeFrom && JSON.parse(execFileSync('tar', ['-xOf', resolve(upgradeFrom), 'package/package.json'], { encoding: 'utf8' }))
const oldVersion = oldPackage && oldPackage.version
const legacyRouting = !!oldVersion && !['0.2.2', '0.3.1', '0.3.2', '0.3.3', '0.3.4', '0.3.5', '0.3.6', '0.3.7', '0.3.8', '0.3.9', '0.3.10'].includes(oldVersion)
const oldRoutesThroughKing = legacyRouting || ['0.2.2', '0.3.1', '0.3.2'].includes(oldVersion)
const oldMentions = !!oldVersion && !['0.3.6', '0.3.7', '0.3.8', '0.3.9', '0.3.10'].includes(oldVersion)
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

async function stopHost(signal = 'SIGTERM') {
  if (!host || host.exitCode !== null || host.signalCode !== null) return
  const exited = once(host, 'exit')
  host.kill(signal)
  await exited
}

async function requests() {
  return (await readFile(requestsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
}

async function exerciseNativeBots() {
  browser('run-code', (async page => {
    const button=name=>page.getByRole('button',{name,exact:true})
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    async function send(text,expected){const replies=page.getByText(expected,{exact:false});const before=await replies.count();await editor.fill(text);await button('发送消息').click();await replies.nth(before).waitFor({timeout:20000})}
    const kingRowBefore=page.getByRole('treeitem',{name:/^King Arthur/}).and(page.locator('[data-row-key^="session:"]')).first()
    const account=kingRowBefore.locator('xpath=ancestor::div[.//*[@data-row-key and starts-with(@data-row-key,"workspace:")]][1]')
    const before=await account.locator('[data-row-key^="session:"]').count()
    const create=account.locator('[data-row-key^="workspace:"] button:not([aria-haspopup])')
    await account.locator('[data-row-key^="workspace:"]').hover()
    await create.waitFor({state:'visible'})
    if(!await create.isDisabled())throw new Error('King workspace New Session must be disabled')
    if(!await page.locator('[data-row-key^="workspace:"] button:not([aria-haspopup]):enabled').count())throw new Error('Other workspace creation was disabled')
    await button('新建会话').last().click()
    await page.getByText('King Arthur 工作区不允许手动新建会话。',{exact:false}).last().waitFor()
    if(await account.locator('[data-row-key^="session:"]').count()!==before)throw new Error('New Session created an orphan in the King workspace')
    await send('V041-WINDOWS 创建 Bot 后核对独聊','V041-WINDOWS-DONE')
    await page.getByRole('treeitem', { name: /^版本助手/ }).and(page.locator('[data-row-key^="session:"]')).waitFor({ timeout: 8000 })
    await send('V045-UPDATE 版本助手｜改名为发布助手｜职责改为核对发布清单','V045-UPDATE-DONE')
    await page.getByRole('treeitem', { name: /^发布助手/ }).and(page.locator('[data-row-key^="session:"]')).waitFor({ timeout: 8000 })
    await send('V041-WINDOWS 改名后核对独聊','V041-WINDOWS-DONE')
    await send('V045-UPDATE 发布助手｜改名为版本助手｜职责改为核对版本','V045-UPDATE-DONE')
    await button('Roundtable').click()
    const limit = page.getByRole('spinbutton', { name: '群聊子 Bot 数上限' })
    await limit.waitFor()
    await limit.fill('5')
    await button('保存人数上限').click()
    await page.getByText('群聊人数上限已保存。', { exact: true }).waitFor()
    await button('King Arthur').click()
    if (await limit.count()) throw new Error('Group setting is still displayed on the King card')
    await button('与 King Arthur 对话').click()
    await send('V041-CREATE-SECOND 用版本助手创建共享记忆二群','V041-SECOND-DONE')
    await button('Roundtable').click();await button('版本助手').click();await button('与 版本助手 对话').click()
    await button('清空页面').waitFor()
    if(await page.locator('.dsh-bots-group-scroll').count())throw new Error('Child private chat hides native timeline')
    const kingRow=page.getByRole('treeitem',{name:/^King Arthur/}).and(page.locator('[data-row-key^="session:"]')).first()
    for(const row of await kingRow.locator('xpath=ancestor::div[.//*[@data-row-key and starts-with(@data-row-key,"workspace:")]][1]').locator('[data-row-key^="session:"]').all()) {
      if(await row.isVisible() && (await row.boundingBox()).y < (await kingRow.boundingBox()).y)throw new Error('Blank child displaced King Arthur')
    }
    await button('新建会话').last().click()
    await page.getByText('King Arthur 工作区不允许手动新建会话。',{exact:false}).last().waitFor()
    await send('V041-CHAT-A 聊一下今天的天气 BOT-TEMP-846','V041-CHAT-DONE')
    await send('V041-READ 读取 native.txt','V041-READ-DONE')
    await send('V041-REMEMBER 请记住我希望使用蓝色图表 BOT-PRIVATE-741','V041-REMEMBER-DONE')
    await button('Roundtable').click();await button('版本助手').click();await button('与 版本助手 对话').click()
    await page.getByText('V041-CHAT-A 聊一下今天的天气 BOT-TEMP-846',{exact:true}).waitFor()
    await send('V041-CHAT-B 再聊聊','V041-CHAT-DONE')
    await button('清空页面').click();await button('确认清空页面').click()
    await page.getByText('V041-CHAT-A 聊一下今天的天气 BOT-TEMP-846',{exact:true}).waitFor({state:'hidden'}).catch(async error=>{throw new Error(error.message+' UI: '+await page.locator('.dsh-bots-king-actions').innerText())})
    await send('V041-CLEAR 检查独聊记忆','V041-CLEAR-DONE')
    await button('Roundtable').click();await button('King Arthur').click();await button('与 King Arthur 对话').click()
    await send('V041-ISOLATION 检查主 Bot 没有子 Bot 的私人记忆','V041-ISOLATION-DONE')
    await send('V041-WINDOWS 清空后核对独聊','V041-WINDOWS-DONE')
  }).toString())
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    for(const title of ['原生验收群','共享记忆二群']) {
      await button('搜索会话').click();await page.getByPlaceholder(/搜索会话名称/).fill(title)
      await page.getByRole('treeitem',{name:new RegExp(title)}).first().click()
      await editor.fill('@版本助手 V041-GROUP 请记录项目编号');await button('发送消息').click()
      const log=page.getByRole('log',{name:'群聊时间线'})
      await log.getByText('V041-GROUP-DONE 共享事实：项目编号 PROJECT-741。',{exact:false}).last().waitFor()
      await log.locator('.dsh-bots-reasoning summary').last().click()
      await log.getByText('V041-THINK 模型返回的思考片段。后续片段已保留。',{exact:false}).last().waitFor()
    }
    await button('Roundtable').click();await button('版本助手').click();await button('与 版本助手 对话').click()
    await editor.fill('V041-SHARED 读取所有群聊记忆');await button('发送消息').click()
    await page.getByText('V041-SHARED-DONE',{exact:false}).last().waitFor()
    await button('Roundtable').click();await button('King Arthur').click();await button('与 King Arthur 对话').click()
    await editor.fill('V041-SHARED 读取所有群聊记忆');await button('发送消息').click()
    await page.getByText('V041-SHARED-DONE',{exact:false}).last().waitFor()
  }).toString())
  await stopHost();browser('goto',await startHost())
  await mkdir(new URL('../output/playwright/',import.meta.url),{recursive:true})
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    await button('Roundtable').click();await button('版本助手').click();await button('与 版本助手 对话').click()
    await page.getByText('V041-CLEAR-DONE',{exact:false}).last().waitFor()
    const previous=await page.getByText('V041-CLEAR-DONE',{exact:false}).count()
    await editor.fill('V041-CLEAR 重启后核对独聊');await button('发送消息').click()
    await page.getByText('V041-CLEAR-DONE',{exact:false}).nth(previous).waitFor()
    const previousShared=await page.getByText('V041-SHARED-DONE',{exact:false}).count()
    await editor.fill('V041-SHARED 重启后检索');await button('发送消息').click()
    await page.getByText('V041-SHARED-DONE',{exact:false}).nth(previousShared).waitFor()
    await editor.fill('V041-WINDOWS 重启后核对置顶');await button('发送消息').click()
    await page.getByText('V041-WINDOWS-DONE',{exact:false}).last().waitFor()
    await button('搜索会话').click();await page.getByPlaceholder(/搜索会话名称/).fill('共享记忆二群')
    await page.getByRole('treeitem',{name:/共享记忆二群/}).first().click()
    await page.locator('.dsh-bots-reasoning summary').last().click()
    await page.getByText('V041-THINK 模型返回的思考片段。后续片段已保留。',{exact:false}).last().waitFor()
    const kingRow=page.getByRole('treeitem',{name:/^King Arthur/}).and(page.locator('[data-row-key^="session:"]')).first()
    for(const row of await kingRow.locator('xpath=ancestor::div[.//*[@data-row-key and starts-with(@data-row-key,"workspace:")]][1]').locator('[data-row-key^="session:"]').all()) {
      if(await row.isVisible() && (await row.boundingBox()).y < (await kingRow.boundingBox()).y)throw new Error('King Arthur must be visually first in the workspace')
    }
    await page.screenshot({path:SCREENSHOT,fullPage:true})
  }).toString().replace('SCREENSHOT',JSON.stringify(decodeURIComponent(new URL('../output/playwright/v0.4.1-group-reasoning.png',import.meta.url).pathname))))
  const calls=(await requests()).filter(call=>call.input.includes('V041-'))
  const a=calls.find(call=>call.input.startsWith('V041-CHAT-A')),b=calls.find(call=>call.input.startsWith('V041-CHAT-B'))
  assert.ok(a?.nativeBot && b?.nativeBot);assert.equal(a.sessionId,b.sessionId)
  const cleared=calls.find(call=>call.input==='V041-CLEAR 检查独聊记忆'),restart=calls.find(call=>call.input==='V041-CLEAR 重启后核对独聊')
  assert.notEqual(cleared.sessionId,a.sessionId);assert.equal(cleared.sessionId,restart.sessionId)
  assert.ok(a.tools.includes('read')&&a.tools.includes('write')&&a.tools.includes('web_search'))
  assert.ok(!a.tools.includes('create_bots'),'Child private chats do not inherit King management tools')
  const toolText=call=>call.toolResults?.flatMap(content=>content.filter(block=>block.type==='text').map(block=>block.text)).join('\n')
  const windows=calls.filter(call=>call.input.startsWith('V041-WINDOWS')&&call.toolResults?.length)
  assert.equal(windows.length,4)
  assert.equal(JSON.parse(toolText(windows[0]))[0].sessionId,JSON.parse(toolText(windows[1]))[0].sessionId)
  for(const call of windows){const sessions=JSON.parse(toolText(call));assert.equal(sessions.length,1);assert.ok(sessions.every(item=>item.kingFirst));assert.equal(new Set(sessions.map(item=>item.botId)).size,1)}
  for(const native of ['nativeKing','nativeBot']) {
    const shared=calls.find(call=>call[native]&&call.input.startsWith('V041-SHARED')&&call.toolResults?.length)
    const data=JSON.parse(toolText(shared))
    assert.equal(new Set(data.flatMap(item=>item.messages.filter(row=>row.text.includes('V041-GROUP-DONE')).map(row=>row.groupId))).size,2)
  }
  console.log('Verified automatic unique Bot windows, native tools, isolated personal memory, clear-page/restart persistence, cross-group shared recall for King and child, and persisted model reasoning.')
}

async function exerciseGroupDownloads(workspace, uploadedPath) {
  const bytes=Buffer.from([0,255,128,10,42,0,13])
  await writeFile(join(workspace,'交付 报告.bin'),bytes)
  const downloads=join(dir,'downloads')
  await mkdir(downloads,{recursive:true})
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    await editor.fill('@版本助手 V042-FILES 请提供文件下载 @"'+UPLOAD+'"')
    await button('发送消息').click()
    const log=page.getByRole('log',{name:'群聊时间线'})
    await log.getByText('V042-FILES-DONE',{exact:false}).last().waitFor()
    for(const [index,label] of ['相对文件','绝对文件','file链接','sandbox链接','outside workspace.md'].entries()) {
      const downloading=page.waitForEvent('download')
      await log.getByRole('button',{name:label+'（下载）',exact:true}).last().click()
      const download=await downloading
      if(download.suggestedFilename()!==(index===4?'outside workspace.md':'交付 报告.bin'))throw new Error('Download filename changed: '+download.suggestedFilename())
      await download.saveAs(DOWNLOADS+'/'+index+'.bin')
    }
    await log.getByRole('button',{name:'缺失文件（下载）',exact:true}).click()
    await log.getByRole('alert').filter({hasText:'下载失败'}).waitFor()
    if(await log.locator('a[href^="javascript:"]').count())throw new Error('Unsafe link enabled')
    if(await log.getByRole('link',{name:'网页',exact:true}).getAttribute('href')!=='https://example.com/report')throw new Error('Web link was changed')
  }).toString().replace('UPLOAD',JSON.stringify(uploadedPath)).replace('DOWNLOADS',JSON.stringify(downloads)))
  for(let i=0;i<4;i++)assert.deepEqual(await readFile(join(downloads,i+'.bin')),bytes)
  const uploaded=await readFile(uploadedPath)
  assert.deepEqual(await readFile(join(downloads,'4.bin')),uploaded)
  await rm(uploadedPath)
  await stopHost();browser('goto',await startHost())
  const count=(await requests()).length
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    await button('搜索会话').click();await page.getByPlaceholder(/搜索会话名称/).fill('共享记忆二群')
    await page.getByRole('treeitem',{name:/共享记忆二群/}).first().click()
    const log=page.getByRole('log',{name:'群聊时间线'})
    for(const [index,label] of ['相对文件','outside workspace.md'].entries()) {
      const downloading=page.waitForEvent('download')
      await log.getByRole('button',{name:label+'（下载）',exact:true}).last().click()
      await (await downloading).saveAs(DOWNLOADS+'/restart-'+index+'.bin')
    }
  }).toString().replace('DOWNLOADS',JSON.stringify(downloads)))
  assert.deepEqual(await readFile(join(downloads,'restart-0.bin')),bytes)
  assert.deepEqual(await readFile(join(downloads,'restart-1.bin')),uploaded)
  assert.equal((await requests()).length,count,'Downloading must not invoke a model')
  console.log('Verified group file downloads: relative/absolute/file/sandbox links, original binary bytes and Chinese filenames, uploaded copies after original deletion and restart, missing-file feedback and safe web links.')
}

async function exerciseHistoryPages() {
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    await button('Roundtable').click();await button('King Arthur').click();await button('与 King Arthur 对话').click()
    await editor.fill('V043-SEED 增加隔离测试历史');await button('发送消息').click()
    await page.getByText('V043-SEEDED',{exact:false}).last().waitFor()
    await button('搜索会话').click();await page.getByPlaceholder(/搜索会话名称/).fill('共享记忆二群')
    await page.getByRole('treeitem',{name:/共享记忆二群/}).first().click()
    const log=page.getByRole('log',{name:'群聊时间线'})
    await log.getByText('V043-HISTORY-159 原始历史记录',{exact:true}).waitFor()
    if(await log.locator('[data-row-id]').count()>80)throw new Error('Live history exceeds page limit')
    await page.getByText(/V043 旧议题.*已收到 1 条发言/).waitFor()
    await page.getByText('查看议题摘要',{exact:true}).click()
    await page.getByText('V043-OLD-SUMMARY 历史汇总',{exact:true}).waitFor()
    await button('原汇总').click()
    await log.getByText('V043-OLD-SUMMARY 历史汇总',{exact:true}).waitFor()
    await button('返回最新').click()
    await log.getByText('V043-HISTORY-159 原始历史记录',{exact:true}).waitFor()
    await button('更早记录').click()
    await log.getByText('V043-HISTORY-0 原始历史记录',{exact:true}).waitFor()
    if(await log.locator('[data-row-id]').count()>80)throw new Error('History pages accumulated')
    await button('更早记录').click()
    await log.getByText('V042-FILES-DONE',{exact:false}).last().waitFor()
    const downloading=page.waitForEvent('download')
    await log.getByRole('button',{name:'outside workspace.md（下载）',exact:true}).last().click()
    if((await downloading).suggestedFilename()!=='outside workspace.md')throw new Error('Historical attachment unavailable')
    await button('返回最新').click()
    await log.getByText('V043-HISTORY-159 原始历史记录',{exact:true}).waitFor()
  }).toString())
  await stopHost();browser('goto',await startHost())
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    await button('Roundtable').click();await button('King Arthur').click();await button('与 King Arthur 对话').click()
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    await editor.fill('V043-RECALL 检索旧历史');await button('发送消息').click()
    await page.getByText('V043-RECALLED',{exact:false}).last().waitFor()
    await page.getByText(/V043-RECALLED.*V043-HISTORY-0/).last().waitFor()
    await page.getByRole('treeitem',{name:/^King Arthur/}).first().waitFor()
    if(await page.getByRole('treeitem',{name:/^KingBot/}).count())throw new Error('Old main title was not migrated')
  }).toString())
  console.log('Verified bounded live/history pages, historical attachment download and inactive group recall after restart.')
}

async function exerciseResetWithUnreadableHistory() {
  await stopHost()
  const entries=await readdir(join(dir,'sessions'),{recursive:true})
  let brokenPath,original
  for(const entry of entries.filter(name=>name.endsWith('session.v4.jsonl.zstd'))) {
    const path=join(dir,'sessions',entry),bytes=await readFile(path)
    const text=zstdDecompressSync(bytes).toString('utf8')
    if(!text.includes('v043-history-159'))continue
    const end=text.indexOf('\n'),header=JSON.parse(text.slice(0,end))
    assert.equal(header.isSeeded,false)
    header.isSeeded=true
    brokenPath=path;original=bytes
    await writeFile(path,zstdCompressSync(JSON.stringify(header)+text.slice(end)))
    break
  }
  assert.ok(brokenPath,'Missing isolated old group fixture')
  browser('goto',await startHost())
  browser('run-code',(async page=>{
    const button=name=>page.getByRole('button',{name,exact:true})
    await button('Roundtable').click()
    await button('重置 Bots 数据').click()
    for(const name of ['重置Bots 成员','重置主 Bot 记忆','重置旧会话关联'])await page.getByRole('checkbox',{name,exact:true}).check()
    await page.getByRole('textbox',{name:'重置确认文字'}).fill('RESET')
    await button('确认重置所选数据').click()
    await page.getByText('所选数据已重置，请重新选择工作区。',{exact:true}).waitFor()
    await button('King Arthur').click()
    await page.getByRole('textbox',{name:'King Arthur 工作区目录'}).fill(WORKSPACE)
    await button('启用工作区').click()
    await button('与 King Arthur 对话').click()
    const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
    await editor.fill('V040-CHAT 全部重置后正常对话');await button('发送消息').click()
    await page.getByText('V040-ANSWER 自然语言回答',{exact:false}).last().waitFor()
    await editor.fill('V043-RESET-RECALL 全部重置后检查共享记忆');await button('发送消息').click()
    await page.getByText('V043-RESET-RECALLED',{exact:false}).last().waitFor()
  }).toString().replace('WORKSPACE',JSON.stringify(docs)))
  const recall=(await requests()).findLast(call=>call.nativeKing&&call.input==='V043-RESET-RECALL 全部重置后检查共享记忆'&&call.toolResults?.length)
  assert.ok(recall)
  const returned=recall.toolResults.flatMap(content=>content.filter(block=>block.type==='text').map(block=>block.text)).join('')
  assert.deepEqual(JSON.parse(returned),[],'Reset must not import old-epoch group memories')
  await stopHost()
  await writeFile(brokenPath,original)
  console.log('Verified full reset and normal main-Agent replies with an unreadable inherited log; old-epoch memories remain excluded.')
}

async function exerciseExistingGroups() {
  await stopHost()
  browser('goto', await startHost())
  const notice = '明天下午两点开会，请带 **材料**。P037-NOTICE'
  const before = (await requests()).length
  browser('run-code', (async page => {
    const button = name => page.getByRole('button', { name, exact: true })
    const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
    const log = page.getByRole('log', { name: '群聊时间线' })
    async function king() {
      await button('Roundtable').click()
      await button('King Arthur').click()
      await button('与 King Arthur 对话').click()
      await page.getByRole('region', { name: 'King Arthur 专属对话' }).waitFor()
    }
    async function send(text) {
      await editor.fill(text)
      await button('发送消息').click()
    }
    await king()
    const target = '@架构师 给出架构说明'
    await send(`你进『${target}』群了吗，帮我发一条`)
    await log.getByText(/由 King Arthur 主持.*就发/s).waitFor()
    await send(`就发『NOTICE_TEXT』`)
    const receipt = log.getByRole('status').filter({ hasText: /已以 King Arthur 身份发送到/ })
    await receipt.waitFor()
    await receipt.getByRole('button', { name: '打开群聊' }).click()
    const posted = log.locator('article[data-author=bot]').filter({ hasText: 'NOTICE_TEXT' })
    await posted.waitFor()
    if (await posted.count() !== 1 || !await posted.getByText('@King Arthur', { exact: true }).count()) throw new Error('Notice did not preserve text and author')
    await king()
    await send(`看一下『${target}』聊到哪了`)
    await log.locator('article[data-author=bot]').last().getByText(/当前议题|已有结论|阶段结果/).waitFor()
    await send('在『绝对不存在的验收群』发一句『不能发错』')
    await log.getByText(/找不到可用的群聊「绝对不存在的验收群」/).waitFor()
    const results = log.locator('article[data-author=bot]').filter({ hasText: /群聊结论.*讨论汇总完成/s })
    const previous = await results.count()
    await send(`让『${target}』讨论 P037-EXISTING-TASK，办完告诉我`)
    await log.getByRole('status').filter({ hasText: /已交办给|已排队交办给/ }).waitFor()
    await results.nth(previous).waitFor()
  }).toString().replaceAll('NOTICE_TEXT', notice))
  const calls = (await requests()).slice(before)
  assert.ok(calls.every(call => !call.input.includes('P037-NOTICE') || call.input.includes('P037-EXISTING-TASK')))
  assert.ok(calls.some(call => call.moderator && call.input.includes('P037-EXISTING-TASK')))
  console.log('Verified cold group lookup, saved progress, literal notice without dispatch, and task return.')
}

function assertCompleteTimeline(calls, topic) {
  const rounds = calls.filter(call => call.moderator || call.discussion || call.summarizing)
    .map(call => ({ call, payload: JSON.parse(call.input) }))
    .map(({ call, payload }) => ({ call, payload, state: JSON.parse(payload.最新用户消息) }))
    .filter(({ state }) => {
      const subject = state.议题.replace(/^(?:@[\p{L}\p{N}_-]+[\s，,:：]+)+/u, '')
      return subject === topic || subject.startsWith(topic + '，')
    })
  const checked = entry => {
    assert.ok(entry?.state.已有讨论.some(reply => reply.name === '审阅员' && reply.status === 'done'))
    const source = [...entry.payload.群工作记忆?.recent ?? [], ...entry.payload.群工作记忆?.recalled ?? []]
      .find(row => /20:10 交接确认 P036-TIMELINE-END$/u.test(row.text))
    assert.ok(source?.id, 'Long replies retain exact originals and message IDs in working context')
    assert.equal(source.text.slice(1796, 1801), '20:10')
  }
  checked(rounds.find(({ call, state }) => call.moderator && state.已有讨论.length))
  checked(rounds.find(({ call, state }) => call.discussion && state.已有讨论.length))
  checked(rounds.findLast(({ call }) => call.summarizing))
}

async function exerciseLongReplies() {
  browser('run-code', (async page => {
    const button = name => page.getByRole('button', { name, exact: true })
    await button('搜索会话').click()
    await page.getByPlaceholder(/搜索会话名称/).fill('给出架构说明')
    await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
    const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
    const log = page.getByRole('log', { name: '群聊时间线' })
    for (const topic of ['验收长时间轴', '验收长时间轴汇总失败']) {
      const previous = await log.getByText('20:10 交接确认 P036-TIMELINE-END', { exact: true }).count()
      await editor.fill(topic)
      await button('发送消息').click()
      await log.getByText('20:10 交接确认 P036-TIMELINE-END', { exact: true }).nth(previous).waitFor()
      await button('停止生成').waitFor({ state: 'hidden' })
    }
    await log.getByText(/King Arthur 未能生成汇总/).waitFor()
    await log.getByText(/尚未收到 @?架构师 的有效回复/).waitFor()
    if (await log.getByText('20:10 交接确认 P036-TIMELINE-END', { exact: true }).count() < 3) {
      throw new Error('The summary fallback must retain the end of the original reply')
    }
  }).toString())
  const calls = await requests()
  assertCompleteTimeline(calls, '验收长时间轴')
  assertCompleteTimeline(calls, '验收长时间轴汇总失败')
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

async function exerciseTaskRecovery(defaultWorkspace) {
  browser('run-code', (async page => {
    const button = name => page.getByRole('button', { name, exact: true })
    await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
    await button('King Arthur').click()
    await button('与 King Arthur 对话').click()
    const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
    await editor.fill('请为验收恢复任务建群，邀请 @架构师 和 @审阅员，讨论两份依据并回传结论')
    await editor.press('Enter')
    await button('确认建群').click()
    await page.getByRole('status').filter({ hasText: '恢复验收群' }).getByRole('button', { name: '打开群聊' }).click()
    await page.getByRole('log').getByText(/^@?审阅员 \| 初步观点$/u).waitFor()
  }).toString())
  const written = join(defaultWorkspace, 'p1-pending-write.txt')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !await stat(written).catch(() => undefined)) await delay(100)
  assert.equal(await readFile(written, 'utf8'), 'P1-CHECKPOINT-459')
  const callsBeforeRestart = (await requests()).length
  await stopHost('SIGKILL')

  browser('goto', await startHost())
  browser('run-code', (async page => {
    const button = name => page.getByRole('button', { name, exact: true })
    await button('搜索会话').click()
    await page.getByPlaceholder(/搜索会话名称/).fill('恢复验收群')
    await page.getByRole('treeitem', { name: /恢复验收群/ }).click()
    const task = page.getByRole('complementary', { name: '议题与进度' })
    await task.getByText(/已收到 1 条发言.*待核对/).waitFor()
    if (!await button('继续讨论').isEnabled()) throw new Error('Pending operations must still allow discussion')
    await button('汇总已有结果').evaluate(button => { button.click(); button.click() })
    await page.getByRole('log').getByText(/尚未收到 @?架构师/).waitFor()
    await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
    await button('King Arthur').click()
    await button('与 King Arthur 对话').click()
    const log = page.getByRole('log')
    const phase = log.locator('article').filter({ hasText: /群聊阶段结果/ })
    await phase.waitFor()
    if (await phase.count() !== 1) throw new Error('Duplicate summary')
    await phase.getByRole('button', { name: '打开群聊' }).click()
    const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
    await editor.fill('已核对，继续')
    await editor.press('Enter')
    await log.getByText(/^@?King Arthur \| 讨论汇总完成$/u).waitFor()
  }).toString())
  await stopHost()

  const sessionRoot = join(dir, 'sessions')
  const files = (await readdir(sessionRoot, { recursive: true })).filter(path => /session\.v\d+\.jsonl(?:\.zstd)?$/.test(path))
  const streams = await Promise.all(files.map(async file => {
    const path = join(sessionRoot, file)
    const bytes = await readFile(path)
    const records = (file.endsWith('.zstd') ? zstdDecompressSync(bytes) : bytes).toString().trim().split('\n').map(JSON.parse)
    return { path, records }
  }))
  const target = streams.find(item => item.records.some(event => event.type === 'session/title' && event.data?.title === '群聊 · 恢复验收群'))
  const king = streams.find(item => item.records.some(event => event.type === 'plugin:dsh-bots/king'))
  assert.ok(target && king)
  const targetId = target.records[0].id
  assert.ok(target.records.flatMap(event => event.type === 'plugin:dsh-bots/rows' ? event.data : []).some(row => row.resultKind === 'final'))
  const returned = king.records.flatMap(event => event.type === 'plugin:dsh-bots/rows' ? event.data : [])
    .filter(row => row.sessionId === targetId && row.author === 'bot' && row.text.startsWith('群聊结论'))
  assert.equal(returned.length, 1)
  const id = returned[0].id
  // Reproduce a durable group result with the origin delivery missing.
  for (const event of king.records) if (event.type === 'plugin:dsh-bots/rows') event.data = event.data.filter(row => row.id !== id)
  const [header, ...events] = king.records.map(record => JSON.stringify(record) + '\n')
  const encodeFrame = line => zstdCompressSync(Buffer.from(line), {
    params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 },
  })
  // Harness reads the session header as an independent Zstandard frame.
  const payload = king.path.endsWith('.zstd')
    ? Buffer.concat([encodeFrame(header), encodeFrame(events.join(''))])
    : header + events.join('')
  await writeFile(king.path, payload)
  await rm(join(dir, 'cache'), { recursive: true, force: true })

  for (let restart = 0; restart < 2; restart++) {
    browser('goto', await startHost())
    browser('run-code', (async page => {
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      const recovered = page.locator('[data-row-id="' + RECOVERED_ID + '"]')
      await recovered.waitFor()
      if (await recovered.count() !== 1) throw new Error('Duplicate final delivery')
    }).toString().replace('RECOVERED_ID', JSON.stringify(id)))
    await stopHost()
  }
  const calls = await requests()
  assert.equal(calls.filter(call => call.calledTool === 'write' && call.input.includes('验收恢复任务')).length, 1)
  assertCompleteTimeline(calls, '验收恢复任务')
  assertCompleteTimeline(calls.slice(callsBeforeRestart), '验收恢复任务')
  console.log('Verified complete 20:10 entry and tail in member and moderator inputs before and after restart.')
  console.log('Verified interrupted task, one partial delivery, verified resume, and idempotent final delivery after restart.')
}

try {
  const runtime = run('dsh', ['--version']).trim()
  assert.ok(semver.satisfies(runtime, engines.dsh), `Unsupported DSH smoke runtime: ${runtime}`)
  await mkdir(docs)
  const documentPath = join(dir, 'outside workspace.md')
  await writeFile(documentPath, '# Uploaded source\n\nDOCUMENT-CANARY-617\n')
  const docxPath = join(dir, 'outside-workspace.docx')
  const require = createRequire(import.meta.url)
  const JSZip = createRequire(require.resolve('mammoth/package.json'))('jszip')
  const docx = new JSZip()
  docx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  docx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCUMENT-CANARY-617</w:t></w:r></w:p></w:body></w:document>')
  await writeFile(docxPath, await docx.generateAsync({ type: 'nodebuffer' }))
  const pdfPath = join(dir, 'text layer.pdf')
  const content = 'BT /F1 12 Tf 20 50 Td (PDF-CANARY-903) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await writeFile(pdfPath, pdf)
  const defaultWorkspace = join(docs, 'deepseek-harness', 'default-workspace')
  const skill = join(defaultWorkspace, '.agents', 'skills', 'bots-smoke')
  await mkdir(join(skill, 'references'), { recursive: true })
  await writeFile(join(defaultWorkspace, 'AGENTS.md'), 'WORKSPACE-INSTRUCTIONS-756\n')
  await writeFile(join(skill, 'SKILL.md'), '---\nname: bots-smoke\ndescription: Test skill for plugin verification\n---\nRead references/guide.md before replying.\n')
  await writeFile(join(skill, 'references', 'guide.md'), 'SKILL-REFERENCE-284\n')
  const archive = run('npm', ['pack', '--silent', '--pack-destination', dir]).trim()
  run('dsh', ['--profile', 'web', '--dump-config'])
  run('dsh', ['plugin', '--profile', 'web', 'add', upgradeFrom ? resolve(upgradeFrom) : join(dir, archive)])
  await writeFile(patch, `- id: agent-default-model
  config:
    provider: bots-fixture
    model: fixture
- id: web
  config:
    searchProvider: bots-fixture-search
    fetchProvider: http
- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(docs)}
- insert:
    - id: bots-fixture-model
      name: ${JSON.stringify(decodeURIComponent(new URL('scripts/fixture-model.mjs', root).pathname))}
`)

  browser('open', await startHost(), '--browser=chrome')
  if (process.env.DSH_BOTS_NATIVE_SMOKE === '1') {
    await writeFile(join(docs, 'native.txt'), 'V040-FILE-CONTENT')
    browser('run-code', (async page => {
      const button = name => page.getByRole('button', { name, exact: true })
      const preview = page.getByRole('button', { name: /^(继续|Continue)$/ })
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).waitFor()
      if (await preview.isVisible()) await preview.click()
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await button('King Arthur').click()
      await page.getByRole('textbox', { name: 'King Arthur 工作区目录' }).fill(WORKSPACE)
      await button('启用工作区').click()
      await button('与 King Arthur 对话').click()
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
      async function send(text, expected) {
        await editor.fill(text)
        await button('发送消息').click()
        await page.getByText(expected, { exact: false }).last().waitFor({ timeout: 20000 })
      }
      await send('V040-CHAT 解释一下天空为什么是蓝色的', 'V040-ANSWER 自然语言回答')
      if (await page.locator('.dsh-bots-group-scroll').count()) throw new Error('King hides the native conversation')
      await send('V040-READ 读取 native.txt', 'V040-FILE-CONTENT')
      await send('V040-SEARCH 搜索资料', 'V040-SEARCH-DONE')
      await send('V040-CREATE-BOT 帮我创建一个版本助手', 'V040-BOT-DONE')
      await send('V040-CREATE-GROUP 用版本助手创建一个群聊', 'V040-GROUP-DONE')
      await send('V040-SEND 向原生验收群发送 V040-NOTICE', 'V040-SEND-DONE')
      await send('V040-HISTORY 查找刚才的群聊回执', 'V040-HISTORY-DONE')
      await send('V040-MEMORY 请记住我希望先看结论', 'V040-MEMORY-DONE')
    }).toString().replace('WORKSPACE', JSON.stringify(docs)))
    const calls = (await requests()).filter(call => call.nativeKing && call.input.includes('V040-'))
    assert.ok(calls.length >= 10)
    assert.equal(new Set(calls.map(call => call.sessionId)).size, 1, 'Native turns must use the same root session')
    for (const tool of ['read', 'read_group_history', 'web_search', 'create_bots', 'create_group', 'operate_existing_group', 'update_personal_memory']) assert.ok(calls.some(call => call.calledTool === tool), tool)
    await stopHost()
    browser('goto', await startHost())
    browser('run-code', (async page => {
      const button = name => page.getByRole('button', { name, exact: true })
      await button('Roundtable').click()
      await button('King Arthur').click()
      await button('与 King Arthur 对话').click()
      await page.getByText('V040-ANSWER 自然语言回答', { exact: false }).last().waitFor()
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
      await editor.fill('V040-RECALL 还记得我的偏好吗')
      await button('发送消息').click()
      await page.getByText('V040-RECALL-DONE', { exact: false }).last().waitFor()
    }).toString())
    browser('run-code', (async page => {
      const button = name => page.getByRole('button', { name, exact: true })
      const kingEditor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
      await kingEditor.fill('V040-SEED-RECOVERY')
      await button('发送消息').click()
      await page.getByText('V040-SEEDED-DONE', { exact: false }).last().waitFor()
      await button('搜索会话').click()
      await page.getByPlaceholder(/搜索会话名称/).fill('原生验收群')
      await page.getByRole('treeitem', { name: /原生验收群/ }).click()
      const log = page.getByRole('log', { name: '群聊时间线' })
      await log.waitFor()
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
      async function send(text, expected) {
        await editor.fill(text)
        await button('发送消息').click()
        await log.getByText(expected, { exact: false }).last().waitFor({ timeout: 20000 })
      }
      await log.getByText('V040-SEEDED', { exact: true }).waitFor()
      const beforeGreeting = await log.locator('article[data-author=bot]').count()
      await send('你好', '有什么可以帮你？')
      await send('@King Arthur 谢谢', '不客气，有需要随时告诉我。')
      await send('@KingBot 在吗', '我在，请说。')
      if (await log.locator('article[data-author=bot]').count() !== beforeGreeting + 3) throw new Error('Small talk dispatched group members')

      for (const text of ['可以，就按照你说的做', '我的意思是按照你说的这个做，先把「1. 进展」成文，作为立项书开篇。现在就出这一段初稿', '已核对，继续', '@King Arthur 整合当前调研专家的所有结果，继续组织大家按照开始时的议题讨论。']) {
        await send(text, 'V040-RECOVERED ' + text)
      }
      await send('V040-INTENT-RETRY 重新看一下这些材料', 'V040-RECOVERED V040-INTENT-RETRY 重新看一下这些材料')
      await send('V040-INTENT-FAIL 重新看一下这些材料', '已保留你的消息和当前进度。请说明这条消息是补充当前议题，还是另开新任务。')
      await send('@King Arthur 继续组织大家基于现有结果按照开始时的议题讨论。', 'V040-RECOVERED @King Arthur 继续组织大家基于现有结果按照开始时的议题讨论。')
      if (await log.getByText(/你想处理哪个议题|你是想调整当前议题/).count()) throw new Error('Unexpected clarification loop')
    }).toString())
    const recovery = (await requests()).filter(call => call.moderator && call.input.includes('V040-RECOVERY'))
    assert.ok(recovery.length >= 5)
    const first = JSON.parse(JSON.parse(recovery[0].input).最新用户消息)
    assert.equal(first.最新用户消息, '可以，就按照你说的做')
    assert.ok(first.上次主持答复.includes('立项书开篇'))
    assert.ok(recovery.some(call => call.input.includes('现在就出这一段初稿')))
    await assert.rejects(stat(join(defaultWorkspace, 'v040-blocked.txt')), { code: 'ENOENT' })
    assert.equal(await readFile(join(defaultWorkspace, 'v040-verified.txt'), 'utf8'), 'verified')
    console.log('Verified screenshot recovery with three tasks, pending read/write operations, confirmation, corrected drafting request and classifier failure.')
    browser('run-code', (async page => {
      const button = name => page.getByRole('button', {name,exact:true})
      await button('Roundtable').click()
      await button('King Arthur').click()
      await button('与 King Arthur 对话').click()
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i }).and(page.locator('[contenteditable="true"]'))
      await editor.fill('V040-PAGE-CANARY 临时暗号 TEMP-PAGE-902')
      await button('发送消息').click()
      await page.getByText('V040-PAGE-READY', {exact:false}).waitFor()
      await page.getByRole('button',{name:/停止生成|Stop generating/i}).waitFor({state:'hidden'})
      await button('清空页面').click()
      await button('确认清空页面').click()
      await page.getByText('V040-PAGE-CANARY 临时暗号 TEMP-PAGE-902',{exact:true}).waitFor({state:'hidden',timeout:10000}).catch(async error=>{throw new Error(error.message+' UI: '+await page.locator('.dsh-bots-king-actions').innerText())})
      await editor.fill('V040-CHECK-CLEAR 清空后核对')
      await button('发送消息').click()
      await page.getByText('V040-CLEAR-DONE',{exact:false}).waitFor()
    }).toString())
    browser('run-code', (async page => {
      const button = name => page.getByRole('button',{name,exact:true})
      await button('Roundtable').click()
      await button('King Arthur').click()
      await button('管理工作区记忆').click()
      await page.getByText(/已保存 1 条有效记忆/).waitFor()
      await button('返回 Roundtable').click()
      await button('重置 Bots 数据').click()
      await page.getByRole('checkbox',{name:'重置主 Bot 记忆',exact:true}).check()
      await page.getByRole('textbox',{name:'重置确认文字'}).fill('RESET')
      await button('确认重置所选数据').click()
      await button('清空页面').waitFor()
      await page.getByText('V040-CLEAR-DONE',{exact:false}).waitFor({state:'hidden'})
      await button('Roundtable').click()
      await button('King Arthur').click()
      await button('管理工作区记忆').click()
      await page.getByText(/已保存 0 条有效记忆/).waitFor()
      await button('与 King Arthur 对话').click()
      if (await page.getByText('V040-CLEAR-DONE',{exact:false}).count()) throw new Error('Memory reset retained old native conversation')
      const editor = page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
      await editor.fill('V040-CHECK-RESET 重置后核对')
      await button('发送消息').click()
      await page.getByText('V040-RESET-DONE',{exact:false}).waitFor()
    }).toString())
    await stopHost()
    browser('goto',await startHost())
    browser('run-code',(async page=>{
      const button=name=>page.getByRole('button',{name,exact:true})
      await button('Roundtable').click();await button('King Arthur').click();await button('与 King Arthur 对话').click()
      const editor=page.getByRole('textbox',{name:/调用指令|commands/i}).and(page.locator('[contenteditable="true"]'))
      await editor.fill('V040-CHECK-RESET 重启后核对');await button('发送消息').click()
      await page.getByText('V040-RESET-DONE',{exact:false}).last().waitFor()
    }).toString())
    const updated = await requests()
    assert.equal(updated.filter(call=>call.input==='你好'||call.input==='@King Arthur 谢谢').length,0)
    const clear = updated.find(call=>call.input==='V040-CHECK-CLEAR 清空后核对')
    const reset = updated.find(call=>call.input==='V040-CHECK-RESET 重置后核对')
    const restart = updated.find(call=>call.input==='V040-CHECK-RESET 重启后核对')
    assert.ok(clear && reset && restart)
    assert.notEqual(clear.sessionId,calls[0].sessionId)
    assert.notEqual(reset.sessionId,clear.sessionId)
    assert.equal(reset.sessionId,restart.sessionId)
    console.log('Verified clear-page context isolation with memory retained, memory reset with a fresh conversation, restart persistence and group small talk without delegation.')
    console.log('Verified native King conversation, root session continuity, native file tool, Bot creation, group creation, message delivery and restart memory.')
    await exerciseNativeBots()
    await exerciseGroupDownloads(defaultWorkspace, documentPath)
    await exerciseHistoryPages()
    await exerciseResetWithUnreadableHistory()
  } else {
  browser('run-code', (async page => {
    const upgrading = process.env.DSH_BOTS_SMOKE_UPGRADE
    const legacy = process.env.DSH_BOTS_SMOKE_LEGACY
    const oldRouting = process.env.DSH_BOTS_SMOKE_OLD_ROUTING
    const preview = page.getByRole('button', { name: /^(继续|Continue)$/ })
    await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).waitFor()
    if (await preview.isVisible()) await preview.click()
    await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
    await page.getByText('尚未创建子 Bot。点击“新建 Bot”定义名称和职责，再创建群聊。', { exact: true }).waitFor()
    const kingEntry = page.getByRole('button', { name: 'King Arthur', exact: true })
    await kingEntry.or(page.getByRole('textbox', { name: /^(King Arthur|Bots King) 工作区目录$/ })).first().waitFor()
    if (await kingEntry.isVisible()) await kingEntry.click()
    await page.getByRole('textbox', { name: /^(King Arthur|Bots King) 工作区目录$/ }).fill(process.env.DSH_BOTS_SMOKE_WORKSPACE)
    await page.getByRole('button', { name: '启用工作区', exact: true }).click()
    await page.getByRole('button', { name: /^与 (King Arthur|Bots King) 对话$/ }).waitFor()
    const back = page.getByRole('button', { name: '返回 Roundtable', exact: true })
    if (await back.isVisible()) await back.click()
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
    if (process.env.DSH_BOTS_SMOKE_OLD_MENTIONS) {
      await page.getByRole('button', { name: /@架构师/ }).click()
      await editor.getByText('@架构师').waitFor()
    } else {
      await editor.and(page.locator('[contenteditable="true"]')).pressSequentially('@')
      const menu = page.getByRole('listbox').filter({ hasText: '群聊成员' })
      await menu.getByRole('option', { name: '架构师', exact: true }).click()
      await editor.getByText('@架构师').waitFor()
      if (await page.locator('.dsh-bots-members').count()) throw new Error('The roster must not appear above the composer')
    }
    await editor.and(page.locator('[contenteditable="true"]')).fill('@架构师 给出架构说明')
    await editor.press('Enter')
    const log = page.getByRole('log', { name: '群聊时间线' })
    const summary = log.getByText(legacy ? /^@?King Arthur \| 汇总完成$/u : /^@?King Arthur \| 讨论汇总完成$/u, { exact: true })
    await log.getByText(!oldRouting ? /^@?架构师 \| 直接回复$/u : legacy ? /^@?架构师 \| 看到了架构说明$/u : /^@?架构师 \| 初步观点$/u, { exact: true }).waitFor()
    if (oldRouting) await summary.waitFor()
    if (await log.locator('article[data-author=bot]').count() !== (oldRouting ? 3 : 1)) throw new Error('The initial turn must match the installed version')

    await editor.and(page.locator('[contenteditable="true"]')).fill('@审阅员 请点评上一条')
    await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
    await log.getByText(!oldRouting ? /^@?审阅员 \| 直接回复$/u : legacy ? /^@?审阅员 \| 看到了架构说明$/u : /^@?审阅员 \| 初步观点$/u, { exact: true }).waitFor()
    if (oldRouting) await summary.nth(1).waitFor()
    if (await log.locator('article[data-author=bot]').count() !== (oldRouting ? 6 : 2)) throw new Error('The follow-up must match the installed version')
    if (upgrading) return

    await editor.and(page.locator('[contenteditable="true"]')).fill('@架构师 @审阅员 讨论架构建议')
    await editor.press('Enter')
    await log.getByText(/^@?架构师 \| 回应 @?审阅员$/u).waitFor()
    await log.getByText(/^@?审阅员 \| 回应 @?架构师$/u).waitFor()
    await summary.waitFor()
    await page.getByRole('button', { name: /停止生成|Stop generating/i }).waitFor({ state: 'hidden' })
    if (await log.getByText('· 讨论', { exact: true }).count()) throw new Error('Discussion must not add a badge')
  }).toString().replace('process.env.DSH_BOTS_SMOKE_WORKSPACE', JSON.stringify(docs)).replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom))
    .replace('process.env.DSH_BOTS_SMOKE_LEGACY', String(legacyRouting)).replace('process.env.DSH_BOTS_SMOKE_OLD_ROUTING', String(oldRoutesThroughKing))
    .replace('process.env.DSH_BOTS_SMOKE_OLD_MENTIONS', String(oldMentions)))

  const beforeRestart = (await requests()).filter(item => !item.intentCheck)
  const normalRoles = oldRoutesThroughKing ? ['King Arthur', '架构师', 'King Arthur', 'King Arthur', '审阅员', 'King Arthur'] : ['架构师', '审阅员']
  const discussionRoles = upgradeFrom ? [] : ['King Arthur', '审阅员', 'King Arthur', '架构师', 'King Arthur', '审阅员', 'King Arthur', 'King Arthur']
  assert.deepEqual(beforeRestart.map(item => item.role), [...normalRoles, ...discussionRoles])
  assert.ok(beforeRestart.filter(item => item.moderator).every(item => item.tools.every(name => name === 'read_group_history')))
  assert.match(beforeRestart[oldRoutesThroughKing ? 4 : 1].input, legacyRouting ? /架构师 \| 看到了架构说明/u : oldRoutesThroughKing ? /架构师 \| 初步观点/u : /架构师 \| 直接回复/u)
  if (!upgradeFrom) assert.ok(beforeRestart.filter(item => item.addressed || item.discussion).every(item =>
    ['read', 'read_image', 'write', 'edit', 'glob', 'grep', 'web_search', 'web_fetch'].every(tool => item.tools.includes(tool))))
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
    if (oldRoutesThroughKing) assert.equal(beforeRestart[0].speaker, previous.king.title)
    assert.match(previous.king.title, /^(Bots King|King Arthur)$/)
    run('dsh', ['plugin', '--profile', 'web', 'add', join(dir, archive)])
    if (oldPackage.name !== packageName) {
      run('dsh', ['plugin', '--profile', 'web', 'remove', oldPackage.name])
      const profilePatch = join(dir, 'profiles', 'web', 'cordis.patch.yml')
      const saved = await readFile(profilePatch, 'utf8')
      await writeFile(profilePatch, saved.replace(/(^- id: dsh-bots\n  name: )dsh-bots$/mu, '$1' + packageName))
    }
  }

  browser('goto', await startHost())
  browser('run-code', (async page => {
    const upgrading = process.env.DSH_BOTS_SMOKE_UPGRADE
    const legacy = process.env.DSH_BOTS_SMOKE_LEGACY
    const oldRouting = process.env.DSH_BOTS_SMOKE_OLD_ROUTING
    await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).waitFor()
    if (upgrading) {
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      await page.getByRole('region', { name: 'King Arthur 专属对话', exact: true }).waitFor()
    }
    const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
    await workspace.waitFor()
    const conversation = page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ })
    if (!await conversation.isVisible() && await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
    await conversation.click()
    const log = page.getByRole('log', { name: '群聊时间线' })
    if (upgrading) {
      if (oldRouting) await log.getByText(legacy ? /^@?King Arthur \| 汇总完成$/u : /^@?King Arthur \| 讨论汇总完成$/u, { exact: true }).nth(1).waitFor()
      else await log.getByText(/^@?审阅员 \| 直接回复$/u).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== (oldRouting ? 6 : 2)) throw new Error('Upgrade should restore the old replies')
    } else {
      await log.getByText(/^@?King Arthur \| 讨论汇总完成$/u).waitFor()
      if (await log.locator('article[data-author=bot]').count() !== 9) throw new Error('Restart should restore discussion')
    }

    const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
    await editor.and(page.locator('[contenteditable="true"]')).fill('@审阅员 重启后继续')
    await editor.press('Enter')
    await log.getByText(/^@?审阅员 \| 直接回复$/u).nth(oldRouting ? 0 : 1).waitFor()

    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
    await page.getByRole('button', { name: '默认', exact: true, pressed: true }).waitFor()
    if (await log.count()) throw new Error('A default conversation must not show a group timeline')
    await editor.and(page.locator('[contenteditable="true"]')).fill('普通会话测试')
    await editor.press('Enter')
    await page.getByRole('paragraph').filter({ hasText: /^默认 \| 已收到$/ }).waitFor()
  }).toString().replace('process.env.DSH_BOTS_SMOKE_UPGRADE', String(!!upgradeFrom)).replace('process.env.DSH_BOTS_SMOKE_LEGACY', String(legacyRouting))
    .replace('process.env.DSH_BOTS_SMOKE_OLD_ROUTING', String(oldRoutesThroughKing)))

  const afterRestart = (await requests()).filter(item => !item.intentCheck)
  assert.deepEqual(afterRestart.map(item => item.role), [...normalRoles, ...discussionRoles, '审阅员', '默认'])
  assert.match(afterRestart.at(-2).input, previous ? /请点评上一条/u : /架构师 \| 回应 审阅员/u)
  assert.equal(afterRestart.at(-2).speaker, '审阅员')
  assert.equal(afterRestart.at(-1).input, '普通会话测试')
  if (previous) {
    assert.deepEqual(await savedIdentities(), { ...previous, king: { ...previous.king, title: 'King Arthur' } })
    console.log(`Verified upgrade, King Arthur rename, and preserved session identities on DSH ${runtime}.`)
  } else {
    browser('run-code', (async page => {
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      await page.getByRole('region', { name: 'King Arthur 专属对话', exact: true }).waitFor()
      const log = page.getByRole('log', { name: '群聊时间线' })
      const replies = log.locator('article[data-author=bot] p')
      const send = async text => {
        const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
        await editor.and(page.locator('[contenteditable="true"]')).fill(text)
        await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
      }
      await send('方案/流程助手、记录助手你都帮我建立一下')
      await replies.last().filter({ hasText: /已创建.*方案-流程助手/s }).waitFor()
      await send('方案/流程助手、记录助手你都帮我建立一下')
      await replies.last().filter({ hasText: /可复用.*方案-流程助手/s }).waitFor()
      await send('资料核对助手你帮我建立一下')
      await replies.last().filter({ hasText: /已创建.*资料核对助手/s }).waitFor()
      await send('方法论/实验设计助手、数据分析助手、批判性审稿助手、学术写作助手你都帮我建立一下')
      await replies.last().filter({ hasText: /已创建 @?实验设计助手、@?数据分析助手、@?批判性审稿助手、@?学术写作助手/ }).waitFor()
      await send('这几个都帮我建立一下')
      await replies.last().filter({ hasText: /可复用 @?实验设计助手、@?数据分析助手、@?批判性审稿助手、@?学术写作助手/ }).waitFor()

      await send('请帮我完成离线清单方案，让合适的成员讨论后给我结论')
      await replies.last().filter({ hasText: /在「[^」]+」建立「清单设计讨论」.*新建 @?离线方案审阅员.*可以这样建吗/s }).waitFor()
      const workspace = (await replies.last().textContent()).match(/在「([^」]+)」建立/)[1]
      const confirm = log.getByRole('button', { name: '确认建群', exact: true })
      await confirm.waitFor()
      if (await page.getByRole('button', { name: '打开群聊' }).count()) throw new Error('A proposal must not create the group before confirmation')
      await send('工作区：不存在的测试目录')
      await replies.last().filter({ hasText: /放在哪个工作区/ }).waitFor()
      await confirm.waitFor({ state: 'hidden' })
      await send('确认建群')
      await replies.last().filter({ hasText: /放在哪个工作区/ }).waitFor()
      await send(`工作区：${workspace}`)
      await replies.last().filter({ hasText: /工作区改为.*按修改后的方案建群吗/ }).waitFor()
      await send('好，就这么建。')
      await replies.last().filter({ hasText: /群聊结论：.*King Arthur \| 讨论汇总完成/s }).waitFor()
      const opened = log.getByRole('status').getByRole('button', { name: '打开群聊', exact: true })
      if (await opened.count() !== 1) throw new Error('Confirmation must create exactly one group')
      await send('确认建群')
      await replies.last().filter({ hasText: /当前没有待确认的建群方案/ }).waitFor()
      await opened.click()
      await log.getByText(/^@?King Arthur \| 讨论汇总完成$/u).waitFor()
      await log.getByText(/^@?架构师 \| 回应 @?离线方案审阅员$/u).waitFor()
      await log.getByText('完成离线清单方案，比较同步与纯本地方案', { exact: true }).waitFor()
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('heading', { name: '离线方案审阅员', exact: true }).waitFor()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      await send('请新建空白验收群聊，成员为 @架构师')
      await confirm.waitFor()
      await send('换成明天的天气怎么样？')
      await replies.last().filter({ hasText: /这条消息没有提出建群操作/ }).waitFor()
      await confirm.waitFor({ state: 'hidden' })
      await send('确认建群')
      await replies.last().filter({ hasText: /当前没有待确认的建群方案/ }).waitFor()
      if (await opened.count() !== 1) throw new Error('An unrelated turn must invalidate the prior proposal')
      await send('请新建空白验收群聊，成员为 @架构师')
      await replies.last().filter({ hasText: /建立「空白验收群」.*邀请 @?架构师/s }).waitFor()
      await confirm.click()
      await log.getByRole('status').filter({ hasText: /已在.*空白验收群/ }).getByRole('button', { name: '打开群聊' }).waitFor()
    }).toString())
    await stopHost()
    browser('goto', await startHost())
    browser('run-code', (async page => {
      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      const blank = page.getByRole('status').filter({ hasText: /已在.*空白验收群/ })
      await blank.getByRole('button', { name: '打开群聊', exact: true }).click()
      const room = page.getByRole('region', { name: '群聊', exact: true })
      await room.getByText('仅创建群聊', { exact: true }).waitFor()
      const log = room.getByRole('log', { name: '群聊时间线' })
      if (await log.count()) throw new Error('An empty group must wait for its first message')
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      await editor.and(page.locator('[contenteditable="true"]')).fill('检查空白群重启后能否发言')
      await editor.press('Enter')
      await log.getByText(/^@?King Arthur \| 讨论汇总完成$/u).waitFor()
    }).toString())
    browser('run-code', (async page => {
      const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
      await workspace.waitFor()
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
      const log = page.getByRole('log', { name: '群聊时间线' })
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      const summary = log.getByText(/^@?King Arthur \| 讨论汇总完成$/u)
      await summary.waitFor()
      const send = async (text, key = 'Enter') => {
        await editor.and(page.locator('[contenteditable="true"]')).fill(text)
        await editor.press(key)
      }
      const activeArchitect = log.locator('article[data-author=bot]')
        .filter({ has: page.getByText('@架构师', { exact: true }) })
        .filter({ has: page.getByText(/^正在(?:回复|生成)…$/u) })
      const pause = log.getByText('已暂停讨论。接下来你想让大家讨论或完成什么？', { exact: true })
      await send('@架构师 @审阅员 验收主持恢复：讨论数据索引')
      await summary.nth(1).waitFor()
      await log.getByText('你如何回应 @审阅员 的意见？请结合当前议题补充依据。', { exact: false }).waitFor()
      const directReview = log.getByText(/^@?审阅员 \| 直接回复$/u)
      const priorDirect = await directReview.count()
      await send('@审阅员 周末怎么烤面包')
      await directReview.nth(priorDirect).waitFor()
      await send('@架构师 @审阅员 验收实时插话原议题')
      await activeArchitect.waitFor()
      await send('@架构师 @审阅员 验收插话后只核对核心证据', 'Control+Enter')
      await log.getByText('已收到插话，King Arthur 将按新消息继续。', { exact: true }).waitFor({ timeout: 6500 })
      await summary.nth(2).waitFor()
      await send('@架构师 @审阅员 验收暂停原议题')
      await activeArchitect.waitFor()
      await send('停止现在的讨论')
      await pause.first().waitFor({ timeout: 6500 })
      await send('@架构师 @审阅员 验收语义暂停原议题')
      await activeArchitect.waitFor()
      await send('把时间留给我，我还没决定下一步')
      await pause.nth(1).waitFor({ timeout: 6500 })
      await send('@架构师 @审阅员 验收换任务原议题')
      await activeArchitect.waitFor()
      await send('换个方向，@审阅员 请核对预算边界', 'Control+Enter')
      await directReview.nth(priorDirect + 1).waitFor({ timeout: 6500 })
      await send('@架构师 @审阅员 验收优先点名原议题')
      await activeArchitect.waitFor()
      await send('@审阅员 只回答验收点名优先')
      await directReview.nth(priorDirect + 2).waitFor({ timeout: 6500 })
      await send('@架构师 @审阅员 验收主持等待中接管')
      await log.getByText('正在组织讨论…', { exact: true }).waitFor()
      await send('@审阅员 只回答主持期间的优先点名')
      await directReview.nth(priorDirect + 3).waitFor({ timeout: 6500 })
      await send('@架构师 @审阅员 验收待确认原议题')
      await activeArchitect.waitFor()
      await send('方向改成什么先等等')
      await log.getByText('我先暂停派发。你是想调整当前议题，还是开始一项新任务？', { exact: true }).waitFor({ timeout: 6500 })
      if (await summary.count() !== 3) throw new Error('A pause or a single addressed Bot must not trigger a summary')
      if (await log.getByText(/执行失败.*(?:JSON 格式|还有需要听取的成员)/).count()) throw new Error('Moderator recovery should not abort the discussion')
      await send('@架构师 @审阅员 验收首次主持故障：检查文档索引')
      await log.getByText(/King Arthur \| 讨论汇总完成.*尚未收到 @?审阅员/s).waitFor()
      await log.getByText('等待该成员回复超时。', { exact: true }).first().waitFor()
      await page.locator('input[type=file]').setInputFiles(process.env.DSH_BOTS_SMOKE_DOCUMENT)
      await editor.and(page.locator('[contenteditable="true"]')).fill('@审阅员 验收读取拖入文档')
      await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
      await log.getByRole('list', { name: '文档附件' }).getByText('outside workspace.md', { exact: true }).waitFor()
      const cell = log.getByRole('table').getByRole('cell', { name: 'DOCUMENT-CANARY-617', exact: true })
      await cell.waitFor()
      await send('@审阅员 @"' + process.env.DSH_BOTS_SMOKE_DOCUMENT + '" 验收读取本地引用')
      await cell.nth(1).waitFor()
      await send('@审阅员 @' + process.env.DSH_BOTS_SMOKE_DOCX + ' 验收读取本地 Word 引用')
      await cell.nth(2).waitFor()
      await send('@审阅员 @' + process.env.DSH_BOTS_SMOKE_DOCX + ' @"' + process.env.DSH_BOTS_SMOKE_PDF + '" @' + process.env.DSH_BOTS_SMOKE_MISSING + ' 验收多附件')
      await log.getByText(/找不到「missing-path.docx」/).waitFor()
      await log.getByText('Word 和 PDF 第 1 页可读，缺失的文件无法核对。', { exact: true }).waitFor()
      await send('@审阅员 继续分析上一轮验收多附件')
      await log.getByText('Word 和 PDF 第 1 页可读。', { exact: true }).waitFor()
      await send('@架构师 验收原生网络搜索')
      await log.getByText('已读取搜索结果 WEB-CANARY-391', { exact: true }).waitFor()
      await send('@架构师 验收原生 Skill bots-smoke')
      await log.getByText('已读取 SKILL-REFERENCE-284', { exact: true }).waitFor()
    }).toString().replaceAll('process.env.DSH_BOTS_SMOKE_DOCUMENT', JSON.stringify(documentPath))
      .replaceAll('process.env.DSH_BOTS_SMOKE_DOCX', JSON.stringify(docxPath))
      .replace('process.env.DSH_BOTS_SMOKE_PDF', JSON.stringify(pdfPath))
      .replace('process.env.DSH_BOTS_SMOKE_MISSING', JSON.stringify(join(dir, 'missing-path.docx'))))
    browser('run-code', (async page => {
      await page.getByRole('button', { name: /^(新建会话|New session)$/i }).last().click()
      await page.getByRole('button', { name: '默认', exact: true, pressed: true }).waitFor()
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      await page.locator('input[type=file]').setInputFiles(process.env.DSH_BOTS_SMOKE_DOCUMENT)
      await editor.and(page.locator('[contenteditable="true"]')).fill('标准会话验收读取拖入文档')
      await page.getByRole('button', { name: /^(发送消息|Send message)$/i }).click()
      await page.getByRole('cell', { name: 'DOCUMENT-CANARY-617', exact: true }).waitFor()
      await editor.and(page.locator('[contenteditable="true"]')).fill('标准会话验收原生 Skill bots-smoke')
      await editor.press('Enter')
      await page.getByText('已读取 SKILL-REFERENCE-284', { exact: true }).waitFor()
      await editor.and(page.locator('[contenteditable="true"]')).fill('标准会话验收原生网络搜索')
      await editor.press('Enter')
      await page.getByText('已读取搜索结果 WEB-CANARY-391', { exact: true }).waitFor()
    }).toString().replace('process.env.DSH_BOTS_SMOKE_DOCUMENT', JSON.stringify(documentPath)))
    browser('run-code', (async page => {
      const workspace = page.getByRole('treeitem', { name: /^(默认工作区|Default workspace)(?:\s|$)/i })
      await workspace.waitFor()
      if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
      const groupA = page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ })
      await groupA.click()
      const log = page.getByRole('log', { name: '群聊时间线' })
      const editor = page.getByRole('textbox', { name: /调用指令|commands/i })
      const send = async text => {
        await editor.and(page.locator('[contenteditable="true"]')).fill(text)
        await editor.press('Enter')
      }
      await send('@架构师 验收群记忆隔离 A：本群暗号是 GROUP-A-ONLY-496')
      const fact = log.locator('article[data-author=bot]').getByText('本群暗号是 GROUP-A-ONLY-496', { exact: true })
      await fact.waitFor()

      await page.getByRole('button', { name: /^(?:Roundtable|Bots(?: 定义)?)$/ }).click()
      await page.getByRole('button', { name: 'King Arthur', exact: true }).click()
      await page.getByRole('button', { name: '与 King Arthur 对话', exact: true }).click()
      await page.getByRole('region', { name: 'King Arthur 专属对话', exact: true }).waitFor()
      await send('请新建记忆隔离验收群聊，成员为 @架构师')
      await log.getByText(/建立「记忆隔离验收群」/).waitFor()
      await send('确认建群')
      await log.getByRole('status').filter({ hasText: /已在.*记忆隔离验收群/ })
        .getByRole('button', { name: '打开群聊', exact: true }).click()
      await page.getByRole('region', { name: '群聊', exact: true }).getByText('仅创建群聊', { exact: true }).waitFor()
      await send('@架构师 验收群记忆隔离 B：请告诉我本群暗号')
      await log.getByText('本群没有收到暗号', { exact: true }).waitFor()
      if (await fact.count()) throw new Error('Group A messages must stay out of group B')

      await page.getByRole('button', { name: /^(搜索会话|Search sessions)$/i }).click()
      await page.getByPlaceholder(/搜索会话名称|Search session names/i).fill('给出架构说明')
      await page.getByRole('treeitem', { name: /群聊 · @架构师 给出架构说明/ }).click()
      await fact.waitFor()
      await send('@架构师 验收群记忆隔离 A 回访：继续上一轮，复述本群暗号')
      await fact.nth(1).waitFor()
    }).toString())
    const completed = await requests()
    const moderatorState = item => JSON.parse(JSON.parse(item.input).最新用户消息)
    const recoveries = completed.filter(item => item.moderator && moderatorState(item).议题.includes('验收主持恢复'))
    const retries = recoveries.filter(item => moderatorState(item).上次决定被拒绝)
    assert.equal(retries.length, 2)
    assert.ok(retries.every(item => item.recoveryInstructions))
    assert.equal(moderatorState(recoveries.at(-1)).已有讨论[1].text, '架构师 | 回应 审阅员')
    const independent = completed.filter(item => item.role !== '默认' && !item.intentCheck && JSON.parse(item.input).最新用户消息.includes('周末怎么烤面包'))
    assert.equal(independent.length, 1)
    assert.equal(independent[0].role, '审阅员')
    assert.ok(independent.every(item => !String(JSON.parse(item.input).群聊议题 ?? '').includes('验收主持恢复')), 'New topics must not inherit old task constraints; historical sources remain retrievable')
    const redirected = completed.find(item => item.moderator && moderatorState(item).用户最近要求?.some(line => line.includes('验收插话后只核对核心证据')))
    assert.match(redirected.input, /验收实时插话原议题/)
    assert.match(redirected.input, /审阅员 \| 初步观点/)
    const latestMessage = item => { const text = JSON.parse(item.input).最新用户消息; return item.intentCheck ? JSON.parse(text).用户新消息 : text }
    const callsFor = needle => completed.filter(item => item.role !== '默认' && latestMessage(item).includes(needle))
    for (const subject of ['验收暂停原议题', '验收语义暂停原议题', '验收待确认原议题', '验收换任务原议题', '验收优先点名原议题', '验收实时插话原议题']) {
      const calls = callsFor(subject).filter(item => {
        if (item.intentCheck || latestMessage(item).includes('验收插话后只核对核心证据')) return false
        try { return JSON.parse(latestMessage(item)).议题?.includes(subject) }
        catch { return latestMessage(item).includes(subject) }
      })
      assert.equal(calls.filter(item => item.discussion && item.role === '架构师').length, 1)
      assert.equal(calls.filter(item => !item.moderator && !item.intentCheck && item.role === 'King Arthur').length, 0)
    }
    assert.equal(callsFor('停止现在的讨论').length, 0)
    assert.deepEqual(callsFor('把时间留给我').map(item => item.intentCheck), [true])
    const replacement = callsFor('请核对预算边界').filter(item => item.addressed)
    assert.equal(replacement.length, 1)
    assert.equal(replacement[0].role, '审阅员')
    assert.doesNotMatch(String(JSON.parse(replacement[0].input).群聊议题 ?? ''), /验收换任务原议题/)
    assert.deepEqual(callsFor('只回答验收点名优先').map(item => item.role), ['审阅员'])
    assert.ok(callsFor('验收读取拖入文档').some(item => item.calledTool === 'read'))
    assert.ok(callsFor('验收读取本地引用').some(item => item.calledTool === 'read_uploaded_document'))
    assert.ok(callsFor('验收读取本地 Word 引用').some(item => item.calledTool === 'read_uploaded_document'))
    assert.ok(callsFor('验收原生网络搜索').some(item => item.calledTool === 'web_search'))
    const skillCalls = callsFor('验收原生 Skill')
    assert.deepEqual(skillCalls.flatMap(item => item.calledTool ?? []), ['skill', 'read'])
    assert.ok(skillCalls.every(item => item.seesWorkspaceInstructions))
    const standardCalls = completed.filter(item => item.role === '默认' && item.input.startsWith('标准会话'))
    assert.deepEqual(standardCalls.flatMap(item => item.calledTool ?? []), ['read', 'skill', 'read', 'web_search'])
    assert.ok(standardCalls.every(item => item.seesWorkspaceInstructions))
    const memoryChecks = callsFor('验收群记忆隔离')
    assert.deepEqual(memoryChecks.map(item => [item.speaker, item.duty, item.seesGroupFact]), [
      ['架构师', '提出技术方案', true],
      ['架构师', '提出技术方案', false],
      ['架构师', '提出技术方案', true],
    ])
    const relevant = ['read', 'write', 'edit', 'glob', 'grep', 'skill', 'web_search', 'web_fetch']
    assert.deepEqual(
      standardCalls.find(item => item.calledTool === 'skill').tools.filter(name => relevant.includes(name)).sort(),
      skillCalls.find(item => item.calledTool === 'skill').tools.filter(name => relevant.includes(name)).sort(),
    )
    const recovery = completed.filter(item => item.role === 'King Arthur' && item.input.includes('上次回复校验失败：第 1 个子 Bot'))
    assert.equal(recovery.length, 1)
    const delegated = completed.filter(item => item.moderator && item.input.includes('完成离线清单方案'))
    assert.ok(delegated.length >= 3)
    assert.ok(completed.filter(item => item.moderator || item.intentCheck).every(item => item.tools.every(name => name === 'read_group_history')))
    if (process.env.DSH_BOTS_RECOVERY_SMOKE === '1') {
      await exerciseLongReplies()
      await exerciseTaskRecovery(defaultWorkspace)
    }
    if (process.env.DSH_BOTS_EXISTING_GROUPS_SMOKE === '1') await exerciseExistingGroups()
    console.log(`Verified natural Bot creation, dynamic discussion, confirmed group placement, and return of results on DSH ${runtime}.`)
  }
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
