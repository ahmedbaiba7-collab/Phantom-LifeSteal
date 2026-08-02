import type { PrismaClient } from '@prisma/client';

/**
 * The rank ladder and the coin shop.
 *
 * Split out of seed.ts because this is the part staff will actually edit —
 * prices change, items get added, and nobody should have to read the auth
 * bootstrap to find where the shop lives.
 *
 * Prices: `price` is real money in minor units (cents). `coinPrice` is whole
 * coins. A product with both is buyable either way; a product with only one is
 * exclusive to that shop.
 *
 * Nothing here grants combat advantage. Every command below is cosmetic,
 * convenience, or a tradeable item obtainable in game — that constraint is the
 * point of a LifeSteal server, not a marketing line.
 */

export const RANKS = [
  {
    slug: 'knight',
    name: 'Knight',
    tier: 1,
    price: 499,
    imageUrl: '/ranks/knight.png',
    roleKey: 'knight',
    description: 'The first step off the ground. Coloured chat, a second home, and a place to keep things.',
    features: [
      'Gold [KNIGHT] tag in chat and tab',
      '2 sethomes (up from 1)',
      '/kit knight every 24 hours',
      '9-slot personal vault',
      'Coloured chat with & codes',
      '+10% coins from voting',
    ],
    commands: ['/kit knight', '/sethome', '/pv 1', '/hat'],
    permissions: ['phantom.rank.knight', 'essentials.kit.knight', 'essentials.sethome.multiple.knight'],
  },
  {
    slug: 'lord',
    name: 'Lord',
    tier: 2,
    price: 999,
    imageUrl: '/ranks/lord.png',
    roleKey: 'lord',
    description: 'For players who have settled in. More storage, faster travel, a nickname of your own.',
    features: [
      'Green [LORD] tag in chat and tab',
      '4 sethomes',
      '/kit lord every 24 hours',
      'Two 27-slot vaults',
      '/nick — set your own display name',
      '/craft — portable crafting table',
      '+25% coins from voting',
    ],
    commands: ['/kit lord', '/nick', '/craft', '/pv 1-2', '/hat', '/near'],
    permissions: ['phantom.rank.lord', 'essentials.kit.lord', 'essentials.nick', 'essentials.craft'],
  },
  {
    slug: 'paladin',
    name: 'Paladin',
    tier: 3,
    price: 1999,
    imageUrl: '/ranks/paladin.png',
    roleKey: 'paladin',
    featured: true,
    description: 'The rank most people stop at. Everything you actually use, without the extravagance above it.',
    features: [
      'Cyan [PALADIN] tag in chat and tab',
      '6 sethomes',
      '/kit paladin every 24 hours',
      'Four 54-slot vaults',
      '/ec — portable ender chest',
      '/feed once an hour',
      'Join a full server past the player cap',
      '+50% coins from voting',
    ],
    commands: ['/kit paladin', '/ec', '/feed', '/pv 1-4', '/nick', '/craft', '/hat'],
    permissions: [
      'phantom.rank.paladin',
      'essentials.kit.paladin',
      'essentials.enderchest',
      'essentials.feed',
      'phantom.joinfull',
    ],
  },
  {
    slug: 'duke',
    name: 'Duke',
    tier: 4,
    price: 3499,
    imageUrl: '/ranks/duke.png',
    roleKey: 'duke',
    description: 'Cosmetics, particles, and the convenience commands that save real time each session.',
    features: [
      'Red [DUKE] tag in chat and tab',
      '10 sethomes',
      '/kit duke every 24 hours',
      'Six 54-slot vaults',
      'Particle trails and pets',
      '/back after a death',
      'Two extra auction house slots',
      '+75% coins from voting',
    ],
    commands: ['/kit duke', '/back', '/pv 1-6', '/particles', '/pet', '/ec', '/feed', '/nick'],
    permissions: [
      'phantom.rank.duke',
      'essentials.kit.duke',
      'essentials.back',
      'phantom.cosmetics.particles',
      'phantom.cosmetics.pets',
    ],
  },
  {
    slug: 'king',
    name: 'King',
    tier: 5,
    price: 5999,
    imageUrl: '/ranks/king.png',
    roleKey: 'king',
    description: 'The top of the ladder. Everything below it, plus the cosmetics reserved for this tier alone.',
    features: [
      'Animated gold [KING] tag in chat and tab',
      'Unlimited sethomes',
      '/kit king every 12 hours',
      'Ten 54-slot vaults',
      'Exclusive King cosmetics and crown',
      'Custom join message',
      'Priority in the support queue',
      'Double coins from voting',
    ],
    commands: ['/kit king', '/back', '/pv 1-10', '/particles', '/pet', '/crown', '/ec', '/feed', '/nick'],
    permissions: [
      'phantom.rank.king',
      'essentials.kit.king',
      'essentials.sethome.multiple.unlimited',
      'phantom.cosmetics.*',
      'phantom.support.priority',
    ],
  },
] as const;

