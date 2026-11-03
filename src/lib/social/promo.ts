/**
 * The Launchpad campaign (Nov 2026): one post a day, 3–7 November, 19:00 Ulaanbaatar, asking
 * readers to vote for ИЛ ТОД МЭДЭЭ on launchpad.mn and to leave feedback. Each day has its own
 * short video (public/promo/launchpad-d<n>.mp4; its narration is not the post text) and its own
 * texts. `npm run social:post -- --mode promo` posts the day that is due; nothing after the last
 * entry, so the campaign ends by itself (the voting week closes on 8 November).
 */
export const LAUNCHPAD_URL = "https://launchpad.mn/products/il-tod-medee";

/** A day is posted only inside this window after its time (GitHub starts runs late; never at night). */
export const PROMO_WINDOW_H = 8;

export interface PromoPost {
  day: number;
  /** UTC time it may go out from. */
  postAt: string;
  /** Path under the site (public/promo). */
  video: string;
  facebook: string;
  instagram: string;
  threads: string;
}

const TOP = `👉 ${LAUNCHPAD_URL}`;
const FB_TAGS = "#ИлТодМэдээ #Launchpad #Монгол";
const IG_TAGS = "#ИлТодМэдээ #Launchpad #Монгол #Mongolia #мэдээ #iltodmedee";
const ASK = "Линк дээр дараад «Санал өгөх ▲». 10 секунд л болно 🙏";

const BODY: Record<number, { text: string; short: string }> = {
  1: {
    text: `Зогс ✋ Төрийн 139 сайт өдөр бүр мэдээ гаргадаг. Чи хэдийг нь уншсан бэ? 😅

Бид бүгдийг нь уншаад, пи-арыг нь хасаж, гол тоо, шийдвэрийг нь л үлдээдэг. Үнэгүй, сурталчилгаагүй.

ИЛ ТОД МЭДЭЭ Launchpad дээр гарлаа 🚀 Нэг санал = нэг дусал. Дусал дуслаар далай 🌊
${ASK}
💬 Юу дутуу байна, сэтгэгдэлд бичээрэй!`,
    short: "Зогс ✋ Төрийн 139 сайт өдөр бүр мэдээ гаргадаг. Бид бүгдийг нь уншаад гол тоо, шийдвэрийг нь л үлдээдэг. Launchpad дээр гарлаа 🚀 Нэг санал = нэг дусал 🌊",
  },
  2: {
    text: `😴 «…явцыг хянан хэлэлцлээ.»
Тэгээд юу болсон гэж?

Дотор нь уншвал: төслийн 45% гүйцэтгэгдсэн 👀 Тэрийгээ яагаад гарчиг дээрээ бичдэггүй юм бэ?

ИЛ ТОД МЭДЭЭ тоо, шийдвэрийг гарчгийн эхэнд бичдэг. Пи-ар биш, баримт.
🗳️ Санал нийлж байвал Launchpad дээр нэг санал өгөөч.
${ASK}
💬 Юуг сайжруулахаа бичээрэй!`,
    short: "😴 «…явцыг хянан хэлэлцлээ.» Тэгээд? Дотор нь: төслийн 45% гүйцэтгэгдсэн 👀 ИЛ ТОД МЭДЭЭ тоог нь гарчгийн эхэнд бичдэг. Пи-ар биш, баримт. Launchpad дээр санал өгөөч 🗳️",
  },
  3: {
    text: `💸 Цалин орлоо... тэгээд яагаад ийм бага юм бэ?

Татвар. Харин тэр мөнгө чинь хаашаа явдгийг харж байсан уу?

ИЛ ТОД МЭДЭЭ дээр: улсын төсөв, тендер хэнд очсон, гишүүд ямар хөрөнгө мэдүүлсэн. Бүгд албан ёсны эх сурвалжтай.

🗳️ Энэ долоо хоногт Launchpad дээр санал хураалт явж байна. Чи бас дэмжээрэй!
${ASK}`,
    short: "💸 Цалин орлоо... яагаад ийм бага юм? Татвар. Тэр мөнгө хаашаа явдгийг ИЛ ТОД МЭДЭЭ дээр хар: төсөв, тендер, гишүүдийн хөрөнгө. Launchpad дээр дэмжээрэй 🗳️",
  },
  4: {
    text: `Та нар хэлсэн, бид хийсэн ✅

«Тендер хармаар байна» → нэмсэн.
«Утсан дээр эвгүй байна» → зассан.

Одоо чиний ээлж: юу дутуу байна? Ямар мэдээ, ямар тоо хармаар байна?
🗳️ Launchpad дээр санал өгөөд сэтгэгдлээ үлдээ. Бүгдийг нь уншдаг 🙏`,
    short: "Та нар хэлсэн, бид хийсэн ✅ «Тендер хармаар байна» → нэмсэн. «Утсан дээр эвгүй» → зассан. Одоо чиний ээлж: юу дутуу байна? Launchpad дээр санал өгөөд сэтгэгдлээ үлдээ 🙏",
  },
  5: {
    text: `⏰ Хүлээ, хүлээ! Launchpad-ийн санал хураалт энэ амралтаар дуусна!

Сурталчилгаагүй. Үнэгүй. Код нь хүртэл нээлттэй. Ийм сайт ховор шүү 😉

Ганцхан товшилт л хэрэгтэй 🗳️
${ASK}
Дэмжсэн бүх хүнд баярлалаа ❤️`,
    short: "⏰ Launchpad-ийн санал хураалт энэ амралтаар дуусна! Сурталчилгаагүй, үнэгүй, код нь хүртэл нээлттэй. Ганцхан товшилт л хэрэгтэй 🗳️ Баярлалаа ❤️",
  },
};

export const PROMOS: PromoPost[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  postAt: `2026-11-0${2 + day}T11:00:00Z`, // 19:00 Ulaanbaatar, 3–7 November
  video: `/promo/launchpad-d${day}.mp4`,
  facebook: `${TOP}\n\n${BODY[day].text}\n\n${FB_TAGS}`,
  // Instagram captions cannot hold a clickable link; the URL still leads, as the owner asked.
  instagram: `${TOP}\n\n${BODY[day].text}\n\n${IG_TAGS}`,
  threads: `${TOP}\n\n${BODY[day].short}\n\n#ИлТодМэдээ`,
}));

/** The campaign post due at `now`, if any. */
export function duePromo(now: Date, promos: PromoPost[] = PROMOS): PromoPost | null {
  const t = now.getTime();
  return promos.find((p) => {
    const at = Date.parse(p.postAt);
    return t >= at && t < at + PROMO_WINDOW_H * 3_600_000;
  }) ?? null;
}
