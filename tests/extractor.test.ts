import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { extractMntAmounts, extractTenderMeta, amountToNumber, hasTenderSignals } from "@/lib/scraper/adapters/tender";
import { cleanTitle, extractArticle, htmlFragmentToText, plainTitle } from "@/lib/scraper/extractor";
import { safeDecode } from "@/lib/scraper/links";
import { contentHash, normalizeText, slugify, truncate } from "@/lib/text";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("extractArticle on real ministry pages", () => {
  it("extracts a WordPress article (mimr.gov.mn) with date from the URL", () => {
    const url = "https://www.mimr.gov.mn/2026/10/19/test-slug/";
    const a = extractArticle(fixture("mimr-article.html"), url);
    assert.ok(a, "article should be extracted");
    assert.match(a.title, /ШУУРХАЙ ХУРАЛДААН/);
    assert.ok(!a.title.includes("Аж үйлдвэр, эрдэс баялгийн яам –"), "site suffix stripped");
    assert.ok(a.text.length > 500);
    assert.ok(!/<[a-z]+[\s>]/i.test(a.text), "no HTML left in text");
    assert.equal(a.publishedAt?.toISOString().slice(0, 10), "2026-10-19");
    assert.equal(a.hash, contentHash(a.text));
  });

  it("extracts a custom-CMS article (mlsp.gov.mn)", () => {
    const a = extractArticle(fixture("mlsp-article.html"), "https://mlsp.gov.mn/content/detail/4204");
    assert.ok(a);
    assert.match(a.title, /Хүүхэд хамгааллын/);
    assert.ok(a.text.length > 300);
  });

  it("returns null for pages without a real body (mecc.gov.mn phone-number notice, empty shells)", () => {
    // This real page's only text block is the contact footer (171 chars).
    assert.equal(extractArticle(fixture("mecc-article.html"), "https://mecc.gov.mn/posts/20250101"), null);
    assert.equal(extractArticle("<html><body><nav>Нүүр</nav></body></html>", "https://x.gov.mn/"), null);
  });
});

describe("text utilities", () => {
  it("normalizes whitespace and zero-width characters so hashes are stable", () => {
    assert.equal(normalizeText("  Сангийн яам ​\n\n\n\nмэдээ  "), "Сангийн яам\n\nмэдээ");
    assert.equal(contentHash("a  b"), contentHash("a b"));
    assert.equal(contentHash("x").length, 64);
  });

  it("transliterates Mongolian Cyrillic slugs with a stable unique suffix", () => {
    const slug = slugify("Төсвийн тодотгол: 4.5 тэрбум ₮", "https://mof.gov.mn/a/1");
    assert.match(slug, /^tusviin-todotgol-4-5-terbum-[0-9a-f]{8}$/);
    assert.equal(slug, slugify("Төсвийн тодотгол: 4.5 тэрбум ₮", "https://mof.gov.mn/a/1"));
    assert.notEqual(slug, slugify("Төсвийн тодотгол: 4.5 тэрбум ₮", "https://mof.gov.mn/a/2"));
  });

  it("cleans site-name suffixes from titles and truncates at sentence boundaries", () => {
    assert.equal(cleanTitle("Шинэ хууль батлагдлаа энэ долоо хоногт | Сангийн яам"), "Шинэ хууль батлагдлаа энэ долоо хоногт");
    assert.equal(truncate("Нэг. Хоёр. Гурав дөрөв тав", 12), "Нэг. Хоёр.");
  });

  it("converts HTML fragments to text", () => {
    assert.equal(htmlFragmentToText("<p>Нэг</p><p>Хоёр<br>гурав</p><script>x()</script>"), "Нэг\nХоёр\nгурав");
  });
});