/** Coin shop. Category strings drive the filter chips on /shop. */
export const COIN_ITEMS = [
  // ── Crate keys ──────────────────────────────────────────────────────────
  { slug: 'key-common', name: 'Common Key', category: 'Keys', type: 'KEY', coinPrice: 250,
    description: 'One roll on the Common crate. Consumables, coins, and the occasional cosmetic.',
    commands: ['crate key give %player% common 1'] },
  { slug: 'key-rare', name: 'Rare Key', category: 'Keys', type: 'KEY', coinPrice: 750, featured: true,
    description: 'One roll on the Rare crate. Better odds on cosmetics and tradeable items.',
    commands: ['crate key give %player% rare 1'] },
  { slug: 'key-phantom', name: 'Phantom Key', category: 'Keys', type: 'KEY', coinPrice: 2500,
    description: 'One roll on the Phantom crate. The only source of the seasonal cosmetic set.',
    commands: ['crate key give %player% phantom 1'] },

  // ── Commands ────────────────────────────────────────────────────────────
  { slug: 'cmd-craft-week', name: 'Portable Crafting (7 days)', category: 'Commands', type: 'COMMAND', coinPrice: 400,
    description: '/craft anywhere for a week. Stacks with a rank that already has it.',
    durationDays: 7, commands: ['lp user %player% permission settemp essentials.craft true 7d'] },
  { slug: 'cmd-ec-week', name: 'Portable Ender Chest (7 days)', category: 'Commands', type: 'COMMAND', coinPrice: 600,
    description: '/ec anywhere for a week.',
    durationDays: 7, commands: ['lp user %player% permission settemp essentials.enderchest true 7d'] },
  { slug: 'cmd-sethome-extra', name: 'Extra Sethome (permanent)', category: 'Commands', type: 'COMMAND', coinPrice: 1200,
    description: 'One more home slot, permanently. Buy it as many times as you like.',
    commands: ['phantom homes add %player% 1'] },

  // ── Titles ──────────────────────────────────────────────────────────────
  { slug: 'title-heartless', name: 'Title: Heartless', category: 'Titles', type: 'TITLE', coinPrice: 900,
    description: 'Displayed before your name in chat. Unlocked permanently once bought.',
    commands: ['phantom title unlock %player% heartless'] },
  { slug: 'title-undying', name: 'Title: Undying', category: 'Titles', type: 'TITLE', coinPrice: 900,
    description: 'For players who have never dropped below five hearts. Buying it does not check.',
    commands: ['phantom title unlock %player% undying'] },
  { slug: 'title-collector', name: 'Title: Collector', category: 'Titles', type: 'TITLE', coinPrice: 1400,
    description: 'A quieter one. Fits players who trade more than they fight.',
    commands: ['phantom title unlock %player% collector'] },

  // ── Tags ────────────────────────────────────────────────────────────────
  { slug: 'tag-void', name: 'Tag: [VOID]', category: 'Tags', type: 'TAG', coinPrice: 700,
    description: 'A bracket tag shown after your username.',
    commands: ['phantom tag unlock %player% void'] },
  { slug: 'tag-phantom', name: 'Tag: [PHANTOM]', category: 'Tags', type: 'TAG', coinPrice: 1800, featured: true,
    description: 'The server tag. Limited to 200 players per season.', stock: 200,
    commands: ['phantom tag unlock %player% phantom'] },

  // ── Particles ───────────────────────────────────────────────────────────
  { slug: 'particle-soul', name: 'Soul Trail', category: 'Particles', type: 'PARTICLE', coinPrice: 1100,
    description: 'A trail of soul flame behind you as you walk.',
    commands: ['phantom cosmetic unlock %player% particle_soul'] },
  { slug: 'particle-heart', name: 'Heart Trail', category: 'Particles', type: 'PARTICLE', coinPrice: 1600,
    description: 'Drifting hearts. Purely cosmetic — it does not signal how many you hold.',
    commands: ['phantom cosmetic unlock %player% particle_heart'] },

  // ── Nicknames ───────────────────────────────────────────────────────────
  { slug: 'nick-30d', name: 'Nickname (30 days)', category: 'Nicknames', type: 'NICKNAME', coinPrice: 1500,
    description: 'Set your own display name for a month. Impersonating another player gets it revoked.',
    durationDays: 30, commands: ['lp user %player% permission settemp essentials.nick true 30d'] },
  { slug: 'nick-color', name: 'Coloured Nickname (30 days)', category: 'Nicknames', type: 'NICKNAME', coinPrice: 2200,
    description: 'Colour codes in your nickname for a month.',
    durationDays: 30, commands: ['lp user %player% permission settemp essentials.nick.color true 30d'] },

  // ── Boosters ────────────────────────────────────────────────────────────
  { slug: 'boost-coins-2x', name: '2× Coin Booster (1 hour)', category: 'Boosters', type: 'BOOSTER', coinPrice: 800,
    description: 'Double coins from in-game earning for an hour. Personal, not server-wide.',
    commands: ['phantom booster give %player% coins 2 3600'] },
  { slug: 'boost-xp-2x', name: '2× XP Booster (1 hour)', category: 'Boosters', type: 'BOOSTER', coinPrice: 800,
    description: 'Double vanilla experience for an hour.',
    commands: ['phantom booster give %player% xp 2 3600'] },
  { slug: 'boost-server-coins', name: 'Server-wide Coin Hour', category: 'Boosters', type: 'BOOSTER', coinPrice: 6000,
    description: 'Double coins for everyone online for an hour, announced with your name.',
    commands: ['phantom booster server coins 2 3600 %player%'] },

  // ── Items ───────────────────────────────────────────────────────────────
  { slug: 'item-revive-beacon', name: 'Revive Beacon', category: 'Items', type: 'ITEM', coinPrice: 4500,
    description: 'Brings one eliminated player back before their 24 hours are up. Tradeable.',
    commands: ['phantom item give %player% revive_beacon 1'] },
  { slug: 'item-heart-shard', name: 'Heart Shard ×4', category: 'Items', type: 'ITEM', coinPrice: 3000,
    description: 'Four shards. Nine make one heart at the forge — the same rate as earning them.',
    commands: ['phantom item give %player% heart_shard 4'] },
] as const;

