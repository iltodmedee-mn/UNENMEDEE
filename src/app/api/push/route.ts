import { hasDatabase } from "@/db";
import { ipAllowed, parseSubscribeRequest } from "@/lib/push/core";
import { storeSubscription } from "@/lib/push/store";
import { clientIp } from "@/lib/rate-limit";

/**
 * The service worker's way to renew a push subscription (`pushsubscriptionchange` fires with no
 * tab open, so the page's server action cannot run). Same validation and limits as `subscribePush`
 * (`parseSubscribeRequest`, `ipAllowed`, `storeSubscription`); the body may also name the
 * `oldEndpoint` it replaces (with that subscription's `oldAuth`), whose follows move across.
 * Only JSON from this site's own pages or worker is taken: a cross-site form or `text/plain`
 * fetch could otherwise fill the hourly cap with junk rows (audit S-6).
 */
const MAX_BODY = 4_096;

/** The public VAPID key, for a worker whose old subscription carries none (it has no build-time env). */
export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  return Response.json({ key }, { headers: { "Cache-Control": "public, max-age=3600" } });
}

export async function POST(request: Request) {
  if (!hasDatabase()) return Response.json({ ok: false }, { status: 503 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return Response.json({ ok: false }, { status: 415 });
  if (!sameOrigin(request)) return Response.json({ ok: false }, { status: 403 });
  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const req = parseSubscribeRequest(body);
  if (!req) return Response.json({ ok: false }, { status: 400 });
  if (!ipAllowed(clientIp(request.headers), Date.now())) return Response.json({ ok: false }, { status: 429 });
  const stored = await storeSubscription(req.sub, req.old);
  return Response.json({ ok: stored }, { status: stored ? 200 : 503 });
}

/** The browser's Origin (or, without one, Sec-Fetch-Site) says the request came from this site. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const host = new URL(origin).host;
      return [new URL(request.url).host, request.headers.get("host"), request.headers.get("x-forwarded-host")].includes(host);
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}
