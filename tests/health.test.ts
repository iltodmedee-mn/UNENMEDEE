import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateHealth, type HealthConfig, healthProblems, healthReport, type HealthSnapshot } from "@/lib/health";

const NOW = new Date("2026-10-27T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function healthy(): HealthSnapshot {
  return {
    core: {
      hoursSinceArticle: 1,
      hoursSinceAi: 2,
      hoursSinceDigest: 9,
      aiBacklog: 3,
      activeSources: 100,
      failingSources: 20,
      pushSubs: 6,
      pushFailing: 0,
      hoursSincePushSuccess: 9,
      dbMb: 22,
      published24h: 120,
      fallback24h: 0,
      recentDigests: ["groq/x", "rule-based", "groq/x", "gemini/y"],
      paidCapDays: 0,
      hoursSinceRecheck: 58,
    },
    officials: { hoursSinceSync: 34, active: 126 },
    indicators: { mongolbank: 3, budget_nso: 3, shilendans: 3, worldbank_tax: 3, audit_opinions: 3, soe_finance: 3, population: 3, prices_nso: 3, wages_nso: 3, officials_companies: 3, petitions: 3 },
    population: { year: 2025, count: 3_425_162 },
    opendataHours: 3,
    social: { facebook: { hoursSinceOk: 9, unknown7d: 0 }, threads: { hoursSinceOk: 9, unknown7d: 0 }, telegram: { hoursSinceOk: null, unknown7d: 0 } },
    tokens: { threads: daysAgo(2), instagram: daysAgo(2) },
    maintenance: { pruneAt: null, backupAt: null, pipelineAt: new Date(NOW.getTime() - 40 * 60_000) },
    network: { siteOk: true, siteStatus: "HTTP 200", feedOk: true, siteCertValidTo: daysAgo(-60), securityTxtExpires: daysAgo(-365) },
    workflows: { notActive: [], failingSchedules: [] },
    bundledCerts: [{ file: "certs/a.pem", validTo: new Date("2027-11-02T12:00:00Z") }],
  };
}

const CONFIG: HealthConfig = {
  socialConfigured: { facebook: true, threads: true, instagram: false, telegram: false, discord: false },
  dated: { governmentsVerified: "2026-10-21", programmeEnd: "2028-07-01", populationYear: 2025, ratesChecked: "2026-10-24", projectsVerified: "2026-10-29" },
};

/** Applies one change to a healthy snapshot and returns the lines it produced. */
function only(change: (s: HealthSnapshot) => void, config = CONFIG, now = NOW): string[] {
  const s = healthy();
  change(s);
  return evaluateHealth(s, config, now);
}

