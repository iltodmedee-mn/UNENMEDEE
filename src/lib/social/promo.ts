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
const ASK = "Линк дээр дараад «Санал өгөх ▲» товчийг дараарай. 10 секунд л болно 🙏";

const BODY: Record<number, { text: string; short: string }> = {
  1: {
    text: `🗳️ ИЛ ТОД МЭДЭЭ Launchpad дээр гарлаа! Нэг санал бол нэг дусал. Дусал дуслаар далай 🌊

Төрийн 139 сайт өдөр бүр мэдээ гаргадаг. Бүгдийг нь уншиж амжих хүн байхгүй. Тиймээс бид бүгдийг нь уншаад, пи-арыг нь хасаж, баримт, тоог нь л товчилж өгдөг. Үнэгүй, сурталчилгаагүй.

${ASK}
💬 Санал хүсэлтээ сэтгэгдэлд бичээрэй!`,
    short: "🗳️ ИЛ ТОД МЭДЭЭ Launchpad дээр гарлаа! Төрийн 139 сайтын мэдээг пи-аргүйгээр, баримт, тоогоор нь товч уншина. Нэг санал = нэг дусал. Дусал дуслаар далай 🌊",
  },
  2: {
    text: `Гарчиг: «…явцыг хянан хэлэлцлээ.» 😴
Дотор нь: төслийн 45% гүйцэтгэгдсэн 👀

ИЛ ТОД МЭДЭЭ тоо, шийдвэрийг нь гарчгийн эхэнд гаргаж өгдөг. Пи-ар биш, баримт.

Ийм сайт хэрэгтэй гэж бодож байвал Launchpad дээр нэг санал өгөөч 🗳️
${ASK}
💬 Юуг сайжруулахаа сэтгэгдэлд бичээрэй!`,
    short: "Гарчиг: «…явцыг хянан хэлэлцлээ.» 😴 Дотор нь: төслийн 45% гүйцэтгэгдсэн 👀 ИЛ ТОД МЭДЭЭ тоо, шийдвэрийг нь эхэнд гаргадаг. Пи-ар биш, баримт. Launchpad дээр нэг санал өгөөч 🗳️",
  },
  3: {
    text: `💸 Сар бүр татвар төлдөг. Тэр мөнгө хаашаа явж байна?

ИЛ ТОД МЭДЭЭ дээр улсын төсөв, тендерийн үр дүн, УИХ гишүүдийн хөрөнгийн мэдүүлэг нэг дор байна. Бүгд албан ёсны эх сурвалжтай.

🗳️ Энэ долоо хоногт Launchpad дээр санал хураалт явж байна. Чи бас дэмжээрэй!
${ASK}`,
    short: "💸 Сар бүр татвар төлдөг. Тэр мөнгө хаашаа явж байна? Төсөв, тендер, УИХ гишүүдийн хөрөнгийн мэдүүлэг, бүгд нэг дор, албан эх сурвалжтай. Launchpad дээр дэмжээрэй 🗳️",
  },
  4: {
    text: `💬 Та бүхний хүсэлтээр бид тендерийн үр дүн, тайлан, баримт бичгийн хэсэг нэмж, утсан дээрх хувилбарыг сайжруулсан.

Одоо чиний ээлж: юу дутуу байна? Ямар мэдээ, ямар тоо хармаар байна?

🗳️ Launchpad дээр санал өгөөд, сэтгэгдлээ бичээрэй. Сэтгэгдэл бүрийг уншина 🙏`,
    short: "💬 Та бүхний хүсэлтээр тендер, тайлан нэмж, утсан дээрх хувилбарыг сайжруулсан. Одоо чиний ээлж: юу дутуу байна? Launchpad дээр санал өгөөд, сэтгэгдлээ бичээрэй 🙏",
  },
  5: {
    text: `⏰ Launchpad-ийн санал хураалт энэ амралтаар дуусна!

ИЛ ТОД МЭДЭЭ: сурталчилгаагүй, үнэгүй, код нь бүрэн нээлттэй.

Нэг товшилт л хангалттай 🗳️
${ASK}
Дэмжсэн бүх хүнд баярлалаа ❤️`,
    short: "⏰ Launchpad-ийн санал хураалт энэ амралтаар дуусна! ИЛ ТОД МЭДЭЭ: сурталчилгаагүй, үнэгүй, код нь нээлттэй. Нэг товшилт л хангалттай 🗳️ Баярлалаа ❤️",
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
