"use client";

import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import Link from "next/link";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { TOPICS } from "@/lib/topics";
import { cx } from "@/utils/cx";

import { TopicIcon } from "./topic-icon";

const DATA = TOPICS.find((t) => t.key === "data")!;
/** `color` tints the chip's icon (the topic's own hue); "Бүгд" has none. */
const ITEMS: { key: string; label: string; href: string; color?: string }[] = [
  { key: "all", label: "Бүгд", href: "/" },
  { key: "my", label: "Миний", href: "/my", color: "text-utility-amber-700" },
  { key: "digest", label: "Тойм", href: "/digest", color: "text-brand-secondary" },
  { key: "risk", label: "Эрсдэл", href: "/topic/risk", color: "text-utility-red-700" },
  // /topic/budget and /topic/ministry are feed pages too (linked from /digest's week numbers): without
  // a chip no tab was current there.
  { key: "budget", label: "₮ дүнтэй", href: "/topic/budget", color: "text-utility-yellow-700" },
  { key: "ministry", label: "Яамд", href: "/topic/ministry", color: "text-utility-blue-700" },
  ...TOPICS.filter((t) => t.key !== "data").map((t) => ({ key: t.key, label: t.label, href: `/topic/${t.key}`, color: t.color })),
  { key: "data", label: "Тоо баримт", href: "/data", color: DATA.color },
];

/** Width of the edge zone where a resting mouse scrolls the strip, and the top speed (px/frame). */
const HOVER_ZONE = 72;
const HOVER_MAX_SPEED = 12;

/**
 * Kagi-style topic tabs: a scrollable strip pinned to the bottom of the screen on phones
 * (thumb reach, swipe), inline above the list on larger screens as mono chips. Inline it has
 * ‹ › buttons at the ends, and a mouse near either edge scrolls the strip that way. The active
 * tab scrolls into view.
 */
export function TopicBar({ active, placement }: { active: string; placement: "bottom" | "inline" }) {
  const inline = placement === "inline";
  const activeRef = useRef<HTMLAnchorElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const speed = useRef(0);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  // Centre the active chip by moving the strip only: scrollIntoView also scrolls the page, so a
  // reload or Back with the strip partly off screen jumped the whole page.
  useEffect(() => {
    const el = listRef.current;
    const chip = activeRef.current;
    if (!el || !chip || el.clientWidth === 0) return;
    const box = el.getBoundingClientRect();
    const own = chip.getBoundingClientRect();
    el.scrollLeft += own.left + own.width / 2 - (box.left + box.width / 2);
    measure();
  }, [active, measure]);

  useEffect(() => {
    const el = listRef.current;
    if (!inline || !el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [inline, measure]);

  const tick = () => {
    const el = listRef.current;
    if (!el || speed.current === 0) {
      frame.current = 0;
      return;
    }
    el.scrollLeft += speed.current;
    frame.current = requestAnimationFrame(tick);
  };

  // Mouse only: the closer to an edge, the faster the strip moves toward it. Touch keeps swiping.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // Edge scrolling is motion the reader did not ask for: off under reduced motion (‹ › still work).
    if (e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const toRight = box.width - x;
    speed.current =
      x < HOVER_ZONE ? -Math.ceil(HOVER_MAX_SPEED * (1 - x / HOVER_ZONE)) : toRight < HOVER_ZONE ? Math.ceil(HOVER_MAX_SPEED * (1 - toRight / HOVER_ZONE)) : 0;
    if (speed.current !== 0 && frame.current === 0) frame.current = requestAnimationFrame(tick);
  };
  const stopHover = () => {
    speed.current = 0;
  };

  const page = (dir: 1 | -1) => {
    const el = listRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const arrow = "absolute inset-y-0 z-10 flex w-12 cursor-pointer items-center text-fg-quaternary transition hover:text-fg-secondary";
  return (
    <nav
      aria-label="Сэдвүүд"
      className={cx(
        inline ? "hidden md:block" : "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-primary/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden",
      )}
    >
      <div className="relative" onPointerMove={inline ? onPointerMove : undefined} onPointerLeave={inline ? stopHover : undefined}>
        {inline && edges.left && (
          <button type="button" tabIndex={-1} aria-label="Өмнөх сэдвүүд" onClick={() => page(-1)} className={cx(arrow, "left-0 justify-start bg-linear-to-r from-bg-primary from-40% to-transparent pl-1")}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
        )}
        <ul ref={listRef} onScroll={inline ? measure : undefined} className={cx("scrollbar-hide flex overflow-x-auto", inline ? "gap-1.5 py-3" : "scroll-fade-x gap-1 px-2")}>
          {ITEMS.map((it) => {
            const isActive = it.key === active;
            return (
              <li key={it.key} className="shrink-0">
                <Link
                  ref={isActive ? activeRef : undefined}
                  href={it.href}
                  // 15 topic pages prefetched on every visit cost ~45 KB of RSC on slow connections.
                  prefetch={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cx(
                    "relative flex items-center whitespace-nowrap transition-colors",
                    inline
                      ? cx("label-mono gap-1.5 rounded-full px-2.5 py-1.5 ring-1 ring-inset", isActive ? "bg-ink text-bg-primary ring-ink" : "text-secondary ring-line hover:bg-primary_hover hover:text-primary")
                      : cx("gap-1.5 px-3 py-3.5 text-sm", isActive ? "font-semibold text-primary" : "font-medium text-tertiary hover:text-secondary"),
                  )}
                >
                  {it.color && <TopicIcon topic={it.key} className={cx(inline ? "size-3.5" : "size-4", !(inline && isActive) && it.color)} />}
                  {it.label}
                  {!inline && isActive && <span aria-hidden className="absolute inset-x-3 bottom-1.5 h-0.5 rounded-full bg-brand-solid" />}
                </Link>
              </li>
            );
          })}
        </ul>
        {inline && edges.right && (
          <button type="button" tabIndex={-1} aria-label="Дараагийн сэдвүүд" onClick={() => page(1)} className={cx(arrow, "right-0 justify-end bg-linear-to-l from-bg-primary from-40% to-transparent pr-1")}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        )}
      </div>
    </nav>
  );
}
