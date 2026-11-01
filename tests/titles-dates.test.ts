import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isFutureDate, isTimelessPage, looksOld, newestYearMentioned, publishDecision, ubYear } from "@/lib/scraper/dates";
import { sourceError } from "@/lib/scraper/crawl";
import { JSDOM } from "jsdom";

import { cleanTitle, dateFromText, extractArticle, extractPublishedDate, jsonBlobDate, parseDateValue } from "@/lib/scraper/extractor";
import { chooseTitle, firstSentenceTitle, isGenericTitle, isTransliteratedTitle, looksLikeNavigation, looksLikeUnitPage, unshoutTitle } from "@/lib/scraper/titles";
import { pinClock } from "./helpers/fixed-clock";

// Fixtures are 2026 pages and prices: the suite must not depend on the day it runs.
pinClock();

const page = (name: string) => readFileSync(new URL(`./fixtures/dates/${name}.html`, import.meta.url), "utf8");

describe("generic titles", () => {
  it("spots site and section titles", () => {
    assert.ok(isGenericTitle("Мэдээ | ТТХГ"));
    assert.ok(isGenericTitle("Нүүр хуудас"));
    assert.ok(isGenericTitle("Мэдээ мэдээлэл - Home"));
    assert.ok(isGenericTitle("Татварын ерөнхий газар", ["Татварын ерөнхий газар"]));
    assert.ok(isGenericTitle("Эрүүл Мэндийн даатгал | Эрүүл Мэндийн даатгал", ["Эрүүл мэндийн даатгалын ерөнхий газар", "Эрүүл Мэндийн даатгал"]));
    assert.ok(isGenericTitle("Журам"));
  });

  it("keeps real headlines, including ones that start with the agency's name", () => {
    assert.ok(!isGenericTitle("Татварын ерөнхий газар шинэ журам баталлаа", ["Татварын ерөнхий газар"]));
    assert.ok(!isGenericTitle("ДУУДЛАГА ХУДАЛДААНД УРЬЖ БАЙНА"));
    assert.ok(!isGenericTitle("Азийн хөгжлийн банктай хамтран ажиллах талаар хэлэлцлээ | ЭМДЕГ"));
  });

  it("falls back to the first real sentence, skipping date lines", () => {
    assert.equal(
      firstSentenceTitle("2026 оны 10 -р сарын 21, Лхагва\nТус газрын алба хаагчид сургалтад хамрагдлаа. Дараагийн өгүүлбэр."),
      "Тус газрын алба хаагчид сургалтад хамрагдлаа",
    );
    assert.equal(firstSentenceTitle("Тоон гарын үсгийг олгож эхэллээ 2022-05-111847 уншсанЗасгийн газрын"), "Тоон гарын үсгийг олгож эхэллээ");
    const long = firstSentenceTitle(`${"Монгол Улсын Засгийн газрын ээлжит хуралдаанаар олон чухал асуудлыг хэлэлцэн шийдвэрлэж, тогтоол гаргалаа ".repeat(2)}.`);
    assert.ok(long.length <= 111 && long.endsWith("…"));
  });

  it("skips a transliterated Latin slug over a Mongolian text, keeps a Latin name the text repeats", () => {
    const text = "Байгаль орчин, аялал жуулчлалын салбарт гадаадын буцалтгүй тусламж, зээлээр хэрэгжиж байгаа төслийн мэдээлэл. ".repeat(3);
    assert.ok(isTransliteratedTitle("Heregzhizh Bajgaa T Sl Dijn Talaarh Medeelel | MECC", text));
    assert.equal(chooseTitle(["Heregzhizh Bajgaa T Sl Dijn Talaarh Medeelel | MECC", "Хэрэгжиж буй төслийн мэдээлэл"], text), "Хэрэгжиж буй төслийн мэдээлэл");
    const festival = `“Youth for Water Festival – 2026” арга хэмжээг зохион байгуулна. ${"Усны үнэ цэнийг олон нийтэд хүргэнэ. ".repeat(5)}`;
    assert.ok(!isTransliteratedTitle("YOUTH FOR WATER FESTIVAL 2026", festival));
    assert.ok(!isTransliteratedTitle("IAAC annual report", "Short English text only."));
  });

  it("chooses the first candidate that is a real headline", () => {
    assert.equal(chooseTitle(["Мэдээ | ТТХГ", null, "Төрийн тусгай хамгаалалтын тухай хуулийн танилцуулга"], "текст"), "Төрийн тусгай хамгаалалтын тухай хуулийн танилцуулга");
  });

  it("recognises menu text glued together by the extractor", () => {
    assert.ok(looksLikeNavigation("ХолбоосуудТөрийн байгууллагаСалбаруудын сайтГадаад улсын байгууллагууд"));
    assert.ok(looksLikeNavigation("Саналаа бичнэ үүНүүр>Татварын тооцоолуур>->Татварын тооцоолуур"));
    assert.ok(looksLikeNavigation("Бидний тухай Мэндчилгээ Танилцуулга Захиргаа удирдлагын газар Аюулгүй байдал"));
    assert.ok(looksLikeNavigation("Нэвтрэх"));
    assert.ok(looksLikeNavigation("Шүгэл ажиллагаа 2023-06-08 1932 уншсан Тоон гарын үсэг 2022-05-11 1847 уншсан"));
    assert.ok(!looksLikeNavigation("Өнөөдөр Эрүүл мэндийн даатгалын ерөнхий газрын дарга Ц.Батбаатар Азийн хөгжлийн банкны төлөөлөгчдийг хүлээн авлаа."));
  });
});

