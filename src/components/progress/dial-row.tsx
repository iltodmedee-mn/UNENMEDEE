import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One row of the back-to-top dial (the owner's pick, Nov 2026: a stack of labelled rows above the
 * button). The label card sits left of a 44 px circle, and the whole row is the tap target.
 */
export function DialRow({ href, onClick, delay, circle, children }: { href?: string; onClick?: () => void; delay: number; circle: ReactNode; children: ReactNode }) {
  const className = "dial-enter flex items-center justify-end gap-2.5 rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const body = (
    <>
      <span className="max-w-[min(15rem,calc(100vw-6rem))] rounded-2xl bg-primary px-3 py-2 text-sm text-secondary shadow-lg ring-1 ring-line">{children}</span>
      <span className="relative grid size-11 shrink-0 place-items-center rounded-full shadow-lg">{circle}</span>
    </>
  );
  const style = { transitionDelay: `${delay}ms` };
  return href ? (
    <Link href={href} prefetch={false} onClick={onClick} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className} style={style}>
      {body}
    </button>
  );
}

/** A progress ring drawn 6 px outside its circle, whatever the circle's size (the parent is `relative`). */
export function Ring({ fraction, color, track = "var(--color-line-soft)" }: { fraction: number; color: string; track?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 56 56" className="pointer-events-none absolute -top-1.5 -left-1.5 size-[calc(100%+0.75rem)] -rotate-90">
      <circle cx="28" cy="28" r="25" fill="none" stroke={track} strokeWidth="3" />
      {/* At 0 a round cap would still draw a dot: no arc then. */}
      {fraction > 0 && <circle cx="28" cy="28" r="25" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.min(100, fraction * 100)} 100`} />}
    </svg>
  );
}

export function Bar({ fraction, color }: { fraction: number; color: string }) {
  return (
    <span aria-hidden className="my-1 block h-1.5 overflow-hidden rounded-full bg-line-soft">
      <span className="block h-full rounded-full" style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`, background: color }} />
    </span>
  );
}
