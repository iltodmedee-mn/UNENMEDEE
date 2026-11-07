/**
 * Makes one short video (src/lib/video) and stores it for posting (`npm run social:post -- --mode
 * video`). Twice a day in .github/workflows/video.yml.
 *
 *   npm run video:make                           # a price video, else a "30 СЕК МЭДЭЭ" news video
 *   npm run video:make -- --kind impact          # only a "30 СЕК МЭДЭЭ" news video (a fresh important story)
 *   npm run video:make -- --good beef            # this good's price video (skipped if made, unless --force)
 *   npm run video:make -- --dry-run --out x.mp4  # render to a file, store nothing (the voice is still billed)
 *   npm run video:make -- --slot                 # only inside a slot with no video yet (VIDEO_SLOTS: 12–16 and
 *                                                # 19–23, the news video first); the pipeline and video.yml use it
 *
 * Price videos ("15 жилийн өмнө"): one per good and NSO data month, so they run out until NSO
 * publishes the next month. News videos: one per story, the most important fresh story with an AI
 * summary (last 36 h, else 4 days). The "ХҮН БҮРТ ХУВААВАЛ" money video is off (Nov 6 2026).
 * Needs DATABASE_URL, a voice key, ffmpeg and Playwright's Chromium. The voice is ElevenLabs
 * (ELEVENLABS_API_KEY, the owner's monthly plan) while the month's credits allow it at an even pace
 * (`creditPlan`), else Gemini (GEMINI_API_KEY). The voice call passes the AI budget guard and is logged
 * with its cost; a take whose pace is implausible, a spec with a number not from the snapshot or a
 * file too big for /reel stops the run with nothing stored.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

import { closeDb, type DB, getDb, hasDatabase } from "@/db";
import { appSettings, articles, indicatorSnapshots, sources, videos } from "@/db/schema";
import { consoleUsageLogger, dbBudgetGuard, dbUsageLogger, syncLedgerAiCost } from "@/lib/ai/usage-log";
import { GOODS, type PricesSnapshot } from "@/lib/budget/prices";
import { tldrSentences } from "@/lib/format";
import { impactHtml } from "@/lib/video/impact-html";
import { IMPACT_MIN_IMPORTANCE, impactNarration, type ImpactSpec, impactVideoSpec, verifyImpactSpec } from "@/lib/video/impact-video";
import { narration, priceVideoSpec, type Scene, type VideoSpec, verifySpec } from "@/lib/video/price-video";
import type { VideoMeta } from "@/lib/video/posts";
import { analyseAudio, MAX_BYTES, renderVideo } from "@/lib/video/render";
import { sceneHtml } from "@/lib/video/scene-html";
import { claimValue, dueSlot, kindsFor, mayClaim, slotStart, type VideoSlot } from "@/lib/video/schedule";
import { buildTimeline, plausibleTake, sentenceStarts, speechBounds, type Timeline } from "@/lib/video/timing";
import { CreditsRefused, describeSecret, elevenLabsFromEnv, speakElevenLabs } from "@/lib/video/elevenlabs";
import { speak } from "@/lib/video/tts";
import { errorDetail } from "@/lib/log-safe";

/** The MP4 is kept this long for the platforms to fetch it from /reel, then cleared. */
export const VIDEO_KEEP_DAYS = 3;

const { values } = parseArgs({
  options: {
    good: { type: "string" },
    kind: { type: "string", default: "auto" },
    prefer: { type: "string", default: "prices" },
    slot: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    out: { type: "string", default: "video.mp4" },
  },
});
const dry = values["dry-run"];

const SLOT_CLAIM_KEY = "video_slot_claim";

/** The claim this run holds (null: none, or released), so a run that stores nothing gives the slot back. */
let myClaim: string | null = null;
let madeVideo = false;

/**
 * Claims `slot` as a lease (`<slot start>|<claimed at>`): one run wins, and a claim whose run
 * failed before storing a video expires after CLAIM_LEASE_MS instead of blocking the slot for good.
 * The write is a compare-and-swap on the value read, so two runs cannot both win.
 */
