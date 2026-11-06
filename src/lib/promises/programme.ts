/**
 * "Амлалт": the Government's 2024–2028 action programme, approved by the State Great Khural
 * (resolution No. 21 of 2024-08-27, annex 1). The text is stored verbatim from the official
 * Word file on legalinfo.mn (`npm run promises:import`), split into its own numbering:
 * 4 policies ("НЭГ." …), 16 directions ("1.1."), sections ("1.1.1.") and goals ("1.1.1.1.").
 * Facts only: no status is computed here. A goal is "measurable" when its own text names a
 * number with a unit (MW, km, %, tonnes …); that is a property of the wording, not a verdict.
 */

/**
 * The programme covers the parliament's 2024–2028 term; the next one is approved after the
 * June 2028 election. From this day the watchdog asks for `npm run promises:import`.
 */
export const PROGRAMME_END = "2028-07-01";

export interface ProgrammeGoal {
  /** "1.1.2.3" */
  id: string;
  text: string;
  /** An unnumbered heading inside the section ("Гэр бүл", "Хүүхэд"). */
  group?: string;
}

export interface ProgrammeSection {
  id: string;
  title: string;
  goals: ProgrammeGoal[];
}

export interface ProgrammeDirection {
  /** "1.1" */
  id: string;
  title: string;
  sections: ProgrammeSection[];
}

export interface ProgrammePolicy {
  /** 1–4 */
  n: number;
  title: string;
  intro: string;
  directions: ProgrammeDirection[];
}

export interface Programme {
  title: string;
  /** The approving act, its date and the official page. */
  act: string;
  approved: string;
  sourceUrl: string;
  fileUrl: string;
  importedAt: string;
  preamble: string[];
  megaProjects: string[];
  policies: ProgrammePolicy[];
}

const POLICY_WORDS = ["НЭГ", "ХОЁР", "ГУРАВ", "ДӨРӨВ"];
const POLICY = /^(НЭГ|ХОЁР|ГУРАВ|ДӨРӨВ)\.\s*(.+)$/;
const GOAL = /^(\d+\.\d+\.\d+\.\d+)\.\s*(.+)$/;
const SECTION = /^(\d+\.\d+\.\d+)\.\s*(\D.*)$/;
const DIRECTION = /^(\d+\.\d+)\.\s*(\D.*)$/;
const MEGA = /^(\d{1,2})\.\s*(\D.*)$/;
/** An unnumbered line this short with no full stop is a heading, not a paragraph. */
const HEADING_MAX = 80;

