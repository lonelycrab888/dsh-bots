import type { Library } from '../src/bots.ts'

// Explicit test data, never imported by the runtime or seeded into user profiles.
export const fixtureLibrary: Library = {
  maxMembers: 4,
  deletedBotIds: [],
  bots: [
    { id: 'architect', name: '架构师', duty: '提出方案', archived: false },
    { id: 'reviewer', name: '审阅员', duty: '审阅方案', archived: false },
  ],
}
