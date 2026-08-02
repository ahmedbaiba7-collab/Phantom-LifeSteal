import type { Metadata } from 'next';
import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { money } from '@/lib/format';
import { Reveal } from '@/components/reveal';

export const metadata: Metadata = {
  title: 'Store',
  description: 'Ranks, keys and coins. Cosmetics and convenience only — hearts and gear are never for sale.',
};

export const revalidate = 120;

interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: 'RANK' | 'CRATE' | 'KEY' | 'COINS' | 'BUNDLE' | 'COSMETIC';
  price: number;
  salePrice: number | null;
  featured: boolean;
  stock: number | null;
}

const GROUPS: { type: Product['type']; heading: string; blurb: string }[] = [
  { type: 'COINS', heading: 'Coins', blurb: 'Spend them in the coin shop, at the auction house and at player shops.' },
  { type: 'BUNDLE', heading: 'Bundles', blurb: 'The same items, priced together.' },
];

export default async function StorePage() {
  const products = await serverFetch<Product[]>('/store/products', 120);

  return (
    <div className="container-page py-16">
      <p className="eyebrow">Store</p>
      <h1 className="mt-4 font-display text-headline font-bold uppercase">Support the server</h1>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/ranks" className="btn-ghost">Browse ranks</Link>
        <Link href="/shop" className="btn-ghost">Coin shop</Link>
      </div>

      <div className="glass mt-8 max-w-2xl border-heart/25 p-5">
        <p className="font-body text-sm leading-relaxed text-muted">
          <span className="font-display font-bold uppercase tracking-wide text-heart">
            Nothing here affects a fight.
          </span>{' '}
          No hearts, no gear, no stat boosts, no protection. Everything on this page is cosmetic,
          convenience, or a tradeable item you could have got in game. That is the whole point of a
          LifeSteal server, and we are not selling it.
        </p>
      </div>

      {!products || products.length === 0 ? (
        <div className="glass mt-12 p-12 text-center">
          <h2 className="font-display text-lg font-bold uppercase">The store is closed</h2>
          <p className="mx-auto mt-3 max-w-sm font-body text-sm text-muted">
            Nothing is listed right now. Check Discord for when it reopens.
          </p>
        </div>
      ) : (
        GROUPS.map((group) => {
          const items = products.filter((p) => p.type === group.type);
          if (items.length === 0) return null;

          return (
            <section key={group.type} className="mt-14">
              <Reveal>
                <h2 className="font-display text-xl font-bold uppercase tracking-wide">{group.heading}</h2>
                <p className="mt-2 font-body text-sm text-muted">{group.blurb}</p>
              </Reveal>

              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {items.map((product, i) => (
                  <Reveal key={product.id} delay={i * 0.05}>
                    <article
                      className={`glass flex h-full flex-col p-6 transition-colors ${
                        product.featured ? 'border-neon/40 shadow-neon' : 'hover:border-neon/30'
                      }`}
                    >
                      {product.featured && (
                        <p className="mb-3 w-fit rounded-full bg-neon/15 px-3 py-1 font-display text-eyebrow font-bold uppercase text-neon-hot">
                          Most popular
                        </p>
                      )}

                      <h3 className="font-display text-lg font-bold uppercase tracking-wide">
                        {product.name}
                      </h3>
                      <p className="mt-2.5 flex-1 font-body text-sm leading-relaxed text-muted">
                        {product.description}
                      </p>

                      <div className="mt-6 flex items-baseline gap-2">
                        <span className="font-mono text-2xl tabular text-ink">
                          {money(product.salePrice ?? product.price)}
                        </span>
                        {product.salePrice !== null && (
                          <span className="font-mono text-sm tabular text-muted line-through">
                            {money(product.price)}
                          </span>
                        )}
                      </div>

                      {product.stock !== null && product.stock <= 5 && (
                        <p className="mt-2 font-body text-xs text-heart">
                          {product.stock === 0 ? 'Sold out' : `Only ${product.stock} left`}
                        </p>
                      )}

                      <Link href={`/store/${product.slug}`} className="btn-primary mt-5 w-full">
                        {product.stock === 0 ? 'Sold out' : 'View'}
                      </Link>
                    </article>
                  </Reveal>
                ))}
              </div>
            </section>
          );
        })
      )}

      <p className="mt-16 max-w-2xl font-body text-xs leading-relaxed text-muted">
        Purchases are delivered in game within seconds. If the server is restarting, delivery
        completes automatically the next time you join — nothing is ever lost. Refunds are available
        within 24 hours on unused items; open a ticket rather than filing a chargeback.
      </p>
    </div>
  );
}
