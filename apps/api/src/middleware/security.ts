import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import express from 'express';
import pinoHttp from 'pino-http';
import { env, isProd } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      cspNonce: string;
      realIp: string;
    }
  }
}

/** Correlates a request across access log, error body and audit row. */
function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.cspNonce = crypto.randomBytes(16).toString('base64');
  req.realIp = (req.ip ?? req.socket.remoteAddress ?? '0.0.0.0').replace('::ffff:', '');
  res.setHeader('x-request-id', req.id);
  next();
}

/**
 * Origin check. Layer three of CSRF defence, behind SameSite cookies and the
 * double-submit token — cheap, and it stops the simplest cross-site POSTs
 * before any handler allocates work.
 */
function originGuard(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  // Server-to-server callers (plugin, Stripe) authenticate with a key or a
  // signature and legitimately send no Origin header.
  if (req.get('x-api-key') || req.path.startsWith('/api/v1/webhooks')) return next();

  const origin = req.get('origin') ?? req.get('referer');
  if (!origin) {
    return next(new AppError(403, 'ORIGIN_MISSING', 'Request origin could not be verified.'));
  }
  if (!origin.startsWith(env.WEB_ORIGIN) && !origin.startsWith(env.API_ORIGIN)) {
    return next(new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.'));
  }
  next();
}

export function applySecurity(app: Express): void {
  // Behind Nginx, so the client IP arrives in X-Forwarded-For. The hop count is
  // explicit — a wildcard here would let a client spoof its own IP and defeat
  // every per-IP rate limit below.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'", (req) => `'nonce-${(req as Request).cspNonce}'`],
          styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind emits inline critical CSS
          imgSrc: ["'self'", 'data:', 'https://crafatar.com', 'https://mc-heads.net'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", env.API_ORIGIN],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProd ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true,
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin and non-browser callers send no Origin.
        if (!origin) return cb(null, true);
        if (origin === env.WEB_ORIGIN || origin === env.API_ORIGIN) return cb(null, true);
        cb(new AppError(403, 'CORS_REJECTED', 'Origin not allowed.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-api-key', 'x-request-id', 'x-idempotency-key'],
      exposedHeaders: ['x-request-id'],
      maxAge: 86_400,
    }),
  );

  // 100 kB is generous for JSON. Uploads use their own multipart route with its
  // own limit, so a 50 MB body cannot be posted at an auth endpoint.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(hpp()); // ?role=user&role=admin must not become an array a handler misreads
  app.use(compression({ threshold: 1024 }));
  app.use(originGuard);
}
