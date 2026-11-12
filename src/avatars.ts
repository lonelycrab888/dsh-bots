export const botAvatars = [
  'fish-logo-anglerfish',
  'fish-logo-betta',
  'fish-logo-clownfish',
  'fish-logo-flying-fish',
  'fish-logo-hammerhead',
  'fish-logo-koi',
  'fish-logo-leafy-seadragon',
  'fish-logo-lionfish',
  'fish-logo-longnose-butterflyfish',
  'fish-logo-manta',
  'fish-logo-moray',
  'fish-logo-ocean-sunfish',
  'fish-logo-pufferfish',
  'fish-logo-sawfish',
  'fish-logo-seahorse',
  'fish-logo-sockeye-salmon',
  'fish-logo-sturgeon',
  'fish-logo-swordfish',
  'fish-logo-turbot',
  'fish-logo-whale-shark',
] as const

export type BotAvatar = typeof botAvatars[number]

export function fillAvatars<T extends { avatar?: BotAvatar }>(bots: T[], random = Math.random): T[] {
  const unused = botAvatars.filter(avatar => !bots.some(bot => bot.avatar === avatar))
  return bots.map(bot => {
    if (bot.avatar) return bot
    const index = Math.floor(random() * (unused.length || botAvatars.length))
    const avatar = unused.length ? unused.splice(index, 1)[0] : botAvatars[index]
    return { ...bot, avatar }
  })
}
