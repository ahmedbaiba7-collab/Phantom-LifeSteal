import { Router } from 'express';
import { prisma } from '../lib/prisma';
import * as coinsService from '../services/coins.service';
import { redis, invalidate } from '../lib/redis';
import { requireAuth, invalidatePermissionCache } from '../middleware/auth';
import { assertOutranks, requirePermission } from '../middleware/rbac';
import { verifyCsrf } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import {
  coinAdjustSchema,
  newsSchema,
  punishSchema,
  roleAssignSchema,
  roleSchema,
  settingSchema,
} from '../schemas';
import { audit, scrub } from '../services/audit.service';
import { sanitizeHtml, sanitizeText } from '../lib/crypto';
import { badRequest, notFound } from '../lib/errors';
import { PERMISSIONS } from '../config/permissions';

const router = Router();

router.use(requireAuth, verifyCsrf);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get('/dashboard', requirePermission(PERMISSIONS.ANALYTICS_READ), async (_req, res, next) => {
  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const monthStart = new Date(new Date().setDate(1));

    const [users, newUsers, revenue, openTickets, failedLogins, pendingDeliveries] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.order.aggregate({
        where: { status: { in: ['PAID', 'DELIVERED'] }, paidAt: { gte: monthStart } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.ticket.count({ where: { status: { in: ['OPEN', 'PENDING'] } } }),
      prisma.securityEvent.count({ where: { type: 'LOGIN_FAILED', createdAt: { gte: dayAgo } } }),
      prisma.delivery.count({ where: { status: 'PENDING' } }),
    ]);

    res.json({
      data: {
        users,
        newUsersToday: newUsers,
        revenueThisMonth: revenue._sum.total ?? 0,
        ordersThisMonth: revenue._count,
        openTickets,
        failedLogins24h: failedLogins,
        pendingDeliveries,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/users', requirePermission(PERMISSIONS.USER_READ), async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 60) : '';

    const users = await prisma.user.findMany({
      where: q
        ? {
            deletedAt: null,
            OR: [
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, username: true, email: true, status: true, coins: true,
        totalSpent: true, createdAt: true, lastLoginAt: true, twoFactorEnabled: true,
        roles: { select: { role: { select: { key: true, name: true, color: true, weight: true } } } },
      },
    });

    res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

router.post('/users/punish', requirePermission(PERMISSIONS.USER_PUNISH), validate(punishSchema), async (req, res, next) => {
  try {
    // Hierarchy is enforced before anything is written — a Moderator cannot ban
    // an Administrator no matter what the client sends.
    await assertOutranks(req.user!.weight, req.body.userId);

    const punishment = await prisma.punishment.create({
      data: {
        userId: req.body.userId,
        staffId: req.user!.id,
        type: req.body.type,
        reason: sanitizeText(req.body.reason),
        evidence: req.body.evidence ?? null,
        expiresAt: req.body.durationHours
          ? new Date(Date.now() + req.body.durationHours * 3_600_000)
          : null,
      },
    });

    if (req.body.type === 'BAN' || req.body.type === 'TEMPBAN') {
      await prisma.user.update({
        where: { id: req.body.userId },
        data: { status: req.body.type === 'BAN' ? 'BANNED' : 'SUSPENDED' },
      });
      await prisma.session.updateMany({
        where: { userId: req.body.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'punished' },
      });
      await invalidatePermissionCache(req.body.userId);
    }

    await audit(req, {
      action: `moderation.${req.body.type.toLowerCase()}`,
      targetType: 'user',
      targetId: req.body.userId,
      after: scrub(punishment as unknown as Record<string, unknown>),
    });

    res.status(201).json({ data: punishment });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/roles', requirePermission(PERMISSIONS.ROLE_MANAGE), validate(roleAssignSchema), async (req, res, next) => {
  try {
    await assertOutranks(req.user!.weight, req.params.id);

    const role = await prisma.role.findUnique({ where: { key: req.body.roleKey } });
    if (!role) throw notFound('ROLE_NOT_FOUND', 'No role with that key.');

    // Nobody may grant a role at or above their own weight — that is how
    // privilege escalation happens in every panel that skips this check.
    if (role.weight >= req.user!.weight) {
      throw badRequest('HIERARCHY_VIOLATION', 'You cannot grant a role at or above your own.');
    }

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: req.params.id, roleId: role.id } },
      create: {
        userId: req.params.id,
        roleId: role.id,
        grantedBy: req.user!.id,
        expiresAt: req.body.expiresAt ?? null,
      },
      update: { expiresAt: req.body.expiresAt ?? null },
    });

    await invalidatePermissionCache(req.params.id);
    await audit(req, {
      action: 'role.grant',
      targetType: 'user',
      targetId: req.params.id,
      after: { role: role.key, expiresAt: req.body.expiresAt ?? null },
    });

    res.json({ data: { message: `${role.name} granted.` } });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:id/roles/:roleKey', requirePermission(PERMISSIONS.ROLE_MANAGE), async (req, res, next) => {
  try {
    await assertOutranks(req.user!.weight, req.params.id);

    const role = await prisma.role.findUnique({ where: { key: req.params.roleKey } });
    if (!role) throw notFound('ROLE_NOT_FOUND', 'No role with that key.');

    await prisma.userRole.deleteMany({ where: { userId: req.params.id, roleId: role.id } });
    await invalidatePermissionCache(req.params.id);
    await audit(req, { action: 'role.revoke', targetType: 'user', targetId: req.params.id, before: { role: role.key } });

    res.json({ data: { message: `${role.name} removed.` } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

router.get('/roles', requirePermission(PERMISSIONS.ROLE_READ), async (_req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { weight: 'desc' },
      include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
    });
    res.json({ data: roles, meta: { catalogue: Object.values(PERMISSIONS) } });
  } catch (err) {
    next(err);
  }
});

router.put('/roles/:key', requirePermission(PERMISSIONS.ROLE_MANAGE), validate(roleSchema), async (req, res, next) => {
  try {
    const existing = await prisma.role.findUnique({
      where: { key: req.params.key },
      include: { permissions: true },
    });
    if (!existing) throw notFound('ROLE_NOT_FOUND', 'No role with that key.');

    if (existing.weight >= req.user!.weight || req.body.weight >= req.user!.weight) {
      throw badRequest('HIERARCHY_VIOLATION', 'You cannot edit a role at or above your own.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const role = await tx.role.update({
        where: { key: req.params.key },
        data: {
          name: req.body.name,
          description: req.body.description ?? null,
          color: req.body.color,
          weight: req.body.weight,
          isStaff: req.body.isStaff,
        },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: (req.body.permissions as string[]).map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      });
      return role;
    });

    // Every holder of this role must lose their cached permission set at once.
    await invalidate('perms:');
    await audit(req, {
      action: 'role.update',
      targetType: 'role',
      targetId: updated.id,
      before: { permissions: existing.permissions.map((p) => p.permission), weight: existing.weight },
      after: { permissions: req.body.permissions, weight: req.body.weight },
    });

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

router.post('/news', requirePermission(PERMISSIONS.NEWS_CREATE), validate(newsSchema), async (req, res, next) => {
  try {
    const post = await prisma.newsPost.create({
      data: {
        ...req.body,
        title: sanitizeText(req.body.title),
        excerpt: sanitizeText(req.body.excerpt),
        body: sanitizeHtml(req.body.body), // cleaned before storage, not at render time
        authorId: req.user!.id,
        publishedAt: req.body.published ? new Date() : null,
      },
      select: { id: true, slug: true, title: true, published: true },
    });

    await invalidate('news:');
    await audit(req, { action: 'news.create', targetType: 'news', targetId: post.id });
    res.status(201).json({ data: post });
  } catch (err) {
    next(err);
  }
});

router.delete('/news/:slug', requirePermission(PERMISSIONS.NEWS_DELETE), async (req, res, next) => {
  try {
    // Soft delete: moderation must be reversible.
    const result = await prisma.newsPost.updateMany({
      where: { slug: req.params.slug, deletedAt: null },
      data: { deletedAt: new Date(), published: false },
    });
    if (result.count === 0) throw notFound('POST_NOT_FOUND', 'No post with that slug.');

    await invalidate('news:');
    await audit(req, { action: 'news.delete', targetType: 'news', targetId: req.params.slug });
    res.json({ data: { message: 'Post removed.' } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

router.get('/audit', requirePermission(PERMISSIONS.AUDIT_READ), async (req, res, next) => {
  try {
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const logs = await prisma.auditLog.findMany({
      where: action ? { action: { startsWith: action } } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, action: true, actorLabel: true, targetType: true, targetId: true,
        ip: true, requestId: true, createdAt: true, before: true, after: true,
      },
    });
    res.json({ data: logs });
  } catch (err) {
    next(err);
  }
});

router.get('/security', requirePermission(PERMISSIONS.SECURITY_READ), async (_req, res, next) => {
  try {
    const [events, bySeverity] = await Promise.all([
      prisma.securityEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, type: true, severity: true, ip: true, createdAt: true, details: true,
          user: { select: { username: true } },
        },
      }),
      prisma.securityEvent.groupBy({
        by: ['type'],
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
        _count: true,
      }),
    ]);
    res.json({ data: { events, weeklyBreakdown: bySeverity } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Settings & maintenance
// ---------------------------------------------------------------------------

router.get('/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (_req, res, next) => {
  try {
    const settings = await prisma.siteSetting.findMany();
    const maintenance = (await redis.get('site:maintenance')) === '1';
    res.json({ data: { settings, maintenance } });
  } catch (err) {
    next(err);
  }
});

router.put('/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), validate(settingSchema), async (req, res, next) => {
  try {
    const before = await prisma.siteSetting.findUnique({ where: { key: req.body.key } });

    const setting = await prisma.siteSetting.upsert({
      where: { key: req.body.key },
      create: { key: req.body.key, value: req.body.value as never, updatedBy: req.user!.id },
      update: { value: req.body.value as never, updatedBy: req.user!.id },
    });

    await audit(req, {
      action: 'settings.update',
      targetType: 'setting',
      targetId: req.body.key,
      before: before?.value,
      after: setting.value,
    });

    res.json({ data: setting });
  } catch (err) {
    next(err);
  }
});

router.post('/maintenance', requirePermission(PERMISSIONS.MAINTENANCE_TOGGLE), async (req, res, next) => {
  try {
    const enabled = req.body?.enabled === true;
    if (enabled) await redis.set('site:maintenance', '1');
    else await redis.del('site:maintenance');

    await audit(req, { action: 'maintenance.toggle', after: { enabled } });
    res.json({ data: { maintenance: enabled } });
  } catch (err) {
    next(err);
  }
});

router.get('/backups', requirePermission(PERMISSIONS.BACKUP_CREATE), async (_req, res, next) => {
  try {
    const backups = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    res.json({
      data: backups.map((b) => ({ ...b, sizeBytes: Number(b.sizeBytes) })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;


/**
 * Grant or revoke coins. Requires an explicit reason, writes to the same
 * ledger players see, and is audited with the actor attached. There is no
 * silent path to changing someone's balance.
 */
router.post(
  '/users/:id/coins',
  requirePermission(PERMISSIONS.COINS_ADJUST),
  validate(coinAdjustSchema),
  async (req, res, next) => {
    try {
      const { amount, reason } = req.body as { amount: number; reason: string };

      const balance = await coinsService.adjust({
        userId: req.params.id,
        amount,
        reason,
        actorId: req.user!.id,
        ip: req.realIp,
      });

      res.json({ data: { coins: balance }, meta: { message: `Balance is now ${balance} coins.` } });
    } catch (error) {
      next(error);
    }
  },
);

/** Any player's ledger, for investigating a disputed balance. */
router.get('/users/:id/coins', requirePermission(PERMISSIONS.COINS_VIEW_ANY), async (req, res, next) => {
  try {
    const [transactions, reconciliation] = await Promise.all([
      prisma.coinTransaction.findMany({
        where: { userId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          amount: true,
          balanceAfter: true,
          reason: true,
          description: true,
          actorId: true,
          createdAt: true,
        },
      }),
      coinsService.reconcile(req.params.id),
    ]);

    // Surfaced rather than auto-corrected: drift means something wrote to the
    // wallet outside the service, and that is worth a human looking at it.
    res.json({ data: { transactions, reconciliation } });
  } catch (error) {
    next(error);
  }
});
