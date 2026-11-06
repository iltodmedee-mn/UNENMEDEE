"use client";

import Link from "next/link";

import { errorDigest } from "@/lib/error-report";

/**
 * An admin page or action that failed. Admin only, so the message is shown in full: a settings
 * save that failed on the database used to land on the public error page with no detail.
 * A Server Component's error arrives with its message replaced by Next, so the digest is shown
 * too; the full text is in the Vercel function log under that digest (src/instrumentation.ts).
 */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="headline text-xl">Админ хуудас ажилласангүй</h1>
      <pre className="mt-4 overflow-x-auto rounded-xl bg-secondary p-4 text-xs text-secondary ring-1 ring-line ring-inset whitespace-pre-wrap">{message}</pre>
      {digest && (
        <p className="label-mono mt-2 text-tertiary">
          Лавлах код: <span className="num-mono select-all">{digest}</span> (Vercel-ийн function log-оос бүтэн алдааг хайх түлхүүр)
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover">
          Дахин оролдох
        </button>
        <Link href="/admin" className="rounded-lg px-4 py-2.5 text-sm font-semibold text-secondary ring-1 ring-primary hover:bg-primary_hover">
          Админ нүүр
        </Link>
      </div>
    </div>
  );
}
