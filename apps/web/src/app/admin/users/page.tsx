'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CoinBalance } from '@/components/coin-balance';
import { relativeTime } from '@/lib/format';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  status: string;
  coins: number;
  createdAt: string;
  roles: { role: { key: string; name: string; color: string; weight: number } }[];
}

export default function AdminUsersPage() {
  const { can } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (debounced) params.set('search', debounced);
      setUsers(await api<AdminUser[]>(`/admin/users?${params}`));
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdjust(user: AdminUser) {
    setTarget(user);
    setAmount('');
    setReason('');
    setError(null);
    setDone(null);
  }

  async function submitAdjust() {
    if (!target) return;
    const parsed = Number(amount);

    if (!Number.isInteger(parsed) || parsed === 0) {
      setError('Enter a whole number other than zero. Negative takes coins away.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Give a reason — it is written to the audit log and the player can see it.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await api<{ coins: number }>(`/admin/users/${target.id}/coins`, {
        method: 'POST',
        body: { amount: parsed, reason: reason.trim() },
      });
      setDone(`${target.username} now holds ${result.coins.toLocaleString()} coins.`);
      void load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That adjustment did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <label htmlFor="user-search" className="sr-only">
          Search users
        </label>
        <input
          id="user-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username or email…"
          className="field pl-11"
        />
      </div>

      <div className="glass mt-6 overflow-x-auto" aria-busy={loading}>
        <table className="w-full min-w-[680px]">
          <caption className="sr-only">Registered users</caption>
          <thead>
            <tr className="border-b border-edge text-left">
              <th scope="col" className="px-5 py-4 font-display text-eyebrow font-bold uppercase text-muted">Player</th>
              <th scope="col" className="px-3 py-4 font-display text-eyebrow font-bold uppercase text-muted">Rank</th>
              <th scope="col" className="px-3 py-4 font-display text-eyebrow font-bold uppercase text-muted">Status</th>
              <th scope="col" className="px-3 py-4 text-right font-display text-eyebrow font-bold uppercase text-muted">Coins</th>
              <th scope="col" className="px-5 py-4 text-right font-display text-eyebrow font-bold uppercase text-muted">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const top = [...user.roles].sort((a, b) => b.role.weight - a.role.weight)[0]?.role;

              return (
                <tr key={user.id} className="border-b border-edge/30 last:border-0">
                  <td className="px-5 py-3.5">
                    <p className="font-display text-sm font-bold uppercase tracking-wide">
                      {user.username}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted/70">
                      joined {relativeTime(user.createdAt)}
                    </p>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="font-body text-sm" style={{ color: top?.color ?? '#948CAD' }}>
                      {top?.name ?? 'Player'}
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <Badge variant={user.status === 'ACTIVE' ? 'muted' : 'heart'}>
                      {user.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-3.5 text-right font-mono text-sm tabular text-ink">
                    {user.coins.toLocaleString()}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {can('coins.adjust') && (
                      <Button variant="ghost" size="sm" onClick={() => openAdjust(user)}>
                        Adjust coins
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && users.length === 0 && (
          <p className="p-10 text-center font-body text-sm text-muted">
            Nobody matches that search.
          </p>
        )}
      </div>

      {/* ── Coin adjustment ────────────────────────────────────────────── */}
      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          {target && !done && (
            <>
              <DialogHeader>
                <DialogTitle>Adjust {target.username}</DialogTitle>
                <DialogDescription>
                  This writes to the same ledger the player sees, attributed to you. There is no
                  silent path to changing a balance.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6 space-y-5">
                <div className="flex items-center justify-between rounded-xl border border-edge px-4 py-3">
                  <span className="font-display text-eyebrow font-bold uppercase text-muted">
                    Current
                  </span>
                  <CoinBalance value={target.coins} size="sm" />
                </div>

                <div>
                  <label htmlFor="amount" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
                    Amount
                  </label>
                  <input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="500 to grant, -500 to take back"
                    className="field font-mono tabular"
                  />
                </div>

                <div>
                  <label htmlFor="reason" className="mb-2 block font-display text-eyebrow font-bold uppercase text-muted">
                    Reason
                  </label>
                  <input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Compensation for the vote outage on Friday"
                    className="field"
                  />
                </div>

                {error && (
                  <p role="alert" className="rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setTarget(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void submitAdjust()} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Apply adjustment
                </Button>
              </DialogFooter>
            </>
          )}

          {done && (
            <>
              <DialogHeader>
                <DialogTitle>Applied</DialogTitle>
                <DialogDescription>{done}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setTarget(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
