import type { Row } from './bots.ts'
export const reasoningPreviewLimit = 32_768
export const reasoningNotice = '\n\n[思考内容较长，群聊仅展示前 32768 字符；完整过程保留在成员原生会话记录中。]'
export function reasoningPreview(text: string) {
  return text.length > reasoningPreviewLimit ? text.slice(0, reasoningPreviewLimit) + reasoningNotice : text
}

// Session records must be lossless JSON; omit redundant fields rather than
// assigning undefined, which the host rejects before committing the update.
export function rowUpdate(row: Row, previous: Row | undefined, now = Date.now()): Row {
  const update = { ...row, at: previous?.at ?? row.at ?? now }
  if (update.author === 'bot' && previous?.author === 'bot' &&
      (update.reasoning === undefined || update.reasoning === previous.reasoning)) delete update.reasoning
  return update
}
