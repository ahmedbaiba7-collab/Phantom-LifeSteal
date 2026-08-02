import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { SecurityEventType } from '@prisma/client';

interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only record of every consequential action. Writes are fire-and-forget:
 * a logging failure must never roll back a purchase or a ban. In production the
 * application database role is granted INSERT and SELECT on audit_logs only,
 * so even a compromised API cannot rewrite its own history.
 */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id ?? null,
        actorLabel: req.user?.username ?? (req.apiKeyScopes ? 'api-key' : 'system'),
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        before: (input.before ?? undefined) as never,
        after: (input.after ?? undefined) as never,
        ip: req.realIp,
        userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
        requestId: req.id,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'audit write failed');
  }
}

export async function securityEvent(
  type: SecurityEventType,
  opts: { userId?: string; severity?: number; ip?: string; userAgent?: string; details?: unknown },
): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        type,
        userId: opts.userId ?? null,
        severity: opts.severity ?? 1,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent?.slice(0, 500) ?? null,
        details: (opts.details ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.error({ err, type }, 'security event write failed');
  }
}

/** Redact fields that must never be persisted into a before/after snapshot. */
export function scrub<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const banned = ['passwordHash', 'password', 'secretEnc', 'refreshTokenHash', 'keyHash', 'tokenHash'];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!banned.includes(k)) out[k] = v;
  }
  return out as Partial<T>;
}
