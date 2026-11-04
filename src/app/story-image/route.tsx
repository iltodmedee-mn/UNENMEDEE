import { formatDateMn } from "@/lib/format";
import { STORY_PAGE_PATHS } from "@/lib/story-pages";
import { storyImage } from "@/lib/og";
import { getArticleBySlug, getPolitician } from "@/lib/queries";
import { canonicalImageQuery } from "@/lib/site";
import { digestWindowsLabel } from "@/lib/edition";

/**
 * Story image for a page of this site (GET /story-image?p=/article/<slug>). Text comes from our
 * own data, never from the query string, so the endpoint cannot print arbitrary words under
 * the site's name.
 */
// Keyed by STORY_PAGE_PATHS so the share menu offers "Story" exactly where an image exists.
const PAGES: Record<(typeof STORY_PAGE_PATHS)[number], { eyebrow: string; title: string; footer: string }> = {
  "/": { eyebrow: "Шинэ мэдээ", title: "Төрийн шинэ мэдээ: баримтыг пи-араас салгасан", footer: "Цаг тутам шинэчлэгдэнэ" },
  "/budget": { eyebrow: "Улсын төсөв", title: "Татварын мөнгө хаашаа явдаг вэ? 1990 оноос хойшхи улсын төсөв", footer: "ҮСХ, Сангийн яамны албан тоо" },
  "/tax": { eyebrow: "Миний татвар", title: "Таны төлсөн татвар юунд зарцуулагддаг вэ? 1 минутад тооцоол", footer: "Улсын төсвийн албан тоогоор" },
  "/laws": { eyebrow: "Хууль, тогтоол", title: "Юу шинээр батлагдав? Шинэ хууль, тогтоол товчоор", footer: "legalinfo.mn-ээс" },
  "/officials/companies": { eyebrow: "Төрийн өмч", title: "Төрийн өмчит компаниудын орлого, ашиг, цалингийн сан", footer: "Шилэн дансны тайлангаар" },
  "/officials": { eyebrow: "Улстөрчдийн хөрөнгө", title: "УИХ-ын 126 гишүүний хөрөнгө, орлогын мэдүүлэг", footer: "Авлигатай тэмцэх газрын ХАСХОМ" },
  "/digest": { eyebrow: "Онцлох тойм", title: "Өнөөдрийн хамгийн чухал 10 мэдээ, 5 минутад", footer: `Өдөрт 2 удаа: ${digestWindowsLabel()}` },
};

async function contentFor(path: string) {
  if (path in PAGES) return PAGES[path as keyof typeof PAGES];
  const article = path.match(/^\/article\/([\w-]{1,200})$/);
  if (article) {
    const a = await getArticleBySlug(article[1]);
    return a && { eyebrow: a.sourceName, title: a.title, footer: a.scrapeMeta?.date_unknown ? "Огноо тодорхойгүй" : formatDateMn(a.publishedAt) };
  }
  const official = path.match(/^\/officials\/(\d{1,6})$/);
  if (official) {
    const d = await getPolitician(Number(official[1]));
    return d && { eyebrow: "Улстөрчдийн хөрөнгө", title: `${d.politician.fullName}: хөрөнгө, орлогын мэдүүлэг`, footer: d.politician.party ?? "УИХ-ын гишүүн" };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonical = canonicalImageQuery(url, ["p"]);
  if (canonical) return Response.redirect(new URL(canonical, url), 308);
  const path = url.searchParams.get("p") ?? "";
  const content = await contentFor(path);
  if (!content) return new Response("Not found", { status: 404 });
  const res = await storyImage(content);
  res.headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
  return res;
}
