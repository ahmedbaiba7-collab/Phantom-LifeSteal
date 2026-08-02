'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface Entry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: string;
  actor: { username: string } | null;
  metadata: unknown;
}

/**
 * Append-only by design. There is deliberately no delete control here — an
 * audit log staff can edit is a log nobody can rely on.
 */
export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<Entry[]>(`/admin/audit?page=${page}&limit=40`)
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [page]);

  return (
    <div>
      <p className="font-body text-sm text-muted">
        Every staff action, with who did it and from where. Retained indefinitely.
      </p>

      <ul className="glass mt-6 divide-y divide-edge/30" aria-busy={loading}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
              aria-expanded={expanded === entry.id}
              className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
            >
              <span className="font-mono text-xs tabular text-neon">{entry.action}</span>
              <span className="min-w-0 flex-1 truncate font-body text-sm text-muted">
                {entry.actor?.username ?? 'system'}
                {entry.targetType ? ` → ${entry.targetType}` : ''}
              </span>
              <span className="hidden font-mono text-xs tabular text-muted/70 sm:inline">
                {entry.ip ?? '—'}
              </span>
              <span className="shrink-0 font-mono text-xs tabular text-muted/70">
                {relativeTime(entry.createdAt)}
              </span>
            </button>

            {expanded === entry.id && (
              <pre className="overflow-x-auto border-t border-edge/30 bg-void/60 px-5 py-4 font-mono text-xs text-muted">
                {JSON.stringify(entry.metadata ?? {}, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {!loading && entries.length === 0 && (
        <p className="glass mt-6 p-10 text-center font-body text-sm text-muted">
          No entries on this page.
        </p>
      )}

      <nav className="mt-6 flex justify-center gap-2" aria-label="Audit pages">
        <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="px-4 font-mono text-sm tabular text-muted">{page}</span>
        <Button variant="ghost" size="sm" disabled={entries.length < 40} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </nav>
    </div>
  );
}
