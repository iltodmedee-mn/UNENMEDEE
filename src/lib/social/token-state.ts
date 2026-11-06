import { createHash } from "node:crypto";

/**
 * A refreshable 60-day token (Threads, Instagram) kept in app_settings. The GitHub secret only
 * seeds it: the pipeline refreshes the stored copy weekly, and a new secret value (a different
 * sha256 `seed`) replaces the stored state.
 */
export interface TokenState {
  token: string;
  refreshedAt: string;
  seed: string;
}

/** Refresh well before the 60-day expiry (a token must be 24 h old to be refreshed). */
export const REFRESH_AFTER_DAYS = 7;

export function seedOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Which token to use: a new secret wins over the stored state, else the state. No secret = the
 * platform is off: deleting the secret must stop posting, not leave a stored token refreshed forever.
 */
export function currentState(stored: TokenState | null, envToken: string | undefined, now = new Date()): TokenState | null {
  const env = envToken?.trim();
  if (!env) return null;
  // A new secret's real age is unknown (a 55-day-old token pasted today would have expired before
  // its first refresh a week later): dated so the first refresh comes the next day, once the
  // platform allows it (a token must be 24 h old), and the 60 days restart from then.
  if (!stored || stored.seed !== seedOf(env)) return { token: env, refreshedAt: new Date(now.getTime() - (REFRESH_AFTER_DAYS - 1) * 86_400_000).toISOString(), seed: seedOf(env) };
  return stored;
}

export function needsRefresh(state: TokenState, now = new Date()): boolean {
  return now.getTime() - new Date(state.refreshedAt).getTime() > REFRESH_AFTER_DAYS * 86_400_000;
}

/** A refresh failure is only a warning while the stored token is younger than this. */
export const REFRESH_ERROR_AFTER_DAYS = 45;

/**
 * How loud a failed refresh should be: the token still has weeks left → "warning" (the next run
 * tries again); past 45 days the 60-day expiry is close and the step turns red → "error", so the
 * failure shows in the run list instead of being retried quietly until the platform dies.
 */
export function refreshSeverity(state: TokenState, now = new Date()): "warning" | "error" {
  return now.getTime() - new Date(state.refreshedAt).getTime() > REFRESH_ERROR_AFTER_DAYS * 86_400_000 ? "error" : "warning";
}
