import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { opendataItemToScraped, parseOpendataResponse } from "@/lib/scraper/adapters/opendata";
import { parliamentArticleToScraped, parseParliamentPage } from "@/lib/scraper/adapters/parliament";
import { classifyDomain, harvestGovernmentHosts, isGovernmentHost, siteName } from "@/lib/scraper/discover";
import { findFeedUrl, harvestArticleLinks, harvestSectionLinks, isStaticPageUrl, isWordPress, parseFeed, sameSite, scoreLink, wordPressApiBase, wordPressPostsUrl, wordPressPostUrl, wordPressPostId } from "@/lib/scraper/links";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("harvestArticleLinks", () => {
  it("finds article links on the real mlsp.gov.mn listing page", () => {
    const links = harvestArticleLinks(fixture("mlsp-listing.html"), "https://mlsp.gov.mn/content?c=1", "mlsp.gov.mn");
    assert.ok(links.length >= 5, `found ${links.length}`);
    assert.ok(links.every((l) => l.url.startsWith("https://mlsp.gov.mn/")));
    assert.ok(links.slice(0, 5).every((l) => /\/content\/detail\/\d+/.test(l.url)), JSON.stringify(links.slice(0, 5)));
  });

  it("ignores menus, files, categories and off-site links", () => {
    const html = `<html><body>
      <nav><a href="/news/123">Цэс дэх мэдээ гарчиг урт</a></nav>
      <ul class="sub-menu"><a href="/about-us/structure-of-ministry">Бүтэц зохион байгуулалт</a></ul>
      <div class="has-menu-wrapper"><main>
        <a href="/news/7642">Эрүүл мэндийн салбарын хүний нөөцийг хөгжүүлэх нь чухал</a>
        <a href="/14533.html">Төрийн өмчит үйлдвэрийн газруудыг цомхотголоо</a>
        <a href="/files/report.pdf">Тайлан татах</a>
        <a href="/c/news/onclokh">онцлох мэдээ</a>
        <a href="https://facebook.com/news/1">Facebook</a>
      </main></div></body></html>`;
    const urls = harvestArticleLinks(html, "https://moh.gov.mn/home", "moh.gov.mn").map((l) => l.url);
    assert.deepEqual(urls.sort(), ["https://moh.gov.mn/14533.html", "https://moh.gov.mn/news/7642"]);
  });

  it("scores WordPress permalinks and long Cyrillic headlines highly", () => {
    const u = new URL("https://www.mimr.gov.mn/2026/10/19/slug/");
    assert.ok(scoreLink(u, "Салбарын эрх зүйн шинэчлэлийг эрчимжүүлэх үүрэг өглөө") >= 7);
    assert.equal(scoreLink(new URL("https://x.gov.mn/wp-content/uploads/a.jpg"), "x"), 0);
  });

  it("counts /posts/<id> as an article but keeps the bare /posts listing and /p/<id> pages out", () => {
    assert.ok(scoreLink(new URL("https://mecc.gov.mn/posts/1234"), "Байгаль орчны шинэ журам батлагдлаа") > 0);
    assert.equal(scoreLink(new URL("https://mecc.gov.mn/posts"), "Мэдээ мэдээлэл бүгд"), 0);
    assert.equal(scoreLink(new URL("https://mecc.gov.mn/posts/?page=2"), "Дараах"), 0);
    assert.equal(scoreLink(new URL("https://x.gov.mn/p/23"), "Бүтэц зохион байгуулалт"), 0);
  });

  it("treats www and subdomains as the same site, never the parent domain", () => {
    assert.ok(sameSite("www.mimr.gov.mn", "mimr.gov.mn"));
    assert.ok(sameSite("www.gov.mn", "gov.mn"));
    assert.ok(!sameSite("mof.gov.mn", "moh.gov.mn"));
    assert.ok(!sameSite("gov.mn", "moh.gov.mn"), "a link to the parent portal is another site");
  });

  it("keeps articles whose id lives in the query string (mod.gov.mn /?p=, ipom mn.php?page=&news=)", () => {
    const html = `<html><body><main>
      <a href="/?p=10849">Батлан хамгаалахын сайд ажлын хэсгийн тайланг хүлээн авлаа</a>
      <a href="/mn.php?page=40&news=1633">Оюуны өмчийн газар шинэ журам баталлаа</a>
      <a href="/mn.php?page=40">Мэдээ</a>
      <a href="/?page=2">2</a>
    </main></body></html>`;
    const urls = harvestArticleLinks(html, "https://mod.gov.mn/", "mod.gov.mn").map((l) => l.url);
    assert.deepEqual(urls.sort(), ["https://mod.gov.mn/?p=10849", "https://mod.gov.mn/mn.php?page=40&news=1633"]);
  });

  it("skips static pages: /p/23 departments, /home, instructions, page.aspx", () => {
    const html = `<main>
      <a href="/p/23">Хууль эрх зүйн хэлтсийн танилцуулга ба чиг үүрэг</a>
      <a href="/home">Нүүр хуудас руу буцах холбоос энд</a>
      <a href="/website/page.aspx?mm_id=30&id=42">Хүний нөөцийн ил тод байдлын мэдээлэл</a>
      <a href="/instructions">Тусгай зөвшөөрлийн цахим систем ашиглах заавар</a>
      <a href="/n/3380">Төрийн албан хаагчдын гүйцэтгэлийн тайланг хэлэлцлээ</a></main>`;
    assert.deepEqual(harvestArticleLinks(html, "https://dornod.gov.mn/", "dornod.gov.mn").map((l) => l.url), ["https://dornod.gov.mn/n/3380"]);
  });

  it("harvests links on any element with an href (JavaScript-rendered cards)", () => {
    const html = `<div data-x><area href="/news/4411" alt="Орон нутгийн төсвийн хэлэлцүүлэг амжилттай боллоо"></area>
      <link rel="stylesheet" href="/news/1"><a href="/news/4412">Эрүүл мэндийн даатгалын шинэ журам хэрэгжиж эхэллээ</a></div>`;
    const urls = harvestArticleLinks(html, "https://x.gov.mn/", "x.gov.mn").map((l) => l.url);
    assert.deepEqual(urls.sort(), ["https://x.gov.mn/news/4411", "https://x.gov.mn/news/4412"]);
  });
});

