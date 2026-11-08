"use client";

import { useEffect } from "react";

import { pageOf, recordFlag, recordItem, recordPage } from "@/lib/progress";
import { applyProgress } from "@/lib/progress-store";

/** A section page counts after this long on screen, like a counted read. */
export const PAGE_SECONDS = 15;
/** A list row (`data-progress-item="tender:123"`) counts after this long mostly on screen. */
const ROW_MS = 2_000;
/** Rows stream in under Suspense: look for them this many seconds after a page opens. */
const ROW_SCAN_SECONDS = 10;

/**
 * Renders nothing, in the layout: counts the pages and rows badges follow (src/lib/progress.ts
 * pageOf: /budget, /promises, an MP's page, an archive day…, tender rows) and the one-time actions
 * marked `data-progress-flag` (the information-request letter copied or sent). One tick a second,
 * only while the tab is visible; nothing leaves the browser.
 */
export function PageMeter() {
  useEffect(() => {
    let path = "";
    let age = 0;
    let counted = true;
    const timers = new Map<Element, number>();
    let watched = new WeakSet<Element>();
    const rows = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          window.clearTimeout(timers.get(entry.target));
          timers.delete(entry.target);
          if (!entry.isIntersecting) continue;
          const [kind, id] = (entry.target.getAttribute("data-progress-item") ?? "").split(":");
          if (!kind || !id) continue;
          const el = entry.target;
          timers.set(
            el,
            window.setTimeout(() => {
              rows.unobserve(el);
              applyProgress((p) => recordItem(p, { kind, id, now: Date.now() }));
            }, ROW_MS),
          );
        }
      },
      { threshold: 0.6 },
    );

    const tick = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (location.pathname !== path) {
        path = location.pathname;
        age = 0;
        const page = pageOf(path);
        counted = !page.section && !page.item;
        rows.disconnect();
        for (const t of timers.values()) window.clearTimeout(t);
        timers.clear();
        watched = new WeakSet();
      }
      age++;
      if (age <= ROW_SCAN_SECONDS) {
        for (const el of document.querySelectorAll("[data-progress-item]")) {
          if (watched.has(el)) continue;
          watched.add(el);
          rows.observe(el);
        }
      }
      if (!counted && age >= PAGE_SECONDS) {
        counted = true;
        const at = path;
        applyProgress((p) => recordPage(p, { path: at, now: Date.now() }));
      }
    }, 1_000);

    const onClick = (e: MouseEvent) => {
      const flag = (e.target as Element | null)?.closest?.("[data-progress-flag]")?.getAttribute("data-progress-flag");
      if (flag) applyProgress((p) => recordFlag(p, flag));
    };
    document.addEventListener("click", onClick);

    return () => {
      window.clearInterval(tick);
      rows.disconnect();
      for (const t of timers.values()) window.clearTimeout(t);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
