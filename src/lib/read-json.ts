import { oneLine } from "./log-safe";

/**
 * The JSON body of a response. When a failed response is not JSON (a gateway's HTML 502, an
 * empty body), the result still has an `error.message` / `description` naming the status and the
 * first characters of what came back, so a platform wrapper's error path says that instead of
 * printing "{}". A successful response without JSON stays `{}`: the social wrappers read a
 * missing post id as "outcome unknown" and keep their row, never as a refusal (src/lib/social/outcome.ts).
 */
export async function readJsonBody<T = unknown>(res: Response): Promise<T> {
  const raw = await res.text().catch(() => "");
  if (raw.trim()) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      /* not JSON */
    }
  }
  if (res.ok) return {} as T;
  const message = `HTTP ${res.status} without a JSON body: ${oneLine(raw, 200) || "(empty)"}`;
  return { error: { message, code: res.status }, description: message, message } as T;
}
