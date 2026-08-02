import { Router } from 'express';
import { env } from '../config/env';
import { validate } from '../middleware/validate';
import { limits } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';
import { verifyCsrf } from '../middleware/csrf';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  twoFactorSchema,
  verifyTokenSchema,
} from '../schemas';
import * as auth from '../services/auth.service';
import { audit } from '../services/audit.service';
import { logger } from '../lib/logger';

const router = Router();

/** Cloudflare Turnstile. Silently skipped when no secret is configured (dev). */
async function verifyCaptcha(token: string | undefined, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch (err) {
    // A Turnstile outage must not lock everyone out of the site. Rate limiting
    // and lockout remain in force, so failing open here is bounded.
    logger.error({ err }, 'turnstile verification unavailable — allowing');
    return true;
  }
}

const ctxOf = (req: Parameters<typeof verifyCsrf>[0]) => ({
  ip: req.realIp,
  userAgent: req.get('user-agent') ?? 'unknown',
  deviceLabel: 'unknown',
});

/**
 * POST /auth/register
 * Creates an unverified account and mails a confirmation link.
 */
router.post('/register', limits.register, validate(registerSchema), async (req, res, next) => {
  try {
    if (!(await verifyCaptcha(req.body.captchaToken, req.realIp))) {
      return res.status(400).json({
        error: { code: 'CAPTCHA_FAILED', message: 'The human check failed. Try again.', requestId: req.id },
      });
    }

    const { userId } = await auth.register({
      email: req.body.email,
      username: req.body.username,
      password: req.body.password,
      ip: req.realIp,
    });

    await audit(req, { action: 'auth.register', targetType: 'user', targetId: userId });

    res.status(201).json({
      data: {
        message: 'Account created. Check your email to confirm the address.',
        email: req.body.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/login
 * Returns an access token plus an HttpOnly refresh cookie, or a 2FA challenge.
 */
router.post('/login', limits.auth, validate(loginSchema), async (req, res, next) => {
  try {
    if (!(await verifyCaptcha(req.body.captchaToken, req.realIp))) {
      return res.status(400).json({
        error: { code: 'CAPTCHA_FAILED', message: 'The human check failed. Try again.', requestId: req.id },
      });
    }

    const result = await auth.login({
      email: req.body.email,
      password: req.body.password,
      ip: req.realIp,
      userAgent: req.get('user-agent') ?? 'unknown',
    });

    if (result.status === '2fa_required') {
      return res.json({
        data: { twoFactorRequired: true, challengeToken: result.challengeToken },
      });
    }

    auth.setRefreshCookie(res, result.refreshToken);
    await audit(req, { action: 'auth.login', targetType: 'user', targetId: result.userId });

    res.json({
      data: { accessToken: result.accessToken, expiresIn: env.ACCESS_TOKEN_TTL },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/2fa/verify — completes a login that required a second factor. */
router.post('/2fa/verify', limits.twoFactor, validate(twoFactorSchema), async (req, res, next) => {
  try {
    const result = await auth.consumeTwoFactorChallenge(req.body.challengeToken, req.body.code);
    auth.setRefreshCookie(res, result.refreshToken);
    await audit(req, { action: 'auth.login.2fa', targetType: 'user', targetId: result.userId });
    res.json({ data: { accessToken: result.accessToken, expiresIn: env.ACCESS_TOKEN_TTL } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/refresh
 * Rotates the refresh token. Presenting a burned token revokes the whole family.
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const presented = auth.readRefreshCookie(req);
    if (!presented) {
      return res.status(401).json({
        error: { code: 'REFRESH_MISSING', message: 'Sign in to continue.', requestId: req.id },
      });
    }

    const tokens = await auth.rotateRefreshToken(presented, ctxOf(req));
    auth.setRefreshCookie(res, tokens.refreshToken);
    res.json({ data: { accessToken: tokens.accessToken, expiresIn: env.ACCESS_TOKEN_TTL } });
  } catch (err) {
    auth.clearRefreshCookie(res);
    next(err);
  }
});

/** POST /auth/logout — revokes this session only. */
router.post('/logout', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    await auth.revokeSession(req.user!.sessionId, 'user_logout');
    auth.clearRefreshCookie(res);
    await audit(req, { action: 'auth.logout', targetType: 'session', targetId: req.user!.sessionId });
    res.json({ data: { message: 'Signed out.' } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/logout-all — revokes every session on the account. */
router.post('/logout-all', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const count = await auth.revokeAllSessions(req.user!.id, 'user_logout_all');
    auth.clearRefreshCookie(res);
    await audit(req, { action: 'auth.logout.all', targetType: 'user', targetId: req.user!.id, after: { count } });
    res.json({ data: { message: `Signed out of ${count} device${count === 1 ? '' : 's'}.` } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/forgot-password
 * Always answers identically so the endpoint cannot enumerate accounts.
 */
router.post('/forgot-password', limits.passwordReset, validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    await verifyCaptcha(req.body.captchaToken, req.realIp);
    await auth.requestPasswordReset(req.body.email);
    res.json({
      data: { message: 'If that address has an account, a reset link is on its way.' },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/reset-password — consumes a single-use reset token. */
router.post('/reset-password', limits.passwordReset, validate(resetPasswordSchema), async (req, res, next) => {
  try {
    await auth.resetPassword(req.body.token, req.body.password);
    res.json({ data: { message: 'Password updated. Sign in with your new password.' } });
  } catch (err) {
    next(err);
  }
});

/** POST /auth/verify-email — confirms an address from the emailed link. */
router.post('/verify-email', validate(verifyTokenSchema), async (req, res, next) => {
  try {
    await auth.verifyEmail(req.body.token);
    res.json({ data: { message: 'Email confirmed. Your account is fully active.' } });
  } catch (err) {
    next(err);
  }
});

export default router;
