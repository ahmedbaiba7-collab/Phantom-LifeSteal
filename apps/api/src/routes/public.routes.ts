import { Router, type RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { cached } from '../lib/redis';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import { commentSchema, leaderboardParamsSchema, leaderboardQuerySchema, paginationSchema } from '../schemas';
import { getNetworkPulse, getServerStatus, skin } from '../services/minecraft.service';
import { sanitizeText } from '../lib/crypto';
import { notFound } from '../lib/errors';

const router = Router();

/** Content is identical for everyone, so it is cached at the edge and in Redis. */
const publicCache =
  (seconds: number): RequestHandler =>
  (_req, res, next) => {
    res.setHeader(
      'Cache-Control',
      `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
    );
    next();
  };

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

router.get('/server/status', publicCache(20), async (_req, res, next) => {
  try {
    res.json({ data: await getServerStatus() });
  } catch (err) {
    next(err);
  }
});

router.get('/server/pulse', publicCache(60), async (_req, res, next) => {
  try {
    res.json({ data: await getNetworkPulse() });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

const BOARD_ORDER = {
  kills: { kills: 'desc' },
  deaths: { deaths: 'desc' },
  hearts: { maxHearts: 'desc' },
  balance: { moneyBalance: 'desc' },
  playtime: { playtimeMinutes: 'desc' },
  votes: { votes: 'desc' },
  streak: { bestStreak: 'desc' },
  kdr: { kills: 'desc' },
} as const;

router.get(
  '/leaderboards/:board',
  publicCache(60),
  validate(leaderboardParamsSchema, 'params'),
  validate(leaderboardQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const board = req.params.board as keyof typeof BOARD_ORDER;
      const { limit } = req.query as unknown as { limit: number; period: string };

      const rows = await cached(`lb:${board}:${limit}`, 60, () =>
        prisma.playerStats.findMany({
          orderBy: BOARD_ORDER[board],
          take: limit,
          select: {
            uuid: true,
            kills: true,
            deaths: true,
            maxHearts: true,
            heartsStolen: true,
            moneyBalance: true,
            playtimeMinutes: true,
            bestStreak: true,
            votes: true,
            user: { select: { username: true, roles: { select: { role: { select: { name: true, color: true, weight: true } } } } } },
          },
        }),
      );

      res.json({
        data: rows.map((r, index) => {
          const top = r.user.roles.sort((a, b) => b.role.weight - a.role.weight)[0]?.role;
          return {
            rank: index + 1,
            username: r.user.username,
            rankName: top?.name ?? 'Player',
            rankColor: top?.color ?? '#94A3B8',
            avatar: skin.head(r.uuid, 40),
            kills: r.kills,
            deaths: r.deaths,
            kdr: r.deaths === 0 ? r.kills : Number((r.kills / r.deaths).toFixed(2)),
            hearts: r.maxHearts,
            heartsStolen: r.heartsStolen,
            balance: r.moneyBalance,
            playtimeHours: Math.round(r.playtimeMinutes / 60),
            bestStreak: r.bestStreak,
            votes: r.votes,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

router.get('/news', publicCache(60), validate(paginationSchema, 'query'), async (req, res, next) => {
  try {
    const { cursor, limit } = req.query as unknown as { cursor?: string; limit: number };

    const posts = await prisma.newsPost.findMany({
      where: { published: true, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverUrl: true,
        category: true,
        tags: true,
        pinned: true,
        publishedAt: true,
        views: true,
        author: { select: { username: true, avatarUrl: true } },
        _count: { select: { comments: true } },
      },
    });

    const hasMore = posts.length > limit;
    res.json({
      data: hasMore ? posts.slice(0, limit) : posts,
      meta: { nextCursor: hasMore ? posts[limit - 1]?.id : null },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/news/:slug', publicCache(60), async (req, res, next) => {
  try {
    const post = await prisma.newsPost.findFirst({
      where: { slug: req.params.slug, published: true, deletedAt: null },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        body: true,
        coverUrl: true,
        category: true,
        tags: true,
        publishedAt: true,
        views: true,
        author: { select: { username: true, avatarUrl: true } },
        comments: {
          where: { hidden: false, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            body: true,
            createdAt: true,
            user: { select: { username: true, avatarUrl: true } },
            _count: { select: { likes: true } },
          },
        },
      },
    });

    if (!post) throw notFound('POST_NOT_FOUND', 'That post does not exist.');

    // Fire-and-forget so a view counter never adds latency to the render.
    prisma.newsPost.update({ where: { id: post.id }, data: { views: { increment: 1 } } }).catch(() => undefined);

    res.json({ data: post });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/news/:slug/comments',
  requireAuth,
  verifyCsrf,
  limits.comment,
  validate(commentSchema),
  async (req, res, next) => {
    try {
      const post = await prisma.newsPost.findFirst({
        where: { slug: req.params.slug, published: true, deletedAt: null },
        select: { id: true },
      });
      if (!post) throw notFound('POST_NOT_FOUND', 'That post does not exist.');

      const comment = await prisma.comment.create({
        data: {
          postId: post.id,
          userId: req.user!.id,
          body: sanitizeText(req.body.body), // stored as plain text; never rendered as markup
        },
        select: {
          id: true,
          body: true,
          createdAt: true,
          user: { select: { username: true, avatarUrl: true } },
        },
      });

      res.status(201).json({ data: comment });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Wiki, FAQ, events
// ---------------------------------------------------------------------------

router.get('/wiki', publicCache(300), async (_req, res, next) => {
  try {
    const categories = await cached('wiki:index', 300, () =>
      prisma.wikiCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          slug: true,
          name: true,
          icon: true,
          articles: {
            where: { published: true },
            orderBy: { sortOrder: 'asc' },
            select: { slug: true, title: true, summary: true, updatedAt: true },
          },
        },
      }),
    );
    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
});

router.get('/wiki/:slug', publicCache(300), async (req, res, next) => {
  try {
    const article = await prisma.wikiArticle.findFirst({
      where: { slug: req.params.slug, published: true },
      select: {
        slug: true,
        title: true,
        summary: true,
        body: true,
        keywords: true,
        updatedAt: true,
        category: { select: { slug: true, name: true } },
      },
    });
    if (!article) throw notFound('ARTICLE_NOT_FOUND', 'That page does not exist.');
    res.json({ data: article });
  } catch (err) {
    next(err);
  }
});

router.get('/faq', publicCache(600), async (_req, res, next) => {
  try {
    const faqs = await cached('faq:all', 600, () =>
      prisma.faq.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] }),
    );
    res.json({ data: faqs });
  } catch (err) {
    next(err);
  }
});

router.get('/events', publicCache(120), async (_req, res, next) => {
  try {
    const events = await prisma.serverEvent.findMany({
      where: { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
      orderBy: { startsAt: 'asc' },
      take: 8,
    });
    res.json({ data: events });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Public profiles
// ---------------------------------------------------------------------------

router.get('/players/:username', optionalAuth, publicCache(60), async (req, res, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: { username: { equals: req.params.username, mode: 'insensitive' }, deletedAt: null },
      select: {
        username: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
        minecraft: { select: { uuid: true, ign: true } },
        stats: {
          select: {
            kills: true, deaths: true, maxHearts: true, heartsStolen: true,
            bestStreak: true, playtimeMinutes: true, votes: true, lastSeenAt: true,
          },
        },
        roles: { select: { role: { select: { name: true, color: true, weight: true } } } },
      },
    });

    if (!user) throw notFound('PLAYER_NOT_FOUND', 'No player by that name.');

    const uuid = user.minecraft?.uuid;
    res.json({
      data: {
        ...user,
        renders: uuid ? { head: skin.head(uuid, 96), body: skin.body(uuid) } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;


/**
 * The rank shop. Ordered by tier so the comparison table on the site never has
 * to hard-code the ladder — adding a sixth rank in the database is enough.
 */
router.get('/ranks', publicCache(300), async (_req, res, next) => {
  try {
    const ranks = await cached('shop:ranks', 300, () =>
      prisma.product.findMany({
        where: { active: true, type: 'RANK' },
        orderBy: [{ tier: 'asc' }, { price: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          price: true,
          salePrice: true,
          imageUrl: true,
          tier: true,
          features: true,
          commands: true,
          permissions: true,
          durationDays: true,
          featured: true,
        },
      }),
    );

    res.json({ data: ranks });
  } catch (error) {
    next(error);
  }
});
