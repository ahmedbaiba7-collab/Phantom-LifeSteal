import Link from 'next/link';

/** An empty screen is an invitation to act, not an apology. */
export default function NotFound() {
  return (
    <div className="container-page flex min-h-[70vh] flex-col items-center justify-center py-20 text-center">
      <p className="font-mono text-6xl tabular text-neon/40">404</p>
      <h1 className="mt-6 font-display text-headline font-bold uppercase">Nothing at this address</h1>
      <p className="mt-4 max-w-sm font-body text-sm leading-relaxed text-muted">
        The page moved, or it never existed. The leaderboards and the wiki are the two places most
        people are looking for.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">Back to home</Link>
        <Link href="/wiki" className="btn-ghost">Open the wiki</Link>
      </div>
    </div>
  );
}
