"use client";

import { Heart, Menu02, XClose } from "@untitledui/icons";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";

import { MenuGroups, MenuGroupsFallback } from "./nav-links";
import { HEADER_ICON_BUTTON } from "./header-styles";
import { SocialLinks } from "./social-links";
import { TextSizeToggle } from "./text-size-toggle";
import { ThemeToggle } from "./theme-toggle";

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Escape and a tap outside close the menu, like the other menus. Escape gives focus back to the
  // toggle (the focused link inside the closed panel was gone).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    // Browser Back/Forward changes the page without a tap on a menu link: close it then too.
    const onPop = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("popstate", onPop);
    };
  }, [open]);
  return (
    <div ref={root} className="xl:hidden">
      <button ref={toggle} type="button" aria-expanded={open} aria-label={open ? "Цэс хаах" : "Цэс нээх"} onClick={() => setOpen((v) => !v)} className={HEADER_ICON_BUTTON}>
        {open ? <XClose className="size-[18px]" /> : <Menu02 className="size-[18px]" />}
      </button>
      {open && (
        // The panel scrolls on its own: 820 px of links ran past the bottom of a phone screen, and
        // the text-size and theme toggles (only here below `sm`) could never be reached.
        // Its height is measured from where it really starts: a strip above the header (demo mode,
        // a page not scrolled to the top) pushed a `100dvh - header` panel past the screen again.
        <div
          data-popover
          ref={(el) => {
            if (el) el.style.maxHeight = `${Math.max(200, window.innerHeight - el.getBoundingClientRect().top)}px`;
          }}
          // Solid, not see-through: inside the header's backdrop-filter a second blur cannot blur the
          // page, so a 95 % panel let the headlines behind it show through the links (Nov 2026).
          className="menu-enter absolute inset-x-0 top-full max-h-[calc(100dvh-100%)] origin-top overflow-y-auto overscroll-contain border-b border-line bg-primary px-4 pt-3 pb-5 shadow-lg"
        >
          {/* Text size and theme first: below `sm` they live only here. */}
          <div className="mb-4 flex items-center gap-1 border-b border-line-soft pb-3 sm:hidden">
            <span className="label-mono px-1 text-tertiary">Үсгийн хэмжээ</span>
            <TextSizeToggle />
            <span className="label-mono ml-auto px-1 text-tertiary">Өнгө</span>
            <ThemeToggle />
          </div>
          <Suspense fallback={<MenuGroupsFallback onNavigate={() => setOpen(false)} />}>
            <MenuGroups onNavigate={() => setOpen(false)} />
          </Suspense>
          <div className="mt-5 flex flex-col gap-2.5">
            <span className="label-mono px-1 text-tertiary">Биднийг дагаарай</span>
            <SocialLinks size="lg" className="justify-between sm:justify-start" />
          </div>
          <Link href="/support" onClick={() => setOpen(false)} className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 text-sm font-semibold text-brand-secondary">
            <Heart aria-hidden className="size-[18px]" />
            Ил тод мэдээг дэмжих (хандив)
          </Link>
        </div>
      )}
    </div>
  );
}
