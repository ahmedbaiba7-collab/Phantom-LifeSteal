'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { CoinBalance, CoinPrice } from '@/components/coin-balance';
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
import { cn } from '@/lib/utils';

interface Item {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  category: string | null;
  coinPrice: number;
  imageUrl: string | null;
  featured: boolean;
  stock: number | null;
}

interface ShopResponse {
  items: Item[];
  categories: { category: string; count: number }[];
  page: number;
  pages: number;
  total: number;
}

type Sort = 'featured' | 'price_asc' | 'price_desc' | 'name';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price_asc', label: 'Cheapest' },
  { value: 'price_desc', label: 'Dearest' },
  { value: 'name', label: 'A–Z' },
];

export function CoinShop() {
  const { user, refresh } = useAuth();

  const [data, setData] = useState<ShopResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('featured');
  const [page, setPage] = useState(1);

  // Purchase dialog state
  const [selected, setSelected] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  // Regenerated per dialog opening, so a double-tapped Confirm sends the same
  // key twice and the server charges once.
  const idempotencyKey = useRef<string>('');

  // Typing should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ sort, page: String(page), limit: '12' });
    if (debounced) params.set('search', debounced);
    if (category) params.set('category', category);

    try {
      setData(await api<ShopResponse>(`/coins/shop?${params}`));
    } catch {
      setError('The shop could not be loaded. Refresh to try again.');
    } finally {
      setLoading(false);
    }
  }, [debounced, category, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function openPurchase(item: Item) {
    idempotencyKey.current = crypto.randomUUID();
    setSelected(item);
    setQuantity(1);
    setBuyError(null);
    setReceipt(null);
  }

  async function confirmPurchase() {
    if (!selected) return;
    setBuying(true);
    setBuyError(null);

    try {
      const result = await api<{ coins: number; message: string }>('/coins/purchase', {
        method: 'POST',
        body: {
          productId: selected.id,
          quantity,
          idempotencyKey: idempotencyKey.current,
        },
      });

      setReceipt(result.message);
      await refresh(); // pulls the new balance so the counter animates down
      void load(); // stock may have moved
    } catch (err) {
      setBuyError(
        err instanceof ApiRequestError
          ? err.message
          : 'The purchase could not be completed. Your coins have not been touched.',
      );
    } finally {
      setBuying(false);
    }
  }

  const total = selected ? selected.coinPrice * quantity : 0;
  const affordable = user ? user.coins >= total : false;
  const maxQuantity = useMemo(
    () => Math.min(64, selected?.stock ?? 64),
    [selected],
  );

  return (
    <>
      {/* ── Wallet ─────────────────────────────────────────────────────── */}
      {user && (
        <div className="glass mt-9 flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="font-display text-eyebrow font-bold uppercase text-muted">Your balance</p>
            <CoinBalance value={user.coins} size="lg" className="mt-2" />
          </div>
          <div className="flex gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/vote">Earn coins</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/coins">History</Link>
            </Button>
          </div>
        </div>
      )}

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="mt-9 flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <label htmlFor="shop-search" className="sr-only">
            Search the coin shop
          </label>
          <input
            id="shop-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="field pl-11"
          />
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <label htmlFor="shop-sort" className="sr-only">
            Sort items
          </label>
          <select
            id="shop-sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setPage(1);
            }}
            className="field w-auto"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Category chips ─────────────────────────────────────────────── */}
      {data && data.categories.length > 0 && (
        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Item categories">
          <CategoryChip
            label="Everything"
            active={category === null}
            onClick={() => {
              setCategory(null);
              setPage(1);
            }}
          />
          {data.categories.map((c) => (
            <CategoryChip
              key={c.category}
              label={c.category}
              count={c.count}
              active={category === c.category}
              onClick={() => {
                setCategory(c.category);
                setPage(1);
              }}
            />
          ))}
        </nav>
      )}

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      <div className="mt-9" aria-busy={loading}>
        {error ? (
          <div className="glass p-12 text-center">
            <p className="font-body text-sm text-muted">{error}</p>
            <Button onClick={() => void load()} className="mt-6">
              Try again
            </Button>
          </div>
        ) : loading && !data ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass h-56 animate-pulse" />
            ))}
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="glass p-12 text-center">
            <h2 className="font-display text-lg font-bold uppercase">Nothing matches that</h2>
            <p className="mx-auto mt-3 max-w-sm font-body text-sm text-muted">
              Try a different word, or clear the filters to see the whole shop.
            </p>
            <Button
              variant="ghost"
              className="mt-6"
              onClick={() => {
                setSearch('');
                setCategory(null);
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              'grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              loading && 'opacity-60',
            )}
          >
            {data?.items.map((item) => (
              <article
                key={item.id}
                className={cn(
                  'glass flex h-full flex-col p-5 transition-all duration-300 motion-safe:hover:-translate-y-1',
                  item.featured ? 'border-neon/40' : 'hover:border-neon/30',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <Badge variant={item.featured ? 'default' : 'muted'}>
                    {item.category ?? item.type}
                  </Badge>
                  {item.stock !== null && item.stock <= 25 && (
                    <span className="font-body text-xs text-heart">
                      {item.stock === 0 ? 'Sold out' : `${item.stock} left`}
                    </span>
                  )}
                </div>

                <h3 className="mt-4 font-display text-base font-bold uppercase leading-tight tracking-wide">
                  {item.name}
                </h3>
                <p className="mt-2 flex-1 font-body text-sm leading-relaxed text-muted">
                  {item.description}
                </p>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <CoinPrice value={item.coinPrice} />
                  <Button
                    size="sm"
                    variant={item.featured ? 'default' : 'ghost'}
                    disabled={item.stock === 0}
                    onClick={() => openPurchase(item)}
                  >
                    {item.stock === 0 ? 'Sold out' : 'Buy'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      {data && data.pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Shop pages">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="px-4 font-mono text-sm tabular text-muted">
            {data.page} / {data.pages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </nav>
      )}

      {/* ── Purchase confirmation ──────────────────────────────────────── */}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && !receipt && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>

              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="quantity" className="font-display text-eyebrow font-bold uppercase text-muted">
                    Quantity
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Decrease quantity"
                      disabled={quantity <= 1}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    >
                      −
                    </Button>
                    <input
                      id="quantity"
                      type="number"
                      min={1}
                      max={maxQuantity}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(
                          Math.min(maxQuantity, Math.max(1, Number(e.target.value) || 1)),
                        )
                      }
                      className="field w-20 text-center font-mono tabular"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Increase quantity"
                      disabled={quantity >= maxQuantity}
                      onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="rule" />

                <div className="flex items-center justify-between">
                  <span className="font-display text-eyebrow font-bold uppercase text-muted">
                    Total
                  </span>
                  <CoinPrice value={total} className="text-base" />
                </div>

                {user && (
                  <div className="flex items-center justify-between">
                    <span className="font-display text-eyebrow font-bold uppercase text-muted">
                      Balance after
                    </span>
                    <span
                      className={cn(
                        'font-mono text-sm tabular',
                        affordable ? 'text-muted' : 'text-heart',
                      )}
                    >
                      {new Intl.NumberFormat('en-US').format(user.coins - total)}
                    </span>
                  </div>
                )}

                {buyError && (
                  <p role="alert" className="rounded-xl border border-heart/40 bg-heart/8 px-4 py-3 font-body text-sm">
                    {buyError}
                  </p>
                )}

                {!user && (
                  <p className="rounded-xl border border-edge bg-panel/60 px-4 py-3 font-body text-sm text-muted">
                    <Link href="/login" className="font-medium text-neon hover:text-neon-hot">
                      Sign in
                    </Link>{' '}
                    to spend coins.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void confirmPurchase()}
                  disabled={!user || !affordable || buying}
                >
                  {buying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {buying
                    ? 'Purchasing…'
                    : !user
                      ? 'Sign in to buy'
                      : affordable
                        ? 'Confirm purchase'
                        : 'Not enough coins'}
                </Button>
              </DialogFooter>
            </>
          )}

          {receipt && (
            <>
              <DialogHeader>
                <DialogTitle>Done</DialogTitle>
                <DialogDescription>{receipt}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" asChild>
                  <Link href="/dashboard/coins">View history</Link>
                </Button>
                <Button onClick={() => setSelected(null)}>Keep shopping</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CategoryChip({
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
      className={cn(
        'rounded-lg border px-4 py-2 font-display text-xs font-bold uppercase tracking-widest transition-colors',
        active
          ? 'border-neon/50 bg-neon/12 text-neon-hot'
          : 'border-edge text-muted hover:border-neon/30 hover:text-ink',
      )}
    >
      {label}
      {count !== undefined && <span className="ml-2 font-mono text-muted/70">{count}</span>}
    </button>
  );
}
