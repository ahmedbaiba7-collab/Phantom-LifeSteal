/**
 * Seeds the roles, permissions, catalogue and content the site needs to run.
 * Safe to re-run: everything is an upsert.
 *
 *   npm run seed
 *
 * The owner account is created from OWNER_EMAIL / OWNER_PASSWORD if both are
 * present in the environment. It is never hard-coded — a seeded default
 * password is a backdoor with a friendly name.
 */
import { COIN_ITEMS, seedCatalogue } from './seed-catalogue';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '../src/config/permissions';
import { hashPassword, generateToken, hashToken } from '../src/lib/crypto';

const prisma = new PrismaClient();

async function seedRoles() {
  for (const role of DEFAULT_ROLES) {
    const record = await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        color: role.color,
        weight: role.weight,
        isStaff: role.isStaff,
        isDefault: role.isDefault,
        isPurchasable: role.isPurchasable,
      },
      update: { name: role.name, color: role.color, weight: role.weight, isStaff: role.isStaff },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: record.id } });
    if (role.permissions.length) {
      await prisma.rolePermission.createMany({
        data: role.permissions.map((permission) => ({ roleId: record.id, permission })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`✓ ${DEFAULT_ROLES.length} roles`);
}

async function seedOwner() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) {
    console.log('· owner skipped (set OWNER_EMAIL and OWNER_PASSWORD to create one)');
    return;
  }
  if (password.length < 12) {
    throw new Error('OWNER_PASSWORD must be at least 12 characters.');
  }

  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'owner' } });

  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      username: process.env.OWNER_USERNAME ?? 'Owner',
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    },
    update: {},
    select: { id: true, username: true },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: ownerRole.id } },
    create: { userId: user.id, roleId: ownerRole.id },
    update: {},
  });

  console.log(`✓ owner account: ${user.username}`);
}

async function seedApiKey() {
  const existing = await prisma.apiKey.findFirst({ where: { name: 'in-game plugin', revokedAt: null } });
  if (existing) {
    console.log('· plugin API key already exists');
    return;
  }

  const key = `lsp_${generateToken(24)}`;
  await prisma.apiKey.create({
    data: {
      name: 'in-game plugin',
      keyHash: hashToken(key),
      prefix: key.slice(0, 12),
      scopes: ['integration'],
    },
  });

  console.log('\n  ┌─────────────────────────────────────────────────────────');
  console.log('  │ PLUGIN API KEY — shown once, store it in the plugin config');
  console.log(`  │ ${key}`);
  console.log('  └─────────────────────────────────────────────────────────\n');
}

async function seedStore() {
  // Real-money products that are not ranks: coin packs and bundles. The rank
  // ladder and the whole coin shop live in seed-catalogue.ts, which is the
  // file staff will actually edit.
  const products = [
    { slug: 'coins-1000',  name: '1,000 Coins',  type: 'COINS' as const,  price: 199,  description: 'One thousand coins, spendable in the coin shop and at player shops.', grantCoins: 1000,  sortOrder: 20 },
    { slug: 'coins-3000',  name: '3,000 Coins',  type: 'COINS' as const,  price: 499,  description: 'Three thousand coins — about 20% more per coin than the small pack.', grantCoins: 3000,  sortOrder: 21, featured: true },
    { slug: 'coins-8000',  name: '8,000 Coins',  type: 'COINS' as const,  price: 1199, description: 'Eight thousand coins. The best rate available.', grantCoins: 8000,  sortOrder: 22 },
    { slug: 'coins-20000', name: '20,000 Coins', type: 'COINS' as const,  price: 2799, description: 'Twenty thousand coins, for players who would rather buy once a season.', grantCoins: 20000, sortOrder: 23 },
    {
      slug: 'bundle-starter',
      name: 'Starter Bundle',
      type: 'BUNDLE' as const,
      price: 899,
      salePrice: 699,
      description: 'Knight for 30 days, three Rare keys and 2,000 coins.',
      sortOrder: 30,
      featured: true,
      commands: ['lp user %player% parent addtemp knight 30d', 'crate key give %player% rare 3'],
    },
  ];

  for (const [index, p] of products.entries()) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        type: p.type,
        category: p.type === 'COINS' ? 'Coins' : 'Bundles',
        price: p.price,
        salePrice: 'salePrice' in p ? p.salePrice : null,
        grantCoins: 'grantCoins' in p ? (p.grantCoins ?? null) : null,
        commands: 'commands' in p ? (p.commands ?? []) : [],
        featured: 'featured' in p ? Boolean(p.featured) : false,
        sortOrder: p.sortOrder ?? index,
      },
      update: { name: p.name, description: p.description, price: p.price },
    });
  }

  await seedCatalogue(prisma);
  console.log(`✓ ${products.length} coin packs, 5 ranks, ${COIN_ITEMS.length} coin-shop items`);
}

