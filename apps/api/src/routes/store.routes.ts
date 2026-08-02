import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { cached } from '../lib/redis';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import { checkoutSchema, couponCheckSchema } from '../schemas';
import { audit } from '../services/audit.service';
import { badRequest, conflict, notFound } from '../lib/errors';
import { env } from '../config/env';

const router = Router();

/** GET /store/products — the catalogue. Public and heavily cached. */
router.get('/products', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    const products = await cached('store:catalog', 120, () =>
      prisma.product.findMany({
        where: {
          active: true,
          OR: [{ availableFrom: null }, { availableFrom: { lte: new Date() } }],
          AND: [{ OR: [{ availableTo: null }, { availableTo: { gte: new Date() } }] }],
        },
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
        select: {
          id: true, slug: true, name: true, description: true, type: true,
          price: true, salePrice: true, imageUrl: true, durationDays: true,
          stock: true, sold: true, featured: true, grantCoins: true,
        },
      }),
    );
    res.json({ data: products, meta: { currency: env.STORE_CURRENCY } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /store/products/:slug — one product, with everything the detail page
 * needs. Kept separate from the catalogue so the list stays small and
 * cacheable while the detail response can afford to be verbose.
 */
router.get('/products/:slug', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');

    const product = await prisma.product.findFirst({
      where: { slug: req.params.slug, active: true },
      select: {
        id: true, slug: true, name: true, description: true, type: true,
        price: true, salePrice: true, coinPrice: true, imageUrl: true,
        tier: true, features: true, commands: true, permissions: true,
        durationDays: true, stock: true, sold: true, featured: true,
        grantCoins: true, category: true,
      },
    });

    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'That item is not in the store.');

    // Related items come from the same category, which keeps a rank page
    // showing other ranks rather than an unrelated booster.
    const related = await prisma.product.findMany({
      where: { active: true, category: product.category, NOT: { id: product.id } },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      take: 3,
      select: {
        id: true, slug: true, name: true, price: true, salePrice: true,
        coinPrice: true, imageUrl: true, type: true,
      },
    });

    res.json({ data: product, meta: { currency: env.STORE_CURRENCY, related } });
  } catch (err) {
    next(err);
  }
});

/** POST /store/coupon/check — validates a code before checkout, without applying it. */
router.post('/coupon/check', requireAuth, verifyCsrf, validate(couponCheckSchema), async (req, res, next) => {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { code: req.body.code } });

    const invalid = () => {
      throw badRequest('COUPON_INVALID', 'That code is not valid.');
    };

    if (!coupon || !coupon.active) invalid();
    if (coupon!.expiresAt && coupon!.expiresAt < new Date()) invalid();
    if (coupon!.maxUses !== null && coupon!.uses >= coupon!.maxUses) invalid();
    if (req.body.subtotal < coupon!.minSubtotal) {
      throw badRequest(
        'COUPON_MIN_SUBTOTAL',
        `This code needs a subtotal of at least ${(coupon!.minSubtotal / 100).toFixed(2)}.`,
      );
    }

    const usedByUser = await prisma.order.count({
      where: { userId: req.user!.id, couponId: coupon!.id, status: { in: ['PAID', 'DELIVERED'] } },
    });
    if (usedByUser >= coupon!.perUserLimit) {
      throw badRequest('COUPON_ALREADY_USED', 'You have already used this code.');
    }

    const discount = coupon!.percentOff
      ? Math.floor((req.body.subtotal * coupon!.percentOff) / 100)
      : Math.min(coupon!.amountOff ?? 0, req.body.subtotal);

    res.json({ data: { code: coupon!.code, discount, percentOff: coupon!.percentOff } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /store/checkout
 *
 * Prices come from the database, never from the request — a client that posts
 * `price: 1` gets charged the catalogue price. The idempotency key makes a
 * double-clicked button return the same order instead of creating a second one.
 */
router.post(
  '/checkout',
  requireAuth,
  verifyCsrf,
  limits.checkout,
  requirePermission('store.purchase'),
  validate(checkoutSchema),
  async (req, res, next) => {
    try {
      const { items, couponCode, idempotencyKey, giftToIgn } = req.body as {
        items: { productId: string; quantity: number }[];
        couponCode?: string;
        idempotencyKey: string;
        giftToIgn?: string;
      };

      const existing = await prisma.order.findUnique({
        where: { userId_idempotencyKey: { userId: req.user!.id, idempotencyKey } },
        select: { id: true, reference: true, status: true, total: true },
      });
      if (existing) return res.json({ data: existing, meta: { replayed: true } });

      const products = await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) }, active: true },
      });
      if (products.length !== items.length) {
        throw badRequest('PRODUCT_UNAVAILABLE', 'One of those items is no longer available.');
      }

      let subtotal = 0;
      const orderItems = items.map((item) => {
        const product = products.find((p) => p.id === item.productId)!;
        if (product.stock !== null && product.stock < item.quantity) {
          throw conflict('OUT_OF_STOCK', `${product.name} is out of stock.`);
        }
        const unitPrice = product.salePrice ?? product.price;
        subtotal += unitPrice * item.quantity;
        return { productId: product.id, name: product.name, unitPrice, quantity: item.quantity };
      });

      let discount = 0;
      let couponId: string | null = null;

      if (couponCode) {
        const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
        if (coupon?.active && (!coupon.expiresAt || coupon.expiresAt > new Date())) {
          discount = coupon.percentOff
            ? Math.floor((subtotal * coupon.percentOff) / 100)
            : Math.min(coupon.amountOff ?? 0, subtotal);
          couponId = coupon.id;
        }
      }

      const total = Math.max(0, subtotal - discount);
      const reference = `LSP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            reference,
            userId: req.user!.id,
            idempotencyKey,
            subtotal,
            discount,
            total,
            currency: env.STORE_CURRENCY,
            couponId,
            ip: req.realIp,
            items: { create: orderItems },
          },
          select: { id: true, reference: true, status: true, total: true, currency: true },
        });

        if (couponId) {
          await tx.coupon.update({ where: { id: couponId }, data: { uses: { increment: 1 } } });
        }
        return created;
      });

      await audit(req, {
        action: 'store.checkout.create',
        targetType: 'order',
        targetId: order.id,
        after: { total, items: orderItems.length, giftToIgn: giftToIgn ?? null },
      });

      // The payment provider session is created here; delivery happens only
      // after the signed webhook confirms payment, never on this response.
      res.status(201).json({
        data: order,
        meta: {
          nextStep: 'payment',
          paymentUrl: `${env.WEB_ORIGIN}/store/pay/${order.reference}`,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /store/orders/:reference/invoice — the user's own invoice only. */
router.get('/orders/:reference/invoice', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store, private');

    const order = await prisma.order.findFirst({
      where: { reference: req.params.reference, userId: req.user!.id },
      select: {
        reference: true, status: true, subtotal: true, discount: true, total: true,
        currency: true, createdAt: true, paidAt: true,
        items: { select: { name: true, quantity: true, unitPrice: true } },
        user: { select: { username: true, email: true } },
      },
    });

    if (!order) throw notFound('ORDER_NOT_FOUND', 'No invoice with that reference.');
    res.json({ data: order });
  } catch (err) {
    next(err);
  }
});

export default router;