describe("splash pages and WordPress REST bases", () => {
  it("finds the news sections a splash page links to (govi-altai /home, dornod /j)", () => {
    const html = `<html><body>
      <a href="/home">Нүүр</a><a href="/c/medee-medeelel-210">Мэдээ мэдээлэл</a>
      <a href="/j">Мэдээ</a><a href="/about">Бидний тухай</a><a href="https://gov.mn/">Засгийн газар</a>
      <a href="/files/a.pdf">Мэдээ (pdf)</a></body></html>`;
    const sections = harvestSectionLinks(html, "https://govi-altai.gov.mn/", "govi-altai.gov.mn");
    assert.deepEqual(sections, ["https://govi-altai.gov.mn/c/medee-medeelel-210", "https://govi-altai.gov.mn/j", "https://govi-altai.gov.mn/home"]);
  });

  it("reads the advertised REST base and builds a posts URL for plain permalinks", () => {
    const pretty = `<link rel="https://api.w.org/" href="https://mod.gov.mn/wp-json/">`;
    assert.equal(wordPressApiBase(pretty, "https://mod.gov.mn/"), "https://mod.gov.mn/wp-json/");
    const plain = `<link rel="https://api.w.org/" href="https://bnd.ub.gov.mn/index.php?rest_route=/">`;
    const base = wordPressApiBase(plain, "https://bnd.ub.gov.mn/");
    assert.equal(wordPressPostsUrl(base, "per_page=20&_fields=id,link"), "https://bnd.ub.gov.mn/index.php?rest_route=/wp/v2/posts&per_page=20&_fields=id,link");
    assert.equal(wordPressPostsUrl(wordPressApiBase("<html></html>", "https://x.gov.mn/news/"), "per_page=5"), "https://x.gov.mn/wp-json/wp/v2/posts?per_page=5");
  });

  it("resolves a REST post's URL: absolute link, relative link (conscourt.gov.mn) or ?p=<id> (bnd.ub.gov.mn)", () => {
    assert.equal(wordPressPostUrl({ id: 1, link: "https://mod.gov.mn/?p=10849" }, "https://mod.gov.mn"), "https://mod.gov.mn/?p=10849");
    assert.equal(wordPressPostUrl({ id: 11597, link: "index.php/?p=11597" }, "https://conscourt.gov.mn"), "https://conscourt.gov.mn/index.php/?p=11597");
    assert.equal(wordPressPostUrl({ id: 10099 }, "https://bnd.ub.gov.mn"), "https://bnd.ub.gov.mn/?p=10099");
    assert.equal(wordPressPostUrl({}, "https://x.gov.mn"), undefined);
  });
});

