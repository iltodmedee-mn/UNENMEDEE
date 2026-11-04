import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { impactHtml } from "@/lib/video/impact-html";
import { amountWords } from "@/lib/video/money-video";
import { IMPACT_MAX_CHARS, impactNarration, type ImpactStory, impactVideoSpec, spokenText, verifyImpactSpec } from "@/lib/video/impact-video";
import { facebookVideoText, instagramVideoCaption, threadsVideoText, type ImpactVideoMeta } from "@/lib/video/posts";
import { kindsFor } from "@/lib/video/schedule";
import { THREADS_MAX, threadsLength } from "@/lib/social/threads";
import { buildTimeline } from "@/lib/video/timing";

// Real stories of Oct 2026 (production rows), as stored.
const pension: ImpactStory = {
  id: 2015,
  slug: "tetgever-600",
  title: "Нийгмийн халамжийн тэтгэвэр 11-р сарын 1-нээс 600 мянган төгрөг болж нэмэгдэнэ",
  impact: {
    who: null,
    when: "2026 оны 11 дүгээр сарын 01-нээс",
    action: null,
    change: "Сар бүр авах тэтгэвэр, тэтгэмжийн хэмжээ нэмэгдэж, зарим бүлгийнхэн 600 мянган төгрөг хүртэл авна.",
  },
  sourceName: "Хөдөлмөр, нийгмийн хамгааллын яам",
  day: "2026-10-29",
  topic: "social",
};

describe("spokenText: the forms a speech model misreads become words", () => {
  it("dates, month ordinals, decimals before a scale word, separators, leading zeros", () => {
    assert.equal(spokenText("2026-11-01-нээс"), "2026 оны арван нэгдүгээр сарын 1-нээс");
    assert.equal(spokenText("10-р сарын 28-наас"), "аравдугаар сарын 28-наас");
    assert.equal(spokenText("2026 оны 11 дүгээр сарын 01-нээс"), "2026 оны арван нэгдүгээр сарын 1-нээс");
    assert.equal(spokenText("170.1 тэрбум ₮ зарцуулна"), "зуун дал гаруй тэрбум төгрөг зарцуулна");
    assert.equal(spokenText("100,000₮ хүртэл"), "100000 төгрөг хүртэл");
    assert.equal(spokenText("91 хувьд хүрлээ"), "91 хувьд хүрлээ");
  });
});

describe("impactVideoSpec", () => {
  it("reads a decision the way the site's «Танд хамаатай юу?» block does", () => {
    const spec = impactVideoSpec(pension);
    assert.ok(spec);
    assert.equal(spec.key, "impact:2015");
    assert.deepEqual(
      spec.cards.map((c) => c.scene),
      ["change", "when"],
    );
    assert.deepEqual(
      spec.sentences.map((s) => s.scene),
      ["hook", "change", "when", "cta"],
    );
    assert.match(spec.source, /Товчлол: AI/);
    assert.match(spec.source, /Дуу: AI/);
    assert.deepEqual(verifyImpactSpec(spec), []);
    assert.ok(impactNarration(spec).length <= IMPACT_MAX_CHARS);
    assert.match(impactNarration(spec), /арван нэгдүгээр сарын/);
    assert.match(spec.sentences[0].caption, /\*600\*/);
  });

  it("refuses a headline that weighs or accuses and a field naming a charge", () => {
    assert.equal(impactVideoSpec({ ...pension, title: "Төсвийн зарлага 9-ээс 43.5 их наяд ₮ болж өссөн ч иргэдийн орлого 62% л өссөн" }), null);
    assert.equal(impactVideoSpec({ ...pension, title: "Уул уурхайн тусгай зөвшөөрөлд авлигын эрсдэл илэрч, 11 зөвлөмж өглөө" }), null);
    assert.equal(impactVideoSpec({ ...pension, impact: { ...pension.impact!, change: "Хууль бус шан авсан нь илэрлээ" } }), null);
  });

  it("needs what changes and one more answer", () => {
    assert.equal(impactVideoSpec({ ...pension, impact: null }), null);
    assert.equal(impactVideoSpec({ ...pension, impact: { who: null, when: null, action: null, change: "Өөрчлөгдөнө." } }), null);
    assert.equal(impactVideoSpec({ ...pension, impact: { who: "Бүх иргэд", when: null, action: null, change: null } }), null);
  });

  it("refuses a narration too long for one video", () => {
    const long = "Үйлчилгээний нөхцөл, мэдээлэл ил тод, ойлгомжтой болж, хэрэглэгчдийн эрх хамгаалагдана. ".repeat(5);
    assert.equal(impactVideoSpec({ ...pension, impact: { who: "Бүх иргэд", when: null, action: null, change: long } }), null);
  });

  it("puts its texts on the page as data, never as markup", () => {
    const spec = impactVideoSpec({ ...pension, impact: { ...pension.impact!, who: "<img src=x onerror=alert(1)>" } })!;
    const tl = buildTimeline(
      spec.sentences.map((s) => s.scene),
      spec.sentences.map((_, i) => i * 4),
      { duration: 20, tail: 19.5 },
      null,
    );
    const html = impactHtml(spec, tl, { fontsDir: "/f", logo: "/l.png" });
    assert.ok(!html.includes("<img src=x"));
    assert.equal(tl.pause, 0);
  });
});

