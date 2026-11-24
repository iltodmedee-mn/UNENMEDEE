import { cacheLife } from "next/cache";

import { formatDateMn } from "@/lib/format";
import { staleAfter } from "@/lib/stale";
import { cx } from "@/utils/cx";

/** The clock lives in a cache entry (refreshed hourly), so pages that show a data age stay static. */
async function isStale(iso: string, days: number): Promise<boolean> {
  "use cache";
  cacheLife("slow"); // follows getIndicator (audit P-3)
  return staleAfter(iso, days, new Date());
}

/**
 * "Шинэчилсэн: 2026 оны 10-р сарын 27" under a block of synced data, and "· хуучирсан өгөгдөл"
 * once the last successful sync is older than `staleDays`. A source that stops answering keeps its
 * previous snapshot (on purpose), and without this the page would show it as if it were current.
 */
export async function DataAge({ at, staleDays, className }: { at: Date | string; staleDays: number; className?: string }) {
  const iso = new Date(at).toISOString();
  const stale = await isStale(iso, staleDays);
  return (
    <span className={cx("whitespace-nowrap", className)}>
      Шинэчилсэн: {formatDateMn(iso)}
      {stale && <span className="ml-1 rounded px-1 text-quaternary ring-1 ring-line ring-inset">хуучирсан өгөгдөл</span>}
    </span>
  );
}
