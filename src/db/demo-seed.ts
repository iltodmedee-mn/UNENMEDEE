import { readFileSync } from "node:fs";
import { join } from "node:path";

import { count, eq } from "drizzle-orm";

import { createDigest } from "@/lib/ai/digest";
import { extractiveSummary } from "@/lib/ai/fallback";
import { OPINIONS, parseAuditList, type AuditSnapshot } from "@/lib/budget/audit";
import { budgetHistory, revenueByType, spendingBreakdown, type BudgetNsoSnapshot } from "@/lib/budget/nso";
import type { JsonStat2 } from "@/lib/budget/jsonstat";
import { GOODS, parsePrices, parseWages } from "@/lib/budget/prices";
import { parseCategories, parseTopPayees, type ShilendansSnapshot } from "@/lib/budget/shilendans";
import { parseWorldBank } from "@/lib/budget/worldbank";
import { buildSnapshot } from "@/lib/mongolbank/client";
import { parseMemberDetail, parseRoster } from "@/lib/officials/parliament";
import { parseDeclarations, xacxomPageUrl } from "@/lib/officials/xacxom";
import { legalinfoDetailText, parseLegalinfoList } from "@/lib/scraper/adapters/legalinfo";
import { opendataItemToScraped, parseOpendataResponse } from "@/lib/scraper/adapters/opendata";
import { parliamentArticleToScraped, parseParliamentPage } from "@/lib/scraper/adapters/parliament";
import { parsePoliceArticle, parsePoliceList } from "@/lib/scraper/adapters/police";
import { parseZasagFeed } from "@/lib/scraper/adapters/zasag";
import { extractArticle } from "@/lib/scraper/extractor";
import { unshoutTitle } from "@/lib/scraper/titles";
import { documentLinks, parseAuditRegister } from "@/lib/documents/watch";
import { storeCompanyMatches } from "@/lib/procurement/company-matches";
import { parseTenders } from "@/lib/procurement/tenders";
import { parseSoeReport } from "@/lib/soe/shilendans";
import { SOURCE_SEEDS } from "@/lib/sources";
import { contentHash, slugify } from "@/lib/text";

import type { DB } from "./index";
import { appSettings, articles, assetDeclarations, documents, indicatorSnapshots, politicians, sources, tenders } from "./schema";
import { parsePetitions, type PetitionsSnapshot } from "@/lib/participation/petitions";

/**
 * Sample data for `npm run demo`, built from the real responses saved in tests/fixtures through the
 * same parsers the scrapers use: real government news, MPs, declarations, Mongolbank and budget
 * figures. Nothing is invented. Summaries are the articles' first sentences (labelled
 * "AI ажиллаагүй" on the page), so no AI key is needed. Dates are shifted so the newest item is "now".
 */

interface DemoItem {
  domain: string;
  url: string;
  title: string;
  text: string;
  publishedAt: Date | null;
}

export interface DemoSeedResult {
  articles: number;
  politicians: number;
  snapshots: number;
  digest: string;
}

