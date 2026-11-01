import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { finalItems, isDigestDue, MIN_DIGEST_STORIES, planDigest, rankScore } from "@/lib/ai/digest";
import { digestMessages } from "@/lib/ai/prompts";
import { DigestSchema, Tier1Schema } from "@/lib/ai/schemas";
import { formatPeriodMn } from "@/lib/format";

import { TIER1_OK } from "./helpers/mock-llm";

const H = 3_600_000;

describe("digest planning", () => {
  const now = new Date("2026-10-20T12:05:00Z");

  it("covers the last 12 hours by default", () => {
    const p = planDigest("12h", now, null);
    assert.equal(p.periodEnd.getTime() - p.periodStart.getTime(), 12 * H);
    assert.equal(p.pick, 10);
  });

  it("continues from the previous edition after a missed run, at most 36 hours back", () => {
    assert.equal(planDigest("12h", now, new Date(now.getTime() - 20 * H)).periodStart.getTime(), now.getTime() - 20 * H);
    assert.equal(planDigest("12h", now, new Date(now.getTime() - 100 * H)).periodStart.getTime(), now.getTime() - 36 * H);
    // A recent manual edition does not shrink the window below 12 hours.
    assert.equal(planDigest("12h", now, new Date(now.getTime() - 3 * H)).periodStart.getTime(), now.getTime() - 12 * H);
  });

  it("plans a 30-day review with more stories", () => {
    const p = planDigest("30d", now, null);
    assert.equal(p.periodEnd.getTime() - p.periodStart.getTime(), 30 * 24 * H);
    assert.equal(p.pick, 20);
  });
});

describe("digest ranking", () => {
  const base = { importanceScore: 50, riskScore: 0, otherSources: 0, sourceDomain: "mlsp.gov.mn", sourceCategory: "ministry" as const };

  it("puts national decisions and cross-source stories above routine news", () => {
    const routine = rankScore({ ...base, importanceScore: 10 });
    const law = rankScore({ ...base, importanceScore: 90, sourceDomain: "parliament.mn", sourceCategory: "portal" });
    const widelyReported = rankScore({ ...base, otherSources: 3 });
    assert.ok(law > widelyReported && widelyReported > rankScore(base) && rankScore(base) > routine);
  });

  it("treats articles without an importance score as average", () => {
    assert.equal(rankScore({ ...base, importanceScore: null }), rankScore({ ...base, importanceScore: 40 }));
  });
});