async function claimSlot(db: DB, slot: VideoSlot): Promise<boolean> {
  const now = new Date();
  const start = slotStart(now, slot);
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SLOT_CLAIM_KEY));
  const stored = typeof row?.value === "string" ? row.value : null;
  if (!mayClaim(stored, start, now)) return false;
  const value = claimValue(start, now);
  const won = await db
    .insert(appSettings)
    .values({ key: SLOT_CLAIM_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
      setWhere: stored === null ? sql`false` : sql`${appSettings.value} = ${stored}`,
    })
    .returning({ key: appSettings.key });
  if (won.length > 0) myClaim = value;
  return won.length > 0;
}

/** A run that ends without a stored video (error, nothing to make) gives its claim back, if it is still ours. */
async function releaseClaim(): Promise<void> {
  if (!myClaim || madeVideo) return;
  const value = myClaim;
  myClaim = null;
  try {
    await getDb().delete(appSettings).where(and(eq(appSettings.key, SLOT_CLAIM_KEY), eq(appSettings.value, value)));
  } catch (err) {
    console.log(`::warning::could not release the slot claim: ${errorDetail(err)}`);
  }
}

async function main() {
  if (!hasDatabase()) throw new Error("DATABASE_URL is not set");
  // A dry run may go through a proxy that adds the key itself (local previews).
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  const { key: elevenKey, voice: elevenVoice } = elevenLabsFromEnv(process.env);
  if (!apiKey && !elevenKey && !dry) throw new Error("Neither ELEVENLABS_API_KEY nor GEMINI_API_KEY is set: the narration needs one");
  const db = getDb();

  if (!dry) {
    const cleared = await db
      .update(videos)
      .set({ mp4: null })
      .where(and(isNotNull(videos.mp4), lt(videos.createdAt, new Date(Date.now() - VIDEO_KEEP_DAYS * 86_400_000))))
      .returning({ id: videos.id });
    if (cleared.length) console.log(`🧹 cleared ${cleared.length} posted video file(s) older than ${VIDEO_KEEP_DAYS} days`);
  }

  let prefer = values.prefer as VideoSlot["prefer"];
  if (values.slot) {
    const [last] = await db.select({ at: videos.createdAt }).from(videos).orderBy(desc(videos.createdAt)).limit(1);
    const slot = dueSlot(new Date(), last?.at ?? null);
    if (!slot) return console.log("🎬 --slot: not inside a video slot, or this slot already has its video.");
    // video.yml and the pipeline both ask in the same minutes; the video row exists only after
    // voicing and rendering, so both passed the check and voiced the same story twice. The slot
    // is claimed in app_settings first: one run wins, the other stops here.
    if (!dry && !(await claimSlot(db, slot))) return console.log("🎬 --slot: another run claimed this slot a moment ago.");
    prefer = slot.prefer;
  }

  const [row] = await db.select({ data: indicatorSnapshots.data }).from(indicatorSnapshots).where(eq(indicatorSnapshots.key, "prices_nso"));
  const prices = row ? (row.data as PricesSnapshot) : null;

  const explicit = values.good ? "prices" : ["prices", "impact"].includes(values.kind) ? (values.kind as VideoSlot["prefer"]) : null;
  const kinds = explicit ? [explicit] : kindsFor(prefer);
  let job: Job | null = null;
  for (const kind of kinds) {
    job = kind === "impact" ? await impactJob(db) : await priceJob(db, prices);
    if (job) break;
  }
  if (!job) return console.log("🎬 Nothing new to make: no fresh story to tell, and every good has a video for this NSO month.");

  if (job.problems.length) throw new Error(`Spec refused:\n- ${job.problems.join("\n- ")}`);
  const text = job.text;
  console.log(`🎬 ${job.key}\n   ${text}`);

  const guard = dbBudgetGuard(db);
  const log = dry ? consoleUsageLogger : dbUsageLogger(db);
  let voiced: { wav: Buffer; starts: number[] | null } | null = null;
  if (!elevenKey) {
    // Only the shape of each secret, never its content.
    const shapes = `ELEVENLABS_API_KEY: ${describeSecret(process.env.ELEVENLABS_API_KEY)}; secret ELEVENLABS_VOICE_ID: ${describeSecret(process.env.ELEVENLABS_SECRET_VOICE_ID)}`;
    console.log(`::notice::No ElevenLabs key (a key starts with "sk_") reached this step (${shapes}): Gemini voices this video.`);
  }
  if (elevenKey) {
    try {
      const out = await speakElevenLabs({ says: job.says, apiKey: elevenKey, guard, log, voice: elevenVoice });
      console.log(`   🎙 ElevenLabs (${out.plan.reason})`);
      voiced = out;
    } catch (err) {
      // Credits paced out or the API failed: Gemini voices this one, the video still goes out.
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${err instanceof CreditsRefused ? "   ℹ️" : "::warning::"} ${msg}; Gemini voices this video`);
    }
  }
  if (!voiced) {
    if (!apiKey && !dry) throw new Error("GEMINI_API_KEY is not set and ElevenLabs did not voice the video");
    voiced = { wav: await speak({ text, apiKey, guard, log }), starts: null };
  }
  if (!dry) await syncLedgerAiCost(db);
  const wav = voiced.wav;
  const { duration, silences } = await analyseAudio(wav);
  const { lead, tail } = speechBounds(silences, duration);
  if (!plausibleTake(text, tail - lead)) throw new Error(`Narration refused: ${(tail - lead).toFixed(1)} s of speech for ${text.length} characters`);
  // ElevenLabs times every character, so its sentence starts are exact; Gemini's come from the pauses.
  const starts = voiced.starts ?? sentenceStarts(job.says, silences, duration);
  const timeline = buildTimeline(job.scenes, starts, { duration, tail }, job.units);
  const total = timeline.total;
  console.log(`   voice ${duration.toFixed(1)} s · scenes at ${timeline.starts.join(", ")} · ${total} s`);

  const html = job.html(timeline, { fontsDir: path.resolve("src/assets/fonts"), logo: path.resolve("public/icons/icon-192.png") });
  // VIDEO_MUSIC=off drops the soft synthesized beat (the voice and the sound effects stay).
  const music = process.env.VIDEO_MUSIC?.trim().toLowerCase() !== "off";
  let mp4 = await renderVideo({ html, wav, timeline, music });
  if (mp4.length > MAX_BYTES) mp4 = await renderVideo({ html, wav, timeline, music, crf: 27 });
  // A long, busy take (≈ 30 s of moving colour) can still be over: one more step down.
  if (mp4.length > MAX_BYTES) mp4 = await renderVideo({ html, wav, timeline, music, crf: 31 });
  if (mp4.length > MAX_BYTES) throw new Error(`Video too big for /reel: ${mp4.length} bytes`);
  console.log(`   ✓ ${(mp4.length / 1e6).toFixed(2)} MB, ${total} s`);

  if (dry) {
    await writeFile(values.out, mp4);
    return console.log(`   written to ${values.out} (dry run: nothing stored)`);
  }
  const meta = job.meta;
  const key = job.key;
  const [stored] = await db
    .insert(videos)
    .values({ key, meta, mp4, bytes: mp4.length, durationS: total })
    .onConflictDoUpdate({ target: videos.key, set: { meta, mp4, bytes: mp4.length, durationS: total, createdAt: new Date() } })
    .returning({ id: videos.id });
  madeVideo = true;
  console.log(`   stored as video #${stored.id}`);
}

/** One video to make, whatever its kind. */
interface Job {
  key: string;
  text: string;
  says: string[];
  scenes: Scene[];
  units: number | null;
  problems: string[];
  html(tl: Timeline, assets: { fontsDir: string; logo: string }): string;
  meta: VideoMeta;
}

function priceJobFrom(spec: VideoSpec): Job {
  return {
    key: spec.key,
    text: narration(spec),
    says: spec.sentences.map((s) => s.say),
    scenes: spec.sentences.map((s) => s.scene),
    units: spec.units?.count ?? null,
    problems: verifySpec(spec),
    html: (tl, assets) => sceneHtml(spec, tl, assets),
    meta: { kind: "prices", goodKey: spec.goodKey, title: spec.title, then: spec.then, now: spec.now, yearPct: spec.yearPct, link: spec.link },
  };
}

function impactJobFrom(spec: ImpactSpec, sourceName: string): Job {
  return {
    key: spec.key,
    text: impactNarration(spec),
    says: spec.sentences.map((s) => s.say),
    scenes: spec.sentences.map((s) => s.scene),
    units: null,
    problems: verifyImpactSpec(spec),
    html: (tl, assets) => impactHtml(spec, tl, assets),
    meta: { kind: "impact", articleId: spec.articleId, headline: spec.headline, what: spec.what, ...spec.impact, sourceName, topic: spec.topic, link: spec.link },
  };
}

/**
 * The most important fresh decision with a grounded "Танд хамаатай юу?" (who / what changes / when /
 * what to do), not yet a video of any kind, from a news source (opendata listings excluded).
 */
async function impactJob(db: DB): Promise<Job | null> {
  const title = sql<string>`coalesce(${articles.readerTitle}, ${articles.title})`;
  for (const hours of [36, 4 * 24]) {
    const rows = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        title,
        impact: articles.readerImpact,
        tldr: articles.tldrSummary,
        topic: articles.topic,
        sourceName: sources.name,
        day: sql<string>`to_char(${articles.publishedAt} at time zone 'Asia/Ulaanbaatar', 'YYYY-MM-DD')`,
      })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .where(
        and(
          eq(articles.isPublished, true),
          isNotNull(articles.tldrSummary),
          eq(articles.summaryFallback, false),
          gte(articles.publishedAt, new Date(Date.now() - hours * 3_600_000)),
          gte(articles.importanceScore, IMPACT_MIN_IMPORTANCE),
          sql`${sources.domain} <> 'opendata.gov.mn'`,
          sql`coalesce((${articles.scrapeMeta}->>'date_unknown')::boolean, false) = false`,
          sql`not exists (select 1 from ${videos} where ${videos.key} in ('impact:' || ${articles.id}, 'money:' || ${articles.id}))`,
        ),
      )
      .orderBy(desc(articles.importanceScore), desc(articles.publishedAt))
      .limit(40);
    for (const r of rows) {
      const spec = impactVideoSpec({ id: r.id, slug: r.slug, title: r.title, impact: r.impact, summary: tldrSentences(r.tldr ?? "", 3), sourceName: r.sourceName, day: r.day, topic: r.topic });
      if (spec && !verifyImpactSpec(spec).length) return impactJobFrom(spec, r.sourceName);
    }
  }
  console.log("🎬 No fresh important story with a summary to tell: no news video.");
  return null;
}

