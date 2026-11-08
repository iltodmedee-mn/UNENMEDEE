"use client";

import { useMemo } from "react";

import { BadgeArt, tierColor } from "@/components/progress/badge-art";
import { Bar, DIAL_WIDTHS, DialRow, Ring } from "@/components/progress/dial-row";
import { nextBadge, TIER_NAMES } from "@/lib/badges";
import { formatNumber } from "@/lib/format";
import type { Progress } from "@/lib/progress";

/**
 * The dial's badge row: the open badge closest to its next tier ("Баримт шалгагч 18 / 25"). Loaded
 * with the badge rules only when the dial opens (next/dynamic in back-to-top.tsx).
 */
export function DialBadge({ progress, delay, onGo }: { progress: Progress; delay: number; onGo: () => void }) {
  const state = useMemo(() => nextBadge(progress), [progress]);
  if (!state?.next) {
    return (
      <DialRow href="/amjilt" onClick={onGo} delay={delay} width={DIAL_WIDTHS[0]} circle={<span className="grid size-11 place-items-center rounded-full bg-primary text-lg ring-1 ring-line">🏅</span>}>
        <b className="block text-primary">Бүх badge авсан</b>
        <span className="text-xs font-semibold text-brand-secondary">Бүгдийг харах →</span>
      </DialRow>
    );
  }
  const { badge, next, fraction } = state;
  const color = tierColor(next.tier);
  const four = badge.steps.length === 4;
  return (
    <DialRow
      href="/amjilt"
      onClick={onGo}
      delay={delay}
      width={DIAL_WIDTHS[0]}
      circle={
        <span className="grid size-11 place-items-center rounded-full bg-primary ring-1 ring-line">
          <Ring fraction={fraction} color={color} />
          <BadgeArt badge={badge} tier={next.tier} size={34} />
        </span>
      }
    >
      <b className="block text-primary">Дараагийн badge: {badge.name}</b>
      <Bar fraction={fraction} color={color} />
      <span className="block text-xs text-tertiary">
        {next.need > 1 ? `${formatNumber(next.have)} / ${formatNumber(next.need)} ${badge.unit}` : next.how}
        {four && ` · ${TIER_NAMES[next.tier]}`}
        {" · "}
        <span className="font-semibold text-brand-secondary">Бүгдийг харах →</span>
      </span>
    </DialRow>
  );
}
