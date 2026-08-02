# LifeSteal Phantom — Architecture, Data, API & Security Design

This is the design pass the brief asked for: analysis → architecture → database → API → UI → security → permissions → technology rationale. The implementation follows it exactly.

---

## 1. Analysis

A Minecraft network portal is not a content site. It is a **transactional, account-bearing, money-handling application** whose users are overwhelmingly teenagers on mid-range phones, whose traffic is spiky (a YouTube video or a vote-site reset can 20× concurrency in a minute), and whose adversaries are motivated and bored — credential stuffing, chargeback fraud, coupon abuse, vote-reward farming and XSS through ticket text are routine, not hypothetical.

Three properties drive every decision below:

1. **Read-heavy, write-narrow.** Home, leaderboards, wiki and news are ~95% of requests and are identical for everyone. Checkout, auth and tickets are tiny volume, high value. → Aggressive caching on the read path; strict, uncached, rate-limited handling on the write path.
2. **The Minecraft server is an untrusted, frequently-offline dependency.** Never block a page render on a socket to port 25565. → A worker polls status into Redis; the site reads the cache and degrades gracefully.
3. **Money and permissions are the crown jewels.** Anything touching a balance, a rank grant or a role must be append-only-audited and idempotent.

---

## 2. System architecture

```
                        +------------------------------+
   Players -- HTTPS --> |  Nginx (TLS, HTTP/2, brotli, |
                        |  HSTS, CSP, L7 rate limits)  |
                        +-------+--------------+-------+
                                |              |
                       / (SSR)  |              |  /api/*
                        +-------v------+  +----v-------------+
                        |  Next.js 15  |  |  Express API     |
                        |  App Router  |->|  TypeScript      |
                        |  RSC + ISR   |  |  Zod + Prisma    |
                        +--------------+  +--+-----------+---+
                                             |           |
                             +---------------v--+  +-----v------------+
                             |  PostgreSQL 16   |  |  Redis 7         |
                             |  source of truth |  |  cache, limits,  |
                             |                  |  |  sessions, jobs  |
                             +------------------+  +-----+------------+
                                                         |
                                          +--------------v--------------+
                                          | Worker: MC status poller,   |
                                          | mail queue, backups, vote   |
                                          | reconciliation, deliveries  |
                                          +--------------+--------------+
                                                         | RCON / plugin webhook
                                                 +-------v--------+
                                                 | Paper server   |
                                                 +----------------+
```

**Why a separate Express API rather than Next.js route handlers only?** The in-game plugin, the Discord bot and any future mobile app need the same endpoints. Logic inside route handlers couples business rules to the rendering framework. A standalone API scales independently (the store never slows down because a crawler is walking the wiki), and is testable without a browser. Next.js still owns rendering and calls the API server-side.

**Statelessness.** The API holds no in-process state. Sessions live in Postgres (durable, revocable, auditable) with a Redis mirror for hot lookups, so any instance serves any request and scaling is `docker compose up --scale api=4`.

---

## 3. Database design

PostgreSQL 16 + Prisma. Full schema: `apps/api/prisma/schema.prisma`.

| Domain | Tables |
|---|---|
| Identity | `User`, `Role`, `RolePermission`, `UserRole`, `MinecraftAccount`, `DiscordLink` |
| Sessions | `Session` (one per device, hashed refresh token), `LoginAttempt` |
| Verification | `VerificationToken` (verify / reset / email-change — hashed, single-use, TTL) |
| 2FA | `TwoFactorSecret` (encrypted), `RecoveryCode` (hashed) |
| Gameplay | `PlayerStats`, `StatSnapshot`, `Punishment` |
| Store | `Product`, `Coupon`, `Order`, `OrderItem`, `Payment`, `Delivery`, `Gift` |
| Content | `NewsPost`, `Comment`, `CommentLike`, `WikiCategory`, `WikiArticle`, `Faq`, `ServerEvent` |
| Support | `Ticket`, `TicketMessage` (SUPPORT / BUG / REPORT / APPEAL / SUGGESTION) |
| Voting | `VoteSite`, `Vote`, `VoteReward` |
| Ops | `AuditLog`, `SecurityEvent`, `Notification`, `ApiKey`, `SiteSetting`, `Backup` |

**Key modelling decisions**