export async function seedCatalogue(prisma: PrismaClient): Promise<void> {
  // Rank products grant a role; resolve the keys to ids once up front so a
  // renamed role fails loudly here rather than silently selling nothing.
  const roles = await prisma.role.findMany({ select: { id: true, key: true } });
  const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));

  for (const rank of RANKS) {
    const grantRoleId = roleIdByKey.get(rank.roleKey);
    if (!grantRoleId) {
      throw new Error(`Rank product "${rank.slug}" references missing role "${rank.roleKey}".`);
    }

    await prisma.product.upsert({
      where: { slug: rank.slug },
      update: {
        name: rank.name,
        description: rank.description,
        price: rank.price,
        imageUrl: rank.imageUrl,
        tier: rank.tier,
        features: [...rank.features],
        commands: [...rank.commands],
        permissions: [...rank.permissions],
        featured: 'featured' in rank ? rank.featured : false,
        active: true,
      },
      create: {
        slug: rank.slug,
        name: rank.name,
        description: rank.description,
        type: 'RANK',
        category: 'Ranks',
        price: rank.price,
        imageUrl: rank.imageUrl,
        tier: rank.tier,
        sortOrder: rank.tier,
        features: [...rank.features],
        commands: [...rank.commands],
        permissions: [...rank.permissions],
        featured: 'featured' in rank ? rank.featured : false,
        grantRoleId,
        active: true,
      },
    });
  }

  for (const [index, item] of COIN_ITEMS.entries()) {
    await prisma.product.upsert({
      where: { slug: item.slug },
      update: {
        name: item.name,
        description: item.description,
        coinPrice: item.coinPrice,
        category: item.category,
        commands: [...item.commands],
        featured: 'featured' in item ? item.featured : false,
        active: true,
      },
      create: {
        slug: item.slug,
        name: item.name,
        description: item.description,
        type: item.type,
        category: item.category,
        price: 0,
        coinPrice: item.coinPrice,
        sortOrder: index,
        durationDays: 'durationDays' in item ? item.durationDays : null,
        stock: 'stock' in item ? item.stock : null,
        commands: [...item.commands],
        featured: 'featured' in item ? item.featured : false,
        active: true,
      },
    });
  }
}
