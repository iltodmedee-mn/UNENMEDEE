import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Providers } from "@/components/providers";
import { InstallBanner } from "@/components/pwa/pwa-controls";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { isDemoDatabase } from "@/db";
import { jsonLd, REPO_URL, SITE_ALTERNATE_NAMES, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL, CONTACT_EMAIL, SOCIAL, THEME_COLOR } from "@/lib/site";

import "./globals.css";

// Untitled UI's theme reads --font-inter. One self-hosted variable subset (Latin + Cyrillic + Ө Ү ₮,
// 56 KB, preloaded) replaces Google's three files (175 KB, the 83 KB cyrillic-ext one not preloaded
// although Ө and Ү live there). Rebuild with pyftsubset from the Inter release (CLAUDE.md §6c).
const inter = localFont({ src: "../assets/fonts/inter-var.woff2", weight: "100 900", variable: "--font-inter", display: "swap", preload: true });
// Headlines: Inter Display (the opsz=32 instance, weights 650–850, 40 KB). Numbers and labels:
// JetBrains Mono 500 (34 KB). Both subset to the same characters as the body font.
// "optional", not "swap": a long article headline wrapped to an extra line in the fallback, and the late
// swap moved everything below it (PageSpeed CLS 0.126 on articles, Oct 2026). Preloaded, so it is
// usually in time; when it is not, that page keeps the fallback and the next page has it from cache.
const interDisplay = localFont({ src: "../assets/fonts/inter-display-var.woff2", weight: "650 850", variable: "--font-inter-display", display: "optional", preload: true });
const mono = localFont({ src: "../assets/fonts/jetbrains-mono-500.woff2", weight: "500", variable: "--font-jb-mono", display: "swap", preload: true });

const verification: Metadata["verification"] = {
  google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } : undefined,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  // iOS home-screen app: full-screen, status bar over the page (safe-area padding in CSS).
  appleWebApp: { capable: true, title: "ИЛ ТОД", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  category: "news",
  alternates: { types: { "application/rss+xml": [{ url: "/feed.xml", title: `${SITE_NAME} — шинэ мэдээ` }] } },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  // No og:title / og:description here: a page without its own openGraph inherited the home
  // page's title, so a shared /officials/46 or /prices showed "ИЛ ТОД МЭДЭЭ … шинэ мэдээ" in
  // Messenger and Facebook. Without them, link previews fall back to the page's own <title> and
  // description. Pages that set openGraph themselves (articles, topics, MPs…) are unaffected.
  openGraph: { type: "website", locale: "mn_MN", siteName: SITE_NAME },
  twitter: { card: "summary_large_image" },
  verification,
};

/** Site-wide structured data: who publishes (Organization) and the site itself (WebSite). */
const SITE_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "NewsMediaOrganization",
      "@id": `${SITE_URL}/#org`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAMES,
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icons/icon-512.png`, width: 512, height: 512 },
      publishingPrinciples: `${SITE_URL}/method`,
      email: CONTACT_EMAIL,
      contactPoint: { "@type": "ContactPoint", contactType: "editorial", email: CONTACT_EMAIL, availableLanguage: ["mn", "en"] },
      sameAs: [SOCIAL.facebook, SOCIAL.instagram, SOCIAL.threads, REPO_URL],
    },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, alternateName: SITE_ALTERNATE_NAMES, description: SITE_DESCRIPTION, inLanguage: "mn", publisher: { "@id": `${SITE_URL}/#org` } },
  ],
};

export const viewport: Viewport = {
  // Content can reach the notch area; header/footer pad with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="mn" className={`${inter.variable} ${interDisplay.variable} ${mono.variable} h-full scroll-smooth antialiased`} suppressHydrationWarning>
      <head>
        {/* Before the first paint: hide the first-visit intro for readers who dismissed it (no layout shift). */}
        <script dangerouslySetInnerHTML={{ __html: "try{localStorage.getItem('iltod-intro')&&(document.documentElement.dataset.intro='seen')}catch(e){}" }} />
        {/* Chrome's install offer can fire before any chunk runs (a fast, service-worker-controlled
            load): keep it for use-pwa.ts, or the install strip never appears on Android. */}
        <script dangerouslySetInnerHTML={{ __html: "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__iltodBip=e});addEventListener('appinstalled',function(){window.__iltodBip=null})" }} />
      </head>
      <body className="flex min-h-full flex-col bg-primary text-primary">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(SITE_JSON_LD) }} />
        <Providers>
          {isDemoDatabase() && (
            <p className="bg-signal px-4 py-1.5 text-center text-xs font-semibold text-signal-ink">
              Демо горим: tests/fixtures-аас ачаалсан жишээ өгөгдөл. Бодит сайт: iltodmedee.mn
            </p>
          )}
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 md:px-8">{children}</main>
          <SiteFooter />
          <InstallBanner />
        </Providers>
        <ServiceWorkerRegister />
        {/*
          Vercel Web Analytics without the npm client: the queue stub plus Vercel's own script, which
          follows client-side navigations itself. Keeps ~15 KB of JS out of every page; only on Vercel
          (the script lives at /_vercel/insights there, 404 elsewhere). It is injected after `load`,
          when the browser is idle: as a deferred script it was a 140 ms task inside the window
          Lighthouse counts as Total Blocking Time on phones. The stub queues the page view meanwhile.
        */}
        {process.env.VERCEL && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};addEventListener('load',function(){(window.requestIdleCallback||setTimeout)(function(){var s=document.createElement('script');s.src='/_vercel/insights/script.js';s.defer=true;document.body.appendChild(s)})});",
            }}
          />
        )}
      </body>
    </html>
  );
}