- **No raw token is ever stored.** Refresh tokens, verification tokens, API keys and recovery codes are kept as SHA-256 digests. A database dump grants no sessions.
- **Money is an `Int` in minor units** (cents / coins). No floats near a balance, ever.
- **`Order` is idempotent** on `(userId, idempotencyKey)` — a double-clicked checkout cannot double-charge.
- **`Delivery` decouples payment from in-game fulfilment.** If the server is offline the row stays `PENDING` and the worker retries with backoff; the player never loses a purchase.
- **`AuditLog` is append-only** (`actor`, `action`, `targetType`, `targetId`, `before`, `after`, `ip`, `userAgent`); production grants no UPDATE/DELETE on it to the app role.
- **Leaderboards** read `PlayerStats` through covering indexes, cached 60 s in Redis; `StatSnapshot` powers "+12 this week" deltas without scanning history.
- **Soft delete** (`deletedAt`) on user content so moderation is reversible. Account erasure anonymises rather than cascades — orders must survive for accounting.

---

## 4. API design

REST, versioned at `/api/v1`, JSON only, OpenAPI 3 served at `/api/docs`.

| Group | Representative endpoints |
|---|---|
| Auth | `POST /auth/register` `/auth/login` `/auth/2fa/verify` `/auth/refresh` `/auth/logout` `/auth/forgot-password` `/auth/reset-password` `GET /auth/verify-email` |
| Me | `GET /me` `PATCH /me` `POST /me/password` `GET/DELETE /me/sessions` `POST /me/2fa/setup` `GET /me/notifications` |
| Server | `GET /server/status` `/server/players` |
| Content | `GET /news` `/news/:slug` `POST /news/:slug/comments` `GET /wiki` `/wiki/:slug` `/faq` |
| Store | `GET /store/products` `POST /store/coupon/check` `/store/checkout` `GET /store/orders` `/store/orders/:id/invoice` |
| Voting | `GET /vote/sites` `POST /vote/claim` |
| Leaderboards | `GET /leaderboards/:board?period=all|month|week` |
| Support | `POST /tickets` `GET /tickets` `/tickets/:id` `POST /tickets/:id/messages` |
| Admin | `/admin/users` `/roles` `/news` `/store` `/tickets` `/audit` `/security` `/settings` `/backups` `/console` |
| Integration | `POST /integration/stats` `/integration/punishments` (plugin, API-key auth) |

**Conventions**

- Every request carries an `x-request-id` that appears in logs and error bodies.
- Errors are `{ error: { code, message, details?, requestId } }` with stable codes (`AUTH_INVALID_CREDENTIALS`) that never reveal whether an email exists.
- All input passes a Zod schema before a service sees it; unknown keys are stripped, not ignored.
- Cursor pagination everywhere a list can grow — offset pagination degrades on deep pages and leaks counts.
- Cache policy is explicit per route: `public, s-maxage=60, stale-while-revalidate=300` for content, `no-store` for anything authenticated.

---

## 5. Security model

**Edge (Nginx).** TLS 1.2/1.3 only, HSTS preload, request/connection rate zones per IP, 1 MB JSON body cap, uploads isolated, server tokens off.

**Headers.** Helmet with an explicit CSP (`default-src 'self'`, no `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`), COOP/CORP/Referrer-Policy set, CORS allow-listing exactly one origin with credentials.

**Authentication.**
- Argon2id (64 MB, t=3, p=1) — memory-hard and GPU-hostile; bcrypt's 72-byte truncation and low memory cost make it the weaker option.
- 15-minute access JWT held in memory + 30-day refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to the API origin.
- **Refresh rotation with reuse detection**: each refresh mints a new token and burns the old one; presenting a burned token revokes the whole session family and raises a `SecurityEvent`. This turns a stolen cookie from permanent access into one request plus an alert.
- Lockout with exponential backoff after 5 failures per (email, IP), applied identically whether or not the account exists.
- TOTP 2FA (RFC 6238), secrets encrypted at rest with AES-256-GCM, recovery codes hashed and single-use.
- Suspicious-login detection: unseen IP + unseen device fingerprint → email alert and `SecurityEvent`.

**Authorization.** Permission-string RBAC (`news.publish`, `store.refund`, `admin.console.read`). Roles are rows, not enums, so the Owner can invent a "Media" role without a deploy. Default is deny; every protected route declares its permission. Ownership checks live in services, not routers, so a new entry point cannot bypass them. Staff act only on strictly lower `weight` — a Moderator cannot ban an Administrator.

**Injection & content.** Prisma parameterises every query; no string-built SQL exists in the codebase. User content is sanitised server-side (allow-list HTML for news, plain text elsewhere) *and* escaped by React on output. `dangerouslySetInnerHTML` appears once, on already-sanitised news bodies.