describe("dates", () => {
  it("reads dates with an Ulaanbaatar time", () => {
    assert.equal(dateFromText("2026-08-27 15:48:12")?.toISOString(), "2026-08-27T07:48:00.000Z");
    assert.equal(dateFromText("2026 оны 05 дугаар сарын 05")?.toISOString().slice(0, 10), "2026-05-05");
    // iaac.mn prints the month and day first and the year after a comma.
    assert.equal(dateFromText("10 сарын 20, 2026 41 АНУ: Крипто хөрөнгө")?.toISOString().slice(0, 10), "2026-10-20");
    assert.equal(dateFromText("2026 оны 10 сарын 20, 2026")?.toISOString(), dateFromText("2026 оны 10 сарын 20")?.toISOString(), "year-first still wins");
  });

  it("flags undated pages that only mention old years", () => {
    const now = new Date("2026-10-22T00:00:00Z");
    assert.equal(newestYearMentioned("2020 оны хаврын чуулган, 2021 онд"), 2021);
    assert.ok(looksOld("Улсын Их Хурлын 2020 оны 05 дугаар сарын 14-ний өдрийн чуулганаар", now));
    // A current story that mentions an old year in passing is not an archive post.
    assert.ok(!looksOld("Холбооны Канцлер Фридрих Мерц бараалхлаа. Хоёр улс 2011 онд түншлэлийн харилцаа тогтоосон.", now));
    assert.ok(!looksOld("2025 онд эхэлсэн төсөл", now));
    assert.ok(!looksOld("Он дурдаагүй мэдээ", now));
  });
});

describe("extractor on real pages", () => {
  it("finds the date printed next to the headline", () => {
    const moh = extractArticle(page("moh"), "https://moh.gov.mn/news/7561");
    assert.equal(moh?.publishedAt?.toISOString(), "2026-05-26T18:36:00.000Z");
    const mrpam = extractArticle(page("mrpam"), "https://mrpam.gov.mn/news/x");
    assert.equal(mrpam?.publishedAt?.toISOString(), "2026-08-27T07:48:00.000Z");
    // No <h1>: the headline sits in <h5 class="blog-post-title"> and the date in .blog-post-date.
    const mlsp = extractArticle(page("mlsp"), "https://mlsp.gov.mn/content/detail/4178");
    assert.equal(mlsp?.publishedAt?.toISOString().slice(0, 10), "2026-10-01");
  });

  it("ignores dates in 'related news' lists below the article", () => {
    const emd = extractArticle(page("emd"), "https://emd.gov.mn/news/737");
    assert.equal(emd?.publishedAt, null);
    assert.match(emd?.title ?? "", /^Азийн хөгжлийн банктай/);
  });

  it("uses the article heading instead of the site title", () => {
    const sspa = extractArticle(page("sspa"), "https://sspa.gov.mn/mn/read?id=7");
    assert.match(sspa?.title ?? "", /^Төрийн тусгай хамгаалалтын тухай хуульд/);
    // The only date on the page is the 2020 one printed in the text: years old, so not trusted as
    // the publication date (the story is stored as undated and, being old, unpublished).
    assert.equal(sspa?.publishedAt, null);
  });
});

