/**
 * Neutral "анхаарах өөрчлөлт" markers computed from the declarations themselves. They state
 * numbers, never conclusions: a jump can have a lawful reason (inheritance, sale, salary), and a
 * filing can simply carry a unit error (the IAAC form takes thousand ₮; one line typed in ₮ makes
 * a year look 1000× richer). Such a year is named, kept as declared, and left out of comparisons.
 */
export interface DeclarationLike {
  year: number;
  incomeOwn: number | null;
  incomeFamily: number | null;
  loans: number | null;
  totalAssets: number | null;
}

export interface Flag {
  year: number;
  kind: "asset_jump" | "loans_over_income" | "missing_year" | "unit_suspect";
  text: string;
}

const ASSET_JUMP = 0.5;
/** Changes on smaller bases are not compared (the profile markers and the /officials list). */
export const MIN_ASSETS_FOR_JUMP = 50_000_000;
/** A year this many times away from the person's other years is a suspected unit error. */
export const UNIT_GAP = 20;
/** Totals below this are too small to tell a unit error from a real change. */
const MIN_COMPARABLE = 10_000_000;
/** Percentages are shown up to this value ("500%+"): bigger ones are unit errors or tiny bases. */
export const PCT_CAP = 500;
/** Loans are only worth a marker when they exceed the year's income this many times. */
export const LOANS_OVER_INCOME = 3;

const mnt = (n: number) => `${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} сая ₮`;

/** "73%" or "500%+" for a ratio such as 0.73; the sign is left to the caller. */
export function formatPercent(ratio: number): string {
  const pct = Math.round(Math.abs(ratio) * 100);
  return pct > PCT_CAP ? `${PCT_CAP}%+` : `${pct}%`;
}

/**
 * Years whose declared total is more than UNIT_GAP× away from the person's other years. With two
 * filings that far apart nobody can tell which one is off, so both are returned; with three or
 * more the outliers from the median are. Years without a total are never compared.
 */
export function suspectUnitYears(rows: { year: number; totalAssets: number | null }[]): number[] {
  const valued = rows.filter((r): r is { year: number; totalAssets: number } => r.totalAssets !== null && r.totalAssets >= MIN_COMPARABLE);
  if (valued.length < 2) return [];
  const totals = valued.map((r) => r.totalAssets).sort((a, b) => a - b);
  if (valued.length === 2) return totals[1] > totals[0] * UNIT_GAP ? valued.map((r) => r.year) : [];
  // An even split (two filings at one scale, two at the other): the upper median used to win, so
  // the lower pair was called the error although nobody can tell which pair is off. All of them.
  const half = totals.length / 2;
  if (Number.isInteger(half) && totals[half] > totals[half - 1] * UNIT_GAP && totals[half - 1] * UNIT_GAP >= totals[0] && totals.at(-1)! <= totals[half] * UNIT_GAP) return valued.map((r) => r.year);
  const median = totals[Math.floor(totals.length / 2)];
  return valued.filter((r) => r.totalAssets > median * UNIT_GAP || r.totalAssets < median / UNIT_GAP).map((r) => r.year);
}

/**
 * Neutral markers for a member's yearly filings. `hiddenYears` are years an editor took out of the
 * comparison: they were published, so a gap there is not a missing filing (saying so would be false).
 * `term` (the member's seat, by year) limits "not published" to years they held it: a member
 * re-elected after years out of parliament owed parliament no filing for those years.
 */
