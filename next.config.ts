import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo database (`npm run demo`) is loaded from node_modules at run time, never bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // sharp + libvips (glibc, musl and wasm builds, ~35 MB) were traced into every server
  // function. Vercel optimizes next/image on its own infrastructure and next/og uses Satori, so
  // no function needs them; with ~40 functions per deployment they filled the 10 GB Hobby
  // "Functions Storage".
  outputFileTracingExcludes: {
    "/**": ["node_modules/sharp/**", "node_modules/@img/**"],
    "/*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
  cacheComponents: true,
  // Cache lifetimes (Nov 2026: the built-in "minutes" profile, read by the header on every page,
  // re-rendered every visited page once a minute: 306 K ISR writes against Hobby's 200 K). The
  // pipeline adds news at most every 30 minutes, so feeds refresh every 30 minutes and everything
  // else hourly ("hours").
  cacheLife: {
    news: { stale: 300, revalidate: 1800, expire: 86_400 },
  },
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Vercel sends HSTS without includeSubDomains; iltodmedee.mn has no plain-http subdomains. No preload yet.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // The directives that cost nothing. No script-src on purpose: Next.js needs inline
          // scripts, and nonces would make every static page dynamic (no CDN, slower LCP).
          { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests" },
        ],
      },
      {
        // The service worker must never be cached, or users get stuck on an old version.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  // AVIF first: the logo mark (the only next/image) was a 7 KB WebP at 2x, flagged by Lighthouse.
  images: {
    formats: ["image/avif", "image/webp"],
    // MP photos from parliament.mn (~45 KB JPEGs shown at 28–80 px): optimized once, kept 30 days.
    remotePatterns: [
      { protocol: "https", hostname: "parliament.mn", pathname: "/uploads/**" },
      { protocol: "https", hostname: "www.parliament.mn", pathname: "/uploads/**" },
    ],
    minimumCacheTTL: 2_592_000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
