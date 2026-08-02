import crypto from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { env } from '../config/env';

// ------------------------------------------------------------------
// Passwords — Argon2id, OWASP-recommended parameters.
// Memory-hard by design: 64 MiB per hash makes large-scale GPU cracking
// economically unattractive in a way bcrypt's cost factor no longer does.
// ------------------------------------------------------------------

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same CPU as a real verification when the account does not
 * exist, so response timing cannot be used to enumerate registered emails.
 */
export async function fakeVerify(): Promise<void> {
  await argon2.hash(crypto.randomBytes(16).toString('hex'), ARGON2_OPTIONS);
}

// ------------------------------------------------------------------
// Opaque tokens — generated random, handed to the user once, stored hashed.
// A database dump therefore yields no usable session or reset link.
// ------------------------------------------------------------------

export function generateToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ------------------------------------------------------------------
// Symmetric encryption — used for TOTP secrets and third-party tokens.
// AES-256-GCM: confidentiality plus integrity, so a tampered ciphertext
// fails to decrypt rather than silently producing garbage.
// ------------------------------------------------------------------

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed ciphertext');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    KEY,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ------------------------------------------------------------------
// TOTP (RFC 6238)
// ------------------------------------------------------------------

authenticator.options = { window: 1, step: 30 };

export const totp = {
  generateSecret: () => authenticator.generateSecret(),
  keyUri: (account: string, secret: string) =>
    authenticator.keyuri(account, 'LifeSteal Phantom', secret),
  verify: (token: string, secret: string) => {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  },
};

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  );
}

// ------------------------------------------------------------------
// HTML sanitisation — the news editor is the only place user input is
// rendered as markup, and it is cleaned server-side before storage.
// ------------------------------------------------------------------

const purify = createDOMPurify(new JSDOM('').window as unknown as Window);

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'blockquote', 'code', 'pre',
      'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'table',
      'thead', 'tbody', 'tr', 'th', 'td', 'span',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height', 'class'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/)/i,
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
  });
}

/** Strip all markup — for anything that is never rendered as HTML. */
export function sanitizeText(input: string): string {
  return purify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
}

/**
 * Coarse device fingerprint used only to notice "this login came from somewhere
 * new". Deliberately not a tracking identifier: UA plus network, nothing more.
 */
export function deviceFingerprint(userAgent: string, ip: string): string {
  const network = ip.split('.').slice(0, 2).join('.');
  return crypto.createHash('sha256').update(`${userAgent}|${network}`).digest('hex').slice(0, 32);
}
