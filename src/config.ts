import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { defaultMemory, validateMemory, type KingMemory } from './memory.ts'
import { defaultLibrary, validateLibrary, type Library } from './bots.ts'

// One volatile value commits the catalog and limit together without remounting
// the plugin or interrupting active conversations.
export interface Config { library: Volatile<Library>; kingMemory: Volatile<KingMemory> }
// Zod validates optional routes; Schema.object would materialize a missing route.
const modelSchema = Schema.any()
export const Config = Schema.object({
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
      model: modelSchema,
      duty: Schema.string().required(), archived: Schema.boolean().default(false),
    })).default(defaultLibrary.bots),
  }).default(defaultLibrary), value => validateLibrary(value)).default(defaultLibrary).volatile(),
})
