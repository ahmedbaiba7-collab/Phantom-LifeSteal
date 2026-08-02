import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import { cookieSecure, sameSitePolicy } from '../lib/cookies';
import { AppError } from '../lib/errors';
import { timingSafeEqual } from '../lib/crypto';
import { prisma } from '../lib/prisma';

const CSRF_COOKIE = 'phantom_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF.
 *
 * The token is issued in a readable cookie and must be echoed in a header. An
 * attacker's page can cause the cookie to be sent, but the same-origin policy
 * stops it from reading the cookie to set the header. This sits behind
 * SameSite=Lax on the session cookie and the Origin check in security.ts, so
 * defeating CSRF requires breaking all three independently.
 */
export function issueCsrfToken(_req: Request, res: Response, next: NextFunction): void {
  if (!_req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // the browser app must read it to set the header
      secure: cookieSecure,
      sameSite: sameSitePolicy,
      domain: env.COOKIE_DOMAIN,
      path: '/',
      maxAge: 86_400_000,
    });
  }
  next();
}

export const verifyCsrf: RequestHandler = async (req, _res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  // Key- or signature-authenticated callers are not browsers and carry no
  // ambient cookie credentials, so CSRF does not apply to them.
  if (req.get('x-api-key') || req.path.startsWith('/api/v1/webhooks')) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    await prisma.securityEvent
      .create({
        data: {
          type: 'CSRF_REJECTED',
          severity: 3,
          ip: req.realIp,
          userAgent: req.get('user-agent')?.slice(0, 500),
          details: { path: req.path, method },
        },
      })
      .catch(() => undefined);
    return next(new AppError(403, 'CSRF_INVALID', 'Your session token expired. Refresh the page and try again.'));
  }

  next();
};
