/**
 * "Мэдээлэл хүсэх" (/request): a request letter under the Law on Public Information Transparency
 * (Нийтийн мэдээллийн ил тод байдлын тухай хууль, 2021-12-17, in force 2022-05-01). Client-only:
 * nothing the reader types leaves the browser, the reader sends the letter themselves.
 *
 * The clauses quoted, read from the law's Mongolian text (Nov 2026):
 * - 13.4: a written request names the requester, their address or mailing address and phone, and
 *   the information wanted and the form to receive it in;
 * - 14.1.2: open information is requested without giving a purpose or reason;
 * - 15.6: what can be given at once is given at once, the rest within 5 working days;
 * - 15.7: an authorised official may extend that by up to 10 working days;
 * - 16.3: electronic delivery is, as a rule, free;
 * - 14.1.6 / 14.2: a refusal can be appealed to the higher body or official (else a court), and to
 *   the National Human Rights Commission.
 * Globe International's 2025 test: 16 of 59 requests were answered in full (`/request` says so).
 */

export const LAW_NAME = "Нийтийн мэдээллийн ил тод байдлын тухай хууль";
/** The genitive, as the letter cites it ("…тухай хуулийн 13 дугаар зүйл"). */
const LAW_OF = "Нийтийн мэдээллийн ил тод байдлын тухай хуулийн";
export const LAW_URL = "https://legalinfo.mn/mn/detail?lawId=16390263044601";
/** 15.6 and 15.7. */
export const ANSWER_DAYS = 5;
export const EXTENSION_DAYS = 10;

export type DeliveryForm = "electronic" | "paper" | "visit";

export const DELIVERY_LABEL: Record<DeliveryForm, string> = {
  electronic: "цахим хэлбэрээр (цахим шуудангаар)",
  paper: "цаасан хэлбэрээр",
  visit: "биечлэн танилцах замаар",
};

export interface RequestInput {
  /** The body asked ("Сангийн яам"). */
  org: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  /** What is asked for, in the reader's words. */
  question: string;
  form: DeliveryForm;
  /** yyyy-mm-dd, Ulaanbaatar day the letter is dated. */
  date: string;
}

const clean = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();

/** What 13.4 requires before the letter is complete; empty when nothing is missing. */
export function missingFields(r: RequestInput): string[] {
  const out: string[] = [];
  if (!clean(r.org)) out.push("байгууллагын нэр");
  if (!clean(r.name)) out.push("таны нэр");
  if (!clean(r.address) && !clean(r.email)) out.push("хаяг эсвэл цахим шуудан");
  if (!clean(r.phone)) out.push("утасны дугаар");
  if (clean(r.question).length < 10) out.push("хүсэх мэдээлэл");
  if (r.form === "electronic" && !clean(r.email)) out.push("цахим шуудан (цахимаар авах бол)");
  return out;
}

/** "2026-11-06" → "2026 оны 11 дүгээр сарын 06" */
export function letterDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${y} оны ${Number(m)} дүгээр сарын ${d}`;
}

/** The letter text, ready to print or paste into an e-mail. */
export function buildLetter(r: RequestInput): string {
  const org = clean(r.org) || "[байгууллагын нэр]";
  const question = clean(r.question) || "[хүсэх мэдээлэл]";
  const contact = [
    `Хүсэлт гаргагч: ${clean(r.name) || "[нэр]"}`,
    clean(r.address) && `Хаяг: ${clean(r.address)}`,
    `Утас: ${clean(r.phone) || "[утас]"}`,
    clean(r.email) && `Цахим шуудан: ${clean(r.email)}`,
  ].filter(Boolean);
  return [
    `${org}-д`,
    "",
    "МЭДЭЭЛЭЛ ХҮСЭХ ТУХАЙ",
    "",
    `${LAW_OF} 13 дугаар зүйлд заасны дагуу дараах мэдээллийг хүсэж байна:`,
    "",
    question,
    "",
    `Мэдээллийг ${DELIVERY_LABEL[r.form]} авахыг хүсье.`,
    "",
    `Тус хуулийн 15 дугаар зүйлийн 15.6-д заасны дагуу шууд өгөх боломжтой мэдээллийг шууд, бусдыг нь ажлын ${ANSWER_DAYS} өдрийн дотор өгнө үү. Хуулийн 14.1.2-т зааснаар нээлттэй мэдээлэл авахад зорилго, шалтгаанаа тайлбарлах шаардлагагүй.`,
    "",
    ...contact,
    `Огноо: ${letterDate(r.date)}`,
    "Гарын үсэг: ____________",
  ].join("\n");
}

/** The day `n` working days after `day` (Saturdays and Sundays skipped; public holidays are not). */
export function addWorkingDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
