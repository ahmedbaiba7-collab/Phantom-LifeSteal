import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { cookieSecure, sameSitePolicy } from '../lib/cookies';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { mailer } from '../lib/mailer';
import {
  deviceFingerprint,
  fakeVerify,
  generateRecoveryCodes,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../lib/crypto';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors';
import { invalidatePermissionCache, signAccessToken } from '../middleware/auth';
import { securityEvent } from './audit.service';

const REFRESH_COOKIE = 'phantom_rt';
const LOCK_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true, // JavaScript can never read it, so XSS cannot steal the session
    secure: cookieSecure,
    sameSite: sameSitePolicy,
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1/auth', // sent only to the endpoints that need it
    maxAge: maxAgeMs,
    signed: true,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(env.REFRESH_TOKEN_TTL * 1000));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(0), maxAge: undefined });
}

export function readRefreshCookie(req: Request): string | null {
  const value = req.signedCookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionContext {
  ip: string;
  userAgent: string;
  deviceLabel: string;
}

function describeDevice(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('iphone') || ua.includes('ipad')
        ? 'iOS'
        : ua.includes('mac os')
          ? 'macOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Unknown OS';
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome')
      ? 'Chrome'
      : ua.includes('firefox')
        ? 'Firefox'
        : ua.includes('safari')
          ? 'Safari'
          : 'Unknown browser';
  return `${browser} on ${os}`;
}

async function createSession(
  userId: string,
  ctx: SessionContext,
  familyId = crypto.randomUUID(),
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const refreshToken = generateToken(48);

  const session = await prisma.session.create({
    data: {
      userId,
      familyId,
      refreshTokenHash: hashToken(refreshToken),
      ip: ctx.ip,
      userAgent: ctx.userAgent.slice(0, 500),
      deviceLabel: ctx.deviceLabel,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
    },
    select: { id: true },
  });

  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken,
    sessionId: session.id,
  };
}

/**
 * Refresh-token rotation with reuse detection.
 *
 * Every refresh mints a new token and burns the old one. If a burned token is
 * ever presented again, either the user replayed it or somebody stole it — and
 * we cannot tell which, so we assume theft: the entire family is revoked and a
 * critical security event is raised. That turns a stolen cookie from permanent
 * access into a single request followed by a forced re-login for the attacker
 * and the real user alike.
 */
export async function rotateRefreshToken(
  presented: string,
  ctx: SessionContext,
): Promise<{ accessToken: string; refreshToken: string }> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(presented) },
    select: {
      id: true,
      userId: true,
      familyId: true,
      usedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!session) throw unauthorized('REFRESH_INVALID', 'Please sign in again.');

  if (session.usedAt || session.revokedAt) {
    await prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'token_reuse_detected' },
    });
    await securityEvent('TOKEN_REUSE', {
      userId: session.userId,
      severity: 4,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      details: { familyId: session.familyId },
    });
    logger.error({ userId: session.userId, familyId: session.familyId }, 'refresh token reuse — family revoked');
    throw unauthorized('REFRESH_REUSED', 'For your security, all sessions were signed out.');
  }

  if (session.expiresAt < new Date()) {
    throw unauthorized('REFRESH_EXPIRED', 'Your session expired. Please sign in again.');
  }

  const nextToken = generateToken(48);

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'rotated' },
    }),
    prisma.session.create({
      data: {
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: hashToken(nextToken),
        ip: ctx.ip,
        userAgent: ctx.userAgent.slice(0, 500),
        deviceLabel: ctx.deviceLabel,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
      },
    }),
  ]);

  const fresh = await prisma.session.findFirstOrThrow({
    where: { refreshTokenHash: hashToken(nextToken) },
    select: { id: true },
  });

  return { accessToken: signAccessToken(session.userId, fresh.id), refreshToken: nextToken };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllSessions(userId: string, reason: string, exceptId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function register(input: {
  email: string;
  username: string;
  password: string;
  ip: string;
}): Promise<{ userId: string }> {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username: { equals: input.username, mode: 'insensitive' } }] },
    select: { id: true, email: true },
  });

  if (existing) {
    // Username collisions are unavoidable to disclose (the name is public), but
    // an email collision is not: same generic message either way.
    throw conflict('ACCOUNT_EXISTS', 'That email or username is already taken.');
  }

  const defaultRole = await prisma.role.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      email,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      lastLoginIp: input.ip,
      ...(defaultRole ? { roles: { create: { roleId: defaultRole.id } } } : {}),
    },
    select: { id: true, username: true, email: true },
  });

  const token = generateToken(32);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      type: 'EMAIL_VERIFY',
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });

  await mailer.verifyEmail(user.email, user.username, token);
  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export type LoginResult =
  | { status: 'ok'; accessToken: string; refreshToken: string; userId: string }
  | { status: '2fa_required'; challengeToken: string };

