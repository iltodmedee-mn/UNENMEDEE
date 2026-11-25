/**
 * The approved 2027 budget, hand-typed from the official pages below (Nov 2026, the owner asked for
 * it on /budget). These are the law's figures, so they do not change: no sync, no database row.
 * Amounts are тэрбум ₮ as the sources print them. Facts only: every line names its source, the
 * opposition's view is attributed to its speaker, and nothing here judges anyone
 * (`tests/approved-budget.test.ts`).
 *
 * The totals are the consolidated budget's (нэгдсэн төсөв) framework ceilings the Khural passed with
 * the budget law; the state budget law itself was approved on Nov 13 2026.
 */

export interface BudgetSource {
  label: string;
  url: string;
}

export const SOURCES = {
  framework: {
    label: "УИХ, 11.06 · төсвийн хүрээ, Төсвийн тогтвортой байдлын зөвлөл",
    url: "https://parliament.mn/parliament-news/detail/ikh-mongol-uls-baiguulagdsany-820-zhiliin-oig-tokhiolduulan-ikh-ezen-chingis-khaany-tort-esny-ov-ulamzhlalyg-deedlen-monkhzhuulekh-tukhai-ulsyn-ikh-khurlyn-togtoolyn-tosliig-batallaa",
  },
  pm: {
    label: "Ерөнхий сайдын танилцуулга, 11.16",
    url: "https://mongolia.gov.mn/news/view/27903",
  },
  oyuTolgoi: {
    label: "Оюу толгойн захидал, 11.11",
    url: "https://www.gov.mn/news/n/e65f",
  },
  culture: {
    label: "Соёл, спортын яам, 11.14",
    url: "https://mocsty.gov.mn/news/7OHRxkLPzzuSKbPgMivGR82b7Ilcvd6B",
  },
  revised2026: {
    label: "Сангийн яам, 09.30 · 2026 оны тодотгол",
    url: "https://www.gov.mn/news/n/bc55",
  },
  question: {
    label: "УИХ, 10.30 · асуулгын цаг",
    url: "https://parliament.mn/parliament-news/detail/ulsyn-ikh-khurlyn-asuulgyn-tsagaar-tosov-sankhuu-sakhilga-khariutslagyn-asuudlyg-khondloo",
  },
  subcommittee: {
    label: "УИХ, 10.21 · Төсвийн зарлагын хяналтын дэд хороо",
    url: "https://parliament.mn/parliament-news/detail/tosviin-zarlagyn-khianaltyn-ded-khoroo-mongol-ulsyn-2027-ony-tosviin-tukhai-khuuliin-tosluudiin-gurav-dakh-kheleltsuulgiig-khiilee",
  },
} satisfies Record<string, BudgetSource>;

export const APPROVED_2027 = {
  year: 2027,
  approvedOn: "2026-11-13",
  /** тэрбум ₮ */
  expenditure: 41_586.0,
  revenue: 39_280.0,
  balance: -2_306.0,
  debt: 57_650.0,
  current: 33_583.2,
  capital: 8_333.3,
  /** Share of GDP, % */
  gdp: { expenditure: 36.1, revenue: 34.1, balance: -2.0, debt: 50.0 },
  /** The 2026 revised budget's expenditure (тэрбум ₮), for "+22%". */
  expenditure2026: 34_000.0,
  /** The council's shares of total spending, before and after the Khural's 2 их наяд cut (%). */
  currentShare: { before: 77.1, after: 80.8 },
  capitalShare: { before: 23.7, after: 20.0 },
  assumed: { gdpGrowth: 5.8, inflation: 8.0 },
} as const;

