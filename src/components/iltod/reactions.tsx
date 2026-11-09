"use client";

import { Flag05 } from "@untitledui/icons";
import Link from "next/link";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

import { ReactionFace } from "@/components/iltod/reaction-faces";
import { track } from "@/lib/track";
import { COUNTS_CACHE_S, EMOJI_KINDS, type EmojiKind, REACTION_KINDS, REACTION_LABELS, type ReactionCounts, type ReactionKind } from "@/lib/reaction-kinds";
import { cx } from "@/utils/cx";

/** This browser's taps, by article id: one face per story, plus «Залруулга байна». */
const STORE_KEY = "iltod-reactions";
const MAX_REMEMBERED = 400;

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
const isEmoji = (k: ReactionKind): k is EmojiKind => (EMOJI_KINDS as readonly string[]).includes(k);
const kindAt = (x: number, y: number): EmojiKind | null => {
  const k = (document.elementFromPoint(x, y)?.closest("[data-kind]") as HTMLElement | null)?.dataset.kind;
  return k && isEmoji(k as ReactionKind) ? (k as EmojiKind) : null;
};

/**
 * «Энэ мэдээ танд ямар санагдав?»: the site's six faces under a story, no account (the owner's
 * mockup, Nov 2026). A finger held on a face grows it and shows its name above; sliding moves to the
 * next face; lifting the finger counts it, and a scroll cancels. A mouse shows the name on hover and
 * counts on click. One face per story and browser; «Залруулга байна» is separate and links to the
 * corrections page. Counts reach everyone from a CDN-cached answer (src/lib/reactions.ts), fetched
 * when the row scrolls into view and every COUNTS_CACHE_S seconds while the tab is visible.
 */
export function Reactions({ articleId }: { articleId: number }) {
  const [mine, setMine] = useState<ReactionKind[]>([]);
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pressed, setPressed] = useState<EmojiKind | null>(null);
  // The face this reader just tapped pops once; one restored from an earlier visit does not.
  const [popped, setPopped] = useState<ReactionKind | null>(null);
  const box = useRef<HTMLElement>(null);

  const face = mine.find(isEmoji) ?? null;

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
          // A cached answer can be older than this reader's own tap: never count down.
          if (isCounts(v)) setCounts((c) => (c ? (Object.fromEntries(REACTION_KINDS.map((k) => [k, Math.max(c[k], v[k])])) as ReactionCounts) : v));
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
    if (busy || mine.includes(kind) || (isEmoji(kind) && face)) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/react", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: articleId, kind }) });
      const v: unknown = res.ok ? await res.json() : null;
      if (!isCounts(v)) throw new Error(String(res.status));
      setCounts(v);
      remember(articleId, kind);
      setMine((m) => [...m, kind]);
      setPopped(kind);
      track("Reaction", { kind, story: articleId });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // Touch: hold, slide, lift. The pointer capture is released so moving onto the next face follows the finger.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || face) return;
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* no capture to release (some browsers): sliding then stays on the first face */
    }
    setPressed(kindAt(e.clientX, e.clientY));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || pressed === null) return;
    setPressed(kindAt(e.clientX, e.clientY));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    const k = pressed;
    setPressed(null);
    if (k) tap(k);
  };

  return (
    <section ref={box} aria-label="Энэ мэдээнд өгөх хариу үйлдэл" className="flex flex-col gap-2 rounded-2xl bg-primary p-4 ring-1 ring-line sm:p-5">
      <h2 className="font-display text-lg leading-tight font-bold text-primary sm:text-xl">Энэ мэдээ танд ямар санагдав?</h2>
      <div
        role="group"
        aria-label="Хариу үйлдэл"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setPressed(null)}
        onContextMenu={(e) => e.preventDefault()}
        className="flex touch-pan-y items-end justify-between gap-0.5 pt-8 select-none [-webkit-touch-callout:none] sm:gap-1"
      >
        {EMOJI_KINDS.map((kind) => {
          const chosen = face === kind;
          const big = pressed === kind;
          return (
            <button
              key={kind}
              type="button"
              data-kind={kind}
              aria-pressed={chosen}
              aria-label={`${REACTION_LABELS[kind]}${counts ? `, ${counts[kind]}` : ""}`}
              disabled={busy || (face !== null && !chosen)}
              // Mouse and keyboard; touch counts on lift (onUp above).
              onClick={(e) => {
                if ((e.nativeEvent as PointerEvent).pointerType && (e.nativeEvent as PointerEvent).pointerType !== "mouse") return;
                tap(kind);
              }}
              className={cx(
                "group relative flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand",
                face !== null && !chosen && "opacity-45",
              )}
            >
              <span
                className={cx(
                  // Above the grown face, inside the row's top padding: never over the heading or the face.
                  "pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary-solid px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white shadow-md transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none",
                  big ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
                )}
              >
                {REACTION_LABELS[kind]}
              </span>
              <span className={cx("flex", popped === kind && chosen && "flame-pop")}>
                <ReactionFace
                  kind={kind}
                  className={cx(
                    // A slight overshoot (spring-like) so the grow and the slide between faces feel soft.
                    "size-10 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] will-change-transform motion-reduce:transition-none min-[380px]:size-11 sm:size-12 dark:drop-shadow-[0_0_1.5px_rgba(255,255,255,0.6)]",
                    big ? "-translate-y-1.5 scale-140" : "group-hover:-translate-y-1 group-hover:scale-110",
                  )}
                />
              </span>
              <span className={cx("num-mono min-h-4 text-sm leading-none tabular-nums", chosen ? "font-bold text-brand-secondary" : "text-secondary", !counts && "invisible")}>
                {counts ? counts[kind] : 0}
              </span>
              <span aria-hidden className={cx("h-0.5 w-6 rounded-full", chosen ? "bg-brand-solid" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
      {failed && <p className="text-sm font-semibold text-error-primary">Бүртгэж чадсангүй. Дараа дахин оролдоно уу.</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-sm font-semibold">
        <button
          type="button"
          onClick={() => tap("correction")}
          aria-pressed={mine.includes("correction")}
          disabled={busy || mine.includes("correction")}
          className={cx("inline-flex min-h-10 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-brand", mine.includes("correction") ? "text-error-primary" : "text-secondary hover:text-primary")}
        >
          <Flag05 aria-hidden className="size-5" />
          {mine.includes("correction") ? "Залруулга тэмдэглэгдлээ" : "Залруулга байна, бидэнд мэдэгдэх"}
          {counts && counts.correction > 0 && <span className="num-mono text-xs text-tertiary">{counts.correction}</span>}
        </button>
        {mine.includes("correction") && (
          <Link href="/about#corrections" prefetch={false} className="text-brand-secondary underline underline-offset-4">
            Юу буруу байгааг бичих →
          </Link>
        )}
      </div>
    </section>
  );
}
