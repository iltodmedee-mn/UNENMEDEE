"use client";

import { Menu02, XClose } from "@untitledui/icons";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";

import { NavLinks, NavLinksFallback } from "./nav-links";
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
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
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
          className="menu-enter absolute inset-x-0 top-full max-h-[calc(100dvh-100%)] origin-top overflow-y-auto overscroll-contain border-b border-line bg-primary/95 px-4 py-3 shadow-lg backdrop-blur-xl"
        >
          <Suspense fallback={<NavLinksFallback className="flex flex-col gap-0.5" onNavigate={() => setOpen(false)} />}>
            <NavLinks className="flex flex-col gap-0.5" onNavigate={() => setOpen(false)} />
          </Suspense>
          <Link href="/support" onClick={() => setOpen(false)} className="mt-2 block border-t border-line-soft px-3 pt-3 pb-1 text-sm font-semibold text-brand-secondary">
            💙 Ил тод мэдээг дэмжих (хандив)
          </Link>
          <div className="mt-2 flex items-center gap-3 border-t border-line-soft px-3 pt-3 pb-1">
            <span className="label-mono text-tertiary">Биднийг дагаарай</span>
            <SocialLinks size="md" className="ml-auto" />
          </div>
          <div className="mt-2 flex items-center gap-1 border-t border-line-soft px-1 pt-2 sm:hidden">
            <span className="label-mono px-2 text-tertiary">Үсгийн хэмжээ</span>
            <TextSizeToggle />
            <span className="label-mono ml-auto px-2 text-tertiary">Өнгө</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}