/** "Танд хамаатай": what changes for a reader, from the Prime Minister's list. */
export const FOR_YOU: { text: string; strong: string; note: string }[] = [
  {
    text: "Сарын цалингийн 792 мянган ₮ хүртэлх хэсэг",
    strong: "орлогын татваргүй",
    note: "жилд ~1 сая ₮",
  },
  { text: "Тэтгэвэр 1-р сарын 1-нээс", strong: "+10%", note: "562 мянган хүн" },
  {
    text: "Хөгжлийн бэрхшээлтэй, ахмадын халамжийн тэтгэвэр",
    strong: "600 мянган ₮",
    note: "+122 / +168 мянга",
  },
  {
    text: "Төрийн албан хаагчийн цалин",
    strong: "+10% / +20%",
    note: "213 мянган хүн",
  },
  {
    text: "Ахмадын зүрх, чихрийн шижин, даралтын эм",
    strong: "үнэгүй",
    note: "1-р сарын 1-нээс",
  },
  {
    text: "Орон сууцтай болох айл",
    strong: "16 мянга",
    note: "+1.8 их наяд ₮",
  },
];

/** "Онцлох зардал, хөнгөлөлт" (тэрбум ₮). Capital lines only for schools and hospitals: wages are in current spending. */
export const HIGHLIGHTS: {
  name: string;
  sub: string;
  value: number;
  source: keyof typeof SOURCES;
}[] = [
  {
    name: "Улсын төсвийн хөрөнгө оруулалт",
    sub: "943 төсөл, 435 нь шинэ",
    value: 4_000,
    source: "pm",
  },
  {
    name: "Орон сууцны нэмэлт санхүүжилт",
    sub: "16 мянган айл",
    value: 1_800,
    source: "pm",
  },
  {
    name: "Иргэдийн татварын хөнгөлөлт",
    sub: "792 мянга хүртэлх цалин татваргүй",
    value: 1_300,
    source: "pm",
  },
  {
    name: "Бизнесийн татварын хөнгөлөлт",
    sub: "1%, 15%, НӨАТ-ын босго 400 сая",
    value: 1_300,
    source: "pm",
  },
  {
    name: "Сургууль, цэцэрлэгийн барилга",
    sub: "142 сургууль, 72 цэцэрлэг, 39 дотуур байр",
    value: 928,
    source: "pm",
  },
  { name: "Зам, тээвэр", sub: "36 төсөл, +375 км", value: 910.7, source: "pm" },
  {
    name: "Соёл, спорт, аялал жуулчлал, залуучууд",
    sub: "6 624 албан хаагчийн цалин +50%",
    value: 770.7,
    source: "culture",
  },
  {
    name: "Эмнэлгийн барилга",
    sub: "69 төсөл, 44 эмнэлэг",
    value: 264.6,
    source: "pm",
  },
];

/** The Budget Stability Council's conclusions, in plain words. */
export const COUNCIL = [
  "Зарлагын өсөлт хуулиар тогтоосон хязгаараас (өмнөх 12 жилийн уул уурхайн бус ДНБ-ий дундаж өсөлт) хэтэрсэн хэвээр байна.",
  "Зарлагын 80 гаруй хувь нь буцааж бууруулахад хэцүү цалин, шилжүүлэг. Төсвийн эрсдэл нэмэгдэж, бодлогын орон зай хумигдана.",
];

export const OYU_TOLGOI =
  "Ногдол ашгийн 3 их наяд ₮ бүхэлдээ Үндэсний баялгийн санд орно. Засгийн газрын төсөлд 2 их наядыг нь хөрөнгө оруулалтад зарцуулахаар тусгаж байсныг УИХ өөрчилсөн.";

/** Both sides, each in their own words (attributed). */
export const VIEWS: {
  who: string;
  text: string;
  source: keyof typeof SOURCES;
}[] = [
  {
    who: "Б.Түвшин (АН-ын бүлэг, УИХ 10.30)",
    text: "Зарлага 2017 онд 9.0 их наяд байсан бол 2027 онд 43.5 болж, урсгал зардал 7.0-оос 33.5 их наяд болсон ч өрхийн бодит орлого 62% л өссөн.",
    source: "question",
  },
  {
    who: "Сангийн яам (УИХ 10.21)",
    text: "Зарлага 7, орлого 6.5 их наядаар нэмэгдсэн нь ногдол ашиг болон хуульчлагдсан зардалтай холбоотой.",
    source: "subcommittee",
  },
];
