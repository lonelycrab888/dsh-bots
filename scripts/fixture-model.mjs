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
    let text = `${role} | ${input.includes('架构说明') ? '看到了架构说明' : '已收到'}`
    if (role === 'KingBot') {
      if (moderator) {
        const state = JSON.parse(latest)
        const last = state.已有讨论.at(-1)
        const member = state.本轮可发言.at(-1)
        text = JSON.stringify(state.允许收束 && state.已有讨论.length >= 3
          ? { kind: 'close' }
          : { kind: 'speak', botId: member.id, question: last ? `请回应 ${last.name} 的“${last.text}”` : '先提出一个可检验的建议' })
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
      const last = JSON.parse(latest).已有讨论.at(-1)
      text = last ? `${role} | 回应 ${last.name}` : `${role} | 初步观点`
    }
    // The host also calls the adapter to generate titles for native conversations.
    if (prompt) {
      await appendFile(join(process.env.DSH_HOME, 'fixture-model.jsonl'), JSON.stringify({ role, speaker, input, moderator, discussion, tools: (tools ?? []).map(tool => tool.name) }) + '\n')
    }
    await delay(450, undefined, { signal })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export function apply(ctx) {
  ctx.llm.registerAdapter(['bots-fixture'], new Fixture())
}
