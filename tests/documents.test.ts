import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { docKind, documentLinks, isWatchedTitle, parseAuditRegister, parseWpPages, wpUrl } from "@/lib/documents/watch";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("documents: audit.mn register", () => {
  // Real first rows of https://audit.mn/audit (Nov 2026).
  const rows = parseAuditRegister(fixture("audit-register.html"));

  it("reads id, title, office and audit type per report", () => {
    assert.ok(rows.length >= 5);
    const r = rows.find((x) => x.id === "45034");
    assert.ok(r);
    assert.match(r.title, /Шинэ хоршоо хөдөлгөөн/);
    assert.equal(r.office, "Өвөрхангай аймаг дахь Төрийн аудитын газар");
    assert.equal(r.auditType, "Гүйцэтгэлийн аудит");
    assert.equal(r.url, "https://audit.mn/audit/report_detail/45034");
  });

  it("a title in capitals is stored in sentence case", () => {
    const r = rows.find((x) => x.id === "39563");
    assert.ok(r && !/^ГОВЬСҮМБЭР АЙМАГ/.test(r.title), r?.title);
  });

  it("an empty or changed page reads as no rows (the script then fails loudly)", () => {
    assert.deepEqual(parseAuditRegister("<html><body><p>Засвартай</p></body></html>"), []);
  });
});

describe("documents: WordPress report pages", () => {
  const fx = JSON.parse(fixture("wp-report-page.json")) as { pages: unknown[]; content: string; link: string };

  it("keeps only watched titles, decodes entities, keeps the link on the site", () => {
    const pages = parseWpPages(fx.pages, "mimr.gov.mn");
    assert.deepEqual(
      pages.map((p) => p.title),
      ["Тендерийн урилга", "Санхүүгийн тайлан – 2026"],
    );
    assert.equal(pages[0].modified, "2026-08-13T16:46:13");
    // A `link` on another host is publisher data we do not follow.
    assert.equal(pages[1].link, "https://mimr.gov.mn/?page_id=9001");
  });

  it("finds file links and names them from their table row, not 'ТАТАХ'", () => {
    const links = documentLinks(fx.content, fx.link);
    assert.ok(links.length >= 2);
    assert.match(links[0].url, /^https:\/\/www\.mimr\.gov\.mn\/wp-content\/uploads\/2026\/08\//);
    assert.equal(links[0].fileType, "pdf");
    assert.match(links[0].title, /^Ионжуулагч цацрагаас хамгаалах/);
    // The row number cell is not glued to the title ("2Цацрагийн").
    assert.ok(links.every((l) => !/^\d/.test(l.title)), links.map((l) => l.title).join(" | "));
    assert.ok(!links.some((l) => /^ТАТАХ$/i.test(l.title)));
  });

  it("files only: pages, mail and scripts are not documents; duplicates and fragments collapse", () => {
    const html = `
      <a href="/news/1">Мэдээ</a>
      <a href="mailto:a@b.mn">Имэйл</a>
      <a href="javascript:alert(1)">x.pdf</a>
      <a href="/files/tailan-2026.pdf#page=2">2026 оны тайлан</a>
      <a href="/files/tailan-2026.pdf">2026 оны тайлан</a>
      <a href="https://drive.google.com/file/d/abc/view">Төсвийн гүйцэтгэл</a>
      <a href="/doc/plan.DOCX">План</a>`;
    const links = documentLinks(html, "https://pcsp.gov.mn/report/");
    assert.deepEqual(
      links.map((l) => [l.url, l.fileType]),
      [
        ["https://pcsp.gov.mn/files/tailan-2026.pdf", "pdf"],
        ["https://drive.google.com/file/d/abc/view", null],
        ["https://pcsp.gov.mn/doc/plan.DOCX", "docx"],
      ],
    );
  });

  it("titles and kinds", () => {
    assert.equal(isWatchedTitle("Төсөв, санхүү, худалдан авах ажиллагааны ил тод байдал"), true);
    assert.equal(isWatchedTitle("Бидний тухай"), false);
    assert.equal(docKind("Тендерийн урилга"), "tender");
    assert.equal(docKind("Худалдан авах ажиллагааны тайлан"), "tender");
    assert.equal(docKind("Дотоод аудитын тайлан"), "audit");
    assert.equal(docKind("Төлөвлөгөө, биелэлт, тайлан"), "report");
  });

  it("REST routes on both kinds of base", () => {
    assert.equal(wpUrl("https://www.mimr.gov.mn/wp-json/", "wp/v2/pages/8217", "_fields=content"), "https://www.mimr.gov.mn/wp-json/wp/v2/pages/8217?_fields=content");
    assert.equal(wpUrl("https://mod.gov.mn/index.php?rest_route=/", "wp/v2/pages", "per_page=100"), "https://mod.gov.mn/index.php?rest_route=/wp/v2/pages&per_page=100");
  });
});
