"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { BadgeArt, tierColor } from "@/components/progress/badge-art";
import { Bar, Ring } from "@/components/progress/dial-row";
import { StreakStrip } from "@/components/progress/streak-strip";
import { allBadges, type BadgeState, COLLECTIONS, isSecret, TIER_NAMES, type TierKey, tierCount, tierOf } from "@/lib/badges";
import { formatNumber } from "@/lib/format";
import { LEVELS, levelOf, liveStreak, parseProgress, streakWindow } from "@/lib/progress";
import { checkBadges, markSeen, progressRaw, subscribeProgress } from "@/lib/progress-store";

const TIER_CHIP: Record<TierKey, { background: string; color: string }> = {
  b: { background: "#f3e3d6", color: "#7a4419" },
  s: { background: "#e9edf1", color: "#4a5560" },
  g: { background: "#fff1b8", color: "#6b5600" },
  p: { background: "#d6efed", color: "#035f5c" },
};

const noop = () => () => {};
const dotDate = (day: string) => day.replaceAll("-", ".");

function TierChip({ tier }: { tier: TierKey }) {
  return (
    <span className="label-mono rounded-full px-1.5 py-px text-[0.625rem]" style={TIER_CHIP[tier]}>
      {TIER_NAMES[tier]}
    </span>
  );
}

function BadgeCard({ state }: { state: BadgeState }) {
  const { badge, earned, dates, next, fraction } = state;
  const hidden = isSecret(badge) && earned === 0;
  const tier = earned > 0 ? tierOf(badge, earned - 1) : null;
  const four = badge.steps.length === 4;
  return (
    <li className="flex flex-col items-center gap-1 text-center">
      <BadgeArt badge={badge} tier={tier} size={76} className={tier ? undefined : "text-fg-quaternary"} />
      <b className="text-sm leading-tight text-primary">{hidden ? "???" : badge.name}</b>
      {tier && (
        <span className="flex flex-wrap items-center justify-center gap-1">
          {four && <TierChip tier={tier} />}
          <span className="num-mono text-[0.6875rem] text-tertiary">{dotDate(dates[earned - 1])}</span>
        </span>
      )}
      {hidden ? (
        <span className="text-xs text-tertiary">Нууц badge</span>
      ) : isSecret(badge) ? (
        <span className="px-2 text-xs leading-snug text-tertiary">{badge.how}</span>
      ) : (
        next && (
          <span className="flex w-full flex-col px-2">
            <span className="text-xs leading-snug text-tertiary">{earned === 0 || next.how !== badge.how ? next.how : `Дараагийнх: ${TIER_NAMES[next.tier]}`}</span>
            {next.need > 1 && (
              <>
                <Bar fraction={fraction} color={earned > 0 ? tierColor(next.tier) : "var(--color-fg-quaternary)"} />
                <span className="num-mono text-[0.6875rem] text-tertiary">
                  {formatNumber(next.have)} / {formatNumber(next.need)} {badge.unit}
                </span>
              </>
            )}
          </span>
        )
      )}
      {four && (
        <span aria-label={`${earned} / 4 шат`} className="flex gap-1">
          {(["b", "s", "g", "p"] as TierKey[]).map((t, i) => (
            <span key={t} className="size-1.5 rounded-full" style={i < earned ? { background: tierColor(t) } : { boxShadow: "inset 0 0 0 1px var(--color-fg-quaternary)" }} />
          ))}
        </span>
      )}
    </li>
  );
}

/** A streak milestone: its name, then the day it was reached, its day count, or (the next one) a bar. */
function StreakBadge({ state, isNext }: { state: BadgeState; isNext: boolean }) {
  const { badge, earned, dates, next, fraction } = state;
  const need = badge.steps[0].need;
  return (
    <li className="flex flex-col items-center gap-1 text-center">
      <BadgeArt badge={badge} tier={earned > 0 ? tierOf(badge, 0) : null} size={84} className={earned > 0 ? undefined : "text-fg-quaternary"} />
      <b className="text-sm leading-tight text-primary">{badge.name}</b>
      <span className="num-mono text-[0.6875rem] text-tertiary">{earned > 0 ? dotDate(dates[0]) : isNext && next ? `${next.have} / ${need} өдөр` : `${need} өдөр`}</span>
      {isNext && (
        <span className="block w-4/5">
          <Bar fraction={fraction} color={tierColor(tierOf(badge, 0))} />
        </span>
      )}
    </li>
  );
}

/**
 * /amjilt: the reader's level, streak and every badge, from their own browser (src/lib/progress.ts,
 * src/lib/badges.ts). Locked badges are silhouettes with their numbers (Reddit's achievements, the
 * owner's pick); secret ones stay "???" until earned. Nothing is sent anywhere.
 */
