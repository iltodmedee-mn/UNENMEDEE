import Image from "next/image";

import { cx } from "@/utils/cx";

/**
 * ИЛ ТОД МЭДЭЭ brand: the eye mark (PNG, transparent) + the wordmark as live text, so it stays
 * sharp at any size and follows dark mode. "мэдээ" is the brand teal (text-brand-secondary:
 * brand-700 in light mode for 4.5:1, brand-300 in dark mode).
 */
export function Logo({ className, withDomain = false }: { className?: string; withDomain?: boolean }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <Image src="/brand/mark.png" alt="" width={52} height={32} preload className="h-7 w-auto sm:h-8" />
      <span className="flex flex-col leading-none">
        {/* Two lines on phones (the header also holds 4 buttons), one line from `sm` up. */}
        <span className="flex flex-col font-display text-[0.9rem] font-extrabold tracking-[-0.02em] text-primary uppercase sm:flex-row sm:gap-1.5 sm:text-[1.05rem]">
          <span>Ил&nbsp;тод</span>
          <span className="text-brand-secondary">мэдээ</span>
        </span>
        {withDomain && <span className="label-mono mt-1 text-tertiary">iltodmedee.mn</span>}
      </span>
    </span>
  );
}
