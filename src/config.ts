import { defaultRunLimits, type RunLimits } from './member-runtime.ts'
import type { PendingReset } from './reset.ts'
import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { defaultMemory, validateMemory, type KingMemory } from './memory.ts'
import { defaultLibrary, validateLibrary, type Library } from './bots.ts'

// One volatile value commits the catalog and limit together without remounting
// the plugin or interrupting active conversations.
export interface KingWorkspace { path: string; sessionId: string; legacyImported?: boolean }
export interface BotConversation { sessionId:string; path:string; epoch:number; previousSessionId?:string }
export interface Config { botConversations: Volatile<Record<string,BotConversation>>; memberLimits: RunLimits; resetEpoch:Volatile<number>; sessionEpoch:Volatile<number>; resetPending:Volatile<PendingReset|null>; kingWorkspace: Volatile<KingWorkspace | null>; library: Volatile<Library>; kingMemory: Volatile<KingMemory> }
// Zod validates optional routes; Schema.object would materialize a missing route.
const modelSchema = Schema.any()
export const Config = Schema.object({
  botConversations: Schema.any().default({}).volatile(),
  memberLimits: Schema.object({
    firstToken: Schema.number().min(1000).max(600000).default(defaultRunLimits.firstToken),
    modelQuiet: Schema.number().min(1000).max(600000).default(defaultRunLimits.modelQuiet),
    hostQuiet: Schema.number().min(1000).max(600000).default(defaultRunLimits.hostQuiet),
    childTotal: Schema.number().min(0).max(1800000).default(defaultRunLimits.childTotal),
  }).default(defaultRunLimits),
  resetEpoch:Schema.number().step(1).min(0).default(0).volatile(),
  sessionEpoch:Schema.number().step(1).min(0).default(0).volatile(),
  resetPending:Schema.any().default(null).volatile(),
  kingWorkspace: Schema.any().default(null).volatile(),
  kingMemory: Schema.transform(Schema.object({
    enabled: Schema.boolean().default(true),
    autoRemember: Schema.boolean().default(true),
    entries: Schema.array(Schema.object({
      id: Schema.string().required(), text: Schema.string().required(),
      source: Schema.union(['manual', 'conversation']).required(),
      sourceSession: Schema.string(), evidence: Schema.string(),
      updatedAt: Schema.string().required(), archived: Schema.boolean().default(false),
    })).default([]),
  }).default(defaultMemory), value => validateMemory(value)).default(defaultMemory).volatile(),
  library: Schema.transform(Schema.object({
    kingModel: modelSchema,
    deletedBotIds: Schema.array(Schema.string()).default([]),
    maxMembers: Schema.number().step(1).min(1).max(12).default(4),
    bots: Schema.array(Schema.object({
      id: Schema.string().required(), name: Schema.string().required(),
      model: modelSchema, avatar: Schema.string(),
      duty: Schema.string().required(), archived: Schema.boolean().default(false),
    })).default(defaultLibrary.bots),
  }).default(defaultLibrary), value => validateLibrary(value)).default(defaultLibrary).volatile(),
})
