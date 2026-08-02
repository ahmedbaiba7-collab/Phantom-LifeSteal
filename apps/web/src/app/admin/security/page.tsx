'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

interface SecurityEvent {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { username: string } | null;
  metadata: unknown;
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export default function AdminSecurityPage() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SecurityEvent[]>('/admin/security')
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  const shown = filter ? events.filter((e) => e.severity === filter) : events;

  return (
    <div>
      <p className="font-body text-sm text-muted">
        Refresh-token reuse, rate-limit trips, CSRF rejections and failed logins. A critical event
        means a session family was revoked — worth reading the same day.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter by severity">
        <FilterChip label="Everything" active={filter === null} onClick={() => setFilter(null)} />
        {SEVERITY_ORDER.map((severity) => (
          <FilterChip
            key={severity}
            label={severity.toLowerCase()}
            count={events.filter((e) => e.severity === severity).length}
            active={filter === severity}
            onClick={() => setFilter(severity)}
          />
        ))}
      </nav>

      <ul className="glass mt-6 divide-y divide-edge/30" aria-busy={loading}>
        {shown.map((event) => (
          <li key={event.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={event.severity === 'CRITICAL' || event.severity === 'HIGH' ? 'heart' : 'muted'}>
                {event.severity}
              </Badge>
              <span className="font-body text-sm text-ink">
                {event.type.replace(/_/g, ' ').toLowerCase()}
              </span>
              {event.user && (
                <span className="font-mono text-xs text-muted">{event.user.username}</span>
              )}
              <span className="ml-auto font-mono text-xs tabular text-muted/70">
                {relativeTime(event.createdAt)}
              </span>
            </div>
            {(event.ip || event.userAgent) && (
              <p className="mt-2 truncate font-mono text-xs text-muted/70">
                {event.ip ?? '—'}
                {event.userAgent ? ` · ${event.userAgent}` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>

      {!loading && shown.length === 0 && (
        <p className="glass mt-6 p-10 text-center font-body text-sm text-muted">
          Nothing recorded. That is the good outcome.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-3.5 py-2 font-display text-eyebrow font-bold uppercase tracking-widest transition-colors ${
        active
          ? 'border-neon/50 bg-neon/12 text-neon-hot'
          : 'border-edge text-muted hover:border-neon/30 hover:text-ink'
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-2 font-mono text-muted/70">{count}</span>}
    </button>
  );
}
