/**
 * Daily watchdog (`.github/workflows/watchdog.yml`): collects the state of the whole system
 * (news, AI, digests, push, social posting, officials, data snapshots, the live site, the
 * workflows themselves and dated facts in the code) and exits 1 with one Mongolian line per
 * problem. The workflow then opens a GitHub issue, which emails the repository owner.
 * The rules live in `src/lib/health.ts` (pure, unit-tested).
 *
 *   npm run health                       # everything
 *   HEALTH_SKIP_NETWORK=1 npm run health # database only (local, demo)
 *
 * Every collector runs on its own (`Promise.allSettled`): a failing query or an unreachable
 * GitHub API becomes its own problem line and never hides the others.
 */
import "dotenv/config";

import { X509Certificate } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { budgetConfig } from "@/lib/ai/limits";
import { GOVERNMENTS_VERIFIED_THROUGH } from "@/lib/budget/governments";
import { type CoreSnapshot, evaluateHealth, type IntegritySnapshot, type HealthConfig, type HealthSnapshot, type NetworkSnapshot, SOCIAL_PLATFORMS, type SocialPlatform, type SocialSnapshot, type WorkflowSnapshot } from "@/lib/health";
import { parseLayoutReport } from "@/lib/layout-check";
import { POPULATION } from "@/lib/per-person";
import { PLACES, placeMatchesConstituency } from "@/lib/places";
import { PROGRAMME_END } from "@/lib/promises/programme";
import { PROJECTS_VERIFIED_THROUGH } from "@/lib/projects/data";
import { PRODUCTION_URL } from "@/lib/site";
import { RATES_CHECKED } from "@/lib/tax/receipt";
import { TARIFFS_VERIFIED_THROUGH } from "@/lib/budget/tariffs";
import { OUTLETS } from "@/lib/press/outlets";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];
const TIMEOUT_MS = 20_000;

async function core(): Promise<CoreSnapshot> {
  const dailyUsd = budgetConfig().dailyUsd;
  const [r] = await rows(sql`select
    -- Published rows only: archive/menu pages stored unpublished must not make a dead feed look alive.
    extract(epoch from now() - (select max(created_at) from articles where is_published)) / 3600 as hours_since_article,
    extract(epoch from now() - (select max(created_at) from articles where is_published and tldr_summary is not null and not summary_fallback)) / 3600 as hours_since_ai,
    extract(epoch from now() - (select max(created_at) from digests)) / 3600 as hours_since_digest,
    (select count(*) from articles where is_published and tldr_summary is null)::int as ai_backlog,
    (select count(*) from sources where is_active)::int as active_sources,
    (select count(*) from sources where is_active and consecutive_failures > 0)::int as failing_sources,
    (select count(*) from push_subscriptions)::int as push_subs,
    (select count(*) from push_subscriptions where failures >= 3)::int as push_failing,
    extract(epoch from now() - (select max(last_success_at) from push_subscriptions)) / 3600 as hours_since_push,
    pg_database_size(current_database()) / 1048576.0 as db_mb,
    (select count(*) from articles where is_published and created_at > now() - interval '24 hours')::int as published_24h,
    (select count(*) from articles where is_published and summary_fallback and created_at > now() - interval '24 hours')::int as fallback_24h,
    (select coalesce(json_agg(generated_by), '[]'::json) from (select generated_by from digests where kind = '12h' order by created_at desc limit 4) d) as recent_digests,
    (select count(*) from (
      -- The budget guard's own day: UTC, without the prepaid ElevenLabs plan (loadUsageSnapshot).
      -- An Ulaanbaatar day with the voice credits counted reported days the cap never saw.
      select date_trunc('day', created_at at time zone 'UTC') as day from ai_usage_logs
      where created_at > now() - interval '7 days' and provider <> 'elevenlabs' group by 1 having sum(estimated_cost_usd) >= ${dailyUsd * 0.9}
    ) p)::int as paid_cap_days,
    extract(epoch from now() - (select max(source_checked_at) from articles)) / 3600 as hours_since_recheck`);
  const digests = typeof r.recent_digests === "string" ? JSON.parse(r.recent_digests) : r.recent_digests;
  return {
    hoursSinceArticle: num(r.hours_since_article),
    hoursSinceAi: num(r.hours_since_ai),
    hoursSinceDigest: num(r.hours_since_digest),
    aiBacklog: Number(r.ai_backlog),
    activeSources: Number(r.active_sources),
    failingSources: Number(r.failing_sources),
    pushSubs: Number(r.push_subs),
    pushFailing: Number(r.push_failing),
    hoursSincePushSuccess: num(r.hours_since_push),
    dbMb: Number(r.db_mb),
    published24h: Number(r.published_24h),
    fallback24h: Number(r.fallback_24h),
    recentDigests: (digests as string[]) ?? [],
    paidCapDays: Number(r.paid_cap_days),
    hoursSinceRecheck: num(r.hours_since_recheck),
  };
}

