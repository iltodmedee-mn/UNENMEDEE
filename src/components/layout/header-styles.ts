/**
 * Round outlined icon button, the header's one control shape (search, 🔔, Tт, theme, menu).
 * 32 px on phones, the same as the social circles beside it (Nov 2026: 36 px buttons next to
 * 24 px social marks looked mismatched), 40 px from sm.
 * Its own module: the client toggles import it and must not pull site-header.tsx (server queries).
 */
export const HEADER_ICON_BUTTON =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-tertiary ring-1 ring-line ring-inset transition hover:bg-primary_hover hover:text-fg-primary sm:size-10";
