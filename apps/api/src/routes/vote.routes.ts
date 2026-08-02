import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { cached } from '../lib/redis';
import { requireAuth } from '../middleware/auth';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import { voteClaimSchema } from '../schemas';
import { audit } from '../services/audit.service';
import { badRequest, notFound } from '../lib/errors';

const router = Router();

/** GET /vote/sites — public list of vote links and their rewards. */
router.get('/sites', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    const sites = await cached('vote:sites', 300, () =>
      prisma.voteSite.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: { key: true, name: true, url: true, cooldownHours: true, rewardCoins: true },
      }),
    );
    res.json({ data: sites });
  } catch (err) {
    next(err);
  }
});

/** GET /vote/status — which sites this player can claim right now. */
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store, private');

    const sites = await prisma.voteSite.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    const recent = await prisma.vote.findMany({
      where: { userId: req.user!.id, createdAt: { gte: new Date(Date.now() - 48 * 3_600_000) } },
      select: { siteId: true, createdAt: true },
    });

    const data = sites.map((site) => {
      const last = recent
        .filter((v) => v.siteId === site.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const readyAt = last ? new Date(last.createdAt.getTime() + site.cooldownHours * 3_600_000) : null;
      return {
        key: site.key,
        name: site.name,
        url: site.url,
        rewardCoins: site.rewardCoins,
        available: !readyAt || readyAt <= new Date(),
        readyAt,
      };
    });

    const [monthlyVotes, totalVotes] = await Promise.all([
      prisma.vote.count({
        where: { userId: req.user!.id, createdAt: { gte: new Date(new Date().setDate(1)) } },
      }),
      prisma.vote.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({ data: { sites: data, monthlyVotes, totalVotes } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /vote/claim
 *
 * The cooldown is enforced server-side against our own vote records. Reward
 * crediting happens only for votes the vote site has confirmed via its
 * callback — a client saying "I voted" is a request, not evidence.
 */
router.post('/claim', requireAuth, verifyCsrf, limits.vote, validate(voteClaimSchema), async (req, res, next) => {
  try {
    const site = await prisma.voteSite.findUnique({ where: { key: req.body.siteKey } });
    if (!site || !site.active) throw notFound('VOTE_SITE_NOT_FOUND', 'That vote site is not available.');

    const last = await prisma.vote.findFirst({
      where: { userId: req.user!.id, siteId: site.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, verified: true },
    });

    if (last && last.createdAt.getTime() + site.cooldownHours * 3_600_000 > Date.now()) {
      const hours = Math.ceil(
        (last.createdAt.getTime() + site.cooldownHours * 3_600_000 - Date.now()) / 3_600_000,
      );
      throw badRequest('VOTE_COOLDOWN', `You can vote here again in about ${hours} hour${hours === 1 ? '' : 's'}.`);
    }

    const vote = await prisma.vote.create({
      data: { userId: req.user!.id, siteId: site.id, ip: req.realIp, verified: false, rewarded: false },
      select: { id: true, createdAt: true },
    });

    await audit(req, { action: 'vote.claim', targetType: 'vote', targetId: vote.id, after: { site: site.key } });

    res.status(201).json({
      data: {
        message: 'Vote recorded. Your reward lands as soon as the site confirms it — usually under a minute.',
        pendingReward: site.rewardCoins,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
