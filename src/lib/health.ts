/**
 * The watchdog's rules (`npm run health`, `.github/workflows/watchdog.yml`). Pure: the script
 * collects a snapshot from the database, GitHub and the live site, this decides what is wrong.
 * Every line names what stopped and where to look, in Mongolian, because it becomes a GitHub
 * issue that is emailed to the owner. A section that could not be collected is `undefined` and
 * its rules are skipped (the collector's own error is reported instead), so one failing query
 * never hides the other problems.
 */

import type { LayoutOverflow } from "./layout-check";

export const DB_LIMIT_MB = 500;

/** Snapshots `budget:sync` / `macro:sync` must keep fresh, with how old each may get (hours). */
export const INDICATOR_MAX_AGE_H: Record<string, number> = {
  mongolbank: 72,
  budget_nso: 14 * 24,
  shilendans: 14 * 24,
  worldbank_tax: 14 * 24,
  audit_opinions: 14 * 24,
  soe_finance: 14 * 24,
  population: 14 * 24,
  // NSO adds a month about 8 days after it ends; the wage table is quarterly with a ~2-month lag.
  prices_nso: 45 * 24,
  wages_nso: 150 * 24,
  // officials-sync.yml (weekly): MPs' declared companies looked up in Шилэн данс.
  officials_companies: 14 * 24,
};

/** No pipeline start for this long is a problem (runs are every 30 min, ~50 min long). */
export const PIPELINE_QUIET_H = 6;

