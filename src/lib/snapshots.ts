import { createHash } from "node:crypto";

/**
 * Snapshots: the finished content of one list page as of the last pipeline run
 * (docs/adr/0001-list-pages-read-snapshots.md, GLOSSARY.md). Pure helpers shared by the writer
 * (snapshot-writer.ts: pipeline, admin) and the reader (queries.ts `getFeedPage`).
 */
export const SNAPSHOT_VERSION = 1;

/** Stories a list page shows before "Цааш үзэх" (the rest come from /api/feed/<filter>). */
export const FIRST_PAGE = 20;

export const feedKey = (filter: string) => `feed:${filter}`;

/** The cache tag a page reading this snapshot carries; the pipeline purges it when the snapshot changed. */
export const snapshotTag = (key: string) => `snap-${key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

/** A purgeable snapshot tag (the /api/revalidate allow-list). */
export const SNAPSHOT_TAG = /^snap-[a-z0-9-]{1,48}$/;

export interface Snapshot<T> {
  v: number;
  builtAt: string;
  data: T;
}

/** sha256 of the part that decides whether the page changed. */
export function contentHash(part: unknown): string {
  return createHash("sha256").update(JSON.stringify(part)).digest("hex");
}

/** A JSON date (ISO string) back to a Date; null stays null. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The stored row's payload, or null when it is missing or written by another version. Dates come
 * back as ISO strings: the reader turns the fields it knows into Dates (`toDate`).
 */
export function parseSnapshot<T>(raw: unknown): Snapshot<T> | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Snapshot<T>>;
  if (s.v !== SNAPSHOT_VERSION || typeof s.builtAt !== "string" || s.data === undefined) return null;
  return { v: s.v, builtAt: s.builtAt, data: s.data };
}
