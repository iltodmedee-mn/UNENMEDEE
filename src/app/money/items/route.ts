import { MONEY_ITEMS_KEY, type MoneyItems } from "@/lib/money-map/build";
import { getIndicator } from "@/lib/queries";

/**
 * Each map point's biggest lots (src/lib/money-map/build.ts), fetched once by the /money map. The
 * CDN keeps it an hour and serves the old copy while it refreshes, so the database is read about
 * once an hour however many readers open the map.
 */
export async function GET() {
  const snap = await getIndicator<MoneyItems>(MONEY_ITEMS_KEY).catch(() => null);
  return Response.json(snap?.data ?? {}, {
    headers: { "cache-control": snap ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" : "no-store" },
  });
}
