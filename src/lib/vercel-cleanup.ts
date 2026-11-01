/**
 * Old Vercel deployments eat the Hobby plan's 10 GB "Functions Storage" (Oct 2026: 9.96 GB, every
 * merge to main is a production deployment with its own copy of every function). This picks the
 * ones to delete: everything except the deployment serving production now, the newest few ready
 * production deployments (instant rollback), and anything still building.
 */
export interface VercelDeployment {
  uid: string;
  created: number;
  /** "production" for production deployments, null/undefined for previews. */
  target?: string | null;
  /** READY | ERROR | CANCELED | BUILDING | QUEUED | INITIALIZING */
  state?: string;
  readyState?: string;
}

const UNFINISHED = new Set(["BUILDING", "QUEUED", "INITIALIZING"]);

/**
 * Deletes nothing unless the deployment serving production is known and in the list: after a
 * rollback to an older deployment, or a failed alias lookup, "keep the newest few" alone would
 * have deleted the live site. A missing or invalid keep count (NaN from the environment) is 3,
 * not "none".
 */
export function deploymentsToDelete(all: VercelDeployment[], opts: { keepProduction: number; currentProductionId?: string | null }): VercelDeployment[] {
  const state = (d: VercelDeployment) => (d.readyState ?? d.state ?? "").toUpperCase();
  if (!opts.currentProductionId || !all.some((d) => d.uid === opts.currentProductionId)) return [];
  const keepCount = Number.isInteger(opts.keepProduction) && opts.keepProduction >= 1 ? opts.keepProduction : 3;
  const keep = new Set<string>([opts.currentProductionId]);
  all
    .filter((d) => d.target === "production" && state(d) === "READY")
    .sort((a, b) => b.created - a.created)
    .slice(0, keepCount)
    .forEach((d) => keep.add(d.uid));
  return all.filter((d) => !keep.has(d.uid) && !UNFINISHED.has(state(d)));
}
