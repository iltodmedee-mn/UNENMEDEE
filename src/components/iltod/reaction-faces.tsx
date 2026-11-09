import type { EmojiKind } from "@/lib/reaction-kinds";

/**
 * The site's own reaction faces (Nov 2026, the owner approved the mockup): flat, the signal yellow
 * with a dark ink outline; «Мундаг» is a pair of clapping hands, «Ичмээр» the streak orange. Inline
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
  // «Мундаг»: two clapping hands with three spark lines, the same yellow and ink as the faces.
  clap: (
    <g stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7.5l3 3.5M15 4.5l1 4.5M5 13l4 1.5" fill="none" />
      <path
        transform="rotate(-24 22 28)"
        d="M14 44c-4-3-5-9-4-15l1.5-12.5c.3-2.2 3.6-2.2 3.8.1L16 26l.6-13c.1-2.3 3.5-2.4 3.8-.1L21 25l.9-14c.2-2.3 3.6-2.2 3.8.1L26 25.5l1.2-11.2c.3-2.2 3.6-2 3.7.2l.2 14.5c.1 7-2.5 13-8.3 15.6z"
        fill={YELLOW}
      />
      <path
        transform="rotate(16 30 27)"
        d="M24 45c-4-3-5-9-4-15l1.5-12.5c.3-2.2 3.6-2.2 3.8.1L26 27l.6-13c.1-2.3 3.5-2.4 3.8-.1L31 26l.9-14c.2-2.3 3.6-2.2 3.8.1L36 26.5l1.2-11.2c.3-2.2 3.6-2 3.7.2l.2 14.5c.1 7-2.5 13-8.3 15.6z"
        fill="#FFC300"
      />
    </g>
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
