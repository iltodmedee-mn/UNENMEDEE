/**
 * Deletes old Vercel deployments so the Hobby plan's 10 GB Functions Storage does not fill up.
 *
 *   npm run vercel:cleanup -- --dry-run      # list what would be deleted
 *   npm run vercel:cleanup                   # delete
 *
 * Needs VERCEL_TOKEN (secret), VERCEL_PROJECT_ID and VERCEL_TEAM_ID. Keeps the deployment serving
 * production, the newest VERCEL_KEEP_PRODUCTION (3) ready production deployments and unfinished
 * builds (src/lib/vercel-cleanup.ts). The token only goes in the Authorization header.
 */
import "@/lib/runtime-banner";
import { parseArgs } from "node:util";

import { deploymentsToDelete, type VercelDeployment } from "@/lib/vercel-cleanup";
import { errorDetail } from "@/lib/log-safe";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const API = "https://api.vercel.com";
const token = process.env.VERCEL_TOKEN?.trim();
const projectId = process.env.VERCEL_PROJECT_ID?.trim();
const teamId = process.env.VERCEL_TEAM_ID?.trim();
const keepProduction = Number(process.env.VERCEL_KEEP_PRODUCTION || 3);

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}${path}${teamId ? `${sep}teamId=${encodeURIComponent(teamId)}` : ""}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${json.error?.message ?? "request failed"}`);
  return json;
}

async function main() {
  if (!token || !projectId) {
    console.error("::error::Set the VERCEL_TOKEN secret and VERCEL_PROJECT_ID (see CLAUDE.md §8).");
    process.exitCode = 1;
    return;
  }
  const project = await api<{ targets?: { production?: { id?: string } } }>(`/v9/projects/${encodeURIComponent(projectId)}`);
  const current = project.targets?.production?.id ?? null;

  const all: VercelDeployment[] = [];
  let until: number | null | undefined;
  for (let page = 0; page < 30; page++) {
    const q = new URLSearchParams({ projectId, limit: "100" });
    if (until) q.set("until", String(until));
    const res = await api<{ deployments: VercelDeployment[]; pagination?: { next?: number | null } }>(`/v6/deployments?${q}`);
    all.push(...res.deployments);
    until = res.pagination?.next;
    if (!until) break;
  }

  if (!current || !all.some((d) => d.uid === current)) {
    console.log(`::warning::The deployment serving production (${current ?? "unknown"}) is not in the list: deleting nothing this run.`);
  }
  const doomed = deploymentsToDelete(all, { keepProduction, currentProductionId: current });
  console.log(`🗂 ${all.length} deployment(s); keeping ${all.length - doomed.length}, deleting ${doomed.length}${values["dry-run"] ? " (dry run)" : ""}.`);
  let deleted = 0;
  for (const d of doomed) {
    const when = new Date(d.created).toISOString().slice(0, 16);
    if (values["dry-run"]) {
      console.log(`  would delete ${d.uid} ${d.target ?? "preview"} ${d.readyState ?? d.state ?? ""} ${when}`);
      continue;
    }
    try {
      await api(`/v13/deployments/${encodeURIComponent(d.uid)}`, { method: "DELETE" });
      deleted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Vercel allows about 200 deletions per 10 minutes: stop and leave the rest to the next run.
      if (message.includes("Vercel 429")) {
        console.log(`⏸ Vercel's delete limit reached; ${doomed.length - deleted} left for the next run.`);
        break;
      }
      console.log(`::warning::${d.uid}: ${message}`);
    }
  }
  if (!values["dry-run"]) console.log(`✓ Deleted ${deleted} deployment(s).`);
}

main().catch((err) => {
  console.error(`::error::Vercel cleanup failed: ${errorDetail(err)}`);
  process.exitCode = 1;
});
