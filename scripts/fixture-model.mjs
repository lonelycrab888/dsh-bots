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
    const review = systemText.includes('你正在参与群聊互评')
    let text = `${role} | ${input.includes('架构说明') ? '看到了架构说明' : '已收到'}`
    if (role === 'KingBot') {
      if (systemText.includes('你现在负责规划')) {
        const members = JSON.parse(systemText.match(/只能向下列成员派发任务：(\[.*?\])。/su)[1])
        const required = JSON.parse(systemText.match(/用户点名的成员ID：(\[.*?\])。/su)[1])
        const latest = JSON.parse(input).最新用户消息
        text = JSON.stringify({ tasks: members.filter(member => !required.length || required.includes(member.id)).map(member => ({ botId: member.id, task: '处理用户请求：' + latest })) })
      } else text = systemText.includes('结合初答与实际发生的互评') ? 'KingBot | 讨论汇总完成' : 'KingBot | 汇总完成'
    } else if (review) {
      const other = role === '架构师' ? '审阅员' : '架构师'
      text = `${role} | 点评 ${other}`
    }
    // The host also calls the adapter to generate titles for native conversations.
    if (prompt) {
      await appendFile(join(process.env.DSH_HOME, 'fixture-model.jsonl'), JSON.stringify({ role, speaker, input, review, tools: (tools ?? []).map(tool => tool.name) }) + '\n')
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