async function seedVoteSites() {
  const sites = [
    { key: 'planet-minecraft', name: 'Planet Minecraft', url: 'https://www.planetminecraft.com/server/lifesteal-phantom/vote/', rewardCoins: 150, sortOrder: 1 },
    { key: 'minecraft-mp', name: 'Minecraft-MP', url: 'https://minecraft-mp.com/server/lifesteal-phantom/vote/', rewardCoins: 150, sortOrder: 2 },
    { key: 'minecraft-server-list', name: 'Minecraft Server List', url: 'https://minecraft-server-list.com/server/lifesteal-phantom/vote/', rewardCoins: 150, sortOrder: 3 },
    { key: 'topg', name: 'TopG', url: 'https://topg.org/minecraft-servers/server-lifesteal-phantom/vote', rewardCoins: 150, sortOrder: 4 },
  ];

  for (const site of sites) {
    await prisma.voteSite.upsert({ where: { key: site.key }, create: site, update: site });
  }

  const rewards = [
    { streakDay: 3, coins: 500, description: 'Three days in a row: 500 coins and a Phantom key.', commands: ['crate key give {player} phantom 1'] },
    { streakDay: 7, coins: 1500, description: 'A full week: 1,500 coins and three Phantom keys.', commands: ['crate key give {player} phantom 3'] },
    { streakDay: 30, coins: 8000, description: 'Thirty days: 8,000 coins, a Legend key and a permanent heart.', commands: ['crate key give {player} legend 1', 'lifesteal hearts add {player} 1'] },
  ];

  for (const reward of rewards) {
    await prisma.voteReward.upsert({
      where: { streakDay: reward.streakDay },
      create: reward,
      update: reward,
    });
  }
  console.log(`✓ ${sites.length} vote sites, ${rewards.length} streak rewards`);
}

