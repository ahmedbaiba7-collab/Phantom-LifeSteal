import type { Metadata } from 'next';
import { CoinShop } from '@/components/coin-shop';

export const metadata: Metadata = {
  title: 'Coin Shop',
  description:
    'Spend coins on keys, commands, titles, tags, particles, nicknames, boosters and tradeable items.',
};

export default function ShopPage() {
  return (
    <div className="container-page py-16">
      <p className="eyebrow">Coin shop</p>
      <h1 className="mt-4 font-display text-headline font-bold uppercase">Spend your coins</h1>
      <p className="mt-5 max-w-2xl font-body text-base leading-relaxed text-muted">
        Earn coins by voting, playing, and completing the daily. Everything here is bought with
        coins alone — there is no way to convert real money into an advantage on this page.
      </p>

      <CoinShop />
    </div>
  );
}
