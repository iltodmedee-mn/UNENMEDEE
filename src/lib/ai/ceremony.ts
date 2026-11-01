/**
 * Ceremonial news: meetings, visits, openings, trainings, forums, an MP's work report. The Tier-1
 * prompt already says such items score 0-19, but in Oct 2026 the models still gave 111 of them in
 * two weeks a median "important" score (13 above 70, e.g. "… хүлээн авч уулзлаа" = 85), so one led
 * a digest edition and several led the home page. The cap is decided here, from the headline,
 * never by the model: a ceremonial headline that names no decision keeps at most CEREMONY_MAX.
 */
export const CEREMONY_MAX = 40;

/** End of a word: JavaScript's \b only knows ASCII letters, so it never fires after Cyrillic. */
const E = "(?![\\p{L}\\p{N}])";
const re = (src: string) => new RegExp(src.replaceAll("$E", E), "iu");

/** Headline shapes that report that something took place, not what was decided. */
const CEREMONY: RegExp[] = [
  re("(уулзлаа|уулзав|бараалхлаа)$E|уулзалт\\s+(хийлээ|хийв|зохион|боллоо|болов)|хүлээн\\s+авч"),
  re("(оролцлоо|оролцов)$E"),
  re("(ээлжит|шуурхай)\\s+(\\S+\\s+){0,2}хурал(даан)?\\s+(боллоо|болов)$E"),
  re("ажлын\\s+тайлан|(танилцлаа|танилцав|ажиллалаа|ажиллав)$E"),
  re(
    "(сургалт|семинар|форум|үзэсгэлэн|тэмцээн|уралдаан|өдөрлөг|баяр|ёслол|арга\\s+хэмжээ|аян|хурал|зөвлөгөөн)\\S*\\s+(\\S+\\s+){0,4}(зохион\\s+байгууллаа|зохион\\s+байгуулав|боллоо|болов|явагдлаа|өндөрлөлөө|нээгдлээ|эхэллээ|амжилттай)$E",
  ),
  re("зохион\\s+(байгууллаа|байгуулав)$E\\W*$"),
  re("нээлт\\s+(боллоо|болов)$E|нээлтэд|шагнал\\s+гардуул|гардууллаа|мэндчил|хүндэтгэл|өргөмжл"),
  re("айлчлал\\S*\\s+(\\S+\\s+){0,2}(хэрэгжүүлэв|хэрэгжүүллээ|хийлээ|хийв|эхэллээ)$E"),
];

/**
 * Words that mean a decision, money or a rule: such a headline is news even when it reports a
 * meeting ("Засгийн газрын хуралдаанаар … тогтоол баталлаа", "уулзалтын үеэр 2027 оны төсвийн
 * төслөө танилцуулав"), and so is a court session, a hearing, a protest, an outbreak.
 */
const DECISION =
  /хууль|тогтоол|шийдвэр|баталл?аа|батлав|батлах|төсөв|төсвий|тариф|үнэ\s|үнийн|цалин|тэтгэвэр|тэтгэмж|татвар|торгу|томил(?!олт)|чөлөөл|огцор|гэрээ\s+(байгуул|зурл|гарын)|санамж\s+бичиг|хэлэлцээр\s+бат|зөрчил|шалгалт|ял\s|баривч|₮|төгрөг|тэрбум|сая\s+доллар|цэц(?!эр|эг)|шүүх\s+хуралдаан|нэр\s+дэвш|сонсгол|шалгаруул|жагсаал|жагсагч|ажил\s+хая|өвчин|өвчн|халдвар|дэгдэлт|онцгой|гамшиг|ослын|даатгал/i;

/**
 * Agency names that contain a decision word: "Нийгмийн даатгалын ерөнхий газрын дарга … уулзлаа"
 * or "Онцгой байдлын ерөнхий газар … зохион байгууллаа" named no decision, but "даатгал" and
 * "онцгой" lifted the cap. The name is removed before the decision words are read.
 */
const AGENCY_NAMES = /(нийгмийн|эрүүл\s+мэндийн)\s+даатгалын\s+(ерөнхий\s+)?газ\S*|онцгой\s+байдлын\s+(ерөнхий\s+)?газ\S*|(мэргэжлийн\s+)?хяналтын\s+(ерөнхий\s+)?газ\S*|шүүхийн\s+шийдвэр\s+гүйцэтгэх\s+(ерөнхий\s+)?газ\S*/giu;

export function isCeremonial(title: string): boolean {
  const t = title.replace(/\s+/g, " ");
  return CEREMONY.some((re) => re.test(t)) && !DECISION.test(t.replace(AGENCY_NAMES, " "));
}

/** The stored importance: the model's score, capped for a ceremonial headline. Null stays null. */
export function capImportance(title: string, score: number | null): number | null {
  if (score === null) return null;
  return isCeremonial(title) ? Math.min(score, CEREMONY_MAX) : score;
}
