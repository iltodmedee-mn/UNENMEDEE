import type { Metadata } from "next";

import { HomeFeed } from "@/components/iltod/home-feed";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

// Static: no searchParams here (topics live at /topic/<key>), so the page is prerendered and its
// metadata lands in <head>. Old /?f=<topic> links redirect in next.config.ts.
export const metadata: Metadata = {
  alternates: { canonical: "/", types: { "application/rss+xml": [{ url: "/feed.xml", title: `${SITE_NAME} — шинэ мэдээ` }] } },
  openGraph: { type: "website", locale: "mn_MN", siteName: SITE_NAME, url: "/", title: SITE_TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export default function HomePage() {
  return <HomeFeed filter="all" />;
}
