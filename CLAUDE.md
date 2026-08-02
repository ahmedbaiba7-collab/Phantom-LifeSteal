# LifeSteal Phantom — working notes

Read `docs/ARCHITECTURE.md` before changing anything structural. It explains
why each decision was made; this file covers how to work in the repo.

## Layout

```
apps/api/   Express + TypeScript + Prisma. Runs as a process (src/server.ts)
            or as a Vercel function (api/index.ts). Same app either way.
apps/web/   Next.js 15 App Router.
```

Two separate `package.json` files. There is no workspace root — `npm install`
runs in each app directory.

## Commands

```bash
# apps/api
npx prisma generate          # required after any schema change
npx prisma migrate dev       # local; use `migrate deploy` in production
npm run typecheck
npm run seed                 # idempotent; safe to re-run

# apps/web
npm run typecheck
npm run lint
npm run build                # 19 routes should prerender
```

`npm run typecheck` in apps/api fails without `prisma generate` first — the
types come from the generated client.

## Conventions that are not negotiable

**Response envelope.** Every API route returns `{ data, meta? }`. The web
client (`apps/web/src/lib/api.ts`) unwraps `json.data`. A route returning a
bare object resolves to `undefined` in the browser with no error. This has
already broken once.

**Money and coins are integers.** Real money in minor units (cents), coins as
whole coins. No floats anywhere near a balance.

**Coin balances go through `coins.service.ts` only.** Nothing else writes
`user.coins`. The service locks the row with `SELECT ... FOR UPDATE`, moves the
balance and writes the `CoinTransaction` row in one transaction. Bypassing it
reintroduces the double-spend it exists to prevent.

**Prices come from the database, never the request body.** Both checkout paths
read the product row and compute the total server-side.

**Permissions are strings, roles are database rows.** Add new permissions to
`src/config/permissions.ts`. Route guards use `requirePermission(PERMISSIONS.X)`,
never a hard-coded role name.

**Rank artwork is pixel art.** The five badges and the coin icon under
`apps/web/public/` are 39–147px wide. Render them with plain `<img>` and
`className="h-N w-auto [image-rendering:pixelated]"`. `next/image` resamples
and would blur them; at under 1.2 KB each there is nothing to optimise.

**Errors say what to do next.** No apologies, no "Oops". Look at
`apps/web/src/app/error.tsx` and the empty states in `/shop` and `/ranks` for
the tone.

**`heart` red is reserved.** Hearts and destructive actions only. It never
decorates, which is why it always means something when it appears.

## Security invariants — do not weaken these

- Refresh tokens rotate on every use; replaying a used token revokes the whole
  session family and raises a critical `SecurityEvent`.
- The access token lives in a module variable in the browser, never
  `localStorage`.
- Tokens are stored as SHA-256 hashes, never plaintext.
- `src/config/env.ts` exits on a missing or placeholder secret. Do not add a
  fallback default to make local setup easier.
- Staff cannot act on a user whose highest role weight is >= their own
  (`assertOutranks`).
- The audit log is append-only. There is no delete endpoint by design.

## Known state

Built and verified: schema, auth, RBAC, coins economy, store, voting, support,
admin API, plugin integration, and 19 frontend routes (typecheck, lint and
production build all clean).

Not built yet, in the order worth doing:

1. **Stripe webhook** — checkout creates orders but nothing marks them paid.
   The schema and delivery queue exist; this is the wiring.
2. Remaining frontend routes: news, wiki, support, settings, admin news and
   tickets screens. Every API behind them exists.
3. `src/worker.ts` — delivery retries, vote reconciliation, expired-rank
   sweeps, daily `StatSnapshot` rollup. Referenced in package.json, not written.
4. Tests. Vitest is wired into CI. Start with refresh rotation, reuse
   detection, lockout, hierarchy guards, and the coin double-spend path.
5. Upload endpoint with sharp re-encoding for avatars and attachments.

## Deployment

Frontend on Vercel with root directory `apps/web`. API either on a VPS via
`docker-compose.yml`, or on Vercel with root `apps/api` (see `vercel.json`).
Postgres on Neon, Redis on Upstash.

`WEB_ORIGIN` and `API_ORIGIN` must be exact origins with no trailing slash —
the CORS allow-list and `src/lib/cookies.ts` both parse them. When the two are
on different sites the cookies switch to `SameSite=None` automatically; hosts
under a public suffix like `vercel.app` count as different sites.

Serverless has no background work: the Minecraft status poller in `server.ts`
does not run there. `minecraft.service.ts` fetches on demand and caches, so
behaviour is correct, just occasionally slower on a cold cache.
