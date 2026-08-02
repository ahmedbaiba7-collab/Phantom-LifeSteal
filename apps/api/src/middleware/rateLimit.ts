import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { tooMany } from '../lib/errors';
import { prisma } from '../lib/prisma';

interface LimitOptions {
  /** Window length in seconds. */
  window: number;
  /** Maximum requests permitted inside the window. */
  max: number;
  /** Bucket name, so two routes never share a counter by accident. */
  key: string;
  /** Derive the identity being limited. Defaults to client IP. */
  identify?: (req: Request) => string;
  /** Skip counting successful responses (used on login: only failures count). */
  skipSuccessful?: boolean;
  /** Record a SecurityEvent when tripped. */
  audit?: boolean;
}

/**
 * Sliding window over a Redis sorted set.
 *
 * A fixed window lets an attacker send 2× the limit across a boundary; a sorted
 * set of timestamps costs one pipeline and gives an exact rolling count. The
 * whole thing is atomic via MULTI, so concurrent requests cannot both read a
 * stale count and both pass.
 */
export function rateLimit(opts: LimitOptions): RequestHandler {
  const { window, max, key, identify, skipSuccessful = false, audit = false } = opts;

  return async function limiter(req: Request, res: Response, next: NextFunction) {
    const identity = identify ? identify(req) : req.realIp;
    const bucket = `rl:${key}:${identity}`;
    const now = Date.now();
    const windowMs = window * 1000;

    try {
      const results = await redis
        .multi()
        .zremrangebyscore(bucket, 0, now - windowMs)
        .zcard(bucket)
        .zadd(bucket, now, `${now}-${Math.random().toString(36).slice(2, 10)}`)
        .pexpire(bucket, windowMs)
        .exec();

      const count = (results?.[1]?.[1] as number | undefined) ?? 0;
      const remaining = Math.max(0, max - count - 1);

      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(window));

      if (count >= max) {
        res.setHeader('Retry-After', window);
        if (audit) {
          await prisma.securityEvent
            .create({
              data: {
                type: 'RATE_LIMIT_TRIPPED',
                severity: 2,
                ip: req.realIp,
                userAgent: req.get('user-agent')?.slice(0, 500),
                details: { bucket: key, path: req.path },
              },
            })
            .catch(() => undefined);
        }
        logger.warn({ bucket: key, identity, path: req.path }, 'rate limit tripped');
        return next(tooMany());
      }

      if (skipSuccessful) {
        // Remove this request's entry once we know it succeeded, so a member
        // with the right password is never locked out by their own traffic.
        res.on('finish', () => {
          if (res.statusCode < 400) {
            redis.zremrangebyscore(bucket, now, now).catch(() => undefined);
          }
        });
      }

      next();
    } catch (err) {
      // Fail open on a Redis outage: the edge limiter in Nginx still applies,
      // and taking the whole site down because a cache blinked is worse.
      logger.error({ err, bucket: key }, 'rate limiter unavailable — allowing request');
      next();
    }
  };
}

const byEmailOrIp = (req: Request): string => {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : '';
  return email ? `${email}|${req.realIp}` : req.realIp;
};

/** Tiered presets. Tighter the closer a route sits to credentials or money. */
export const limits = {
  global: rateLimit({ key: 'global', window: 60, max: 120 }),
  auth: rateLimit({ key: 'auth', window: 900, max: 5, identify: byEmailOrIp, skipSuccessful: true, audit: true }),
  register: rateLimit({ key: 'register', window: 3600, max: 3, audit: true }),
  passwordReset: rateLimit({ key: 'pwreset', window: 3600, max: 3, identify: byEmailOrIp, audit: true }),
  twoFactor: rateLimit({ key: '2fa', window: 300, max: 6, audit: true }),
  checkout: rateLimit({ key: 'checkout', window: 300, max: 10 }),
  purchase: rateLimit({ key: 'purchase', window: 60, max: 20 }),
  ticket: rateLimit({ key: 'ticket', window: 3600, max: 8 }),
  comment: rateLimit({ key: 'comment', window: 300, max: 10 }),
  vote: rateLimit({ key: 'vote', window: 60, max: 10 }),
  upload: rateLimit({ key: 'upload', window: 3600, max: 20 }),
};
