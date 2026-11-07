import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { and, asc, eq, type SQL } from "drizzle-orm";

import type { DB } from "@/db";
import { articles, clusters, sources } from "@/db/schema";
import { selectPushCandidates } from "@/lib/push/news-selection";
import {
  aiSummarized,
  dated,
  displayTitle,
  displayTitleOf,
  effectiveTopic,
  effectiveTopicKey,
  feedVisible,
  hasMntAmount,
  indexable,
  isAiSummarized,
  isFeedVisible,
  isIndexable,
  isPostable,
  isPublished,
  isUndated,
  isVisible,
  namesMnt,
  postable,
  published,
  type StoryFacts,
  undated,
  visible,
} from "@/lib/story-rules";
import { AI_TOPIC_KEYS } from "@/lib/topics";

// In-memory database: this file runs in its own process, so the env change stays here.
process.env.DATABASE_URL = "pglite:memory";

type Seed = Partial<StoryFacts> & { name: string };

const AMOUNT = { people: [], orgs: [], amounts_mnt: ["2.5 тэрбум төгрөг"] };
const NO_AMOUNT = { people: [], orgs: [], amounts_mnt: [] };

/** Rows chosen so each rule has a row on both sides of each edge. */
const SEEDS: Seed[] = [
  { name: "plain", tldrSummary: "x", importanceScore: 50, extractedEntities: NO_AMOUNT },
  { name: "unpublished", isPublished: false, tldrSummary: "x", importanceScore: 80 },
  { name: "no-summary", tldrSummary: null, importanceScore: 80 },
  { name: "fallback", tldrSummary: "first sentence", summaryFallback: true, importanceScore: 30 },
  { name: "undated", tldrSummary: "x", scrapeMeta: { date_unknown: true }, importanceScore: 90 },
  { name: "dated-false", tldrSummary: "x", scrapeMeta: { date_unknown: false }, importanceScore: 90 },
  { name: "reader-title", tldrSummary: "x", readerTitle: "Энгийн гарчиг", importanceScore: 60 },
  { name: "low-thin", tldrSummary: "x", importanceScore: 10, extractedEntities: NO_AMOUNT },
  { name: "low-clustered", tldrSummary: "x", importanceScore: 10, clusterId: -1 },
  { name: "low-amount", tldrSummary: "x", importanceScore: 10, extractedEntities: AMOUNT },
  { name: "low-legalinfo", tldrSummary: "x", importanceScore: 10, sourceDomain: "legalinfo.mn" },
  { name: "unscored", tldrSummary: "x", importanceScore: null },
  { name: "edge-25", tldrSummary: "x", importanceScore: 25 },
  { name: "edge-24", tldrSummary: "x", importanceScore: 24, extractedEntities: NO_AMOUNT },
  { name: "district", tldrSummary: "x", importanceScore: 70, sourceDomain: "khanuul.mn", sourceCategory: "local", topic: AI_TOPIC_KEYS[0] },
  { name: "opendata", tldrSummary: "x", importanceScore: 70, sourceDomain: "opendata.gov.mn", topic: AI_TOPIC_KEYS[0] },
  { name: "gov-ai-topic", tldrSummary: "x", importanceScore: 70, sourceDomain: "gov.mn", topic: AI_TOPIC_KEYS[2] },
  { name: "gov-no-topic", tldrSummary: "x", importanceScore: 70, sourceDomain: "gov.mn", topic: null },
  { name: "gov-bad-topic", tldrSummary: "x", importanceScore: 70, sourceDomain: "gov.mn", topic: "nonsense" },
  { name: "ministry-domain", tldrSummary: "x", importanceScore: 70, sourceDomain: "mof.gov.mn", topic: null },
  { name: "unknown-domain", tldrSummary: "x", importanceScore: 70, sourceDomain: "unknown.example", topic: null },
  { name: "amount", tldrSummary: "x", importanceScore: 70, extractedEntities: AMOUNT },
];

const CATEGORY: Record<string, "ministry" | "local"> = {
  "gov.mn": "ministry",
  "khanuul.mn": "local",
  "opendata.gov.mn": "ministry",
  "legalinfo.mn": "ministry",
  "mof.gov.mn": "ministry",
  "unknown.example": "ministry",
};

let db: DB;
const facts = new Map<number, StoryFacts & { name: string }>();

async function ids(where: SQL | undefined): Promise<number[]> {
  const rows = await db.select({ id: articles.id }).from(articles).innerJoin(sources, eq(articles.sourceId, sources.id)).where(where).orderBy(asc(articles.id));
  return rows.map((r) => r.id);
}

/** Every seeded row passes through the TypeScript twin; the SQL rule must select exactly those. */
function twin(pred: (s: StoryFacts) => boolean): number[] {
  return [...facts.entries()].filter(([, s]) => pred(s)).map(([id]) => id);
}

