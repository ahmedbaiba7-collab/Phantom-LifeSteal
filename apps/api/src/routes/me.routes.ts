import { Router } from 'express';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import {
  authenticatorCodeSchema,
  changePasswordSchema,
  confirmPasswordOnlySchema,
  linkMinecraftSchema,
  updateProfileSchema,
} from '../schemas';
import * as auth from '../services/auth.service';
import { audit, securityEvent } from '../services/audit.service';
import { skin } from '../services/minecraft.service';
import { generateToken, sanitizeText } from '../lib/crypto';
import { badRequest, notFound } from '../lib/errors';

const router = Router();

router.use(requireAuth);
router.use((_req, res, next) => {
  // Nothing on this router is cacheable — it is all account-specific.
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

/** GET /me — the full account payload the dashboard renders from. */
router.get('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        username: true,
        avatarUrl: true,
        bio: true,
        locale: true,
        coins: true,
        totalSpent: true,
        status: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        createdAt: true,
        lastLoginAt: true,
        minecraft: { select: { uuid: true, ign: true, verifiedAt: true } },
        discord: { select: { discordId: true, username: true, avatar: true } },
        stats: true,
        roles: {
          where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          select: {
            expiresAt: true,
            role: { select: { key: true, name: true, color: true, weight: true } },
          },
        },
      },
    });

    const [unread, openTickets, punishments] = await Promise.all([
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.ticket.count({ where: { userId: user.id, status: { in: ['OPEN', 'PENDING', 'ANSWERED'] } } }),
      prisma.punishment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, reason: true, active: true, expiresAt: true, createdAt: true },
      }),
    ]);

    const uuid = user.minecraft?.uuid;

    res.json({
      data: {
        ...user,
        permissions: [...req.user!.permissions],
        unreadNotifications: unread,
        openTickets,
        punishments,
        renders: uuid
          ? { head: skin.head(uuid), body: skin.body(uuid), cape: skin.cape(uuid) }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /me — profile fields the user controls. */
router.patch('/', verifyCsrf, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { bio: true, locale: true, avatarUrl: true },
    });

    const after = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(req.body.bio !== undefined ? { bio: sanitizeText(req.body.bio) } : {}),
        ...(req.body.locale ? { locale: req.body.locale } : {}),
        ...(req.body.avatarUrl !== undefined ? { avatarUrl: req.body.avatarUrl } : {}),
      },
      select: { bio: true, locale: true, avatarUrl: true },
    });

    await audit(req, { action: 'profile.update', targetType: 'user', targetId: req.user!.id, before, after });
    res.json({ data: after });
  } catch (err) {
    next(err);
  }
});

/** POST /me/password — changes password and signs out every other device. */
router.post('/password', verifyCsrf, validate(changePasswordSchema), async (req, res, next) => {
  try {
    await auth.changePassword(
      req.user!.id,
      req.body.currentPassword,
      req.body.newPassword,
      req.user!.sessionId,
    );
    await audit(req, { action: 'profile.password.change', targetType: 'user', targetId: req.user!.id });
    res.json({ data: { message: 'Password updated. Other devices were signed out.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Sessions / devices
// ---------------------------------------------------------------------------

router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        id: true,
        ip: true,
        deviceLabel: true,
        country: true,
        lastActiveAt: true,
        createdAt: true,
      },
    });

    res.json({
      data: sessions.map((s) => ({ ...s, current: s.id === req.user!.sessionId })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/sessions/:id', verifyCsrf, async (req, res, next) => {
  try {
    // Scoped by userId so one account can never revoke another's session by id.
    const result = await prisma.session.updateMany({
      where: { id: req.params.id, userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });

    if (result.count === 0) throw notFound('SESSION_NOT_FOUND', 'That device is already signed out.');

    await audit(req, { action: 'session.revoke', targetType: 'session', targetId: req.params.id });
    res.json({ data: { message: 'Device signed out.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Two-factor
// ---------------------------------------------------------------------------

router.post('/2fa/setup', verifyCsrf, limits.twoFactor, async (req, res, next) => {
  try {
    const { secret, otpauthUrl } = await auth.beginTwoFactorSetup(req.user!.id, req.user!.email);
    const qrDataUri = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    res.json({ data: { secret, otpauthUrl, qrDataUri } });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/confirm', verifyCsrf, limits.twoFactor, validate(authenticatorCodeSchema), async (req, res, next) => {
  try {
    const recoveryCodes = await auth.confirmTwoFactorSetup(req.user!.id, req.body.code);
    await audit(req, { action: 'profile.2fa.enable', targetType: 'user', targetId: req.user!.id });
    res.json({
      data: {
        recoveryCodes,
        message: 'Two-factor is on. Save these recovery codes — they are shown once.',
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/2fa/disable', verifyCsrf, limits.twoFactor, validate(confirmPasswordOnlySchema), async (req, res, next) => {
  try {
    const { password } = req.body as { password: string };

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { passwordHash: true },
    });

    const { verifyPassword } = await import('../lib/crypto');
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw badRequest('PASSWORD_INCORRECT', 'That password is not correct.');
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: req.user!.id }, data: { twoFactorEnabled: false } }),
      prisma.twoFactorSecret.deleteMany({ where: { userId: req.user!.id } }),
      prisma.recoveryCode.deleteMany({ where: { userId: req.user!.id } }),
    ]);

    await securityEvent('TWO_FACTOR_DISABLED', { userId: req.user!.id, severity: 3, ip: req.realIp });
    await audit(req, { action: 'profile.2fa.disable', targetType: 'user', targetId: req.user!.id });
    res.json({ data: { message: 'Two-factor turned off.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Minecraft account linking
// ---------------------------------------------------------------------------

/**
 * Linking is proven in game, not by typing a name: the site issues a code and
 * the player runs /link <code> on the server. Nobody can claim someone else's
 * IGN and inherit their stats or purchases.
 */
router.post('/link/minecraft', verifyCsrf, validate(linkMinecraftSchema), async (req, res, next) => {
  try {
    const code = generateToken(4).slice(0, 8).toUpperCase();

    await prisma.minecraftAccount.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, uuid: `pending-${req.user!.id}`, ign: req.body.ign, linkCode: code },
      update: { ign: req.body.ign, linkCode: code, verifiedAt: null },
    });

    res.json({
      data: {
        code,
        instructions: `Join the server and run /link ${code} within 10 minutes.`,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

router.get('/notifications', async (req, res, next) => {
  try {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
});

router.post('/notifications/read', verifyCsrf, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ data: { message: 'All caught up.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Purchase history
// ---------------------------------------------------------------------------

router.get('/orders', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        reference: true,
        status: true,
        total: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        items: { select: { name: true, quantity: true, unitPrice: true } },
      },
    });
    res.json({ data: orders });
  } catch (err) {
    next(err);
  }
});

export default router;
