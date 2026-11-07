"use client";

import { useSyncExternalStore } from "react";

import { useNow } from "@/lib/now-store";
import { FEED_QUIET_HOURS, hoursSince, isUbWeekend } from "@/lib/stale";

type Pulse = { activeSources: number; lastArticleAt: string | null };

/** null = not loaded yet, false = the request failed (the line is decorative: show nothing). */
let pulse: Pulse | null | false = null;
let started = false;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    // "no-cache": revalidate with the CDN every page view. The route's `stale-while-revalidate`
    // otherwise made the browser serve its copy and send a second, background request that
    // Chrome holds back for seconds (a page never reached "network idle").
    fetch("/api/pulse", { cache: "no-cache" })
      .then(async (r): Promise<Pulse | false> => (r.ok ? ((await r.json()) as Pulse) : false))
      .catch((): false => false)
      .then((p) => {
        pulse = p && typeof p.activeSources === "number" ? p : false;
        for (const l of listeners) l();
      });
  }
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The header's status line, filled in the browser from /api/pulse so the static page shells no
 * longer carry hourly data (see that route). A pulsing "live" dot over a feed that stopped hours
 * ago would claim something false, so a quiet feed gets a grey dot and the time instead.
 */
export function LiveStatus() {
  const p = useSyncExternalStore(subscribe, () => pulse, () => null);
  const now = useNow();
  if (p === false) return null;
  if (!p || !now) return <span className="label-mono text-tertiary">Систем ачаалж байна…</span>;
  const quiet = p.lastArticleAt ? hoursSince(p.lastArticleAt, new Date(now)) : 0;
  if (quiet > FEED_QUIET_HOURS) {
    return (
      <span className="label-mono flex items-center gap-2 whitespace-nowrap text-tertiary">
        <span className="inline-flex size-1.5 shrink-0 rounded-full bg-fg-quaternary" />
        <span>
          Сүүлийн мэдээ {quiet} цагийн өмнө · {p.activeSources} эх сурвалж
          {/* Saturday/Sunday in Ulaanbaatar: a quiet feed is expected. The strip is sm+ only; the long form needs lg. */}
          {isUbWeekend(now) && (
            <>
              <span className="lg:hidden"> · амралтын өдөр</span>
              <span className="hidden lg:inline"> · амралтын өдөр төрийн байгууллагууд мэдээ бага гаргадаг</span>
            </>
          )}
        </span>
      </span>
    );
  }
  return (
    <span className="label-mono flex items-center gap-2 text-brand-secondary">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-solid opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-solid" />
      </span>
      {p.activeSources} төрийн эх сурвалж хянаж байна
    </span>
  );
}
