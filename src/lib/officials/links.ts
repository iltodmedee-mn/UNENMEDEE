import { attributable } from "./flags";

export interface PersonLink {
  name: string;
  /** The MP's profile id when the name matches exactly one active member, else null. */
  id: number | null;
}

/**
 * People named in an article (AI-extracted short names like "Ж.Алдаржавхлан") linked to the active
 * MP with that exact short name. A short name two members share, now or across terms, never links:
 * the text cannot say which one it means (same rule as news mentions and alerts, docs/agents/civic.md §6d).
 * Pass every politician, inactive ones included (`attributable`).
 */
export function linkPeople(names: string[], politicians: { id: number; shortName: string; isActive?: boolean }[]): PersonLink[] {
  const byName = new Map(attributable(politicians).map((p) => [p.shortName, p.id]));
  return names.map((name) => ({ name, id: byName.get(name.trim()) ?? null }));
}