describe("tender extraction", () => {
  const text = `Худалдан авах ажиллагааны урилга
Захиалагч: Зам, тээврийн яам
Тендерийн дугаар: ЗТЯ/202601234
Төсөвт өртөг: 4,500,000,000 төгрөг
Нэмэлт ажилд 1.2 тэрбум төгрөг, бусад зардалд 350 сая ₮ зарцуулна.`;

  it("pulls budget, procuring entity and tender code", () => {
    const meta = extractTenderMeta(text);
    assert.equal(meta.tender_code, "ЗТЯ/202601234");
    assert.equal(meta.procuring_entity, "Зам, тээврийн яам");
    assert.equal(meta.budget_mnt, "4,500,000,000 ₮");
    assert.ok(hasTenderSignals(text));
  });

  it("finds MNT amounts with Mongolian magnitude words and converts them", () => {
    const amounts = extractMntAmounts(text);
    assert.deepEqual(amounts, ["4,500,000,000 ₮", "1.2 тэрбум ₮", "350 сая ₮"]);
    assert.equal(amountToNumber("1.2 тэрбум ₮"), 1.2e9);
    assert.equal(amountToNumber("2,500 сая ₮"), 2.5e9);
    assert.equal(amountToNumber("12,5 тэрбум ₮"), 12.5e9);
    // "төг" counts only as a whole word: "1 200 000 төгсөгч" is people, not money.
    assert.deepEqual(extractMntAmounts("1 200 000 төгсөгч ажилд орсон, 2 500 000 төг. олгоно"), ["2 500 000 ₮"]);
    assert.equal(amountToNumber("4,500,000,000 ₮"), 4.5e9);
    assert.equal(amountToNumber("350 сая ₮"), 3.5e8);
    assert.deepEqual(extractMntAmounts("5 төгрөг"), [], "tiny bare amounts are noise");
  });
});

describe("stripHeavyTags", () => {
  it("drops script, style, svg and frame blocks in any closing-tag spelling, nested too", async () => {
    const { stripHeavyTags } = await import("@/lib/scraper/extractor");
    const html = `<p>a</p><script>x</script ><p>b</p><SCRIPT type="m">y</SCRIPT foo><style>.c{}</style><svg><path/></svg><iframe src="u"></iframe><scr<script>z</script>ipt>w</script><p>c</p>`;
    assert.equal(stripHeavyTags(html), "<p>a</p><p>b</p><p>c</p>");
  });

  it("keeps the article after a self-closing <svg/> or <iframe/>", async () => {
    const { stripHeavyTags } = await import("@/lib/scraper/extractor");
    assert.equal(stripHeavyTags("<svg/><p>ARTICLE BODY</p><svg><path/></svg><p>rest</p>"), "<svg/><p>ARTICLE BODY</p><p>rest</p>");
    assert.equal(stripHeavyTags('<iframe src="x" /><p>body</p><scriptx>k</scriptx>'), '<iframe src="x" /><p>body</p><scriptx>k</scriptx>');
  });

  it("stays fast on thousands of unclosed openers", async () => {
    const { stripHeavyTags } = await import("@/lib/scraper/extractor");
    const html = "<p>x</p>" + "<svg ".repeat(2) + "<svg><p>filler</p>".repeat(5_000) + "a".repeat(1_000_000);
    const t0 = performance.now();
    stripHeavyTags(html);
    assert.ok(performance.now() - t0 < 300, `took ${performance.now() - t0} ms`);
  });
});

describe("titles from feeds and og:site_name", () => {
  it("keeps an API headline whole and never mistakes the headline for the site's name", () => {
    assert.equal(plainTitle("  Сайд Б.Бат - Хууль баталлаа \n"), "Сайд Б.Бат - Хууль баталлаа");
    const html = `<html><head><title>Засгийн газар шинэ тогтоол баталлаа</title>
      <meta property="og:title" content="Засгийн газар шинэ тогтоол баталлаа">
      <meta property="og:site_name" content="Засгийн газар шинэ тогтоол баталлаа"></head>
      <body><article><h1>Засгийн газар шинэ тогтоол баталлаа</h1><p>${"Засгийн газрын хуралдаанаар шинэ тогтоол баталж, хэрэгжүүлэх ажлыг эхлүүллээ. ".repeat(8)}</p></article></body></html>`;
    assert.equal(extractArticle(html, "https://example.gov.mn/news/1")?.title, "Засгийн газар шинэ тогтоол баталлаа");
  });

  it("does not lose a listing to a broken percent escape", () => {
    assert.equal(safeDecode("/news/%E0%A4%A"), "/news/%E0%A4%A");
    assert.equal(safeDecode("/%D0%BC%D1%8D%D0%B4%D1%8D%D1%8D"), "/мэдээ");
  });
});