/** The next good without a video for the latest NSO month (or --good). */
async function priceJob(db: DB, snap: PricesSnapshot | null): Promise<Job | null> {
  if (!snap) {
    console.log("🎬 No prices_nso snapshot yet (npm run budget:sync): no price video.");
    return null;
  }
  const made = new Set((await db.select({ key: videos.key }).from(videos).where(sql`${videos.key} like ${`prices:%:${snap.latestMonth}`}`)).map((r) => r.key));
  for (const key of values.good ? [values.good] : GOODS.map((g) => g.key)) {
    const spec = priceVideoSpec(snap, key);
    if (!spec) {
      if (values.good) throw new Error(`No video possible for "${key}" (unknown good or not enough data)`);
      continue;
    }
    if (made.has(spec.key) && !values.force && !dry) {
      if (values.good) {
        console.log(`🎬 ${spec.key} was already made (--force to make it again).`);
        return null;
      }
      continue;
    }
    return priceJobFrom(spec);
  }
  console.log(`🎬 Every good already has a video for ${snap.latestMonth}: waiting for NSO's next month.`);
  return null;
}

/** The most important fresh story whose headline names a ₮ amount the story also holds. */

main()
  .catch((err) => {
    console.error(`::error::make-video: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await releaseClaim();
    await closeDb();
  });
