import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { hashToken } from '../lib/crypto';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  permissions: Set<string>;
  weight: number;
  roles: string[];
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKeyScopes?: string[];
    }
  }
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  jti: string;
  typ: 'access';
}

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId, typ: 'access' } satisfies Omit<AccessTokenClaims, 'jti'>, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: env.API_ORIGIN,
    audience: env.WEB_ORIGIN,
    jwtid: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
  });
}

function readBearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

/**
 * Effective permissions are the union across a user's roles, cached in Redis
 * so a hot path does not join three tables on every request. Any role change
 * deletes this key, so a revocation is live within one request, not one TTL.
 */
export async function loadAuthUser(userId: string, sessionId: string): Promise<AuthUser | null> {
  const cacheKey = `perms:${userId}`;

  const cachedRaw = await redis.get(cacheKey).catch(() => null);
  if (cachedRaw) {
    const parsed = JSON.parse(cachedRaw) as Omit<AuthUser, 'permissions' | 'sessionId'> & {
      permissions: string[];
    };
    return { ...parsed, permissions: new Set(parsed.permissions), sessionId };
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      roles: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { role: { select: { key: true, weight: true, permissions: { select: { permission: true } } } } },
      },
    },
  });

  if (!user || user.status === 'BANNED' || user.status === 'DELETED') return null;

  const permissions = new Set<string>();
  let weight = 0;
  const roles: string[] = [];

  for (const { role } of user.roles) {
    roles.push(role.key);
    weight = Math.max(weight, role.weight);
    for (const { permission } of role.permissions) permissions.add(permission);
  }

  const payload = { id: user.id, username: user.username, email: user.email, weight, roles };
  await redis
    .set(cacheKey, JSON.stringify({ ...payload, permissions: [...permissions] }), 'EX', 300)
    .catch(() => undefined);

  return { ...payload, permissions, sessionId };
}

export function invalidatePermissionCache(userId: string): Promise<unknown> {
  return redis.del(`perms:${userId}`).catch(() => undefined);
}

/** Rejects the request unless a valid, unrevoked session presents a live access token. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next(unauthorized());

  let claims: AccessTokenClaims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.API_ORIGIN,
      audience: env.WEB_ORIGIN,
    }) as AccessTokenClaims;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    return next(
      unauthorized(
        expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
        expired ? 'Your session expired. Refreshing…' : 'Sign in to continue.',
      ),
    );
  }

  if (claims.typ !== 'access') return next(unauthorized('AUTH_TOKEN_INVALID'));

  // A signed token is not enough: the session it belongs to must still be live.
  // This is what makes "sign out all devices" instantaneous rather than a
  // promise that expires in fifteen minutes.
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) {
    return next(unauthorized('AUTH_SESSION_REVOKED', 'This session is no longer valid.'));
  }

  const user = await loadAuthUser(claims.sub, claims.sid);
  if (!user) return next(forbidden('ACCOUNT_UNAVAILABLE', 'This account is not available.'));

  req.user = user;

  // Cheap liveness marker for the device list; a write per request would be
  // wasteful, so it is throttled to once a minute per session.
  redis
    .set(`sess:seen:${session.id}`, '1', 'EX', 60, 'NX')
    .then((set) => {
      if (set) {
        return prisma.session
          .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
          .catch(() => undefined);
      }
      return undefined;
    })
    .catch(() => undefined);

  next();
};

/** Attaches the user when a token is present, but never rejects. */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  if (!readBearer(req)) return next();
  requireAuth(req, res, (err?: unknown) => (err ? next() : next()));
};

/** Machine authentication for the in-game plugin and internal services. */
export function requireApiKey(...scopes: string[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const presented = req.get('x-api-key');
    if (!presented) return next(unauthorized('API_KEY_REQUIRED', 'API key required.'));

    const record = await prisma.apiKey.findUnique({
      where: { keyHash: hashToken(presented) },
      select: { id: true, scopes: true, revokedAt: true, expiresAt: true },
    });

    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
      return next(unauthorized('API_KEY_INVALID', 'API key is not valid.'));
    }

    const granted = new Set(record.scopes);
    if (scopes.length && !scopes.every((s) => granted.has(s) || granted.has('*'))) {
      return next(forbidden('API_KEY_SCOPE', 'API key lacks the required scope.'));
    }

    req.apiKeyScopes = record.scopes;
    prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    next();
  };
}
