/**
 * Loading rows in the story list's shape (hairline rows: label, headline, teaser, meta, the ✓),
 * so the page keeps its ledger look while a Suspense boundary waits. Plain markup + animate-pulse.
 */
export function FeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul aria-hidden className="animate-pulse divide-y divide-line-soft border-y border-line">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_2rem] gap-x-3 gap-y-2.5 py-5">
          <span className="h-2 w-24 rounded-sm bg-tertiary" />
          <span className="row-span-3 size-8 rounded-full bg-secondary" />
          <span className="h-4 w-11/12 rounded-sm bg-tertiary" />
          <span className="h-4 rounded-sm bg-tertiary" style={{ width: `${[62, 44, 78, 55, 70, 40][i % 6]}%` }} />
          <span className="h-2.5 w-10/12 rounded-sm bg-secondary" />
          <span className="h-2 w-36 rounded-sm bg-secondary" />
        </li>
      ))}
    </ul>
  );
}
