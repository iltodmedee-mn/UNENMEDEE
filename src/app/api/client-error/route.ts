import { getDb, hasDatabase } from "@/db";
import { CLIENT_MAX_BODY, parseClientError, recordClientError } from "@/lib/client-errors";
import { clientIp, failureLimiter } from "@/lib/rate-limit";

/** A reader's browser reports its first JavaScript error (src/lib/client-errors.ts). Always 204. */
const perIp = failureLimiter(10, 3_600_000);

export async function POST(request: Request) {
  const done = new Response(null, { status: 204 });
  if (!hasDatabase()) return done;
  const ip = clientIp(request.headers);
  if (perIp.blocked(ip)) return done;
  perIp.fail(ip);
  const text = await request.text();
  if (text.length > CLIENT_MAX_BODY) return done;
  const e = parseClientError(text);
  if (!e) return done;
  try {
    await recordClientError(getDb(), e);
  } catch {
    // a lost report is fine; the page must never pay for it
  }
  return done;
}
