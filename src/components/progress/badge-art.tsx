import { useId } from "react";

import { type Badge, type Collection, COLLECTIONS, type Glyph, isSecret, type Shape, type TierKey } from "@/lib/badges";

/**
 * A badge drawn in SVG (the owner's mockup, Nov 2026): the collection gives the shape and colour,
 * the tier the rim (хүрэл, мөнгө, алт, ил тод), and алт / ил тод add a ring of хээ squares. A badge
 * not earned yet is a flat silhouette in the text colour (it works in both themes); a secret one
 * shows a lock until it is earned.
 */
const SHAPES: Record<Shape, string> = {
  circle: '<circle cx="60" cy="60" r="46"/>',
  hex: '<path d="M60 12l42 24v48l-42 24-42-24V36z"/>',
  shield: '<path d="M60 12l40 14v30c0 26-17 42-40 52-23-10-40-26-40-52V26z"/>',
  diamond: '<path d="M60 10l50 50-50 50-50-50z"/>',
  star: '<path d="M60 10l12 16 20-4-2 20 16 12-16 12 2 20-20-4-12 16-12-16-20 4 2-20-16-12 16-12-2-20 20 4z"/>',
};

const GLYPHS: Record<Glyph, string> = {
  eye: '<path d="M34 60c8-12 17-18 26-18s18 6 26 18c-8 12-17 18-26 18s-18-6-26-18z"/><circle cx="60" cy="60" r="8"/>',
  mag: '<circle cx="55" cy="55" r="15"/><path d="M66 66l13 13"/>',
  doc: '<path d="M46 38h20l10 10v34H46z"/><path d="M66 38v10h10"/><path d="M52 64l6 6 12-13"/>',
  coin: '<circle cx="60" cy="60" r="20"/><path d="M55 49v22M55 49h11M51 57l13-4M51 63l13-4"/>',
  scale: '<path d="M60 38v40M48 80h24M42 46h36"/><path d="M42 46l-8 16h16zM78 46l-8 16h16z"/>',
  flame: '<path d="M60 36c10 12 16 18 13 30a13 13 0 0 1-26 0c-1-8 4-13 7-19 2 6 6 9 6 9 2-7 2-13 0-20z"/>',
  compass: '<circle cx="60" cy="60" r="20"/><path d="M68 52l-5 13-11 3 5-13z"/>',
  scroll: '<path d="M44 42h28a6 6 0 0 1 6 6v30H50a6 6 0 0 1-6-6z"/><path d="M52 54h18M52 62h18M52 70h12"/>',
  build: '<path d="M38 50l22-12 22 12z"/><path d="M42 54v20M52 54v20M68 54v20M78 54v20M36 78h48"/>',
  mega: '<path d="M40 54h10l22-12v36L50 66H40z"/><path d="M48 66l4 12"/>',
  mail: '<rect x="38" y="44" width="44" height="32" rx="3"/><path d="M38 47l22 16 22-16"/>',
  pin: '<path d="M60 82s-16-16-16-28a16 16 0 0 1 32 0c0 12-16 28-16 28z"/><circle cx="60" cy="54" r="6"/>',
  book: '<path d="M38 44c8-3 15-3 22 2v34c-7-5-14-5-22-2zM82 44c-8-3-15-3-22 2v34c7-5 14-5 22-2z"/>',
  cal: '<rect x="40" y="42" width="40" height="36" rx="4"/><path d="M40 52h40M50 38v8M70 38v8"/><path d="M52 66l5 5 11-11"/>',
  sun: '<circle cx="60" cy="62" r="10"/><path d="M60 42v6M60 76v6M40 62h6M74 62h6M46 48l4 4M70 72l4 4M74 48l-4 4M46 76l4-4"/>',
  moon: '<path d="M70 42a20 20 0 1 0 8 30 16 16 0 0 1-8-30z"/>',
  lock: '<rect x="46" y="56" width="28" height="22" rx="3"/><path d="M52 56v-6a8 8 0 0 1 16 0v6"/>',
  two: '<circle cx="52" cy="58" r="12"/><circle cx="68" cy="62" r="12"/>',
  tag: '<path d="M42 44h18l20 20-16 16-22-22z"/><circle cx="51" cy="53" r="3"/>',
  bell: '<path d="M46 72V58a14 14 0 0 1 28 0v14l4 6H42z"/><path d="M56 82a4 4 0 0 0 8 0"/>',
  phone: '<rect x="48" y="38" width="24" height="44" rx="4"/><path d="M56 74h8"/>',
  bolt: '<path d="M64 36L46 64h14l-4 20 18-28H60z"/>',
  star: '<path d="M60 38l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2z"/>',
  back: '<path d="M50 48l-10 10 10 10"/><path d="M40 58h26a12 12 0 0 1 0 24h-6"/>',
  warn: '<path d="M60 40l22 38H38z"/><path d="M60 54v12M60 72v1"/>',
  news: '<rect x="40" y="42" width="40" height="36" rx="3"/><path d="M48 52h24M48 60h24M48 68h14"/>',
  diff: '<path d="M78 56a18 18 0 0 0-32-8M42 64a18 18 0 0 0 32 8"/><path d="M46 40v8h8M74 80v-8h-8"/>',
  receipt: '<path d="M46 38h28v44l-5-4-5 4-4-4-5 4-4-4-5 4z"/><path d="M52 50h16M52 58h16M52 66h10"/>',
  flag: '<path d="M48 82V38"/><path d="M48 40c10-4 16 4 26 0v20c-10 4-16-4-26 0"/>',
  spark: '<path d="M60 38v44M38 60h44M45 45l30 30M75 45L45 75"/>',
  target: '<circle cx="60" cy="60" r="20"/><circle cx="60" cy="60" r="10"/><circle cx="60" cy="60" r="1.5"/>',
};

