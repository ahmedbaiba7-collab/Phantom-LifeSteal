'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { compact } from '@/lib/format';

export interface Pulse {
  heartsStolen: number;
  totalKills: number;
  hoursPlayed: number;
  registered: number;
  activeToday: number;
  heartKing: { username: string; hearts: number } | null;
}

export interface Status {
  online: boolean;
  players: { online: number; max: number };
  version: string;
  latencyMs: number | null;
  tps: number | null;
  motd: string;
  maintenance: boolean;
}

/**
 * The signature element.
 *
 * Rather than a headline over a screenshot, the hero is the mechanic itself: a
 * row of twenty hearts, filled to whatever the current heart king holds, with
 * the surplus above ten shown in the red that is reserved for hearts alone. The
 * hearts stolen counter ticks up from the real network total. What defines the
 * server is the first thing the page does.
 */
export function HeartLedger({ pulse, status }: { pulse: Pulse | null; status: Status | null }) {
  const reduced = useReducedMotion();
  const kingHearts = pulse?.heartKing?.hearts ?? 10;
  const filled = Math.min(20, Math.max(1, kingHearts));

  const [stolen, setStolen] = useState(0);
  const target = pulse?.heartsStolen ?? 0;

  // Count up once on mount. Purely presentational, and skipped entirely when
  // reduced motion is requested — the final number is what matters.
  useEffect(() => {
    if (reduced || target === 0) {
      setStolen(target);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setStolen(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);

  return (
    <div className="glass overflow-hidden p-6 sm:p-8">
      {/* Header rail: what the ledger is measuring */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-edge pb-5">
        <div>
          <p className="eyebrow">The heart ledger</p>
          <p className="mt-2 font-body text-sm text-muted">
            Every heart on this server came from another player.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-medium tabular text-heart sm:text-4xl">
            {compact(stolen)}
          </p>
          <p className="mt-1 font-display text-eyebrow font-bold uppercase text-muted">
            hearts taken
          </p>
        </div>
      </div>

      {/* The hearts themselves */}
      <div className="py-7">
        <div className="flex flex-wrap gap-1.5" role="img" aria-label={`Current record: ${kingHearts} hearts`}>
          {Array.from({ length: 20 }, (_, i) => {
            const isFilled = i < filled;
            const isSurplus = i >= 10;
            return (
              <motion.div
                key={i}
                initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: reduced ? 0 : 0.25 + i * 0.028, duration: 0.32, ease: 'easeOut' }}
              >
                <HeartGlyph filled={isFilled} surplus={isSurplus && isFilled} />
              </motion.div>
            );
          })}
        </div>

        <p className="mt-5 font-body text-sm text-muted">
          {pulse?.heartKing ? (
            <>
              <span className="font-display font-bold uppercase tracking-wider text-ink">
                {pulse.heartKing.username}
              </span>{' '}
              holds the record at{' '}
              <span className="font-mono tabular text-heart">{pulse.heartKing.hearts}</span> hearts.
              Everyone starts with ten.
            </>
          ) : (
            'Everyone starts with ten hearts. The cap is twenty. Nobody has reached it yet.'
          )}
        </p>
      </div>

      {/* Status rail */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-4">
        <Stat label="Players" value={status?.online ? `${status.players.online}` : '—'} accent={status?.online} />
        <Stat label="TPS" value={status?.tps ? status.tps.toFixed(1) : '—'} />
        <Stat label="Version" value={status?.version && status.online ? status.version : '—'} />
        <Stat label="Active today" value={pulse ? compact(pulse.activeToday) : '—'} />
      </dl>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-4 py-4">
      <dt className="font-display text-eyebrow font-bold uppercase text-muted">{label}</dt>
      <dd className={`mt-1.5 font-mono text-xl tabular ${accent ? 'text-neon-hot' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * A blocky heart drawn on an 11×10 pixel grid — Minecraft's own heart geometry,
 * rendered as clean vector rather than a scaled-up sprite. This is where the
 * "inspired, not childish" line gets drawn.
 */
function HeartGlyph({ filled, surplus }: { filled: boolean; surplus: boolean }) {
  const color = !filled ? 'rgba(148,140,173,0.22)' : surplus ? '#FF2E63' : '#C77DFF';

  return (
    <svg width="22" height="20" viewBox="0 0 11 10" aria-hidden className="shrink-0">
      <path
        d="M2 0h3v1H2V0zm4 0h3v1H6V0zM1 1h1v2H1V1zm8 0h1v2H9V1zM0 3h1v2H0V3zm10 0h1v2h-1V3zM1 5h1v1H1V5zm8 0h1v1H9V5zM2 6h1v1H2V6zm6 0h1v1H8V6zM3 7h1v1H3V7zm4 0h1v1H7V7zM4 8h1v1H4V8zm2 0h1v1H6V8zM5 9h1v1H5V9z"
        fill={color}
      />
      <path d="M2 1h7v1H2V1zm-1 2h9v2H1V3zm1 2h7v1H2V5zm1 1h5v1H3V6zm1 1h3v1H4V7zm1 1h1v1H5V8z" fill={color} opacity={filled ? 1 : 0.35} />
    </svg>
  );
}
