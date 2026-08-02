'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { count } from '@/lib/format';
import { CoinBalance } from '@/components/coin-balance';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="container-page py-24">
        <div className="glass h-64 animate-pulse" aria-busy="true" aria-label="Loading your dashboard" />
      </div>
    );
  }

  if (!user) return null;

  const stats = user.stats;
  const topRole = [...user.roles].sort((a, b) => b.role.weight - a.role.weight)[0]?.role;
  const kdr = stats ? (stats.deaths === 0 ? stats.kills : (stats.kills / stats.deaths).toFixed(2)) : '—';

  return (
    <div className="container-page py-16">
      {/* Identity */}
      <header className="glass flex flex-col gap-6 p-7 sm:flex-row sm:items-center">
        {user.renders?.head ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.renders.head}
            alt=""
            width={72}
            height={72}
            className="rounded-xl border border-edge"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-xl border border-edge bg-void font-display text-2xl font-bold text-neon">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide">{user.username}</h1>
          <p className="mt-1 font-body text-sm" style={{ color: topRole?.color ?? '#948CAD' }}>
            {topRole?.name ?? 'Player'}
            {user.minecraft?.verifiedAt && (
              <span className="text-muted"> · linked to {user.minecraft.ign}</span>
            )}
          </p>
        </div>

        <div className="text-right">
          <p className="font-display text-eyebrow font-bold uppercase text-muted">Coins</p>
          <CoinBalance value={user.coins} size="lg" className="mt-1.5" />
        </div>
      </header>

      {/* Verification and linking prompts — actionable, not scolding */}
      {!user.emailVerifiedAt && (
        <p className="mt-5 rounded-xl border border-neon/35 bg-neon/8 px-5 py-4 font-body text-sm">
          Confirm your email to unlock vote rewards and store purchases. The link was sent when you
          registered — check spam, or{' '}
          <Link href="/settings" className="font-medium text-neon hover:text-neon-hot">request a new one</Link>.
        </p>
      )}

      {!user.minecraft?.verifiedAt && (
        <p className="mt-4 rounded-xl border border-edge bg-panel/60 px-5 py-4 font-body text-sm text-muted">
          Link your Minecraft account to sync stats and appear on the leaderboards.{' '}
          <Link href="/settings/minecraft" className="font-medium text-neon hover:text-neon-hot">Link it now</Link>.
        </p>
      )}

      {/* Stats */}
      <section className="mt-8">
        <h2 className="eyebrow">Your record</h2>
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-edge bg-edge md:grid-cols-3 lg:grid-cols-6">
          <Metric label="Hearts" value={stats ? String(stats.maxHearts) : '—'} accent="heart" />
          <Metric label="Taken" value={stats ? count(stats.heartsStolen) : '—'} />
          <Metric label="Kills" value={stats ? count(stats.kills) : '—'} />
          <Metric label="Deaths" value={stats ? count(stats.deaths) : '—'} />
          <Metric label="K/D" value={String(kdr)} />
          <Metric
            label="Playtime"
            value={stats ? `${Math.round(stats.playtimeMinutes / 60)}h` : '—'}
          />
        </dl>
      </section>

      {/* Quick actions */}
      <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: '/vote', title: 'Vote', body: 'Four sites, every 24 hours. Coins on each.' },
          { href: '/dashboard/coins', title: 'Coins', body: 'Every credit and debit, with balances.' },
          { href: '/shop', title: 'Coin shop', body: 'Keys, titles, particles, boosters.' },
          { href: '/support', title: 'Support', body: 'Tickets, reports and appeals.' },
          { href: '/settings/security', title: 'Security', body: 'Two-factor, devices, password.' },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="glass block p-6 transition-colors hover:border-neon/35"
          >
            <h3 className="font-display text-base font-bold uppercase tracking-wide">{card.title}</h3>
            <p className="mt-2 font-body text-sm text-muted">{card.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: 'heart' }) {
  return (
    <div className="bg-panel px-5 py-5">
      <dt className="font-display text-eyebrow font-bold uppercase text-muted">{label}</dt>
      <dd className={`mt-1.5 font-mono text-xl tabular ${accent === 'heart' ? 'text-heart' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}
