'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { CoinBalance, CoinPrice } from '@/components/coin-balance';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Site {
  key: string;
  name: string;
  url: string;
  rewardCoins: number;
  available: boolean;
  readyAt: string | null;
}

interface Status {
  sites: Site[];
  monthlyVotes: number;
  totalVotes: number;
}

/** "in 3h 20m" — precise enough to plan around, vague enough not to tick. */
function untilReady(readyAt: string): string {
  const ms = new Date(readyAt).getTime() - Date.now();
  if (ms <= 0) return 'now';

  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function VotePanel() {
  const { user, loading: authLoading, refresh } = useAuth();

  const [status, setStatus] = useState<Status | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (user) {
        setStatus(await api<Status>('/vote/status'));
      } else {
        // Signed out, the site list is still worth showing — it is the
        // argument for making an account.
        setSites(await api<Site[]>('/vote/sites'));
      }
    } catch {
      setError('The vote list could not be loaded. Refresh to try again.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, load]);

  async function claim(site: Site) {
    setClaiming(site.key);
    setError(null);
    setMessage(null);

    // Opened before the await so the browser still attributes it to the click
    // and does not treat it as a popup.
    window.open(site.url, '_blank', 'noopener,noreferrer');

    try {
      const result = await api<{ message: string; pendingReward: number }>('/vote/claim', {
        method: 'POST',
        body: { siteKey: site.key },
      });
      setMessage(result.message);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That vote could not be recorded.');
    } finally {
      setClaiming(null);
    }
  }

  const list = status?.sites ?? sites ?? [];

  return (
    <>
      {user && status && (
        <div className="glass mt-9 grid gap-px overflow-hidden bg-edge sm:grid-cols-3">
          <div className="bg-panel px-6 py-5">
            <p className="font-display text-eyebrow font-bold uppercase text-muted">Balance</p>
            <CoinBalance value={user.coins} className="mt-2" />
          </div>
          <div className="bg-panel px-6 py-5">
            <p className="font-display text-eyebrow font-bold uppercase text-muted">This month</p>
            <p className="mt-2 font-mono text-lg tabular text-ink">{status.monthlyVotes}</p>
          </div>
          <div className="bg-panel px-6 py-5">
            <p className="font-display text-eyebrow font-bold uppercase text-muted">All time</p>
            <p className="mt-2 font-mono text-lg tabular text-ink">{status.totalVotes}</p>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-6 rounded-xl border border-neon/35 bg-neon/8 px-5 py-4 font-body text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-heart/40 bg-heart/8 px-5 py-4 font-body text-sm">
          {error}
        </p>
      )}

      <div className="mt-9 space-y-4" aria-busy={loading}>
        {loading && list.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass h-24 animate-pulse" />
            ))
          : list.map((site) => {
              const ready = site.available ?? true;

              return (
                <article
                  key={site.key}
                  className={cn(
                    'glass flex flex-wrap items-center gap-5 p-6 transition-colors',
                    ready ? 'hover:border-neon/35' : 'opacity-60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-base font-bold uppercase tracking-wide">
                      {site.name}
                    </h2>
                    <div className="mt-2 flex items-center gap-3">
                      <CoinPrice value={site.rewardCoins} />
                      <span className="font-body text-xs text-muted">per vote</span>
                    </div>
                  </div>

                  {!user ? (
                    <Button asChild variant="ghost">
                      <Link href="/login">Sign in to vote</Link>
                    </Button>
                  ) : ready ? (
                    <Button onClick={() => void claim(site)} disabled={claiming === site.key}>
                      {claiming === site.key ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      )}
                      Vote
                    </Button>
                  ) : (
                    <span className="font-mono text-sm tabular text-muted">
                      {site.readyAt ? `Ready in ${untilReady(site.readyAt)}` : 'On cooldown'}
                    </span>
                  )}
                </article>
              );
            })}
      </div>

      <div className="glass mt-10 max-w-2xl p-6">
        <h2 className="font-display text-base font-bold uppercase tracking-wide">
          If a reward does not arrive
        </h2>
        <p className="mt-3 font-body text-sm leading-relaxed text-muted">
          Coins are credited when the listing site tells us the vote happened, not when you click.
          Most confirm within a minute; a few take longer, and one occasionally drops a callback. If
          nothing has landed after an hour, open a ticket with the site name and roughly when you
          voted and we will credit it manually.
        </p>
        <Button asChild variant="ghost" size="sm" className="mt-5">
          <Link href="/support">Open a ticket</Link>
        </Button>
      </div>
    </>
  );
}
