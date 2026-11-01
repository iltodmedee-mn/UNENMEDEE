import { z } from "zod";

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

export const Tier1Schema = z
  .object({
    tldr_summary: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v.join("\n") : v).trim()),
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
  .refine((v) => v.tldr_summary.length >= 20, { message: "tldr_summary is empty" });

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

export const DigestSchema = z.object({
  title: z.coerce.string().transform((s) => s.trim().slice(0, 200)).refine((s) => s.length >= 5, "title is empty"),
  intro: z.coerce.string().transform((s) => s.trim()).refine((s) => s.length >= 30, "intro is empty"),
  items: z
    .array(
      z.object({
        id: z.coerce.number().int(),
        headline: z.coerce.string().transform((s) => s.trim().slice(0, 240)),
        why: z.coerce.string().transform((s) => s.trim().slice(0, 600)),
      }),
    )
    .min(1),
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
