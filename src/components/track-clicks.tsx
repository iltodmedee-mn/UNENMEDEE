"use client";

import { useEffect } from "react";

import { linkHost, track } from "@/lib/track";

/**
 * One listener for links that server components render: an outbound «Эх сурвалж» link carries
 * `data-track="source"` and counts as a "Source click" with its host. Capture phase, so a link that
 * opens a new tab is counted before the tab takes focus.
 */
export function TrackClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[data-track="source"]');
      if (a) track("Source click", { host: linkHost(a.getAttribute("href")), page: location.pathname.split("/")[1] || "home" });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
