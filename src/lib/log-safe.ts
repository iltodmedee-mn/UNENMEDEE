/**
 * Text from outside (a scraped headline, a push service's error body) printed to a GitHub Actions
 * log. The runner reads every line that starts with "::" or "##[" as a workflow command, so a
 * headline carrying a line break could add a fake "::error::" annotation or more. One line, no
 * control characters: it can only ever be the tail of our own line.
 */
export function oneLine(text: unknown, max = 300): string {
  return String(text ?? "")
     
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .slice(0, max);
}

type ErrorLike = Error & { code?: unknown; status?: unknown; statusCode?: unknown; body?: unknown; error?: unknown; cause?: unknown; errors?: unknown[] };

const MAX_CAUSES = 6;

function tags(e: ErrorLike): string {
  const t = [e.code, e.status ?? e.statusCode].filter((v) => v !== undefined && v !== null && v !== "").map(String);
  return t.length ? ` [${t.join(" ")}]` : "";
}

/** The error chain as "name [code]: message ← cause …", one level per entry (newest first). */
function chain(err: unknown): { line: string; body?: string }[] {
  const out: { line: string; body?: string }[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur !== undefined && cur !== null && out.length < MAX_CAUSES && !seen.has(cur)) {
    seen.add(cur);
    if (!(cur instanceof Error)) {
      out.push({ line: typeof cur === "string" ? cur : safeJson(cur) });
      break;
    }
    const e = cur as ErrorLike;
    const body = e.body ?? (typeof e.error === "object" && e.error !== null ? e.error : undefined);
    out.push({ line: `${e.name}${tags(e)}: ${e.message || "(no message)"}`, body: body === undefined ? undefined : typeof body === "string" ? body : safeJson(body) });
    // An AggregateError (Node's connect attempts) carries its reasons in `errors`, not `cause`.
    cur = e.cause ?? (Array.isArray(e.errors) ? e.errors[0] : undefined);
  }
  return out;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * The whole error on one line for an issue line or a database column: name, code or HTTP status,
 * message, then every `cause` joined with "←" (drizzle's "Failed query: …" hides the Postgres
 * reason in `cause`; `fetch failed` hides ECONNREFUSED there). Never throws.
 */
export function errorLine(err: unknown, max = 300): string {
  return oneLine(chain(err).map((c) => c.line).join(" ← "), max);
}

/**
 * The full error for a log: the chain as in `errorLine`, one level per line, a response body when
 * the error carries one, then the first stack frames of the outermost error. Every line is
 * `oneLine`d and continuation lines start with two spaces, so printed after "::error::" nothing in
 * it can start a second workflow command. A message alone ("Connection error.", "Failed query")
 * sent people guessing; this is what to paste into a bug report.
 */
export function errorDetail(err: unknown, max = 2_000): string {
  const levels = chain(err);
  const lines: string[] = [];
  levels.forEach((l, i) => {
    lines.push(oneLine(i ? `  ← ${l.line}` : l.line, 400));
    if (l.body) lines.push(oneLine(`    body: ${l.body}`, 300));
  });
  if (err instanceof Error && typeof err.stack === "string") {
    const frames = err.stack
      .split("\n")
      .filter((f) => /^\s+at /.test(f))
      .slice(0, 5)
      .map((f) => oneLine(`    ${f.trim()}`, 200));
    lines.push(...frames);
  }
  return lines.join("\n").slice(0, max);
}
