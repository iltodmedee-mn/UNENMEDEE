"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { BadgeArt, tierColor } from "@/components/progress/badge-art";
import { Bar, Ring } from "@/components/progress/dial-row";
import { StreakStrip } from "@/components/progress/streak-strip";
import { allBadges, type BadgeState, COLLECTIONS, isSecret, TIER_NAMES, type TierKey, tierCount, tierOf } from "@/lib/badges";
import { formatNumber } from "@/lib/format";
import { LEVELS, levelOf, liveStreak, parseProgress, type Progress, streakWindow } from "@/lib/progress";
import { checkBadges, markSeen, progressRaw, subscribeProgress } from "@/lib/progress-store";

const TIER_CHIP: Record<TierKey, { background: string; color: string }> = {
  b: { background: "#f3e3d6", color: "#7a4419" },
  s: { background: "#e9edf1", color: "#4a5560" },
  g: { background: "#fff1b8", color: "#6b5600" },
  p: { background: "#d6efed", color: "#035f5c" },
};

const noop = () => () => {};
/** A bar under a tile only while a counted tier is under way (Reddit shows progress, not empty bars). */
const inProgress = (s: BadgeState) => Boolean(s.next && s.next.need > 1 && s.next.have > 0 && !isSecret(s.badge));
const dotDate = (day: string) => day.replaceAll("-", ".");

function TierChip({ tier }: { tier: TierKey }) {
  return (
    <span className="label-mono rounded-full px-1.5 py-px text-[0.625rem]" style={TIER_CHIP[tier]}>
      {TIER_NAMES[tier]}
    </span>
  );
}

/** The tile's one line under the name: the day earned, the count so far, or what it takes. */
function subline({ badge, earned, dates, next }: BadgeState, inProgress: boolean): string {
  if (earned > 0) return dotDate(dates[earned - 1]);
  if (isSecret(badge)) return "Нууц";
  if (!next || next.need <= 1) return "\u00a0";
  return inProgress ? `${formatNumber(next.have)} / ${formatNumber(next.need)} ${badge.unit}` : `${formatNumber(next.need)} ${badge.unit}`;
}

/**
 * One badge in a grid, the same shape for every badge (Reddit's grid, the owner: "symmetrical"):
 * the art, the name in a two-line box, one short line, and a bar slot that is always there, so
 * every tile in a row lines up. A tap opens its details under the grid.
 */
function BadgeTile({ state, showBar, selected, onSelect }: { state: BadgeState; showBar: boolean; selected: boolean; onSelect: () => void }) {
  const { badge, earned, next, fraction } = state;
  const hidden = isSecret(badge) && earned === 0;
  const tier = earned > 0 ? tierOf(badge, earned - 1) : null;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className={`flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-brand ${selected ? "bg-secondary" : "hover:bg-primary_hover"}`}
      >
        <BadgeArt badge={badge} tier={tier} size={84} className={tier ? undefined : "text-fg-quaternary"} />
        <b className="line-clamp-2 min-h-[2.5em] text-sm leading-tight text-primary">{hidden ? "???" : badge.name}</b>
        <span className="num-mono text-[0.6875rem] leading-none text-tertiary">{subline(state, showBar)}</span>
        <span className="block h-1.5 w-4/5">{showBar && next && <Bar fraction={fraction} color={tierColor(next.tier)} />}</span>
      </button>
    </li>
  );
}

/** What a tapped badge asks, and each of its tiers with the day reached or the count so far. */
function BadgeDetail({ state, progress, onClose }: { state: BadgeState; progress: Progress; onClose: () => void }) {
  const { badge, earned, dates } = state;
  const hidden = isSecret(badge) && earned === 0;
  const four = badge.steps.length === 4;
  const value = (i: number) => Math.min((badge.steps[i].of ?? badge.value)(progress), badge.steps[i].need);
  return (
    <div className="fade-enter flex gap-4 rounded-2xl bg-secondary p-4">
      <BadgeArt badge={badge} tier={earned > 0 ? tierOf(badge, earned - 1) : null} size={72} className={earned > 0 ? "shrink-0" : "shrink-0 text-fg-quaternary"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-primary">{hidden ? "Нууц badge" : badge.name}</p>
          <button type="button" onClick={onClose} aria-label="Хаах" className="-mt-1 -mr-1 rounded-lg p-1 text-fg-quaternary hover:bg-primary_hover">
            ✕
          </button>
        </div>
        <p className="text-sm text-secondary">{hidden ? "Нөхцөл нь авсны дараа харагдана." : badge.how}</p>
        {!hidden && (
          <ul className="mt-2 flex flex-col gap-1">
            {badge.steps.map((step, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-tertiary">
                {four && <TierChip tier={tierOf(badge, i)} />}
                <span className="num-mono">
                  {formatNumber(step.need)} {badge.unit}
                </span>
                <span className="num-mono ml-auto">{i < earned ? `✓ ${dotDate(dates[i])}` : `${formatNumber(value(i))} / ${formatNumber(step.need)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A grid of badge tiles with the tapped one's details under it. */
function BadgeGrid({ list, progress, barFor, selected, onSelect }: { list: BadgeState[]; progress: Progress; barFor: (s: BadgeState) => boolean; selected: string | null; onSelect: (id: string | null) => void }) {
  const open = list.find((s) => s.badge.id === selected) ?? null;
  return (
    <>
      <ul className="grid grid-cols-3 gap-x-1 gap-y-3">
        {list.map((s) => (
          <BadgeTile key={s.badge.id} state={s} showBar={barFor(s)} selected={s.badge.id === selected} onSelect={() => onSelect(s.badge.id === selected ? null : s.badge.id)} />
        ))}
      </ul>
      {open && <BadgeDetail state={open} progress={progress} onClose={() => onSelect(null)} />}
    </>
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
  const [selected, setSelected] = useState<string | null>(null);

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
        <BadgeGrid list={ladder} progress={progress} barFor={(s) => s === nextStep} selected={selected} onSelect={setSelected} />
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
            <BadgeGrid list={list} progress={progress} barFor={inProgress} selected={selected} onSelect={setSelected} />
          </section>
        );
      })}

      <p className="border-t border-line pt-4 text-sm text-tertiary">
        Таны ахиц зөвхөн энэ төхөөрөмжийн хөтөчид хадгалагдана: бүртгэл, нэвтрэлт байхгүй, бид юу ч цуглуулдаггүй. Хөтчийн өгөгдлөө цэвэрлэвэл ахиц эхнээс нь эхэлнэ.
      </p>
    </div>
  );
}
