import type { EmojiKind } from "@/lib/reaction-kinds";

/**
 * The site's own reaction faces (Nov 2026, the owner approved the mockup): flat, the signal yellow
 * with a dark ink outline; the heart in the site's red, the angry face in the streak orange. Inline
 * SVG, no image requests. In dark mode a faint light halo keeps the ink outline off the background.
 */
const INK = "#1a1500";
const YELLOW = "#FFD400";

function Face({ fill = YELLOW, children }: { fill?: string; children: React.ReactNode }) {
  return (
    <>
      <circle cx="24" cy="24" r="20.5" fill={fill} stroke={INK} strokeWidth="2.6" />
      {children}
    </>
  );
}

const line = { fill: "none", stroke: INK, strokeLinecap: "round" as const };

const FACES: Record<EmojiKind, React.ReactNode> = {
  sad: (
    <Face>
      <path d="M15 20.5q3.5-2.5 7 0M26 20.5q3.5-2.5 7 0" {...line} strokeWidth="2.6" />
      <path d="M17 34q7-6 14 0" {...line} strokeWidth="2.8" />
      <path d="M15.5 24.5q-3 5 0 7.2q3-2.2 0-7.2z" fill="#22B5C9" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </Face>
  ),
  love: (
    <>
      <path d="M24 41S6 30.5 6 18.5C6 12.4 10.6 8 16 8c3.6 0 6.5 2 8 4.7C25.5 10 28.4 8 32 8c5.4 0 10 4.4 10 10.5C42 30.5 24 41 24 41z" fill="#F0453A" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M13 17q1-4 5-4.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
    </>
  ),
  haha: (
    <Face>
      <path d="M14.5 15.5l6 3.5-6 3.5M33.5 15.5l-6 3.5 6 3.5" {...line} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M12.5 27h23q-1.5 10-11.5 10t-11.5-10z" fill={INK} />
      <path d="M18 33.5q6-3.5 12 0q-2.5 3.2-6 3.2t-6-3.2z" fill="#F0453A" />
    </Face>
  ),
  wow: (
    <Face>
      <path d="M14.5 14.5q3-2.2 6 0M27.5 14.5q3-2.2 6 0" {...line} strokeWidth="2.4" />
      <circle cx="17.5" cy="21" r="2.8" fill={INK} />
      <circle cx="30.5" cy="21" r="2.8" fill={INK} />
      <ellipse cx="24" cy="32.5" rx="4.6" ry="5.6" fill={INK} />
    </Face>
  ),
  hmm: (
    <Face>
      <path d="M14.5 17.5l6.5-.8M27 15.5q3.5-3.5 7 .5" {...line} strokeWidth="2.6" />
      <circle cx="17.8" cy="22" r="2.6" fill={INK} />
      <circle cx="30.5" cy="21.5" r="2.6" fill={INK} />
      <path d="M17 32.5l14-2.5" {...line} strokeWidth="2.8" />
    </Face>
  ),
  angry: (
    <Face fill="#FF6A3D">
      <path d="M13.5 16.5l7.5 4M34.5 16.5l-7.5 4" {...line} strokeWidth="2.8" />
      <circle cx="18" cy="23.5" r="2.4" fill={INK} />
      <circle cx="30" cy="23.5" r="2.4" fill={INK} />
      <path d="M17 34q7-5 14 0" {...line} strokeWidth="2.8" />
    </Face>
  ),
};

export function ReactionFace({ kind, className }: { kind: EmojiKind; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className}>
      {FACES[kind]}
    </svg>
  );
}
