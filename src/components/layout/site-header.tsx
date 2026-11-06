import { SearchLg } from "@untitledui/icons";
import Link from "next/link";
import { Suspense } from "react";

import { NotifyButton } from "@/components/pwa/pwa-controls";

import { DonateChip } from "./donate";
import { HEADER_ICON_BUTTON } from "./header-styles";
import { LiveStatus } from "./live-status";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NavLinks, NavLinksFallback } from "./nav-links";
import { HEADER_SOCIAL, SocialLinks } from "./social-links";
import { TextSizeToggle } from "./text-size-toggle";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="scroll-shadow-host sticky top-0 z-40 border-b border-line bg-primary/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      {/* A soft shadow once the bar is stuck (CSS scroll-state query; browsers without it keep the hairline). */}
      <span aria-hidden className="scroll-shadow" />
      {/* Status strip: desktop only; phones keep the screen for headlines. */}
      <div className="hidden border-b border-line-soft sm:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5 md:px-8">
          <LiveStatus />
          <Suspense fallback={<span className="label-mono hidden text-tertiary xl:inline">Нээлттэй эх · Бүх зардал ил</span>}>
            <DonateChip className="hidden xl:flex" />
          </Suspense>
        </div>
      </div>
      <div className="relative mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:px-8 lg:h-16">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        <Suspense fallback={<NavLinksFallback className="ml-4 hidden min-w-0 items-center gap-1 xl:flex" />}>
          <NavLinks className="ml-4 hidden min-w-0 items-center gap-1 xl:flex" />
        </Suspense>
        {/* The nav is hidden below xl: the empty middle of the bar shows the donation chip. */}
        <Suspense fallback={null}>
          <DonateChip className="mx-auto hidden rounded-full px-3 py-1.5 ring-1 ring-line ring-inset sm:flex xl:hidden" />
        </Suspense>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Our accounts fill the empty part of the bar: three on phones from 390 px, the size of the
              buttons beside them (with the 🔔 button a 360 px row has no room), all five with RSS on
              desktop; tablets have the donation chip there, and the menu lists them everywhere. */}
          <SocialLinks only={["facebook", "instagram", "threads"]} size="md" className="hidden min-[390px]:flex sm:hidden" />
          <SocialLinks only={HEADER_SOCIAL} size="md" className="mr-2 hidden border-r border-line pr-3 xl:flex" />
          <Link href="/search" aria-label="Хайх" title="Хайх" className={HEADER_ICON_BUTTON}>
            <SearchLg className="size-[18px]" aria-hidden />
          </Link>
          <NotifyButton />
          {/* Below sm (≤ 360 px phones) these two move into the menu, or the row overflows. */}
          <div className="hidden sm:contents">
            <TextSizeToggle />
            <ThemeToggle />
          </div>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
