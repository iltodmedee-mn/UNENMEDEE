"use server";

import { eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db";
import { appSettings, articles, donations, sources, transparencyLedger } from "@/db/schema";
import { analyzeArticle, formatDeepAnalysis, processArticle } from "@/lib/ai/analyze";
import type { ArticleForAI } from "@/lib/ai/prompts";
import { AIUnavailableError } from "@/lib/ai/router";
import { dbBudgetGuard, dbUsageLogger, syncLedgerAiCost } from "@/lib/ai/usage-log";
import { requireAdmin } from "@/lib/admin-auth";
import { errorLine } from "@/lib/log-safe";
import { ACCOUNT_PATTERN, DONATION_KEY, normalizeAccount } from "@/lib/donation";
import { cleanLine, NAME_MODES, type NameMode, NOTE_MAX, parseAmount, publicDonor, validDay } from "@/lib/donations";
import { ubDateKey } from "@/lib/archive";
import { formatNumber } from "@/lib/format";
import { ABOUT_FIELDS, ABOUT_KEY, cleanAboutText } from "@/lib/about";
import { HIDDEN_YEARS_KEY, hiddenYearsFromText } from "@/lib/officials/hidden";
import { extractArticleSafe } from "@/lib/scraper/extract-safe";
import { readTextLimited } from "@/lib/scraper/http";
import { fetchPublicUrl } from "@/lib/scraper/public-url";
import { writeSnapshots } from "@/lib/snapshot-writer";
import { contentHash, normalizeText, slugify, truncate } from "@/lib/text";

const MAX_STORED_CHARS = 15_000;

async function refreshPublic(slug?: string) {
  // The list pages read snapshots (docs/adr/0001-list-pages-read-snapshots.md): rebuild them now,
  // or a story taken down here stays on the home page until the next pipeline run.
  try {
    for (const tag of await writeSnapshots()) updateTag(tag);
  } catch (err) {
    console.error("[admin] snapshots not rebuilt:", err instanceof Error ? err.message : err);
  }
  updateTag("articles");
  updateTag("clusters");
  updateTag("ai");
  // An unpublished or edited article also appears in MP profiles (mentions) and digest editions.
  updateTag("officials");
  updateTag("digests");
  if (slug) updateTag(`article-${slug}`);
}

/* ------------------------------------------------------------------ articles */

export async function togglePublish(formData: FormData) {
  await requireAdmin();
  const id = z.coerce.number().int().positive().parse(formData.get("id"));
  const db = getDb();
  const [row] = await db.select({ isPublished: articles.isPublished, slug: articles.slug }).from(articles).where(eq(articles.id, id));
  if (!row) return;
  await db.update(articles).set({ isPublished: !row.isPublished }).where(eq(articles.id, id));
  await refreshPublic(row.slug);
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Runs a settings write and turns a thrown database error into the form's own message. A save
 * that failed on the database used to land on the public error page with nothing to act on
 * (admin only, so the message is shown in full; the server log has the detail).
 */
async function stored(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[admin] action failed: ${errorLine(err, 600)}`);
    return { ok: false, message: `Хадгалж чадсангүй: ${errorLine(err, 300)}` };
  }
}

/** Re-runs the pipeline for one article; `deep` forces the Grok tier. */
export async function reanalyze(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = z.coerce.number().int().positive().parse(formData.get("id"));
  const deep = formData.get("deep") === "1";
  const db = getDb();
  try {
    const res = await processArticle(db, id, { log: dbUsageLogger(db), budget: dbBudgetGuard(db), forceDeep: deep, purpose: "admin" });
    await syncLedgerAiCost(db);
    const [row] = await db.select({ slug: articles.slug }).from(articles).where(eq(articles.id, id));
    await refreshPublic(row?.slug);
    const deepNote = res.tier2 ? ` · Гүнзгий: ${res.tier2Provider}` : res.tier2Error ? ` · Гүнзгий шинжилгээ хийгдсэнгүй (${res.tier2Error.slice(0, 120)})` : "";
    return { ok: true, message: `Эрсдэл ${res.tier1.risk_score}/100 · ${res.tier1Provider}${deepNote} · $${res.costUsd.toFixed(5)}` };
  } catch (err) {
    const msg = err instanceof AIUnavailableError ? `${err.message}: ${err.attempts.join(" | ")}` : err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg.slice(0, 400) };
  }
}

const ArticleEdit = z.object({
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(5).max(500),
  tldr: z.string().trim().max(2_000),
  content: z.string().trim().min(50).max(MAX_STORED_CHARS * 2),
  published: z.enum(["on"]).optional(),
  /** Drop the AI's plain headline and "Танд хамаатай юу?" so the edited title and summary are what readers see. */
  clearReader: z.enum(["on"]).optional(),
});

export async function saveArticle(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = ArticleEdit.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const { id, title, tldr, content, published, clearReader } = parsed.data;
  const db = getDb();
  const [current] = await db
    .select({ title: articles.title, cleanContent: articles.cleanContent, slug: articles.slug, readerTitle: articles.readerTitle })
    .from(articles)
    .where(eq(articles.id, id));
  if (!current) return { ok: false, message: "Нийтлэл олдсонгүй." };
  const newContent = truncate(normalizeText(content), MAX_STORED_CHARS);
  // Readers see coalesce(reader_title, title): a corrected title would otherwise stay hidden under
  // the AI's plain headline (and show only as "Эх гарчиг"). A changed title drops it.
  const dropReaderTitle = clearReader === "on" || (title !== current.title && current.readerTitle !== null);
  await db
    .update(articles)
    .set({
      title,
      tldrSummary: tldr || null,
      cleanContent: newContent,
      isPublished: published === "on",
      ...(dropReaderTitle ? { readerTitle: null } : {}),
      ...(clearReader === "on" ? { readerImpact: null } : {}),
      // content_hash keeps proving the original scrape; mark the edit openly instead.
      ...(newContent !== current.cleanContent ? { editedAt: new Date() } : {}),
    })
    .where(eq(articles.id, id));
  await refreshPublic(current.slug);
  return { ok: true, message: dropReaderTitle ? "Хадгаллаа. AI-ийн энгийн гарчгийг хасав: уншигчид таны гарчгийг харна." : "Хадгаллаа." };
}

/* ------------------------------------------------------------------ ledger */

/** An empty income field = not entered (null, "бүртгээгүй" on /transparency), never $0. */
const optionalUsd = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), z.coerce.number().min(0).max(1e7).nullable());

const Ledger = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  infraCostUsd: z.coerce.number().min(0).max(1e6),
  adRevenueUsd: optionalUsd,
  donationsUsd: optionalUsd,
  notes: z.string().max(500).optional(),
});

export async function saveLedger(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  return stored(async () => {
    const parsed = Ledger.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: "Утгууд буруу байна (сар: YYYY-MM, дүн: 0 ба түүнээс их)." };
    const v = parsed.data;
    const db = getDb();
    await db
      .insert(transparencyLedger)
      .values({ month: v.month, infraCostUsd: v.infraCostUsd.toFixed(2), adRevenueUsd: v.adRevenueUsd?.toFixed(2) ?? null, donationsUsd: v.donationsUsd?.toFixed(2) ?? null, notes: v.notes || null })
      .onConflictDoUpdate({
        target: transparencyLedger.month,
        set: { infraCostUsd: v.infraCostUsd.toFixed(2), adRevenueUsd: v.adRevenueUsd?.toFixed(2) ?? null, donationsUsd: v.donationsUsd?.toFixed(2) ?? null, notes: v.notes || null },
      });
    await syncLedgerAiCost(db, v.month);
    updateTag("ledger");
    return { ok: true, message: `${v.month} сарын бүртгэлийг хадгаллаа.` };
  });
}

/* ------------------------------------------------------------------ donation account */

const DonationInput = z.object({
  bank: z.string().trim().min(2).max(60),
  account: z.string().transform(normalizeAccount).pipe(z.string().regex(ACCOUNT_PATTERN)),
  holder: z.string().trim().max(80).optional().default(""),
});

/** The "Дэмжих" bank account shown on every page. */
export async function saveDonation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  return stored(async () => {
    const parsed = DonationInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: "Банкны нэр, дансны дугаар (MN + 18 орон эсвэл 8-20 орон) шалгана уу." };
    const value = JSON.stringify(parsed.data);
    await getDb()
      .insert(appSettings)
      .values({ key: DONATION_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    updateTag("settings");
    return { ok: true, message: `Хадгаллаа: ${parsed.data.bank} ${parsed.data.account}` };
  });
}

/** One received donation for /transparency. Only the name as published is stored. */
export async function addDonation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  return stored(async () => {
    const day = validDay(formData.get("receivedOn"), ubDateKey(Date.now()));
    if (!day) return { ok: false, message: "Огноо буруу байна (2024 оноос өнөөдөр хүртэл)." };
    const amount = parseAmount(formData.get("amount"));
    if (amount === null) return { ok: false, message: "Дүнг бүхэл төгрөгөөр бичнэ үү (жишээ нь 50000)." };
    const rawMode = String(formData.get("mode") ?? "");
    const mode: NameMode = (NAME_MODES as readonly string[]).includes(rawMode) ? (rawMode as NameMode) : "initials";
    const donor = publicDonor(String(formData.get("donor") ?? ""), mode);
    const note = cleanLine(formData.get("note"), NOTE_MAX) || null;
    await getDb().insert(donations).values({ receivedOn: day, amountMnt: amount, donor, note });
    updateTag("donations");
    return { ok: true, message: `Нэмлээ: ${day} · ${formatNumber(amount)} ₮ · ${donor ?? "нэргүй"} — ил тод тайланд гарлаа.` };
  });
}

export async function deleteDonation(formData: FormData) {
  await requireAdmin();
  const id = z.coerce.number().int().positive().parse(formData.get("id"));
  await getDb().delete(donations).where(eq(donations.id, id));
  updateTag("donations");
}

/** "Бид хэн бэ" (/about): five plain-text paragraphs; an empty field shows its default text. */
export async function saveAbout(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  return stored(async () => {
    const value: Record<string, string> = {};
    for (const f of ABOUT_FIELDS) {
      const raw = String(formData.get(f.key) ?? "");
      if (raw.length > f.max * 2) return { ok: false, message: `«${f.label}» хэт урт байна (${f.max} тэмдэгт хүртэл).` };
      value[f.key] = cleanAboutText(raw, f.max);
    }
    await getDb()
      .insert(appSettings)
      .values({ key: ABOUT_KEY, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(value), updatedAt: new Date() } });
    updateTag("settings");
    return { ok: true, message: "Хадгаллаа: /about шууд шинэчлэгдэнэ. Хоосон үлдээсэн хэсэгт анхдагч текст харагдана." };
  });
}

/** Declaration years taken out of the officials comparison ("46:2025, 12:2023"); the profile says so. */
export async function saveHiddenYears(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  return stored(async () => {
    const text = String(formData.get("pairs") ?? "").slice(0, 2000);
    const hidden = hiddenYearsFromText(text);
    if (text.trim() && Object.keys(hidden).length === 0) return { ok: false, message: "Формат: гишүүний id, хоёр цэг, он (46:2025), таслалаар тусгаарлана." };
    const value = JSON.stringify(hidden);
    await getDb()
      .insert(appSettings)
      .values({ key: HIDDEN_YEARS_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    updateTag("officials");
    const n = Object.values(hidden).reduce((a, y) => a + y.length, 0);
    return { ok: true, message: n ? `Хадгаллаа: ${n} жил харьцуулалтаас хасагдсан.` : "Хадгаллаа: хассан жил алга." };
  });
}

/* ------------------------------------------------------------------ anti-brainwash filter */

export interface FilterInput {
  title: string;
  url: string | null;
  sourceDomain: string;
  text: string;
}

export interface FilterResult {
  ok: boolean;
  error?: string;
  input?: FilterInput;
  tldr?: string;
  facts?: string[];
  spin?: string;
  neutrality?: number | null;
  riskScore?: number;
  riskReason?: string;
  amounts?: string[];
  deepMarkdown?: string | null;
  providers?: string;
  costUsd?: number;
}

/** A news page is well under this; more is refused before it reaches the parser. */
const ADMIN_PAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Fetch a URL (politely) or take raw text, then run DeepSeek and, if risky, Grok. */
export async function runFilter(raw: string, forceDeep: boolean): Promise<FilterResult> {
  await requireAdmin();
  const value = raw.trim();
  if (value.length < 10) return { ok: false, error: "URL эсвэл дор хаяж хэдэн өгүүлбэр оруулна уу." };

  let input: FilterInput;
  if (/^https?:\/\/\S+$/i.test(value)) {
    try {
      const res = await fetchPublicUrl(value, { timeoutMs: 25_000 });
      if (!res.ok) return { ok: false, error: `Хуудсыг татаж чадсангүй (HTTP ${res.status}).` };
      const article = await extractArticleSafe(await readTextLimited(res, ADMIN_PAGE_MAX_BYTES), res.url || value);
      if (!article) return { ok: false, error: "Хуудаснаас нийтлэлийн текст олдсонгүй (JavaScript-ээр ачаалдаг сайт байж магадгүй). Текстийг нь хуулж оруулна уу." };
      input = { title: article.title, url: value, sourceDomain: new URL(value).hostname.replace(/^www\./, ""), text: article.text };
    } catch (err) {
      return { ok: false, error: `Татах үед алдаа: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else {
    const text = normalizeText(value);
    const firstLine = text.split("\n")[0].slice(0, 200);
    input = { title: firstLine.length >= 10 ? firstLine : text.slice(0, 120), url: null, sourceDomain: "гараар оруулсан", text };
  }

  const ai: ArticleForAI = { title: input.title, sourceName: input.sourceDomain, sourceDomain: input.sourceDomain, url: input.url ?? "—", publishedAt: null, text: input.text };
  const db = getDb();
  try {
    const out = await analyzeArticle(ai, { log: dbUsageLogger(db), budget: dbBudgetGuard(db), forceDeep, purpose: "admin" });
    await syncLedgerAiCost(db);
    updateTag("ai");
    return {
      ok: true,
      input,
      tldr: out.tier1.tldr_summary,
      facts: out.tier1.facts,
      spin: out.tier1.spin_detected,
      neutrality: out.tier1.neutrality_score,
      riskScore: out.tier1.risk_score,
      riskReason: out.tier1.risk_reason,
      amounts: out.tier1.entities.amounts_mnt,
      deepMarkdown: out.tier2 ? formatDeepAnalysis(out.tier2) : null,
      providers: [out.tier1Provider, out.tier2Provider].filter(Boolean).join(" → "),
      costUsd: out.costUsd,
    };
  } catch (err) {
    const msg = err instanceof AIUnavailableError ? `${err.message}${err.attempts.length ? `: ${err.attempts.join(" | ")}` : ""}` : String(err);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

const PublishPayload = z.object({
  title: z.string().min(5).max(500),
  // http(s) with a host only: `.url()` also took "javascript:…" and "data:…", which became the
  // story's source link (and its source row's domain).
  url: z
    .string()
    .url()
    .refine((u) => {
      try {
        const p = new URL(u);
        return (p.protocol === "https:" || p.protocol === "http:") && p.hostname.length > 0;
      } catch {
        return false;
      }
    }, "only http(s) links")
    .max(2_000)
    .nullable(),
  sourceDomain: z.string().min(1).max(255),
  text: z.string().min(50),
  tldr: z.string().min(10),
  facts: z.array(z.string()),
  spin: z.string(),
  neutrality: z.number().min(0).max(100).nullable(),
  riskScore: z.number().min(0).max(100),
  amounts: z.array(z.string()),
  deepMarkdown: z.string().nullable(),
});

/** Publishes an analyzed item from the filter without paying for a second AI run. */
export async function publishFiltered(payload: z.input<typeof PublishPayload>): Promise<ActionResult & { slug?: string }> {
  await requireAdmin();
  const p = PublishPayload.safeParse(payload);
  if (!p.success) return { ok: false, message: "Нийтлэх өгөгдөл дутуу байна." };
  const v = p.data;
  const db = getDb();
  const domain = v.url ? new URL(v.url).hostname.replace(/^www\./, "") : "manual.iltod";
  let [source] = await db.select({ id: sources.id }).from(sources).where(eq(sources.domain, domain));
  if (!source) {
    [source] = await db
      .insert(sources)
      .values({ name: v.url ? domain : "Редакцийн оруулга", domain, urlPattern: v.url ? `${new URL(v.url).origin}/` : "https://manual.iltod/", category: "agency", isActive: false, discoveredFrom: "admin" })
      .returning({ id: sources.id });
  }
  const originalUrl = v.url ?? `https://manual.iltod/${contentHash(v.text).slice(0, 16)}`;
  const slug = slugify(v.title, originalUrl);
  const inserted = await db
    .insert(articles)
    .values({
      sourceId: source.id,
      title: v.title,
      slug,
      originalUrl,
      contentHash: contentHash(v.text),
      cleanContent: truncate(v.text, MAX_STORED_CHARS),
      tldrSummary: v.tldr,
      factVsSpin: { facts: v.facts, spin_detected: v.spin, neutrality_score: v.neutrality },
      extractedEntities: { people: [], orgs: [], amounts_mnt: v.amounts },
      riskScore: v.riskScore,
      riskFlag: v.riskScore >= 65,
      grokDeepAnalysis: v.deepMarkdown,
      publishedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: articles.id });
  if (!inserted.length) return { ok: false, message: "Энэ URL/текст аль хэдийн нийтлэгдсэн байна." };
  await refreshPublic(slug);
  return { ok: true, message: "Нийтэллээ.", slug };
}
