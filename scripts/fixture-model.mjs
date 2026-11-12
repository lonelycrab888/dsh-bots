// For the isolated browser smoke only. Logs routing and returns deterministic text.
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const inject = ['llm']

class Fixture extends LlmAdapter {
  async listModels() { return [{ id: 'fixture', name: 'Bots fixture' }] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }

  async *stream({ messages, tools, signal }) {
    const system = messages.find(message => message.role === 'system')
    const prompt = messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const systemText = system?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    const speaker = systemText.match(/你是群聊中的「([^」]+)」/u)?.[1] ?? '默认'
    const role = speaker === 'Bots King' ? 'KingBot' : speaker
    const input = prompt?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    const moderator = systemText.includes('你是本场群聊的主持人')
    const discussion = systemText.includes('你正在参加 KingBot 主持的讨论')
    const latest = input && role !== '默认' ? JSON.parse(input).最新用户消息 : undefined
    let slow = false
    let documentCall = false
    let text = `${role} | ${input.includes('架构说明') ? '看到了架构说明' : '已收到'}`
    if (role === 'KingBot') {
      if (moderator) {
        const state = JSON.parse(latest)
        const last = state.已有讨论.at(-1)
        const member = state.本轮可发言.at(-1)
        text = JSON.stringify(state.允许收束 && state.已有讨论.length >= 3
          ? { kind: 'close' }
          : { kind: 'speak', botId: member.id, question: last ? `请回应 ${last.name} 的“${last.text}”` : '先提出一个可检验的建议' })
        if (state.议题.includes('验收主持恢复') && state.已有讨论.length <= 1) {
          const retry = state.上次决定被拒绝 !== undefined
          if (!retry) text = '{"kind":"close"}'
          else if (last) text = '我会请其他成员继续讨论。'
        }
        if (state.议题.includes('验收插话后只核对核心证据')) {
          text = state.上次决定被拒绝 ? '我现在可以请审阅员发言。' : '{"kind":"close"}'
        }
      } else if (systemText.includes('请总结你主持的讨论')) {
        text = 'KingBot | 讨论汇总完成'
      } else if (systemText.includes('这是你与用户的专属对话') && /方案\/流程助手|资料核对助手/.test(latest)) {
        const evidence = latest.replace(/^原始请求：/, '').split('\n上次回复校验失败：')[0]
        const names = evidence.includes('方案/流程助手') ? ['方案/流程助手', '记录助手'] : ['资料核对助手']
        text = JSON.stringify({ tasks: [], botActions: names.map(name => ({
          name,
          evidence,
          duty: name === '资料核对助手' && !latest.includes('上次回复校验失败：') ? '' : '整理并核对合成验收资料',
        })) })
      } else if (systemText.includes('这是你与用户的专属对话') && /完成离线清单方案|新建空白验收群聊/.test(latest)) {
        const available = JSON.parse(systemText.match(/可用成员：(\[.*?\])。普通工作区：/su)[1])
        const runTask = latest.includes('完成离线清单方案')
        text = JSON.stringify({ tasks: [], groupAction: {
          title: runTask ? '清单设计讨论' : '空白验收群',
          topic: runTask ? '完成离线清单方案，比较同步与纯本地方案' : '仅创建群聊',
          memberIds: [available.find(member => member.name === '架构师').id],
          newBots: runTask ? [{ name: '离线方案审阅员', duty: '专门复核离线存储取舍' }] : [],
          runTask,
          evidence: latest,
        } })
      } else if (systemText.includes('你现在负责规划')) {
        const members = JSON.parse(systemText.match(/只能向下列成员派发任务：(\[.*?\])。/su)[1])
        const required = JSON.parse(systemText.match(/用户点名的成员ID：(\[.*?\])。/su)[1])
        text = JSON.stringify({ tasks: members.filter(member => !required.length || required.includes(member.id)).map(member => ({ botId: member.id, task: '处理用户请求：' + latest })) })
      } else text = 'KingBot | 汇总完成'
    } else if (discussion) {
      const state = JSON.parse(latest)
      const last = state.已有讨论.at(-1)
      slow = role === '架构师' && state.议题.includes('验收实时插话原议题')
      text = last ? `${role} | 回应 ${last.name}` : `${role} | 初步观点`
      if (state.议题.includes('验收读取拖入文档')) {
        const result = messages.findLast(message => message.role === 'tool')
        if (result) {
          const read = result.content.some(block => block.type === 'text' && block.text.includes('DOCUMENT-CANARY-617'))
          text = read
            ? '## 文档要点\n\n- **已读取** 上传的原文\n\n| 项目 | 值 |\n| --- | --- |\n| 验收编号 | DOCUMENT-CANARY-617 |'
            : '文档读取失败'
        } else {
          documentCall = tools.some(tool => tool.name === 'read_uploaded_document')
        }
      }
    }
    // The host also calls the adapter to generate titles for native conversations.
    if (prompt) {
      await appendFile(join(process.env.DSH_HOME, 'fixture-model.jsonl'), JSON.stringify({ role, speaker, input, moderator, discussion,
        recoveryInstructions: systemText.includes('上一条决定被拒绝') && !systemText.includes('"kind":"close"'),
        seesPreviousTask: messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('验收主持恢复'))),
        tools: (tools ?? []).map(tool => tool.name) }) + '\n')
    }
    await delay(slow ? 12_000 : 450, undefined, { signal })
    if (documentCall) {
      const block = { type: 'tool-call', id: 'fixture-document-1', name: 'read_uploaded_document', arguments: '{"number":1}' }
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

export function apply(ctx) {
  ctx.llm.registerAdapter(['bots-fixture'], new Fixture())
}
