import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";

import type { DB } from "@/db";
import { retryTransientRead } from "@/db/retry";
import { articles, clusters, sources } from "@/db/schema";
import { extractMntAmounts } from "@/lib/scraper/adapters/tender";

import { capImportance } from "./ceremony";
import { cleanImpact, cleanReaderTitle, groundingSource } from "./reader-view";
import { CLUSTER_WINDOW_DAYS, findBestMatch, type ClusterDoc } from "./clustering";
import { clusterMessages, tier1Messages, tier2Messages, type ArticleForAI, type ClusterMember } from "./prompts";
import type { BudgetGuard } from "./limits";
import { callAIWithFallback, type Purpose, type UsageLogger } from "./router";
import { ClusterSchema, Tier1Schema, Tier2Schema, type Tier1Result, type Tier2Result } from "./schemas";
import { errorLine } from "@/lib/log-safe";

export interface AnalysisOutcome {
  tier1: Tier1Result;
  tier1Provider: string;
  tier2: Tier2Result | null;
  tier2Provider: string | null;
  /** Why the deep analysis is missing although it was wanted (limit reached, provider down). */
  tier2Error: string | null;
  costUsd: number;
}

export interface AnalyzeOptions {
  articleId?: number | null;
  log?: UsageLogger;
  budget?: BudgetGuard;
  forceDeep?: boolean;
  purpose?: Purpose;
}

/** Sources whose items are structured metadata: summarized by rules, zero AI tokens. */
const RULE_BASED_DOMAINS = new Set(["opendata.gov.mn"]);