describe("watchdog rules", () => {
  it("a healthy system (today's production numbers) has no problems", () => {
    assert.deepEqual(evaluateHealth(healthy(), CONFIG, NOW), []);
  });

  it("each rule fires on its own, with one line", () => {
    const cases: [string, (s: HealthSnapshot) => void, RegExp][] = [
      ["no news", (s) => (s.core!.hoursSinceArticle = 30), /Шинэ мэдээ 30 цаг/],
      ["never any news", (s) => (s.core!.hoursSinceArticle = null), /хэзээ ч/],
      ["no AI", (s) => (s.core!.hoursSinceAi = 40), /AI хураангуй/],
      ["no digest", (s) => (s.core!.hoursSinceDigest = 27), /Онцлох тойм/],
      ["sources failing", (s) => (s.core!.failingSources = 70), /70%/],
      ["push failures", (s) => (s.core!.pushFailing = 4), /4\/6 захиалга/],
      ["push never delivered", (s) => (s.core!.hoursSincePushSuccess = 100), /нэг ч захиалагчид/],
      ["database full", (s) => (s.core!.dbMb = 410), /410 MB/],
      ["fallback summaries", (s) => (s.core!.fallback24h = 80), /80\/120 мэдээ AI-гүй/],
      ["rule-based digests", (s) => (s.core!.recentDigests = ["rule-based", "rule-based", "groq/x", "rule-based"]), /4 тоймын 3/],
      ["paid AI at the cap", (s) => (s.core!.paidCapDays = 5), /7 хоногийн 5 өдөр/],
      ["re-check stopped", (s) => (s.core!.hoursSinceRecheck = 10 * 24), /дахин шалгалт 10 хоног/],
      ["officials stale", (s) => (s.officials!.hoursSinceSync = 10 * 24), /10 хоног шинэчлэгдээгүй/],
      ["officials retired", (s) => (s.officials!.active = 20), /Идэвхтэй УИХ-ын гишүүн 20/],
      ["places lost their MPs", (s) => (s.officials!.placesWithoutMps = ["Ховд", "Увс"]), /2 аймаг\/дүүргийн хуудсанд.*Ховд, Увс/],
      ["indicator stale", (s) => (s.indicators!.mongolbank = 80), /"mongolbank" 3 хоног/],
      ["indicator missing", (s) => delete s.indicators!.audit_opinions, /"audit_opinions" огт/],
      ["NSO published a newer population", (s) => (s.population = { year: 2026, count: 3_470_000 }), /ҮСХ 2026 оны хүн амын тоог \(3,470,000\)/],
      ["opendata stale", (s) => (s.opendataHours = 80), /opendata\.mn/],
      ["facebook silent", (s) => (s.social!.facebook!.hoursSinceOk = 80), /^facebook: 80 цаг/],
      ["unknown post", (s) => (s.social!.threads!.unknown7d = 1), /^threads: 1 пост/],
      ["token not refreshed", (s) => (s.tokens!.threads = daysAgo(20)), /^threads: 60 хоногийн токен 20 хоног.*40 хоногийн дараа/],
      ["prune stopped", (s) => (s.maintenance!.pruneAt = daysAgo(4)), /db:prune/],
      ["backup stopped", (s) => (s.maintenance!.backupAt = daysAgo(11)), /Нөөц хуулбар/],
      ["tenders not synced", (s) => (s.maintenance!.tendersAt = daysAgo(4)), /Тендерийн үр дүн/],
      ["documents not watched", (s) => (s.maintenance!.documentsAt = daysAgo(4)), /Тайлан, баримт бичгийн/],
      ["pipeline not started for 7 h", (s) => (s.maintenance!.pipelineAt = new Date(NOW.getTime() - 7 * 3_600_000)), /pipeline 7 цаг эхлээгүй/],
      ["site down", (s) => (s.network!.siteOk = false), /нээгдэхгүй/],
      ["feed broken", (s) => (s.network!.feedOk = false), /feed\.xml/],
      ["site cert", (s) => (s.network!.siteCertValidTo = daysAgo(-10)), /TLS гэрчилгээ/],
      ["security.txt missing", (s) => (s.network!.securityTxtExpires = null), /security\.txt уншигдсангүй/],
      ["security.txt expiring", (s) => (s.network!.securityTxtExpires = daysAgo(-10)), /Expires/],
      ["bundled cert", (s) => (s.bundledCerts![0].validTo = daysAgo(-30)), /certs\/a\.pem/],
      ["workflow disabled", (s) => (s.workflows!.notActive = ["a.yml (disabled_inactivity)"]), /идэвхгүй: a\.yml/],
      ["workflow red", (s) => (s.workflows!.failingSchedules = ["b.yml"]), /3 удаа.*b\.yml/],
    ];
    for (const [name, change, line] of cases) {
      const out = only(change);
      assert.equal(out.length, 1, `${name}: ${JSON.stringify(out)}`);
      assert.match(out[0], line, name);
    }
  });

  it("asks for the backup key until it is set", () => {
    const missing = evaluateHealth(healthy(), { ...CONFIG, backupConfigured: false }, NOW);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /BACKUP_AGE_PUBLIC_KEY/);
    assert.deepEqual(evaluateHealth(healthy(), { ...CONFIG, backupConfigured: true }, NOW), []);
  });

  it("a platform that is not set up is never reported", () => {
    assert.deepEqual(only((s) => (s.social!.telegram!.hoursSinceOk = null)), []);
    assert.deepEqual(only((s) => (s.tokens!.instagram = daysAgo(50))), []);
    const telegram = only((s) => (s.social!.telegram!.hoursSinceOk = null), { ...CONFIG, socialConfigured: { ...CONFIG.socialConfigured, telegram: true } });
    assert.equal(telegram.length, 1);
    assert.match(telegram[0], /^telegram: хэзээ ч/);
  });

  it("small samples do not alarm", () => {
    assert.deepEqual(only((s) => Object.assign(s.core!, { published24h: 6, fallback24h: 6 })), []);
    assert.deepEqual(only((s) => Object.assign(s.core!, { pushSubs: 4, pushFailing: 4, hoursSincePushSuccess: null })), []);
    assert.deepEqual(only((s) => (s.core!.recentDigests = ["rule-based", "rule-based"])), []);
    // The re-check is a weekly job: it is only missed once it has run at least once.
    assert.deepEqual(only((s) => (s.core!.hoursSinceRecheck = null)), []);
  });

  it("a section that could not be collected is skipped, not reported as broken", () => {
    const s = healthy();
    delete s.core;
    delete s.network;
    delete s.workflows;
    delete s.indicators;
    assert.deepEqual(evaluateHealth(s, CONFIG, NOW), []);
  });

  it("dated facts ask for a re-check at the right time", () => {
    // Without NSO's snapshot the population reminder falls back to the calendar.
    const dated = (iso: string) => evaluateHealth({ ...healthy(), population: null }, CONFIG, new Date(iso)).filter((l) => /Ерөнхий сайд|хөтөлбөр дууссан|Хүн амын|Татварын|Төслүүдийн/.test(l));
    assert.deepEqual(dated("2027-03-31T00:00:00Z"), []);
    // Population of 2025 is published early 2026; asking from April 2027 leaves time for the 2026 figure.
    assert.equal(dated("2027-04-02T00:00:00Z").length, 1);
    const beforeElection = dated("2028-06-01T00:00:00Z");
    assert.ok(beforeElection.some((l) => /Ерөнхий сайдын жагсаалт/.test(l)));
    assert.ok(beforeElection.some((l) => /Татварын хувь/.test(l)));
    assert.ok(!beforeElection.some((l) => /хөтөлбөр дууссан/.test(l)));
    assert.ok(dated("2028-07-02T00:00:00Z").some((l) => /хөтөлбөр дууссан/.test(l)));
    // /projects sources: six months after the last re-read.
    assert.ok(!dated("2027-04-20T00:00:00Z").some((l) => /Төслүүдийн/.test(l)));
    assert.ok(dated("2027-05-01T00:00:00Z").some((l) => /Төслүүдийн/.test(l)));
  });

  it("tariffs ask for a re-check 13 months after they were verified", () => {
    const config = { ...CONFIG, dated: { ...CONFIG.dated, tariffsVerified: "2026-10-29" } };
    const tariffs = (iso: string) => evaluateHealth(healthy(), config, new Date(iso)).filter((l) => /тарифыг/.test(l));
    assert.deepEqual(tariffs("2027-11-20T00:00:00Z"), []);
    assert.equal(tariffs("2027-12-01T00:00:00Z").length, 1);
  });

  it("videos: a quiet day and a half, or a platform with no video for two days", () => {
    const config = { ...CONFIG, videoPosting: true };
    const fresh = { hoursSinceVideo: 6, hoursSincePost: { facebook: 5, threads: 5 } };
    assert.deepEqual(only((s) => (s.videos = fresh), config), []);
    assert.equal(only((s) => (s.videos = { ...fresh, hoursSinceVideo: 40 }), config).filter((l) => /видео/.test(l)).length, 1);
    assert.equal(only((s) => (s.videos = { ...fresh, hoursSincePost: { facebook: 60, threads: 5 } }), config).filter((l) => /facebook: видео/.test(l)).length, 1);
    // Instagram is not configured in CONFIG: never reported; videos off: nothing at all.
    assert.deepEqual(only((s) => (s.videos = { ...fresh, hoursSincePost: { facebook: 5, threads: 5, instagram: null } }), config), []);
    assert.deepEqual(only((s) => (s.videos = { hoursSinceVideo: null, hoursSincePost: {} }), { ...CONFIG, videoPosting: false }), []);
  });

  it("press feeds and the pipeline-fallback token", () => {
    assert.deepEqual(only((s) => (s.press = { "ikon.mn": 2, "sonin.mn": 3 })), []);
    assert.equal(only((s) => (s.press = { "ikon.mn": 2, "news.mn": 30 })).length, 1);
    assert.equal(only((s) => (s.press = { "ikon.mn": null })).length, 1);
    assert.deepEqual(only((s) => (s.dispatchTokenExpires = new Date(NOW.getTime() + 90 * 86_400_000))), []);
    assert.equal(only((s) => (s.dispatchTokenExpires = new Date(NOW.getTime() + 10 * 86_400_000))).length, 1);
  });
});

