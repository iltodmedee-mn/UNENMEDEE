import { cacheLife } from "next/cache";
import { SearchLg } from "@untitledui/icons";
import Link from "next/link";
import { Suspense } from "react";

import { getSiteStats } from "@/lib/queries";

import { NotifyButton } from "@/components/pwa/pwa-controls";

import { DonateChip } from "./donate";
import { HEADER_ICON_BUTTON } from "./header-styles";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NavLinks, NavLinksFallback } from "./nav-links";
import { HEADER_SOCIAL, SocialLinks } from "./social-links";
import { TextSizeToggle } from "./text-size-toggle";
import { ThemeToggle } from "./theme-toggle";
import { FEED_QUIET_HOURS, hoursSince } from "@/lib/stale";

/** Hours since the newest feed story, from a cached clock (the header is on every static page). */
async function quietHours(lastArticleAt: string | null): Promise<number> {
  "use cache";
  cacheLife("hours");
  return hoursSince(lastArticleAt, new Date());
}

async function LiveStatus() {
  // Decorative: a database blip here must not take the whole page (the root layout) down.
  const stats = await getSiteStats().catch(() => null);
  if (!stats) return null;
  // A pulsing "live" dot over a feed that stopped hours ago would claim something false.
  const quiet = stats.lastArticleAt ? await quietHours(stats.lastArticleAt) : 0;
  if (quiet > FEED_QUIET_HOURS) {
    return (
      <span className="label-mono flex items-center gap-2 text-tertiary">
        <span className="inline-flex size-1.5 rounded-full bg-fg-quaternary" />
        Сүүлийн мэдээ {quiet} цагийн өмнө · {stats.activeSources} эх сурвалж
      </span>
    );
  }
  return (
    <span className="label-mono flex items-center gap-2 text-brand-secondary">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-solid opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-brand-solid" />
      </span>
      {stats.activeSources} төрийн эх сурвалж хянаж байна
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="scroll-shadow-host sticky top-0 z-40 border-b border-line bg-primary/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      {/* A soft shadow once the bar is stuck (CSS scroll-state query; browsers without it keep the hairline). */}
      <span aria-hidden className="scroll-shadow" />
      {/* Status strip: desktop only; phones keep the screen for headlines. */}
      <div className="hidden border-b border-line-soft sm:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5 md:px-8">
          <Suspense fallback={<span className="label-mono text-tertiary">Систем ачаалж байна…</span>}>
            <LiveStatus />
          </Suspense>
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
          {/* Our accounts fill the empty part of the bar: three small ones on phones from 390 px (with the
              🔔 button a 360 px row has no room), all five with RSS on desktop; tablets have the donation
              chip there, and the menu lists them everywhere. */}
          <SocialLinks only={["facebook", "instagram", "threads"]} size="xs" className="hidden min-[390px]:flex sm:hidden" />
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
