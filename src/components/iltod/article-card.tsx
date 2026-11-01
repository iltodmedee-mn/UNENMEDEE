import Link from "next/link";

import type { ArticleListItem } from "@/lib/queries";
import { tldrSentences } from "@/lib/format";
import { cx } from "@/utils/cx";

import { DeepBadge, MoneyTags, RiskBadge, SourceBadge } from "./badges";
import { SpinMeter } from "./spin-meter";
import { TimeAgo } from "./time-ago";

export function ArticleCard({ article, className }: { article: ArticleListItem; className?: string }) {
  const bullets = tldrSentences(article.tldr);
  return (
    <article
      className={cx(
        "group relative flex flex-col gap-4 rounded-2xl bg-primary p-5 ring-1 ring-line transition ring-inset hover:ring-brand",
        article.riskFlag && "ring-risk/50",
        className,
      )}
    >
      {/* One line: the hydrated TimeAgo is shorter than the server's full date, and a wrapping
          header moved the card body (CLS). The time truncates instead. */}
      <header className="flex items-center gap-2">
        <SourceBadge domain={article.sourceDomain} category={article.sourceCategory} />
        <TimeAgo date={article.publishedAt} className="label-mono min-w-0 truncate text-tertiary" />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {article.hasDeepAnalysis && <DeepBadge />}
          {article.riskScore >= 35 && <RiskBadge score={article.riskScore} />}
        </span>
      </header>

      <h3 className="story-headline text-balance text-primary">
        <Link href={`/article/${article.slug}`} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
          {article.title}
        </Link>
      </h3>

      {bullets.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm text-secondary">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-[1px] bg-brand-solid" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex flex-col gap-3">
        <MoneyTags amounts={article.amounts} />
        <SpinMeter neutrality={article.neutralityScore} />
      </footer>
    </article>
  );
}