export async function login(
  input: { email: string; password: string; ip: string; userAgent: string },
): Promise<LoginResult> {
  const email = input.email.toLowerCase().trim();
  const ctx: SessionContext = {
    ip: input.ip,
    userAgent: input.userAgent,
    deviceLabel: describeDevice(input.userAgent),
  };

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      username: true,
      passwordHash: true,
      status: true,
      lockedUntil: true,
      failedLogins: true,
      twoFactorEnabled: true,
      emailVerifiedAt: true,
      deletedAt: true,
    },
  });

  // Identical work and identical message whether or not the account exists, so
  // response timing and error text both refuse to confirm an address.
  if (!user || user.deletedAt) {
    await fakeVerify();
    await recordAttempt(email, ctx, false, 'unknown_account');
    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  if (user.status === 'BANNED') {
    throw new AppError(403, 'ACCOUNT_BANNED', 'This account is banned. Open an appeal to contest it.');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);

  if (!valid) {
    const failed = user.failedLogins + 1;
    const shouldLock = failed >= LOCK_THRESHOLD;
    // Exponential backoff: 5 min, 10, 20, 40… capped at 24 h.
    const lockMinutes = Math.min(5 * 2 ** (failed - LOCK_THRESHOLD), 1440);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        ...(shouldLock ? { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } : {}),
      },
    });

    await recordAttempt(email, ctx, false, 'bad_password');
    if (shouldLock) {
      await securityEvent('ACCOUNT_LOCKED', {
        userId: user.id,
        severity: 3,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        details: { failedLogins: failed, lockMinutes },
      });
    }

    throw unauthorized('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ctx.ip },
  });
  await recordAttempt(email, ctx, true);
  await notifyIfNewDevice(user.id, user.email, user.username, ctx);

  if (user.twoFactorEnabled) {
    // A short-lived opaque challenge, stored server-side. No JWT here — a 2FA
    // gate that the client holds as a decodable token invites tampering.
    const challengeToken = generateToken(32);
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(challengeToken),
        type: 'TWO_FACTOR',
        payload: JSON.stringify(ctx),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    return { status: '2fa_required', challengeToken };
  }

  const tokens = await createSession(user.id, ctx);
  return { status: 'ok', ...tokens, userId: user.id };
}

async function recordAttempt(
  email: string,
  ctx: SessionContext,
  success: boolean,
  reason?: string,
): Promise<void> {
  await prisma.loginAttempt
    .create({
      data: { email, ip: ctx.ip, success, reason: reason ?? null, userAgent: ctx.userAgent.slice(0, 500) },
    })
    .catch(() => undefined);

  if (!success) {
    await securityEvent('LOGIN_FAILED', {
      severity: 1,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      details: { email, reason },
    });
  }
}

/**
 * A sign-in from an unseen device on an unseen network is not blocked — that
 * would punish anyone who travels — but it is recorded and emailed, so a
 * compromise is visible to the account owner within seconds.
 */
async function notifyIfNewDevice(
  userId: string,
  email: string,
  username: string,
  ctx: SessionContext,
): Promise<void> {
  const fingerprint = deviceFingerprint(ctx.userAgent, ctx.ip);

  const seen = await prisma.session.findFirst({
    where: { userId, userAgent: ctx.userAgent.slice(0, 500) },
    select: { id: true },
  });

  if (seen) return;

  await securityEvent('NEW_DEVICE', {
    userId,
    severity: 2,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    details: { fingerprint, device: ctx.deviceLabel },
  });
  await mailer.newDevice(email, username, ctx.ip, ctx.deviceLabel, new Date());
}

// ---------------------------------------------------------------------------
// Two-factor
// ---------------------------------------------------------------------------

