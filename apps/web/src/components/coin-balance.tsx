'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The coin counter. Two behaviours matter here:
 *
 *  - It animates from the previous value to the new one, so after a purchase
 *    the player watches the cost come off rather than seeing a number snap.
 *  - It respects prefers-reduced-motion by jumping straight to the value. A
 *    counter that ticks is decoration; the number is the information.
 *
 * The coin artwork is pixel art at its native size, so it renders with
 * image-rendering: pixelated — anything else turns crisp pixels into mush.
 */

interface Props {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Shows the value with a leading sign, for ledger rows. */
  signed?: boolean;
}

const SIZES = {
  sm: { img: 'h-4', text: 'text-sm' },
  md: { img: 'h-6', text: 'text-lg' },
  lg: { img: 'h-9', text: 'text-3xl' },
} as const;

function useCountUp(target: number, durationMs = 700): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    const delta = target - from;

    if (reduced || delta === 0) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast at first, settles gently on the final figure.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));

      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return display;
}

export function CoinBalance({ value, size = 'md', className, signed = false }: Props) {
  const display = useCountUp(value);
  const s = SIZES[size];

  const formatted = new Intl.NumberFormat('en-US').format(Math.abs(display));
  const sign = signed ? (value < 0 ? '\u2212' : '+') : '';

  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      // Without this the animated digits are announced on every frame.
      aria-label={`${sign}${formatted} coins`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/coins.png"
        alt=""
        aria-hidden
        className={cn(s.img, 'w-auto [image-rendering:pixelated]')}
      />
      <span
        aria-hidden
        className={cn(
          'font-mono tabular font-medium',
          s.text,
          signed && value < 0 ? 'text-heart' : signed ? 'text-neon-hot' : 'text-ink',
        )}
      >
        {sign}
        {formatted}
      </span>
    </span>
  );
}

/** Bare number plus coin glyph, for tight spots like table cells and cards. */
export function CoinPrice({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} aria-label={`${value} coins`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/coins.png" alt="" aria-hidden className="h-4 w-auto [image-rendering:pixelated]" />
      <span aria-hidden className="font-mono tabular text-sm">
        {new Intl.NumberFormat('en-US').format(value)}
      </span>
    </span>
  );
}