describe("shouting headlines", () => {
  it("lowers capitals to sentence case", () => {
    assert.equal(unshoutTitle("“1072 ХУВЬЦАА” НЭЭЛТТЭЙ ӨДӨРЛӨГ ЗОХИОН БАЙГУУЛАГДАЖ БАЙНА"), "“1072 хувьцаа” нээлттэй өдөрлөг зохион байгуулагдаж байна");
  });
  it("keeps abbreviations, initials and proper nouns", () => {
    assert.equal(unshoutTitle("УИХ-ЫН ГИШҮҮН Х.БАТТУЛГА МОНГОЛЫН ТӨМӨР ЗАМЫН ТАЛААР МЭДЭГДЭЛ ХИЙЛЭЭ"), "УИХ-ын гишүүн Х.Баттулга Монголын төмөр замын талаар мэдэгдэл хийлээ");
    assert.equal(unshoutTitle("ОЮУ ТОЛГОЙ ТӨСЛИЙН ТАЛААР НӨАТ-ЫН БУЦААЛТ 2026 ОНД"), "Оюу Толгой төслийн талаар НӨАТ-ын буцаалт 2026 онд");
  });
  it("keeps abbreviations before a hyphenated case ending and names after initials", () => {
    assert.equal(unshoutTitle("ШТС-УУДЫН ЭЭЛЖ ХҮЛЭЭЛЦЭХ ЦАГИЙГ 11:00 ЦАГ БОЛГОН ӨӨРЧИЛЛӨӨ"), "ШТС-уудын ээлж хүлээлцэх цагийг 11:00 цаг болгон өөрчиллөө");
    assert.equal(unshoutTitle("АҮЭБЯ-НЫ ДАРГА Б.ДАШПҮРЭВ С.К.ШОЙГУ-ТАЙ УУЛЗЛАА"), "АҮЭБЯ-ны дарга Б.Дашпүрэв С.К.Шойгу-тай уулзлаа");
    assert.equal(unshoutTitle("УЛААН БУРХАН ӨВЧИН ЭРГЭН ТАРХАЖ БАЙНА. БИД ЧАДАХ УУ?"), "Улаан бурхан өвчин эргэн тархаж байна. Бид чадах уу?");
  });
  it("lowers hashtag headlines, keeping # and the underscores", () => {
    assert.equal(
      unshoutTitle("#ХАМТЫН_СЭТГЭЛ_ХАЛУУН_ХАНДИВ 📣 АЙМГИЙН ЗАСАГ ДАРГА ИРГЭДЭД ХАНДАН УРИАЛГА ГАРГАЛАА"),
      "#Хамтын_сэтгэл_халуун_хандив 📣 аймгийн засаг дарга иргэдэд хандан уриалга гаргалаа",
    );
    // One hashtag is already several words.
    assert.equal(unshoutTitle("#ХАМТЫН_СЭТГЭЛ_ХАЛУУН_ХАНДИВ📣"), "#Хамтын_сэтгэл_халуун_хандив📣");
  });
  it("leaves normal and short titles alone", () => {
    assert.equal(unshoutTitle("АНУ: Крипто хөрөнгө холигч үйлчилгээнд тавих хяналт"), "АНУ: Крипто хөрөнгө холигч үйлчилгээнд тавих хяналт");
    assert.equal(unshoutTitle("ХУРАЛ БОЛНО"), "Хурал болно");
    for (const t of ["Тендерийн урилга", "Цахим уулзалт | ТТХГ"]) assert.ok(isGenericTitle(t, ["ТТХГ"]), t);
    assert.equal(unshoutTitle("МЭНДЧИЛГЭЭ"), "МЭНДЧИЛГЭЭ", "one word stays as written");
    assert.equal(unshoutTitle("ОЮУ ТОЛГОЙ"), "Оюу Толгой");
  });
});