async function seedWiki() {
  const categories = [
    {
      slug: 'getting-started', name: 'Getting started', icon: 'compass', sortOrder: 1,
      articles: [
        { slug: 'how-lifesteal-works', title: 'How LifeSteal works', summary: 'Kill a player, take a heart. Die, and you lose one. Everything else follows from that.', body: 'Every player starts with 10 hearts.\n\nWhen you kill another player you take one of their hearts permanently — your maximum goes up by one, theirs goes down by one. Die, and the reverse happens.\n\nAt zero hearts you are eliminated and locked out for 24 hours, or until someone spends a Revive Beacon on you. The cap is 20 hearts; past that, kills award heart shards instead, which trade for gear at spawn.\n\nHearts are the only thing on this server that cannot be bought, farmed or reset. They are earned from other players and only from other players.' },
        { slug: 'first-hour', title: 'Your first hour', summary: 'Where to go, what to build, and how not to lose a heart before you have swung a sword.', body: 'Spawn is a safe zone. Nothing you do inside the barrier can cost you a heart.\n\nWalk at least 1,000 blocks before you place a single block. New bases near spawn are found within the day, without exception.\n\nBuild down, not up. A visible base is a raided base. Your first shelter should be a hole you can seal behind you.\n\nDo not carry your netherite. Combat logging is disabled and there is no grace period — anything on your body is on the ground the moment you lose.' },
      ],
    },
    {
      slug: 'rules', name: 'Rules', icon: 'shield', sortOrder: 2,
      articles: [
        { slug: 'server-rules', title: 'Server rules', summary: 'Short list, enforced consistently.', body: 'No hacked clients. X-ray, kill aura, reach, auto-clicker and macro mining are all bans on first offence.\n\nNo lag machines or intentional server damage.\n\nNo alt accounts for heart farming. Feeding hearts between your own accounts voids every heart involved and bans the lot.\n\nNo slurs, harassment or doxxing. This applies in game, on Discord and on this site.\n\nNo real-money trading outside the store.\n\nScamming in trades is allowed. Betrayal is allowed. Griefing is allowed. This is a LifeSteal server — read the first three rules again and behave accordingly with the rest.' },
      ],
    },
    {
      slug: 'guides', name: 'Guides', icon: 'book', sortOrder: 3,
      articles: [
        { slug: 'pvp-guide', title: 'PvP guide', summary: 'Crystal, sword and bow fundamentals, and what actually wins fights here.', body: 'Most fights on this server are decided before either player swings.\n\nBring a totem. Bring two. A player without a totem is a player who is donating a heart.\n\nEnd crystals do the heavy lifting in open terrain; a hard ceiling turns them into a liability. Fight indoors when you are outnumbered.\n\nLearn the shield-axe trade. Disabling a shield is worth more than any enchantment on your sword.\n\nRun. There is no honour rating. A fight you decline costs nothing; a fight you lose costs a heart you may not get back.' },
        { slug: 'economy', title: 'Economy', summary: 'Coins, the auction house, and how prices actually move.', body: 'Coins come from voting, selling to player shops and the occasional crate.\n\nThe auction house at spawn takes a 5% cut. Player shops take none, which is why the good deals are always outside the barrier and always a little dangerous to reach.\n\nHeart shards are the real currency. Coins buy gear; shards buy survival.\n\nPrices spike after every heart wipe event. If you are holding shards going into one, sell first.' },
      ],
    },
  ];

  for (const cat of categories) {
    const record = await prisma.wikiCategory.upsert({
      where: { slug: cat.slug },
      create: { slug: cat.slug, name: cat.name, icon: cat.icon, sortOrder: cat.sortOrder },
      update: { name: cat.name, sortOrder: cat.sortOrder },
    });

    for (const [i, a] of cat.articles.entries()) {
      await prisma.wikiArticle.upsert({
        where: { slug: a.slug },
        create: { ...a, categoryId: record.id, sortOrder: i, keywords: [] },
        update: { title: a.title, summary: a.summary, body: a.body },
      });
    }
  }
  console.log(`✓ ${categories.length} wiki categories`);
}

async function seedFaq() {
  const faqs = [
    { question: 'What is the server IP?', answer: 'play.lifestealphantom.com — Java Edition 1.21 and above. Bedrock players connect on port 19132.', category: 'general', sortOrder: 1 },
    { question: 'Do I need to buy a rank to be competitive?', answer: 'No. Ranks give cosmetics, convenience commands and extra homes. Hearts, gear and land cannot be purchased at any price.', category: 'store', sortOrder: 2 },
    { question: 'I lost all my hearts. Am I banned?', answer: 'No — you are locked out for 24 hours. A teammate can bring you back sooner with a Revive Beacon, which drops from the Phantom crate and is tradeable.', category: 'gameplay', sortOrder: 3 },
    { question: 'How long do purchases take to arrive?', answer: 'Seconds, if you are online. If the server is restarting, delivery completes automatically the next time you join — nothing is ever lost.', category: 'store', sortOrder: 4 },
    { question: 'Can I get a refund?', answer: 'Within 24 hours, if the item has not been used, open a ticket and staff will process it. Chargebacks without contacting us first result in a permanent ban.', category: 'store', sortOrder: 5 },
    { question: 'How do I appeal a ban?', answer: 'Open an appeal from the support page. Appeals are read by an administrator, not the staff member who banned you.', category: 'support', sortOrder: 6 },
  ];

  await prisma.faq.deleteMany();
  await prisma.faq.createMany({ data: faqs });
  console.log(`✓ ${faqs.length} FAQ entries`);
}

async function main() {
  console.log('\nSeeding LifeSteal Phantom…\n');
  await seedRoles();
  await seedOwner();
  await seedApiKey();
  await seedStore();
  await seedVoteSites();
  await seedWiki();
  await seedFaq();
  console.log('\nDone.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