/** Data the public site must never show wrong (src/lib/health.ts IntegritySnapshot). */
async function integrity(): Promise<IntegritySnapshot> {
  const [r] = await rows(sql`select
    (select count(*) from articles where is_published and created_at > now() - interval '30 days'
       -- like, not a regex: in this template literal "\[" loses its backslash and became a class.
       and (tldr_summary like '%undefined%' or tldr_summary like '%[object Object]%'
            or fact_vs_spin::text like '%[object Object]%'
            or fact_vs_spin->>'spin_detected' in ('undefined', 'null')))::int as broken_ai,
    (select count(*) from (select cluster_id from articles where cluster_id is not null and is_published
       group by cluster_id having max(published_at) - min(published_at) > interval '7 days') c)::int as wide_clusters,
    (select count(*) from (select content_hash from articles group by content_hash having count(*) > 1) d)::int as dup_hashes`);
  const silent = await rows(sql`select s.domain from sources s join articles a on a.source_id = s.id
    where s.is_active and a.created_at > now() - interval '14 days'
    group by s.domain having count(*) >= 10 and count(*) filter (where a.is_published) = 0 order by s.domain`);
  return { brokenAiText: Number(r.broken_ai), widespreadClusters: Number(r.wide_clusters), duplicateHashes: Number(r.dup_hashes), silentSources: silent.map((x) => String(x.domain)) };
}

async function officials() {
  const [r] = await rows(sql`select extract(epoch from now() - max(updated_at)) / 3600 as h, (count(*) filter (where is_active))::int as active from politicians`);
  const constituencies = (await rows(sql`select distinct constituency from politicians where is_active and constituency is not null`)).map((x) => String(x.constituency));
  const placesWithoutMps = PLACES.filter((p) => p.kind !== "capital" && !constituencies.some((c) => placeMatchesConstituency(p, c))).map((p) => p.name);
  return { hoursSinceSync: num(r.h), active: Number(r.active), placesWithoutMps };
}

async function indicators() {
  const ages: Record<string, number> = {};
  let population: { year: number; count: number } | null = null;
  for (const r of await rows(sql`select key, extract(epoch from now() - updated_at) / 3600 as h, case when key = 'population' then data end as data from indicator_snapshots`)) {
    ages[String(r.key)] = Number(r.h);
    const d = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as { year?: unknown; count?: unknown } | null;
    if (d && typeof d.year === "number" && typeof d.count === "number") population = { year: d.year, count: d.count };
  }
  return { ages, population };
}

async function opendata() {
  const [r] = await rows(sql`select extract(epoch from now() - max(synced_at)) / 3600 as h from open_datasets`);
  return num(r.h);
}

async function social() {
  const out: Partial<Record<SocialPlatform, SocialSnapshot>> = {};
  for (const p of SOCIAL_PLATFORMS) out[p] = { hoursSinceOk: null, unknown7d: 0 };
  const result = await rows(sql`select platform,
    extract(epoch from now() - max(created_at) filter (where post_id is not null and post_id <> 'unknown' and post_id not like 'failed:%')) / 3600 as h,
    (count(*) filter (where post_id = 'unknown' and created_at > now() - interval '7 days'))::int as unknown
    from social_posts group by platform`);
  for (const r of result) {
    const p = String(r.platform) as SocialPlatform;
    if (p in out) out[p] = { hoursSinceOk: num(r.h), unknown7d: Number(r.unknown) };
  }
  return out;
}

async function videosAndPress() {
  const [v] = await rows(sql`select extract(epoch from now() - max(created_at)) / 3600 as h from videos`);
  const hoursSincePost: Partial<Record<SocialPlatform, number | null>> = {};
  for (const r of await rows(sql`select platform, extract(epoch from now() - max(created_at)) / 3600 as h
    from social_posts where kind = 'video' and post_id is not null and post_id <> 'unknown' and post_id not like 'failed:%' group by platform`)) {
    hoursSincePost[String(r.platform) as SocialPlatform] = num(r.h);
  }
  const press: Record<string, number | null> = Object.fromEntries(OUTLETS.map((o) => [o.domain, null]));
  for (const r of await rows(sql`select outlet, extract(epoch from now() - max(found_at)) / 3600 as h from press_items group by outlet`)) {
    if (String(r.outlet) in press) press[String(r.outlet)] = num(r.h);
  }
  return { videos: { hoursSinceVideo: num(v?.h), hoursSincePost }, press };
}