describe("feeds and WordPress detection", () => {
  it("detects WordPress and feed links", () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" type="application/rss+xml" href="/comments/feed/"><script src="/wp-includes/js/x.js"></script>`;
    assert.ok(isWordPress(html));
    assert.equal(findFeedUrl(html, "https://cabinet.gov.mn/"), "https://cabinet.gov.mn/feed/");
  });

  it("parses RSS and Atom", () => {
    const rss = `<rss><channel><item><title>Мэдээ</title><link>https://a.gov.mn/n/1</link><pubDate>Mon, 19 Oct 2026 08:00:00 +0800</pubDate></item></channel></rss>`;
    const atom = `<feed><entry><title>B</title><link href="https://a.gov.mn/n/2"/><published>2026-10-18T00:00:00Z</published></entry></feed>`;
    assert.deepEqual(parseFeed(rss).map((i) => i.url), ["https://a.gov.mn/n/1"]);
    assert.equal(parseFeed(rss)[0].publishedAt?.toISOString(), "2026-10-19T00:00:00.000Z");
    assert.deepEqual(parseFeed(atom).map((i) => i.url), ["https://a.gov.mn/n/2"]);
  });
});

describe("JSON API adapters (real responses)", () => {
  it("maps opendata.gov.mn datasets to articles", () => {
    const items = parseOpendataResponse(JSON.parse(fixture("opendata-search.json")));
    assert.equal(items.length, 3);
    const a = opendataItemToScraped(items[0]);
    assert.match(a.url, /^https:\/\/opendata\.gov\.mn\/dataview\/\d+$/);
    assert.match(a.text, /Эзэмшигч байгууллага: /);
    assert.ok(a.meta?.dataset_org);
    assert.ok(a.publishedAt instanceof Date);
  });

  it("maps parliament.mn API articles with full text", () => {
    const items = parseParliamentPage(JSON.parse(fixture("parliament-articles.json")));
    assert.ok(items.length >= 1);
    const a = parliamentArticleToScraped(items[0]);
    assert.ok(a);
    assert.match(a.url, /^https:\/\/parliament\.mn\/parliament-news\/detail\//);
    assert.ok(a.text.length > 200);
    assert.ok(!/<p|&nbsp;/.test(a.text), "HTML stripped");
  });
});

describe("source discovery", () => {
  it("harvests government hosts and drops infrastructure subdomains", () => {
    const html = `<a href="https://www.mof.gov.mn/">Сангийн яам</a>
      <a href="https://photo.burtgel.gov.mn/x">photo</a>
      <a href="https://cdn.gov.mn/a.js">cdn</a>
      <a href="https://sant.selenge.khural.mn/">Сант сум</a>
      <a href="https://example.com/">other</a>
      footer: https://arkhangai.gov.mn`;
    assert.deepEqual(harvestGovernmentHosts(html, "https://www.gov.mn/").sort(), [
      "arkhangai.gov.mn",
      "mof.gov.mn",
      "sant.selenge.khural.mn",
    ]);
    assert.ok(isGovernmentHost("www.gov.mn"));
    assert.ok(!isGovernmentHost("news.mn"));
  });

  it("classifies local governments and reads site names", () => {
    assert.equal(classifyDomain("selenge.gov.mn"), "local");
    assert.equal(classifyDomain("nad.ub.gov.mn"), "local");
    assert.equal(classifyDomain("sant.selenge.khural.mn"), "local");
    assert.equal(classifyDomain("masm.gov.mn"), "agency");
    assert.equal(siteName("<title>Нүүр хуудас | ТТХГ</title>", "x"), "ТТХГ");
    assert.equal(siteName("<title>Index of /</title>", "dundgovi.gov.mn"), "dundgovi.gov.mn");
  });
});

describe("static CMS pages", () => {
  it("recognises /page/<slug>, /pages/<id> and /p/<id> but not articles under /home or /news", () => {
    assert.ok(isStaticPageUrl("https://mrpam.gov.mn/page/statistik-medee-2026-on"));
    assert.ok(isStaticPageUrl("https://khovd.gov.mn/pages/ce0e70b0-9e28-48a9-a381-e276a2d98aec"));
    assert.ok(isStaticPageUrl("https://mrt.gov.mn/p/70"));
    assert.ok(!isStaticPageUrl("https://culture.gov.mn/index.php/home/nv/media/news/504"));
    assert.ok(!isStaticPageUrl("https://dornogovi.gov.mn/home/385"));
    assert.ok(!isStaticPageUrl("https://mcud.gov.mn/a/1759"));
    assert.ok(!isStaticPageUrl("not a url"));
  });
});

describe("wordPressPostId (re-check reads WordPress posts through the REST API)", () => {
  it("reads the shortlink or the body class", () => {
    assert.equal(wordPressPostId(`<link rel='shortlink' href='https://mod.gov.mn/?p=12345' />`), 12345);
    assert.equal(wordPressPostId(`<link href="https://x.mn/?p=77" rel="shortlink">`), 77);
    assert.equal(wordPressPostId(`<body class="post-template-default single postid-901 x">`), 901);
    assert.equal(wordPressPostId(`<html><body class="home"></body></html>`), null);
  });
});