describe("data integrity and phone layout rules", () => {
  const NOW = new Date("2026-11-01T04:00:00Z");
  const clean = { brokenAiText: 0, widespreadClusters: 0, duplicateHashes: 0, silentSources: [] };

  it("stays quiet when the data is clean and no page overflows", () => {
    assert.deepEqual(evaluateHealth({ integrity: clean, layout: [] }, CONFIG, NOW), []);
    assert.deepEqual(evaluateHealth({}, CONFIG, NOW), [], "no scan, no data: nothing to say");
  });

  it("names each kind of wrong data the Nov 2026 audit found", () => {
    const out = evaluateHealth({ integrity: { brokenAiText: 5, widespreadClusters: 1, duplicateHashes: 1, silentSources: ["sport.gov.mn"] } }, CONFIG, NOW);
    assert.equal(out.length, 4);
    assert.ok(out.some((l) => l.includes("undefined")));
    assert.ok(out.some((l) => l.includes("7 хоногоос")));
    assert.ok(out.some((l) => l.includes("content_hash")));
    assert.ok(out.some((l) => l.includes("sport.gov.mn")));
  });

  it("reports a page wider than the phone screen", () => {
    const out = evaluateHealth({ layout: [{ path: "/risk", viewport: 360, width: 644, culprit: "article.group" }] }, CONFIG, NOW);
    assert.equal(out.length, 1);
    assert.match(out[0], /\/risk.*360px.*644px/);
  });
});

