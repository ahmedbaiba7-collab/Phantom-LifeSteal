import type { Metadata } from 'next';
import { VotePanel } from '@/components/vote-panel';

export const metadata: Metadata = {
  title: 'Vote',
  description:
    'Vote on four listing sites once a day each and earn coins. Voting is the fastest free way to fill your wallet.',
};

export default function VotePage() {
  return (
    <div className="container-page py-16">
      <p className="eyebrow">Vote</p>
      <h1 className="mt-4 font-display text-headline font-bold uppercase">Four sites, once a day</h1>
      <p className="mt-5 max-w-2xl font-body text-base leading-relaxed text-muted">
        Every vote pushes the server up the listings, which is how new players find us. Coins land
        as soon as the site confirms the vote — usually under a minute.
      </p>

      <VotePanel />
    </div>
  );
}
