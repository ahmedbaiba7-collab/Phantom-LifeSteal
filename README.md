# LifeSteal Phantom

The official website for the LifeSteal Phantom Minecraft network. Next.js 15 front end, Express + Prisma API, PostgreSQL, Redis, Docker, Nginx.

Design rationale — architecture, database, API, security model, permissions, technology choices — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Read that first; it explains *why* every decision below was made.

---

## What is in this repository

```
lifesteal-phantom/
├── docs/ARCHITECTURE.md        Design document (read first)
├── docker-compose.yml          Postgres, Redis, API, web, Nginx, backup cron
├── .env.example                Every variable, documented
├── nginx/                      TLS, HTTP/2, edge rate limits, security headers
├── scripts/                    backup.sh, restore.sh
├── .github/workflows/ci.yml    Typecheck, lint, test, migrate, audit, Trivy, gitleaks
├── apps/api/                   Express + TypeScript + Prisma
│   ├── prisma/schema.prisma    41 models across 10 domains
│   ├── prisma/seed.ts          Roles, permissions, owner, wiki, FAQ
│   ├── prisma/seed-catalogue.ts  Rank ladder + coin shop (edit this one)
│   └── src/
│       ├── config/             env validation, permission catalogue
│       ├── lib/                crypto, prisma, redis, logger, mailer, errors
│       ├── middleware/         security, auth, rbac, csrf, rate limits, errors
│       ├── services/           auth, minecraft, audit
│       ├── routes/             auth, me, public, store, support, vote, admin, integration
│       └── docs/openapi.ts     OpenAPI 3, served at /api/docs
└── apps/web/                   Next.js 15 App Router
    ├── tailwind.config.ts      Design tokens
    └── src/
        ├── app/                home, login, register, leaderboards, store, dashboard
        ├── components/         header, footer, heart ledger, auth provider
        └── lib/api.ts          Fetch client with silent token refresh
```

---

## Setup on Windows (PowerShell)

### 1. Prerequisites

```powershell
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop
winget install Git.Git
```

Restart the terminal, then confirm:

```powershell
node --version    # v20 or newer
docker --version
```

### 2. Get the code and configure

```powershell
cd $HOME\projects
git clone <your-repo-url> lifesteal-phantom
cd lifesteal-phantom
Copy-Item .env.example .env
```

### 3. Generate real secrets

The API refuses to start if any secret is missing or still contains a placeholder from `.env.example`. Generate them:

```powershell
function New-Secret([int]$Bytes = 64) {
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    ($buffer | ForEach-Object { $_.ToString('x2') }) -join ''
}

Write-Host "JWT_ACCESS_SECRET=$(New-Secret 64)"
Write-Host "JWT_REFRESH_SECRET=$(New-Secret 64)"
Write-Host "COOKIE_SECRET=$(New-Secret 64)"
Write-Host "ENCRYPTION_KEY=$(New-Secret 32)"   # must be exactly 64 hex chars
Write-Host "PLUGIN_API_KEY=$(New-Secret 32)"
```

Paste each into `.env`, then fill in `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, your SMTP credentials, and `MC_HOST`.

### 4. Start the infrastructure

```powershell
docker compose up -d postgres redis
docker compose ps    # both should read "healthy"
```

### 5. Install and migrate

```powershell
cd apps\api
npm install
npx prisma generate
npx prisma migrate dev --name init
```

> Running the API outside Docker means Postgres and Redis are reached at `localhost`, not by service name. In `.env`, point `DATABASE_URL` at `localhost:5432` and `REDIS_URL` at `localhost:6379`, and publish those ports in `docker-compose.yml`. Inside Docker, leave the service names as they are.

### 6. Seed

```powershell
$env:OWNER_EMAIL     = "you@example.com"
$env:OWNER_USERNAME  = "YourName"
$env:OWNER_PASSWORD  = "a-long-password-you-choose"
npm run seed
```

This creates the ten roles with their permissions, the owner account, the store catalogue, vote sites, wiki pages and FAQ — and prints the plugin API key **once**. Copy it into the plugin config; it is stored only as a hash and cannot be shown again.

### 7. Run both apps

```powershell
# terminal 1
cd apps\api
npm run dev          # http://localhost:4000, docs at /api/docs