describe("impact video posts", () => {
  const meta: ImpactVideoMeta = {
    kind: "impact",
    articleId: 2015,
    headline: pension.title,
    who: "Тэтгэвэр авагчид",
    change: pension.impact!.change!,
    when: pension.impact!.when,
    action: null,
    sourceName: pension.sourceName,
    topic: "social",
    link: "iltodmedee.mn/article/tetgever-600",
  };
  it("say who, what, when, the source and that the summary is AI", () => {
    const fb = facebookVideoText(meta, "https://iltodmedee.mn");
    assert.match(fb, /👥 Хэнд: Тэтгэвэр авагчид/);
    assert.match(fb, /📅 Хэзээнээс:/);
    assert.match(fb, /AI эх мэдээнээс товчилсон/);
    assert.match(fb, /https:\/\/iltodmedee\.mn\/article\/tetgever-600/);
    assert.match(instagramVideoCaption(meta), /bio-д/);
    assert.ok(threadsLength(threadsVideoText(meta, "https://iltodmedee.mn")) <= THREADS_MAX);
  });
});

describe("kindsFor", () => {
  it("the evening tries a decision first, a price video only when none qualifies", () => {
    assert.deepEqual(kindsFor("impact"), ["impact", "prices", "money"]);
    assert.deepEqual(kindsFor("money"), ["money", "prices"]);
  });
});

describe("spoken amounts equal the written ones (Nov 2026 audit)", () => {
  it("says decimal сая and тэрбум amounts exactly", () => {
    assert.equal(spokenText("Жилийн тэтгэмж 1.5 сая төгрөг болж өснө"), "Жилийн тэтгэмж нэг сая таван зуун мянга төгрөг болж өснө");
    assert.equal(spokenText("2,5 сая ₮"), "хоёр сая таван зуун мянга төгрөг");
    assert.equal(spokenText("0.4 сая төгрөг"), "дөрвөн зуун мянга төгрөг");
    assert.equal(spokenText("12,5 сая ₮"), "арван хоёр сая таван зуун мянга төгрөг");
    assert.equal(spokenText("1,250.5 сая ₮"), "нэг тэрбум хоёр зуун тавин нэгэн сая төгрөг");
    assert.equal(spokenText("9.9996 тэрбум ₮"), "арван тэрбум төгрөг");
    assert.equal(spokenText("7.5 их наяд ₮"), "долоон их наяд таван зуун тэрбум төгрөг");
  });
  it("never says zero for an amount above zero", () => {
    for (const v of [400_000, 999_999, 1_000_000, 1_499_999, 999_999_999, 1_000_000_000, 2_999_999_999_999]) assert.ok(!/тэг/.test(amountWords(v)), String(v));
  });
});

describe("Nov 2026 audit: voice and filters", () => {
  it("never merges a date's day with the next number", () => {
    assert.equal(spokenText("2026-11-01 100 айл"), "2026 оны арван нэгдүгээр сарын 1 100 айл");
    assert.equal(spokenText("11 дүгээр сарын 1 500 хүнд"), "арван нэгдүгээр сарын 1 500 хүнд");
    assert.equal(spokenText("2 500 000 төгрөг"), "2500000 төгрөг");
  });
});
