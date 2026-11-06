import { and, desc, eq, gte, inArray, isNotNull, lte, notInArray, or, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { articles, digests, sources, type Digest } from "@/db/schema";
import { formatPeriodMn } from "@/lib/format";
import type { DigestItem, SourceCategory } from "@/lib/types";

import type { BudgetGuard } from "./limits";
import { isCeremonial } from "./ceremony";
import { digestMessages, type DigestCandidate } from "./prompts";
import { AIUnavailableError, callAIWithFallback, chainFor, type UsageLogger } from "./router";
import { DigestSchema } from "./schemas";
import { DIGEST_WINDOWS } from "@/lib/edition";
import { oneLine } from "@/lib/log-safe";

/**
 * AI news digest: picks the most nationally important stories of a period and writes a
 * short, fact-based review. Runs every 12 hours ("12h" editions, 08:00 and 20:00 in
 * Ulaanbaatar) and on demand for catch-up reviews ("30d").
 *
 * Token budget: articles are pre-ranked without AI (importance, risk, cross-source
 * coverage, source weight), so the model only reads the top candidates' 3-line summaries.
 */

export type DigestKind = "12h" | "30d";

/** Sources whose posts are national decisions by definition. */
const NATIONAL_DOMAINS = new Set(["parliament.mn", "zasag.mn", "president.mn", "legalinfo.mn", "gov.mn", "audit.mn", "iaac.mn", "mof.gov.mn"]);
/** Structured dataset entries, not news. */
const EXCLUDED_DOMAINS = ["opendata.gov.mn"];
const CATEGORY_WEIGHT: Record<SourceCategory, number> = { portal: 6, ministry: 6, agency: 4, local: 0 };

export interface RankInput {
  importanceScore: number | null;
  riskScore: number;
  otherSources: number;
  sourceDomain: string;
  sourceCategory: SourceCategory;
  /** The headline: a ceremonial one (a meeting, a visit, an opening) ranks below real decisions. */
  title?: string;
}

/** Rank penalty for a ceremonial headline, on top of its capped importance. */
const CEREMONY_PENALTY = 30;

/** Deterministic pre-ranking, so the model only sees the strongest candidates. */
export function rankScore(a: RankInput): number {
  // Articles analyzed before importance existed get a neutral 40.
  const importance = a.importanceScore ?? 40;
  return (
    importance +
    a.riskScore * 0.3 +
    Math.min(a.otherSources, 4) * 8 +
    CATEGORY_WEIGHT[a.sourceCategory] +
    (NATIONAL_DOMAINS.has(a.sourceDomain) ? 10 : 0) -
    (a.title && isCeremonial(a.title) ? CEREMONY_PENALTY : 0)
  );
}

export interface DigestPlan {
  kind: DigestKind;
  periodStart: Date;
  periodEnd: Date;
  /** Stories in the final digest. */
  pick: number;
  /** Candidates shown to the model. */
  candidates: number;
}

/** A 12h edition needs at least this many stories; with fewer it widens to 24 h, then skips. */
export const MIN_DIGEST_STORIES = 5;
// Defined in the client-safe edition module so page copy can quote the real hours.
export { DIGEST_WINDOWS } from "@/lib/edition";

/**
 * Whether a scheduled run should write a 12h edition now: inside a morning or evening window
 * (GitHub starts scheduled jobs hours late, so the pipeline asks every run instead of trusting
 * one cron time) and at least 8 h after the previous edition, so a window gets one edition.
 */
export function isDigestDue(now: Date, lastCreatedAt: Date | null): boolean {
  const ubHour = (now.getUTCHours() + 8) % 24;
  const inWindow = DIGEST_WINDOWS.some(([from, to]) => ubHour >= from && ubHour < to);
  return inWindow && (!lastCreatedAt || now.getTime() - lastCreatedAt.getTime() >= 8 * 3_600_000);
}

export function planDigest(kind: DigestKind, now: Date, lastEnd: Date | null): DigestPlan {
  if (kind === "30d") return { kind, periodStart: new Date(now.getTime() - 30 * 86_400_000), periodEnd: now, pick: 20, candidates: 70 };
  const hours = 12;
  const nominal = new Date(now.getTime() - hours * 3_600_000);
  // Continue from the previous edition when a run was missed, but never look back more than 36 h.
  const floor = new Date(now.getTime() - 3 * hours * 3_600_000);
  const start = lastEnd && lastEnd < nominal ? (lastEnd > floor ? lastEnd : floor) : nominal;
  return { kind, periodStart: start, periodEnd: now, pick: 10, candidates: 40 };
}

interface CandidateRow extends DigestCandidate {
  slug: string;
  /** Tier 1's plain headline (shown by rule-based editions); `title` stays the source's own. */
  plainTitle: string | null;
  clusterId: number | null;
  score: number;
}

/** Clusters of the articles featured in earlier editions: the same story under a new article id is still a repeat. */
async function clustersOf(db: DB, articleIds: Set<number>): Promise<Set<number>> {
  if (articleIds.size === 0) return new Set();
  const rows = await db.select({ clusterId: articles.clusterId }).from(articles).where(inArray(articles.id, [...articleIds]));
  return new Set(rows.map((r) => r.clusterId).filter((c): c is number => c !== null));
}

/**
 * The edition's final story list. The editor model may answer with fewer valid ids than the
 * minimum (invented ids are dropped): then the rule-based ranking, which has enough candidates,
 * decides instead, so no 1-story edition is published or pushed.
 */
export function finalItems(aiItems: DigestItem[], candidates: CandidateRow[], plan: DigestPlan): { items: DigestItem[]; fromAI: boolean } {
  const min = plan.kind === "12h" ? MIN_DIGEST_STORIES : 1;
  if (aiItems.length >= min) return { items: leadWithNews(aiItems), fromAI: true };
  return { items: leadWithNews(ruleBasedDigest(candidates, plan).items), fromAI: false };
}

/**
 * An edition never opens with a meeting or a ceremony (Oct 2026: an MP's meeting led edition 15).
 * Ceremonial stories keep their order but move behind the others; with nothing else, nothing moves.
 */
export function leadWithNews<T extends { title: string; headline?: string }>(items: T[]): T[] {
  const ceremonial = (i: T) => isCeremonial(i.title);
  const news = items.filter((i) => !ceremonial(i));
  return news.length ? [...news, ...items.filter(ceremonial)] : items;
}

async function loadCandidates(db: DB, plan: DigestPlan, exclude: Set<number>, excludeClusters: Set<number> = new Set()): Promise<CandidateRow[]> {
  const { periodStart: start, periodEnd: end } = plan;
  // Published in the period, or scraped in the period when the site posted it up to 3 days earlier.
  const lateStart = new Date(start.getTime() - 3 * 86_400_000);
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      plainTitle: articles.readerTitle,
      tldr: articles.tldrSummary,
      entities: articles.extractedEntities,
      riskScore: articles.riskScore,
      importanceScore: articles.importanceScore,
      publishedAt: articles.publishedAt,
      clusterId: articles.clusterId,
      // Distinct sources that publish this cluster now (as CLUSTER_SOURCES in queries.ts): the
      // stored article_count counted a ministry's second post as another source and went stale.
      clusterSize: sql<number | null>`(select count(distinct m.source_id)::int from ${articles} m where m.cluster_id = "articles"."cluster_id" and m.is_published)`,
      sourceName: sources.name,
      sourceDomain: sources.domain,
      sourceCategory: sources.category,
    })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        eq(articles.isPublished, true),
        isNotNull(articles.tldrSummary),
        notInArray(sources.domain, EXCLUDED_DOMAINS),
        or(
          and(gte(articles.publishedAt, start), lte(articles.publishedAt, end)),
          and(gte(articles.createdAt, start), lte(articles.createdAt, end), gte(articles.publishedAt, lateStart)),
        ),
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(3_000);

  const scored = rows
    .filter((r) => !exclude.has(r.id) && (r.clusterId === null || !excludeClusters.has(r.clusterId)))
    .map<CandidateRow>((r) => {
      const otherSources = Math.max(0, (r.clusterSize ?? 1) - 1);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        plainTitle: r.plainTitle,
        sourceName: r.sourceName,
        publishedAt: r.publishedAt,
        tldr: r.tldr ?? "",
        amounts: r.entities?.amounts_mnt ?? [],
        riskScore: r.riskScore,
        otherSources,
        clusterId: r.clusterId,
        score: rankScore({
          importanceScore: r.importanceScore,
          riskScore: r.riskScore,
          otherSources,
          sourceDomain: r.sourceDomain,
          sourceCategory: r.sourceCategory,
          title: r.title,
        }),
      };
    })
    .sort((a, b) => b.score - a.score);

  // One article per story: the same event from several sources is one candidate.
  const seenClusters = new Set<number>();
  const unique: CandidateRow[] = [];
  for (const c of scored) {
    if (c.clusterId !== null) {
      if (seenClusters.has(c.clusterId)) continue;
      seenClusters.add(c.clusterId);
    }
    unique.push(c);
    if (unique.length >= plan.candidates) break;
  }
  return unique;
}

