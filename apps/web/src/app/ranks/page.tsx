import type { Metadata } from 'next';
import { serverFetch } from '@/lib/api';
import { money } from '@/lib/format';
import { Reveal } from '@/components/reveal';
import { RankCard, RankComparison, type Rank } from '@/components/rank-card';

export const metadata: Metadata = {
  title: 'Ranks',
  description:
    'Knight, Lord, Paladin, Duke and King. Cosmetics, storage and convenience — never hearts, never gear, never an advantage in a fight.',
};

export const revalidate = 300;

export default async function RanksPage() {
  const ranks = await serverFetch<Rank[]>('/ranks', 300);

  return (
    <div className="container-page py-16">
      <p className="eyebrow">Rank shop</p>
      <h1 className="mt-4 font-display text-headline font-bold uppercase">Five tiers</h1>
      <p className="mt-5 max-w-2xl font-body text-base leading-relaxed text-muted">
        Every rank is permanent unless the card says otherwise. They change how you look, how much
        you can carry, and how quickly you get around — and nothing else.
      </p>

      <div className="glass mt-8 max-w-2xl border-heart/25 p-5">
        <p className="font-body text-sm leading-relaxed text-muted">
          <span className="font-display font-bold uppercase tracking-wide text-heart">
            No rank grants a heart.
          </span>{' '}
          Not one, not a fraction, not a discount at the forge. If a rank could buy survivability,
          the server would stop being a LifeSteal server.
        </p>
      </div>

      {!ranks || ranks.length === 0 ? (
        <div className="glass mt-12 p-12 text-center">
          <h2 className="font-display text-lg font-bold uppercase">Ranks are unavailable</h2>
          <p className="mx-auto mt-3 max-w-sm font-body text-sm text-muted">
            The shop is closed for maintenance. Check Discord for when it reopens.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ranks.map((rank, i) => (
              <Reveal key={rank.id} delay={i * 0.06}>
                <RankCard rank={rank} />
              </Reveal>
            ))}
          </div>

          <section className="mt-20">
            <Reveal>
              <h2 className="font-display text-xl font-bold uppercase tracking-wide">
                Side by side
              </h2>
              <p className="mt-2 font-body text-sm text-muted">
                Every rank includes everything from the ranks below it.
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <RankComparison ranks={ranks} />
            </Reveal>
          </section>

          <p className="mt-14 max-w-2xl font-body text-xs leading-relaxed text-muted">
            Ranks apply within a minute of payment clearing, and survive a server restart or a name
            change. Prices are shown in {money(0).replace(/[\d.,]/g, '').trim() || 'USD'} and include
            any tax we are required to collect. Chargebacks remove the rank and the account; if
            something went wrong, open a ticket instead — refunds within 30 days are routine.
          </p>
        </>
      )}
    </div>
  );
}
