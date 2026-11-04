import type { SourceCategory } from "@/lib/types";

export interface SourceSeed {
  name: string;
  domain: string;
  /** Listing URL the adapter starts from. */
  urlPattern: string;
  category: SourceCategory;
}

const s = (category: SourceCategory, domain: string, name: string, urlPattern = `https://${domain}/`): SourceSeed => ({
  name,
  domain,
  urlPattern,
  category,
});

/**
 * Curated seed list of monitored Mongolian government sources (verified Oct 2026).
 *
 * This is the starting set, not the ceiling: `npm run sources:discover` crawls hub
 * pages (gov.mn, cabinet.gov.mn, burtgel.gov.mn, khural.mn, ...) and adds every new
 * government domain it finds. Domains are canonical hosts after redirects
 * (mmhi.gov.mn → mimr.gov.mn, mrtd.gov.mn → mrt.gov.mn, moc.gov.mn → mocsty.gov.mn).
 *
 * Some hosts block or time out from non-Mongolian IPs, and tender.gov.mn /
 * president.mn sit behind a Cloudflare browser challenge. The scraper records
 * failures per source and backs off instead of failing the batch.
 * tender.gov.mn (Cloudflare 403 to datacenter IPs; robots.txt also bars AI agents) and
 * shilendans.gov.mn (SPA with 7 news items; its JSON API is budget data, not news) are kept as
 * rows but set is_active = false in the database; the seed never re-activates existing rows.
 */
