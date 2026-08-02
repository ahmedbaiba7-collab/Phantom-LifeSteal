import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { redis } from '../lib/redis';
import { hasPermission } from '../config/permissions';

/**
 * Maintenance mode is a Redis flag so toggling it takes effect across every API
 * instance immediately. Staff with `maintenance.toggle` keep full access, which
 * is the point — the site is closed so they can work on it.
 */
export const maintenanceGate: RequestHandler = async (req, _res, next) => {
  if (req.path.startsWith('/api/v1/auth') || req.path === '/health') return next();

  const on = await redis.get('site:maintenance').catch(() => null);
  if (on !== '1') return next();

  if (req.user && hasPermission(req.user.permissions, 'maintenance.toggle')) return next();

  next(
    new AppError(
      503,
      'MAINTENANCE',
      'The site is down for maintenance. Follow Discord for updates.',
    ),
  );
};