function field(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

/** Token-free analysis for opendata.gov.mn dataset entries (they carry no political text). */
export function ruleBasedAnalysis(input: ArticleForAI): Tier1Result | null {
  if (!RULE_BASED_DOMAINS.has(input.sourceDomain)) return null;
  const org = field(input.text, "Эзэмшигч байгууллага");
  const freq = field(input.text, "Шинэчлэгдэх давтамж");
  const formats = field(input.text, "Файлын формат");
  const updated = field(input.text, "Сүүлд шинэчлэгдсэн");
  const lines = [
    `${org ? `${org} ` : ""}"${input.title}" нэртэй нээлттэй өгөгдлийн багц нийтэллээ.`,
    freq ? `Өгөгдөл ${freq.toLowerCase()} шинэчлэгдэнэ.` : null,
    formats ? `Файлыг ${formats} форматаар татаж авах боломжтой.` : null,
  ].filter((l): l is string => Boolean(l));
  return {
    tldr_summary: lines.join("\n"),
    facts: [org && `Эзэмшигч: ${org}`, freq && `Давтамж: ${freq}`, formats && `Формат: ${formats}`, updated && `Шинэчлэгдсэн: ${updated}`].filter(
      (f): f is string => Boolean(f),
    ),
    spin_detected: "Албан ёсны өгөгдлийн бүртгэл тул пи-ар агуулаагүй.",
    neutrality_score: 100,
    entities: { people: [], orgs: org ? [org] : [], amounts_mnt: [] },
    risk_score: 0,
    risk_reason: "Өгөгдлийн багцын мэдээлэл.",
    importance_score: 15,
    topic: null,
    reader_title: null,
    impact: null,
    risk_flag: false,
  };
}

/** Regex-found MNT amounts are merged in so money tags never depend on the model alone. */
function withRegexAmounts(t1: Tier1Result, text: string): Tier1Result {
  const amounts = [...new Set([...t1.entities.amounts_mnt, ...extractMntAmounts(text, 8)])].slice(0, 15);
  return { ...t1, entities: { ...t1.entities, amounts_mnt: amounts } };
}

/** Formats Grok's analysis + citizen questions as the stored markdown. */
export function formatDeepAnalysis(t2: Tier2Result): string {
  const questions = t2.citizen_questions.length
    ? `\n\n## Иргэд асуух ёстой асуултууд\n${t2.citizen_questions.map((q) => `- ${q}`).join("\n")}`
    : "";
  return `${t2.analysis_markdown.trim()}${questions}`;
}

/**
 * Tier 1 always; Tier 2 when the risk flag is set (or forced from the admin panel).
 * Pure function of its input + AI calls: no DB writes, so the admin "filter" reuses it.
 */
export async function analyzeArticle(input: ArticleForAI, opts: AnalyzeOptions = {}): Promise<AnalysisOutcome> {
  const rules = opts.forceDeep ? null : ruleBasedAnalysis(input);
  if (rules) return { tier1: rules, tier1Provider: "rule-based", tier2: null, tier2Provider: null, tier2Error: null, costUsd: 0 };

  const t1 = await callAIWithFallback({
    tier: "tier1",
    purpose: opts.purpose === "admin" ? "admin_tier1" : (opts.purpose ?? "tier1"),
    articleId: opts.articleId,
    messages: tier1Messages(input),
    schema: Tier1Schema,
    log: opts.log,
    budget: opts.budget,
    // The plain headline and "Танд хамаатай юу?" add ~300 tokens of Mongolian to the answer.
    maxTokens: 1_900,
  });
  const withAmounts = withRegexAmounts(t1.data, input.text);
  // A meeting, visit or opening is never "national news" by itself, whatever the model said.
  // The plain headline and "Танд хамаатай юу?" keep only numbers the source printed.
  const digits = groundingSource(input.title, input.text, input.publishedAt);
  const tier1 = {
    ...withAmounts,
    importance_score: capImportance(input.title, withAmounts.importance_score),
    reader_title: cleanReaderTitle(withAmounts.reader_title, input.title, digits),
    impact: cleanImpact(withAmounts.impact, digits),
  };
  let costUsd = t1.costUsd;

  let tier2: Tier2Result | null = null;
  let tier2Provider: string | null = null;
  let tier2Error: string | null = null;
  if (tier1.risk_flag || opts.forceDeep) {
    try {
      const t2 = await callAIWithFallback({
        tier: "tier2",
        purpose: opts.purpose === "admin" ? "admin_tier2" : "tier2",
        articleId: opts.articleId,
        messages: tier2Messages(input, tier1),
        schema: Tier2Schema,
        log: opts.log,
        budget: opts.budget,
        maxTokens: 1_800,
        temperature: 0.3,
      });
      tier2 = t2.data;
      tier2Provider = `${t2.provider}/${t2.model}`;
      costUsd += t2.costUsd;
    } catch (err) {
      // Keep the (already paid) Tier-1 result; the deep analysis can be retried from /admin.
      tier2Error = err instanceof Error ? err.message : String(err);
    }
  }
  return { tier1, tier1Provider: `${t1.provider}/${t1.model}`, tier2, tier2Provider, tier2Error, costUsd };
}

/** Loads an article with its source as AI input. */
export async function loadArticleForAI(db: DB, id: number) {
  const [row] = await db
    .select({ article: articles, sourceName: sources.name, sourceDomain: sources.domain })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(eq(articles.id, id))
    .limit(1);
  if (!row) return null;
  const input: ArticleForAI = {
    title: row.article.title,
    sourceName: row.sourceName,
    sourceDomain: row.sourceDomain,
    url: row.article.originalUrl,
    publishedAt: row.article.publishedAt,
    text: row.article.cleanContent,
    meta: row.article.scrapeMeta,
  };
  return { row: row.article, input };
}

/**
 * Runs the full pipeline for one stored article and writes the results. `cluster: false` leaves
 * clustering to the caller (ai:process clusters a whole run at once with assignClusters).
 */
export async function processArticle(db: DB, id: number, opts: Omit<AnalyzeOptions, "articleId"> & { cluster?: boolean } = {}) {
  const loaded = await loadArticleForAI(db, id);
  if (!loaded) throw new Error(`Article ${id} not found`);
  const outcome = await analyzeArticle(loaded.input, { ...opts, articleId: id });
  const { tier1, tier2 } = outcome;
  await db
    .update(articles)
    .set({
      tldrSummary: tier1.tldr_summary,
      factVsSpin: { facts: tier1.facts, spin_detected: tier1.spin_detected, neutrality_score: tier1.neutrality_score },
      extractedEntities: tier1.entities,
      riskScore: tier1.risk_score,
      riskFlag: tier1.risk_flag,
      importanceScore: tier1.importance_score,
      topic: tier1.topic,
      readerTitle: tier1.reader_title,
      readerImpact: tier1.impact,
      // Keep an earlier deep analysis if this run did not produce a new one.
      ...(tier2 ? { grokDeepAnalysis: formatDeepAnalysis(tier2) } : {}),
      aiError: null,
      // A real analysis replaces the extractive "AI ажиллаагүй" summary and its label.
      summaryFallback: false,
    })
    .where(eq(articles.id, id));
  const clusterId = opts.cluster === false ? null : await assignCluster(db, id, opts.log, opts.budget);
  return { ...outcome, clusterId };
}

/**
 * Jaccard clustering against the published, analysed articles of the last 7 days (other sources
 * only). The pool is loaded once for a whole batch: the old per-article pool was capped at the
 * 500 newest rows, about two days, so the same story posted days apart never met (3 clusters in
 * 7 days). Joins the best match's cluster (or creates one) and re-synthesizes each touched cluster
 * once.
 */
export async function assignClusters(db: DB, ids: number[], log?: UsageLogger, budget?: BudgetGuard): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();
  if (ids.length === 0) return result;
  const since = new Date(Date.now() - CLUSTER_WINDOW_DAYS * 86_400_000);
  // One retry when the connection, not the query, failed (Nov 4 2026: "Query read timeout" after the AI calls).
  const pool = await retryTransientRead(() =>
    db
      .select({
        id: articles.id,
        title: articles.title,
        tldr: articles.tldrSummary,
        facts: articles.factVsSpin,
        entities: articles.extractedEntities,
        clusterId: articles.clusterId,
        sourceId: articles.sourceId,
        publishedAt: articles.publishedAt,
      })
      .from(articles)
      // Publication time, not the time we found the row: a backfill or a slow source found an old
      // notice "this week" and joined it to a new one (cluster 6, Oct 2026).
      .where(and(isNotNull(articles.tldrSummary), eq(articles.isPublished, true), gte(articles.publishedAt, since)))
      .orderBy(desc(articles.publishedAt)),
  );

  const toDoc = (r: (typeof pool)[number]): ClusterDoc => ({
    id: r.id,
    title: r.title,
    summary: `${r.tldr ?? ""} ${(r.facts?.facts ?? []).join(" ")}`,
    entities: r.entities,
    clusterId: r.clusterId,
    at: r.publishedAt,
  });
  const byId = new Map(pool.map((r) => [r.id, r]));
  const touched = new Set<number>();
  for (const id of ids) {
    const me = byId.get(id);
    if (!me) {
      result.set(id, null);
      continue;
    }
    // The same source re-posting is not corroboration; cluster across sources only.
    const match = findBestMatch(toDoc(me), pool.filter((r) => r.sourceId !== me.sourceId).map(toDoc));
    if (!match) {
      result.set(id, me.clusterId);
      continue;
    }
    let clusterId = match.doc.clusterId ?? me.clusterId;
    if (!clusterId) {
      const [created] = await db.insert(clusters).values({ title: me.title, articleCount: 0 }).returning({ id: clusters.id });
      clusterId = created.id;
    }
    await db.update(articles).set({ clusterId }).where(inArray(articles.id, [id, match.doc.id]));
    if (me.clusterId && me.clusterId !== clusterId) touched.add(me.clusterId);
    touched.add(clusterId);
    // Later articles in this batch see the new membership.
    me.clusterId = clusterId;
    const other = byId.get(match.doc.id);
    if (other) other.clusterId = clusterId;
    result.set(id, clusterId);
  }
  for (const clusterId of touched) await refreshCluster(db, clusterId, log, budget);
  return result;
}