describe("story rules: SQL and TypeScript twins agree (PGlite)", () => {
  before(async () => {
    const { getDb } = await import("@/db");
    const { migrateDemo } = await import("@/db/demo-migrate");
    db = getDb();
    await migrateDemo(db);
    const [cluster] = await db.insert(clusters).values({ title: "c" }).returning({ id: clusters.id });
    const sourceIds = new Map<string, number>();
    for (const [domain, category] of Object.entries(CATEGORY)) {
      const [r] = await db.insert(sources).values({ name: domain, domain, urlPattern: `https://${domain}`, category }).returning({ id: sources.id });
      sourceIds.set(domain, r.id);
    }
    let n = 0;
    for (const s of SEEDS) {
      n += 1;
      const domain = s.sourceDomain ?? "gov.mn";
      const f: StoryFacts & { name: string } = {
        name: s.name,
        isPublished: s.isPublished ?? true,
        tldrSummary: s.tldrSummary ?? null,
        summaryFallback: s.summaryFallback ?? false,
        scrapeMeta: s.scrapeMeta ?? null,
        readerTitle: s.readerTitle ?? null,
        title: `Гарчиг ${s.name}`,
        extractedEntities: s.extractedEntities ?? null,
        importanceScore: s.importanceScore ?? null,
        clusterId: s.clusterId === undefined || s.clusterId === null ? null : cluster.id,
        topic: s.topic ?? null,
        sourceDomain: domain,
        sourceCategory: s.sourceCategory ?? CATEGORY[domain],
      };
      const [r] = await db
        .insert(articles)
        .values({
          sourceId: sourceIds.get(domain)!,
          title: f.title,
          slug: `s-${n}`,
          originalUrl: `https://example.test/${n}`,
          contentHash: String(n).padStart(64, "0"),
          cleanContent: "text",
          scrapeMeta: f.scrapeMeta,
          tldrSummary: f.tldrSummary,
          readerTitle: f.readerTitle,
          extractedEntities: f.extractedEntities,
          importanceScore: f.importanceScore,
          clusterId: f.clusterId,
          topic: f.topic,
          isPublished: f.isPublished,
          summaryFallback: f.summaryFallback,
          publishedAt: new Date(),
        })
        .returning({ id: articles.id });
      facts.set(r.id, f);
    }
  });

  after(async () => {
    const { closeDb } = await import("@/db");
    await closeDb();
  });

  const parity: [string, SQL, (s: StoryFacts) => boolean][] = [
    ["published", published, isPublished],
    ["visible", visible, isVisible],
    ["aiSummarized", aiSummarized, isAiSummarized],
    ["dated", dated, (s) => !isUndated(s)],
    ["undated", and(eq(undated, true))!, isUndated],
    ["postable", postable, isPostable],
    ["namesMnt", namesMnt, hasMntAmount],
    ["feedVisible", feedVisible, isFeedVisible],
    ["indexable", indexable, isIndexable],
  ];

  for (const [name, rule, pred] of parity) {
    it(`${name}: SQL selects the rows the TypeScript twin accepts`, async () => {
      const got = await ids(rule);
      assert.deepEqual(got, twin(pred));
      // A rule that selects everything or nothing would prove nothing.
      assert.ok(got.length > 0 && got.length < facts.size, `${name} should split the seeded rows`);
    });
  }

  it("displayTitle: reader_title wins over the source title", async () => {
    const rows = await db.select({ id: articles.id, t: displayTitle }).from(articles);
    for (const r of rows) assert.equal(r.t, displayTitleOf(facts.get(r.id)!));
    assert.ok(rows.some((r) => r.t === "Энгийн гарчиг"));
  });

  it("effectiveTopic: SQL equals topicFor for every seeded story", async () => {
    const rows = await db.select({ id: articles.id, t: effectiveTopic }).from(articles).innerJoin(sources, eq(articles.sourceId, sources.id));
    for (const r of rows) {
      const f = facts.get(r.id)!;
      assert.equal(r.t, effectiveTopicKey(f), f.name);
    }
    const byName = new Map(rows.map((r) => [facts.get(r.id)!.name, r.t]));
    assert.equal(byName.get("district"), "local", "a district site stays local whatever the AI says");
    assert.equal(byName.get("opendata"), "data");
    assert.equal(byName.get("gov-ai-topic"), AI_TOPIC_KEYS[2], "the AI topic wins over gov.mn");
    assert.equal(byName.get("gov-bad-topic"), byName.get("gov-no-topic"), "an unknown AI topic falls back to the domain");
    assert.equal(byName.get("unknown-domain"), "other");
  });

  it("direct expectations on the edges", async () => {
    const named = async (rule: SQL) => (await ids(rule)).map((id) => facts.get(id)!.name);
    const pc = await named(postable);
    assert.ok(pc.includes("plain") && pc.includes("dated-false"));
    for (const bad of ["undated", "fallback", "no-summary", "unpublished"]) assert.ok(!pc.includes(bad), bad);
    const ix = await named(indexable);
    for (const good of ["unscored", "edge-25", "low-legalinfo", "low-amount", "low-clustered"]) assert.ok(ix.includes(good), good);
    for (const bad of ["low-thin", "edge-24"]) assert.ok(!ix.includes(bad), bad);
  });

  it("push selection never announces an undated page, a fallback summary or a withdrawn story as new", async () => {
    const rows = await selectPushCandidates(db, 70);
    const names = rows.map((r) => [...facts.values()].find((f) => f.title === `Гарчиг ${SEEDS[Number(r.slug.slice(2)) - 1].name}`)!.name);
    assert.ok(names.includes("dated-false"), "a dated important story is offered");
    assert.ok(names.includes("amount"));
    for (const bad of ["undated", "unpublished", "no-summary", "fallback"]) assert.ok(!names.includes(bad), bad);
  });
});