async function settings() {
  const result = await rows(sql`select key, value from app_settings where key in ('threads', 'instagram', 'prune_state', 'backup_last_at', 'pipeline_started_at', 'tenders_synced_at', 'documents_checked_at', 'github_dispatch_token_expires')`);
  const byKey = new Map(result.map((r) => [String(r.key), String(r.value)]));
  const jsonDate = (key: string, field: string): Date | null => {
    const raw = byKey.get(key);
    if (!raw) return null;
    try {
      const v = (JSON.parse(raw) as Record<string, unknown>)[field];
      return typeof v === "string" ? new Date(v) : null;
    } catch {
      return null;
    }
  };
  const plainDate = (key: string): Date | null => {
    const raw = byKey.get(key);
    if (!raw) return null;
    const d = new Date(raw.replace(/^"|"$/g, ""));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    tokens: { threads: jsonDate("threads", "refreshedAt"), instagram: jsonDate("instagram", "refreshedAt") },
    maintenance: { pruneAt: jsonDate("prune_state", "ranAt"), backupAt: plainDate("backup_last_at"), pipelineAt: plainDate("pipeline_started_at"), tendersAt: plainDate("tenders_synced_at"), documentsAt: plainDate("documents_checked_at") },
    dispatchTokenExpires: plainDate("github_dispatch_token_expires"),
  };
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "iltodmedee-watchdog (+https://iltodmedee.mn)" } });
  return { status: res.status, text: await res.text() };
}

