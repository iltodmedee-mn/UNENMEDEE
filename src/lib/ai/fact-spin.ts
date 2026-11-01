/**
 * The stored "Баримт vs пи-ар" fields as readers may see them. A Tier-1 reply that left the fields
 * out used to be stored as `spin_detected: "undefined"` (zod's string coercion of a missing key)
 * and `neutrality_score: 0` (the score's catch), and five published stories then showed
 * "Баримт 0% · Пи-ар 100%" and the word "undefined": a verdict-shaped label made by a parsing
 * default. A missing assessment is shown as no assessment.
 */
import type { FactVsSpin } from "@/lib/types";

/** What string coercion makes of a missing or non-text value. */
const BROKEN = new Set(["undefined", "null", "nan", "[object object]"]);

/** A model text field: trimmed text, "" for anything that is not text (never "undefined"). */
export function cleanModelText(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return BROKEN.has(t.toLowerCase()) ? "" : t;
}

/** The PR text to show, "" when the model gave none. */
export function storedSpin(fv: Pick<FactVsSpin, "spin_detected"> | null | undefined): string {
  return cleanModelText(fv?.spin_detected);
}

/**
 * The neutrality score to show, or null (no meter, no "Баримт N%" line). A row whose spin text is
 * a coercion artefact came from a reply without the assessment, so its 0 is not a score either.
 */
export function storedNeutrality(fv: Pick<FactVsSpin, "spin_detected" | "neutrality_score"> | null | undefined): number | null {
  if (!fv) return null;
  const n = fv.neutrality_score;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (typeof fv.spin_detected === "string" && BROKEN.has(fv.spin_detected.trim().toLowerCase())) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
