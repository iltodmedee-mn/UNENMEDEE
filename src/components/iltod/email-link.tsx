import type { ReactNode } from "react";

import { CONTACT_EMAIL } from "@/lib/site";
import { cx } from "@/utils/cx";

/** Gmail's own compose page with the address filled in (opens in the reader's Gmail on a computer). */
export function gmailComposeUrl(to: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}`;
}

/**
 * Our contact address as a link that opens a new e-mail to it. With a mouse it opens Gmail's
 * compose page in a new tab (a `mailto:` on a computer usually starts a mail program nobody set
 * up); on a touch screen it stays `mailto:`, which opens the phone's mail app (Gmail on Android)
 * with the address filled in. Plain markup: the pointer media query picks the link, no client JS.
 */
export function EmailLink({ className, children, to = CONTACT_EMAIL }: { className?: string; children?: ReactNode; to?: string }) {
  const content = children ?? to;
  return (
    <>
      <a href={gmailComposeUrl(to)} target="_blank" rel="noopener noreferrer" className={cx(className, "pointer-coarse:hidden pointer-none:hidden")}>
        {content}
      </a>
      <a href={`mailto:${to}`} className={cx(className, "pointer-fine:hidden")}>
        {content}
      </a>
    </>
  );
}