const FILLS: Record<Collection, [string, string]> = {
  start: ["#3b6fd4", "#24479a"],
  read: ["#0a8f88", "#035f5c"],
  check: ["#2b2d31", "#121314"],
  money: ["#ffd400", "#c79a00"],
  state: ["#8a1d2c", "#5e1019"],
  habit: ["#ff6a3d", "#c43d14"],
  explore: ["#3f8a4f", "#245c31"],
  secret: ["#55565c", "#2b2d31"],
};

const RIMS: Record<TierKey, [string, string]> = {
  b: ["#c98a55", "#8a4f22"],
  s: ["#c9d1d9", "#6b7680"],
  g: ["#ffd400", "#a07c00"],
  p: ["#3fc1b8", "#035f5c"],
};

/** The rim colour of a tier, for rings and bars next to a badge. */
export const tierColor = (tier: TierKey) => RIMS[tier][0];

/** Twenty small squares around the badge: the хээ ring of алт and ил тод. */
function heeRing(color: string): string {
  let out = "";
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const x = 60 + 53 * Math.cos(a);
    const y = 60 + 53 * Math.sin(a);
    out += `<rect x="${(x - 2.2).toFixed(1)}" y="${(y - 2.2).toFixed(1)}" width="4.4" height="4.4" transform="rotate(${((a * 180) / Math.PI + 45).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${color}"/>`;
  }
  return out;
}

export function BadgeArt({ badge, tier, size = 96, className }: { badge: Badge; tier: TierKey | null; size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shape = SHAPES[COLLECTIONS.find((c) => c.key === badge.collection)?.shape ?? "circle"];
  const glyph = GLYPHS[tier === null && isSecret(badge) ? "lock" : badge.glyph];
  let svg: string;
  if (tier === null) {
    svg = `<g transform="translate(60 60) scale(.9) translate(-60 -60)" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-opacity=".22" stroke-width="5" stroke-linejoin="round">${shape}</g><g fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(60 60) scale(.92) translate(-60 -60)">${glyph}</g>`;
  } else {
    const [f1, f2] = FILLS[badge.collection];
    const [rim, rimDark] = RIMS[tier];
    const ink = badge.collection === "money" ? "#3a2c00" : "#fff";
    svg =
      `<defs><linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></linearGradient>` +
      `<linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${rim}"/><stop offset=".55" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${rimDark}"/></linearGradient></defs>` +
      (tier === "g" || tier === "p" ? heeRing(rim) : "") +
      `<g transform="translate(60 60) scale(.9) translate(-60 -60)"><g fill="url(#${id}f)" stroke="url(#${id}r)" stroke-width="7" stroke-linejoin="round">${shape}</g>` +
      `<g fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5">${shape}</g></g>` +
      `<g fill="none" stroke="${ink}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(60 60) scale(.92) translate(-60 -60)">${glyph}</g>`;
  }
  // The markup is built from the constants above only (no reader or database text).
  return <svg aria-hidden viewBox="0 0 120 120" width={size} height={size} className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
