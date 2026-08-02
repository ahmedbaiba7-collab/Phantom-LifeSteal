'use client';

import { useState } from 'react';
import { Check, ChevronDown, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface Rank {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  salePrice: number | null;
  imageUrl: string | null;
  tier: number | null;
  features: string[];
  commands: string[];
  permissions: string[];
  durationDays: number | null;
  featured: boolean;
}

/**
 * The badge artwork is small pixel art (39–147px wide). Scaling it up with the
 * browser's default smoothing would blur it into paste, so every rendering of
 * these assets pins image-rendering: pixelated and lets height drive width.
 */
function RankBadge({ rank, className }: { rank: Rank; className?: string }) {
  if (!rank.imageUrl) {
    return (
      <span className="font-display text-lg font-bold uppercase tracking-widest">{rank.name}</span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={rank.imageUrl}
      alt={`${rank.name} rank badge`}
      className={cn('w-auto [image-rendering:pixelated]', className)}
    />
  );
}

export function RankCard({ rank }: { rank: Rank }) {
  const [showCommands, setShowCommands] = useState(false);
  const effective = rank.salePrice ?? rank.price;

  return (
    <article
      className={cn(
        'glass group relative flex h-full flex-col overflow-hidden p-6 transition-all duration-300',
        'motion-safe:hover:-translate-y-1',
        rank.featured ? 'border-neon/45 shadow-neon' : 'hover:border-neon/35',
      )}
    >
      {/* Glow that grows on hover — pure decoration, kept behind the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-neon/10 blur-[70px] transition-opacity duration-500 group-hover:opacity-180"
      />

      <div className="relative">
        {rank.featured && (
          <Badge className="mb-4">Most popular</Badge>
        )}

        <div className="flex min-h-[64px] items-center">
          <RankBadge rank={rank} className="h-12" />
        </div>

        <p className="mt-4 font-body text-sm leading-relaxed text-muted">{rank.description}</p>

        <div className="mt-6 flex items-baseline gap-2">
          <span className="font-mono text-3xl tabular text-ink">{money(effective)}</span>
          {rank.salePrice !== null && (
            <span className="font-mono text-sm tabular text-muted line-through">
              {money(rank.price)}
            </span>
          )}
          <span className="font-body text-xs text-muted">
            {rank.durationDays ? `/ ${rank.durationDays} days` : 'one-time'}
          </span>
        </div>

        <ul className="mt-6 space-y-2.5">
          {rank.features.map((feature) => (
            <li key={feature} className="flex gap-2.5 font-body text-sm text-muted">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-neon" aria-hidden />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mt-auto pt-7">
        {rank.commands.length > 0 && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowCommands((v) => !v)}
              aria-expanded={showCommands}
              className="flex w-full items-center justify-between rounded-lg border border-edge px-3 py-2 font-display text-eyebrow font-bold uppercase tracking-widest text-muted transition-colors hover:border-neon/30 hover:text-ink"
            >
              <span className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5" aria-hidden />
                {rank.commands.length} commands
              </span>
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', showCommands && 'rotate-180')}
                aria-hidden
              />
            </button>

            {showCommands && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {rank.commands.map((command) => (
                  <li
                    key={command}
                    className="rounded bg-white/[0.04] px-2 py-1 font-mono text-xs text-muted"
                  >
                    {command}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Button asChild variant={rank.featured ? 'default' : 'ghost'} className="w-full">
          <a href={`/store/${rank.slug}`}>Get {rank.name}</a>
        </Button>
      </div>
    </article>
  );
}

/**
 * The comparison table. Rows are derived from the union of every rank's
 * feature list rather than hard-coded, so adding a rank or a perk in the
 * database updates this without a code change.
 */
export function RankComparison({ ranks }: { ranks: Rank[] }) {
  const sorted = [...ranks].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));

  const allFeatures: string[] = [];
  for (const rank of sorted) {
    for (const feature of rank.features) {
      if (!allFeatures.includes(feature)) allFeatures.push(feature);
    }
  }

  return (
    <div className="glass mt-8 overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <caption className="sr-only">Feature comparison across all ranks</caption>
        <thead>
          <tr className="border-b border-edge">
            <th scope="col" className="px-5 py-4 text-left font-display text-eyebrow font-bold uppercase text-muted">
              Feature
            </th>
            {sorted.map((rank) => (
              <th key={rank.id} scope="col" className="px-3 py-4 text-center">
                <RankBadge rank={rank} className="mx-auto h-6" />
                <span className="mt-2 block font-mono text-xs tabular text-muted">
                  {money(rank.salePrice ?? rank.price)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allFeatures.map((feature) => (
            <tr key={feature} className="border-b border-edge/30 last:border-0">
              <th scope="row" className="px-5 py-3 text-left font-body text-sm font-normal text-muted">
                {feature}
              </th>
              {sorted.map((rank) => (
                <td key={rank.id} className="px-3 py-3 text-center">
                  {rank.features.includes(feature) ? (
                    <>
                      <Check className="mx-auto h-4 w-4 text-neon" aria-hidden />
                      <span className="sr-only">Included in {rank.name}</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="text-muted/30">
                        —
                      </span>
                      <span className="sr-only">Not in {rank.name}</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
