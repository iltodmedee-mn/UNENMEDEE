import type { ArticleListItem } from "@/lib/queries";

import { ArticleCard } from "./article-card";

export function ArticleGrid({ articles }: { articles: ArticleListItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {articles.map((a) => (
        <ArticleCard key={a.id} article={a} />
      ))}
    </div>
  );
}