describe("date parsing fixes", () => {
  const doc = (html: string) => new JSDOM(html).window.document;
  const year = new Date().getUTCFullYear();

  it("reads '11-р сар' as November, not January", () => {
    const y = year - 1; // last year: November and December of this year may still be in the future
    assert.equal(dateFromText(`${y} оны 11-р сар 5`)?.toISOString().slice(0, 10), `${y}-11-05`);
    assert.equal(dateFromText(`${y} 12-р сар 1`)?.toISOString().slice(0, 10), `${y}-12-01`);
    assert.equal(dateFromText(`${y} 1-р сар 9`)?.toISOString().slice(0, 10), `${y}-01-09`);
  });

  it("treats machine dates without a zone as Ulaanbaatar time", () => {
    assert.equal(parseDateValue(`${year}-03-04 17:41:12`)?.toISOString(), `${year}-03-04T09:41:12.000Z`);
    assert.equal(parseDateValue(`${year}-03-04T17:41`)?.toISOString(), `${year}-03-04T09:41:00.000Z`);
    assert.equal(parseDateValue(`${year}-03-04T17:41:00+08:00`)?.toISOString(), `${year}-03-04T09:41:00.000Z`);
    assert.equal(parseDateValue(`${year}-03-04T09:41:00Z`)?.toISOString(), `${year}-03-04T09:41:00.000Z`);
    assert.equal(parseDateValue("1970-01-01"), null);
    assert.equal(parseDateValue("not a date"), null);
  });

  it("ignores a stray <time> years older than the page's real one", () => {
    const d = doc(`<html><body><header><time datetime="2019-10-22">2019</time></header>
      <article><h1>Шүүхийн ерөнхий зөвлөлийн хуралдаан боллоо</h1><time datetime="${year}-03-04 17:41:12"></time><p>${"Текст. ".repeat(60)}</p></article></body></html>`);
    assert.equal(extractPublishedDate(d as unknown as Document, "https://judcouncil.mn/site/news/1", "")?.toISOString(), `${year}-03-04T09:41:12.000Z`);
  });

  it("prefers the headline's <time> and its printed text over a placeholder attribute (judcouncil.mn)", () => {
    // The article's <time> has a template placeholder in datetime and the real date as text; the
    // "latest news" list further down carries other articles' <time> elements.
    const d = doc(`<html><body><main><div class="row"><div class="col-md-8">
      <div class="post-title"><h1>Шүүхийн ерөнхий зөвлөлийн шүүгч бус гишүүд томилогдов</h1></div>
      <div class="post-atribute"><time datetime="2019-10-22"> ${year}-03-04 14:10:17 </time></div>
      <p>${"Текст. ".repeat(60)}</p></div>
      <div class="col-md-4"><h3><a href="/site/news_full/2">Өөр мэдээ</a></h3><time datetime="${year}-03-04 17:41:12">${year}-03-04 17:41:12</time></div>
      </div></main></body></html>`);
    assert.equal(extractPublishedDate(d as unknown as Document, "https://judcouncil.mn/site/news_full/1", "")?.toISOString(), `${year}-03-04T06:10:00.000Z`);
  });

  it("reads a clock-icon stamp in the headline's container, even an old one (uvurkhangai.gov.mn)", () => {
    const body = `<p>${"Сургалтыг зохион байгууллаа. ".repeat(20)}</p>`;
    const page = (stamp: string) =>
      doc(`<html><body><div class="main_colm"><div class="single_news">
        <div class="single_news_header">Халдварт өвчний дэгдэлтийг хянах сургалт боллоо</div>
        <div class="single_news_content">${body}<div style="float:left"> <i class="fa fa-clock-o"></i> ${stamp} </div></div>
      </div></div><div class="related"><div><i class="fa fa-clock-o"></i> ${year}-01-02 10:00:00</div></div></body></html>`);
    const headline = "Халдварт өвчний дэгдэлтийг хянах сургалт боллоо";
    assert.equal(extractPublishedDate(page(`${year}-03-04 16:34:21`) as unknown as Document, "https://uvurkhangai.gov.mn/157/item/1", "", headline)?.toISOString(), `${year}-03-04T08:34:00.000Z`);
    // A year-old stamp is still the article's own date (so the story stays off the feed).
    assert.equal(extractPublishedDate(page("2024-09-13 16:34:21") as unknown as Document, "https://uvurkhangai.gov.mn/157/item/1", "", headline)?.toISOString().slice(0, 10), "2024-09-13");
    // Without a stamp of its own, the related list's icons are not used.
    const bare = doc(`<html><body><div class="single_news"><div class="single_news_header">${headline}</div><div>${body}</div></div>
      <div class="related"><div><i class="fa fa-clock-o"></i> ${year}-01-02 10:00:00</div></div></body></html>`);
    assert.equal(extractPublishedDate(bare as unknown as Document, "https://uvurkhangai.gov.mn/157/item/1", "", headline), null);
  });

  it("reads og:article:published_time (mcud.gov.mn)", () => {
    const d = doc(`<html><head><meta property="og:article:published_time" content="${year}-03-04T08:56:12+0000"/></head><body><h1>Мэдээ гарлаа</h1></body></html>`);
    assert.equal(extractPublishedDate(d as unknown as Document, "https://mcud.gov.mn/a/1", "")?.toISOString(), `${year}-03-04T08:56:12.000Z`);
  });

  it("does not take a year-old date printed in the text as the publication date (mrpam.gov.mn)", () => {
    const text = "Эрдэс баялаг, газрын тосны газрын даргын 2009 оны 05 дугаар сарын 05-ны өдрийн тушаал. " + "Текст. ".repeat(40);
    const d = doc(`<html><body><article><h1>Тушаалын тухай</h1><p>${text}</p></article></body></html>`);
    assert.equal(extractPublishedDate(d as unknown as Document, "https://mrpam.gov.mn/article/100", text), null);
    // A recent date in the same place is still trusted.
    const recent = doc(`<html><body><article><h1>Тушаалын тухай</h1><p>${year}-01-15. ${"Текст. ".repeat(40)}</p></article></body></html>`);
    assert.equal(extractPublishedDate(recent as unknown as Document, "https://mrpam.gov.mn/article/100", `${year}-01-15. Текст.`)?.toISOString().slice(0, 10), `${year}-01-15`);
  });
});