function toItem(c: CandidateRow, headline: string, why: string): DigestItem {
  return {
    articleId: c.id,
    slug: c.slug,
    title: c.title,
    sourceName: c.sourceName,
    publishedAt: c.publishedAt?.toISOString() ?? null,
    riskScore: c.riskScore,
    headline: headline || c.title,
    whyItMatters: why,
    otherSources: c.otherSources,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Without any AI provider the digest still appears: top stories by rank, their own summaries. */
export function ruleBasedDigest(candidates: CandidateRow[], plan: DigestPlan) {
  const items = leadWithNews(candidates.slice(0, plan.pick)).map((c) => toItem(c, c.plainTitle ?? c.title, c.tldr.split("\n")[0] ?? ""));
  return {
    title: plan.kind === "30d" ? "Сүүлийн 30 хоногийн онцлох мэдээ" : `Онцлох мэдээ: ${clip(items[0]?.headline ?? "", 90)}`,
    intro: `Энэ хугацаанд ${candidates.length} мэдээнээс ач холбогдол, эрсдэл, олон эх сурвалжид гарсан байдлаар нь эрэмбэлсэн ${items.length} мэдээ.`,
    items,
  };
}

export interface DigestRunResult {
  status: "created" | "skipped" | "empty";
  reason?: string;
  digest?: Digest;
}

export interface DigestOptions {
  kind: DigestKind;
  now?: Date;
  /** Create a new edition even if a recent one exists. */
  force?: boolean;
  log?: UsageLogger;
  budget?: BudgetGuard;
}

export async function createDigest(db: DB, opts: DigestOptions): Promise<DigestRunResult> {
  const now = opts.now ?? new Date();
  const previous = await db
    .select({ periodEnd: digests.periodEnd, items: digests.items, createdAt: digests.createdAt })
    .from(digests)
    .where(eq(digests.kind, opts.kind))
    .orderBy(desc(digests.periodEnd))
    .limit(3);
  const last = previous[0];
  const minGapMs = opts.kind === "12h" ? 6 * 3_600_000 : 20 * 3_600_000;
  if (!opts.force && last && now.getTime() - last.createdAt.getTime() < minGapMs) {
    return { status: "skipped", reason: `an edition was created at ${last.createdAt.toISOString()}` };
  }

  const plan = planDigest(opts.kind, now, last?.periodEnd ?? null);
  // Do not repeat stories featured in the last few editions of the same kind.
  const exclude = new Set(previous.flatMap((d) => d.items.map((i) => i.articleId)));
  const excludeClusters = await clustersOf(db, exclude);
  let candidates = await loadCandidates(db, plan, exclude, excludeClusters);
  // A quiet night: look back 24 h before giving up, and never publish (or push) a 1-story edition.
  if (plan.kind === "12h" && candidates.length < MIN_DIGEST_STORIES) {
    const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
    if (plan.periodStart > dayAgo) {
      plan.periodStart = dayAgo;
      candidates = await loadCandidates(db, plan, exclude, excludeClusters);
    }
  }
  if (candidates.length === 0) return { status: "empty", reason: "no analyzed articles in this period" };
  if (plan.kind === "12h" && candidates.length < MIN_DIGEST_STORIES) {
    return { status: "empty", reason: `only ${candidates.length} new stories in the last 24 h (need ${MIN_DIGEST_STORIES})` };
  }

  let title: string;
  let intro: string;
  let items: DigestItem[];
  let generatedBy = "rule-based";
  let costUsd = 0;
  if (candidates.length <= 2) {
    ({ title, intro, items } = ruleBasedDigest(candidates, plan));
  } else {
    try {
      const res = await callAIWithFallback({
        // Once per 12 h and it shapes the front page: use the deep tier's models, but keep
        // paid Grok for high-risk articles (it is capped per day).
        tier: "tier2",
        chain: chainFor("tier2").filter((p) => p !== "grok"),
        purpose: "digest",
        messages: digestMessages(candidates, formatPeriodMn(plan.periodStart, plan.periodEnd), plan.pick),
        schema: DigestSchema,
        log: opts.log,
        budget: opts.budget,
        maxTokens: plan.kind === "30d" ? 4_000 : 2_500,
        temperature: 0.3,
      });
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const seen = new Set<number>();
      items = [];
      for (const it of res.data.items) {
        const c = byId.get(it.id);
        if (!c || seen.has(c.id)) continue; // ignore ids the model invented or repeated
        seen.add(c.id);
        items.push(toItem(c, it.headline, it.why));
        if (items.length >= plan.pick) break;
      }
      if (items.length === 0) throw new Error("the model chose no valid article ids");
      const final = finalItems(items, candidates, plan);
      costUsd = res.costUsd;
      if (final.fromAI) {
        title = res.data.title;
        intro = res.data.intro;
        generatedBy = `${res.provider}/${res.model}`;
      } else {
        console.warn(`[digest] the model kept only ${items.length} valid stories (need ${MIN_DIGEST_STORIES}): using the rule-based ranking`);
        ({ title, intro } = ruleBasedDigest(candidates, plan));
        items = final.items;
      }
    } catch (err) {
      const why = err instanceof AIUnavailableError ? err.attempts.join(" | ") || err.message : err instanceof Error ? err.message : String(err);
      console.warn(`[digest] AI unavailable, using the rule-based ranking: ${oneLine(why, 300)}`);
      ({ title, intro, items } = ruleBasedDigest(candidates, plan));
    }
  }

  // The check at the top ran before a minute of model calls: the pipeline's due step and
  // news-digest.yml (separate concurrency groups) could both pass it and publish two editions.
  // Checked again under a per-kind lock, in the transaction that inserts.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`digest:${opts.kind}`}))`);
    const [latest] = await tx.select({ createdAt: digests.createdAt }).from(digests).where(eq(digests.kind, opts.kind)).orderBy(desc(digests.createdAt)).limit(1);
    if (!opts.force && latest && latest.createdAt.getTime() > (last?.createdAt.getTime() ?? 0) && now.getTime() - latest.createdAt.getTime() < minGapMs) {
      return { status: "skipped" as const, reason: `another run created an edition at ${latest.createdAt.toISOString()}` };
    }
    const [digest] = await tx
      .insert(digests)
      .values({
        kind: plan.kind,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        title,
        intro,
        items,
        candidateCount: candidates.length,
        generatedBy,
        costUsd: costUsd.toFixed(6),
      })
      .returning();
    return { status: "created" as const, digest };
  });
}
