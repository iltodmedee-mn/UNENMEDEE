import Link from "next/link";

import type { GlossarySegment, GlossaryTerm } from "@/lib/glossary";

/**
 * Glossary marks in server-rendered text: a term is a native popover button (no client JS; the
 * browser opens the `popover` element `GlossaryPopovers` renders once per page). A browser without
 * the Popover API shows the button as plain underlined text.
 */
export function GlossaryText({ segments }: { segments: GlossarySegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.term ? (
          <button
            key={i}
            type="button"
            popoverTarget={`gl-${s.term.slug}`}
            className="cursor-help text-left underline decoration-brand-solid decoration-dotted decoration-2 underline-offset-[3px] hover:decoration-solid"
          >
            {s.text}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function GlossaryPopovers({ terms }: { terms: GlossaryTerm[] }) {
  if (terms.length === 0) return null;
  return (
    <>
      {terms.map((t) => (
        <div
          key={t.slug}
          id={`gl-${t.slug}`}
          popover="auto"
          className="fixed inset-x-4 top-auto bottom-4 m-0 mx-auto w-auto max-w-md rounded-2xl bg-primary p-4 text-primary shadow-lg ring-1 ring-line backdrop:bg-black/20 sm:bottom-8"
        >
          <p className="label-mono text-tertiary">Нэр томьёо</p>
          <p className="mt-1 text-lg font-semibold">{t.term}</p>
          <p className="mt-1 text-md text-secondary">{t.text}</p>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <Link href={`/glossary#${t.slug}`} prefetch={false} className="font-medium text-brand-secondary hover:underline">
              Бүх нэр томьёо →
            </Link>
            <button type="button" popoverTarget={`gl-${t.slug}`} popoverTargetAction="hide" className="rounded-md px-2 py-1 font-semibold text-tertiary hover:bg-primary_hover">
              Хаах
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
