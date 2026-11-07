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
import "@/lib/runtime-banner";

import { X509Certificate } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

import { sql } from "drizzle-orm";

import { closeDb, getDb, hasDatabase } from "@/db";
import { budgetConfig } from "@/lib/ai/limits";
import { GOVERNMENTS_VERIFIED_THROUGH } from "@/lib/budget/governments";
import { healthProblems, healthReport, SOCIAL_PLATFORMS, type HealthConfig, type HealthSnapshot, type NetworkSnapshot, type WorkflowSnapshot } from "@/lib/health";
import { collectCore, collectIntegrity, collectSocial, collectVideosAndPress } from "@/lib/health-collect";
import { parseLayoutReport } from "@/lib/layout-check";
import { errorDetail, errorLine } from "@/lib/log-safe";
import { POPULATION } from "@/lib/per-person";
import { PLACES, placeMatchesConstituency } from "@/lib/places";
import { PROGRAMME_END } from "@/lib/promises/programme";
import { PROJECTS_VERIFIED_THROUGH } from "@/lib/projects/data";
import { PRODUCTION_URL } from "@/lib/site";
import { isTaxRateNews, taxRateIssueBody, type TaxRateNews, watchFrom } from "@/lib/tax/rate-watch";
import { RATES_CHECKED } from "@/lib/tax/receipt";
import { TARIFFS_VERIFIED_THROUGH } from "@/lib/budget/tariffs";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const rows = async (q: ReturnType<typeof sql>) => (await getDb().execute(q)).rows as Row[];
const TIMEOUT_MS = 20_000;

/**
 * Published stories since RATES_CHECKED whose headline may change the /tax rates (ХХОАТ, НДШ):
 * SQL narrows by the levy's name, `isTaxRateNews` decides.
 */
async function taxRateNews(): Promise<TaxRateNews[]> {
  const found = await rows(sql`select a.id, a.slug, coalesce(a.reader_title, a.title) as title, a.title as source_title, a.original_url as url,
      to_char(a.published_at at time zone 'Asia/Ulaanbaatar', 'YYYY-MM-DD') as day
    from articles a
    where a.is_published and a.published_at >= ${watchFrom(RATES_CHECKED)}
      and lower(coalesce(a.reader_title, '') || ' ' || a.title) ~ '(орлогын албан татвар|ххоат|ндш|шимтгэл|нийгмийн даатгалын тухай|татварын багц|татварын ерөнхий)'
    order by a.published_at desc limit 200`);
  return found
    .filter((r) => isTaxRateNews(`${String(r.title)} ${String(r.source_title)}`))
    .slice(0, 20)
    .map((r) => ({ id: Number(r.id), slug: String(r.slug), title: String(r.title), day: String(r.day), url: String(r.url) }));
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
  const siteStatus = site.status === "fulfilled" ? `HTTP ${site.value.status}` : errorLine(site.reason, 200);
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
  if (!res.ok) throw new Error(`GitHub API ${path.split("?")[0]}: HTTP ${res.status} ${errorLine(await res.text().catch(() => ""), 200)}`);
  return res.json();
}

async function workflows(token: string, repo: string): Promise<WorkflowSnapshot> {
  const list = (await github(`repos/${repo}/actions/workflows?per_page=100`, token)) as { workflows: { id: number; path: string; state: string }[] };
  // A manual disable is the owner's decision (keepalive leaves it alone and warns); anything else is not.
  const notActive = list.workflows.filter((w) => w.state !== "active" && w.state !== "disabled_manually" && w.state !== "deleted").map((w) => `${w.path} (${w.state})`);
  const failingSchedules: string[] = [];
  for (const w of list.workflows) {
    // The watchdog's own runs are red whenever it reports something urgent: counting them made it
    // report itself as failing for three more days after the real problem was fixed.
    if (w.state === "disabled_manually" || w.state === "deleted" || /\/watchdog\.ya?ml$/.test(w.path)) continue;
    const runs = (await github(`repos/${repo}/actions/workflows/${w.id}/runs?event=schedule&status=completed&per_page=3`, token)) as { workflow_runs: { conclusion: string | null; html_url?: string }[] };
    const last = runs.workflow_runs.map((r) => r.conclusion);
    // With the newest failed run's URL: the issue line used to name the workflow file only.
    if (last.length === 3 && last.every((c) => c === "failure")) failingSchedules.push(runs.workflow_runs[0].html_url ? `${w.path} (${runs.workflow_runs[0].html_url})` : w.path);
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
    "мэдээ/AI/push": () => collectCore(getDb(), new Date(), budgetConfig().dailyUsd),
    "өгөгдлийн бүрэн бүтэн байдал": () => collectIntegrity(getDb(), new Date()),
    "УИХ-ын гишүүд": officials,
    "өгөгдлийн хэсгүүд": indicators,
    "opendata.mn": opendata,
    "сошиал пост": () => collectSocial(getDb(), new Date()),
    "видео, хэвлэл": () => collectVideosAndPress(getDb(), new Date()),
    "тохиргоо": settings,
    "сайт (сүлжээ)": skipNetwork ? null : network,
    "GitHub workflow": skipNetwork || !token || !repo ? null : () => workflows(token, repo),
    "гэрчилгээ": async () => bundledCerts(),
    "татварын хууль": taxRateNews,
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
    videos: got<Awaited<ReturnType<typeof collectVideosAndPress>>>("видео, хэвлэл")?.videos,
    press: got<Awaited<ReturnType<typeof collectVideosAndPress>>>("видео, хэвлэл")?.press,
    dispatchTokenExpires: s?.dispatchTokenExpires,
    taxRateNews: got("татварын хууль"),
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
    videoPostingValue: process.env.VIDEO_POSTING,
    dated: { governmentsVerified: GOVERNMENTS_VERIFIED_THROUGH, programmeEnd: PROGRAMME_END, populationYear: POPULATION.year, ratesChecked: RATES_CHECKED, projectsVerified: PROJECTS_VERIFIED_THROUGH, tariffsVerified: TARIFFS_VERIFIED_THROUGH },
  };

  const problems = healthProblems(snapshot, config);
  results.forEach((r, i) => {
    // The news/database check failing means the database or its secret is broken, and none of the
    // urgent rules could run: that is urgent itself. GitHub's API failing hides a disabled pipeline.
    const critical = names[i] === "мэдээ/AI/push" || names[i] === "GitHub workflow";
    if (r.status === "rejected") {
      // The issue line carries the whole cause chain (drizzle's "Failed query" hides the Postgres
      // reason in `cause`); the run log gets the stack.
      console.error(`::error::check "${names[i]}" failed: ${errorDetail(r.reason)}`);
      problems.push({ level: critical ? "urgent" : "info", text: `Шалгалт "${names[i]}" ажилласангүй: ${errorLine(r.reason, 600)}` });
    }
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
  const report = healthReport(problems);
  if (report.lines.length) console.log(report.lines.join("\n"));
  else console.log("✓ Healthy");
  // Its own issue (label "tax-rates", watchdog.yml): written only when stories need a look, so an
  // empty or missing file closes the issue once RATES_CHECKED has moved past them.
  const tax = got<TaxRateNews[]>("татварын хууль");
  if (process.env.TAX_REPORT && tax) writeFileSync(process.env.TAX_REPORT, tax.length ? taxRateIssueBody(tax, RATES_CHECKED, PRODUCTION_URL) : "");
  // The workflow picks the issue's title and whether to e-mail from this; only urgent is red.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `level=${report.level}\n`);
  if (report.level === "urgent") process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`::error::health-check: ${errorDetail(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
