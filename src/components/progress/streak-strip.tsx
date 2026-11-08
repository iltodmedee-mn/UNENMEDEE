import type { DayMark } from "@/lib/progress";

export const STREAK_ORANGE = "#ff6a3d";

function Flame({ lit, size }: { lit: boolean; size: number }) {
  return (
    <svg aria-hidden viewBox="0 0 32 32" width={size} height={size}>
      <path fill={lit ? "#fff3d6" : "currentColor"} fillOpacity={lit ? 1 : 0.35} d="M17 3c1 6 8 8.5 8 16a9 9 0 0 1-18 0c0-4.5 2.5-7 5-9 0 3.5 1.2 5 3.4 6C15 11 14.5 7 17 3z" />
    </svg>
  );
}

const LABEL: Record<DayMark, string> = {
  read: "уншсан",
  missed: "уншаагүй",
  "today-read": "өнөөдөр уншсан",
  "today-open": "өнөөдөр",
  future: "ирэх өдөр",
};

/**
 * Two days back, today and two ahead, each a flame in a circle (Reddit's streak strip, the owner's
 * pick, Nov 2026): orange when read, a ring around today, grey ahead. `small` is the dial's size.
 */
export function StreakStrip({ days, small = false }: { days: { day: string; date: number; mark: DayMark }[]; small?: boolean }) {
  const dot = small ? "size-6" : "size-9";
  return (
    <ol className={`flex ${small ? "gap-1.5" : "gap-2"}`}>
      {days.map((d) => {
        const lit = d.mark === "read" || d.mark === "today-read";
        const today = d.mark.startsWith("today");
        return (
          <li key={d.day} className="flex flex-col items-center gap-1" aria-label={`${d.date}: ${LABEL[d.mark]}`}>
            {!small && (
              <span className="num-mono text-[0.6875rem]" style={{ color: lit || today ? STREAK_ORANGE : undefined }}>
                {d.date}
              </span>
            )}
            <span
              className={`grid ${dot} place-items-center rounded-full text-fg-quaternary ${lit ? "" : "bg-secondary"}`}
              style={{ ...(lit ? { background: STREAK_ORANGE } : {}), ...(today ? { boxShadow: `0 0 0 2px var(--color-bg-primary), 0 0 0 ${small ? 3.5 : 4}px ${STREAK_ORANGE}` } : {}) }}
            >
              <Flame lit={lit} size={small ? 14 : 18} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
