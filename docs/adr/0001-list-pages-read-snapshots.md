# List pages read snapshots, not live queries

On Nov 8 2026 the free tiers ran out: Vercel paused the Hobby project (457 K ISR writes and 4 h 14 m of CPU in 30 days, limits 200 K and 4 h) and Supabase egress reached 6.2 GB of 5 GB. The cost came from list pages (home, the topic feeds) rebuilding every 30 minutes and running their full queries each time, whether or not anything had changed. Kagi News serves one pre-built file per list and never queries a database when a reader visits; we take the same idea while keeping server-rendered HTML for search engines and the 30-minute pipeline. Each pipeline run writes one snapshot row per list page to `feed_snapshots` (Postgres, one small row per key), compares it with the previous one, and asks Next.js to rebuild only the pages whose snapshot changed; the page reads its one row, cached for days. An admin edit rebuilds the snapshots at once, a missing snapshot falls back to the live query, and the watchdog reports snapshots older than two hours. The goal is to return to the free Hobby plan on Dec 8 2026.

## Considered Options

- **Vercel Blob or Cloudflare R2 files**: no database read at all, but one write per list per run (~72 K a month) is near the Blob free tier, and R2 needs a new account and secret. A one-row read on rebuild is cheap enough.
- **A client-rendered app reading JSON (Kagi's model)**: rejected; list pages must stay server-rendered HTML for Google and Google News.
- **Keep the live queries and tune cache lifetimes**: done first (#278–#281); it cut the cost but every list page still rebuilt on a timer with the full queries.
