import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { verifyCsrf } from '../middleware/csrf';
import { limits } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { coinPurchaseSchema, coinShopQuerySchema, ledgerQuerySchema } from '../schemas';
import * as coins from '../services/coins.service';
import { cached } from '../lib/redis';

export const coinRoutes = Router();

/** The wallet, on its own, so a header badge does not have to fetch /me. */
coinRoutes.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { coins: true },
    });
    res.json({ data: { coins: user.coins } });
  } catch (error) {
    next(error);
  }
});

/** Paginated ledger — every credit and debit, newest first. */
coinRoutes.get('/transactions', requireAuth, validate(ledgerQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit } = req.query as unknown as { page: number; limit: number };

    const [rows, total] = await Promise.all([
      prisma.coinTransaction.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          amount: true,
          balanceAfter: true,
          reason: true,
          description: true,
          createdAt: true,
        },
      }),
      prisma.coinTransaction.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({
      data: { items: rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Coin shop catalogue: search, category filter, price range, sort, paginate.
 * Public — browsing the shop should not require an account, only buying does.
 */
coinRoutes.get('/shop', validate(coinShopQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof coinShopQuerySchema>;

    const where = {
      active: true,
      coinPrice: { not: null, gte: q.minPrice, lte: q.maxPrice },
      ...(q.category ? { category: q.category } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { description: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy =
      q.sort === 'price_asc'
        ? { coinPrice: 'asc' as const }
        : q.sort === 'price_desc'
          ? { coinPrice: 'desc' as const }
          : q.sort === 'name'
            ? { name: 'asc' as const }
            : [{ featured: 'desc' as const }, { sortOrder: 'asc' as const }];

    const [items, total, categories] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          type: true,
          category: true,
          coinPrice: true,
          imageUrl: true,
          featured: true,
          stock: true,
        },
      }),
      prisma.product.count({ where }),
      // Facet counts, cached: the category list changes when staff edit the
      // catalogue, not on every browse.
      cached('shop:categories', 300, async () => {
        const grouped = await prisma.product.groupBy({
          by: ['category'],
          where: { active: true, coinPrice: { not: null } },
          _count: { _all: true },
        });
        return grouped
          .filter((g) => g.category !== null)
          .map((g) => ({ category: g.category as string, count: g._count._all }));
      }),
    ]);

    res.json({
      data: {
        items,
        categories,
        page: q.page,
        limit: q.limit,
        total,
        pages: Math.max(1, Math.ceil(total / q.limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Spend coins. Idempotent, transactional, priced server-side. */
coinRoutes.post(
  '/purchase',
  requireAuth,
  verifyCsrf,
  limits.purchase,
  validate(coinPurchaseSchema),
  async (req, res, next) => {
    try {
      const { productId, quantity, idempotencyKey } = req.body;

      const result = await coins.purchase({
        userId: req.user!.id,
        productId,
        quantity,
        idempotencyKey,
      });

      res.status(result.alreadyProcessed ? 200 : 201).json({
        data: {
          purchaseId: result.purchaseId,
          coins: result.balance,
          message: result.alreadyProcessed
            ? 'This purchase was already completed.'
            : 'Purchased. It will be waiting in game.',
        },
        meta: { replayed: result.alreadyProcessed },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Coin-shop purchase history, separate from real-money orders. */
coinRoutes.get('/purchases', requireAuth, validate(ledgerQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { page, limit } = req.query as unknown as { page: number; limit: number };

    const [items, total] = await Promise.all([
      prisma.coinPurchase.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          quantity: true,
          coinsSpent: true,
          deliveredAt: true,
          createdAt: true,
          product: { select: { name: true, imageUrl: true, type: true } },
        },
      }),
      prisma.coinPurchase.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({
      data: { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    next(error);
  }
});
