import Image from "next/image";

/** Hosts whose MP photos go through image optimization (next.config.ts images.remotePatterns). */
const OPTIMIZED = new Set(["parliament.mn", "www.parliament.mn"]);

function optimizable(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && OPTIMIZED.has(u.hostname) && u.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

/**
 * An MP's round photo. parliament.mn serves ~45 KB JPEGs that the pages show at 28–80 px: through
 * Vercel's image optimization they arrive as small AVIF/WebP at the shown size (cached 30 days);
 * any other host keeps a plain <img>. `eager` (an MP's own page) loads it at once (Next 16: not `priority`).
 */
export function MpPhoto({ src, size, alt = "", className, eager = false }: { src: string; size: number; alt?: string; className?: string; eager?: boolean }) {
  if (!optimizable(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} width={size} height={size} loading={eager ? "eager" : "lazy"} className={className} />;
  }
  return <Image src={src} alt={alt} width={size} height={size} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : undefined} className={className} />;
}
