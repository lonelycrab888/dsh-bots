// For the isolated browser smoke only. Logs routing and returns deterministic text.
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { newTask } from '../src/tasks.ts'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const inject = ['llm', 'web', 'workspaceRegistry', 'tools', 'sessionProjections', 'sessionController', 'agents', 'sessions']

const timelineReply = ('审阅员 | 初步观点\n\n' +
  '| 时间 | 资料 |\n| --- | --- |\n| 19:00 | ' + '演练资料 '.repeat(20) + '|\n\n' +
  '\x60\x60\x60text\n' + 'exercise-checkpoint-'.repeat(18) + '\n\x60\x60\x60\n\n' +
  Array.from({ length: 25 }, (_, index) => `- 19:${String(index).padStart(2, '0')} 核对演练条目和材料状态\n`).join(''))
  .padEnd(1794, '核') + '\n\n20:10 交接确认 P036-TIMELINE-END'

class Fixture extends LlmAdapter {
  async listModels(provider) { return [{ provider, id: 'fixture', name: 'Bots fixture' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }

  async *stream({ messages, tools, signal, sessionId }) {
    const system = messages.find(message => message.role === 'system')
    const prompt = messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const systemText = system?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    const speaker = systemText.match(/你是群聊中的「([^」]+)」/u)?.[1] ?? '默认'
    const role = speaker === 'Bots King' ? 'King Arthur' : speaker
    const promptTexts = prompt?.content.flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
    const input = promptTexts.find(text => !text.startsWith('[File ')) ?? ''
    const toolResults = prompt ? messages.slice(messages.indexOf(prompt) + 1).filter(message => message.role === 'tool') : []
    const moderator = systemText.includes('你是本场群聊的主持人') || systemText.includes('结合已有发言主持讨论')
    const discussion = systemText.includes('你正在参加 King Arthur 主持的讨论')
    const addressed = systemText.includes('用户直接点名了你')
    const summarizing = systemText.includes('请总结你主持的讨论')
    const intentCheck = systemText.includes('判断群聊用户新消息的语义')
    const latest = input && role !== '默认' ? JSON.parse(input).最新用户消息 : undefined
    let slow = false
    let duration
    let failure
    let toolCall
    let text = `${role} | ${input.includes('架构说明') ? '看到了架构说明' : '已收到'}`
    if (role === 'King Arthur') {
      if (intentCheck) {
        const { 用户新消息: requested } = JSON.parse(latest)
        if (requested.includes('P038-STALE')) slow = true
        text = requested.includes('讨论架构建议') || /验收.*(?:原议题|主持恢复|主持等待中接管|首次主持故障|长时间轴)/u.test(requested) || requested.includes('新任务') || requested.includes('无关') ? JSON.stringify({ kind: 'redirect', task: requested })
          : requested.includes('你们现在做到哪了') ? '{"kind":"status"}'
          : requested.includes('改做一件别的事：') ? JSON.stringify({ kind: 'redirect', task: requested.split('：').at(-1) })
          : requested.includes('把时间留给我') ? '{"kind":"pause"}'
          : requested.includes('方向改成什么先等等') ? '无法判断'
          : requested.includes('换个方向') ? JSON.stringify({ kind: 'redirect', task: requested.split('，').at(-1) })
          : '{"kind":"continue"}'
      } else if (moderator) {
        const state = JSON.parse(latest)
        const last = state.已有讨论.at(-1)
        const initialPeer = state.议题.includes('P038-TEST-02') ? '架构师' : state.议题.includes('P038-TEST-03') ? '审阅员' : undefined
        const member = !last && initialPeer ? state.本轮可发言.find(member => member.name === initialPeer) ?? state.本轮可发言.at(-1) : state.本轮可发言.at(-1)
        text = JSON.stringify(state.允许收束 && state.已有讨论.length >= 3
          ? { kind: 'close' }
          : { kind: 'speak', botId: member.id, question: last ? `请回应 ${last.name} 的意见` : '先提出一个可检验的建议' })
        if (last && state.议题.includes('P038-CONTROL') && !state.用户最近要求?.some(line => /1000|1200/u.test(line))) {
          const architect = state.本轮可发言.find(member => member.name === '架构师')
          if (architect) text = JSON.stringify({ kind: 'speak', botId: architect.id, question: '请与审阅员对齐资料' })
        }
        if (state.议题.includes('验收长时间轴') && state.允许收束) text = '{"kind":"close"}'
        if (state.议题.includes('验收主持恢复') && state.已有讨论.length <= 1) {
          const retry = state.上次决定被拒绝 !== undefined
          if (!retry) text = '{"kind":"close"}'
          else if (last) text = '我会请其他成员继续讨论。'
        }
        if (state.议题.includes('验收首次主持故障') && !state.已有讨论.length) {
          if (state.上次决定被拒绝 === undefined) failure = '测试主持请求失败'
          else text = '无法返回有效的主持决定'
        }
        if (state.议题.includes('验收主持等待中接管') && !state.已有讨论.length) slow = true
        if (state.议题.includes('验收插话后只核对核心证据') && !state.已有讨论.length) {
          text = state.上次决定被拒绝 ? '我现在可以请审阅员发言。' : '{"kind":"close"}'
        }
      } else if (summarizing) {
        const state = JSON.parse(latest)
        text = 'King Arthur | 讨论汇总完成'
        if (state.议题.includes('P038-ROUTE') || state.议题.includes('P038-CONTROL')) {
          const latestBudget = [...state.用户最近要求 ?? []].reverse().flatMap(line => line.match(/(?:1000|1200|1400)/g) ?? [])[0]
          text = `King Arthur 汇总：${latestBudget ? '预算 ' + latestBudget : state.议题}。架构师与 @审阅员 已核对。`
        }
        if (JSON.parse(latest).议题.includes('验收长时间轴汇总失败')) failure = '测试汇总模型失败'
      } else if (systemText.includes('这是你与用户的专属对话') && /方案\/流程助手|资料核对助手|方法论\/实验设计助手|这几个都帮我建立一下|额度验收助手/.test(latest)) {
        const evidence = latest.replace(/^原始请求：/, '').split('\n上次回复校验失败：')[0]
        const names = evidence.includes('额度验收助手') ? ['额度验收助手甲', '额度验收助手乙'] : evidence.includes('方案/流程助手') ? ['方案/流程助手', '记录助手']
          : evidence.includes('方法论/实验设计助手') || evidence.includes('这几个都帮我建立一下')
            ? ['实验设计助手', '数据分析助手', '批判性审稿助手', '学术写作助手'] : ['资料核对助手']
        text = JSON.stringify({ tasks: [], botActions: names.map(name => ({
          name,
          evidence,
          duty: name === '资料核对助手' && !latest.includes('上次回复校验失败：') ? ''
            : name === '实验设计助手' ? '评估研究方法论并提出实验设计' : '整理并核对合成验收资料',
        })) })
      } else if (systemText.includes('这是你与用户的专属对话') && /完成离线清单方案|新建空白验收群聊|新建记忆隔离验收群聊|验收恢复任务|额度补建群|P037-DUPLICATE-GROUP|P038-ROUTE-CREATE|P038-PEER-CREATE|P038-OUTSIDE-CREATE/.test(latest)) {
        const available = JSON.parse(systemText.match(/可用成员：(\[.*?\])。普通工作区：/su)[1])
        const capacity = latest.includes('额度补建群')
        const recovering = latest.includes('验收恢复任务')
        const route = latest.includes('P038-ROUTE-CREATE')
        const peer = latest.includes('P038-PEER-CREATE')
        const outside = latest.includes('P038-OUTSIDE-CREATE')
        const runTask = recovering || route || latest.includes('完成离线清单方案')
        text = JSON.stringify({ tasks: [], groupAction: {
          title: route ? 'P038 路由验收群' : outside ? 'P038 其他工作群' : peer ? 'P038 成员互发验收群' : capacity ? '额度补建群' : recovering || latest.includes('P037-DUPLICATE-GROUP') ? '恢复验收群'
            : runTask ? '清单设计讨论' : latest.includes('新建记忆隔离验收群聊') ? '记忆隔离验收群' : '空白验收群',
          topic: route ? 'P038-ROUTE 比较清单方案并核对预算' : recovering ? '验收恢复任务，预算上限 60 元；比较两份依据' : runTask ? '完成离线清单方案，比较同步与纯本地方案' : '仅创建群聊',
          memberIds: available.filter(member => outside ? member.name === '实验设计助手' : member.name === '架构师' || (recovering || route || peer) && member.name === '审阅员' || peer && member.name === '数据分析助手').map(member => member.id),
          newBots: capacity ? [{ name: '额度验收群助手', duty: '核查名额' }] : runTask && !recovering && !route ? [{ name: '离线方案审阅员', duty: '专门复核离线存储取舍' }] : [],
          runTask,
          evidence: latest.replace(/^原始请求：/, '').split('\n上次回复校验失败：')[0],
        } })
      } else if (systemText.includes('这是你与用户的专属对话')) {
        text = '{"reply":"这条消息没有提出建群操作。"}'
      } else if (systemText.includes('你现在负责规划')) {
        const members = JSON.parse(systemText.match(/只能向下列成员派发任务：(\[.*?\])。/su)[1])
        const required = JSON.parse(systemText.match(/用户点名的成员ID：(\[.*?\])。/su)[1])
        text = JSON.stringify({ tasks: members.filter(member => !required.length || required.includes(member.id)).map(member => ({ botId: member.id, task: '处理用户请求：' + latest })) })
      } else text = 'King Arthur | 汇总完成'
    } else if (discussion || addressed || role === '默认') {
      const state = discussion ? JSON.parse(latest) : { 议题: addressed ? latest : input, 已有讨论: [] }
      const last = state.已有讨论.at(-1)
      slow = role === '架构师' && /验收实时插话原议题|验收暂停原议题|验收语义暂停原议题|验收待确认原议题|验收换任务原议题|验收优先点名原议题/u.test(state.议题)
      if (discussion && role === '架构师' && (
        state.议题.includes('P038-ROUTE') && !state.用户最近要求?.some(line => /1000|1200|1400/u.test(line)) ||
        state.议题.includes('P038-CONTROL') && !state.用户最近要求?.some(line => /1000|1200/u.test(line)) ||
        state.议题.includes('验收实时插话原议题') && !state.用户最近要求?.some(line => line.includes('验收插话后只核对核心证据')))) slow = true
      if (state.用户最近要求?.some(line => line.includes('验收插话后只核对核心证据'))) slow = false
      if (discussion && /P038-TEST-0[23]/u.test(state.议题)) {
        const ring = state.议题.includes('P038-TEST-02')
        const directory = JSON.parse(systemText.match(/收件候选：(\[.*?\])。/su)?.[1] ?? '[]')
        const recipient = name => directory.find(bot => bot.name === name)?.id
        const inbox = JSON.parse(input).定向收件 ?? []
        const results = toolResults.flatMap(result => result.content.flatMap(block => {
          try { return block.type === 'text' ? [JSON.parse(block.text)] : [] } catch { return [] }
        }))
        const next = { 架构师: '审阅员', 审阅员: '数据分析助手', 数据分析助手: '架构师' }[role]
        const stage = role === '架构师' ? 'a' : role === '审阅员' ? 'b' : 'c'
        const nonce = `P038-${ring ? 'ring' : 'fanout'}-${stage}-5682`
        const peerTool = (name, args) => ({ name, arguments: JSON.stringify(args) })
        const unsent = inbox.find(message => !results.some(result => result.receiptId && result.messageId === message.messageId))
        if (unsent && toolResults.length < 4) {
          toolCall = peerTool('acknowledge_group_message', { messageId: unsent.messageId })
        } else if (ring && next && !(role === '架构师' && inbox.length) && !results.some(result => result.status === 'queued') && toolResults.length < 4) {
          toolCall = peerTool('send_group_message', {
            visibility: 'directed', recipientIds: [recipient(next)], text: '三方定向原文 ' + nonce, nonce, senderTimestamp: '2026-11-12T21:21:17+08:00',
          })
        } else if (!ring && role === '审阅员' && !state.已有讨论.some(reply => reply.name === role) && toolResults.length < 4) {
          const to = [recipient('架构师'), recipient('数据分析助手')]
          const command = { visibility: 'directed', recipientIds: to, text: '扇出定向原文 ' + nonce, nonce }
          if (toolResults.length === 0) toolCall = peerTool('send_group_message', command)
          if (toolResults.length === 1) toolCall = peerTool('send_group_message', { ...command, recipientIds: [...to].reverse() })
          if (toolResults.length === 2) toolCall = peerTool('send_group_message', { ...command, recipientIds: [state.议题.match(/CROSS=(bot-[a-z0-9-]+)/u)?.[1] ?? 'not-a-member'], nonce: 'P038-external-reject' })
          if (toolResults.length === 3) toolCall = peerTool('send_group_message', {
            visibility: 'public', text: '公开确认 P038-PUBLIC-871。架构师与 @数据分析助手，代码是 \`架构师\`，文件 /tmp/审阅员.txt。',
            nonce: 'P038-public-author',
          })
        }
        if (!ring && role === '审阅员' && state.议题.includes('P038-PAUSE') && toolResults.length >= 4) slow = true
        text = `${role} | ${inbox.length ? '已提交定向回执' : '群消息验收发言'}`
      }
      if (discussion && state.议题.includes('P038-WAIT')) {
        const seen = state.已有讨论.some(reply => reply.name === role)
        const use = (name, args) => ({ name, arguments: JSON.stringify(args) })
        if (role === '架构师' && !seen && !toolResults.length) {
          if (state.议题.includes('MODEL')) duration = 35_000
          if (state.议题.includes('READ')) toolCall = use('read', { file_path: 'p038-progress.txt' })
          if (state.议题.includes('HOST')) toolCall = use('read', { file_path: 'p038-hostwait.txt' })
          if (state.议题.includes('TOOL')) toolCall = use('read', { file_path: 'p038-explicit-timeout.txt' })
          if (state.议题.includes('APPROVAL')) toolCall = use('read', { file_path: 'p038-needs-approval.txt' })
        }
        if (role === '架构师' && state.议题.includes('UNCERTAIN')) {
          if (!toolResults.length) toolCall = use('write', { file_path: 'p038-uncertain.txt', content: 'P038-WRITE-SETTLED' })
          else slow = true
        }
        if (role === '架构师' && state.议题.includes('QUESTION') && !toolResults.length &&
            !state.用户最近要求?.some(line => line.includes('预算 1600'))) {
          toolCall = use('ask_group_user', { question: '这份清单的预算上限是多少？P038-QUESTION-135' })
        }
      }
      if (discussion && role === '架构师' && state.议题.includes('验收恢复任务') && !input.includes('已核对')) {
        if (!toolResults.length && tools.some(tool => tool.name === 'write')) {
          toolCall = { name: 'write', arguments: '{"file_path":"p1-pending-write.txt","content":"P1-CHECKPOINT-459"}' }
        } else {
          slow = true
        }
      }
      if ((addressed || discussion) && !/P038-TEST-0[23]/u.test(state.议题)) text = addressed ? `${role} | 直接回复` : last ? `${role} | 回应 ${last.name}` : `${role} | 初步观点`
      if (addressed && state.议题.includes('P036-DRAFT')) {
        const result = toolResults.at(-1)
        if (result?.content.some(block => block.type === 'text' && block.text.includes('P1-CHECKPOINT-459'))) {
          text += '\n\n已读取原生文件引用 P1-CHECKPOINT-459'
        } else if (!result && tools.some(tool => tool.name === 'read')) {
          toolCall = { name: 'read', arguments: '{"file_path":"p1-pending-write.txt"}' }
        }
      }
      if (discussion && /验收长时间轴|验收恢复任务/u.test(state.议题) && role === '审阅员' && !last) text = timelineReply
      if (discussion && state.议题.includes('验收长时间轴汇总失败') && role === '架构师') failure = '测试成员生成失败'
      if (state.议题.includes('验收首次主持故障') && role === '审阅员') failure = '等待该成员回复超时。'
      if (state.议题.includes('验收多附件')) {
        const results = toolResults.flatMap(result => result.content).filter(block => block.type === 'text').map(block => block.text)
        if (!results.length && tools.some(tool => tool.name === 'read_uploaded_document')) toolCall = { name: 'read_uploaded_document', arguments: '{"number":1}' }
        else if (results.length === 1) toolCall = { name: 'read_uploaded_document', arguments: '{"number":2}' }
        else text = results.some(result => result.includes('DOCUMENT-CANARY-617')) && results.some(result => result.includes('PDF-CANARY-903') && result.includes('第 1 页'))
          ? `Word 和 PDF 第 1 页可读${systemText.includes('missing-path.docx') ? '，缺失的文件无法核对' : ''}。` : '当前议题没有这两份附件。'
      }
      if (state.议题.includes('验收读取拖入文档') || state.议题.includes('验收读取本地引用') || state.议题.includes('验收读取本地 Word 引用')) {
        const result = toolResults.at(-1)
        if (result) {
          const read = result.content.some(block => block.type === 'text' && block.text.includes('DOCUMENT-CANARY-617'))
          text = read
            ? '## 文档要点\n\n- **已读取** 上传的原文\n\n| 项目 | 值 |\n| --- | --- |\n| 验收编号 | DOCUMENT-CANARY-617 |'
            : '文档读取失败'
        } else {
          const nativePath = promptTexts.join('\n').match(/verbatim read-only copy saved at ("[^"]+")/)?.[1]
          if (nativePath && state.议题.includes('验收读取拖入文档') && tools.some(tool => tool.name === 'read')) {
            toolCall = { name: 'read', arguments: JSON.stringify({ file_path: JSON.parse(nativePath) }) }
          } else if (tools.some(tool => tool.name === 'read_uploaded_document')) {
            toolCall = { name: 'read_uploaded_document', arguments: '{"number":1}' }
          }
        }
      }
      if (state.议题.includes('验收群记忆隔离')) {
        const hasGroupFact = messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('GROUP-A-ONLY-496')))
        text = hasGroupFact ? '本群暗号是 GROUP-A-ONLY-496' : '本群没有收到暗号'
      }
      if (state.议题.includes('验收原生 Skill')) {
        const results = toolResults.map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
        if (results.some(result => result.includes('SKILL-REFERENCE-284'))) {
          text = '已读取 SKILL-REFERENCE-284'
        } else if (results.some(result => result.includes('references/guide.md'))) {
          toolCall = { name: 'read', arguments: '{"file_path":".agents/skills/bots-smoke/references/guide.md"}' }
        } else if (tools.some(tool => tool.name === 'skill')) {
          toolCall = { name: 'skill', arguments: '{"name":"bots-smoke"}' }
        }
      }
      if (state.议题.includes('验收原生网络搜索')) {
        const result = toolResults.at(-1)
        if (result) text = result.content.some(block => block.type === 'text' && block.text.includes('WEB-CANARY-391')) ? '已读取搜索结果 WEB-CANARY-391' : '搜索失败'
        else if (tools.some(tool => tool.name === 'web_search')) toolCall = { name: 'web_search', arguments: '{"queries":["DSH fixture query"]}' }
      }
    }
    if (role === 'King Arthur' && systemText.includes('这是你与用户的专属对话') && latest.includes('P039-')) {
      const call = (name, args) => ({ name, arguments: JSON.stringify(args) })
      const results = toolResults.flatMap(result => result.content.filter(block => block.type === 'text').map(block => block.text))
      if (!results.length) toolCall = call('list_existing_groups', {})
      else if (results.length === 1) {
        let directory
        try { directory = JSON.parse(results[0]) } catch { directory = {} }
        const action = /P039-(?:REF-)?UPDATE/u.test(latest) ? 'update' : /P039-(?:REF-)?TASK/u.test(latest) ? 'task' : /P039-(?:REF-)?INSPECT/u.test(latest) ? 'inspect' : 'send'
        const title = latest.includes('P039-OTHER') ? 'P038 其他工作群' : 'P038 路由验收群'
        const target = latest.includes('P039-MISSING') ? 'session-missing-039' : latest.includes('P039-REF') ? '这个群' : directory.groups?.find(item => item.title.includes(title))?.id ?? title
        toolCall = call('operate_existing_group', { kind: action, target, body: latest })
      } else if (results.length === 2 && latest.includes('P039-RETRY')) {
        const delivery = JSON.parse(results[1]).delivery
        toolCall = call('operate_existing_group', { kind: delivery.kind, target: delivery.targetId, body: delivery.body })
      } else text = JSON.stringify({ reply: 'P039 工具调用已返回，请以宿主回执为准。' })
    }
    if (role !== 'King Arthur' && (discussion || addressed) && latest.includes('P039-')) {
      const payload = JSON.parse(input)
      if (latest.includes('P039-READ') && !toolResults.length) toolCall = { name: 'read_group_history', arguments: JSON.stringify({ query: 'P039-MIDDLE' }) }
      text = JSON.stringify({ role, marker: 'P039-REPLY', hasHistory: Boolean(payload.群工作记忆?.recent?.length), compressed: payload.群工作记忆?.compressedSegments, results: toolResults.map(result => result.content) })
      if (latest.includes('P039-BUSY') && !JSON.stringify(payload.群聊议题).includes('更正')) slow = true
      if (latest.includes('P039-FIRST')) duration = 35_000
      if (latest.includes('P039-SILENT')) duration = 130_000
      if (latest.includes('P039-TOOL') && !toolResults.length) toolCall = { name: 'read', arguments: '{"file_path":"p038-hostwait.txt"}' }
    }
    if ((moderator || discussion || summarizing) && JSON.parse(latest).议题?.includes('V040-RECOVERY')) {
      const state = JSON.parse(latest)
      if (moderator) text = JSON.stringify({ kind: 'speak', botId: state.本轮可发言[0].id, question: '根据上次主持建议及最新要求，直接写出初稿。' })
      if (discussion) {
        text = 'V040-DRAFT 已根据现有结果写出立项书初稿。'
        if (!toolResults.length && ['可以，就按照你说的做', '已核对，继续'].includes(state.最新用户消息)) {
          toolCall = { name: 'write', arguments: JSON.stringify({ file_path: state.最新用户消息 === '已核对，继续' ? 'v040-verified.txt' : 'v040-blocked.txt', content: 'verified' }) }
        }
      }
      if (summarizing) text = 'V040-RECOVERED ' + state.最新用户消息
    }
    if (intentCheck && JSON.parse(latest).用户新消息.includes('V040-INTENT-RETRY') && !systemText.includes('这是识别重试')) text = 'invalid classifier output'
    if (intentCheck && JSON.parse(latest).用户新消息.includes('V040-INTENT-FAIL')) text = 'invalid classifier output'
    const nativeKing = systemText.includes('你是 King Arthur，用户的通用助手')
    if (nativeKing && input.includes('V040-')) {
      const call = (name, args) => ({ name, arguments: JSON.stringify(args) })
      const values = toolResults.map(result => result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      text = 'V040-ANSWER 自然语言回答 **保留 Markdown**。'
      if (input.includes('V040-SEED-RECOVERY')) {
        if (!toolResults.length) toolCall = call('list_existing_groups', {})
        else if (toolResults.length === 1) toolCall = call('fixture_seed_recovery', { groupId: JSON.parse(values[0]).groups[0].id })
        else text = 'V040-SEEDED-DONE'
      } else if (input.includes('V040-CREATE-BOT')) {
        if (!toolResults.length) toolCall = call('create_bots', { bots: [{ name: '版本助手', duty: '验证新版本', evidence: input }] })
        else text = 'V040-BOT-DONE ' + values.join('\n')
      } else if (input.includes('V040-CREATE-GROUP')) {
        if (!toolResults.length) toolCall = call('list_bots_and_workspaces', {})
        else if (toolResults.length === 1) {
          const catalog = JSON.parse(values[0])
          toolCall = call('create_group', { title: '原生验收群', topic: '验证消息投递', memberIds: [catalog.bots[0].id], workspaceId: catalog.workspaces[0].id, evidence: input })
        } else if (toolResults.length === 2) {
          const catalog = JSON.parse(values[0])
          toolCall = call('create_group', { title: '原生验收群', topic: '验证消息投递', memberIds: [catalog.bots[0].id], workspaceId: catalog.workspaces[0].id, evidence: input })
        } else {
          if (JSON.parse(values[1]).groupId !== JSON.parse(values[2]).groupId) throw new Error('Group retry created a duplicate')
          text = 'V040-GROUP-DONE ' + values.at(-1)
        }
      } else if (input.includes('V040-SEND')) {
        if (!toolResults.length) toolCall = call('operate_existing_group', { kind: 'send', target: '原生验收群', body: 'V040-NOTICE' })
        else text = 'V040-SEND-DONE ' + values.at(-1)
      } else if (input.includes('V040-HISTORY')) {
        if (!toolResults.length) toolCall = call('read_group_history', { query: '原生验收群' })
        else text = 'V040-HISTORY-DONE ' + values.at(-1)
      } else if (input.includes('V040-SEARCH')) {
        if (!toolResults.length) toolCall = call('web_search', { queries: ['native agent smoke'] })
        else text = 'V040-SEARCH-DONE ' + values.at(-1)
      } else if (input.includes('V040-READ')) {
        if (!toolResults.length) toolCall = call('read', { file_path: 'native.txt' })
        else text = 'V040-READ-DONE ' + values.at(-1)
      } else if (input.includes('V040-MEMORY')) {
        if (!toolResults.length) toolCall = call('update_personal_memory', { actions: [{ action: 'remember', text: '用户希望先看结论', evidence: input }] })
        else text = 'V040-MEMORY-DONE ' + values.at(-1)
      } else if (input.includes('V040-PAGE-CANARY')) {
        text = 'V040-PAGE-READY'
      } else if (input.includes('V040-CHECK-CLEAR')) {
        text = !JSON.stringify(messages).includes('TEMP-PAGE-902') && systemText.includes('先看结论') ? 'V040-CLEAR-DONE' : 'V040-CLEAR-FAILED'
      } else if (input.includes('V040-CHECK-RESET')) {
        text = !JSON.stringify(messages).includes('TEMP-PAGE-902') && !systemText.includes('先看结论') ? 'V040-RESET-DONE' : 'V040-RESET-FAILED'
      } else if (input.includes('V040-RECALL')) {
        text = systemText.includes('先看结论') ? 'V040-RECALL-DONE' : 'V040-RECALL-FAILED'
      }
    }
    if (nativeKing && input.includes('V040-') && toolResults.some(result => result.isError)) { toolCall = undefined; text = 'V040-TOOL-FAILED ' + JSON.stringify(toolResults) }
    const nativeBot = systemText.includes('这是你与用户的独立标准对话')
    if ((nativeKing || nativeBot) && input.includes('V041-')) {
      const call = (name,args) => ({name,arguments:JSON.stringify(args)})
      const values = toolResults.flatMap(result => result.content.filter(block=>block.type==='text').map(block=>block.text))
      text = 'V041-CHAT-DONE 普通对话'
      if (input.includes('V041-WINDOWS')) {
        if (!toolResults.length) toolCall = call('fixture_bot_windows',{})
        else text = 'V041-WINDOWS-DONE ' + values.join('\n')
      } else if (input.includes('V041-CREATE-SECOND')) {
        if (!toolResults.length) toolCall = call('list_bots_and_workspaces',{})
        else if (toolResults.length===1) {
          const catalog=JSON.parse(values[0])
          toolCall=call('create_group',{title:'共享记忆二群',topic:'跨群记忆验收',memberIds:[catalog.bots[0].id],workspaceId:catalog.workspaces[0].id,evidence:input})
        } else text='V041-SECOND-DONE'
      } else if (input.includes('V041-READ')) {
        if (!toolResults.length) toolCall=call('read',{file_path:'native.txt'})
        else text='V041-READ-DONE '+values.join('\n')
      } else if (input.includes('V041-REMEMBER')) {
        if (!toolResults.length) toolCall=call('update_personal_memory',{actions:[{action:'remember',text:'用户希望子 Bot 使用蓝色图表 BOT-PRIVATE-741',evidence:input}]})
        else text='V041-REMEMBER-DONE '+values.join('\n')
      } else if (input.includes('V041-CLEAR')) {
        text=systemText.includes('BOT-PRIVATE-741')&&!JSON.stringify(messages).includes('BOT-TEMP-846')?'V041-CLEAR-DONE':'V041-CLEAR-FAILED'
      } else if (input.includes('V041-ISOLATION')) {
        text=!systemText.includes('BOT-PRIVATE-741')?'V041-ISOLATION-DONE':'V041-ISOLATION-FAILED'
      } else if (input.includes('V041-SHARED')) {
        if (!toolResults.length) toolCall=call('read_shared_group_memory',{query:'V041-GROUP'})
        else text=values.join('\n').includes('V041-GROUP-DONE')?'V041-SHARED-DONE '+values.join('\n'):'V041-SHARED-FAILED '+values.join('\n')
      }
      if(toolResults.some(result=>result.isError)){toolCall=undefined;text='V041-TOOL-FAILED '+JSON.stringify(toolResults)}
    }
    if(nativeKing && input.includes('V043-SEED')) {
      if(!toolResults.length)toolCall={name:'list_existing_groups',arguments:'{}'}
      else if(toolResults.length===1){const value=JSON.parse(toolResults[0].content.find(block=>block.type==='text').text);toolCall={name:'fixture_history_rows',arguments:JSON.stringify({groupId:value.groups.find(group=>group.title.includes('共享记忆二群')).id})}}
      else text='V043-SEEDED'
    }
    if(nativeKing && input.includes('V043-RESET-RECALL')) {
      if(!toolResults.length)toolCall={name:'read_shared_group_memory',arguments:JSON.stringify({query:'V041-GROUP'})}
      else text='V043-RESET-RECALLED '+JSON.stringify(toolResults.map(result=>result.content))
    }
    if(nativeKing && input.includes('V043-RECALL')) {
      if(!toolResults.length)toolCall={name:'read_shared_group_memory',arguments:JSON.stringify({query:'V043-HISTORY-0'})}
      else text='V043-RECALLED '+JSON.stringify(toolResults.map(result=>result.content))
    }
    if (latest?.includes('V042-FILES')) {
      const path=join(process.env.DSH_HOME,'documents','deepseek-harness','default-workspace','交付 报告.bin')
      const encoded=path.split('/').map(encodeURIComponent).join('/')
      text=`V042-FILES-DONE\n\n[相对文件](./%E4%BA%A4%E4%BB%98%20%E6%8A%A5%E5%91%8A.bin) · [绝对文件](${encoded}) · [file链接](file://${encoded}) · [sandbox链接](sandbox:${encoded}) · [缺失文件](./missing-v042.bin) · [网页](https://example.com/report) · [不安全链接](javascript:alert%281%29)`
    }
    if (latest?.includes('V041-GROUP')) text='V041-GROUP-DONE 共享事实：项目编号 PROJECT-741。'
    // The host also calls the adapter to generate titles for native conversations.
    if (prompt) {
      await appendFile(join(process.env.DSH_HOME, 'fixture-model.jsonl'), JSON.stringify({ at: Date.now(), sessionId, nativeKing, nativeBot, role, speaker, input, moderator, discussion, addressed, summarizing, intentCheck,
        incompleteHistory: systemText.includes('部分历史会话暂不可读取'),
        recoveryInstructions: systemText.includes('上一条决定被拒绝') && !systemText.includes('"kind":"close"'),
        seesPreviousTask: messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('验收主持恢复'))),
        duty: systemText.match(/你的职责是：([^\n]+)/u)?.[1],
        seesGroupFact: messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('GROUP-A-ONLY-496'))),
        seesWorkspaceInstructions: messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('WORKSPACE-INSTRUCTIONS-756'))),
        calledTool: toolCall?.name, failure,
        ...(/P038-TEST-0[23]|P039-|V040-|V041-|V043-/u.test(input) ? { toolResults: toolResults.map(result => result.content), proposed: toolCall } : {}), tools: (tools ?? []).map(tool => tool.name) }) + '\n')
    }
    if (role !== 'King Arthur' && latest?.includes('P039-STREAM')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (let i = 0; i < 14; i++) { yield { type: 'text-delta', index: 0, text: `持续输出 ${i}；` }; await delay(10_000, undefined, { signal }) }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '持续输出结束' } }
      yield { type: 'finish', reason: { kind: 'stop' } }; return
    }
    if (latest?.includes('V041-GROUP')) {
      yield {type:'block-start',index:1,blockType:'reasoning'}
      yield {type:'reasoning-delta',index:1,text:'V041-THINK 模型返回的思考片段。'}
      await delay(600,undefined,{signal})
      yield {type:'reasoning-delta',index:1,text:'后续片段已保留。'}
      yield {type:'block-end',index:1,block:{type:'reasoning',text:'V041-THINK 模型返回的思考片段。后续片段已保留。'}}
    }
    await delay(duration ?? (slow ? 12_000 : 450), undefined, { signal })
    if (failure) throw new Error(failure)
    if (toolCall) {
      const block = { type: 'tool-call', id: `fixture-tool-call-${messages.filter(message => message.role === 'tool').length + 1}`, ...toolCall }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export async function apply(ctx) {
  // Session record writers must come from the running host's Session implementation.
  const hostRequire = createRequire(realpathSync(process.argv[1]))
  const { SessionId, appendPluginRecord } = await import(hostRequire.resolve('@deepseek-ai/dsh-session'))
  ctx.tools.register(defineTool({
    name:'fixture_bot_windows',description:'Inspect test-only Bot root sessions.',parameters:{},
    output:{schema:{type:'string'},render:(_,text)=>[{type:'text',text}]},
    async execute(){
      const visible=ctx.agents.list().filter(agent=>!ctx.workspaceRegistry.archivedSessionIds.includes(agent.id))
      const king=visible.find(agent=>ctx.sessionProjections.stateOf(agent.session,'dshBots').group?.mode==='king')
      const workspace=ctx.workspaceRegistry.list().find(item=>item.sessionIds.includes(king?.id))
      if(!king||!workspace||workspace.sessionIds[0]!==king.id)throw new Error('King Arthur is not first in its workspace')
      const allowed=new Set(visible.filter(agent=>['king','bot'].includes(ctx.sessionProjections.stateOf(agent.session,'dshBots').group?.mode)).map(agent=>agent.id))
      if(workspace.sessionIds.some(id=>!ctx.workspaceRegistry.archivedSessionIds.includes(id)&&!allowed.has(id)))throw new Error('Manual New Session left an extra workspace conversation')
      const pins=JSON.stringify(ctx.workspaceRegistry.pinnedSessionIds)
      await workspace.insertSessionBefore(king.id)
      for(let attempt=0;attempt<100&&workspace.sessionIds[0]!==king.id;attempt++)await delay(10)
      if(workspace.sessionIds[0]!==king.id)throw new Error('King Arthur order did not recover after manual reorder')
      if(JSON.stringify(ctx.workspaceRegistry.pinnedSessionIds)!==pins)throw new Error('Workspace ordering changed global pins')
      return JSON.stringify(visible.filter(agent=>ctx.sessionProjections.stateOf(agent.session,'dshBots').group?.mode==='bot').map(agent=>({sessionId:String(agent.id),botId:ctx.sessionProjections.stateOf(agent.session,'dshBots').group.botId,kingFirst:true})))
    }
  }))
  ctx.tools.register(defineTool({
    name:'fixture_history_rows',description:'Seed isolated history pagination fixture.',parameters:{groupId:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_,text)=>[{type:'text',text}]},
    async execute({groupId}) {
      const resolved=await ctx.sessionController.resolveAgent(SessionId(groupId))
      if('error' in resolved)throw resolved.error
      const task={...newTask('v043-old-task','V043 旧议题'),status:'paused',attempts:[{rowId:'v043-old-result',botId:'coordinator',name:'King Arthur',question:'历史汇总'}]}
      appendPluginRecord(resolved.agent.session,'plugin:dsh-bots/task',{task,active:true})
      appendPluginRecord(resolved.agent.session,'plugin:dsh-bots/rows',[{id:'v043-old-result',author:'bot',botId:'coordinator',status:'done',taskId:task.id,resultKind:'final',text:'V043-OLD-SUMMARY 历史汇总'}])
      appendPluginRecord(resolved.agent.session,'plugin:dsh-bots/rows',Array.from({length:160},(_,i)=>({id:'v043-history-'+i,author:'user',text:'V043-HISTORY-'+i+' 原始历史记录'})))
      await ctx.sessions.flush(resolved.agent.session)
      const king=ctx.agents.list().find(agent=>agent.session.header.origin!=='subagent'&&ctx.sessionProjections.stateOf(agent.session,'dshBots').group?.mode==='king')
      if(!king)throw new Error('Missing main chat for legacy-title migration fixture')
      ctx.get('sessionTitle').rename(king.session,'KingBot')
      await ctx.sessions.flush(king.session)
      return 'seeded'
    }
  }))
  ctx.tools.register(defineTool({
    name: 'fixture_seed_recovery', description: 'Isolated smoke fixture only.',
    parameters: { groupId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_, text) => [{ type: 'text', text }] },
    async execute({ groupId }) {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(groupId))
      if ('error' in resolved) throw resolved.error
      const agent = resolved.agent
      const state = ctx.sessionProjections.stateOf(agent.session, 'dshBots')
      if (!state.group || state.group.mode === 'king') throw new Error('Recovery fixture requires a group')
      for (const [index, goal] of ['立项书', '竞争工作 baseline', 'V040-RECOVERY 重新安排调研'].entries()) {
        const task = { ...newTask('v040-task-' + index, goal), status: 'paused', sourceRows: index === 2 ? ['v040-goal'] : [] }
        if (index === 2) task.operations = ['read', 'write'].map(tool => ({ id: 'v040-op-' + tool, rowId: 'v040-prior', bot: '版本助手', tool }))
        appendPluginRecord(agent.session, 'plugin:dsh-bots/task', { task, active: index === 2 })
      }
      appendPluginRecord(agent.session, 'plugin:dsh-bots/rows', [
        { id: 'v040-goal', author: 'user', text: 'V040-RECOVERY 重新安排调研' },
        { id: 'v040-proposal', author: 'bot', botId: 'coordinator', status: 'done', taskId: 'v040-task-2', resultKind: 'partial', text: '下一步我可以先把「1. 进展」成文，作为立项书开篇。要不要我现在就出这一段初稿，再按成员分工派后续章节？' },
        { id: 'v040-seeded', author: 'notice', text: 'V040-SEEDED' },
      ])
      await ctx.sessions.flush(agent.session)
      return 'V040-SEEDED'
    },
  }))
  const testWorkspace = process.env.DSH_BOTS_RECOVERY_WORKSPACE
  if (testWorkspace) await ctx.workspaceRegistry.create(testWorkspace, 'P1验收工作区')
  ctx.on('tools/pre-execute', async (execution, next) => {
    if (execution.name !== 'read') return next()
    const path = execution.arguments.file_path
    if (path === 'p038-needs-approval.txt') return { kind: 'ask', reason: 'P038 isolated approval test' }
    if (path === 'p038-explicit-timeout.txt') {
      await delay(350, undefined, { signal: execution.signal })
      return { kind: 'deny', reason: 'P038 isolated tool timeout', info: { name: 'TimeoutError', code: 'ETIMEDOUT' } }
    }
    return next()
  })
  ctx.on('tools/execute', async (execution, next) => {
    if (execution.name === 'write' && execution.arguments.file_path === 'p1-pending-write.txt') {
      const result = await next()
      // The disk side effect happens, but the host has not received a tool result.
      await delay(12_000, undefined, { signal: execution.signal })
      return result
    }
    if (execution.name !== 'read') return next()
    const path = execution.arguments.file_path
    if (path === 'p038-progress.txt') await delay(6000, undefined, { signal: execution.signal })
    if (path === 'p038-hostwait.txt') {
      // Intentional non-cooperative wrapper to verify the parent can stop waiting.
      await delay(50_000)
      await appendFile(join(process.env.DSH_HOME, 'fixture-late-tool.jsonl'),
        JSON.stringify({ path, at: Date.now(), aborted: execution.signal.aborted }) + '\n')
    }
    return next()
  })
  ctx.llm.registerAdapter(['bots-fixture'], new Fixture())
  ctx.web.registerSearchProvider({
    id: 'bots-fixture-search',
    available: () => true,
    ready: () => true,
    search: async () => ({ content: 'WEB-CANARY-391', sources: [{ url: 'https://example.com/', title: 'Fixture result' }], truncated: false }),
  })
}
