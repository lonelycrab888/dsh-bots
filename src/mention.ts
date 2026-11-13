import { availableMembers, coordinatorName, isCoordinatorName, normalizeName, type Group, type Library } from './bots.ts'

interface MentionSession { sessionId: string }
interface MentionCandidate { name: string; section: string }

export interface GroupMentionSource {
  trigger: '@'
  name: string
  order: number
  showGroupTitle: false
  candidates(session: MentionSession, request: {
    query: string; quoted?: boolean; drilled: boolean; signal: AbortSignal
  }): Promise<MentionCandidate[]>
  onPick(pick: { candidate: MentionCandidate; action: 'pick' | 'drill' }): { text: string } | undefined
}

export function groupMentionSource(
  groupOf: (sessionId: string) => Group | null | undefined,
  loadLibrary: () => Promise<Library>,
): GroupMentionSource {
  return {
    trigger: '@',
    name: 'dsh-bots-members',
    order: -100,
    showGroupTitle: false,
    async candidates({ sessionId }, { query, quoted, drilled, signal }) {
      const group = groupOf(sessionId)
      if (!group || group.mode === 'king' || group.mode === 'bot' || quoted || drilled || /[/\\]/u.test(query)) return []
      const library = await loadLibrary()
      if (signal.aborted) return []
      const members = availableMembers(group, library)
      const names = members.map(member => member.name)
      if (group.coordinator) names.unshift(names.some(isCoordinatorName) ? '主Bot' : coordinatorName)
      const needle = normalizeName(query.trim())
      return names.filter(name => normalizeName(name).includes(needle))
        .map(name => ({ name, section: '群聊成员' }))
    },
    onPick({ candidate, action }) {
      if (action === 'pick') return { text: '@' + candidate.name + ' ' }
    },
  }
}

/** Format only displayed prose. Neither stored messages nor user input use this function. */
export function botMentionFormatter(names: readonly string[]) {
  const escaped = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (!escaped) return (text: string) => text
  const mentions = new RegExp(
    String.raw`@?"(?:~|\.{1,2})?/[^"\n]+(?:"|$)|(?:https?://|file://|(?:~|\.{1,2})?/)[^\s"'<>，。！？、]+|(?<![A-Za-z0-9_@＠-])[@＠]?(?:` +
      escaped + String.raw`)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])`, 'gu',
  )
  return (text: string) => text.replace(mentions, match => match.includes('/') ? match : '@' + match.replace(/^[@＠]/u, ''))
}
