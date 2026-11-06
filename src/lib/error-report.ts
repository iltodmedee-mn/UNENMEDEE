import { CONTACT_EMAIL } from "@/lib/site";

/**
 * The reference code of a failed render: Next.js replaces a Server Component's error with a
 * generic message and a `digest`, which is the same string in the server log (instrumentation.ts),
 * so a reader quoting it lets the owner find the exact failure. Client-side errors may have none.
 */
export function errorDigest(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("digest" in error)) return null;
  const d = (error as { digest?: unknown }).digest;
  return typeof d === "string" && d.trim() ? d.trim().slice(0, 64) : null;
}

/** A mailto: link with the page and the reference code already in the body. */
export function reportMailto(path: string, digest: string | null): string {
  const subject = "Сайтын алдаа";
  const body = [`Хуудас: ${path}`, digest ? `Лавлах код: ${digest}` : null, "", "Юу хийж байхад гарсан бэ:", ""].filter((l) => l !== null).join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
