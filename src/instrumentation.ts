import type { Instrumentation } from "next";

import { errorDetail } from "@/lib/log-safe";

/**
 * Every server-side render or route error, with its cause chain, stack and the request path, in
 * the Vercel function log, keyed by the `digest` the error page shows the reader ("Лавлах код").
 * Before this a failed page left one generic line and a reader's report could not be matched to
 * it. Nothing is stored and nothing leaves the log; no header or body is printed.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest?: unknown }).digest ?? "") : "";
  const where = `${request.method} ${request.path}`.slice(0, 300);
  console.error(`[request-error]${digest ? ` digest=${digest}` : ""} ${where} (${context.routerKind} ${context.routeType}${context.routePath ? ` ${context.routePath}` : ""}): ${errorDetail(err)}`);
};
