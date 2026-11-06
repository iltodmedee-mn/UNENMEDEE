/**
 * "Нэр томьёо" (/glossary): the words government news is written in, each in one plain sentence.
 * 15 % of 18–24s say news is hard to understand (Reuters Institute, 2026), and our summaries keep
 * the official terms (тогтоол, тодотгол, НӨАТ) because they are the facts.
 *
 * The article page marks the first occurrence of an `inline` term in the AI summary as a button
 * that opens its sentence in a native popover (no client JS); every term is listed on /glossary.
 * Written by the site, not by AI; corrections go to the contact address on /about.
 *
 * `pattern` is matched with the `u` flag (case-sensitive: abbreviations are capitals, words are
 * lower-case or sentence-initial, so they start with `[Тт]`-style classes). A word may carry
 * Mongolian suffixes (`\p{L}*` after the stem), an abbreviation only a hyphenated ending.
 */
export interface GlossaryTerm {
  slug: string;
  term: string;
  /** One sentence, plain words. */
  text: string;
  pattern: string;
  /** Marked inside summaries; the rest only appear on /glossary. */
  inline?: boolean;
  group: "law" | "state" | "money" | "people";
}

const WORD_END = "\\p{L}*";
const ABBR_END = "(?![\\p{L}\\p{N}])(?:-\\p{L}+)?";

