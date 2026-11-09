import { hashtags, type SocialPlatform } from "@/lib/social/hashtags";
import { PRODUCTION_URL } from "@/lib/site";

/**
 * One-off announcements of a new feature, posted once to the Facebook page, Instagram and Threads
 * with an image of the real screens (`npm run social:post -- --mode announce`, the manual
 * social-post.yml). The newest entry is the one posted; social_posts kind `announce` with `ref`
 * keeps each platform to one post. Texts follow the social rules: facts about the feature, no
 * engagement asks (no "like", "share", "follow"), no people, no AI images.
 */
export interface Announcement {
  /** social_posts ref id: the day it was written, yyyymmdd */
  ref: number;
  /** under public/: served from the site, so the platforms can fetch it */
  image: string;
  link: string;
  facebook: string;
  instagram: string;
  threads: string;
}

const AMJILT = `${PRODUCTION_URL}/amjilt`;

export const ANNOUNCEMENTS: Announcement[] = [
  {
    ref: 20261109,
    image: "/promo/badges-2026-11.jpg",
    link: AMJILT,
    facebook: [
      "Мэдээ уншаад level ахидаг болчихлоо 🔥",
      "",
      "ИЛ ТОД МЭДЭЭ дээр одоо:",
      "🏅 47 badge: «Баримт шалгагч», «Тендерийн нүд», «Шөнийн шувуу»…",
      "⬆️ 10 түвшин: «Шинэ уншигч»-оос «Ил тод баатар» хүртэл",
      "🔥 Дараалсан өдрийн шат: Оч (3 өдөр) → Гал → Түүдэг → … → Домог (1000 өдөр)",
      "",
      "Амархан биш шүү. Мэдээг 15 секунд уншиж, хагасаас нь цааш гүйлгэж байж тоологдоно. «Ил тод» шатанд хүрэхэд жил орчим өдөр бүр уншина. Нууц badge-ууд ч бий: нөхцөл нь авах хүртэл харагдахгүй.",
      "",
      "Бүртгэл хэрэггүй. Ахиц зөвхөн утсан дээр чинь хадгалагдана.",
      "",
      `👉 ${AMJILT}`,
      "",
      `${hashtags("facebook")} #badge`,
    ].join("\n"),
    instagram: [
      "Мэдээ уншаад level ахидаг болчихлоо 🔥",
      "",
      "🏅 47 badge · ⬆️ 10 түвшин · 🔥 1000 өдөр хүртэлх streak",
      "",
      "Амархан биш шүү: мэдээг бүтэн уншиж байж л тоологдоно, «Ил тод» шатанд хүрэхэд жил орчим өдөр бүр уншина. Нууц badge-ууд ч бий.",
      "",
      "Бүртгэл хэрэггүй, ахиц зөвхөн утсан дээр чинь хадгалагдана.",
      "",
      "iltodmedee.mn/amjilt",
      "",
      `${hashtags("instagram")} #badge #streak`,
    ].join("\n"),
    threads: [
      "Мэдээ уншаад level ахидаг болчихлоо 🔥",
      "",
      "47 badge, 10 түвшин, 1000 өдөр хүртэлх streak. Амархан биш: мэдээг бүтэн уншиж байж л тоологдоно. Нууц badge-ууд ч бий.",
      "",
      "Бүртгэлгүй, ахиц зөвхөн утсанд чинь хадгалагдана.",
      "",
      `👉 ${AMJILT}`,
      "#ИлТодМэдээ",
    ].join("\n"),
  },
];

/** The announcement to post now: the newest one. */
export const currentAnnouncement = (): Announcement | null => ANNOUNCEMENTS.at(-1) ?? null;

export const announcementImageUrl = (a: Announcement) => `${PRODUCTION_URL}${a.image}`;

export const announcementText = (a: Announcement, platform: SocialPlatform) => a[platform];