describe("publishing undated pages", () => {
  const now = new Date(`${new Date().getUTCFullYear()}-10-24T00:00:00Z`);
  const y = now.getUTCFullYear();
  it("keeps undated news that names a current year, hides timeless and old pages", () => {
    assert.equal(publishDecision(null, `Өнөөдөр ${y} оны 10 дугаар сарын 24-нд яамны сайд ажлын хэсэг байгуулав.`, now), null);
    assert.equal(publishDecision(null, `${y - 1} онд эхэлсэн төслийн үргэлжлэл болох уулзалт боллоо.`, now), null);
    assert.equal(publishDecision(null, "Хууль эрх зүйн хэлтэс нь яамны хууль тогтоомжийн хэрэгжилтийг хангах чиг үүрэгтэй. Хэлтсийн дарга, мэргэжилтнүүд.", now), false, "department page");
    assert.equal(publishDecision(null, "Монгол Улсын Засгийн газрын 2020-2024 оны үйл ажиллагааны хөтөлбөрийн хүрээнд авто зам, төмөр зам.", now), false, "old programme");
    assert.ok(isTimelessPage("Есөн гайхамшиг: Буйр нуур, Халхын гол, Хэрлэн мөрөн.", now));
    // A target year is not the page's time: an old programme naming "2030 он хүртэл" stays hidden.
    assert.equal(publishDecision(null, "2019 онд баталсан хөтөлбөр. 2030 он хүртэл авто замыг шинэчилнэ.", now), false, "target year");
    assert.equal(newestYearMentioned(`${y} оноос ${y + 4} он хүртэл`, now), y);
  });
  it("still trusts a dated item inside the window", () => {
    assert.equal(publishDecision(new Date(now.getTime() - 3 * 86_400_000), "Текст.", now), null);
  });
});

describe("dates in page data blobs", () => {
  it("reads createdDate from __NEXT_DATA__ (mofa.gov.mn) as Ulaanbaatar time", () => {
    const y = new Date().getUTCFullYear() - 1;
    const html = `<html><body><div>text</div><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":{"id":"6ad","createdDate":"${y}-10-23T11:38:26.907","modifiedDate":"${y}-10-23T14:37:57.885","related":[{"date":"${y}-01-01T00:00:00"}]}}}}</script></body></html>`;
    assert.equal(jsonBlobDate(html)?.toISOString(), `${y}-10-23T03:38:26.907Z`);
    assert.equal(jsonBlobDate("<html><script>var x = 1;</script></html>"), null);
    assert.equal(jsonBlobDate(`<script type="application/json">{"viewCount":184,"key":"abc"}</script>`), null);
  });
});