describe("layout scan pages", () => {
  it("samples each section of the sitemap and always includes the risky layouts", async () => {
    const { layoutPages, parseLayoutReport } = await import("@/lib/layout-check");
    const pages = layoutPages(["https://iltodmedee.mn/article/a", "https://iltodmedee.mn/article/b", "https://iltodmedee.mn/article/c", "https://iltodmedee.mn/clusters/7", "not a url"], [], 2);
    assert.ok(pages.includes("/risk") && pages.includes("/clusters/7"));
    assert.equal(pages.filter((p) => p.startsWith("/article/")).length, 2);
    assert.equal(parseLayoutReport("not json"), undefined);
    assert.equal(parseLayoutReport(null), undefined);
    assert.deepEqual(parseLayoutReport('[{"path":"/x","viewport":360,"width":400,"culprit":"div"},{"bad":1}]'), [{ path: "/x", viewport: 360, width: 400, culprit: "div" }]);
  });
});

describe("watchdog levels", () => {
  const level = (change: (s: HealthSnapshot) => void, now = NOW) => {
    const s = healthy();
    change(s);
    return healthProblems(s, CONFIG, now).map((p) => p.level);
  };

  it("🔴 only when readers are left without news or without the site", () => {
    assert.deepEqual(level((s) => (s.core!.hoursSinceArticle = 30)), ["urgent"]);
    assert.deepEqual(level((s) => (s.core!.hoursSinceAi = 40)), ["urgent"]);
    assert.deepEqual(level((s) => (s.core!.failingSources = 70)), ["urgent"]);
    assert.deepEqual(level((s) => (s.core!.dbMb = 450)), ["urgent"]);
    assert.deepEqual(level((s) => (s.maintenance!.pipelineAt = daysAgo(1))), ["urgent"]);
    assert.deepEqual(level((s) => ((s.network!.siteOk = false), (s.network!.siteStatus = "HTTP 500"))), ["urgent"]);
    assert.deepEqual(level((s) => (s.network!.siteCertValidTo = daysAgo(-5))), ["urgent"]);
    assert.deepEqual(level((s) => (s.workflows!.notActive = [".github/workflows/autonomous-news-pipeline.yml (disabled_inactivity)"])), ["urgent"]);
    assert.deepEqual(level((s) => (s.tokens!.threads = daysAgo(55))), ["urgent"], "five days left: posting is about to stop");
  });

  it("🟡 for everything the site keeps working through", () => {
    assert.deepEqual(level((s) => (s.core!.hoursSinceDigest = 30)), ["info"]);
    assert.deepEqual(level((s) => (s.indicators!.mongolbank = 100)), ["info"]);
    assert.deepEqual(level((s) => (s.tokens!.threads = daysAgo(20))), ["info"]);
    assert.deepEqual(level((s) => (s.workflows!.failingSchedules = [".github/workflows/backup.yml"])), ["info"]);
    assert.deepEqual(level((s) => (s.network!.feedOk = false)), ["info"]);
    assert.deepEqual(healthProblems({ layout: [{ path: "/risk", viewport: 360, width: 372, culprit: "x" }] }, CONFIG, NOW).map((p) => p.level), ["info"]);
  });

  it("the report puts urgent lines first under their own heading", () => {
    assert.deepEqual(healthReport([]), { level: "ok", lines: [] });
    const r = healthReport([
      { level: "info", text: "b" },
      { level: "urgent", text: "a" },
    ]);
    assert.equal(r.level, "urgent");
    assert.deepEqual(r.lines, ["🔴 ЯАРАЛТАЙ (сайт эсвэл мэдээ зогссон):", "- a", "", "🟡 МЭДЭЭЛЭЛ (сайт ажиллаж байгаа, завтай үедээ):", "- b"]);
    assert.equal(healthReport([{ level: "info", text: "b" }]).level, "info");
  });
});
