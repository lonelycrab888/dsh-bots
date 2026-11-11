import { resetOptions } from './reset.ts'
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

export const kingRequest = z.object({
  action:z.enum(['configure','bind','list','edit','export','settings']), path:z.string().optional(),
  revision:z.number().int().optional(), query:z.string().optional(), archived:z.boolean().optional(),
  offset:z.number().int().nonnegative().optional(), entry:z.unknown().optional(),
  enabled:z.boolean().optional(), autoRemember:z.boolean().optional(),
})
const identity = { mode:'strict' as const, typeSymbol:'@deepseek-ai/dsh-session/types#SessionId', create:()=>z.string() }
const request = { mode:'strict' as const, typeSymbol:'dsh-bots#KingRequest', create:()=>kingRequest }
const resetRequest={mode:'strict' as const,typeSymbol:'dsh-bots#ResetRequest',create:()=>z.object({options:resetOptions,revision:z.number().int(),confirmation:z.literal('RESET')})}
export const KING_REMOTE = createTypertRemoteInfo({package:'dsh-bots',methods:{
  'dshBots/reset': {
    service:'dshBots',invocation:{kind:'direct'},
    parameters:[{name:'request',source:'json',codec:resetRequest,strictCodec:resetRequest}],
    result:{mode:'strict',typeSymbol:'dsh-bots#KingResult',create:()=>z.object({kind:z.enum(['success','error']),text:z.string()})},
  },
  'dshBots/manage': {
    service:'dshBots', invocation:{kind:'direct'}, scope:{context:'agent',wire:'agentId'},
    parameters:[
      {name:'agent',wire:'agentId',source:'lookup',lookup:'agent',codec:identity,strictCodec:identity},
      {name:'request',source:'json',codec:request,strictCodec:request},
    ],
    result:{mode:'strict',typeSymbol:'dsh-bots#KingResult',create:()=>z.object({kind:z.enum(['success','error']),text:z.string()})},
  },
}},z)