export const GLOSSARY: GlossaryTerm[] = [
  // ---------------------------------------------------------------- law
  { slug: "togtool", term: "Тогтоол", group: "law", inline: true, pattern: `[Тт]огтоол${WORD_END}`, text: "УИХ, Засгийн газар, Иргэдийн Төлөөлөгчдийн Хурал зэрэг олон гишүүнтэй байгууллагын гаргасан шийдвэр." },
  { slug: "zakhiramj", term: "Захирамж", group: "law", inline: true, pattern: `[Зз]ахирамж${WORD_END}`, text: "Ерөнхий сайд, Засаг дарга зэрэг ганц удирдах албан тушаалтны гаргасан шийдвэр." },
  { slug: "tushaal", term: "Тушаал", group: "law", inline: true, pattern: `(?<![Аа]лбан )[Тт]ушаал(?!т)${WORD_END}`, text: "Сайд, агентлагийн дарга зэрэг албан тушаалтны өөрийн эрхийн хүрээнд гаргасан шийдвэр." },
  { slug: "zarlig", term: "Зарлиг", group: "law", inline: true, pattern: `[Зз]арлиг${WORD_END}`, text: "Ерөнхийлөгчийн гаргасан шийдвэр." },
  { slug: "juram", term: "Журам", group: "law", inline: true, pattern: `[Жж]урам${WORD_END}`, text: "Тодорхой ажлыг хэрхэн хийхийг алхам алхмаар заасан дүрэм; ихэвчлэн тогтоол, тушаалын хавсралтаар батлагддаг." },
  { slug: "khuuliin-tusul", term: "Хуулийн төсөл", group: "law", inline: true, pattern: `[Хх]уулийн төсл${WORD_END}|[Хх]уулийн төсөл${WORD_END}`, text: "УИХ-д өргөн мэдүүлсэн, хараахан батлагдаагүй хуулийн бичвэр." },
  // Not marked inline: "хориг" is also any ban ("экспортын хориг").
  { slug: "khorig", term: "Хориг (Ерөнхийлөгчийн)", group: "law", pattern: `[Хх]ориг(?!л)${WORD_END}`, text: "Ерөнхийлөгч УИХ-ын баталсан хууль, шийдвэрийг бүхэлд нь эсвэл хэсэгчлэн зөвшөөрөхгүй байх эрх; УИХ хоригийг хэлэлцэж шийднэ." },
  { slug: "tsets", term: "Үндсэн хуулийн цэц", group: "law", pattern: `Үндсэн хуулийн [Цц]эц${WORD_END}`, text: "Хууль, шийдвэр Үндсэн хуулийг зөрчсөн эсэх маргааныг шийддэг байгууллага." },

  // ---------------------------------------------------------------- state
  { slug: "uikh", term: "УИХ", group: "state", pattern: `УИХ${ABBR_END}`, text: "Улсын Их Хурал: 126 гишүүнтэй парламент. Хууль, улсын төсвийг баталдаг." },
  // Only a session ("ээлжит чуулган"): "уул уурхайн чуулган" is a conference.
  { slug: "chuulgan", term: "Чуулган (УИХ-ын)", group: "state", inline: true, pattern: `(?:[Ээ]элжит(?: бус)?|[Нн]амрын|[Хх]аврын) чуулган${WORD_END}`, text: "УИХ-ын хуралдаж ажилладаг үе: намрын ээлжит чуулган 10 сард, хаврынх 4 сард эхэлдэг; шаардлагатай бол ээлжит бус чуулган зарлана." },
  { slug: "baingyn-khoroo", term: "Байнгын хороо", group: "state", inline: true, pattern: `[Бб]айнгын хороо${WORD_END}`, text: "Нэг салбарын асуудлыг (төсөв, хууль зүй гэх мэт) нэгдсэн хуралдаанаас өмнө хэлэлцдэг УИХ-ын гишүүдийн хороо." },
  { slug: "negdsen-khuraldaan", term: "Нэгдсэн хуралдаан", group: "state", inline: true, pattern: `[Нн]эгдсэн хуралда${WORD_END}`, text: "УИХ-ын бүх гишүүний хуралдаан: хуулийг эцэслэн баталдаг шат." },
  { slug: "itkh", term: "ИТХ", group: "state", inline: true, pattern: `ИТХ${ABBR_END}`, text: "Иргэдийн Төлөөлөгчдийн Хурал: аймаг, нийслэл, сум, дүүргийн сонгогдсон зөвлөл. Орон нутгийн төсвийг баталдаг." },
  { slug: "zasag-darga", term: "Засаг дарга", group: "state", pattern: `[Зз]асаг дарга${WORD_END}`, text: "Аймаг, нийслэл, сум, дүүргийн гүйцэтгэх засаглалын тэргүүн." },
  { slug: "zdtg", term: "ЗДТГ", group: "state", inline: true, pattern: `ЗДТГ${ABBR_END}`, text: "Засаг даргын Тамгын газар: Засаг даргын ажлын алба." },
  { slug: "agentlag", term: "Агентлаг", group: "state", inline: true, pattern: `[Аа]гентлаг${WORD_END}`, text: "Яамны бодлогыг хэрэгжүүлдэг төрийн байгууллага (… газар, … алба)." },
  { slug: "shuurkhai", term: "Шуурхай хуралдаан", group: "state", inline: true, pattern: `[Шш]уурхай хура${WORD_END}`, text: "Засаг дарга, сайдын ажил тараах тогтмол хурал; өөрөө шийдвэр биш, шийдвэрийн тухай мэдээ байж болно." },
  { slug: "atg", term: "АТГ", group: "state", inline: true, pattern: `АТГ${ABBR_END}`, text: "Авлигатай тэмцэх газар: авлигын гэмт хэргийг шалгаж, албан тушаалтны хөрөнгө, орлогын мэдүүлгийг хүлээн авдаг." },
  { slug: "uag", term: "ҮАГ", group: "state", inline: true, pattern: `ҮАГ${ABBR_END}`, text: "Үндэсний аудитын газар: төрийн мөнгө зөв зарцуулагдсан эсэхийг шалгаж, дүгнэлт гаргадаг." },
  { slug: "usk", term: "ҮСХ", group: "state", inline: true, pattern: `ҮСХ${ABBR_END}`, text: "Үндэсний статистикийн хороо: хүн ам, үнэ, цалин, ДНБ зэрэг албан ёсны тоог гаргадаг." },
  { slug: "khuek", term: "ХЭҮК", group: "state", inline: true, pattern: `ХЭҮК${ABBR_END}`, text: "Хүний эрхийн үндэсний комисс: хүний эрхийн зөрчлийн гомдол хүлээн авч, хянадаг." },
  { slug: "ezkhzk", term: "ЭХЗХ", group: "state", inline: true, pattern: `ЭХЗХ${ABBR_END}`, text: "Эрчим хүчний зохицуулах хороо: цахилгаан, дулааны үнэ (тариф)-ийг баталдаг." },

  // ---------------------------------------------------------------- money
  { slug: "todotgol", term: "Төсвийн тодотгол", group: "money", inline: true, pattern: `[Тт]одотгол${WORD_END}`, text: "Оны дундуур, батлагдсан төсвийн орлого, зарлагад өөрчлөлт оруулах." },
  { slug: "tusviin-aldagdal", term: "Төсвийн алдагдал", group: "money", inline: true, pattern: `[Тт]өсвийн алдагдал${WORD_END}`, text: "Төсвийн зарлага орлогоосоо их байх; зөрүүг ихэвчлэн зээлээр нөхнө." },
  { slug: "shilen-dans", term: "Шилэн данс", group: "money", inline: true, pattern: `[Шш]илэн данс${WORD_END}`, text: "Төрийн байгууллагуудын орлого, зарлага, худалдан авалтыг нийтэд нээлттэй болгосон систем (shilendans.gov.mn)." },
  { slug: "tender", term: "Тендер", group: "money", inline: true, pattern: `[Тт]ендер${WORD_END}`, text: "Төрийн худалдан авалтад нийлүүлэгчдийг өрсөлдүүлж, хамгийн сайн саналыг сонгох ажиллагаа." },
  { slug: "shuud-geree", term: "Шууд гэрээ", group: "money", inline: true, pattern: `[Шш]ууд гэрээ${WORD_END}`, text: "Өрсөлдүүлэлгүйгээр нэг нийлүүлэгчтэй гэрээ байгуулах арга; хуульд заасан тохиолдолд л зөвшөөрнө." },
  { slug: "tezu", term: "ТЭЗҮ", group: "money", inline: true, pattern: `ТЭЗҮ${ABBR_END}`, text: "Техник, эдийн засгийн үндэслэл: төсөл хэрэгжих боломжтой, ашигтай эсэхийг тооцсон баримт бичиг." },
  { slug: "kontsess", term: "Концесс", group: "money", inline: true, pattern: `[Кк]онцесс${WORD_END}`, text: "Хувийн компани зам, барилга зэрэг төрийн өмчийг барьж эсвэл ашиглаж, гэрээний хугацаанд орлого авдаг хэлбэр." },
  { slug: "bond", term: "Бонд", group: "money", inline: true, pattern: `[Бб]онд(?!\\p{L})|[Бб]ондын|[Бб]ондоор|[Бб]ондыг`, text: "Улс эсвэл компани мөнгө зээлэхдээ гаргадаг өрийн бичиг; хугацаанд нь хүүтэй нь буцааж төлнө." },
  { slug: "dnb", term: "ДНБ", group: "money", inline: true, pattern: `ДНБ${ABBR_END}`, text: "Дотоодын нийт бүтээгдэхүүн: улсад нэг жилд үйлдвэрлэсэн бүх бараа, үйлчилгээний үнэ." },
  { slug: "inflyats", term: "Инфляц", group: "money", pattern: `[Ии]нфляц${WORD_END}`, text: "Үнийн ерөнхий түвшин өсөх; жилийн инфляц 10% гэвэл үнэ жилийн өмнөхөөс дунджаар 10% өндөр." },
  { slug: "bodlogyn-khuu", term: "Бодлогын хүү", group: "money", inline: true, pattern: `[Бб]одлогын хүү${WORD_END}`, text: "Монголбанкны тогтоодог суурь хүү; банкуудын зээл, хадгаламжийн хүүнд нөлөөлдөг." },
  { slug: "valyutyn-nuuts", term: "Валютын нөөц", group: "money", inline: true, pattern: `[Вв]алютын нөөц${WORD_END}`, text: "Монголбанкны гадаад валют, алтны нөөц: импорт, гадаад өрийн төлбөрт хэрэглэж, төгрөгийн ханшийг тогтвортой байлгадаг." },
  { slug: "nuat", term: "НӨАТ", group: "money", inline: true, pattern: `НӨАТ${ABBR_END}`, text: "Нэмэгдсэн өртгийн албан татвар: бараа, үйлчилгээний үнэд шингэсэн 10%-ийн татвар." },
  { slug: "khkhoat", term: "ХХОАТ", group: "money", inline: true, pattern: `ХХОАТ${ABBR_END}`, text: "Хувь хүний орлогын албан татвар: цалин, бусад орлогоос суутгадаг татвар." },
  { slug: "ndsh", term: "НДШ", group: "money", inline: true, pattern: `НДШ${ABBR_END}`, text: "Нийгмийн даатгалын шимтгэл: тэтгэвэр, тэтгэмж, эрүүл мэндийн даатгалд цалингаас төлдөг мөнгө." },
  { slug: "aanoat", term: "ААНОАТ", group: "money", inline: true, pattern: `ААНОАТ${ABBR_END}`, text: "Аж ахуйн нэгжийн орлогын албан татвар: компанийн ашгаас төлдөг татвар." },
  { slug: "tarif", term: "Тариф", group: "money", inline: true, pattern: `[Тт]ариф${WORD_END}`, text: "Цахилгаан, дулаан, ус зэрэг үйлчилгээний албан ёсоор тогтоосон үнэ." },
  { slug: "tuhk", term: "ТӨХК", group: "money", inline: true, pattern: `ТӨХК${ABBR_END}`, text: "Төрийн өмчит хувьцаат компани: хувьцааных нь бүгд эсвэл ихэнх нь төрийнх." },
  { slug: "tuug", term: "ТӨҮГ", group: "money", inline: true, pattern: `ТӨҮГ${ABBR_END}`, text: "Төрийн өмчит үйлдвэрийн газар: төрийн өмчлөлд байдаг аж ахуйн нэгж." },
  { slug: "mega", term: "Мега төсөл", group: "money", inline: true, pattern: `[Мм]ега төсл${WORD_END}|[Мм]ега төсөл${WORD_END}`, text: "Засгийн газар «мега» гэж нэрлэсэн томоохон дэд бүтэц, үйлдвэрийн төсөл (/projects хуудсанд жагссан)." },
  { slug: "audit-sorog", term: "Сөрөг дүгнэлт", group: "money", inline: true, pattern: `[Сс]өрөг дүгнэлт${WORD_END}`, text: "Аудит санхүүгийн тайланг бодит байдлыг үнэн зөв харуулаагүй гэж үзсэн дүгнэлт." },
  { slug: "audit-khyazgaarlalttai", term: "Хязгаарлалттай дүгнэлт", group: "money", inline: true, pattern: `[Хх]язгаарлалттай дүгнэлт${WORD_END}`, text: "Аудит тайланг ерөнхийдөө зөв, гэхдээ тодорхой хэсэгт нь асуудалтай гэж үзсэн дүгнэлт." },

  // ---------------------------------------------------------------- people
  { slug: "khaskhom", term: "ХАСХОМ", group: "people", inline: true, pattern: `ХАСХОМ${ABBR_END}`, text: "Хувийн ашиг сонирхол, хөрөнгө, орлогын мэдүүлэг: албан тушаалтан жил бүр АТГ-д өгдөг, нийтэд ил байдаг." },
  { slug: "ashig-sonirkhol", term: "Ашиг сонирхлын зөрчил", group: "people", inline: true, pattern: `[Аа]шиг сонирхлын зөрчил${WORD_END}`, text: "Албан тушаалтны хувийн ашиг сонирхол албан үүрэгтэй нь зөрчилдөх байдал; хууль үүнийг мэдүүлж, татгалзахыг шаарддаг." },
  { slug: "mandat", term: "Мандат", group: "people", inline: true, pattern: `[Мм]андат${WORD_END}`, text: "Сонгогдсон төлөөлөгчийн бүрэн эрх." },
  { slug: "toirog", term: "Тойрог", group: "people", pattern: `[Тт]ойрог${WORD_END}`, text: "Сонгуулийн тойрог: тодорхой нутаг дэвсгэрээс гишүүн сонгогддог хэсэг." },
];

export const GLOSSARY_GROUPS: Record<GlossaryTerm["group"], string> = {
  law: "Хууль, шийдвэр",
  state: "Төрийн байгууллага",
  money: "Мөнгө, төсөв",
  people: "Албан тушаалтан",
};

const BEFORE = "(?<![\\p{L}\\p{N}])";
const INLINE = GLOSSARY.filter((t) => t.inline);
const INLINE_RE = new RegExp(INLINE.map((t, i) => `${BEFORE}(?<t${i}>${t.pattern})`).join("|"), "gu");

export type GlossarySegment = { text: string; term?: undefined } | { text: string; term: GlossaryTerm };

/**
 * `text` cut into plain runs and glossary terms. Each term is marked at its first occurrence only,
 * across every call that shares `seen`, and at most `max` terms in all, so a summary never turns
 * into a page of underlines.
 */
export function glossarySegments(text: string, seen: Set<string> = new Set(), max = 4): GlossarySegment[] {
  const out: GlossarySegment[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (seen.size >= max) break;
    const i = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0];
    const term = i ? INLINE[Number(i.slice(1))] : undefined;
    if (!term || seen.has(term.slug)) continue;
    seen.add(term.slug);
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], term });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
