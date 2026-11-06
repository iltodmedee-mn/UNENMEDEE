"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Empty } from "@/components/iltod/empty";
import { errorDigest, reportMailto } from "@/lib/error-report";

/**
 * A page that failed to render (`safe()` rethrows at runtime so nothing empty is cached). The
 * header and footer stay; the reader can retry in place. The reference code is Next's `digest`,
 * the same string the server log carries (src/instrumentation.ts), so a reader who quotes it in a
 * report points the owner at the exact failure. The copy never guesses at the cause.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  const path = usePathname() ?? "/";
  return (
    <div className="py-12">
      <Empty title="Хуудас ачаалахад алдаа гарлаа" description="Хэсэг хугацааны дараа дахин оролдоно уу. Давтагдвал доорх лавлах кодын хамт бидэнд мэдэгдээрэй.">
        {digest && (
          <p className="label-mono basis-full text-tertiary">
            Лавлах код: <span className="num-mono select-all text-secondary">{digest}</span>
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => retry()} className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover">
            Дахин оролдох
          </button>
          <Link href="/" className="rounded-lg px-4 py-2.5 text-sm font-semibold text-secondary ring-1 ring-primary hover:bg-primary_hover">
            Нүүр хуудас руу
          </Link>
          <a href={reportMailto(path, digest)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-secondary ring-1 ring-primary hover:bg-primary_hover">
            Мэдэгдэх
          </a>
        </div>
      </Empty>
    </div>
  );
}
