/**
 * Tag analyzed articles that have no AI topic yet (analyzed before Tier 1 returned one).
 *
 *   npm run ai:topics                 # up to 500 articles, 25 per AI call
 *   npm run ai:topics -- --limit 50
 *
 * Aimag/district sites and opendata.gov.mn keep their domain topic and are skipped, as are no-AI
 * fallback summaries and rows the model already skipped TOPIC_MAX_ATTEMPTS times (they keep the
 * domain topic), so the same rows are not sent again every run.
 * Uses the free tier-1 chain behind the same budget guard; every call is logged.
 */
import "dotenv/config";
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { articles, sources } from "@/db/schema";
import { AIUnavailableError, callAIWithFallback } from "@/lib/ai/router";
import { TOPIC_BATCH, TOPIC_MAX_ATTEMPTS, TopicBatchSchema, topicMessages } from "@/lib/ai/topic-classify";
import { dbBudgetGuard, dbUsageLogger } from "@/lib/ai/usage-log";

const { values } = parseArgs({ options: { limit: { type: "string", default: "500" } } });

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const rows = await db
    .select({ id: articles.id, title: articles.title, summary: articles.tldrSummary })
    .from(articles)
    .innerJoin(sources, eq(articles.sourceId, sources.id))
    .where(
      and(
        isNull(articles.topic),
        isNotNull(articles.tldrSummary),
        eq(articles.summaryFallback, false),
        eq(articles.isPublished, true),
        sql`coalesce((${articles.scrapeMeta}->>'topic_attempts')::int, 0) < ${TOPIC_MAX_ATTEMPTS}`,
        ne(sources.category, "local"),
        ne(sources.domain, "opendata.gov.mn"),
      ),
    )
    .orderBy(asc(articles.id))
    .limit(Math.max(1, Number(values.limit) || 500));
  console.log(`🏷️  ${rows.length} articles without a topic`);
  const log = dbUsageLogger(db);
  const budget = dbBudgetGuard(db);
  let tagged = 0;
  for (let i = 0; i < rows.length; i += TOPIC_BATCH) {
    const batch = rows.slice(i, i + TOPIC_BATCH).map((r) => ({ id: r.id, title: r.title, summary: r.summary ?? "" }));
    try {
      const res = await callAIWithFallback({ tier: "tier1", purpose: "topic", messages: topicMessages(batch), schema: TopicBatchSchema, log, budget, maxTokens: 1200, temperature: 0 });
      const ids = new Set(batch.map((b) => b.id));
      for (const [id, topic] of res.data.topics) {
        if (!ids.has(id)) continue; // ignore ids the model invented
        await db.update(articles).set({ topic }).where(eq(articles.id, id));
        ids.delete(id);
        tagged++;
      }
      // The model answered but gave these rows no usable topic: count it, so they stop coming back.
      if (ids.size) {
        await db
          .update(articles)
          .set({
            scrapeMeta: sql`jsonb_set(coalesce(${articles.scrapeMeta}, '{}'::jsonb), '{topic_attempts}', to_jsonb(coalesce((${articles.scrapeMeta}->>'topic_attempts')::int, 0) + 1))`,
          })
          .where(inArray(articles.id, [...ids]));
      }
      console.log(`  ✓ ${batch.length} via ${res.provider}/${res.model} → ${res.data.topics.size} tagged`);
    } catch (err) {
      console.error(`  ✗ batch ${i / TOPIC_BATCH + 1}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      if (err instanceof AIUnavailableError) break;
    }
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(and(isNotNull(articles.topic), inArray(articles.id, rows.length ? rows.map((r) => r.id) : [0])));
  console.log(`🏷️  Done: ${tagged} tagged now (${n} of ${rows.length} have a topic).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
