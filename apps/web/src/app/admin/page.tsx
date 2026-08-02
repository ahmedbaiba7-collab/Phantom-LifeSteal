'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { count, relativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Dashboard {
  users: { total: number; newToday: number; activeWeek: number };
  orders: { today: number; revenueMonth: number; pending: number };
  tickets: { open: number; unassigned: number };
  security: { failedLogins24h: number; lockedAccounts: number };
  server: { online: number; max: number; tps: number | null } | null;
  recentSecurity: {
    id: string;
    type: string;
    severity: string;
    createdAt: string;
    ip: string | null;
  }[];
}

export default function AdminOverview() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>('/admin/dashboard')
      .then(setData)
      .catch(() => setError('The overview could not be loaded.'));
  }, []);

  if (error) {
    return <p className="glass p-8 font-body text-sm text-muted">{error}</p>;
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-9">
      {/* Anything needing attention goes first, before the vanity metrics. */}
      {(data.tickets.unassigned > 0 || data.security.lockedAccounts > 0) && (
        <div className="glass border-heart/30 p-5">
          <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-heart">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Needs attention
          </p>
          <ul className="mt-3 space-y-1.5 font-body text-sm text-muted">
            {data.tickets.unassigned > 0 && (
              <li>{data.tickets.unassigned} unassigned tickets</li>
            )}
            {data.security.lockedAccounts > 0 && (
              <li>{data.security.lockedAccounts} accounts locked by failed logins</li>
            )}
          </ul>
        </div>
      )}

      <section>
        <h2 className="eyebrow">Players</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Registered" value={count(data.users.total)} />
          <Stat label="New today" value={count(data.users.newToday)} />
          <Stat label="Active this week" value={count(data.users.activeWeek)} />
          <Stat
            label="Online now"
            value={data.server ? `${data.server.online} / ${data.server.max}` : 'Offline'}
            muted={!data.server}
          />
        </div>
      </section>

      <section>
        <h2 className="eyebrow">Commerce and support</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Orders today" value={count(data.orders.today)} />
          <Stat label="Pending orders" value={count(data.orders.pending)} />
          <Stat label="Open tickets" value={count(data.tickets.open)} />
          <Stat label="Failed logins 24h" value={count(data.security.failedLogins24h)} />
        </div>
      </section>

      {data.recentSecurity.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="eyebrow">Recent security events</h2>
            <Link href="/admin/security" className="font-display text-xs font-bold uppercase tracking-widest text-neon hover:text-neon-hot">
              All events
            </Link>
          </div>

          <ul className="glass mt-4 divide-y divide-edge/30">
            {data.recentSecurity.slice(0, 8).map((event) => (
              <li key={event.id} className="flex items-center gap-4 px-5 py-3.5">
                <Badge variant={event.severity === 'CRITICAL' ? 'heart' : 'muted'}>
                  {event.severity}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-body text-sm text-ink">
                  {event.type.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="hidden font-mono text-xs tabular text-muted sm:inline">
                  {event.ip ?? '—'}
                </span>
                <span className="shrink-0 font-mono text-xs tabular text-muted/70">
                  {relativeTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="glass px-5 py-5">
      <p className="font-display text-eyebrow font-bold uppercase text-muted">{label}</p>
      <p className={cn('mt-2 font-mono text-2xl tabular', muted ? 'text-muted' : 'text-ink')}>
        {value}
      </p>
    </div>
  );
}
