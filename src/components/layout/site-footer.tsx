import { Mail01 } from "@untitledui/icons";
import Link from "next/link";
import { Suspense } from "react";

import { CONTACT_EMAIL, REPO_URL, repoFile, STATUS_URL } from "@/lib/site";

import { DonateCard } from "./donate";
import { Logo } from "./logo";
import { GROUP_HEADING, NAV_GROUPS } from "./nav-data";
import { SocialLinks } from "./social-links";

const footerLink = "text-tertiary transition hover:text-primary";

/**
 * The same four groups and page names as the "Бүх хэсэг ▾" panel and the phone menu (one map to
 * learn), then follow / contact / donate on one row and the AI note on one line. It was 1 382 px
 * tall on a phone and named pages differently from the menu (Nov 2026).
 */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-secondary pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-7 px-4 pt-10 pb-8 md:px-8 lg:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 flex flex-col gap-3 lg:col-span-1 lg:pr-6">
          <Logo withDomain />
          <p className="hidden text-sm text-tertiary sm:block">Төрийн албан ёсны мэдээг баримт, пи-ар гэж ялгаж, төсөв, тендерийг AI-аар шүүдэг нээлттэй эхийн сайт.</p>
          <span className="label-mono w-fit rounded-md px-2 py-1 text-brand-secondary ring-1 ring-brand-soft ring-inset">● 0₮ дэд бүтэц · нээлттэй эх</span>
        </div>
        {NAV_GROUPS.map((g) => (
          <nav key={g.key} aria-labelledby={`footer-${g.key}`} className="flex flex-col gap-2 text-sm">
            <h2 id={`footer-${g.key}`} className={`${GROUP_HEADING} mb-1.5`}>
              {g.label}
            </h2>
            {g.items
              .filter((item) => item.href !== "/")
              .map((item) => (
                <Link key={item.href} className={footerLink} prefetch={false} href={item.href}>
                  {item.label}
                </Link>
              ))}
            {g.key === "about" && (
              <>
                <Link className={footerLink} prefetch={false} href="/support">
                  Дэмжих
                </Link>
                <a className={footerLink} href={REPO_URL} target="_blank" rel="noreferrer">
                  Нээлттэй код (GitHub) ↗
                </a>
                <a className={footerLink} href={STATUS_URL} target="_blank" rel="noreferrer">
                  Сайтын төлөв ↗
                </a>
              </>
            )}
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-5 border-t border-line-soft px-4 py-6 md:px-8 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="label-mono text-tertiary">Биднийг дагаарай</span>
          <SocialLinks size="md" />
        </div>
        <a className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-brand-secondary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
          <Mail01 aria-hidden className="size-4" />
          {CONTACT_EMAIL}
        </a>
        <Suspense fallback={null}>
          <DonateCard className="lg:ml-auto lg:min-w-[22rem]" />
        </Suspense>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-2 border-t border-line-soft px-4 py-5 text-xs text-quaternary md:px-8 lg:flex-row lg:gap-8">
        <p>
          AI шинжилгээ алдаа гаргаж болно: нийтлэл бүр эх .gov.mn холбоос, SHA-256 хэштэй тул анхны тексттэй шууд тулгаж шалгана уу. Эрсдэлийн оноо нь AI-ийн
          үнэлгээ, буруутгал биш.
        </p>
        <p className="shrink-0 lg:ml-auto">
          Агуулга:{" "}
          <a className="hover:text-tertiary hover:underline" href={repoFile("LICENSE-CONTENT.md")} target="_blank" rel="noreferrer license">
            CC BY 4.0
          </a>{" "}
          (эх сурвалжаа iltodmedee.mn гэж дурдана уу) · Код: MIT
        </p>
      </div>
    </footer>
  );
}
