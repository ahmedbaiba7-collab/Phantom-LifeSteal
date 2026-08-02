import 'dotenv/config';
import { z } from 'zod';

/**
 * Every secret is validated at boot. The process refuses to start on a missing
 * value or on a placeholder that was copied out of .env.example — a server that
 * silently runs with `replace_me` as its JWT secret is worse than one that
 * refuses to start.
 */

const PLACEHOLDERS = [
  'replace_with_openssl_rand_hex_64',
  'replace_with_openssl_rand_hex_32',
  'change_me',
  'changeme',
  'secret',
  'password',
];

const strongSecret = (min: number) =>
  z
    .string()
    .min(min, `must be at least ${min} characters`)
    .refine(
      (v) => !PLACEHOLDERS.some((p) => v.toLowerCase().includes(p)),
      'still contains a placeholder value from .env.example',
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  WEB_ORIGIN: z.string().url(),
  API_ORIGIN: z.string().url(),
  COOKIE_DOMAIN: z.string().optional(),

  DATABASE_URL: z.string().startsWith('postgres'),
  REDIS_URL: z.string().startsWith('redis'),

  JWT_ACCESS_SECRET: strongSecret(48),
  JWT_REFRESH_SECRET: strongSecret(48),
  COOKIE_SECRET: strongSecret(32),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  MAIL_FROM: z.string().min(3),

  MC_HOST: z.string().min(1),
  MC_PORT: z.coerce.number().int().positive().default(25565),
  MC_RCON_HOST: z.string().default('127.0.0.1'),
  MC_RCON_PORT: z.coerce.number().int().positive().default(25575),
  MC_RCON_PASSWORD: z.string().optional(),
  PLUGIN_API_KEY: strongSecret(32),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STORE_CURRENCY: z.string().length(3).default('USD'),

  TURNSTILE_SECRET_KEY: z.string().optional(),

  BACKUP_DIR: z.string().default('/var/backups/phantom'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

if (isProd && !env.STRIPE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[env] STRIPE_SECRET_KEY is unset — checkout will reject requests.');
}
