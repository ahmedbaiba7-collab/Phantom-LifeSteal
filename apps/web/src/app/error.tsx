'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Shown when a route throws. It says what to do next rather than apologising,
 * and the digest is included because it is the one thing support will ask for.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex min-h-[70vh] flex-col items-center justify-center py-20 text-center">
      <h1 className="font-display text-headline font-bold uppercase">This page broke</h1>
      <p className="mt-4 max-w-sm font-body text-sm leading-relaxed text-muted">
        Something failed while rendering. Trying again often works — if it does not, the reference
        below will let support find it.
      </p>

      {error.digest && (
        <p className="mt-5 rounded-lg border border-edge px-4 py-2 font-mono text-xs text-muted">
          {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-ghost">
          Back to home
        </Link>
      </div>
    </div>
  );
}