function certValidTo(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function network(): Promise<NetworkSnapshot> {
  const [site, feed, security, cert] = await Promise.allSettled([
    fetchText(`${PRODUCTION_URL}/`),
    fetchText(`${PRODUCTION_URL}/feed.xml`),
    fetchText(`${PRODUCTION_URL}/.well-known/security.txt`),
    certValidTo(new URL(PRODUCTION_URL).hostname),
  ]);
  const siteOk = site.status === "fulfilled" && site.value.status === 200;
  const siteStatus = site.status === "fulfilled" ? `HTTP ${site.value.status}` : String((site.reason as Error)?.message ?? site.reason);
  const feedOk = feed.status === "fulfilled" && feed.value.status === 200 && feed.value.text.includes("<rss");
  let securityTxtExpires: Date | null = null;
  if (security.status === "fulfilled" && security.value.status === 200) {
    const m = /^Expires:\s*(\S+)/im.exec(security.value.text);
    const d = m ? new Date(m[1]) : null;
    securityTxtExpires = d && !Number.isNaN(d.getTime()) ? d : null;
  }
  return { siteOk, siteStatus, feedOk, siteCertValidTo: cert.status === "fulfilled" ? cert.value : null, securityTxtExpires };
}

async function github(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API ${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

async function workflows(token: string, repo: string): Promise<WorkflowSnapshot> {
  const list = (await github(`repos/${repo}/actions/workflows?per_page=100`, token)) as { workflows: { id: number; path: string; state: string }[] };
  // A manual disable is the owner's decision (keepalive leaves it alone and warns); anything else is not.
  const notActive = list.workflows.filter((w) => w.state !== "active" && w.state !== "disabled_manually").map((w) => `${w.path} (${w.state})`);
  const failingSchedules: string[] = [];
  for (const w of list.workflows) {
    if (w.state === "disabled_manually") continue;
    const runs = (await github(`repos/${repo}/actions/workflows/${w.id}/runs?event=schedule&status=completed&per_page=3`, token)) as { workflow_runs: { conclusion: string | null }[] };
    const last = runs.workflow_runs.map((r) => r.conclusion);
    if (last.length === 3 && last.every((c) => c === "failure")) failingSchedules.push(w.path);
  }
  return { notActive, failingSchedules };
}

function bundledCerts() {
  const dir = join(process.cwd(), "certs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".pem"))
    .map((file) => ({ file: `certs/${file}`, validTo: new Date(new X509Certificate(readFileSync(join(dir, file))).validTo) }));
}

async function main() {
  if (!hasDatabase()) {
    console.error("✗ DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const skipNetwork = process.env.HEALTH_SKIP_NETWORK === "1";
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  const collectors = {
    "мэдээ/AI/push": core,
    "өгөгдлийн бүрэн бүтэн байдал": integrity,
    "УИХ-ын гишүүд": officials,
    "өгөгдлийн хэсгүүд": indicators,
    "opendata.mn": opendata,
    "сошиал пост": social,
    "видео, хэвлэл": videosAndPress,
    "тохиргоо": settings,
    "сайт (сүлжээ)": skipNetwork ? null : network,
    "GitHub workflow": skipNetwork || !token || !repo ? null : () => workflows(token, repo),
    "гэрчилгээ": async () => bundledCerts(),
  } as const;
  const names = Object.keys(collectors) as (keyof typeof collectors)[];
  const results = await Promise.allSettled(names.map((n) => (collectors[n] ? collectors[n]() : Promise.resolve(undefined))));
  const got = <T,>(name: keyof typeof collectors): T | undefined => {
    const r = results[names.indexOf(name)];
    return r.status === "fulfilled" ? (r.value as T) : undefined;
  };

  const s = got<Awaited<ReturnType<typeof settings>>>("тохиргоо");
  const snapshot: HealthSnapshot = {
    core: got("мэдээ/AI/push"),
    integrity: got("өгөгдлийн бүрэн бүтэн байдал"),
    // Written by scripts/check-layout.ts in the watchdog workflow; absent when the scan did not run.
    layout: parseLayoutReport(process.env.LAYOUT_REPORT && existsSync(process.env.LAYOUT_REPORT) ? readFileSync(process.env.LAYOUT_REPORT, "utf8") : null),
    officials: got("УИХ-ын гишүүд"),
    indicators: got<Awaited<ReturnType<typeof indicators>>>("өгөгдлийн хэсгүүд")?.ages,
    population: got<Awaited<ReturnType<typeof indicators>>>("өгөгдлийн хэсгүүд")?.population,
    opendataHours: got("opendata.mn"),
    social: got("сошиал пост"),
    tokens: s?.tokens,
    maintenance: s?.maintenance,
    network: got("сайт (сүлжээ)"),
    workflows: got("GitHub workflow"),
    bundledCerts: got("гэрчилгээ"),
    videos: got<Awaited<ReturnType<typeof videosAndPress>>>("видео, хэвлэл")?.videos,
    press: got<Awaited<ReturnType<typeof videosAndPress>>>("видео, хэвлэл")?.press,
    dispatchTokenExpires: s?.dispatchTokenExpires,
  };
  const flag = (v: string | undefined) => v === "true";
  const config: HealthConfig = {
    socialConfigured: {
      facebook: flag(process.env.SOCIAL_FACEBOOK),
      threads: flag(process.env.SOCIAL_THREADS),
      instagram: flag(process.env.SOCIAL_INSTAGRAM),
      telegram: flag(process.env.SOCIAL_TELEGRAM),
      discord: flag(process.env.SOCIAL_DISCORD),
    },
    backupConfigured: process.env.BACKUP_CONFIGURED === undefined ? undefined : flag(process.env.BACKUP_CONFIGURED),
    videoPosting: process.env.VIDEO_POSTING === undefined ? undefined : process.env.VIDEO_POSTING.trim().toLowerCase() !== "off",
    dated: { governmentsVerified: GOVERNMENTS_VERIFIED_THROUGH, programmeEnd: PROGRAMME_END, populationYear: POPULATION.year, ratesChecked: RATES_CHECKED, projectsVerified: PROJECTS_VERIFIED_THROUGH, tariffsVerified: TARIFFS_VERIFIED_THROUGH },
  };

  const problems = evaluateHealth(snapshot, config);
  results.forEach((r, i) => {
    if (r.status === "rejected") problems.push(`Шалгалт "${names[i]}" ажилласангүй: ${(r.reason as Error)?.message ?? r.reason}`);
  });

  const c = snapshot.core;
  const rh = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v)} h`);
  if (c) {
    console.log(
      `articles ${rh(c.hoursSinceArticle)} ago · AI ${rh(c.hoursSinceAi)} ago · digest ${rh(c.hoursSinceDigest)} ago · backlog ${c.aiBacklog} · sources ${c.failingSources}/${c.activeSources} failing · push ${c.pushFailing}/${c.pushSubs} failing, last ok ${rh(c.hoursSincePushSuccess)} ago · DB ${Math.round(c.dbMb)} MB`,
    );
  }
  const configured = SOCIAL_PLATFORMS.filter((p) => config.socialConfigured[p]);
  console.log(`social checked: ${configured.length ? configured.join(", ") : "none"} · network ${skipNetwork ? "skipped" : "checked"} · workflows ${collectors["GitHub workflow"] ? "checked" : "skipped"}`);
  if (problems.length) {
    for (const p of problems) console.log(`- ${p}`);
    process.exitCode = 1;
  } else {
    console.log("✓ Healthy");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