export const SOCIAL_PLATFORMS = ["facebook", "threads", "instagram", "telegram", "discord"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const DAY_MS = 86_400_000;

export interface CoreSnapshot {
  hoursSinceArticle: number | null;
  hoursSinceAi: number | null;
  hoursSinceDigest: number | null;
  /** Published rows still waiting for an AI summary. */
  aiBacklog: number;
  activeSources: number;
  failingSources: number;
  pushSubs: number;
  pushFailing: number;
  /** Hours since any subscription last got a push through (null = never). */
  hoursSincePushSuccess: number | null;
  dbMb: number;
  /** Published rows of the last 24 h, and how many of them only got the extractive fallback. */
  published24h: number;
  fallback24h: number;
  /** `generated_by` of the newest 12h digests, newest first. */
  recentDigests: string[];
  /** Days of the last 7 on which paid AI spend reached 90 % of the daily cap. */
  paidCapDays: number;
  /** Hours since the weekly source re-check last stamped an article (null = never ran). */
  hoursSinceRecheck: number | null;
}

export interface OfficialsSnapshot {
  hoursSinceSync: number | null;
  active: number;
  /** Aimags / districts no active MP's constituency covers (`placeMatchesConstituency`). */
  placesWithoutMps?: string[];
}

export interface SocialSnapshot {
  /** Hours since this platform's last post with a real post id (null = none in the table). */
  hoursSinceOk: number | null;
  /** Rows of the last 7 days whose outcome was unknown (`post_id = 'unknown'`). */
  unknown7d: number;
}

export interface NetworkSnapshot {
  siteOk: boolean;
  siteStatus: string;
  feedOk: boolean;
  /** Expiry of the certificate iltodmedee.mn serves (null = not read). */
  siteCertValidTo: Date | null;
  /** The security.txt `Expires` field (null = missing or unreadable). */
  securityTxtExpires: Date | null;
}

export interface WorkflowSnapshot {
  /** Workflows GitHub reports as not active (path + state), manual disables included. */
  notActive: string[];
  /** Scheduled workflows whose 3 newest scheduled runs all failed. */
  failingSchedules: string[];
}

/**
 * Data that must never be wrong on the public site (Nov 2026 audit: each count was a real bug
 * that reached readers before anyone noticed).
 */
export interface IntegritySnapshot {
  /** Published stories of the last 30 days whose AI text reads "undefined", "null" or "[object Object]". */
  brokenAiText: number;
  /** Clusters whose published members are more than 7 days apart (two different events joined). */
  widespreadClusters: number;
  /** content_hash values stored more than once (the AI analysed the same text twice). */
  duplicateHashes: number;
  /** Active sources with 10+ rows in 14 days and not one published (JavaScript shells, a misfiring rule). */
  silentSources: string[];
}

export interface HealthSnapshot {
  core?: CoreSnapshot;
  integrity?: IntegritySnapshot;
  /** Pages wider than a phone screen on the live site (scripts/check-layout.ts; absent = scan did not run). */
  layout?: LayoutOverflow[];
  officials?: OfficialsSnapshot;
  /** Hours since each indicator snapshot was written; a missing key is absent. */
  indicators?: Record<string, number>;
  opendataHours?: number | null;
  social?: Partial<Record<SocialPlatform, SocialSnapshot>>;
  /** `refreshedAt` of the stored 60-day tokens (null = no stored state). */
  tokens?: { threads: Date | null; instagram: Date | null };
  /** When the maintenance jobs last recorded a run (absent = the job does not exist yet). */
  maintenance?: { pruneAt?: Date | null; backupAt?: Date | null; pipelineAt?: Date | null; tendersAt?: Date | null };
  network?: NetworkSnapshot;
  workflows?: WorkflowSnapshot;
  /** Expiry of the bundled intermediate certificate (`certs/*.pem`). */
  bundledCerts?: { file: string; validTo: Date }[];
  /** NSO's newest population figure (indicator_snapshots `population`). */
  population?: { year: number; count: number } | null;
  /** Hours since the newest video was made, and since each platform last got one (null = never). */
  videos?: { hoursSinceVideo: number | null; hoursSincePost: Partial<Record<SocialPlatform, number | null>> };
  /** Hours since each press outlet last gave a new headline (null = never). */
  press?: Record<string, number | null>;
  /** When the Supabase pipeline-fallback GitHub token expires (`app_settings` github_dispatch_token_expires). */
  dispatchTokenExpires?: Date | null;
}

export interface HealthConfig {
  /** Platforms whose secrets are set in the workflow (booleans only, never the secret). */
  socialConfigured: Partial<Record<SocialPlatform, boolean>>;
  /** Whether the BACKUP_AGE_PUBLIC_KEY secret is set (undefined = not checked, e.g. a local run). */
  backupConfigured?: boolean;
  /** Daily videos are on (`VIDEO_POSTING` is not "off"; undefined = not checked). */
  videoPosting?: boolean;
  /** Dated facts in the code that someone has to re-check by hand. */
  dated: {
    /** The Prime Minister list was last verified on this day (`GOVERNMENTS_VERIFIED_THROUGH`). */
    governmentsVerified: string;
    /** The 2024–2028 action programme ends (`PROGRAMME_END`). */
    programmeEnd: string;
    /** The year `POPULATION` counts (end of that year). */
    populationYear: number;
    /** The tax rates in `/tax` were last checked on this day (`RATES_CHECKED`). */
    ratesChecked: string;
    /** Every /projects entry's sources were last re-read on this day (`PROJECTS_VERIFIED_THROUGH`). */
    projectsVerified: string;
    /** The hand-typed ERC / УСУГ tariffs on /prices were last checked on this day (`TARIFFS_VERIFIED_THROUGH`). */
    tariffsVerified?: string;
  };
}

const daysSince = (iso: string | Date, now: Date) => (now.getTime() - new Date(iso).getTime()) / DAY_MS;
const daysUntil = (d: Date, now: Date) => (d.getTime() - now.getTime()) / DAY_MS;
const h = (v: number | null) => (v === null ? "хэзээ ч" : `${Math.round(v)} цаг`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** null (never happened) counts as older than any limit. */
const olderThan = (v: number | null | undefined, limit: number) => v === null || (v !== undefined && v > limit);

export function evaluateHealth(s: HealthSnapshot, config: HealthConfig, now = new Date()): string[] {
  const out: string[] = [];
  const c = s.core;
  if (c) {
    if (olderThan(c.hoursSinceArticle, 26)) out.push(`Шинэ мэдээ ${h(c.hoursSinceArticle)} орж ирээгүй (autonomous-news-pipeline-ийн scrape алхмыг шалгах).`);
    if (olderThan(c.hoursSinceAi, 36)) out.push(`AI хураангуй ${h(c.hoursSinceAi)} гараагүй (AI түлхүүр, лимит шалгах). Хүлээгдэж буй: ${c.aiBacklog}.`);
    if (olderThan(c.hoursSinceDigest, 26)) out.push(`Онцлох тойм ${h(c.hoursSinceDigest)} гараагүй (news-digest workflow).`);
    const failing = c.failingSources / Math.max(1, c.activeSources);
    if (failing > 0.6) out.push(`Эх сурвалжийн ${Math.round(failing * 100)}% алдаатай (${c.failingSources}/${c.activeSources}).`);
    if (c.pushSubs >= 5 && c.pushFailing > c.pushSubs / 2) out.push(`Push мэдэгдэл: ${c.pushFailing}/${c.pushSubs} захиалга дараалан алдаатай (VAPID түлхүүр, push үйлчилгээ шалгах).`);
    // The failure counter never moves for 429/5xx or a systemic VAPID problem, so also look at success.
    if (c.pushSubs >= 5 && olderThan(c.hoursSincePushSuccess, 96)) out.push(`Push мэдэгдэл ${h(c.hoursSincePushSuccess)} нэг ч захиалагчид хүрээгүй (push алхмын лог, VAPID түлхүүр шалгах).`);
    if (c.dbMb > DB_LIMIT_MB * 0.8) out.push(`Өгөгдлийн сан ${Math.round(c.dbMb)} MB / ${DB_LIMIT_MB} MB: db:prune-ийн лог, RETENTION_DAYS хувьсагчийг шалгах.`);
    if (c.published24h >= 10 && c.fallback24h / c.published24h > 0.5) out.push(`Сүүлийн 24 цагийн ${c.fallback24h}/${c.published24h} мэдээ AI-гүй (эх текстийн эхний өгүүлбэр) гарсан: AI үйлчилгээ бүгд унасан эсвэл түлхүүр хүчингүй.`);
    const ruleBased = c.recentDigests.filter((g) => g === "rule-based").length;
    if (c.recentDigests.length >= 4 && ruleBased >= 3) out.push(`Сүүлийн 4 тоймын ${ruleBased} нь AI-гүй (дүрмээр) бичигдсэн: тоймын AI редактор ажиллахгүй байна.`);
    if (c.paidCapDays >= 5) out.push(`Төлбөртэй AI зардал сүүлийн 7 хоногийн ${c.paidCapDays} өдөр өдрийн дээд хязгаарт хүрсэн: үнэгүй үйлчилгээнүүдийн квот дууссан байж магадгүй.`);
    if (c.hoursSinceRecheck !== null && c.hoursSinceRecheck > 9 * 24) out.push(`Эх сурвалжийн дахин шалгалт ${Math.round(c.hoursSinceRecheck / 24)} хоног ажиллаагүй (source-recheck workflow).`);
  }

  const g = s.integrity;
  if (g) {
    if (g.brokenAiText > 0) out.push(`${g.brokenAiText} нийтлэгдсэн мэдээний AI текстэд "undefined"/"null"/"[object Object]" бичигдсэн байна: AI-ийн хариуны хэлбэр (schemas.ts) өөрчлөгдсөн эсэхийг шалгаад тэдгээрийг дахин боловсруулах (maintenance.yml → reanalyse).`);
    if (g.widespreadClusters > 0) out.push(`${g.widespreadClusters} кластерын мэдээнүүд хооронд 7 хоногоос их зайтай: өөр өөр үйл явдлыг нэгтгэсэн байж болзошгүй (clustering.ts, /clusters-ийг шалгах).`);
    if (g.duplicateHashes > 0) out.push(`Ижил текстийг ${g.duplicateHashes} удаа давхар хадгалсан (content_hash давхардсан): db-sink-ийн давхардлын шалгалтыг шалгах.`);
    if (g.silentSources.length) out.push(`${g.silentSources.length} эх сурвалжаас сүүлийн 14 хоногт 10+ хуудас ирсэн ч нэг ч мэдээ нийтлэгдээгүй (${g.silentSources.slice(0, 5).join(", ")}): JavaScript хуудас эсвэл буруу шүүлтүүр байж магадгүй.`);
  }

  for (const l of s.layout ?? []) out.push(`Утсан дээр ${l.path} хуудас дэлгэцээс өргөн (${l.viewport}px дэлгэцэнд ${l.width}px, хажуу тийш гүйдэг): ${l.culprit}`);

  const o = s.officials;
  if (o) {
    if (olderThan(o.hoursSinceSync, 9 * 24)) out.push(`УИХ-ын гишүүдийн мэдээлэл ${o.hoursSinceSync === null ? "хэзээ ч" : `${Math.round(o.hoursSinceSync / 24)} хоног`} шинэчлэгдээгүй (officials-sync workflow).`);
    if (o.active < 100) out.push(`Идэвхтэй УИХ-ын гишүүн ${o.active} байна (126 байх ёстой): сонгуулийн дараах эсвэл parliament.mn-ийн дутуу хариу. /officials-ыг шалгах.`);
    else if (o.placesWithoutMps?.length) out.push(`${o.placesWithoutMps.length} аймаг/дүүргийн хуудсанд УИХ-ын гишүүн харагдахгүй байна (${o.placesWithoutMps.slice(0, 5).join(", ")}): тойргийн нэр өөрчлөгдсөн бол src/lib/places.ts-ийг шалгах.`);
  }

  if (s.indicators) {
    for (const [key, maxH] of Object.entries(INDICATOR_MAX_AGE_H)) {
      const age = s.indicators[key];
      if (age === undefined) out.push(`Өгөгдлийн хэсэг "${key}" огт хадгалагдаагүй (budget:sync / macro:sync).`);
      else if (age > maxH) out.push(`Өгөгдлийн хэсэг "${key}" ${Math.round(age / 24)} хоног шинэчлэгдээгүй (news-digest-ийн budget/macro алхам).`);
    }
  }
  if (s.opendataHours !== undefined && olderThan(s.opendataHours, 72)) out.push(`opendata.mn өгөгдөл ${h(s.opendataHours)} шинэчлэгдээгүй (news-digest-ийн data:sync алхам).`);

  for (const platform of SOCIAL_PLATFORMS) {
    if (!config.socialConfigured[platform]) continue;
    const p = s.social?.[platform];
    if (!p) continue;
    if (olderThan(p.hoursSinceOk, 72)) out.push(`${platform}: ${h(p.hoursSinceOk)} амжилттай пост гараагүй (токен, social алхмын лог шалгах; docs/FACEBOOK.md).`);
    if (p.unknown7d > 0) out.push(`${platform}: ${p.unknown7d} пост нийтлэгдсэн эсэх нь тодорхойгүй (post_id='unknown'): хуудсаа гараар шалгах.`);
  }
  if (s.tokens) {
    for (const platform of ["threads", "instagram"] as const) {
      const at = s.tokens[platform];
      if (!config.socialConfigured[platform] || !at) continue;
      const age = daysSince(at, now);
      if (age > 14) out.push(`${platform}: 60 хоногийн токен ${Math.round(age)} хоног сэргээгдээгүй, ${Math.max(0, Math.round(60 - age))} хоногийн дараа дуусна (шинэ токеныг secret-д хийх).`);
    }
  }

  // Videos: every slot makes one, so a day and a half without one means the step is failing
  // quietly (both pipeline video steps are continue-on-error); news posts would hide it otherwise.
  if (config.videoPosting && s.videos) {
    if (olderThan(s.videos.hoursSinceVideo, 36)) out.push(`Өдөр тутмын видео ${h(s.videos.hoursSinceVideo)} хийгдээгүй (pipeline-ийн "Make the slot's video" алхам, Daily video workflow-ийн лог).`);
    for (const platform of ["facebook", "instagram", "threads"] as const) {
      if (!config.socialConfigured[platform]) continue;
      const age = s.videos.hoursSincePost[platform];
      if (olderThan(age ?? null, 48)) out.push(`${platform}: видео ${h(age ?? null)} тавигдаагүй (social:post --mode video-ийн лог).`);
    }
  }
  // The article page's "not found in the press" note depends on these feeds.
  for (const [outlet, age] of Object.entries(s.press ?? {})) {
    if (olderThan(age, 24)) out.push(`Хэвлэлийн RSS ${outlet}: ${h(age)} шинэ гарчиг ирээгүй (press:sync-ийн лог; хаяг, бүтэц өөрчлөгдсөн эсэх).`);
  }
  if (s.dispatchTokenExpires && daysUntil(s.dispatchTokenExpires, now) < 30) out.push(`Pipeline-ийн нөөц эхлүүлэгчийн GitHub токен ${ymd(s.dispatchTokenExpires)}-нд дуусна: шинэ токен үүсгээд Supabase Vault-д солих (docs/PIPELINE-FALLBACK.md).`);

  const m = s.maintenance;
  if (m?.pruneAt && daysSince(m.pruneAt, now) > 3) out.push(`Өгөгдлийн сангийн цэвэрлэгээ (db:prune) ${Math.round(daysSince(m.pruneAt, now))} хоног ажиллаагүй.`);
  if (config.backupConfigured === false) out.push(`Нөөц хуулбар хийгдэхгүй байна: BACKUP_AGE_PUBLIC_KEY secret алга (docs/BACKUP.md-ийн 1-р алхам).`);
  // `npm run pipeline:mark`, the pipeline's first step: GitHub drops scheduled runs, and the
  // Supabase fallback (supabase/pipeline-fallback.sql) starts one after an hour when it has a token.
  if (m?.pipelineAt && daysSince(m.pipelineAt, now) * 24 > PIPELINE_QUIET_H) out.push(`Мэдээний pipeline ${Math.round(daysSince(m.pipelineAt, now) * 24)} цаг эхлээгүй: GitHub хуваарийг алгассан байж магадгүй (docs/PIPELINE-FALLBACK.md).`);
  if (m?.tendersAt && daysSince(m.tendersAt, now) > 3) out.push(`Тендерийн үр дүн (/tenders) ${Math.round(daysSince(m.tendersAt, now))} хоног шинэчлэгдээгүй: news-digest → "Sync tender results" алхмыг шалгах (Шилэн дансны API).`);
  if (m?.backupAt && daysSince(m.backupAt, now) > 10) out.push(`Нөөц хуулбар (backup) ${Math.round(daysSince(m.backupAt, now))} хоног хийгдээгүй (backup workflow).`);

  const n = s.network;
  if (n) {
    if (!n.siteOk) out.push(`iltodmedee.mn нээгдэхгүй байна (${n.siteStatus}): Vercel, домэйн шалгах.`);
    if (n.siteOk && !n.feedOk) out.push(`/feed.xml RSS эвдэрсэн байна.`);
    if (n.siteCertValidTo && daysUntil(n.siteCertValidTo, now) < 20) out.push(`iltodmedee.mn-ийн TLS гэрчилгээ ${ymd(n.siteCertValidTo)}-нд дуусна (Vercel өөрөө сунгадаг: DNS-ээ шалгах).`);
    if (!n.securityTxtExpires) out.push(`/.well-known/security.txt уншигдсангүй.`);
    else if (daysUntil(n.securityTxtExpires, now) < 30) out.push(`security.txt-ийн Expires ${ymd(n.securityTxtExpires)}: сунгах.`);
  }
  for (const cert of s.bundledCerts ?? []) {
    if (daysUntil(cert.validTo, now) < 60) out.push(`${cert.file} гэрчилгээ ${ymd(cert.validTo)}-нд дуусна: DigiCert-ээс шинэ intermediate татаж солих (audit.mn-ийн өгөгдөл).`);
  }
  if (s.workflows) {
    for (const wf of s.workflows.notActive) out.push(`Workflow идэвхгүй: ${wf} (Actions → Enable workflow).`);
    for (const wf of s.workflows.failingSchedules) out.push(`Workflow сүүлийн 3 удаа дараалан алдаатай: ${wf}.`);
  }

  // Facts written into the code that only a person can re-check.
  const d = config.dated;
  if (daysSince(d.governmentsVerified, now) > 548) out.push(`Ерөнхий сайдын жагсаалтыг ${d.governmentsVerified}-нээс хойш шалгаагүй (src/lib/budget/governments.ts, GOVERNMENTS_VERIFIED_THROUGH).`);
  if (now.getTime() >= new Date(d.programmeEnd).getTime()) out.push(`Засгийн газрын 2024–2028 оны үйл ажиллагааны хөтөлбөр дууссан: шинэ хөтөлбөр батлагдсан бол npm run promises:import.`);
  // NSO's own newest figure names the exact update; without it, ask once two years have passed.
  if (s.population && s.population.year > d.populationYear) out.push(`ҮСХ ${s.population.year} оны хүн амын тоог (${s.population.count.toLocaleString("en-US")}) нийтэлсэн: src/lib/per-person.ts POPULATION-ийг шинэчлэх (одоо ${d.populationYear} оных).`);
  else if (!s.population && now.getTime() >= Date.UTC(d.populationYear + 2, 3, 1)) out.push(`Хүн амын тоо ${d.populationYear} оных (src/lib/per-person.ts POPULATION): ҮСХ-ны шинэ тоог оруулах.`);
  if (daysSince(d.ratesChecked, now) > 395) out.push(`Татварын хувь хэмжээг ${d.ratesChecked}-нээс хойш шалгаагүй (src/lib/tax/receipt.ts RATES_CHECKED).`);
  if (d.tariffsVerified && daysSince(d.tariffsVerified, now) > 395) out.push(`Цахилгаан, усны тарифыг ${d.tariffsVerified}-нээс хойш шалгаагүй (src/lib/budget/tariffs.ts TARIFFS_VERIFIED_THROUGH; ЭХЗХ-ны шинэ шийдвэр гарсан эсэх).`);
  if (daysSince(d.projectsVerified, now) > 180) out.push(`Төслүүдийн хуудсын (/projects) эх сурвалжуудыг ${d.projectsVerified}-нээс хойш дахин уншаагүй (src/lib/projects/data.ts PROJECTS_VERIFIED_THROUGH).`);
  return out;
}