export async function consumeTwoFactorChallenge(
  challengeToken: string,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(challengeToken) },
    select: { id: true, userId: true, type: true, payload: true, usedAt: true, expiresAt: true },
  });

  if (!record || record.type !== 'TWO_FACTOR' || record.usedAt || record.expiresAt < new Date()) {
    throw unauthorized('CHALLENGE_INVALID', 'That verification step expired. Sign in again.');
  }

  const ok = await verifyTwoFactorCode(record.userId, code);
  if (!ok) throw unauthorized('TWO_FACTOR_INVALID', 'That code is not correct.');

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  const ctx = JSON.parse(record.payload ?? '{}') as SessionContext;
  const tokens = await createSession(record.userId, {
    ip: ctx.ip ?? '0.0.0.0',
    userAgent: ctx.userAgent ?? 'unknown',
    deviceLabel: ctx.deviceLabel ?? 'Unknown device',
  });

  return { ...tokens, userId: record.userId };
}

/** Accepts either a live TOTP code or an unused recovery code. */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\s/g, '').toUpperCase();

  const secret = await prisma.twoFactorSecret.findUnique({
    where: { userId },
    select: { secretEnc: true, confirmedAt: true },
  });

  if (secret?.confirmedAt) {
    const { decrypt, totp } = await import('../lib/crypto');
    if (totp.verify(normalized.replace(/-/g, ''), decrypt(secret.secretEnc))) return true;
  }

  const codes = await prisma.recoveryCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true },
  });

  const match = codes.find((c) => c.codeHash === hashToken(normalized));
  if (!match) return false;

  await prisma.recoveryCode.update({ where: { id: match.id }, data: { usedAt: new Date() } });
  return true;
}

export async function beginTwoFactorSetup(userId: string, email: string) {
  const { encrypt, totp } = await import('../lib/crypto');
  const secret = totp.generateSecret();

  await prisma.twoFactorSecret.upsert({
    where: { userId },
    create: { userId, secretEnc: encrypt(secret) },
    update: { secretEnc: encrypt(secret), confirmedAt: null },
  });

  return { secret, otpauthUrl: totp.keyUri(email, secret) };
}

export async function confirmTwoFactorSetup(userId: string, code: string): Promise<string[]> {
  const { decrypt, totp } = await import('../lib/crypto');
  const record = await prisma.twoFactorSecret.findUnique({ where: { userId } });
  if (!record) throw badRequest('TWO_FACTOR_NOT_STARTED', 'Start two-factor setup first.');

  if (!totp.verify(code.replace(/\s/g, ''), decrypt(record.secretEnc))) {
    throw badRequest('TWO_FACTOR_INVALID', 'That code is not correct. Check your authenticator app.');
  }

  const codes = generateRecoveryCodes(10);

  await prisma.$transaction([
    prisma.twoFactorSecret.update({ where: { userId }, data: { confirmedAt: new Date() } }),
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashToken(c) })),
    }),
  ]);

  await securityEvent('TWO_FACTOR_ENABLED', { userId, severity: 2 });
  await invalidatePermissionCache(userId);

  // Shown exactly once. We store only hashes, so they cannot be recovered later.
  return codes;
}

// ---------------------------------------------------------------------------
// Password reset & email verification
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, username: true, deletedAt: true },
  });

  // Always return without error. The caller sends the same "check your inbox"
  // response either way, so this endpoint cannot enumerate registered emails.
  if (!user || user.deletedAt) return;

  await prisma.verificationToken.updateMany({
    where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = generateToken(32);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      type: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  await mailer.passwordReset(user.email, user.username, token);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  });

  if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('RESET_TOKEN_INVALID', 'That reset link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
      },
    }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  // A password change means every existing session is suspect.
  await revokeAllSessions(record.userId, 'password_reset');
  await securityEvent('PASSWORD_CHANGED', { userId: record.userId, severity: 2, details: { via: 'reset' } });
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  });

  if (!record || record.type !== 'EMAIL_VERIFY' || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('VERIFY_TOKEN_INVALID', 'That confirmation link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw badRequest('PASSWORD_INCORRECT', 'Your current password is not correct.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });

  await revokeAllSessions(userId, 'password_changed', keepSessionId);
  await securityEvent('PASSWORD_CHANGED', { userId, severity: 2, details: { via: 'settings' } });
}
