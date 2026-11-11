import { Archive, BankNote01, BookClosed, BookOpen01, Briefcase01, Building02, Building07, Calculator, File06, Globe02, Home02, InfoCircle, LayersThree01, LineChartUp02, Lock01, Mail01, MessageChatCircle, Receipt, RefreshCw05, ShoppingCart01, Star01, Target04, Trophy01 } from "@untitledui/icons";
import type { ComponentType } from "react";

import { TopicIcon } from "@/components/iltod/topic-icon";

/**
 * The site map, one source for the desktop "Бүх хэсэг ▾" panel, the phone menu and the footer
 * (Nov 2026: the menu and the footer named one page two ways, "Ил тод тайлан" vs "Зардлын тайлан
 * (AI токен бүрээр)", and 13 unrelated links sat in one "Бусад" list). No "use client": the
 * footer is a Server Component and a client module's exports reach it only as references.
 */
export interface NavItem {
  href: string;
  label: string;
  /** One line under the label in the desktop panel. */
  desc?: string;
  icon?: ComponentType<{ className?: string }>;
  /** More path prefixes that count as this page (a place page is "Миний аймаг"). */
  match?: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

const topicIcon = (topic: string) =>
  function Icon({ className }: { className?: string }) {
    return <TopicIcon topic={topic} className={className} />;
  };

/**
 * Pages whose client code includes the chart library (recharts): a prefetch from the header on
 * every page view downloaded it (the same problem §6c fixed for /data).
 */
export const NO_PREFETCH = new Set(["/budget", "/data", "/transparency", "/prices"]);

/**
 * A group's name (Мэдээ, Мөнгө, тоо…) as a filled signal chip like "ГОЛ МЭДЭЭ": the owner asked for
 * group names readers spot at once (Nov 2026; grey 11 px mono labels were easy to miss).
 */
export const GROUP_HEADING = "label-mono inline-flex w-fit items-center rounded-md bg-signal px-2.5 py-1 text-[13px] font-bold text-signal-ink";

/** Always visible in the desktop bar. */
export const NAV_PRIMARY: NavItem[] = [
  { href: "/", label: "Нүүр" },
  { href: "/digest", label: "Онцлох тойм" },
  { href: "/officials", label: "Улстөрчид" },
  { href: "/budget", label: "Төсөв" },
  { href: "/tax", label: "Миний татвар" },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "news",
    label: "Мэдээ",
    items: [
      { href: "/", label: "Нүүр", desc: "Өнөөдрийн мэдээ", icon: Home02 },
      { href: "/digest", label: "Онцлох тойм", desc: "Өдөрт 2 удаа, гол мэдээ", icon: topicIcon("digest") },
      { href: "/my", label: "Миний мэдээ", desc: "Дагасан сэдэв, аймаг", icon: Star01 },
      { href: "/amjilt", label: "Миний амжилт", desc: "Түвшин, badge, дараалсан өдөр", icon: Trophy01 },
      { href: "/laws", label: "Хууль", desc: "Шинэ хууль, тогтоол", icon: topicIcon("justice") },
      { href: "/risk", label: "Эрсдэл", desc: "AI-ийн үнэлгээ, буруутгал биш", icon: topicIcon("risk") },
      { href: "/clusters", label: "Олон эх сурвалж", desc: "Нэг мэдээг олон сайт бичсэн", icon: LayersThree01 },
      { href: "/changes", label: "Өөрчлөлт", desc: "Төрийн сайт засварласан, устгасан", icon: RefreshCw05 },
      { href: "/archive", label: "Архив", desc: "Өдөр бүрийн мэдээ", icon: Archive },
      { href: "/glossary", label: "Нэр томьёо", desc: "Тогтоол, тодотгол гэж юу вэ", icon: BookClosed },
    ],
  },
  {
    key: "money",
    label: "Мөнгө, тоо",
    items: [
      { href: "/budget", label: "Төсөв", desc: "Улсын орлого, зарлага", icon: BankNote01 },
      { href: "/tax", label: "Миний татвар", desc: "Цалингийн татвар тооцоолуур", icon: Calculator },
      { href: "/prices", label: "Үнэ", desc: "Мах, бензин 15 жилээр", icon: ShoppingCart01 },
      { href: "/tenders", label: "Тендер", desc: "Хэн, юуг, хэдээр", icon: Briefcase01 },
      { href: "/money", label: "Миний ₮", desc: "Мөнгө аймаг, сумаар газрын зураг дээр", icon: Briefcase01 },
      { href: "/documents", label: "Тайлан, баримт", desc: "Аудит, тендерийн баримт", icon: File06 },
      { href: "/data", label: "Өгөгдөл", desc: "Ханш, инфляц, нээлттэй өгөгдөл", icon: LineChartUp02 },
    ],
  },
  {
    key: "state",
    label: "Төр, улстөрчид",
    items: [
      { href: "/officials", label: "Улстөрчид", desc: "УИХ гишүүдийн хөрөнгө, ирц", icon: topicIcon("society") },
      { href: "/promises", label: "Амлалт", desc: "Засгийн газрын 620 зорилт", icon: Target04 },
      { href: "/projects", label: "Төслүүд", desc: "Том төсөл: хэдэн жил, хэдэн ₮", icon: Building07 },
      { href: "/officials/companies", label: "Төрийн компани", desc: "Орлого, ашиг, цалин", icon: Building02 },
      { href: "/topic/local#places", label: "Миний аймаг", desc: "21 аймаг, 9 дүүрэг", icon: topicIcon("local"), match: ["/topic/local", "/place/"] },
      { href: "/participate", label: "Оролцох", desc: "Нээлттэй өргөдөл, санал өгөх", icon: MessageChatCircle },
      { href: "/request", label: "Мэдээлэл хүсэх", desc: "Төрөөс мэдээлэл авах захидал", icon: Mail01 },
      { href: "/sources", label: "Эх сурвалж", desc: "Хянаж буй төрийн сайтууд", icon: Globe02, match: ["/sources", "/source/"] },
    ],
  },
  {
    key: "about",
    label: "Бидний тухай",
    items: [
      { href: "/about", label: "Бид хэн бэ", desc: "Хэн, яагаад ажиллуулдаг", icon: InfoCircle },
      { href: "/method", label: "Арга зүй", desc: "AI яаж ажилладаг", icon: BookOpen01 },
      { href: "/transparency", label: "Ил тод тайлан", desc: "Зардал, хандив", icon: Receipt },
      { href: "/privacy", label: "Нууцлал", desc: "Ямар мэдээлэл хадгалдаг", icon: Lock01 },
    ],
  },
];

/** Every page of the map once (a page can sit in the bar and in a group). */
export const NAV_ALL: NavItem[] = [...new Map([...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items)].map((i) => [i.href, i])).values()];

const pathOf = (href: string) => href.split("#")[0];

/**
 * The one item the current path belongs to: the longest matching prefix, so /officials/companies
 * is "Төрийн компани", not also "Улстөрчид". "/" only matches the home page itself.
 */
export function activeHref(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const item of NAV_ALL) {
    for (const prefix of [pathOf(item.href), ...(item.match ?? [])]) {
      const hit = prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
      if (hit && prefix.length > bestLen) {
        best = item.href;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
