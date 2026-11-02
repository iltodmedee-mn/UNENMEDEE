import { z } from "zod";

import { stripBullet } from "@/lib/format";
import { isAiTopic } from "@/lib/topics";
import { RISK_FLAG_THRESHOLD } from "@/lib/types";

import { cleanModelText } from "./fact-spin";
import { cleanImpact, cleanReaderTitle } from "./reader-view";

/** LLMs sometimes return numbers as strings or out of range: coerce and clamp. */
const score = z.coerce
  .number()
  .catch(0)
  .transform((n) => Math.max(0, Math.min(100, Math.round(n))));

/** Optional score: null when the model left it out (older prompts, small models). */
const optionalScore = z.unknown().transform((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
});

/**
 * A model text field. `z.coerce.string()` turned a missing key into the text "undefined" (zod 4)
 * and an object into "[object Object]"; both reached the article page and the Tier-2 prompt.
 */
const text = z.unknown().optional().transform((v) => cleanModelText(typeof v === "number" ? String(v) : v));

const stringList = (max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => [...new Set(xs.map((x) => cleanModelText(typeof x === "number" ? String(x) : x)).filter(Boolean))].slice(0, max));

/**
 * Keys of the reply itself inside the summary: the model mixed quote styles ('facts': [...]) and
 * the rest of its JSON became tldr_summary, with importance and topic lost (Nov 2026: #2366,
 * #2369, #2403, #2431 were published that way). Such a reply fails, so the repair retry runs.
 */
const LEAKED_KEYS = /['"](?:facts|spin_detected|neutrality_score|entities|risk_score|risk_reason|importance_score|topic|reader_title|impact)['"]\s*:/;

export const Tier1Schema = z
  .object({
    // One line per sentence; a "- " / "• " list marker is dropped (the page draws its own bullets).
    tldr_summary: z
      .union([z.string(), z.array(z.string())])
      .transform((v) => (Array.isArray(v) ? v.join("\n") : v).split("\n").map(stripBullet).filter(Boolean).join("\n")),
    facts: stringList(12),
    spin_detected: text,
    // Null when the model gave no assessment: a default of 0 printed "Пи-ар 100%" on official news.
    neutrality_score: optionalScore.optional(),
    entities: z
      .object({
        people: stringList(20),
        orgs: stringList(20),
        amounts_mnt: stringList(15),
      })
      .catch({ people: [], orgs: [], amounts_mnt: [] }),
    risk_score: score,
    risk_reason: text,
    importance_score: optionalScore.optional(),
    /** Unknown or missing topics become null (the source domain decides). */
    topic: z
      .unknown()
      .transform((v) => (typeof v === "string" && isAiTopic(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null))
      .optional(),
    /** Shape checks only here; analyze.ts checks every number against the article (reader-view.ts). */
    reader_title: z.unknown().transform((v) => cleanReaderTitle(v, "", null)).optional(),
    impact: z.unknown().transform((v) => cleanImpact(v, null)).optional(),
    risk_flag: z.unknown().optional(),
  })
  // risk_flag is derived deterministically, never trusted from the model.
  .transform((v) => ({
    ...v,
    neutrality_score: v.neutrality_score ?? null,
    importance_score: v.importance_score ?? null,
    topic: v.topic ?? null,
    reader_title: v.reader_title ?? null,
    impact: v.impact ?? null,
    risk_flag: v.risk_score >= RISK_FLAG_THRESHOLD,
  }))
  .refine((v) => v.tldr_summary.length >= 20, { message: "tldr_summary is empty" })
  .refine((v) => !LEAKED_KEYS.test(v.tldr_summary), { message: "tldr_summary holds the rest of the JSON reply" });

export type Tier1Result = z.output<typeof Tier1Schema>;

export const Tier2Schema = z.object({
  analysis_markdown: z.string().min(80),
  citizen_questions: stringList(8),
});

export type Tier2Result = z.output<typeof Tier2Schema>;

export const ClusterSchema = z.object({
  title: z.string().min(5).max(200),
  synthesis: z.string().min(40),
});

export type ClusterResult = z.output<typeof ClusterSchema>;

/** A model's text field: strings and numbers as written, anything else (null, objects) empty. */
const plain = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/**
 * One editor item. Checked one by one: with `z.coerce.string()` a null "why" was printed as
 * "null", and one item with an id like "12a" failed the whole edition (repair call, then the
 * rule-based fallback) although nine items were fine. A bad item is dropped instead.
 */
const DigestItemSchema = z.object({
  id: z.union([z.number(), z.string().regex(/^\s*\d+\s*$/)]).transform(Number).pipe(z.number().int().positive()),
  headline: z.unknown().transform((v) => plain(v).slice(0, 240)).pipe(z.string().min(5)),
  why: z.unknown().transform((v) => plain(v).slice(0, 600)),
});

export const DigestSchema = z.object({
  title: z.unknown().transform((v) => plain(v).slice(0, 200)).refine((s) => s.length >= 5, "title is empty"),
  intro: z.unknown().transform(plain).refine((s) => s.length >= 30, "intro is empty"),
  items: z
    .array(z.unknown())
    .transform((list) => list.flatMap((item) => {
      const r = DigestItemSchema.safeParse(item);
      return r.success ? [r.data] : [];
    }))
    .refine((list) => list.length >= 1, "no usable items"),
});

export type DigestResult = z.output<typeof DigestSchema>;

/** Extracts the first JSON object from a model reply (handles ```json fences and chatter). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model reply contained no JSON object");
  }
}
