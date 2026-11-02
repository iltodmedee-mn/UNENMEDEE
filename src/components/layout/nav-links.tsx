"use client";

import { ChevronDown, Heart } from "@untitledui/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";

import { cx } from "@/utils/cx";

import { activeHref, NAV_GROUPS, NAV_PRIMARY, type NavItem, NO_PREFETCH } from "./nav-data";
import { SocialLinks } from "./social-links";

const prefetchOf = (href: string) => (NO_PREFETCH.has(href) ? false : undefined);

const linkClass = (active: boolean) =>
  cx(
    "rounded-md px-2.5 py-2 text-sm font-semibold whitespace-nowrap transition",
    active ? "bg-secondary text-primary" : "text-tertiary hover:bg-primary_hover hover:text-primary",
  );

const PRIMARY = new Set(NAV_PRIMARY.map((item) => item.href));
const GROUP_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Active-link highlighting needs usePathname(), which suspends on routes whose params are
 * only known at request time (new articles served via ISR). Always render inside <Suspense>
 * with the *Fallback (same links, no highlight) so the layout shell stays prerendered.
 */
export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return <NavBar className={className} pathname={pathname} active={activeHref(pathname)} />;
}

export function NavLinksFallback({ className }: { className?: string }) {
  return <NavBar className={className} pathname={null} active={null} />;
}

/** The desktop bar: the primary links (the logo is "Нүүр") and the "Бүх хэсэг ▾" panel. */
function NavBar({ className, pathname, active }: { className?: string; pathname: string | null; active: string | null }) {
  return (
    <nav className={className} aria-label="Үндсэн цэс">
      {NAV_PRIMARY.filter((item) => item.href !== "/").map((item) => (
        <Link key={item.href} href={item.href} prefetch={prefetchOf(item.href)} aria-current={active === item.href ? "page" : undefined} className={linkClass(active === item.href)}>
          {item.label}
        </Link>
      ))}
      <AllSections pathname={pathname} active={active} />
    </nav>
  );
}

/** The phone and tablet menu: every page in the four groups, two (tablet: three) columns. */
export function MenuGroups({ onNavigate }: { onNavigate?: () => void }) {
  return <GroupsGrid active={activeHref(usePathname())} onNavigate={onNavigate} />;
}

export function MenuGroupsFallback({ onNavigate }: { onNavigate?: () => void }) {
  return <GroupsGrid active={null} onNavigate={onNavigate} />;
}

function GroupsGrid({ active, onNavigate }: { active: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Үндсэн цэс" className="flex flex-col gap-5">
      {NAV_GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`menu-${g.key}`}>
          <h2 id={`menu-${g.key}`} className="label-mono px-1 pb-1.5 text-tertiary">
            {g.label}
          </h2>
          <ul className="grid grid-cols-2 gap-x-3 border-t border-line-soft sm:grid-cols-3">
            {g.items.map((item) => {
              const Icon = item.icon;
              const on = active === item.href;
              return (
                <li key={item.href} className="border-b border-line-soft">
                  <Link
                    href={item.href}
                    prefetch={prefetchOf(item.href)}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cx("my-0.5 flex min-h-11 items-center gap-2.5 rounded-md px-1.5 py-2 text-[0.9375rem] leading-tight font-semibold transition", on ? "bg-secondary text-primary" : "text-secondary hover:bg-primary_hover hover:text-primary")}
                  >
                    {Icon && <Icon aria-hidden className="size-[19px] shrink-0 text-brand-secondary" />}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** One page in the desktop panel: icon tile, name, one line of what is there. */
function PanelLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={prefetchOf(item.href)}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "flex items-start gap-3 rounded-lg px-2.5 py-2 outline-focus-ring transition duration-100 hover:bg-primary_hover focus-visible:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2",
        active && "bg-secondary",
      )}
    >
      {Icon && (
        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-brand-secondary">
          <Icon className="size-[18px]" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-primary">{item.label}</span>
        {item.desc && <span className="block text-xs leading-snug text-tertiary">{item.desc}</span>}
      </span>
    </Link>
  );
}

/**
 * "Бүх хэсэг ▾": every page in four labelled groups with an icon and one line each (it used to
 * be "Бусад ▾", 13 unrelated links in one list). A disclosure (button + panel), plain markup, no
 * React Aria, because the header ships on every page. Click / Enter / ↓ open it; a mouse also
 * opens it on hover; ↑ ↓ Home End move through the links. It closes on Escape, an outside click,
 * focus leaving it and navigation (the open state remembers the path it was opened on, so a new
 * path closes it without an effect). The panel is positioned against the header row, not the
 * button, so it spans the page width.
 */
function AllSections({ pathname, active }: { pathname: string | null; active: string | null }) {
  const [openOn, setOpenOn] = useState<string | null>(null);
  const here = pathname ?? "";
  const open = openOn === here;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // On a page that is not in the bar, the button says where the reader is ("Тендер ▾").
  const current = active && !PRIMARY.has(active) ? GROUP_ITEMS.find((item) => item.href === active) : undefined;

  const links = () => Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("[data-panel] a") ?? []);
  const setOpen = (next: boolean, focus?: "first" | "last") => {
    clearTimeout(timer.current);
    setOpenOn(next ? here : null);
    if (focus) requestAnimationFrame(() => (focus === "first" ? links()[0] : links().at(-1))?.focus());
  };
  // When the mouse opened the panel, the click that usually follows (150–400 ms later) must not
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
  const onPanelKey = (e: KeyboardEvent) => {
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
      onPointerEnter={(e) => hover(e, true, 80)}
      onPointerLeave={(e) => hover(e, false, 150)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpenOn(null);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open && Date.now() - hoverOpenedAt.current < 700) return;
          setOpen(!open);
        }}
        onKeyDown={onTriggerKey}
        className={cx("flex cursor-pointer items-center gap-1 outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2", linkClass(Boolean(current) || open))}
      >
        {current?.label ?? "Бүх хэсэг"}
        <ChevronDown aria-hidden className={cx("size-4 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} data-panel data-popover onKeyDown={onPanelKey} className="menu-enter absolute inset-x-4 top-full z-50 mt-1 origin-top rounded-2xl bg-primary shadow-lg ring-1 ring-line md:inset-x-8">
          <div className="grid grid-cols-4 p-3">
            {NAV_GROUPS.map((g) => (
              <section key={g.key} aria-labelledby={`${id}-${g.key}`} className="border-l border-line-soft px-2 first:border-l-0">
                <h2 id={`${id}-${g.key}`} className="label-mono px-2.5 pt-2 pb-1.5 text-tertiary">
                  {g.label}
                </h2>
                <ul>
                  {g.items
                    .filter((item) => item.href !== "/")
                    .map((item) => (
                      <li key={item.href}>
                        <PanelLink item={item} active={active === item.href} onClick={() => setOpen(false)} />
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="flex items-center gap-3 rounded-b-2xl border-t border-line-soft bg-secondary px-5 py-3">
            <span className="label-mono text-tertiary">Биднийг дагаарай</span>
            <SocialLinks size="md" />
            <Link href="/support" onClick={() => setOpen(false)} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-brand-secondary hover:underline">
              <Heart aria-hidden className="size-4" />
              Ил тод мэдээг дэмжих
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
