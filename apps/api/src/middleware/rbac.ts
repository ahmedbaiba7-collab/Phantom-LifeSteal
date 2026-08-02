import type { RequestHandler } from 'express';
import { hasPermission } from '../config/permissions';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';

/**
 * Route-level authorization. Default is deny: a route without `requirePermission`
 * is reachable by any authenticated user, and a route without `requireAuth` is
 * public — both are deliberate choices made per route, never inherited by accident.
 */
export function requirePermission(...required: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const ok = required.every((p) => hasPermission(req.user!.permissions, p));
    if (!ok) {
      return next(
        forbidden('PERMISSION_DENIED', 'Your rank does not include this action.'),
      );
    }
    next();
  };
}

/** Passes if the user holds ANY of the listed permissions. */
export function requireAnyPermission(...required: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (required.some((p) => hasPermission(req.user!.permissions, p))) return next();
    next(forbidden('PERMISSION_DENIED', 'Your rank does not include this action.'));
  };
}

/**
 * Hierarchy guard. Staff may only act on accounts whose highest role weight is
 * strictly below their own, so a Moderator cannot ban an Administrator and no
 * one can demote a peer. Enforced server-side because the client cannot be
 * trusted to hide a button.
 */
export async function assertOutranks(actorWeight: number, targetUserId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { roles: { select: { role: { select: { weight: true } } } } },
  });

  const targetWeight = target?.roles.reduce((max, r) => Math.max(max, r.role.weight), 0) ?? 0;

  if (targetWeight >= actorWeight) {
    throw forbidden('HIERARCHY_VIOLATION', 'You cannot act on someone at or above your rank.');
  }
}
