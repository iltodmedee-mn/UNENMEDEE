/** The reaction kinds and labels, kept free of database imports for the browser (src/lib/reactions.ts). */

/**
 * The six faces, named in everyday speech (the owner's pick, Nov 2026: not ikon's words, nothing a
 * Mongolian would not say). No 💩: under a story naming an official it reads as an insult.
 */
export const EMOJI_KINDS = ["clap", "haha", "wow", "hmm", "sad", "angry"] as const;
export type EmojiKind = (typeof EMOJI_KINDS)[number];

/** The faces plus «Залруулга байна», which is counted the same way and shown as a link. */
export const REACTION_KINDS = [...EMOJI_KINDS, "correction"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REACTION_LABELS: Record<ReactionKind, string> = {
  clap: "Мундаг",
  haha: "Хаха",
  wow: "Пөөх",
  hmm: "Итгэмээргүй",
  sad: "Хөөрхий",
  angry: "Ичмээр",
  correction: "Залруулга байна",
};

export type ReactionCounts = Record<ReactionKind, number>;

export const emptyCounts = (): ReactionCounts => Object.fromEntries(REACTION_KINDS.map((k) => [k, 0])) as ReactionCounts;

/** How long the CDN keeps a story's counts; the page asks again on this rhythm while it is open. */
export const COUNTS_CACHE_S = 60;