export const SOURCE_SEEDS: SourceSeed[] = [
  // ---------------------------------------------------------------- portals
  s("portal", "opendata.gov.mn", "Нээлттэй өгөгдлийн портал", "https://opendata.gov.mn/api/v1/front/search"),
  s("portal", "tender.gov.mn", "Төрийн худалдан авах ажиллагааны цахим систем", "https://tender.gov.mn/mn/invitation"),
  s("portal", "legalinfo.mn", "Эрх зүйн мэдээллийн нэгдсэн систем", "https://legalinfo.mn/mn/ajaxLlist/"),
  s("portal", "shilendans.gov.mn", "Шилэн данс", "https://shilendans.gov.mn/"),
  s("portal", "gov.mn", "Монгол Улсын Засгийн газар (gov.mn)", "https://www.gov.mn/news"),
  s("portal", "khural.mn", "Иргэдийн Төлөөлөгчдийн Хурлын нэгдсэн портал"),

  // ------------------------------------------- state power & oversight bodies
  s("agency", "parliament.mn", "Монгол Улсын Их Хурал", "https://parliament.mn/api/news/articles/"),
  s("agency", "president.mn", "Монгол Улсын Ерөнхийлөгчийн Тамгын газар"),
  s("agency", "zasag.mn", "Монгол Улсын Засгийн газар", "https://mongolia.gov.mn/feed"),
  s("agency", "cabinet.gov.mn", "Засгийн газрын Хэрэг эрхлэх газар", "https://cabinet.gov.mn/c/news"),
  s("agency", "nsc.gov.mn", "Үндэсний аюулгүй байдлын зөвлөл", "https://nsc.gov.mn/mn"),
  s("agency", "iaac.mn", "Авлигатай тэмцэх газар", "https://iaac.mn/news"),
  s("agency", "audit.mn", "Үндэсний аудитын газар", "https://audit.mn/news"),
  s("agency", "ncoe.gov.mn", "Засгийн газрын хяналт, үнэлгээний үндэсний төв"),
  s("agency", "csc.gov.mn", "Төрийн албаны зөвлөл"),
  s("agency", "nhrcm.gov.mn", "Хүний эрхийн үндэсний комисс"),
  s("agency", "ncge.gov.mn", "Жендэрийн үндэсний хороо"),

  // ---------------------------------------------------------------- judiciary
  s("agency", "supremecourt.mn", "Улсын Дээд шүүх", "https://supremecourt.mn/mn/"),
  s("agency", "judcouncil.mn", "Шүүхийн ерөнхий зөвлөл"),
  s("agency", "conscourt.gov.mn", "Үндсэн хуулийн цэц"), // constcourt.mn no longer resolves
  s("agency", "cd.gov.mn", "Шүүхийн шийдвэр гүйцэтгэх ерөнхий газар"),
  s("agency", "nfa.gov.mn", "Шүүх шинжилгээний ерөнхий газар"),

  // ----------------------------------------------------------------- ministries
  s("ministry", "mof.gov.mn", "Сангийн яам", "https://mof.gov.mn/article/news"),
  s("ministry", "mfa.gov.mn", "Гадаад харилцааны яам", "https://mfa.gov.mn/news"),
  s("ministry", "mojha.gov.mn", "Хууль зүй, дотоод хэргийн яам", "https://mojha.gov.mn/news"),
  s("ministry", "mimr.gov.mn", "Аж үйлдвэр, эрдэс баялгийн яам", "https://www.mimr.gov.mn/"),
  s("ministry", "med.gov.mn", "Эдийн засаг, хөгжлийн яам", "https://med.gov.mn/news"),
  s("ministry", "moh.gov.mn", "Эрүүл мэндийн яам", "https://moh.gov.mn/home"),
  s("ministry", "mecc.gov.mn", "Байгаль орчин, уур амьсгалын өөрчлөлтийн яам", "https://mecc.gov.mn/posts"),
  s("ministry", "mlsp.gov.mn", "Хөдөлмөр, нийгмийн хамгааллын яам", "https://mlsp.gov.mn/content?c=1"),
  // Read from the www.gov.mn portal (adapters/govmn.ts): gadpwd.gov.mn no longer resolves.
  s("agency", "gadpwd.gov.mn", "Хөгжлийн бэрхшээлтэй хүний хөгжлийн ерөнхий газар"),
  s("agency", "vet.gov.mn", "Мал эмнэлгийн ерөнхий газар"),
  s("ministry", "mofa.gov.mn", "Хүнс, хөдөө аж ахуй, хөнгөн үйлдвэрийн яам", "https://mofa.gov.mn/news"),
  s("ministry", "mrt.gov.mn", "Зам, тээврийн яам"),
  s("ministry", "mcud.gov.mn", "Барилга, хот байгуулалтын яам"),
  s("ministry", "mod.gov.mn", "Батлан хамгаалах яам", "https://mod.gov.mn/category/news/"),
  s("ministry", "energy.gov.mn", "Эрчим хүчний яам"),
  s("ministry", "meds.gov.mn", "Боловсролын яам", "https://meds.gov.mn/news"),
  s("ministry", "mddic.gov.mn", "Цахим хөгжил, инновац, харилцаа холбооны яам", "https://mddic.gov.mn/mn/"),
  s("ministry", "mocsty.gov.mn", "Соёл, спорт, аялал жуулчлал, залуучуудын яам"),

  // ------------------------------------------------- finance, tax, economy
  s("agency", "mongolbank.mn", "Монголбанк", "https://www.mongolbank.mn/mn/"),
  s("agency", "frc.mn", "Санхүүгийн зохицуулах хороо"),
  s("agency", "mta.gov.mn", "Татварын ерөнхий газар", "https://mta.gov.mn/home"),
  s("agency", "customs.gov.mn", "Гаалийн ерөнхий газар"),
  s("agency", "nso.mn", "Үндэсний статистикийн хороо", "https://www.nso.mn/mn"),
  s("agency", "pcsp.gov.mn", "Төрийн өмчийн бодлого, зохицуулалтын газар"),
  s("agency", "chinggiskhaanswf.mn", "Чингис хаан баялгийн сан", "https://chinggiskhaanswf.mn/mn"),
  s("agency", "sme.gov.mn", "Жижиг, дунд үйлдвэрийн газар"),
  s("agency", "afccp.gov.mn", "Шударга өрсөлдөөн, хэрэглэгчийн төлөө газар"),
  s("agency", "ipom.gov.mn", "Оюуны өмчийн газар", "https://ipom.gov.mn/mn.php"),
  s("agency", "masm.gov.mn", "Стандарт, хэмжил зүйн газар"),
  s("agency", "mpr.gov.mn", "Барьцааны мэдэгдэл бүртгэх систем"),

  // ----------------------------------------- mining, land, energy regulators
  s("agency", "mrpam.gov.mn", "Ашигт малтмал, газрын тосны газар"),
  s("agency", "gazar.gov.mn", "Газар зохион байгуулалт, геодези, зураг зүйн ерөнхий газар"),
  s("agency", "crc.gov.mn", "Харилцаа холбооны зохицуулах хороо"),
  s("agency", "water.gov.mn", "Усны газар"),
  s("agency", "namem.gov.mn", "Цаг уур, орчны шинжилгээний газар"),

  // --------------------------------------- social, health, public services
  s("agency", "ndaatgal.mn", "Нийгмийн даатгалын ерөнхий газар", "https://www.ndaatgal.mn/"),
  s("agency", "emd.gov.mn", "Эрүүл мэндийн даатгалын ерөнхий газар"),
  s("agency", "mmra.gov.mn", "Эм, эмнэлгийн хэрэгслийн зохицуулалтын газар"),
  s("agency", "burtgel.gov.mn", "Улсын бүртгэлийн ерөнхий газар"),
  s("agency", "immigration.gov.mn", "Иргэний харьяалал, шилжилт хөдөлгөөний ерөнхий газар", "https://immigration.gov.mn/mn/"),
  s("agency", "culture.gov.mn", "Соёл урлагийн газар"),
  s("agency", "sport.gov.mn", "Биеийн тамир, спортын газар"),
  s("agency", "naog.gov.mn", "Удирдлагын академи"),

  // ----------------------------------------------- security & enforcement
  s("agency", "police.gov.mn", "Цагдаагийн ерөнхий газар"),
  s("agency", "bpo.gov.mn", "Хил хамгаалах ерөнхий газар"),
  s("agency", "sspa.gov.mn", "Тагнуулын ерөнхий газар", "https://sspa.gov.mn/mn"),
  s("agency", "mcaa.gov.mn", "Иргэний нисэхийн ерөнхий газар"),
  s("agency", "inspection.gov.mn", "Мэргэжлийн хяналтын ерөнхий газар"),

  // ------------------------------- local: aimags (21), capital city & districts
  s("local", "arkhangai.gov.mn", "Архангай аймаг"),
  s("local", "bayan-olgii.gov.mn", "Баян-Өлгий аймаг"),
  s("local", "bayankhongor.gov.mn", "Баянхонгор аймаг"),
  s("local", "bulgan.gov.mn", "Булган аймаг"),
  s("local", "govi-altai.gov.mn", "Говь-Алтай аймаг"),
  s("local", "govisumber.gov.mn", "Говьсүмбэр аймаг"),
  s("local", "darkhan.gov.mn", "Дархан-Уул аймаг"),
  s("local", "dornogovi.gov.mn", "Дорноговь аймаг"),
  s("local", "dornod.gov.mn", "Дорнод аймаг"),
  s("local", "dundgovi.gov.mn", "Дундговь аймаг"),
  s("local", "zavkhan.gov.mn", "Завхан аймаг", "http://zavkhan.gov.mn/"),
  s("local", "orkhon.gov.mn", "Орхон аймаг"),
  s("local", "uvurkhangai.gov.mn", "Өвөрхангай аймаг"),
  s("local", "omnogovi.gov.mn", "Өмнөговь аймаг"),
  s("local", "sukhbaatar.gov.mn", "Сүхбаатар аймаг"),
  s("local", "selenge.gov.mn", "Сэлэнгэ аймаг"),
  s("local", "tov.gov.mn", "Төв аймаг"),
  s("local", "uvs.gov.mn", "Увс аймаг"),
  s("local", "khovd.gov.mn", "Ховд аймаг"),
  s("local", "khovsgol.gov.mn", "Хөвсгөл аймаг"),
  s("local", "khentii.mn", "Хэнтий аймаг"),
  s("local", "ulaanbaatar.mn", "Нийслэл Улаанбаатар хот"),
  s("local", "nad.ub.gov.mn", "Налайх дүүрэг"),
  s("local", "bnd.ub.gov.mn", "Багануур дүүрэг"),
  s("local", "bagakhangai.ub.gov.mn", "Багахангай дүүрэг", "http://www.bagakhangai.ub.gov.mn/"),
  s("local", "chingeltei.gov.mn", "Чингэлтэй дүүрэг", "http://www.chingeltei.gov.mn/"),
  s("local", "niislel.khural.mn", "Нийслэлийн Иргэдийн Төлөөлөгчдийн Хурал"),
  // Ulaanbaatar districts (Oct 2026): khanuul.mn, bgd.mn and sbd.gov.mn are the districts' own
  // domains; ulaanbaatar.mn itself times out from outside Mongolia. bzd.ub.gov.mn (Баянзүрх)
  // answers with a hosting "suspended" page, so its news is read from the www.gov.mn portal
  // (adapters/govmn.ts), like several other bodies below.
  s("local", "bzd.ub.gov.mn", "Баянзүрх дүүрэг"),
  s("local", "khanuul.mn", "Хан-Уул дүүрэг", "https://www.khanuul.mn/"),
  s("local", "shd.ub.gov.mn", "Сонгинохайрхан дүүрэг", "http://www.shd.ub.gov.mn/"),
  s("local", "bgd.mn", "Баянгол дүүрэг", "https://www.bgd.mn/"),
  s("local", "sbd.gov.mn", "Сүхбаатар дүүрэг"),
];

/** Pages that link out to many government sites; used by `npm run sources:discover`. */
export const DISCOVERY_HUBS = [
  "https://www.gov.mn/",
  "https://mongolia.gov.mn/",
  "https://cabinet.gov.mn/",
  "https://burtgel.gov.mn/",
  "https://shilendans.gov.mn/",
  "https://khural.mn/",
  "https://www.mongolbank.mn/mn/",
  "https://legalinfo.mn/mn",
];

/** Aimag slugs used to classify discovered domains as local government. */
export const AIMAG_SLUGS = [
  "arkhangai", "bayan-olgii", "bayanolgii", "bayankhongor", "bulgan", "govi-altai", "govialtai",
  "govisumber", "darkhan", "darkhan-uul", "dornogovi", "dornod", "dundgovi", "zavkhan", "orkhon",
  "uvurkhangai", "ovorkhangai", "omnogovi", "umnugovi", "sukhbaatar", "selenge", "tov", "tuv",
  "uvs", "khovd", "khovsgol", "khuvsgul", "khentii", "ulaanbaatar", "niislel",
  // Ulaanbaatar districts by their site slugs
  "khanuul", "shd", "bgd", "sbd", "bzd", "chingeltei", "nalaikh", "baganuur", "bagakhangai",
];
