import { clip, type PushPayload } from "@/lib/push/core";

import { attributable, normShort } from "./flags";

/** Server-side half of "Миний гишүүн" (see ./follow.ts). */
export interface MentionArticle {
  slug: string;
  title: string;
  people: string[];
}

/** One notification per subscription: its followed MPs named in the new articles. */
export function mentionAlerts(
  articles: MentionArticle[],
  /** Every politician, inactive ones included: a former member's namesake is not attributable either. */
  politicians: { id: number; shortName: string; isActive?: boolean }[],
  subs: { endpoint: string; follows: number[] }[],
): { endpoint: string; payload: PushPayload }[] {
  const out: { endpoint: string; payload: PushPayload }[] = [];
  // Two members can share a short name (Д.Цогтбаатар ×2 in 2024, or a new member and a former
  // one): an article naming it cannot be attributed to either, so neither follower is alerted.
  const named = attributable(politicians);
  for (const sub of subs) {
    const followed = named.filter((p) => sub.follows.includes(p.id));
    if (!followed.length) continue;
    // "Д. Ганмаа" in an article is "Д.Ганмаа" (audit B-15).
    const peopleIn = (a: { people: string[] }) => a.people.map(normShort);
    const hits = articles.filter((a) => followed.some((p) => peopleIn(a).includes(normShort(p.shortName))));
    if (!hits.length) continue;
    const names = followed.filter((p) => hits.some((a) => peopleIn(a).includes(normShort(p.shortName)))).map((p) => p.shortName);
    out.push({
      endpoint: sub.endpoint,
      payload: {
        title: clip(`👤 ${names.join(", ")} мэдээнд гарлаа`, 60),
        body: clip(hits.length > 1 ? `${hits[0].title} · +${hits.length - 1} мэдээ` : hits[0].title, 140),
        url: `/article/${hits[0].slug}`,
        tag: "mention",
      },
    });
  }
  return out;
}
