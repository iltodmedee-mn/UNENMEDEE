# Architecture

How [iltodmedee.mn](https://iltodmedee.mn) works, end to end. Everything here runs on free tiers:
GitHub Actions (public repo), Vercel Hobby and Supabase Free (500 MB Postgres). The only paid
part is optional AI, capped at $3 a month.

- [System overview](#system-overview)
- [Data model](#data-model)
- [Scraping](#scraping)
- [AI pipeline](#ai-pipeline)
- [Clustering and the digest](#clustering-and-the-digest)
- [Civic data](#civic-data)
- [Web app and rendering](#web-app-and-rendering)
- [Push notifications](#push-notifications)
- [Social channels](#social-channels)
- [Security model](#security-model)
- [Running unattended](#running-unattended)
- [Testing](#testing)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)

## System overview

```mermaid
flowchart LR
  subgraph GH["GitHub Actions (cron)"]
    S["scrape<br/>every 30 min"] --> A["ai:process"]
    D["digest + data syncs<br/>08:07 / 20:07 UB"]
    O["officials:sync<br/>weekly"]
    W["watchdog daily<br/>keepalive daily"]
  end
  GOV[".gov.mn sites,<br/>APIs, RSS"] --> S
  API["NSO, Mongolbank,<br/>Шилэн данс, ХАСХОМ,<br/>parliament.mn"] --> D & O
  A <--> LLM["LLM providers<br/>(free tiers first)"]
  S & A & D & O --> DB[("Supabase Postgres")]
  DB --> V["Vercel / Next.js 16<br/>static pages + CDN"]
  V --> R["Readers<br/>(web, PWA, push)"]
```

There is no long-running server. All writes happen in scheduled GitHub Actions jobs; the website only
reads (plus a few rate-limited server actions for push subscriptions and the admin area). The
database is the only shared state between the two halves.

| Job | Schedule | Script | Writes |
|---|---|---|---|
| News pipeline | every 30 min (four crons: :17 and :32 on even UTC hours, :02 and :47 on odd ones; GitHub may skip some, and a pg_cron fallback dispatches the workflow after 60 min without a start, `docs/PIPELINE-FALLBACK.md`) | `scripts/run-scraper.ts`, `scripts/process-ai.ts` | `articles`, `clusters`, `ai_usage_logs` |
| Digest + data | 08:07, 20:07 Ulaanbaatar | `digest`, `data:sync`, `macro:sync`, `budget:sync`, `tenders:sync`, `docs:watch`, `db:prune` | `digests`, `open_datasets`, `indicator_snapshots`, `tenders`, `documents`, `watched_pages` |
| Officials | weekly | `officials:sync` | `politicians`, `asset_declarations` |
| Source discovery | weekly | `sources:discover` | `sources` |
| Source re-check | weekly | `sources:recheck` | `articles.source_status`, `source_diff` |
| Social posts | after each pipeline / digest run | `social:post` (news, digest, quiz, weekly) | `social_posts` |
| Videos | slots 12–16 / 19–23 Ulaanbaatar (`video.yml` + pipeline, `--slot`) | `video:make` (midday: a fresh story's ₮ amount ÷ population; evening: a fresh decision's "who / what changes / when / what to do", else NSO prices; → ElevenLabs voice paced by the monthly credits, else Gemini → Playwright frames → ffmpeg MP4), then `social:post --mode video` (Facebook / Instagram Reels, Threads) | `videos`, `social_posts`, `ai_usage_logs` |
| Watchdog | daily | `npm run health` | a GitHub issue when something is stale |
| Vercel cleanup | daily | `vercel:cleanup` | deletes old Vercel deployments (10 GB Hobby storage) |
| Keepalive | monthly | GitHub API | re-enables scheduled workflows |
| Maintenance | manual | `refetch-dates`, `recluster`, `ai-sample` | repairs, dry run by default |
| CI | every PR | `npm run check`, `npm run build`, dependency review, CodeQL | nothing |

## Data model

Drizzle ORM schema in [`src/db/schema.ts`](../src/db/schema.ts), hand-written idempotent SQL
migrations in [`drizzle/`](../drizzle) (`IF NOT EXISTS` everywhere, so a rerun is harmless).

| Table | Holds |
|---|---|
| `sources` | Every monitored site: domain, category (portal / ministry / agency / local), scrape state, `consecutive_failures` for back-off |
| `articles` | Cleaned text (never raw HTML), `content_hash` (SHA-256), AI fields (`tldr`, `facts`, `spin_detected`, `neutrality_score`, `risk_score`, `importance_score`, `topic`, `extracted_entities`), deep analysis, cluster id, prune / fallback / notification markers |
| `clusters` | Cross-source stories: title, synthesis, article count |
| `ai_usage_logs` | One row per LLM call: provider, model, tier, prompt/completion tokens, USD cost, success, error |
| `digests` | "Онцлох тойм" editions (12 h and 30 d) as JSON |
| `politicians`, `asset_declarations` | MPs from parliament.mn and their yearly ХАСХОМ declarations (₮) |
| `open_datasets` | opendata.mn metadata and small computed highlights (never raw rows) |
| `indicator_snapshots` | One JSON document per external source (`mongolbank`, `budget_nso`, `shilendans`, `soe_finance`, …) |
| `tenders` | Tender results each budget body files to Шилэн данс (form 1831): code, item, budget, contract, method, winner, date; amounts in an unclear unit are flagged, never rescaled (`/tenders`) |
| `documents`, `watched_pages` | New audit.mn reports and file links added to watched WordPress report/tender pages (link, text, page only; never the file) (`/documents`) |
| `push_subscriptions` | Web Push endpoints and followed MPs |
| `videos` | Generated price videos: the MP4 for a few days (served at `/reel?v=<id>` for the platforms to fetch), then only the key and the numbers it showed |
| `social_posts` | What was posted to Facebook, Instagram, Threads, Telegram and Discord (one row per platform + kind + item, so nothing posts twice) |
| `app_settings` | Server-side settings shared by Vercel and Actions (VAPID keys, donation account, refreshed Threads/Instagram tokens, hidden declaration years) |
| `transparency_ledger` | Income and costs shown on `/transparency` (keeps each month's AI total after its call logs are pruned) |
| `donations` | Each received donation (day, ₮, the donor's name as published: initials by default, full only with consent, or none), typed in `/admin`, listed on `/transparency` |
| `seen_urls` | URL + SHA-256 of articles the retention job deleted, so the scraper still skips them (~100 bytes a row) |

Size budget: about 5 KB per article row with its indexes; in Oct 2026 the database grew about
1.25 MB a day, more than half of it unpublished rows kept only so pages are not fetched twice.
`db:prune` (`src/lib/retention.ts`, daily) keeps it bounded, in batches of 500 rows:

| Database size | Bodies cut to 600 characters after | Unpublished rows deleted after | Minor stories over 2 years old |
|---|---|---|---|
| < 350 MB | `RETENTION_DAYS` (180) | 90 days | kept |
| ≥ 350 MB | ≤ 90 days | 30 days | kept |
| ≥ 420 MB | ≤ 45 days | 30 days | deleted |

A deleted row leaves its URL and hash in `seen_urls` (forgotten after 400 days). "Minor" means no
cluster, importance below 40, not a legal act, not edited and not in any digest; important stories,
legal acts, clustered stories and digests are never deleted. AI call logs older than 13 months go too,
except the call that wrote a living article's summary (the page names that model). Each run is
recorded in `app_settings.prune_state`, the public counters add the deleted rows back, and the
watchdog reports a prune that stopped running.

## Scraping

Library code in [`src/lib/scraper`](../src/lib/scraper), entry point `scripts/run-scraper.ts`.

**Politeness.** Our own robots.txt parser ([`robots.ts`](../src/lib/scraper/robots.ts)) and an 8-second
minimum delay per host ([`http.ts`](../src/lib/scraper/http.ts)). The User-Agent names the site.
The Crawlee crawler uses the same policy for every request it queues (not Crawlee's own check, which
treated an unreachable robots.txt as "allowed"): per RFC 9309 a 5xx or unreachable robots.txt means
nothing is crawled from that site in this run, and the largest Crawl-delay (up to 20 s) becomes the
per-domain delay. robots.txt files are read 8 hosts at a time, and a network error gets one more try
after 3 s: one `Promise.all` over every source once made ~40 sources time out in the same second and
start their back-off. Sites behind a Cloudflare browser challenge are marked inactive; we never try to get around it.

**Order of attempts per source:**

1. **Adapters** ([`adapters/`](../src/lib/scraper/adapters)) for sites with a public API or feed:
   opendata.gov.mn, parliament.mn, legalinfo.mn (`POST /mn/ajaxLlist/`), police.gov.mn, and zasag.mn via
   the `mongolia.gov.mn` RSS feed. These are the same JSON endpoints the sites' own pages call.
2. **HTTP pass** ([`crawl.ts`](../src/lib/scraper/crawl.ts), Crawlee + cheerio): WordPress REST API
   (the base the page advertises in `<link rel="https://api.w.org/">`, so plain-permalink installs
   with `?rest_route=` work too; a post without `link` is reached as `/?p=<id>`), then RSS/Atom, then
   scored link harvesting from news listing pages ([`links.ts`](../src/lib/scraper/links.ts): article
   ids in the query string such as `/?p=123` or `mn.php?page=40&news=1633` count, pagination does
   not), with the homepage as a last resort. A splash page with fewer than three article links is
   followed one hop into its news sections (`/home`, `/j`, `/c/medee…`, anchors reading "Мэдээ").
   404/410 pages are never stored; a listing that was reached but yielded nothing is a failure.
3. **Browser pass**: headless Chromium (Playwright) only for sources whose news list needs JavaScript.

**Extraction.** Mozilla Readability on jsdom, with a cheerio fallback
([`extract-safe.ts`](../src/lib/scraper/extract-safe.ts)). The text is cleaned, capped and hashed with
SHA-256; an already-seen hash is skipped before any AI call, so duplicate press releases cost nothing.

**Headlines and dates.** Some sites put their own name on every page ("Мэдээ | ТТХГ"), so the
headline is the first candidate (Readability, `og:title`, `<h1>`, `<title>`) that is not a section
word, the site's name or abbreviation, or a title the same site already used this month; otherwise the
first sentence of the text ([`titles.ts`](../src/lib/scraper/titles.ts)); headlines a site publishes in
capitals are stored in sentence case, keeping abbreviations and initials. Menu pages, "about this
department" pages and help pages ("… асуулт хариулт") reached through news links are stored unpublished. The date comes from meta
tags, JSON-LD, `<time>`, the URL, or a date printed between the headline and the body (dates in
"related news" lists below the body are ignored). Machine dates without a time zone are Ulaanbaatar
time; a `<time>` more than a year older than the newest one on the page is a stray stamp in the page
chrome and is skipped; a date printed in the text is only trusted when it is less than a year old
(older ones are quoted resolution dates). A page with no date is flagged `date_unknown` and shown as
"Огноо тодорхойгүй"; if its text only mentions years before last year it is an archive page and is
not published. Dated items older than 60 days (`MAX_AGE_DAYS`) are stored unpublished too, so a
crawler that reaches an archive never surfaces 2009 resolutions as today's news (a `--days` backfill
widens the window to what it asked for).

**Scheduling.** Sources rotate least-recently-scraped first inside a 30-minute budget. A failing source
backs off 2^n hours. From GitHub's US runners `.gov.mn` hosts are ~250–300 ms away, so
[`net-setup.ts`](../src/lib/scraper/net-setup.ts) raises Node's happy-eyeballs per-address timeout from
250 ms to 3 s (the default made 57 sources fail at once with an empty `AggregateError`).

**Discovery.** `sources:discover` reads hub pages (government portals, aimag lists) weekly and adds new
`*.gov.mn` / `*.khural.mn` sites.

**Re-checking sources.** Government sites sometimes edit or delete a post after publishing it.
`source-recheck.yml` (weekly, `npm run sources:recheck`) fetches the last 30 days of articles again
(robots.txt, 8 s per host) with the same text getter that first read them. Hashes are never compared,
because widgets and counters change every page. Instead [`recheck.ts`](../src/lib/scraper/recheck.ts)
asks how many sentences of our stored copy are still on the page. Below 80 %, or a sentence whose
numbers changed, marks the article `changed` and stores the before/after sentences (`source_diff`,
capped at 12). A 404/410, or a redirect to the homepage or another site, on two checks at least six
days apart marks it `gone`. Timeouts, 5xx and failed extraction prove nothing and are skipped. The
article page shows the diff, and `/changes` lists every case. A manual run is a dry run by default.

## AI pipeline

Library code in [`src/lib/ai`](../src/lib/ai); the prompts are public in
[`prompts.ts`](../src/lib/ai/prompts.ts) and rendered verbatim on [/method](https://iltodmedee.mn/method).

```mermaid
flowchart TD
  N["New article<br/>(hash not seen)"] --> G{"Budget guard"}
  G --> T1["Tier 1: summary, facts, spin,<br/>entities, risk 0-100, importance, topic,<br/>plain headline, who it touches"]
  T1 --> Z{"zod valid?"}
  Z -- no --> RP["one repair retry"] --> Z
  Z -- yes --> R{"risk ≥ 65?"}
  R -- yes --> T2["Tier 2: investigative analysis<br/>+ citizen questions"]
  R -- no --> C["Clustering"]
  T2 --> C
  T1 & T2 --> L[("ai_usage_logs<br/>tokens + USD")]
```

**Provider chains** ([`router.ts`](../src/lib/ai/router.ts)), all through the `openai` SDK with a
custom `baseURL` except Gemini (native `generateContent`):

- Tier 1: Groq, NVIDIA NIM, Requesty (free Gemma), OpenRouter (`:free` models only) take turns → Z.ai (GLM Flash only, free overflow: weaker Mongolian) → Gemini → DeepSeek → Ollama. Gemini is free with a key from a Google project without billing (`GEMINI_FREE_TIER=true`, then it sits right after Groq); a billed key comes after the free providers and uses only `gemini-3.1-flash-lite` (the cheapest text model a new key may call) inside the USD budget. Image/video/speech models are refused.
- Tier 2: xAI Grok → Gemini → Groq → NVIDIA → Requesty → OpenRouter → Z.ai → DeepSeek → Ollama (billed Gemini moves behind the free ones)

A provider that errors, rate-limits (one retry after a 429) or returns invalid JSON hands over to the
next. Chains can be overridden with `AI_TIER1_CHAIN` / `AI_TIER2_CHAIN`.

**Structured output.** JSON mode, then zod schemas ([`schemas.ts`](../src/lib/ai/schemas.ts)) with one
repair retry. Scores are clamped; an unknown `topic` becomes null; ₮ amounts found by regex are merged
into the entities.

**The reader's view.** Tier 1 also writes a plain headline (`reader_title`, ≤ 80 characters, the
decision and the number first, no protocol phrases) and "Танд хамаатай юу?" (`reader_impact`: who it
touches, what changes, from when, what to do). [`reader-view.ts`](../src/lib/ai/reader-view.ts) checks
every number in them against the article's own text and date and drops a field that does not match;
a field the text does not support stays null and nothing is shown. The page keeps the government's
headline word for word under ours. A headline that only reports a meeting, visit or opening
([`ceremony.ts`](../src/lib/ai/ceremony.ts)) is capped at importance 40 and labelled "Протокол" by rule,
not by the model. `npm run ai:reader` fills older stories in batches of 8.

**The risk score is an estimate.** The model scores 0–100 by a rubric in the prompt. The "high"
flag is computed by our code (`risk_score >= 65`), never taken from the model, and the prompts forbid
asserting that anyone committed a crime.

**Cost control** ([`limits.ts`](../src/lib/ai/limits.ts)). A guard runs before every call:
- Paid providers stop at `AI_MONTHLY_BUDGET_USD` ($3) and `AI_DAILY_BUDGET_USD` ($0.30), summed from
  `ai_usage_logs`.
- Every provider has a daily call cap (Grok: 5) and optional per-minute throttling.
- Free providers keep working after the money runs out.
- Input is cut to 4,000 characters (tier 1) and 8,000 (tier 2); opendata.gov.mn datasets are
  summarized by rules with 0 tokens.

Every call, successful or not, is logged with its tokens and USD cost (a provider-reported cost wins
over our price table in [`pricing.ts`](../src/lib/ai/pricing.ts)). `/transparency` is a plain SQL view
of that table.

**Fallback.** If an article is still unsummarized after 24 h (every provider down or out of quota), its
first sentences become the summary, labelled "AI ажиллаагүй" on the page
([`fallback.ts`](../src/lib/ai/fallback.ts)).

## Clustering and the digest

**Clustering** ([`clustering.ts`](../src/lib/ai/clustering.ts)) groups the same story from different
sources, with no embeddings or extra API calls:

- Mongolian is agglutinative (тендер, тендерийн, тендерт), so words are cut to 6-letter stems after
  removing stopwords.
- similarity = max(bigram-shingle Jaccard, 0.7 × stem Jaccard + 0.3 × entity Jaccard), the second
  term only when stems already overlap ≥ 0.25.
- A same-headline channel: two titles with ≥ 0.8 stem Jaccard (≥ 3 stems) whose bodies also overlap
  (≥ 0.3) score at least 0.6 × the headline score. Two sites often post one story under the same
  headline while the AI words each summary differently; the body condition keeps identical generic
  headlines about different events apart (tested on real pairs in `tests/fixtures/cluster-pairs.json`).
- Join threshold 0.45, cross-source only, published rows only, 7-day window. `ai:process` clusters a
  whole run at once from one pool of every row of the window (`assignClusters`): a per-article pool
  capped at the 500 newest rows covered only ~2 days and found 3 clusters a week. A cluster synthesis is
  written only at growth milestones, not on every new member.

**Digest** ([`digest.ts`](../src/lib/ai/digest.ts)), twice a day:

1. Rank without AI:
   `importance + 0.3 × risk + 8 × min(other sources, 4) + source-category weight + 10 for national sites`,
   one article per cluster.
2. Send the top 40 (70 for the monthly edition) to an editor model, which picks 10 (20) and writes a
   headline and "why it matters" for each.
3. Drop any id the model invented. Without AI, the rule-based ranking is published as is.

## Press coverage

`npm run press:sync` reads three independent newsrooms' feeds ([`outlets.ts`](../src/lib/press/outlets.ts):
ikon.mn, news.mn, sonin.mn) with the same robots.txt check and 8 s delay as the scraper, and stores
only each headline and its link. [`match.ts`](../src/lib/press/match.ts) compares them with the last
week's government stories (TF-IDF cosine over 5-letter stems, threshold 0.45, calibrated on real
headlines; two headlines naming different people never match). The article page lists the matches
under "Хэвлэлд"; an important story that none of them had after a day says so in neutral words
("ижил гарчиг олдсонгүй"), the idea behind Ground News' "blindspot".

## Civic data

Facts only: every number links to its official source and no copy accuses anyone. Each source has a
parser unit-tested against a saved real response in [`tests/fixtures`](../tests/fixtures).

| Page | Source | Code |
|---|---|---|
| `/officials` | parliament.mn member API + IAAC ХАСХОМ declarations API | [`src/lib/officials`](../src/lib/officials) |
| `/officials/companies` | Шилэн данс open-data report form 2480 (state-owned companies) | [`src/lib/soe`](../src/lib/soe) |
| `/budget` | NSO PX-Web (JSON-stat 2.0), Шилэн данс, World Bank, audit.mn register | [`src/lib/budget`](../src/lib/budget) |
| `/projects` | A curated dataset of the big announced projects (new cities, power plants, the refinery, the metro, the satellite): official acts, budget lines, reported spending, people in official roles and the stage each body itself states, every fact with its page; no verdicts | [`src/lib/projects`](../src/lib/projects) |
| `/prices` | NSO PX-Web monthly average prices of 13 everyday goods since 2010 (Улаанбаатар + 21 aimags) and quarterly wages; household electricity/water tariffs typed in from the regulator's decisions, shown only once verified | [`src/lib/budget/prices.ts`](../src/lib/budget/prices.ts), [`tariffs.ts`](../src/lib/budget/tariffs.ts) |
| `/data`, home strip | Mongolbank JSON endpoints, opendata.mn API | [`src/lib/mongolbank`](../src/lib/mongolbank), [`src/lib/opendata-mn`](../src/lib/opendata-mn) |
| `/tax` | NSO spending structure; all maths in the browser | [`src/lib/tax`](../src/lib/tax) |
| `/promises` | The Government's 2024–2028 action programme (Word file from legalinfo.mn), verbatim | [`src/lib/promises`](../src/lib/promises) |
| `/place/<slug>` | 21 aimags, the capital and 9 districts: their sites' news and their constituency's MPs | [`src/lib/places.ts`](../src/lib/places.ts) |

Neutral markers for declarations (for example total assets +50 % year on year) are plain rules in
[`flags.ts`](../src/lib/officials/flags.ts), shown with the numbers and labelled "анхаарах өөрчлөлт",
never as a conclusion.

## Web app and rendering

Next.js 16 App Router with **Cache Components** (`cacheComponents: true`):

- All database reads are `'use cache'` functions in [`src/lib/queries.ts`](../src/lib/queries.ts) with
  `cacheLife` and `cacheTag`. Pages such as `/` and `/topic/<key>` are fully static and served from the
  CDN; they revalidate in the background.
- Each query times out after 10 s. With no `DATABASE_URL`, or during `next build`, it returns the empty
  state, so the site builds with no database at all (CI and contributors need no secrets). At run time
  the error propagates instead: a failed `'use cache'` call is not cached, so a database blip costs one
  request, never an hour of empty pages.
- Per-reader state (read marks, streak, followed MPs, text size) lives in `localStorage` via
  `useSyncExternalStore`, so the server HTML never depends on the reader or the clock.
- UI: the "Ledger" look (one paper surface, 1 px hairlines, Inter Display headlines, JetBrains Mono
  numbers, the logo's teal and a yellow signal for ₮ amounts) on Untitled UI React (React Aria +
  Tailwind CSS v4), ElevenLabs UI for AI message blocks, Recharts with a table view for every chart.
  Animation is CSS (`@starting-style`, scroll-driven, view transitions) and respects reduced motion.
- Performance budget: Lighthouse mobile ≥ 0.9 on the home page (measured 90–95, CLS 0). The home page
  renders 20 stories and loads more on request; heavy libraries (markdown renderer, charts) stay off
  the home bundle. Fonts are self-hosted subsets (Latin + Cyrillic + Ө Ү ₮).
- SEO: per-page canonicals, `sitemap.xml`, a Google News sitemap, RSS, `NewsArticle` JSON-LD and
  generated OG images. Internal links keep every story reachable without JavaScript: an article links
  to its topic, place, source and day; `/archive/<yyyy-mm-dd>` lists every published story of an
  Ulaanbaatar day by topic (`/archive` indexes the last 60 days, the feeds link the last 7);
  `/source/<domain>` lists one official site's newest 40 stories (its title names the domain, since
  people search "mof gov").
- Search intent: titles and H1s carry the words people type ("Валютын ханш, инфляц…", "Цалингийн
  татвар тооцоолуур", "Д.Ганмаа (…) — хөрөнгө, орлого, ирц"). Page JSON-LD: `Dataset` (naming the
  official publisher) on `/data` and `/budget`, `WebApplication` on `/tax`, `ItemList` on `/officials`,
  `Person` on MP profiles, `CollectionPage` on topic, place, archive and source pages.
- Thin pages: a story with low importance, no other source, no ₮ amount and not a legal act
  ([`seo.ts`](../src/lib/seo.ts)) is `noindex, follow` and left out of the sitemaps; it stays on the
  site, in the archive and in RSS. Old `/?f=<topic>` links redirect to `/topic/<topic>` in
  [`proxy.ts`](../src/proxy.ts), which only runs when that parameter is present.

Functions run in Vercel's `sin1` region, next to the Supabase database (ap-southeast-1).

## Push notifications

Installable PWA ([`public/sw.js`](../public/sw.js), which never caches pages). Web Push with a VAPID key
pair stored in `app_settings`. After each pipeline run `push:send` sends at most **one** notification
(the top story + "+N"), because bursts were partly rejected by Apple. Readers who follow MPs get one
alert when their MPs are named in the last 24 h. Subscriptions are public server actions with zod
validation, a push-service host allowlist and per-IP / global rate limits.

## Social channels

After the push steps, `social:post` ([`scripts/post-social.ts`](../scripts/post-social.ts)) posts each new
digest edition and at most one important story per run (four per day, one per cluster) to the site's
Facebook page through the Graph API (`POST /{page-id}/photos` with our hook card, the link in the text).
A `social_posts` row is reserved before each call and removed only when the platform clearly refused the
post; after a timeout or a DB error following a publish it stays (marked for a manual check), because a
second attempt could be a duplicate.
The never-expiring Page token is the `FB_PAGE_TOKEN` Actions secret ([setup](FACEBOOK.md)).
The same posts go to Threads (IMAGE post with the card, link in the text, 500 characters); its 60-day
token is refreshed weekly by the pipeline and kept in `app_settings` (removing the secret turns the
platform off).
Instagram gets the same stories as a 1080×1350 JPEG card rendered by `/ig-image` (Instagram accepts only
JPEG from a public URL), with the summary as the caption; its 60-day token is kept and refreshed like Threads'. Instagram DMs
get the same no-AI replies as Messenger.
All three platforms use the same bold typographic card (`/ig-image`, the headline's first figure in yellow,
rule-based) and lead the text with the editor's fact-based headline and "why it matters"; no photos of people,
no generated images.

People who message the page get an automatic Messenger reply from `/api/messenger`
([`route.ts`](../src/app/api/messenger/route.ts)): the request must carry Meta's HMAC signature, and the
answer is built from our own data only (the latest digest or the top search results, with links), never
from a language model. The route answers Meta with 200 at once and sends the reply afterwards (`after()`),
and answers a redelivered message id once. Messages are not stored in the database.

Telegram (Bot API, the same card and text) and Discord get the same posts. Discord posts go to an
announcement channel and are crossposted, so any server can press **Follow** and receive them without
adding a bot; a daily quiz poll (guess the ₮ amount in a real headline) and a Monday top list are
rule-based, no AI. Discord slash commands (`/toim`, `/haih`, `/aimag`) arrive at `/api/discord` as
signed HTTP requests (Ed25519), so nothing is hosted. Setup for every platform: [FACEBOOK.md](FACEBOOK.md).

## Security model

- **No secrets in the repository.** AI keys and `DATABASE_URL` live in GitHub Actions secrets and Vercel
  environment variables. Push protection blocks commits that contain known key formats. Secrets never
  reach `npm ci` / `playwright install` (a compromised dependency's install script): they are blanked
  on those steps or set only on the steps that use them.
- **Database:** every table has row-level security with no policies, so Supabase's public API reaches
  nothing; the app and Actions connect as the owner.
- **Generated images** (`/ig-image`, `/story-image`) redirect to their canonical query, so junk
  parameters cannot bypass the CDN and force a render per request.
- **Prompt injection:** scraped text, its title and the Tier-1 output reach models only inside data
  tags that the text cannot close, and every system prompt says to ignore instructions inside them.
- **Admin** (`/admin`): `proxy.ts` redirects, and `requireAdmin()` is checked again inside every admin
  page and server action (server actions are callable directly). The session cookie is
  `issuedAt.HMAC`, expires after 7 days, and rotating the password logs everyone out.
- **SSRF guard** for URLs typed into the admin: http(s) on ports 80/443 only, every redirect hop
  re-checked, private / loopback / link-local / metadata IPs refused
  ([`public-url.ts`](../src/lib/scraper/public-url.ts)).
- **Supply chain:** every GitHub Action pinned to a commit SHA, read-only `GITHUB_TOKEN`, Dependabot with
  a 7-day cooldown, dependency review on PRs, CodeQL, and a `main` ruleset (PR + green CI, no force push).
- Report vulnerabilities privately: [SECURITY.md](../SECURITY.md).

## Running unattended

The site is designed to keep publishing for months with nobody touching it:

- `keepalive.yml` re-enables every workflow daily, read from the API (GitHub disables schedules after 60
  days without repository activity, and drops scheduled runs of public repositories under load), and
  fails red when one stays disabled.
- `watchdog.yml` (`scripts/health-check.ts`, rules in `src/lib/health.ts`) opens a GitHub issue (which
  emails the owner) when any part of the system stops: news, AI summaries (or most of them falling back
  to the extract), digests (or most of them rule-based), push delivery, social posting per configured
  platform, the 60-day social tokens, MPs, data snapshots, opendata.mn, the source re-check, the live
  site, its feed and certificates, a disabled or always-red workflow, or the database passing 400 MB. It
  also reminds the owner of dated facts in the code (Prime Minister list, population, tax rates, the end
  of the 2024–2028 programme). Each collector runs on its own, so one failing query never hides the
  rest; the issue closes itself when things recover.
- `backup.yml` (weekly) streams `npm run db:backup` (NDJSON through the app's own connection) through
  `gzip` and `age` with the owner's public key and uploads only the encrypted file as a 90-day artifact;
  `npm run db:restore` upserts it back (`docs/BACKUP.md`). The watchdog reports a missing key or a
  backup older than 10 days.
- Stale data is visible instead of looking current: synced numbers print when they were fetched and turn
  "хуучирсан" past their limit (`DataAge`: Mongolbank 3 days, Шилэн данс 14, audit.mn 30, opendata.mn 3);
  the digest strip adds the date to an edition older than 18 h; after 6 h without a new story the header's
  pulsing dot turns grey and the ticker says how long it has been quiet instead of promising the next
  check; extractive fallbacks are labelled "Эх текстийн эхний өгүүлбэр · AI ажиллаагүй" in the story
  list; `/sources` marks a source not tried for a week. All of it uses cached clocks, so pages stay static.
- Retention pruning, the AI fallback and source back-off keep the free tiers within limits without
  manual work. A scrape or AI failure never skips the digest (with its rule-based fallback) or the
  pushes: every later pipeline step runs unless the run was cancelled or the migration failed.

## Testing

```bash
npm run check   # tsc --noEmit + eslint + node:test unit tests (no network, no database)
npm run build   # production build with no DATABASE_URL
npm run demo    # next dev on PGlite seeded from tests/fixtures (no database server, no keys)
```

**Demo mode.** `DATABASE_URL=pglite:<dir>` makes `getDb()` open PGlite (Postgres compiled to
WebAssembly) in the same process, loaded from node_modules at run time and listed in
`serverExternalPackages`, so production bundles never contain it. `src/db/demo-migrate.ts` applies
`drizzle/*.sql` (skipping `CREATE EXTENSION vector`, which nothing uses) and `src/db/demo-seed.ts`
loads the saved real responses through the scrapers' own parsers, shifting dates so the newest
item is "now". The seed refuses any non-`pglite:` URL. Every page shows a "Демо горим" strip.

Unit tests cover the parsers (each against a saved real response), the AI router fallbacks and budget
guard (fake providers), clustering, ranking, search query building, tax maths and the declaration flags.
Before UI work merges we run Playwright screenshots on phone and desktop widths and Lighthouse mobile
against a demo build (branch previews are off to save Vercel's free deployment quota), then check
production after the merge.

## Design decisions and trade-offs

| Decision | Why |
|---|---|
| GitHub Actions instead of a server | Free on a public repo, logs are public, nothing to patch. Cost: jobs run from US runners far from `.gov.mn`. |
| Stem Jaccard instead of embeddings | No extra API calls or vector storage; good enough for same-day press releases. pgvector is installed for later. |
| Free LLMs first, paid capped | The site must not stop when a free tier changes, and must not run up a bill. |
| Store cleaned text, not HTML | The 500 MB database limit; the SHA-256 still proves what was scraped. |
| Static pages + CDN | Fast on cheap phones and slow connections; the database is only read when a page revalidates. |
| Rules, not AI, for civic-data markers | Declarations and budgets are about real people and institutions; markers must be reproducible. |
| `node-postgres`, not postgres.js | postgres.js pipelining hung behind the Supabase transaction pooler. |
