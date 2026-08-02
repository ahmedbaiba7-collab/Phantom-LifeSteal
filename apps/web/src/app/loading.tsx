/**
 * Route-level skeleton. Deliberately structural rather than a spinner: it holds
 * the shape of the page so the layout does not jump when content arrives.
 */
export default function Loading() {
  return (
    <div className="container-page py-16" aria-busy="true" aria-label="Loading">
      <div className="h-3 w-24 animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-6 h-10 w-2/3 max-w-lg animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass h-44 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
