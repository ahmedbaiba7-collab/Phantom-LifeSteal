'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { CoinBalance } from '@/components/coin-balance';

const NAV = [
  { href: '/ranks', label: 'Ranks' },
  { href: '/shop', label: 'Coin Shop' },
  { href: '/store', label: 'Store' },
  { href: '/leaderboards', label: 'Leaderboards' },
  { href: '/vote', label: 'Vote' },
  { href: '/news', label: 'News' },
  { href: '/wiki', label: 'Wiki' },
  { href: '/support', label: 'Support' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu on navigation, or the next page opens behind an overlay.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled ? 'border-edge bg-void/85 backdrop-blur-xl' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="LifeSteal Phantom home">
          <span className="font-display text-lg font-bold uppercase tracking-[0.18em] text-ink">
            LifeSteal
          </span>
          <span className="font-display text-lg font-bold uppercase tracking-[0.18em] text-neon">
            Phantom
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3.5 py-2 font-display text-xs font-bold uppercase tracking-widest
                            transition-colors ${
                              active ? 'bg-neon/12 text-neon-hot' : 'text-muted hover:bg-white/[0.04] hover:text-ink'
                            }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          {loading ? (
            <div className="h-9 w-32 animate-pulse rounded-lg bg-white/[0.04]" aria-hidden />
          ) : user ? (
            <>
              <Link
                href="/dashboard/coins"
                className="rounded-lg border border-edge px-3 py-1.5 transition-colors hover:border-neon/40"
                aria-label="Your coin balance"
              >
                <CoinBalance value={user.coins} size="sm" />
              </Link>
              <Link href="/dashboard" className="btn-primary px-4 py-2.5 text-xs">
                {user.username}
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="font-display text-xs font-bold uppercase tracking-widest text-muted transition-colors hover:text-ink">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary px-4 py-2.5 text-xs">
                Play now
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="rounded-lg border border-edge p-2 text-ink lg:hidden"
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-edge bg-void/95 backdrop-blur-xl lg:hidden">
          <nav className="container-page flex flex-col py-3" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-3 font-display text-sm font-bold uppercase tracking-widest text-muted hover:bg-white/[0.04] hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex gap-3 border-t border-edge pt-4">
              {user ? (
                <>
                  <Link href="/dashboard/coins" className="btn-ghost flex-1 justify-center py-2.5 text-xs">
                    <CoinBalance value={user.coins} size="sm" />
                  </Link>
                  <Link href="/dashboard" className="btn-primary flex-1 py-2.5 text-xs">Dashboard</Link>
                </>
              ) : (
                <>
                  <Link href="/login" className="btn-ghost flex-1 py-2.5 text-xs">Sign in</Link>
                  <Link href="/register" className="btn-primary flex-1 py-2.5 text-xs">Play now</Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
