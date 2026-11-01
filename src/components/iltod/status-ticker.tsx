"use client";

import { useEffect, useState } from "react";

import { timeAgoMn } from "@/lib/format";
import { useLocalStorage } from "@/lib/local-store";
import { useNow } from "@/lib/now-store";
import { parseIds, READ_KEY } from "@/lib/read-state";
import { FEED_QUIET_HOURS, hoursSince } from "@/lib/stale";
import { nextRunLabel } from "@/lib/ticker";
import { cx } from "@/utils/cx";

const ROTATE_MS = 4_000;

/**
 * Kagi-style status line under the date: the stats line (rendered on the server, so the first
 * paint is unchanged), then "updated … ago", "next check in …", today's count and the reader's
 * own read count, one every 4 s. Click or tap to advance; hover pauses.
 */
export function StatusTicker({ stats, lastArticleAt, todayArticles }: { stats: string; lastArticleAt: string | null; todayArticles: number }) {
  const time = useNow();
  const [raw] = useLocalStorage(READ_KEY, "[]");
  const read = parseIds(raw).size;
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);

  const messages = [stats];
  if (time) {
    // A quiet feed says how long it has been quiet, and makes no promise about the next check.
    const quiet = hoursSince(lastArticleAt, new Date(time)) > FEED_QUIET_HOURS;
    if (lastArticleAt) messages.push(quiet ? `Сүүлийн мэдээ ${timeAgoMn(lastArticleAt, time).toLowerCase()}` : `Шинэчилсэн: ${timeAgoMn(lastArticleAt, time).toLowerCase()}`);
    if (!quiet) messages.push(`Дараагийн шалгалт: ${nextRunLabel(time)} дараа`);
    if (todayArticles > 0) messages.push(`Өнөөдөр ${todayArticles} шинэ мэдээ`);
    if (read > 0) messages.push(`Та ${read} мэдээ уншсан`);
  }
  const current = messages[step % messages.length];

  useEffect(() => {
    // Readers who asked for reduced motion get no automatic rotation (a tap still moves it on).
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setStep((s) => s + 1);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <button
      type="button"
      onClick={() => setStep((s) => s + 1)}
      // Mouse only: a tap fires enter without leave and would pause the line for good.
      onPointerEnter={(e) => e.pointerType === "mouse" && setPaused(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setPaused(false)}
      // Keyboard focus pauses it too, so the line a reader tabbed to does not change under them.
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-label={messages.join(". ")}
      className="label-mono mt-2 block h-4 w-full cursor-pointer overflow-hidden text-left text-tertiary"
    >
      <span
        key={step}
        aria-hidden
        // The first message is already on the page: animate only the ones that replace it.
        className={cx("block truncate", step > 0 && "rise-enter")}
      >
        {current}
      </span>
    </button>
  );
}
