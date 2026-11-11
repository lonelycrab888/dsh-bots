export interface InsertionActions { captureInsertion(): unknown; insertText(text: string, span: unknown): boolean }
export interface CurrentInput {
  focus(): void
  setDraft(text: string): void
  notify(level: 'info' | 'error', text: string): void
  state: { getSnapshot(): { draft: string; phase: string } }
}
/** An initial conversation can replace its composer when the first turn ends.
 * Recover a refused insertion into an empty current editor without replacing
 * a user's text or reference chips in a nonempty draft. */
export function insertMention(name: string, actions: InsertionActions, current: CurrentInput): void {
  const text = ` @${name} `
  if (actions.insertText(text, actions.captureInsertion())) {
    current.focus()
    return
  }
  const snapshot = current.state.getSnapshot()
  if (snapshot.draft === '' && snapshot.phase === 'plain') {
    current.setDraft(text)
    current.focus()
  } else {
    current.focus()
    current.notify('info', `请在输入框中输入 @${name}；当前草稿已保留。`)
  }
}
