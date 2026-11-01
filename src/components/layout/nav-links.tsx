"use client";

import { Check, ChevronDown } from "@untitledui/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";

import { cx } from "@/utils/cx";

interface NavItem {
  href: string;
  label: string;
}

/**
 * Pages whose client code includes the chart library (recharts): a prefetch from the header on
 * every page view downloaded it (the same problem §6c fixed for /data).
 */
const NO_PREFETCH = new Set(["/budget", "/data", "/transparency", "/prices"]);

/** Always visible in the desktop bar. */
export const NAV_PRIMARY: NavItem[] = [
  { href: "/", label: "Нүүр" },
  { href: "/digest", label: "Онцлох тойм" },
  { href: "/officials", label: "Улстөрчид" },
  { href: "/budget", label: "Төсөв" },
  { href: "/tax", label: "Миний татвар" },
];

/** Under "Бусад ▾" in the desktop bar; a labelled second group in the mobile menu. */
export const NAV_MORE: NavItem[] = [
  { href: "/my", label: "Миний мэдээ" },
  { href: "/data", label: "Өгөгдөл" },
  { href: "/prices", label: "Үнэ" },
  { href: "/risk", label: "Эрсдэл" },
  { href: "/laws", label: "Хууль" },
  { href: "/promises", label: "Амлалт" },
  { href: "/projects", label: "Төслүүд" },
  { href: "/sources", label: "Эх сурвалж" },
  { href: "/changes", label: "Өөрчлөлт" },
  { href: "/transparency", label: "Ил тод тайлан" },
  { href: "/about", label: "Бид хэн бэ" },
];

export const NAV_ITEMS = [...NAV_PRIMARY, ...NAV_MORE];

const isActive = (href: string, pathname: string | null) => pathname !== null && (href === "/" ? pathname === "/" : pathname.startsWith(href));

const linkClass = (active: boolean) =>
  cx(
    "rounded-md px-2.5 py-2 text-sm font-semibold whitespace-nowrap transition",
    active ? "bg-secondary text-primary" : "text-tertiary hover:bg-primary_hover hover:text-primary",
  );

interface NavProps {
  className?: string;
  onNavigate?: () => void;
  /** The desktop bar leaves out "Нүүр" (the logo already links home). */
  skipHome?: boolean;
  /** The desktop bar folds NAV_MORE into a "Бусад ▾" dropdown. */
  more?: boolean;
}

/**
 * Active-link highlighting needs usePathname(), which suspends on routes whose params are
 * only known at request time (new articles served via ISR). Always render inside <Suspense>
 * with <NavLinksFallback> (same links, no highlight) so the layout shell stays prerendered.
 */
export function NavLinks(props: NavProps) {
  return <NavList {...props} pathname={usePathname()} />;
}

export function NavLinksFallback(props: NavProps) {
  return <NavList {...props} pathname={null} />;
}

function NavList({ className, onNavigate, pathname, skipHome, more }: NavProps & { pathname: string | null }) {
  const link = (item: NavItem) => {
    const active = isActive(item.href, pathname);
    return (
      <Link key={item.href} href={item.href} prefetch={NO_PREFETCH.has(item.href) ? false : undefined} onClick={onNavigate} aria-current={active ? "page" : undefined} className={linkClass(active)}>
        {item.label}
      </Link>
    );
  };
  return (
    <nav className={className} aria-label="Үндсэн цэс">
      {NAV_PRIMARY.filter((item) => !skipHome || item.href !== "/").map(link)}
      {more ? (
        <NavMore pathname={pathname} />
      ) : (
        <>
          <p className="label-mono mt-3 px-2.5 pb-1 text-tertiary">Бусад</p>
          {NAV_MORE.map(link)}
        </>
      )}
    </nav>
  );
}

/**
 * "Бусад ▾": plain markup with the Untitled dropdown look (base/dropdown), no React Aria, because
 * the header ships on every page. Click / Enter / ↓ open it; a mouse also opens it on hover. It
 * closes on Escape, an outside click, focus leaving it and navigation (the open state remembers
 * the path it was opened on, so a new path closes it without an effect).
 */
function NavMore({ pathname }: { pathname: string | null }) {
  const [openOn, setOpenOn] = useState<string | null>(null);
  const here = pathname ?? "";
  const open = openOn === here;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = NAV_MORE.find((item) => isActive(item.href, pathname));

  const links = () => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("[role=menu] a") ?? []);
  const setOpen = (next: boolean, focus?: "first" | "last") => {
    clearTimeout(timer.current);
    setOpenOn(next ? here : null);
    if (focus) requestAnimationFrame(() => (focus === "first" ? links()[0] : links().at(-1))?.focus());
  };
  // When the mouse opened the menu, the click that usually follows (150–400 ms later) must not
  // toggle it shut again.
  const hoverOpenedAt = useRef(0);
  const hover = (e: PointerEvent, next: boolean, ms: number) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next) hoverOpenedAt.current = Date.now();
      setOpenOn(next ? here : null);
    }, ms);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: globalThis.PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenOn(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true, e.key === "ArrowDown" ? "first" : "last");
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const list = links();
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  return (
    <div
      ref={root}
      className="relative"
      onPointerEnter={(e) => hover(e, true, 80)}
      onPointerLeave={(e) => hover(e, false, 150)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpenOn(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open && Date.now() - hoverOpenedAt.current < 700) return;
          setOpen(!open);
        }}
        onKeyDown={onTriggerKey}
        className={cx("flex cursor-pointer items-center gap-1 outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2", linkClass(Boolean(current) || open))}
      >
        {current?.label ?? "Бусад"}
        <ChevronDown aria-hidden className={cx("size-4 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label="Бусад хуудас"
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-50 mt-1 menu-enter w-56 origin-top-right rounded-xl bg-primary py-1 shadow-lg ring-1 ring-line"
        >
          {NAV_MORE.map((item) => {
            const active = isActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="group block px-1.5 py-px outline-hidden"
              >
                <span
                  className={cx(
                    "flex items-center rounded-md px-2.5 py-2 text-sm font-semibold text-secondary outline-focus-ring transition duration-100 ease-linear group-hover:bg-primary_hover group-focus-visible:bg-primary_hover group-focus-visible:outline-2 group-focus-visible:-outline-offset-2",
                    active && "bg-secondary text-primary",
                  )}
                >
                  <span className="grow">{item.label}</span>
                  {active && <Check aria-hidden className="size-4 shrink-0 stroke-[2.25px] text-fg-brand-primary" />}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
