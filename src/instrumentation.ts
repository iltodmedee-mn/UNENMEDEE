import type { Instrumentation } from "next";

import { errorDetail } from "@/lib/log-safe";

/**
 * Every server-side render or route error, with its cause chain, stack and the request path, in
 * the Vercel function log, keyed by the `digest` the error page shows the reader ("Лавлах код").
 * Before this a failed page left one generic line and a reader's report could not be matched to
 * it. No header or body is printed. The route and the first message line are also counted in
 * `site_errors` (src/lib/site-errors.ts) so the watchdog can report a failing page.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest?: unknown }).digest ?? "") : "";
  const where = `${request.method} ${request.path}`.slice(0, 300);
  console.error(`[request-error]${digest ? ` digest=${digest}` : ""} ${where} (${context.routerKind} ${context.routeType}${context.routePath ? ` ${context.routePath}` : ""}): ${errorDetail(err)}`);
  // Counted for the watchdog; never during a build and never allowed to throw.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build" || !process.env.DATABASE_URL) return;
  try {
    const [{ getDb }, { recordSiteError }] = await Promise.all([import("@/db"), import("@/lib/site-errors")]);
    await recordSiteError(getDb(), { method: request.method, path: request.path, routePath: context.routePath, err, digest });
  } catch {
    // the log line above is enough
  }
};
