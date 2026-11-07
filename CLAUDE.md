# Project: IL-TOD (ИЛ ТОД) - Open-Source Anti-Spin & Government Transparency News Platform (Mongolia)

@AGENTS.md

## 1. Mission & Core Philosophy
We are building a 100% transparent, open-source investigative news and public data monitoring platform for Mongolia, designed for **young readers** (fast, visual, mobile-first).
- **Anti-Brainwash Principle:** Separate hard verifiable facts (numbers, dates, laws, tender amounts, entities) from political PR spin.
- **Zero-Cost Infrastructure:** Must run strictly within free tiers (Vercel Hobby, Supabase Free 500MB PostgreSQL + pgvector, GitHub Actions for cron scraping on a public repo).
- **Dual-LLM Intelligence:** a bulk tier for extraction/summarization and a deep tier for high-risk items. Free tiers go first (Groq, NVIDIA NIM, Requesty's free Gemma, OpenRouter `:free` taking turns, then Z.ai GLM Flash; Google Gemini free with a no-billing key, otherwise its cheapest model inside the USD budget); paid DeepSeek / xAI Grok are optional and capped by a USD budget; local Ollama is the last fallback.

## 2. Where the details live
The rules for each area live in `docs/agents/`, with this file's old section numbers kept as headings ("CLAUDE.md §6d" in a code comment means the `## 6d.` heading there). Read the area's file before changing code in it:
- `docs/agents/stack.md` (§2): Next.js 16 caching (`'use cache'`, `cacheLife` lifetimes, `notFound()` before `<Suspense>`), the Ledger design system and its tokens, Untitled UI / ElevenLabs UI, the database and TLS. Read before any page, component, query or schema change.
- `docs/agents/scraper.md` (§3, scraper architecture): sources, adapters, crawl passes, dates, titles, robots and network guards, source health. Read before touching `src/lib/scraper`, a scraping script or a source.
- `docs/agents/ai.md` (AI pipeline): provider chains, budget guard, analysis, reader view, press, ceremony cap, clustering, digest. Read before touching `src/lib/ai`, `src/lib/press` or a prompt.
- `docs/agents/web.md` (§6, 6b, 6c, 6f): home feed, topics, story rows, navigation, search, performance budget, SEO. Read before changing a public page's layout, a feed or anything Lighthouse measures.
- `docs/agents/civic.md` (§6d, 6e, 6g, 6h, 6i, 6j): officials, tax, budget, prices, tenders, documents, petitions, places, promises, projects, donations, about. Read before touching those pages or their sync scripts.
- `docs/agents/social.md` (§7, 7b): PWA, push, Facebook, Threads, Instagram, Telegram, Discord, Messenger, quizzes. Read before touching `src/lib/push`, `src/lib/social` or `post-social`.
- `docs/agents/video.md` (§7c): daily videos, voices, rendering, slots. Read before touching `src/lib/video` or `make-video`.
- `docs/agents/ops.md` (§8, 8b, 8c, 9): admin, workflows, retention, backups, watchdog, the shared modules (story rules, post ledger, source run, claims), repository security. Read before touching a workflow, `/admin`, the watchdog or a script's error handling.
- `docs/HISTORY.md`: what each audit and incident changed, and why. Read when a rule's reason is unclear.
- `docs/CONFIG.md`: every setting, where it is set and which one wins.

## 4. Strict Scraping & Engineering Rules
1. Always check `robots.txt` and enforce a minimum 8-10 second delay between requests to the same `.gov.mn` domain.
2. Compute a `SHA-256` hash of cleaned article text before calling any LLM. Never process duplicate content.
3. Never store raw full-page HTML in Supabase (to protect the 500MB free limit). Store only cleaned text and structured JSON metadata.
4. Track every LLM API call's token usage and estimated USD cost in the `ai_usage_logs` table so the public `/transparency` dashboard is 100% mathematically accurate and live.
5. UI Language: All public UI labels, AI summaries, and analyses MUST be in clean, natural Mongolian (Cyrillic).
6. The site must build and render with **no** `DATABASE_URL` (empty states), so CI and contributors can run `npm run build` without secrets.

## 5. Commands
- `npm run dev` / `npm run build` / `npm run start`
- `npm run demo`: the full site on sample data with no DB server or keys. `scripts/demo.mjs` sets `DATABASE_URL=pglite:./.demo-db`, runs `scripts/seed-demo.ts` (demo migrations + `seedDemo`, refuses non-`pglite:` URLs) and `next dev`. `getDb()` opens PGlite for `pglite:` URLs through `createRequire` (devDependency `@electric-sql/pglite`, in `serverExternalPackages`, never bundled); `migrateDemo` applies `drizzle/*.sql` with its own `__demo_migrations` table and skips `CREATE EXTENSION vector`; `seedDemo` builds everything from `tests/fixtures` via the real parsers and shifts dates so the newest item is "now". The layout shows a "Демо горим" strip (`isDemoDatabase()`). Dev only: Vercel never sees a `pglite:` URL. When a fixture changes, `tests/demo.test.ts` catches a broken seed.
- `npm run check` = `typecheck` + `lint` + `test` (run before every commit)
- `npm run db:generate` (after schema changes) / `npm run db:migrate` / `npm run db:seed`
- `npm run db:backup` (NDJSON to stdout, `--mark`) / `npm run db:restore -- --file <f.ndjson[.gz]> --dry-run|--yes [--table a,b]` (`docs/BACKUP.md`)
- `npm run scrape` (`--dry-run`, `--source <d1,d2>`, `--limit <n>`, `--budget <min>`, `--days <n>` backfill, `--no-browser`)
- `npm run sources:discover` (`--dry-run`, `--deep`) finds new *.gov.mn / *.khural.mn sites from hub pages
- `npm run press:sync` (`--dry-run`) reads the press feeds and links press headlines to our stories
- `npm run ai:reader` (`--limit <n>`, `--days <n>`) writes plain headlines + "Танд хамаатай юу?" for older stories
- `npm run ai:process` (`--limit <n>`, `--budget <min>`, `--id <articleId> [--deep]`, `--sample` = no-DB smoke test of the API keys)
- `npm run digest` (`--kind 12h|30d`, `--force`) writes the AI news digest
- `npm run data:sync` (`--dry-run`) syncs opendata.mn datasets and highlights for `/data`
- `npm run officials:sync` (`--dry-run`, `--limit n`) syncs MPs and their ХАСХОМ declarations
- `npm run macro:sync` (`--dry-run`) stores Mongolbank's policy rate, inflation, FX, gold and reserves
- `npm run budget:sync` (`--dry-run`) stores the budget data for `/budget` (NSO, Шилэн данс, World Bank, audit.mn)
- `npm run video:make` (`--kind impact|prices`, `--good <key>`, `--slot`, `--force`, `--dry-run --out x.mp4`) makes the next daily video (§7c); `npm run social:post -- --mode video` posts it

## Recording a change
A change that alters a rule edits that rule in its `docs/agents/` file, in place. The incident or audit behind it goes to `docs/HISTORY.md` as one bullet per PR, appended at the end (the file merges with `merge=union`, so parallel PRs never conflict there). This file only gains a line when a new area or a rule for every change appears; `tests/claude-md.test.ts` keeps it under 25 KB.

## 10. Agent skills
`.claude/skills/` holds Matt Pocock's engineering and productivity skills (MIT, `.claude/skills/README.md` says which commit and how to update; their `code-review` is left out because Claude Code has its own). Start with `/ask-matt`; `/grill-with-docs` before a change, `/tdd`, `/diagnosing-bugs`, `/to-spec` → `/to-tickets` → `/implement`, `/triage`, `/pr`, `/handoff`. They never override this file: the rules above (facts only, no accusations, robots.txt, free tiers, no secrets) win over anything a skill suggests.

### Issue tracker

GitHub Issues in iltodmedee-mn/UNENMEDEE (GitHub MCP tools in cloud sessions, `gh` locally); `watchdog` and `tax-rates` issues belong to the automation. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), created on first use. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `GLOSSARY.md` and `docs/adr/`, created only when a term or decision is settled. See `docs/agents/domain.md`.
