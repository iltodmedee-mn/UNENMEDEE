/**
 * The /tax calculator's rates (`PIT_SCHEDULES`, `SI_RATE` in receipt.ts) are typed by hand from the
 * law and never change on their own: an AI reading a new law into a tax table could show readers a
 * wrong tax. So the watchdog (scripts/health-check.ts) only *notices*: a published story after the
 * day the rates were last checked (`RATES_CHECKED`) whose headline names the personal income tax
 * (ХХОАТ) or the social insurance contribution (НДШ) together with a change to a law, a rate, a
 * scale or a relief opens a GitHub issue with the links (GitHub e-mails the owner). Moving
 * `RATES_CHECKED` past those stories closes it. Over-reporting is fine (a person reads it);
 * refund dates, debt collection and filing reminders are left out.
 */

/** The two levies the calculator models, as headlines name them. */
const TAX_TERM = /хувь хүний орлогын албан татвар|(?<!\p{L})ххоат|шимтгэл|(?<!\p{L})ндш|нийгмийн даатгалын тухай хуул|татварын багц хуул|татварын ерөнхий хуул/iu;
/** What changed: a law, a resolution, the rate, the scale, a relief or threshold. */
const SUBJECT = /хуул|тогтоол|шатлал|хэмжээ|хувийг|хувиар|хувь\s+\d|хөнгөлөлт|хөнгөл|чөлөөл|босго|хасалт|төлөхгүй/iu;
/** That it changed or is being changed. */
const ACT = /батал|баталл|өөрчил|өөрчлөлт|өөрчлөх|нэмэлт|бууруул|буур|нэмэгд|шинэчил|мөрдө|хэлэлц|өргөн бари|төсөл|хүчин төгөлдөр|хэрэгжи|оруул|шийдл|болно/iu;
/** A levy that goes down or up, or is waived: a change on its own ("шимтгэл … буурлаа"). */
const DIRECTION = /буур|бууруул|нэмэгд|хөнгөл|чөлөөл|төлөхгүй/iu;
/** Not a rate change: refunds, debts, filing and payment reminders, trainings. */
const NOT_RATE = /буцаан олго|(?<!\p{L})өр(?!\p{L})|өрийг|өрөө|авлага|барагдуул|тайлан|сургалт|цахимаар төлө/iu;

/** A headline that may mean the /tax rates changed. */
export function isTaxRateNews(title: string): boolean {
  const t = title.replace(/\s+/g, " ");
  return TAX_TERM.test(t) && !NOT_RATE.test(t) && (DIRECTION.test(t) || (SUBJECT.test(t) && ACT.test(t)));
}

export interface TaxRateNews {
  id: number;
  slug: string;
  title: string;
  /** Ulaanbaatar day, "2026-11-07". */
  day: string;
  /** The source page (the law on legalinfo.mn, the ministry's post). */
  url: string;
}

/** The first day after RATES_CHECKED, as the instant the watch starts (Ulaanbaatar midnight). */
export function watchFrom(ratesChecked: string): Date {
  return new Date(new Date(`${ratesChecked}T00:00:00+08:00`).getTime() + 86_400_000);
}

/**
 * The GitHub issue's text. The first line lists the story ids, so the workflow can tell a new
 * story from the same list and comment only then.
 */
export function taxRateIssueBody(items: TaxRateNews[], ratesChecked: string, site: string): string {
  return [
    `<!-- tax-watch: ${items.map((x) => x.id).join(",")} -->`,
    `Татвар эсвэл нийгмийн даатгалын шимтгэлийн хуульд өөрчлөлт орсон байж магадгүй. /tax тооцоолуурын хувь хэмжээг хамгийн сүүлд **${ratesChecked}**-нд шалгасан (\`src/lib/tax/receipt.ts\` \`RATES_CHECKED\`).`,
    "",
    "**Шалгах мэдээ:**",
    ...items.map((x) => `- ${x.day} · [${x.title.replace(/[[\]]/g, "")}](${site}/article/${x.slug}) · [эх сурвалж](${x.url})`),
    "",
    "**Юу хийх вэ:**",
    "1. Мэдээ, эх хуулийг уншаад ХХОАТ-ын шатлал, хөнгөлөлт эсвэл НДШ-ийн хувь (одоо 11.5%) өөрчлөгдсөн эсэх, хэзээнээс мөрдөхийг шалга.",
    "2. Өөрчлөгдсөн бол `src/lib/tax/receipt.ts`-д шинэ шатлалыг (`PIT_SCHEDULES`) эсвэл `SI_RATE`-ийг мөрдөх огноотой нь нэм, эх сурвалжийг `PIT_SOURCES`-д бич.",
    "3. Өөрчлөгдсөн ч, өөрчлөгдөөгүй ч `RATES_CHECKED`-ийг дээрх хамгийн сүүлийн мэдээний огноогоор шинэчил. Дараагийн шалгалтаар энэ issue өөрөө хаагдана.",
    "",
    "Кодыг issue дээр `@gemini …` гэж бичээд, эсвэл Claude-оор засуулж болно (docs/RUNBOOK.md §5).",
  ].join("\n");
}
