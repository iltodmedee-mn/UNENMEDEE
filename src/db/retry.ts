/**
 * One retry for a read that failed on the connection, not on the query: on Nov 4 2026 the
 * clustering pool load (1 ms in Postgres) died with node-postgres' "Query read timeout" after
 * six minutes of AI calls, and the whole ai:process step went red. Query errors (syntax,
 * constraint, permission) are never retried.
 */
const TRANSIENT =
  /query read timeout|timeout exceeded when trying to connect|connection terminated|ECONNRESET|ETIMEDOUT|EPIPE|server closed the connection|Client has encountered a connection error/i;

/** True for an error that came from the connection (the message or its `cause`). */
export function isTransientDbError(err: unknown): boolean {
  for (
    let e: unknown = err, depth = 0;
    e && depth < 4;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    const message = e instanceof Error ? e.message : String(e);
    if (TRANSIENT.test(message)) return true;
  }
  return false;
}

/** Runs a read again once, after `waitMs`, when its first try failed on the connection. */
export async function retryTransientRead<T>(
  read: () => Promise<T>,
  waitMs = 3_000,
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    console.warn(
      `[db] ${err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : "read failed"}; retrying once`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return read();
  }
}
