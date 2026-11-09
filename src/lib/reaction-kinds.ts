/** The reaction kinds and labels, kept free of database imports for the browser (src/lib/reactions.ts). */
export const REACTION_KINDS = ["useful", "doubt", "correction"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REACTION_LABELS: Record<ReactionKind, string> = {
  useful: "Тустай",
  doubt: "Эргэлзээтэй",
  correction: "Залруулга байна",
};

export type ReactionCounts = Record<ReactionKind, number>;

/** How long the CDN keeps a story's counts; the page asks again on this rhythm while it is open. */
export const COUNTS_CACHE_S = 60;