export function Achievements() {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(subscribeProgress, progressRaw, () => null);
  const progress = useMemo(() => parseProgress(raw), [raw]);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    markSeen();
    checkBadges(markSeen);
    const t = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(t);
  }, []);

  const states = useMemo(() => allBadges(progress), [progress]);
  if (!client || now === null) return <div aria-hidden className="h-96 animate-pulse rounded-2xl bg-secondary" />;

  const level = levelOf(progress.xp);
  const nextLevel = LEVELS[level.level];
  const tiers = tierCount(progress);
  const streak = liveStreak(progress, now);
  const ladder = states.filter((s) => s.badge.collection === "streak");
  const nextStep = ladder.find((s) => s.earned === 0) ?? null;
  const close = states
    .filter((s) => s.next && !isSecret(s.badge) && s.fraction > 0)
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Түвшин" className="flex items-center gap-4 rounded-2xl bg-primary p-4 ring-1 ring-line">
        <span className="relative grid size-16 shrink-0 place-items-center rounded-full bg-brand-solid font-display text-2xl font-extrabold text-white">
          <Ring fraction={level.fraction} color="var(--color-signal)" />
          {level.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="label-mono text-tertiary">{level.level}-р түвшин</p>
          <p className="font-display text-xl font-bold text-primary">{level.name}</p>
          <Bar fraction={level.fraction} color="var(--color-fg-brand-primary)" />
          <p className="num-mono text-xs text-secondary">
            {nextLevel ? `${formatNumber(progress.xp)} / ${formatNumber(nextLevel.xp)} XP · дараагийнх «${nextLevel.name}»` : `${formatNumber(progress.xp)} XP · хамгийн дээд түвшин`}
          </p>
          <p className="num-mono text-xs text-tertiary">
            Badge: {tiers.earned} / {tiers.total} шат · {formatNumber(progress.reads)} мэдээ уншсан
            {progress.imported > 0 && ` (${formatNumber(progress.imported)} нь өмнөх)`}
          </p>
        </div>
      </section>

      <section id="streak" aria-label="Дараалсан өдөр" className="scroll-mt-24 flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="flex items-center gap-1 font-display text-5xl leading-none font-extrabold text-primary tabular-nums">
              {streak}
              <span aria-hidden className="text-4xl">
                🔥
              </span>
            </span>
            <span className="mt-1 text-sm text-tertiary">өдөр дараалан{progress.bestStreak > streak ? ` · хамгийн урт ${progress.bestStreak}` : ""}</span>
          </div>
          <StreakStrip days={streakWindow(progress, now)} />
        </div>
        <ul className="grid grid-cols-3 gap-x-2 gap-y-6">
          {ladder.map((s) => (
            <StreakBadge key={s.badge.id} state={s} isNext={s === nextStep} />
          ))}
        </ul>
      </section>

      {close.length > 0 && (
        <section aria-label="Ойрхон байгаа badge" className="flex flex-col gap-3">
          <h2 className="label-mono text-tertiary">Ойрхон байна</h2>
          <ul className="flex flex-col gap-3">
            {close.map((s) => (
              <li key={s.badge.id} className="flex items-center gap-3 rounded-2xl bg-primary p-3 ring-1 ring-line">
                <BadgeArt badge={s.badge} tier={s.next!.tier} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-primary">
                    {s.badge.name} {s.badge.steps.length === 4 && <TierChip tier={s.next!.tier} />}
                  </p>
                  <Bar fraction={s.fraction} color={tierColor(s.next!.tier)} />
                  <p className="text-xs text-tertiary">
                    {s.next!.need > 1 ? `${formatNumber(s.next!.have)} / ${formatNumber(s.next!.need)} ${s.badge.unit} · ` : ""}
                    {s.next!.how}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {COLLECTIONS.filter((c) => c.key !== "streak").map((c) => {
        const list = states.filter((s) => s.badge.collection === c.key);
        const got = list.filter((s) => s.earned > 0).length;
        return (
          <section key={c.key} aria-label={c.label} className="flex flex-col gap-4 border-t border-line pt-4">
            <div className="flex items-baseline justify-between">
              <h2 className="label-mono text-tertiary">{c.label}</h2>
              <span className="num-mono text-xs text-tertiary">
                {got} / {list.length}
              </span>
            </div>
            <ul className="grid grid-cols-3 gap-x-2 gap-y-6">
              {list.map((s) => (
                <BadgeCard key={s.badge.id} state={s} />
              ))}
            </ul>
          </section>
        );
      })}

      <p className="border-t border-line pt-4 text-sm text-tertiary">
        Таны ахиц зөвхөн энэ төхөөрөмжийн хөтөчид хадгалагдана: бүртгэл, нэвтрэлт байхгүй, бид юу ч цуглуулдаггүй. Хөтчийн өгөгдлөө цэвэрлэвэл ахиц эхнээс нь эхэлнэ.
      </p>
    </div>
  );
}
