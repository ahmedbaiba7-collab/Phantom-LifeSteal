import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, Terminal } from 'lucide-react';
import { serverFetch } from '@/lib/api';
import { money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Checkout } from '@/components/checkout';

interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  price: number;
  salePrice: number | null;
  coinPrice: number | null;
  imageUrl: string | null;
  tier: number | null;
  features: string[];
  commands: string[];
  permissions: string[];
  durationDays: number | null;
  stock: number | null;
  featured: boolean;
  grantCoins: number | null;
  category: string | null;
}

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await serverFetch<Product>(`/store/products/${slug}`, 120);
  if (!product) return { title: 'Not found' };

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      title: `${product.name} — LifeSteal Phantom`,
      description: product.description,
      images: product.imageUrl ? [{ url: product.imageUrl }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await serverFetch<Product>(`/store/products/${slug}`, 120);

  if (!product) notFound();

  const effective = product.salePrice ?? product.price;
  const soldOut = product.stock === 0;

  return (
    <div className="container-page py-16">
      <Link href="/store" className="font-body text-sm text-muted hover:text-ink">
        ← Store
      </Link>

      <div className="mt-8 grid gap-12 lg:grid-cols-[1.15fr_1fr]">
        {/* ── Detail ─────────────────────────────────────────────────── */}
        <div>
          {product.category && <Badge variant="muted">{product.category}</Badge>}

          {product.imageUrl ? (
            <div className="mt-5 flex min-h-[80px] items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.imageUrl}
                alt={`${product.name} badge`}
                className="h-16 w-auto [image-rendering:pixelated]"
              />
            </div>
          ) : (
            <h1 className="mt-5 font-display text-headline font-bold uppercase">{product.name}</h1>
          )}

          {product.imageUrl && (
            <h1 className="mt-5 font-display text-headline font-bold uppercase">{product.name}</h1>
          )}

          <p className="mt-5 max-w-xl font-body text-base leading-relaxed text-muted">
            {product.description}
          </p>

          {product.features.length > 0 && (
            <section className="mt-10">
              <h2 className="eyebrow">What you get</h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {product.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 font-body text-sm text-muted">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-neon" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {product.commands.length > 0 && (
            <section className="mt-10">
              <h2 className="eyebrow">Commands unlocked</h2>
              <ul className="mt-5 flex flex-wrap gap-2">
                {product.commands.map((command) => (
                  <li
                    key={command}
                    className="flex items-center gap-2 rounded-lg border border-edge px-3 py-1.5 font-mono text-xs text-muted"
                  >
                    <Terminal className="h-3 w-3 text-neon" aria-hidden />
                    {command}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-12 max-w-xl">
            <h2 className="eyebrow">Before you buy</h2>
            <div className="mt-5 space-y-3 font-body text-sm leading-relaxed text-muted">
              <p>
                Delivery happens within a minute of payment clearing. If the server is restarting,
                it completes automatically the next time you join — nothing is lost.
              </p>
              <p>
                {product.type === 'RANK'
                  ? 'Ranks survive a server restart and a name change. They do not stack: buying a higher rank replaces the lower one and we credit what you already paid.'
                  : 'Items land directly in your inventory. If it is full, they wait in the delivery queue until there is room.'}
              </p>
              <p>
                Refunds within 30 days on anything unused — open a ticket rather than filing a
                chargeback, which removes the purchase and the account along with it.
              </p>
            </div>
          </section>
        </div>

        {/* ── Purchase panel ─────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="glass p-7">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-4xl tabular text-ink">{money(effective)}</span>
              {product.salePrice !== null && (
                <span className="font-mono text-base tabular text-muted line-through">
                  {money(product.price)}
                </span>
              )}
            </div>

            <p className="mt-2 font-body text-sm text-muted">
              {product.durationDays ? `Lasts ${product.durationDays} days` : 'One-time purchase'}
              {product.grantCoins ? ` · ${product.grantCoins.toLocaleString()} coins` : ''}
            </p>

            {product.stock !== null && (
              <p className={`mt-3 font-body text-sm ${soldOut ? 'text-heart' : 'text-muted'}`}>
                {soldOut ? 'Sold out' : `${product.stock} remaining`}
              </p>
            )}

            <div className="mt-7">
              <Checkout
                productId={product.id}
                productName={product.name}
                unitPrice={effective}
                soldOut={soldOut}
                maxQuantity={product.stock ?? 10}
                allowGift={product.type !== 'COINS'}
              />
            </div>

            {product.coinPrice !== null && (
              <p className="mt-5 border-t border-edge pt-5 font-body text-sm text-muted">
                Also available for{' '}
                <Link href="/shop" className="font-medium text-neon hover:text-neon-hot">
                  {product.coinPrice.toLocaleString()} coins
                </Link>
                .
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
