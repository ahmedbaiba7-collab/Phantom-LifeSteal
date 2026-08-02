import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

/**
 * Length is the dominant factor in password strength, so the floor is 10 rather
 * than the traditional 8-with-symbols. Composition rules are kept light — they
 * mostly push people toward P@ssw0rd1 — but the top breached passwords are
 * rejected outright.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'minecraft', 'minecraft1', 'iloveyou', 'letmein1', 'welcome1',
  'admin123', 'lifesteal', 'phantom123',
]);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'Passwords cannot exceed 128 characters.')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'That password appears in breach lists. Pick another.')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number.');

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Usernames need at least 3 characters.')
  .max(16, 'Usernames cannot exceed 16 characters.')
  .regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers and underscores only.');

export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i, 'Not a valid Minecraft UUID.');

export const cuidSchema = z.string().regex(/^c[a-z0-9]{20,}$/i, 'Invalid identifier.');

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const turnstileSchema = z.string().min(1, 'Complete the human check.').max(2048);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the rules to play.' }) }),
    captchaToken: turnstileSchema.optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((d) => !d.password.toLowerCase().includes(d.username.toLowerCase()), {
    message: 'Your password cannot contain your username.',
    path: ['password'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
  captchaToken: turnstileSchema.optional(),
});

export const twoFactorSchema = z.object({
  challengeToken: z.string().min(10),
  code: z.string().trim().min(6).max(12),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  captchaToken: turnstileSchema.optional(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Choose a password you have not used here before.',
    path: ['newPassword'],
  });

export const verifyTokenSchema = z.object({ token: z.string().min(10).max(200) });

/** A TOTP code or a recovery code, used when enabling or disabling 2FA. */
export const authenticatorCodeSchema = z.object({
  code: z.string().trim().min(6, 'Enter the full code.').max(12),
});

export const confirmPasswordOnlySchema = z.object({
  password: z.string().min(1, 'Confirm with your password.').max(128),
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const updateProfileSchema = z.object({
  bio: z.string().trim().max(280).optional(),
  locale: z.enum(['en', 'ar', 'fr']).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
});

export const linkMinecraftSchema = z.object({
  ign: usernameSchema,
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const cartItemSchema = z.object({
  productId: cuidSchema,
  quantity: z.number().int().min(1).max(10).default(1),
});

export const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1, 'Your cart is empty.').max(20),
  couponCode: z.string().trim().toUpperCase().max(32).optional(),
  giftToIgn: usernameSchema.optional(),
  idempotencyKey: z.string().min(8).max(64),
});

export const couponCheckSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(32),
  subtotal: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export const createTicketSchema = z.object({
  type: z.enum(['SUPPORT', 'BUG', 'REPORT', 'APPEAL', 'SUGGESTION']),
  subject: z.string().trim().min(6, 'Give your ticket a clear subject.').max(160),
  body: z.string().trim().min(20, 'Add a few more details so staff can help.').max(5000),
  captchaToken: turnstileSchema.optional(),
});

export const ticketMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  staffOnly: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export const commentSchema = z.object({
  body: z.string().trim().min(2).max(2000),
});

export const newsSchema = z.object({
  title: z.string().trim().min(4).max(160),
  slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/, 'Slug must be lowercase letters, numbers and dashes.'),
  excerpt: z.string().trim().min(20).max(320),
  body: z.string().min(20).max(100_000),
  coverUrl: z.string().url().max(500).optional().nullable(),
  category: z.string().trim().max(40).default('update'),
  tags: z.array(z.string().trim().max(24)).max(8).default([]),
  pinned: z.boolean().default(false),
  published: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export const leaderboardParamsSchema = z.object({
  board: z.enum([
    'kills', 'deaths', 'hearts', 'balance', 'playtime', 'votes', 'streak', 'kdr',
  ]),
});

export const leaderboardQuerySchema = z.object({
  period: z.enum(['all', 'month', 'week']).default('all'),
  limit: z.coerce.number().int().min(5).max(100).default(25),
});

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export const voteClaimSchema = z.object({
  siteKey: z.string().trim().min(1).max(40),
});

// ---------------------------------------------------------------------------
// Plugin integration
// ---------------------------------------------------------------------------

export const statsPushSchema = z.object({
  tps: z.number().min(0).max(20).optional(),
  players: z
    .array(
      z.object({
        uuid: uuidSchema,
        ign: usernameSchema,
        kills: z.number().int().min(0),
        deaths: z.number().int().min(0),
        heartsStolen: z.number().int().min(0),
        heartsLost: z.number().int().min(0),
        maxHearts: z.number().int().min(0).max(200),
        currentHearts: z.number().int().min(0).max(200),
        killStreak: z.number().int().min(0),
        playtimeMinutes: z.number().int().min(0),
        blocksMined: z.number().int().min(0).default(0),
        moneyBalance: z.number().int().min(0).default(0),
      }),
    )
    .max(500),
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const punishSchema = z.object({
  userId: cuidSchema,
  type: z.enum(['WARN', 'MUTE', 'KICK', 'TEMPBAN', 'BAN']),
  reason: z.string().trim().min(4).max(500),
  evidence: z.string().url().max(500).optional(),
  durationHours: z.number().int().min(1).max(8760).optional(),
});

export const roleAssignSchema = z.object({
  userId: cuidSchema,
  roleKey: z.string().trim().min(1).max(40),
  expiresAt: z.coerce.date().optional(),
});

export const roleSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  weight: z.number().int().min(0).max(99),
  isStaff: z.boolean().default(false),
  permissions: z.array(z.string().trim().max(60)).max(200),
});

export const settingSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.unknown(),
});


// ───────────────────────────── Coins economy ─────────────────────────────

export const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const coinShopQuerySchema = z.object({
  search: z.string().trim().max(60).optional(),
  category: z.string().trim().max(40).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).max(10_000_000).optional(),
  sort: z.enum(['featured', 'price_asc', 'price_desc', 'name']).default('featured'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

export const coinPurchaseSchema = z.object({
  productId: z.string().cuid('Unknown item.'),
  quantity: z.number().int().min(1, 'Buy at least one.').max(64, 'Sixty-four at a time is the limit.'),
  /// Generated by the client per confirmation, so a retry cannot double-charge.
  idempotencyKey: z.string().min(8).max(64),
});

export const coinAdjustSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Enter a non-zero amount.')
    .refine((n) => Math.abs(n) <= 1_000_000, 'That is beyond the single-adjustment limit.'),
  reason: z.string().trim().min(3, 'Say why — this goes in the audit log.').max(200),
});