**CSRF.** Session-bound double-submit token on every cookie-authenticated write, plus `SameSite=Lax` and an `Origin` check as layers two and three.

**Abuse.** Redis sliding-window limits, tiered: 5 / 15 min on login, 3 / h on password reset, 10 / min on ticket creation, 100 / min general. Turnstile on register, login, reset and ticket. Vote claims are reconciled against the vote site's callback, never trusted from the client.

**Uploads.** Extension + magic-byte + dimension checks, re-encoded through sharp (strips EXIF and any polyglot payload), stored outside the web root under a random UUID, served with `nosniff` and `Content-Disposition: attachment`. A ClamAV hook point is provided.

**Secrets.** Zod-validated at boot — the process refuses to start on a missing or still-default secret. Nothing is read from source.

**Backups.** Nightly compressed `pg_dump`, checksummed, 14-day retention, with a scripted restore path — an untested backup is not a backup, so `scripts/restore.sh` ships with it.

---

## 6. Permission system

Ten seeded roles — Guest, Player, VIP, VIP+, MVP, Legend, Moderator, Administrator, Owner, Developer — each a `Role` row with `weight` (hierarchy), `color`, and a set of `RolePermission` rows. Users may hold several roles; effective permissions are the union, cached at `perms:{userId}` in Redis and invalidated on any role change. Wildcards (`store.*`, `*`) resolve at check time.

---

## 7. Technology rationale

| Choice | Why this, not the alternative |
|---|---|
| **Next.js App Router** | Server Components render marketing and wiki pages to HTML with no client JS cost — which is what actually yields 95+ Lighthouse on the phones this audience uses. ISR gives near-static delivery with 60-second freshness. A SPA would ship the entire store to a phone before showing one pixel. |
| **TypeScript, strict** | Web and API share Zod schemas, so renaming a field in the order model becomes a compile error in checkout instead of a runtime `undefined` in production. |
| **Express** | Deliberately boring. Its middleware model maps one-to-one onto layered security (helmet → cors → limit → csrf → auth → rbac → validate → handler), and every hardening technique for it is decade-proven. Novelty is a liability in the auth path. |
| **PostgreSQL** | Purchases and balances need real transactions, real constraints and composite indexes for leaderboards. A document store pushes referential integrity into application code, which is where money bugs live. |
| **Prisma** | Versioned reviewable migrations, a fully typed client, and structurally parameterised queries — injection is prevented by construction rather than by discipline. |
| **Redis** | Rate limiting needs an atomic shared expiring counter; cached status needs sub-millisecond reads during a spike. Postgres does both, badly. |
| **TailwindCSS** | Ships only the classes used, so total CSS is a few kilobytes, and design tokens live in one config instead of drifting across stylesheets. |
| **Framer Motion** | Declarative, respects `prefers-reduced-motion`, and animates transform/opacity only — the two properties that stay on the compositor and off the main thread. |
| **Docker + Nginx** | Identical images in CI, staging and production; TLS, compression and edge limits terminate before Node allocates a request object. |
| **GitHub Actions** | Type-check, lint, test, `prisma migrate diff`, `npm audit` and a Trivy scan gate every merge — a security review as a pipeline step rather than a good intention. |

---

## 8. UI direction

Black substrate, purple neon, glassmorphism as specified — built around one signature idea instead of generic gradient cards.

- **Palette.** `--void #07060B`, `--panel #0F0B1B`, `--neon #A855F7`, `--neon-hot #C77DFF`, `--heart #FF2E63`, `--text #EDE9FE`, `--muted #948CAD`. The red is reserved exclusively for hearts and destructive actions — it never decorates, so when it appears it always means *life*.
- **Type.** Display **Chakra Petch** (angular, chamfered — gaming hardware, not a birthday party); body **Sora**; data **JetBrains Mono**, because a leaderboard is a table of numbers and numbers should be tabular.
- **Signature: the Heart Ledger.** The hero is not a headline over a screenshot; it is a live ledger of hearts — the one currency that defines LifeSteal — with hearts that drain and refill from real network stats, beside a rail carrying TPS, players online and version. The mechanic *is* the hero.
- **Restraint.** Motion is confined to the hero sequence, scroll reveals and hover states. Below the fold: hairline purple edges, generous space, no competing glow. Visible focus rings, AA contrast, and `prefers-reduced-motion` disables every transform.
