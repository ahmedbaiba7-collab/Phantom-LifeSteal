'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { CoinBalance } from '@/components/coin-balance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { relativeTime } from '@/lib/format';

interface Entry {
  id: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  description: string;
  createdAt: string;
}

/** Human wording for the ledger's reason codes. */
const REASONS: Record<string, string> = {
  VOTE_REWARD: 'Vote',
  DAILY_REWARD: 'Daily',
  IN_GAME_EARN: 'In game',
  SHOP_PURCHASE: 'Shop',
  STORE_BONUS: 'Store',
  GIFT_SENT: 'Gift sent',
  GIFT_RECEIVED: 'Gift received',
  ADMIN_GRANT: 'Adjustment',
  ADMIN_REVOKE: 'Adjustment',
  REFUND: 'Refund',
};

export default function CoinHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Entry[]; pages: number }>(
        `/coins/transactions?page=${page}&limit=25`,
      );
      setEntries(data.items);
      setPages(data.pages);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (!user) return null;

  return (
    <div className="container-page py-16">
      <Link href="/dashboard" className="font-body text-sm text-muted hover:text-ink">
        ← Dashboard
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Coin history</p>
          <CoinBalance value={user.coins} size="lg" className="mt-4" />
        </div>
        <Button asChild variant="ghost">
          <Link href="/shop">Open the shop</Link>
        </Button>
      </div>

      <div className="glass mt-9 overflow-hidden" aria-busy={loading}>
        {entries.length === 0 && !loading ? (
          <div className="p-12 text-center">
            <h2 className="font-display text-lg font-bold uppercase">No movement yet</h2>
            <p className="mx-auto mt-3 max-w-sm font-body text-sm text-muted">
              Voting is the quickest way to start earning. Four sites, once a day each.
            </p>
            <Button asChild className="mt-6">
              <Link href="/vote">Vote now</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-edge/30">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-4 px-6 py-4">
                <Badge variant={entry.amount < 0 ? 'muted' : 'default'} className="shrink-0">
                  {REASONS[entry.reason] ?? entry.reason}
                </Badge>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm text-ink">{entry.description}</p>
                  <p className="mt-0.5 font-mono text-xs tabular text-muted/70">
                    {relativeTime(entry.createdAt)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <CoinBalance value={entry.amount} size="sm" signed />
                  <p className="mt-0.5 font-mono text-xs tabular text-muted/70">
                    {new Intl.NumberFormat('en-US').format(entry.balanceAfter)} after
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="History pages">
          <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="px-4 font-mono text-sm tabular text-muted">
            {page} / {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
