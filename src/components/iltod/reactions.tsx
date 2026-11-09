"use client";

import { Flag05, HelpCircle, ThumbsUp } from "@untitledui/icons";
import Link from "next/link";
import { type ComponentType, useEffect, useRef, useState } from "react";

import { COUNTS_CACHE_S, REACTION_KINDS, REACTION_LABELS, type ReactionCounts, type ReactionKind } from "@/lib/reaction-kinds";
import { cx } from "@/utils/cx";

/** This browser's taps, by article id: a reader counts once per story and kind. */
const STORE_KEY = "iltod-reactions";
const MAX_REMEMBERED = 400;

/** The site's own line icons (Untitled UI), tinted per kind like the rest of the ledger. */
const ICONS: Record<ReactionKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  useful: ThumbsUp,
  doubt: HelpCircle,
  correction: Flag05,
};
const ON: Record<ReactionKind, string> = {
  useful: "bg-brand-solid text-white ring-transparent",
  doubt: "bg-warning-solid text-white ring-transparent",
  correction: "bg-error-solid text-white ring-transparent",
};

function readStore(): Record<string, ReactionKind[]> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, ReactionKind[]>) : {};
  } catch {
    return {};
  }
}

function remember(id: number, kind: ReactionKind): void {
  try {
    const all = readStore();
    all[id] = [...new Set([...(Array.isArray(all[id]) ? all[id] : []), kind])];
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode: the server's per-IP limit still applies */
  }
}

const isCounts = (v: unknown): v is ReactionCounts => !!v && typeof v === "object" && REACTION_KINDS.every((k) => typeof (v as ReactionCounts)[k] === "number");

/**
 * «Энэ мэдээ танд ямар байв?»: three taps under a story, no account. Everyone sees the counts:
 * fetched when the row scrolls into view and again every COUNTS_CACHE_S seconds while the tab is
 * visible, from a CDN-cached answer (the database is read at most once a minute per story). A tap
 * answers fresh counts at once. The count slot is always there, so nothing shifts when it fills.
 */
export function Reactions({ articleId }: { articleId: number }) {
  const [mine, setMine] = useState<ReactionKind[]>([]);
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const [busy, setBusy] = useState<ReactionKind | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const saved = readStore()[articleId];
    const t = window.setTimeout(() => setMine(Array.isArray(saved) ? saved.filter((k) => (REACTION_KINDS as readonly string[]).includes(k)) : []), 0);
    return () => window.clearTimeout(t);
  }, [articleId]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let timer = 0;
    let inView = false;
    const load = () => {
      if (document.visibilityState !== "visible" || !inView) return;
      fetch(`/api/react?id=${articleId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((v: unknown) => {
          if (isCounts(v)) setCounts((c) => (c ? { useful: Math.max(c.useful, v.useful), doubt: Math.max(c.doubt, v.doubt), correction: Math.max(c.correction, v.correction) } : v));
        })
        .catch(() => {});
    };
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      window.clearInterval(timer);
      if (inView) {
        load();
        timer = window.setInterval(load, COUNTS_CACHE_S * 1000);
      }
    });
    io.observe(el);
    document.addEventListener("visibilitychange", load);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [articleId]);

  async function tap(kind: ReactionKind) {
    if (mine.includes(kind) || busy) return;
    setBusy(kind);
    setFailed(false);
    try {
      const res = await fetch("/api/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: articleId, kind }) });
      const v: unknown = res.ok ? await res.json() : null;
      if (!isCounts(v)) throw new Error(String(res.status));
      setCounts(v);
      remember(articleId, kind);
      setMine((m) => [...m, kind]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section ref={box} aria-label="Энэ мэдээнд өгөх үнэлгээ" className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="label-mono text-tertiary">Энэ мэдээ танд ямар байв?</p>
      <div className="flex flex-wrap gap-2">
        {REACTION_KINDS.map((kind) => {
          const Icon = ICONS[kind];
          const on = mine.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => tap(kind)}
              aria-pressed={on}
              disabled={busy !== null}
              className={cx(
                "inline-flex min-h-10 items-center gap-1.5 rounded-full py-1 pr-3 pl-3 text-sm font-semibold ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                on ? ON[kind] : "bg-primary text-secondary ring-line hover:bg-primary_hover",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {REACTION_LABELS[kind]}
              <span className={cx("num-mono min-w-[2ch] text-right text-xs tabular-nums", on ? "text-white/85" : "text-tertiary", !counts && "invisible")}>{counts ? counts[kind] : 0}</span>
            </button>
          );
        })}
      </div>
      {failed && <p className="text-xs text-error-primary">Бүртгэж чадсангүй. Дараа дахин оролдоно уу.</p>}
      {mine.includes("correction") && (
        <p className="text-sm text-secondary">
          Юу буруу байгааг бидэнд бичээрэй:{" "}
          <Link href="/about#corrections" prefetch={false} className="font-semibold text-brand-secondary underline underline-offset-4">
            Алдаа, залруулга
          </Link>
        </p>
      )}
    </section>
  );
}
