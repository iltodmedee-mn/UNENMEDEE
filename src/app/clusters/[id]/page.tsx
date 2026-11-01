import { ArrowLeft } from "@untitledui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AIMarkdownMessage } from "@/components/iltod/ai-markdown";
import { ArticleGrid } from "@/components/iltod/article-grid";
import { RiskBadge } from "@/components/iltod/badges";
import { FeedSkeleton } from "@/components/iltod/skeletons";
import { getCluster, getClusters } from "@/lib/queries";
import { parseRouteId } from "@/lib/site";

export async function generateStaticParams() {
  const clusters = await getClusters(20);
  return (clusters.length ? clusters.map((c) => String(c.id)) : ["0"]).map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/clusters/[id]">): Promise<Metadata> {
  const { id } = await params;
  const parsed = parseRouteId(id);
  const data = parsed ? await getCluster(parsed) : null;
  // The canonical is the number itself: "/clusters/007" was a second, self-canonical page.
  return { title: data?.cluster.title ?? "Кластер", alternates: { canonical: `/clusters/${parsed ?? id}` } };
}

async function ClusterView({ params }: { params: PageProps<"/clusters/[id]">["params"] }) {
  const id = parseRouteId((await params).id);
  if (!id) notFound();
  const data = await getCluster(id);
  if (!data) notFound();
  const { cluster, articles, sourceCount } = data;
  return (
    <div className="flex flex-col gap-8">
      <Link href="/clusters" className="label-mono flex w-fit items-center gap-1.5 text-tertiary hover:text-primary">
        <ArrowLeft className="size-4" /> Бүх кластер
      </Link>
      <header className="flex flex-col gap-3">
        <div className="label-mono flex items-center gap-2 text-tertiary">
          {sourceCount} эх сурвалжийн {cluster.articleCount} мэдээ {cluster.maxRiskScore >= 35 && <RiskBadge score={cluster.maxRiskScore} />}
        </div>
        <h1 className="headline text-[1.875rem] text-primary md:text-[2.5rem]">{cluster.title}</h1>
      </header>
      {cluster.synthesisSummary && (
        <AIMarkdownMessage tier={cluster.maxRiskScore >= 65 ? "tier2" : "tier1"} title="Эх сурвалжуудыг нэгтгэсэн дүгнэлт" markdown={cluster.synthesisSummary} />
      )}
      <ArticleGrid articles={articles} />
    </div>
  );
}

export default async function ClusterPage(props: PageProps<"/clusters/[id]">) {
  // Checked before anything streams, so a missing cluster is a real 404 (see the article page).
  const id = parseRouteId((await props.params).id);
  if (!id || !(await getCluster(id))) notFound();
  return (
    <Suspense fallback={<FeedSkeleton count={3} />}>
      <ClusterView params={props.params} />
    </Suspense>
  );
}