export async function seedDemo(db: DB, fixtures = "tests/fixtures", now = new Date()): Promise<DemoSeedResult | null> {
  const [{ n }] = await db.select({ n: count() }).from(articles);
  if (n > 0) return null;
  const read = (name: string) => readFileSync(join(fixtures, name), "utf8");
  const json = (name: string) => JSON.parse(read(name)) as unknown;

  // Sources
  await db.insert(sources).values(SOURCE_SEEDS.map((s) => ({ ...s, isActive: true, lastScrapedAt: now }))).onConflictDoNothing();
  const ids = new Map((await db.select({ id: sources.id, domain: sources.domain }).from(sources)).map((s) => [s.domain, s.id]));

  // Articles, through the scrapers' own parsers
  const items: DemoItem[] = [];
  const add = (domain: string, i: { url: string; title: string; text: string; publishedAt: Date | null } | null) => {
    // Same title clean-up as the scraper's db-sink.
    if (i && i.text.length >= 200) items.push({ domain, ...i, title: unshoutTitle(i.title) });
  };
  for (const a of parseParliamentPage(json("parliament-articles.json"))) add("parliament.mn", parliamentArticleToScraped(a));
  for (const i of parseZasagFeed(read("zasag-feed.xml"))) add("zasag.mn", i);
  const [police] = parsePoliceList(read("police-list.html"));
  if (police) {
    const a = parsePoliceArticle(read("police-article.html"));
    add("police.gov.mn", { url: police.url, title: a.title || police.title, text: a.text, publishedAt: a.publishedAt ?? police.day });
  }
  const [act] = parseLegalinfoList((json("legalinfo-list.json") as { Html: string }).Html);
  if (act) add("legalinfo.mn", { url: act.url, title: act.title, text: legalinfoDetailText(read("legalinfo-detail.html")), publishedAt: act.addedAt });
  for (const [file, domain, url] of [
    ["mimr-article.html", "mimr.gov.mn", "https://www.mimr.gov.mn/demo-article"],
    ["mlsp-article.html", "mlsp.gov.mn", "https://mlsp.gov.mn/content/detail/4204"],
  ] as const) {
    const a = extractArticle(read(file), url);
    if (a) add(domain, { url, title: a.title, text: a.text, publishedAt: a.publishedAt });
  }
  for (const d of parseOpendataResponse(json("opendata-search.json")).slice(0, 5)) add("opendata.gov.mn", opendataItemToScraped(d));

  const newest = Math.max(...items.map((i) => i.publishedAt?.getTime() ?? 0));
  const shift = newest > 0 ? now.getTime() - newest : 0;
  let order = 0;
  const rows = items
    .filter((i) => ids.has(i.domain))
    .map((i) => ({
      sourceId: ids.get(i.domain)!,
      title: i.title.slice(0, 500),
      slug: slugify(i.title, i.url),
      originalUrl: i.url,
      contentHash: contentHash(i.text),
      cleanContent: i.text.slice(0, 15_000),
      tldrSummary: extractiveSummary(i.text),
      summaryFallback: true,
      importanceScore: 40,
      // Undated items are spaced an hour apart below the dated ones.
      publishedAt: new Date(i.publishedAt ? i.publishedAt.getTime() + shift : now.getTime() - ++order * 3_600_000),
      createdAt: now,
    }));
  await db.insert(articles).values(rows).onConflictDoNothing();

  // MPs and asset declarations
  const roster = parseRoster(json("parliament-members.json"));
  const detail = json("parliament-member-detail.json") as { id: number };
  const declarations = parseDeclarations(json("xacxom-declarations.json"));
  for (const base of roster) {
    const m = base.parliamentMemberId === detail.id ? parseMemberDetail(detail, base) : { ...base, constituency: null, votes: null, electionSystem: null, xacxomId: null };
    const [p] = await db
      .insert(politicians)
      .values({ ...m, isActive: true, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: politicians.id });
    if (p && m.xacxomId) {
      for (const r of declarations) await db.insert(assetDeclarations).values({ politicianId: p.id, sourceUrl: xacxomPageUrl(m.xacxomId), fetchedAt: now, ...r }).onConflictDoNothing();
    }
  }

  // Mongolbank, budget, Шилэн данс, World Bank, audit.mn, state-owned companies
  const mb = json("mongolbank.json") as Record<string, { data: unknown[] }>;
  const stat = (name: string) => json(`budget/${name}`) as JsonStat2;
  const asOf = now.toISOString().slice(0, 10);
  const audit = Object.fromEntries(OPINIONS.map((o) => [o, parseAuditList(read("budget/audit-list.html"), o)]));
  const snapshots: { key: string; data: unknown }[] = [
    {
      key: "mongolbank",
      data: buildSnapshot({
        policy: mb["policy-interest-rate"].data as never,
        inflation: mb.inflation.data as never,
        fx: mb["currency-rates"].data as never,
        gold: mb["gold-and-silver-price"].data as never,
        reserves: mb["international-reserves"].data as never,
      }),
    },
    {
      key: "budget_nso",
      data: {
        history: budgetHistory(stat("nso-balance.json")),
        spending: spendingBreakdown(stat("nso-purpose.json")),
        revenue: revenueByType(stat("nso-revenue.json")),
        debt: [],
        updated: { balance: null, purpose: null, revenue: null, debt: null },
      } satisfies BudgetNsoSnapshot,
    },
    {
      key: "shilendans",
      data: { from: `${now.getUTCFullYear()}-01-01`, to: asOf, topPayees: parseTopPayees(json("budget/shilendans-top.json")), categories: parseCategories(json("budget/shilendans-eza.json")) } satisfies ShilendansSnapshot,
    },
    { key: "worldbank_tax", data: parseWorldBank(json("budget/worldbank-tax.json")) },
    {
      key: "audit_opinions",
      data: {
        totals: Object.fromEntries(OPINIONS.map((o) => [o, audit[o].total])) as AuditSnapshot["totals"],
        reports: OPINIONS.flatMap((o) => audit[o].reports).slice(0, 10),
      } satisfies AuditSnapshot,
    },
    { key: "soe_finance", data: { year: now.getUTCFullYear() - 1, companies: parseSoeReport(json("soe-report.json")) } },
    // /prices: 3 of the 13 goods (beef, petrol, canteen), every month since 2010-12, and the wage series.
    { key: "prices_nso", data: parsePrices(stat("nso-prices.json"), GOODS.filter((g) => ["beef", "petrol", "canteen"].includes(g.key))) },
    { key: "wages_nso", data: parseWages(stat("nso-wages.json")) },
    // /participate: the parser test's petition page (authors removed); shown as captured, open or not.
    { key: "petitions", data: { fetchedAt: now.toISOString(), items: parsePetitions(read("petitions-page.html"), unshoutTitle), skippedNamed: 0 } satisfies PetitionsSnapshot },
  ];
  for (const s of snapshots) {
    const row = { key: s.key, data: s.data, asOf, updatedAt: now };
    await db.insert(indicatorSnapshots).values(row).onConflictDoUpdate({ target: indicatorSnapshots.key, set: row });
  }

  // /tenders: the real Шилэн данс rows of the parser test (fixture dated Nov 2026).
  const lots = parseTenders([json("shilendans-tenders.json")], 2026, "2026-11-02");
  if (lots.length) {
    await db.insert(tenders).values(lots.map((t) => ({ ...t, firstSeenAt: now, awardedSeenAt: t.awarded ? now : null }))).onConflictDoNothing();
    await db.insert(appSettings).values({ key: "tenders_synced_at", value: now.toISOString() }).onConflictDoNothing();
  }
  // The members' company matches, as tenders:sync stores them (the pages never match live).
  await storeCompanyMatches(db, now);

  // /documents: the real audit.mn register rows and the mimr.gov.mn tender page of the parser tests.
  const audits = parseAuditRegister(read("audit-register.html"));
  const wp = JSON.parse(read("wp-report-page.json")) as { content: string; link: string };
  const files = documentLinks(wp.content, wp.link);
  const docRows = [
    ...audits.map((r) => ({ url: r.url, title: r.title, kind: "audit", domain: "audit.mn", pageTitle: "Аудитын тайлангийн сан", pageUrl: "https://audit.mn/audit", meta: { office: r.office ?? "", auditType: r.auditType ?? "" }, firstSeenAt: now })),
    ...files.map((f) => ({ url: f.url, title: f.title, kind: "tender", domain: "mimr.gov.mn", pageTitle: "Тендерийн урилга", pageUrl: wp.link, fileType: f.fileType, firstSeenAt: now })),
  ];
  if (docRows.length) {
    await db.insert(documents).values(docRows).onConflictDoNothing();
    await db.insert(appSettings).values({ key: "documents_checked_at", value: now.toISOString() }).onConflictDoNothing();
  }

  // A digest from the rule-based ranking (or the AI editor, when a key is set).
  const digest = await createDigest(db, { kind: "12h", now, force: true }).catch((err: unknown) => ({ status: `skipped: ${err instanceof Error ? err.message : err}` }));

  const [{ a }] = await db.select({ a: count() }).from(articles).where(eq(articles.isPublished, true));
  const [{ p }] = await db.select({ p: count() }).from(politicians);
  return { articles: a, politicians: p, snapshots: snapshots.length, digest: digest.status };
}