describe("future dates, Ulaanbaatar year, title order, failing sources", () => {
  const now = new Date("2026-10-25T17:30:00Z"); // 01:30 on 26 Oct in Ulaanbaatar
  it("accepts today in Ulaanbaatar but not tomorrow or a time hours ahead", () => {
    assert.equal(isFutureDate(new Date("2026-10-26T00:00:00Z"), now), false); // UB today, day-level
    assert.equal(isFutureDate(new Date("2026-10-27T00:00:00Z"), now), true); // UB tomorrow
    assert.equal(isFutureDate(new Date("2026-10-25T18:00:00Z"), now), false); // 30 min ahead
    assert.equal(isFutureDate(new Date("2026-10-25T20:00:00Z"), now), true); // 2.5 h ahead
  });

  it("uses the Ulaanbaatar year on New Year's night", () => {
    assert.equal(ubYear(new Date("2026-12-31T18:00:00Z")), 2027);
    assert.equal(ubYear(new Date("2026-12-31T15:00:00Z")), 2026);
  });

  it("keeps the headline of a 'Site | Headline' title", () => {
    assert.equal(cleanTitle("Сангийн яам | Төсвийн тодотгол УИХ-д өргөн баригдлаа"), "Төсвийн тодотгол УИХ-д өргөн баригдлаа");
    assert.equal(cleanTitle("Төсвийн тодотгол УИХ-д өргөн баригдлаа | Сангийн яам"), "Төсвийн тодотгол УИХ-д өргөн баригдлаа");
  });

  it("calls a source failing when every article request failed", () => {
    const base = { inserted: 0, skippedDuplicates: 0, error: null, completed: true, found: 3, articleFailures: 3, lastArticleError: "HTTP 403" };
    assert.equal(sourceError(base), "every article request failed: HTTP 403");
    assert.equal(sourceError({ ...base, articleFailures: 2 }), null);
    assert.equal(sourceError({ ...base, inserted: 1 }), null);
    assert.equal(sourceError({ ...base, found: 0, articleFailures: 0 }), "listing reached but no articles were stored");
  });
});

describe("department about-pages are not news", () => {
  it("unit name + about-page opening (real Oct 2026 rows)", () => {
    assert.ok(looksLikeUnitPage("Санхүү, төрийн сангийн хэлтэс", "6\n\nТАНИЛЦУУЛГА\nЗОРИЛГО: Санхүү, төсвийн тогтвортой байдлыг хангаж"));
    assert.ok(looksLikeUnitPage("Төлөвлөлт, гүйцэтгэлийн удирдлагын хэлтэс", "2\n\nЗОРИЛГО\nМонгол Улсын тогтвортой хөгжлийн үзэл баримтлал"));
    assert.ok(looksLikeUnitPage("Хэвлэл мэдээлэл, олон нийттэй харилцах төв", "3\n\nЭРХЭМ ЗОРИЛГО\nДүүргийн засаг даргын 2020-2024 оны"));
    assert.ok(looksLikeUnitPage("Хүнс, худалдаа, үйлчилгээний хэлтэс", "5\n\nХүнс, худалдаа үйлчилгээний хэлтсийн чиг үүрэг\nХүнс, худалдаа"));
    assert.ok(looksLikeUnitPage("Үндсэн чиг үүрэг, Тэргүүлэх чиглэл", "Агентлагийн үндсэн чиг үүрэг"));
    assert.ok(looksLikeUnitPage("Радио телевизийн үйлчилгээтэй холбоотой асуулт хариулт", "Асуулт: Кабелийн телевизийн"));
    assert.ok(looksLikeUnitPage("Түгээмэл асуулт", "1. Тусгай зөвшөөрөл"));
  });

  it("news about a department stays news", () => {
    assert.ok(!looksLikeUnitPage("Хяналт, үнэлгээний үндэсний хорооны ээлжит хуралдаан боллоо", "Хорооны хуралдаанаар 2026 оны ЗОРИЛТ"));
    assert.ok(!looksLikeUnitPage("Авлигатай тэмцэх газар", "Өнөөдөр АТГ хэвлэлийн бага хурал хийж, 3 хэргийг шүүхэд шилжүүлснээ мэдэгдлээ."));
    assert.ok(!looksLikeUnitPage("Чанвон хотод төвийн явуулын үйлчилгээ үзүүлнэ", "ТАНИЛЦУУЛГА"));
    assert.ok(!looksLikeUnitPage("Сайд иргэдтэй асуулт хариултын уулзалт хийлээ", "Өнөөдөр"));
  });
});