/** Sentence case for an all-caps policy title ("БҮСЧИЛСЭН ХӨГЖЛИЙН БОДЛОГО" → "Бүсчилсэн хөгжлийн бодлого"). */
function sentenceCase(s: string): string {
  const lower = s.toLocaleLowerCase("mn");
  return lower.charAt(0).toLocaleUpperCase("mn") + lower.slice(1);
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Splits the annex text (one paragraph per line) into the programme's structure. Lines before the
 * first policy heading are the preamble; its numbered paragraphs ("1.Гашуунсухайт…") are the
 * mega projects (with their unnumbered follow-up paragraphs appended).
 */
export function parseProgramme(text: string): Pick<Programme, "preamble" | "megaProjects" | "policies"> {
  const lines = text
    .split("\n")
    .map(tidy)
    .filter(Boolean);
  const start = lines.findIndex((l) => /ҮЙЛ АЖИЛЛАГААНЫ ХӨТӨЛБӨР$/.test(l) || /^ОНЫ ҮЙЛ АЖИЛЛАГААНЫ ХӨТӨЛБӨР$/.test(l));
  const preamble: string[] = [];
  const megaProjects: string[] = [];
  const policies: ProgrammePolicy[] = [];
  let policy: ProgrammePolicy | undefined;
  let direction: ProgrammeDirection | undefined;
  let section: ProgrammeSection | undefined;
  let group: string | undefined;
  let last: ProgrammeGoal | undefined;

  for (const line of lines.slice(start + 1)) {
    if (/^-+\s*оОо\s*-+$/.test(line)) break;
    const p = line.match(POLICY);
    if (p) {
      policy = { n: POLICY_WORDS.indexOf(p[1]) + 1, title: sentenceCase(p[2]), intro: "", directions: [] };
      policies.push(policy);
      direction = section = last = undefined;
      group = undefined;
      continue;
    }
    if (!policy) {
      const m = line.match(MEGA);
      if (m && megaProjects.length === Number(m[1]) - 1) megaProjects.push(m[2]);
      else if (megaProjects.length > 0 && !/:$/.test(line)) megaProjects[megaProjects.length - 1] += ` ${line}`;
      else preamble.push(line);
      continue;
    }
    const g = line.match(GOAL);
    if (g && section) {
      last = { id: g[1], text: g[2], ...(group ? { group } : {}) };
      section.goals.push(last);
      continue;
    }
    const s = line.match(SECTION);
    if (s && direction) {
      section = { id: s[1], title: s[2], goals: [] };
      direction.sections.push(section);
      group = last = undefined;
      continue;
    }
    const d = line.match(DIRECTION);
    if (d) {
      direction = { id: d[1], title: d[2], sections: [] };
      policy.directions.push(direction);
      section = last = undefined;
      group = undefined;
      continue;
    }
    // Unnumbered: the policy's intro, a heading inside a section, or a goal's next paragraph.
    if (!direction) policy.intro = tidy(`${policy.intro} ${line}`);
    else if (line.length <= HEADING_MAX && !/[.;:]$/.test(line)) {
      group = line;
      last = undefined;
    } else if (last) last.text = `${last.text} ${line}`;
  }
  return { preamble, megaProjects, policies };
}

/** The paragraphs of a Word document's `word/document.xml`, one per line. */
export function docxParagraphs(xml: string): string {
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => decode([...p[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""))).join("\n");
}

const UNIT = /\d[\d\s.,]*\s*(?:МВт|ГВт|кВт|кВ|км|га(?![а-яөүё])|хув[иь]|%|тонн|сая|тэрбум|мянга|ам\.доллар|төгрөг|₮|м2|м3|мод|өрх|айл|хүүхэд|сургууль|цэцэрлэг|эмнэлэг|орон сууц|ажлын байр)/i;

/**
 * The goal's own text names a number with a unit ("300 МВт", "30 хувиар", "20,000 айлыг",
 * "50-иас багагүй хувийг"). "1 удаа", "20 минутын хот" and years do not count.
 */
export function isMeasurable(text: string): boolean {
  return UNIT.test(text.replace(/(\d)(?:-?(?:иас|ээс|оос|өөс|аас))?\s+(?:багагүй|хүртэл|гаруй|илүүгүй|илүү)/g, "$1"));
}

export function directionGoals(d: ProgrammeDirection): ProgrammeGoal[] {
  return d.sections.flatMap((s) => s.goals);
}

/** "1.1" → "1-1" for URLs, and back. */
export const directionSlug = (id: string) => id.replace(".", "-");
export const directionId = (slug: string) => (/^\d-\d{1,2}$/.test(slug) ? slug.replace("-", ".") : null);

/**
 * Time on the programme's clock (Nov 2026, the research round's "deadline" ask): 619 of the 620
 * goals name no date of their own, so the one deadline is the programme's end. Days are
 * Ulaanbaatar days; `elapsedPct` is time passed, never a share of goals met.
 */
export function programmeClock(today: string, approved: string, end: string = PROGRAMME_END): { totalDays: number; daysLeft: number; elapsedPct: number } {
  const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  const total = day(end) - day(approved);
  const passed = Math.min(Math.max(day(today) - day(approved), 0), total);
  return { totalDays: total, daysLeft: total - passed, elapsedPct: total > 0 ? Math.round((passed / total) * 100) : 100 };
}