# terminal 2
cd apps\web
npm install
npm run dev          # http://localhost:3000
```

---

## Production deployment

```powershell
# 1. TLS certificates into nginx/certs/ as fullchain.pem and privkey.pem
# 2. Set NODE_ENV=production and the real origins in .env
docker compose build
docker compose up -d
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run seed
docker compose logs -f api
```

Point `lifestealphantom.com` and `api.lifestealphantom.com` at the host. Nginx handles both, terminates TLS, and applies edge rate limits before Node sees a request.

**Verify the backup path before you need it:**

```powershell
docker compose exec backup /usr/local/bin/backup.sh
docker compose exec backup sh /usr/local/bin/restore.sh /var/backups/phantom/<file>.dump
```

---

## What is built, and what is next

Built and working end to end:

| Area | State |
|---|---|
| Database schema | Complete — 41 models, all domains, indexed |
| Env validation, secrets | Complete — boot fails on placeholder or missing values |
| Auth | Complete — Argon2id, refresh rotation with reuse detection, TOTP 2FA, recovery codes, lockout with backoff, new-device email |
| Security middleware | Complete — CSP with nonces, CORS allow-list, CSRF double-submit, Origin guard, HPP, Redis sliding-window limits, maintenance gate |
| RBAC | Complete — permission catalogue, wildcards, role hierarchy, cached and invalidated on change |
| Coins economy | Complete — append-only ledger, row-locked balances, idempotent purchases, reconciliation, audited staff adjustments |
| Audit + security events | Complete — append-only, scrubbed snapshots |
| Public API | Complete — status, pulse, leaderboards, ranks, news, comments, wiki, FAQ, events, profiles |
| Store API | Complete — catalogue, product detail, coupon validation, idempotent checkout, invoices |
| Support API | Complete — tickets, replies, staff-only notes, close |
| Voting API | Complete — sites, per-site cooldown, claim |
| Admin API | Complete — dashboard, users, coin adjustment and ledger, punishments, roles, news, audit, security, settings, maintenance, backups |
| Plugin integration | Complete — stats push, in-game account linking, delivery queue |
| OpenAPI docs | Complete — served at `/api/docs` |
| Infrastructure | Complete — Docker, Nginx, CI with audit + Trivy + gitleaks, backup and restore |

Frontend routes that exist and build (19 routes, typecheck and lint clean):

| Route | What it does |
|---|---|
| `/` | Heart Ledger hero, live status, features, leaderboard, news, FAQ |
| `/ranks` | Rank shop — five tiers with your badge art, derived comparison table |
| `/shop` | Coin shop — search, category facets, sort, pagination, confirm dialog |
| `/store` | Real-money catalogue grouped by type |
| `/store/[slug]` | Product detail with checkout, coupons and gifting |
| `/vote` | Four sites, cooldowns, claim flow |
| `/leaderboards` | Seven boards, switchable |
| `/login`, `/register` | Auth with 2FA challenge and live password checks |
| `/dashboard` | Profile, stats, wallet, quick actions |
| `/dashboard/coins` | Paginated coin ledger with balances |
| `/admin` | Staff overview — attention items first, then metrics |
| `/admin/users` | Search, roles, status, coin adjustment |
| `/admin/audit` | Append-only staff action log |
| `/admin/security` | Security events filtered by severity |
| `sitemap.xml`, `robots.txt`, `404`, `error`, `loading` | SEO and boundaries |

Still to build, in the order I would build them:

1. **Payment provider webhook** — `/webhooks/stripe` with signature verification, then `Order → PAID → Delivery` rows. The schema, checkout and delivery queue are in place; this is the wiring that makes real money move.
2. **Remaining frontend routes** — news list and detail, wiki reader, support pages, settings (security, sessions, 2FA setup), admin news/tickets/settings screens. Every API behind them exists and is documented.
3. **Worker process** — `worker.ts` for delivery retries, vote reconciliation, expired-rank sweeps and the daily `StatSnapshot` rollup. The status poller currently runs in-process in `server.ts`.
4. **Tests** — Vitest is wired into CI. Start with auth and coins: rotation, reuse detection, lockout, hierarchy guards, and the coin double-spend path are the five things that must never silently regress.
5. **Upload endpoint** — sharp-based re-encoding for avatars and ticket attachments.

Nothing above is stubbed in what ships. The list is what is genuinely not written, so you can see exactly where the edge is.

---

## Security notes worth knowing before you go live

- **Restrict `/api/docs`** — the location block in `nginx/conf.d/default.conf` has a commented allow-list. Uncomment it with your own IP range.
- **Lock down the audit table** — in production, grant the application role `INSERT` and `SELECT` on `audit_logs` only. That makes the log tamper-evident even if the API is compromised.
- **Rotate the plugin API key** if it is ever pasted into a Discord channel. `prisma.apiKey.update({ revokedAt })` takes effect on the next request.
- **Set `TURNSTILE_SECRET_KEY`** before launch. Without it the captcha checks pass silently, which is right for local development and wrong for production.
- **Test the restore.** Quarterly, on a staging copy.
- **Reconcile coin balances** after any incident. `GET /admin/users/:id/coins` returns the cached total alongside the ledger sum and their difference. Drift is never auto-corrected — it means something wrote to a wallet outside `coins.service.ts`, and that is worth a person looking at.

---

## About the rank artwork

The five badges and the coin icon you supplied are pixel art at their native
size — Lord is 41x15px, Duke 39x18. Browsers smooth upscaled images by default,
which turns them to paste. Every render of these assets pins
`image-rendering: pixelated` and lets height drive width:

```tsx
<img src={rank.imageUrl} alt={`${rank.name} rank badge`}
     className="h-12 w-auto [image-rendering:pixelated]" />
```

They are deliberately served as plain `<img>` rather than `next/image`, because
the optimiser resamples and would undo exactly what the CSS is protecting. At
these file sizes (under 1.2 KB each) there is nothing for it to save.
