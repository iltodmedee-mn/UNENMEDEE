/** Shared domain types used by the DB schema, AI pipeline and UI. */

/** portal = national data portals, local = aimag / district / city governments and councils. */
export type SourceCategory = "portal" | "ministry" | "agency" | "local";
export type AIProvider = "deepseek" | "grok" | "gemini" | "nvidia" | "groq" | "requesty" | "mistral" | "openrouter" | "zai" | "ollama" | "elevenlabs";

/** Fact-vs-spin breakdown produced by the Tier-1 analyzer. */
export interface FactVsSpin {
  facts: string[];
  spin_detected: string;
  /** 0 = pure PR spin, 100 = fully neutral/factual; null = the model gave no assessment. */
  neutrality_score: number | null;
}

/**
 * "Танд хамаатай юу?" (Tier 1, grounded in analyze.ts): who the news touches, what changes for
 * them, from when and what they should do. Every field is null when the text does not say it.
 */
export interface ReaderImpact {
  who: string | null;
  change: string | null;
  when: string | null;
  action: string | null;
}

/** Named entities extracted by the Tier-1 analyzer. */
export interface ExtractedEntities {
  people: string[];
  orgs: string[];
  /** Human-readable MNT amounts, e.g. "4.5 тэрбум ₮". */
  amounts_mnt: string[];
}

/** Structured fields a scraper adapter may attach (e.g. tender metadata). */
export interface ScrapeMeta {
  tender_code?: string;
  budget_mnt?: string;
  procuring_entity?: string;
  dataset_org?: string;
  dataset_updated?: string;
  /** The page shows no publication date: `published_at` is the time we found it. */
  date_unknown?: boolean;
  /** Batch topic calls that returned no usable topic for this row (scripts/classify-topics.ts). */
  topic_attempts?: number;
}

export const RISK_FLAG_THRESHOLD = 65;

/** One story in an AI news digest (denormalized: the digest page needs no joins). */
export interface DigestItem {
  articleId: number;
  slug: string;
  title: string;
  sourceName: string;
  publishedAt: string | null;
  riskScore: number;
  /** Fact-based headline written by the editor model. */
  headline: string;
  /** 1-2 sentences: why this matters to citizens. */
  whyItMatters: string;
  /** Other sources that reported the same story (cluster size - 1). */
  otherSources: number;
}

/* opendata.mn highlights: compact summaries computed by `npm run data:sync`. */
export interface SeriesPoint {
  label: string;
  value: number;
}

export type DatasetHighlight =
  | {
      kind: "fx";
      asOf: string;
      rates: { code: string; name: string; rate: number; changePct: number | null }[];
      usdSeries: SeriesPoint[];
    }
  | { kind: "macro"; indicators: { name: string; unit: string; latest: SeriesPoint; series: SeriesPoint[] }[] }
  | {
      kind: "salary";
      unit: string;
      latestQuarter: string;
      national: number | null;
      series: SeriesPoint[];
      top: SeriesPoint[];
      bottom: SeriesPoint[];
    }
  | {
      kind: "blacklist";
      total: number;
      activeCount: number;
      items: { name: string; registry: string; reason: string; note: string; start: string; end: string }[];
    }
  | {
      kind: "tenders";
      latestYear: number;
      byYear: { year: number; count: number; budget: number }[];
      statuses: SeriesPoint[];
      largest: { number: string; name: string; budget: number; status: string; type: string }[];
    }
  | {
      kind: "attendance";
      sessions: number;
      from: string;
      to: string;
      members: number;
      records: number;
      /** One row per member and parliamentary term (`term` = its start year; older snapshots lack it). */
      top: { name: string; term?: number; from?: string; to?: string; records: number; present: number; travel: number; medical: number; leave: number; unexplained: number }[];
    };
