# Security policy / Аюулгүй байдлын бодлого

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.
Report it privately: **Security → Report a vulnerability** on this repository
(GitHub private vulnerability reporting), or by email to **info@iltodmedee.mn**.
You will get an answer within 7 days. (Also published as `/.well-known/security.txt`.)

Useful details: the URL or file, steps to reproduce, and what an attacker could do.

## Эмзэг байдал мэдэгдэх

Аюулгүй байдлын асуудлыг **нийтэд нээлттэй issue болгож бүү бичээрэй**.
Энэ repository-ийн **Security → Report a vulnerability** товчоор, эсвэл **info@iltodmedee.mn** хаягаар нууцаар мэдэгдэнэ үү.
7 хоногийн дотор хариу өгнө.

## Scope

- The site https://iltodmedee.mn and the code in this repository (scrapers, AI pipeline,
  admin, push notifications, GitHub Actions workflows).
- Out of scope: the government websites we read from, denial-of-service, social engineering,
  and reports from automated scanners without a working proof.

## How secrets are handled

- No API key, database password or private key is stored in this repository.
  AI provider keys and `DATABASE_URL` live only in GitHub Actions secrets and Vercel
  environment variables; `.env*` files are git-ignored (only `.env.example` is committed).
- Workflows run with read-only `GITHUB_TOKEN` permissions, actions are pinned to commit
  SHAs, and Dependabot proposes updates weekly.
- The weekly database backup (`backup.yml`, `docs/BACKUP.md`) is encrypted with `age` to the
  owner's public key before it leaves the job; the private key never touches GitHub. Artifacts of
  a public repository are downloadable by any signed-in user, so nothing else is uploaded, and the
  log prints row counts only.
- Paid AI providers stop at a monthly USD cap (`AI_MONTHLY_BUDGET_USD`), so a leaked or
  abused key cannot run up an unbounded bill. Every call is logged on `/transparency`.

## Threat model (what protects what)

- **Publishers do not choose our destinations.** Every scraper request (fetch, Crawlee's got,
  robots.txt, the headless browser) connects only to public addresses: a custom DNS lookup and an
  IP-literal check at connect time (`src/lib/scraper/net-guard.ts`), so a redirect, a WordPress
  `link` or a DNS change cannot point the GitHub runner or a Vercel function at loopback, a
  private network or cloud metadata. Publisher input is parsed in bounded time and size.
- **Logout is server-side.** Signing out stores a cut-off in `app_settings`; every admin page and
  action refuses tokens issued before it, so a copied cookie stops working.
- **One database role, two writers.** GitHub Actions (scraper, AI, syncs) and Vercel share the
  owner connection string. Vercel must write: push subscriptions, followed MPs, admin edits and
  the donation setting. A read-only role would break those, so instead every write path on Vercel
  validates its input (zod, a push-service host allowlist) or calls `requireAdmin()`, and public
  ones are rate-limited and capped (`subscribePush` and `POST /api/push`: 60 per IP per hour, 500 new per hour, 50k
  total). Row-level security with no policies blocks Supabase's public REST API on every table.
- **Admin.** `/admin` is guarded twice (`proxy.ts` redirect and `requireAdmin()` in every page and
  server action). The password is 12+ characters and compared in constant time; each wrong guess
  waits 800 ms and an IP is locked out for 15 minutes after 5 failures. Sessions are HMAC-signed,
  expire after 7 days and end for everyone when the password changes.
- **Scraped content.** Pages are stored as cleaned text, never HTML. Links rendered from scraped
  data must be http(s) (`safeHttpUrl`). Text sent to AI models is wrapped in `<article_text>` tags
  and every prompt says to ignore instructions inside it (indirect prompt injection); the output is
  validated with zod, and the "high risk" flag is computed by our code, not taken from the model.
- **Webhooks.** `/api/messenger` accepts a POST only with Meta's `X-Hub-Signature-256` (HMAC of the
  raw body with the app secret) and compares its verify token in constant time; `/api/discord` checks
  Discord's Ed25519 signature on every request. Replies are built from our own data, never by a model,
  and incoming messages are not stored.
- **Admin URL fetching.** URLs typed into the admin go through an SSRF guard (http(s) on 80/443,
  every redirect re-checked, private and metadata IPs refused).
- **Browser.** `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy, a permissions policy,
  and a CSP with `base-uri`, `object-src 'none'`, `frame-ancestors 'none'` and `form-action`.
  There is no `script-src`: Next.js needs inline scripts, and nonces would make every static page
  dynamic.
- **Supply chain.** Actions pinned to commit SHAs, read-only `GITHUB_TOKEN`, Dependabot with a
  7-day cooldown, dependency review and CodeQL on PRs, and a `main` ruleset (PR + green CI). Forks
  never run the scheduled workflows (`if: github.repository_owner == 'iltodmedee-mn'`).

## Supported versions

Only the `main` branch (what runs on iltodmedee.mn) receives fixes.