/** One article (admin re-analysis): the same as a batch of one. */
export async function assignCluster(db: DB, id: number, log?: UsageLogger, budget?: BudgetGuard): Promise<number | null> {
  return (await assignClusters(db, [id], log, budget)).get(id) ?? null;
}

/**
 * Re-synthesizing on every join would cost O(n) model calls per cluster. Only refresh
 * at growth milestones: 2, 3, 5, 8, then every 5 articles.
 */
export function shouldResynthesize(previousCount: number, newCount: number): boolean {
  if (newCount < 2 || newCount === previousCount) return false;
  return [2, 3, 5, 8].includes(newCount) || (newCount > 8 && newCount % 5 === 0);
}

/** Recounts a cluster and, at growth milestones, asks the model for a neutral cross-source synthesis. */
export async function refreshCluster(db: DB, clusterId: number, log?: UsageLogger, budget?: BudgetGuard): Promise<void> {
  const members = await db
    .select({ title: articles.title, tldr: articles.tldrSummary, facts: articles.factVsSpin, risk: articles.riskScore, sourceName: sources.name })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(and(eq(articles.clusterId, clusterId), ne(articles.isPublished, false)))
    .orderBy(desc(articles.riskScore));
  if (members.length === 0) {
    // Its articles moved to another cluster (or were unpublished).
    await db.delete(clusters).where(eq(clusters.id, clusterId));
    return;
  }
  const maxRisk = Math.max(...members.map((m) => m.risk));
  const [current] = await db.select({ count: clusters.articleCount }).from(clusters).where(eq(clusters.id, clusterId));

  let title: string | undefined;
  let synthesis: string | undefined;
  if (shouldResynthesize(current?.count ?? 0, members.length)) {
    try {
      const res = await callAIWithFallback({
        // Synthesis is a summary of summaries: the cheap/free bulk tier is enough.
        tier: "tier1",
        purpose: "cluster",
        messages: clusterMessages(
          members.map<ClusterMember>((m) => ({ title: m.title, sourceName: m.sourceName, tldr: m.tldr ?? "", facts: m.facts?.facts ?? [] })),
        ),
        schema: ClusterSchema,
        log,
        budget,
        maxTokens: 600,
      });
      title = res.data.title;
      synthesis = res.data.synthesis;
    } catch (err) {
      // Keep the previous synthesis; counts still update. Said in the log: a synthesis that never
      // refreshed used to leave no trace at all.
      console.warn(`[ai] cluster ${clusterId} synthesis kept (AI call failed): ${errorLine(err, 200)}`);
    }
  }
  await db
    .update(clusters)
    .set({
      articleCount: members.length,
      maxRiskScore: maxRisk,
      updatedAt: sql`now()`,
      ...(title ? { title } : {}),
      ...(synthesis ? { synthesisSummary: synthesis } : {}),
    })
    .where(eq(clusters.id, clusterId));
}
