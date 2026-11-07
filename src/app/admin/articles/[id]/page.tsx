import { ArrowLeft } from "@untitledui/icons";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ArticleEditor } from "@/components/admin/article-editor";
import { ReanalyzeButtons } from "@/components/admin/row-actions";
import { getDb } from "@/db";
import { articles } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { safeHttpUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Нийтлэл засах", robots: { index: false } };
export const maxDuration = 60;

export async function generateStaticParams() {
  return [{ id: "0" }];
}

async function Editor({ params }: { params: PageProps<"/admin/articles/[id]">["params"] }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [a] = await getDb().select().from(articles).where(eq(articles.id, id));
  if (!a) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <a href={safeHttpUrl(a.originalUrl)} target="_blank" rel="noreferrer" className="text-sm text-brand-secondary hover:underline">
          {a.originalUrl}
        </a>
        <ReanalyzeButtons id={a.id} />
      </div>
      <div className="rounded-2xl bg-primary p-6 ring-1 ring-secondary ring-inset">
        <ArticleEditor article={{ id: a.id, title: a.title, tldr: a.tldrSummary ?? "", content: a.cleanContent, isPublished: a.isPublished, readerTitle: a.readerTitle, hasImpact: a.readerImpact !== null }} />
      </div>
    </div>
  );
}

export default function EditArticlePage(props: PageProps<"/admin/articles/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin" className="flex w-fit items-center gap-1.5 text-sm font-semibold text-tertiary hover:text-secondary">
        <ArrowLeft className="size-4" /> Самбар
      </Link>
      <h1 className="text-display-xs font-semibold text-primary">Нийтлэл засах</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-primary ring-1 ring-secondary ring-inset" />}>
        <Editor params={props.params} />
      </Suspense>
    </div>
  );
}
