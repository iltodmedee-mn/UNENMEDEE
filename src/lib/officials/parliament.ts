import { z } from "zod";

import { politeFetch } from "@/lib/scraper/http";

/**
 * parliament.mn public API (the same one its React site calls): the current roster and each
 * member's detail page, which links straight to their ХАСХОМ declaration (`hom_url`).
 */
export const ROSTER_URL = "https://parliament.mn/api/parliament_members_list/";
export const memberDetailUrl = (id: number) => `https://parliament.mn/api/parliament_member/detail/${id}/`;
export const memberProfileUrl = (id: number) => `https://parliament.mn/member/${id}`;

const Position = z.object({
  unit_type: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
});

const RosterMember = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string(),
  profile_image: z.string().nullish(),
  party: z.object({ name: z.string() }).nullish(),
  // A changed shape must not read as "no seat": null = unknown, and the stored term is kept.
  positions: z.array(Position).nullish().catch(null),
});

const Roster = z.object({ members: z.array(RosterMember) });

const Detail = z.object({
  id: z.number(),
  full_name: z.string().nullish(),
  short_name: z.string().nullish(),
  is_active: z.boolean().nullish(),
  hom_url: z.string().nullish(),
  election_results: z
    .array(
      z.object({
        election_date: z.string().nullish(),
        election_system: z.string().nullish(),
        constituency_name: z.string().nullish(),
        votes_received: z.number().nullish(),
      }),
    )
    .nullish()
    // A changed shape must not blank every constituency: null = unknown, the stored values stay.
    .catch(null),
});

export interface MemberInfo {
  parliamentMemberId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  shortName: string;
  party: string | null;
  photoUrl: string | null;
  termStart: string | null;
  termEnd: string | null;
  constituency: string | null;
  votes: number | null;
  electionSystem: string | null;
  xacxomId: string | null;
  profileUrl: string;
  /** The roster gave this member's parliament seat (term dates). False = unknown, keep what is stored. */
  termKnown: boolean;
  /** The detail gave an election result (constituency, votes). False = unknown, keep what is stored. */
  electionKnown: boolean;
}

export type RosterEntry = Pick<MemberInfo, "parliamentMemberId" | "firstName" | "lastName" | "fullName" | "shortName" | "party" | "photoUrl" | "termStart" | "termEnd" | "profileUrl" | "termKnown">;

export function parseRoster(json: unknown): RosterEntry[] {
  return Roster.parse(json).members.map((m) => {
    const seat = m.positions?.find((p) => p.unit_type === "PARLIAMENT");
    return {
      parliamentMemberId: m.id,
      firstName: m.first_name.trim(),
      lastName: m.last_name.trim(),
      fullName: `${m.last_name} ${m.first_name}`.trim(),
      shortName: `${m.last_name.trim().charAt(0)}.${m.first_name.trim()}`,
      party: m.party?.name ?? null,
      photoUrl: m.profile_image ?? null,
      termStart: seat?.start_date ?? null,
      termEnd: seat?.end_date ?? null,
      profileUrl: memberProfileUrl(m.id),
      termKnown: Boolean(seat),
    };
  });
}

/** "https://xacxom.iaac.mn/xacxom/5846381" → "5846381". */
export function xacxomIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(/xacxom\.iaac\.mn\/xacxom\/(\d+)/)?.[1] ?? null;
}

export function parseMemberDetail(json: unknown, base: RosterEntry): MemberInfo {
  const d = Detail.parse(json);
  const results = d.election_results ?? [];
  const election = [...results].sort((a, b) => (b.election_date ?? "").localeCompare(a.election_date ?? ""))[0];
  return {
    ...base,
    fullName: d.full_name?.trim() || base.fullName,
    // "Д. Ганмаа" and "Д.Ганмаа" are one spelling: the site matches names by exact string.
    shortName: d.short_name?.trim().replace(/\.\s+/g, ".") || base.shortName,
    constituency: election?.constituency_name ?? null,
    votes: election?.votes_received ?? null,
    electionSystem: election?.election_system ?? null,
    xacxomId: xacxomIdFromUrl(d.hom_url),
    electionKnown: results.length > 0,
  };
}

export async function fetchRoster(): Promise<RosterEntry[]> {
  const res = await politeFetch(ROSTER_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`parliament.mn roster returned HTTP ${res.status}`);
  return parseRoster(await res.json());
}

export async function fetchMember(base: RosterEntry): Promise<MemberInfo> {
  const res = await politeFetch(memberDetailUrl(base.parliamentMemberId), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`parliament.mn member ${base.parliamentMemberId} returned HTTP ${res.status}`);
  return parseMemberDetail(await res.json(), base);
}