export function declarationFlags(rows: DeclarationLike[], hiddenYears: number[] = [], term?: { from: number; to: number | null }): Flag[] {
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  const suspect = new Set(suspectUnitYears(sorted));
  const flags: Flag[] = [];
  const valuedCount = sorted.filter((r) => r.totalAssets !== null && r.totalAssets >= MIN_COMPARABLE).length;
  if (suspect.size >= 2 && suspect.size === valuedCount) {
    // Every filing is in doubt (two filings far apart, or an even split): one neutral note.
    const years = [...suspect].sort((x, y) => x - y);
    const list = years.length === 2 ? `${years[0]} ба ${years[1]}` : `${years.slice(0, -1).join(", ")} ба ${years.at(-1)}`;
    flags.push({
      year: years.at(-1)!,
      kind: "unit_suspect",
      text: `${list} оны нийт дүн хоорондоо ${UNIT_GAP} дахинаас их зөрүүтэй: эх мэдүүлэгт нэгжийн (мянган ₮ / ₮) алдаа байж болзошгүй тул хувийн өөрчлөлтийг тооцоолоогүй. Эх мэдүүлгийг ХАСХОМ-оос шалгана уу.`,
    });
  } else {
    for (const y of suspect) {
      const total = sorted.find((r) => r.year === y)?.totalAssets ?? 0;
      flags.push({
        year: y,
        kind: "unit_suspect",
        text: `${y} оны нийт дүн (${mnt(total)}) бусад жилээс ${UNIT_GAP} дахинаас их зөрүүтэй: эх мэдүүлэгт нэгжийн (мянган ₮ / ₮) алдаа байж болзошгүй тул харьцуулалтад оруулаагүй. Эх мэдүүлгийг ХАСХОМ-оос шалгана уу.`,
      });
    }
  }
  const comparable = sorted.filter((r) => r.totalAssets !== null && !suspect.has(r.year));
  const hidden = new Set(hiddenYears);
  for (let i = 1; i < sorted.length; i++) {
    // Every year of a gap (2020 → 2023 is 2021 and 2022), except the hidden ones.
    for (let y = sorted[i - 1].year + 1; y < sorted[i].year; y++) {
      if (term && (y < term.from || (term.to !== null && y > term.to))) continue;
      if (!hidden.has(y)) flags.push({ year: y, kind: "missing_year", text: `${y} оны мэдүүлэг нийтлэгдээгүй байна.` });
    }
  }
  for (let i = 1; i < comparable.length; i++) {
    const prev = comparable[i - 1];
    const cur = comparable[i];
    const prevTotal = prev.totalAssets ?? 0;
    const curTotal = cur.totalAssets ?? 0;
    if (prevTotal >= MIN_ASSETS_FOR_JUMP && curTotal > prevTotal * (1 + ASSET_JUMP)) {
      flags.push({ year: cur.year, kind: "asset_jump", text: `Хөрөнгийн дүн ${prev.year}→${cur.year} онд ${formatPercent(curTotal / prevTotal - 1)} өссөн (${mnt(prevTotal)} → ${mnt(curTotal)}).` });
    }
  }
  for (const r of sorted) {
    const income = (r.incomeOwn ?? 0) + (r.incomeFamily ?? 0);
    if (r.loans && income > 0 && r.loans > income * LOANS_OVER_INCOME && !suspect.has(r.year)) {
      flags.push({ year: r.year, kind: "loans_over_income", text: `${r.year} онд зээлийн үлдэгдэл (${mnt(r.loans)}) жилийн орлогоос (${mnt(income)}) ${LOANS_OVER_INCOME} дахинаас их.` });
    }
  }
  return flags.sort((a, b) => b.year - a.year);
}

/**
 * Members a short name in the news may be attributed to: active members whose short name no other
 * member shares, current OR former. Pass every politician (inactive ones included): after an
 * election a new "Б.Бат" must not inherit news, alerts or links about a former "Б.Бат", who may
 * still be in the news as a minister or governor. A member without `isActive` counts as active.
 */
export function attributable<T extends { shortName: string; isActive?: boolean }>(people: T[]): T[] {
  const shared = sharedShortNames(people);
  return people.filter((p) => p.isActive !== false && !shared.has(p.shortName));
}

/** Short names ("Д.Цогтбаатар") that more than one of these people share: nothing can be matched by name alone. */
export function sharedShortNames(people: { shortName: string }[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const p of people) (seen.has(p.shortName) ? shared : seen).add(p.shortName);
  return shared;
}
