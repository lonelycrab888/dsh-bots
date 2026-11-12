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
      if (!group || group.mode === 'king' || quoted || drilled || /[/\\]/u.test(query)) return []
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