describe("digest schemas and prompt", () => {
  it("reads importance_score from Tier 1 and leaves it null when missing", () => {
    assert.equal(Tier1Schema.parse({ ...JSON.parse(TIER1_OK), importance_score: "87" }).importance_score, 87);
    assert.equal(Tier1Schema.parse(JSON.parse(TIER1_OK)).importance_score, null);
    assert.equal(Tier1Schema.parse({ ...JSON.parse(TIER1_OK), importance_score: 400 }).importance_score, 100);
  });

  it("validates the editor's reply", () => {
    const ok = DigestSchema.parse({
      title: "Төсөв ба тариф",
      intro: "Энэ 12 цагт улсын төсөв, эрчим хүчний тарифын шийдвэрүүд гол байр эзэллээ.",
      items: [{ id: "12", headline: "УИХ 2027 оны төсвийг хэлэлцэж эхэллээ", why: "Нийт зарлага 32.4 их наяд төгрөг." }],
    });
    assert.equal(ok.items[0].id, 12);
    assert.throws(() => DigestSchema.parse({ title: "Т", intro: "богино", items: [] }));
  });

  it("lists candidates with their id, source, amounts and coverage", () => {
    const [, user] = digestMessages(
      [{ id: 7, title: "Төсвийн төсөл", sourceName: "Сангийн яам", publishedAt: new Date("2026-10-20T03:00:00Z"), tldr: "Нийт зарлага\n32.4 их наяд.", amounts: ["32.4 их наяд ₮"], riskScore: 70, otherSources: 2 }],
      "10-р сарын 20",
      10,
    );
    assert.match(user.content, /\[7\] Төсвийн төсөл \(Сангийн яам, 2026-10-20; дүн: 32\.4 их наяд ₮; эрсдэл 70; \+2 эх сурвалж\)/);
    assert.match(user.content, /Нийт зарлага 32\.4 их наяд\./);
  });

  it("formats the period in Ulaanbaatar time", () => {
    assert.equal(formatPeriodMn(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-20T12:00:00Z")), "10-р сарын 20, 08:00 – 20:00");
    assert.equal(formatPeriodMn(new Date("2026-10-19T12:00:00Z"), new Date("2026-10-20T00:00:00Z")), "10-р сарын 19 20:00 – 10-р сарын 20 08:00");
  });
});

describe("digest schedule", () => {
  // Ulaanbaatar is UTC+8.
  const at = (ubHour: number) => new Date(Date.UTC(2026, 9, 24, (ubHour - 8 + 24) % 24, 30));
  it("writes only inside the morning and evening windows", () => {
    assert.equal(isDigestDue(at(8), null), true);
    assert.equal(isDigestDue(at(21), null), true);
    assert.equal(isDigestDue(at(13), null), false);
    assert.equal(isDigestDue(at(1), null), false);
  });
  it("writes one edition per window", () => {
    assert.equal(isDigestDue(at(21), new Date(at(21).getTime() - 2 * H)), false);
    assert.equal(isDigestDue(at(21), new Date(at(21).getTime() - 9 * H)), true);
  });
});

describe("digest final list", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const plan = planDigest("12h", now, null);
  const candidate = (id: number) => ({ id, slug: `s${id}`, title: `Мэдээ ${id}`, plainTitle: null, sourceName: "Яам", publishedAt: now, tldr: `Товч ${id}`, amounts: [], riskScore: 10, otherSources: 0, clusterId: null, score: 100 - id });
  const candidates = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
  const aiItem = (id: number) => ({ articleId: id, slug: `s${id}`, title: `Мэдээ ${id}`, sourceName: "Яам", publishedAt: null, riskScore: 10, headline: "AI гарчиг", whyItMatters: "Учир нь", otherSources: 0 });

  it("keeps the editor model's list when it has enough valid stories", () => {
    const ai = [1, 2, 3, 4, 5].map(aiItem);
    assert.deepEqual(finalItems(ai, candidates, plan), { items: ai, fromAI: true });
  });

  it("falls back to the rule-based ranking when the model kept too few valid ids (no 1-story edition)", () => {
    const res = finalItems([aiItem(1), aiItem(2)], candidates, plan);
    assert.equal(res.fromAI, false);
    assert.ok(res.items.length >= MIN_DIGEST_STORIES);
    assert.deepEqual(res.items.map((i) => i.articleId), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("lets a 30-day review publish whatever the model kept", () => {
    const monthly = planDigest("30d", now, null);
    assert.equal(finalItems([aiItem(1)], candidates, monthly).fromAI, true);
  });
});

describe("digest editor answer", () => {
  it("drops a bad item instead of failing the edition, and never prints null", () => {
    const r = DigestSchema.parse({
      title: "Өглөөний тойм",
      intro: "Өнөөдрийн хамгийн чухал мэдээнүүдийг товчлон хүргэж байна.",
      items: [
        { id: 3, headline: "Сайн гарчиг энд", why: null },
        { id: "12a", headline: "Буруу дугаартай", why: "y" },
        { id: "7", headline: "Өөр гарчиг энд", why: "Яагаад" },
        { id: 8, headline: null, why: "z" },
      ],
    });
    assert.deepEqual(r.items, [
      { id: 3, headline: "Сайн гарчиг энд", why: "" },
      { id: 7, headline: "Өөр гарчиг энд", why: "Яагаад" },
    ]);
  });
});

