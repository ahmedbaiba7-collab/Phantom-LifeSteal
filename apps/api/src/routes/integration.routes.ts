import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { redis, invalidate } from '../lib/redis';
import { requireApiKey } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { statsPushSchema } from '../schemas';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Machine-to-machine surface for the in-game plugin. Authenticated with a
 * hashed API key and scope, never with a session — there is no browser here,
 * so CSRF does not apply and cookies are never read.
 */
router.use(requireApiKey('integration'));

/** POST /integration/stats — the plugin pushes a batch every 30 seconds. */
router.post('/stats', validate(statsPushSchema), async (req, res, next) => {
  try {
    const { tps, players } = req.body as {
      tps?: number;
      players: {
        uuid: string; ign: string; kills: number; deaths: number;
        heartsStolen: number; heartsLost: number; maxHearts: number;
        currentHearts: number; killStreak: number; playtimeMinutes: number;
        blocksMined: number; moneyBalance: number;
      }[];
    };

    if (typeof tps === 'number') {
      await redis.set('mc:tps', tps.toFixed(2), 'EX', 120);
    }

    const now = new Date();
    let matched = 0;

    for (const p of players) {
      const account = await prisma.minecraftAccount.findUnique({
        where: { uuid: p.uuid },
        select: { userId: true },
      });
      if (!account) continue; // unlinked player — stats are kept in game only
      matched += 1;

      // bestStreak is a running maximum, so a plugin restart that reports a
      // fresh streak of 0 can never erase a record someone actually set.
      const previous = await prisma.playerStats.findUnique({
        where: { uuid: p.uuid },
        select: { bestStreak: true },
      });
      const bestStreak = Math.max(previous?.bestStreak ?? 0, p.killStreak);

      await prisma.playerStats.upsert({
        where: { uuid: p.uuid },
        create: {
          uuid: p.uuid,
          userId: account.userId,
          kills: p.kills,
          deaths: p.deaths,
          heartsStolen: p.heartsStolen,
          heartsLost: p.heartsLost,
          maxHearts: p.maxHearts,
          currentHearts: p.currentHearts,
          killStreak: p.killStreak,
          bestStreak,
          playtimeMinutes: p.playtimeMinutes,
          blocksMined: p.blocksMined,
          moneyBalance: p.moneyBalance,
          lastSeenAt: now,
        },
        update: {
          kills: p.kills,
          deaths: p.deaths,
          heartsStolen: p.heartsStolen,
          heartsLost: p.heartsLost,
          maxHearts: p.maxHearts,
          currentHearts: p.currentHearts,
          killStreak: p.killStreak,
          bestStreak,
          playtimeMinutes: p.playtimeMinutes,
          blocksMined: p.blocksMined,
          moneyBalance: p.moneyBalance,
          lastSeenAt: now,
        },
      });

      // Daily rollup powers "this week" deltas without scanning history.
      const day = new Date(now.toISOString().slice(0, 10));
      await prisma.statSnapshot.upsert({
        where: { uuid_day: { uuid: p.uuid, day } },
        create: {
          uuid: p.uuid, day, kills: p.kills, deaths: p.deaths,
          heartsStolen: p.heartsStolen, playtimeMinutes: p.playtimeMinutes,
          moneyBalance: p.moneyBalance,
        },
        update: {
          kills: p.kills, deaths: p.deaths, heartsStolen: p.heartsStolen,
          playtimeMinutes: p.playtimeMinutes, moneyBalance: p.moneyBalance,
        },
      });
    }

    await invalidate('lb:');
    await invalidate('mc:pulse');

    res.json({ data: { received: players.length, matched } });
  } catch (err) {
    next(err);
  }
});

/** POST /integration/link — the plugin confirms /link <code> was run in game. */
router.post('/link', async (req, res, next) => {
  try {
    const code = String(req.body?.code ?? '').toUpperCase();
    const uuid = String(req.body?.uuid ?? '');
    const ign = String(req.body?.ign ?? '');

    if (!code || !uuid || !ign) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'code, uuid and ign are required.', requestId: req.id },
      });
    }

    const pending = await prisma.minecraftAccount.findFirst({
      where: { linkCode: code, verifiedAt: null },
      select: { id: true, userId: true },
    });

    if (!pending) {
      return res.status(404).json({
        error: { code: 'LINK_CODE_INVALID', message: 'That code is not valid or already used.', requestId: req.id },
      });
    }

    await prisma.minecraftAccount.update({
      where: { id: pending.id },
      data: { uuid, ign, verifiedAt: new Date(), linkCode: null },
    });

    await prisma.notification.create({
      data: {
        userId: pending.userId,
        title: 'Minecraft account linked',
        body: `${ign} is now connected to your account. Your stats will start syncing.`,
        href: '/dashboard',
      },
    });

    logger.info({ uuid, ign }, 'minecraft account linked');
    res.json({ data: { linked: true, ign } });
  } catch (err) {
    next(err);
  }
});

/** GET /integration/deliveries — the plugin pulls pending purchases to fulfil. */
router.get('/deliveries', async (_req, res, next) => {
  try {
    const pending = await prisma.delivery.findMany({
      where: { status: 'PENDING', attempts: { lt: 10 } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { id: true, targetUuid: true, command: true },
    });
    res.json({ data: pending });
  } catch (err) {
    next(err);
  }
});

/** POST /integration/deliveries/:id/ack — marks a delivery complete or failed. */
router.post('/deliveries/:id/ack', async (req, res, next) => {
  try {
    const success = req.body?.success === true;

    await prisma.delivery.update({
      where: { id: req.params.id },
      data: success
        ? { status: 'DELIVERED', deliveredAt: new Date() }
        : { attempts: { increment: 1 }, lastError: String(req.body?.error ?? 'unknown').slice(0, 500) },
    });

    res.json({ data: { acknowledged: true } });
  } catch (err) {
    next(err);
  }
});

export default router;
