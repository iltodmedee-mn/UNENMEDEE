import { ArrowLeft, LinkExternal01 } from "@untitledui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SeriesLineChart } from "@/components/iltod/charts";
import { ShareButton } from "@/components/iltod/share-button";
import { DeclaredCompanies } from "@/components/officials/declared-companies";
import { FollowToggle } from "@/components/officials/follow";
import { TimeAgo } from "@/components/iltod/time-ago";
import type { AssetDeclaration } from "@/db/schema";
import { formatMntShort, formatNumber } from "@/lib/format";
import { declarationFlags } from "@/lib/officials/flags";
import { termLabel, termOf } from "@/lib/officials/terms";
import { PLACES, placeMatchesConstituency } from "@/lib/places";
import { declaredCompanies } from "@/lib/officials/companies";
import { getAttendance, getCompanyTenders, getOfficialCompanies, getPolitician, getPoliticianIds } from "@/lib/queries";
import { jsonLd, parseRouteId, SITE_NAME } from "@/lib/site";
import { breadcrumbLd, personLd } from "@/lib/structured-data";

export async function generateStaticParams() {
  const ids = await getPoliticianIds();
  return (ids.length ? ids : [0]).map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: PageProps<"/officials/[id]">): Promise<Metadata> {
  const { id } = await params;
  const parsed = parseRouteId(id);
  const data = parsed ? await getPolitician(parsed) : null;
  if (!data) return { title: "Олдсонгүй", robots: { index: false } };
  const p = data.politician;
  // People search the short form ("Д.Ганмаа хөрөнгө"); the full name follows in brackets.
  const title = `${p.shortName} (${p.fullName}) — хөрөнгө, орлого, ирц`;
  const description = `${p.party ?? ""} УИХ-ын гишүүн ${p.shortName}-ийн Авлигатай тэмцэх газарт гаргасан хөрөнгө, орлогын мэдүүлэг жил бүрээр, мэдээнд дурдагдсан байдал.`.trim();
  const url = `/officials/${p.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    // Without its own openGraph a shared profile showed the site's title and card (Messenger,
    // Facebook, Discord read og:*, not <title>); the image is ./opengraph-image.tsx.
    openGraph: { type: "profile", url, title, description, siteName: SITE_NAME, locale: "mn_MN" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const COLUMNS: { key: keyof AssetDeclaration; label: string }[] = [
  { key: "incomeOwn", label: "Өөрийн орлого" },
  { key: "incomeFamily", label: "Гэр бүлийн орлого" },
  { key: "buildingsValue", label: "Үл хөдлөх" },
  { key: "transportValue", label: "Тээврийн хэрэгсэл" },
  { key: "landValue", label: "Газар" },
  { key: "savings", label: "Хадгаламж" },
  { key: "receivables", label: "Авлага" },
  { key: "otherAssets", label: "Хувьцаа, зөвшөөрөл, бусад" },
  { key: "totalAssets", label: "Нийт хөрөнгө" },
  { key: "loans", label: "Зээл (өр)" },
  { key: "gifts", label: "Бэлэг" },
];

function money(v: unknown): string {
  return typeof v === "number" ? formatMntShort(v) : "—";
}

/**
 * Plenary attendance from opendata.mn, matched by short name ("Х.Баттулга") within the member's
 * own parliamentary term (`termOf`): a former member with the same short name is another row.
 */
async function Attendance({ shortName, nameShared, termStart }: { shortName: string; nameShared: boolean; termStart: string | null }) {
  if (nameShared) {
    return (
      <p className="rounded-2xl bg-secondary p-4 text-sm text-secondary">
        Ирцийн өгөгдөл гишүүдийг зөвхөн нэрээр ({shortName}) ялгадаг бөгөөд энэ нэртэй гишүүн хоёр байгаа тул ирцийг хэнийх нь гэж хэлэх боломжгүй: харуулаагүй.
      </p>
    );
  }
  const data = await getAttendance();
  const rowsForName = data?.highlight.top.filter((x) => x.name === shortName) ?? [];
  const term = termStart ? termOf(termStart) : null;
  // Older snapshots have no term; without a known term the newest one is the member's current seat.
  const m = rowsForName.find((x) => x.term === undefined || x.term === term) ?? (term === null ? [...rowsForName].sort((a, b) => (b.term ?? 0) - (a.term ?? 0))[0] : undefined);
  if (!data || !m) return null;
  const { highlight: h } = data;
  const parts = [
    { label: "Ирсэн", n: m.present, color: "bg-success-solid" },
    { label: "Томилолт", n: m.travel, color: "bg-[var(--series-1)]" },
    { label: "Эмнэлэг", n: m.medical, color: "bg-[var(--series-4)]" },
    { label: "Чөлөө", n: m.leave, color: "bg-[var(--series-3)]" },
    { label: "Шалтгаан бүртгэгдээгүй", n: m.unexplained, color: "bg-error-solid" },
  ];
  return (
    <section aria-labelledby="attendance" className="flex flex-col gap-3 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset">
      <header className="flex flex-col gap-1">
        <h2 id="attendance" className="text-lg font-semibold text-primary">
          🏛 Нэгдсэн хуралдааны ирц
        </h2>
        <p className="text-xs text-tertiary">
          {m.term !== undefined ? `${termLabel(m.term)} оны парламент, ` : ""}
          {m.from ?? h.from} – {m.to ?? h.to}, {m.records} хуралдаан. Эх сурвалж:{" "}
          <a href={data.pageUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-secondary hover:underline">
            opendata.mn
          </a>
        </p>
      </header>
      <div className="flex h-3 overflow-hidden rounded-full bg-secondary" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {parts.map((p) => p.n > 0 && <div key={p.label} className={p.color} style={{ width: `${(p.n / m.records) * 100}%` }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${p.color}`} />
            <span className="text-secondary">
              {p.label}: <strong className="text-primary tabular-nums">{p.n}</strong>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-tertiary">&quot;Шалтгаан бүртгэгдээгүй&quot; гэдэг нь ирсэн цаг ч, томилолт, чөлөөний тэмдэглэл ч өгөгдөлд байхгүй тохиолдол: тасалсан гэсэн баталгаа биш.</p>
    </section>
  );
}

async function Profile({ params }: { params: PageProps<"/officials/[id]">["params"] }) {
  const id = parseRouteId((await params).id);
  if (!id) notFound();
  const data = await getPolitician(id);
  if (!data) notFound();
  const { politician: p, declarations: rows, hiddenYears, mentions, nameShared, nameSharedNow } = data;
  const declared = declaredCompanies(rows.at(-1)?.details);
  const [companies, companyTenders] = await Promise.all([getOfficialCompanies([...declared.stocks, ...declared.lenders].map((o) => o.key)).catch(() => null), getCompanyTenders().catch(() => ({}))]);
  // Only years the member held this seat can have a "missing" filing.
  const seatFrom = p.termStart ? Number(p.termStart.slice(0, 4)) : null;
  const flags = declarationFlags(rows, hiddenYears, seatFrom ? { from: seatFrom, to: p.termEnd ? Number(p.termEnd.slice(0, 4)) : null } : undefined);
  const latest = rows.at(-1);

  // The constituency's aimags / districts link to their news pages (matched by the areas it lists).
  const places = PLACES.filter((pl) => pl.kind !== "capital" && placeMatchesConstituency(pl, p.constituency));
  const ld = { "@context": "https://schema.org", "@graph": [personLd(p), breadcrumbLd([{ name: "УИХ-ын гишүүд", path: "/officials" }, { name: p.shortName, path: `/officials/${p.id}` }])] };

  return (
    <article className="flex flex-col gap-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Link href="/officials" className="flex w-fit items-center gap-1.5 text-sm font-semibold text-tertiary hover:text-secondary">
        <ArrowLeft className="size-4" /> Бүх гишүүд
      </Link>
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- portraits come from parliament.mn */}
        {p.photoUrl && <img src={p.photoUrl} alt={p.fullName} className="size-20 shrink-0 rounded-full bg-secondary object-cover" />}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="headline text-[1.75rem] text-primary">{p.fullName}</h1>
          {p.shortName !== p.fullName && <p className="label-mono normal-case text-tertiary">{p.shortName}</p>}
          <p className="text-sm text-tertiary">
            УИХ-ын гишүүн{p.isActive ? "" : " (асан)"} · {p.party ?? "—"}
            {p.constituency ? ` · ${p.constituency}${p.votes ? ` (${formatNumber(p.votes)} санал)` : ""}` : ""}
            {p.termStart ? ` · ${p.termStart.slice(0, 4)}–${p.termEnd?.slice(0, 4) ?? ""}` : ""}
          </p>
          {places.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-tertiary">Тойргийн мэдээ:</span>
              {places.map((pl) => (
                <Link key={pl.slug} href={`/place/${pl.slug}`} prefetch={false} className="font-semibold text-brand-secondary hover:underline">
                  {pl.name}
                </Link>
              ))}
            </p>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-brand-secondary">
            {p.xacxomId && (
              <a href={`https://xacxom.iaac.mn/xacxom/${p.xacxomId}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                ХАСХОМ мэдүүлэг <LinkExternal01 className="size-3.5" />
              </a>
            )}
            <a href={p.profileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
              parliament.mn <LinkExternal01 className="size-3.5" />
            </a>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.isActive && <FollowToggle id={p.id} name={p.fullName} />}
            <ShareButton path={`/officials/${p.id}`} title={`${p.fullName}: хөрөнгө, орлогын мэдүүлэг`} />
          </div>
        </div>
      </header>

      <p className="rounded-2xl bg-secondary p-4 text-sm text-secondary">
        Доорх тоо бүр Авлигатай тэмцэх газрын ХАСХОМ системд гишүүний өөрөө гаргасан албан ёсны мэдүүлгээс авсан (₮). Мэдүүлэг бол буруутгал биш. Өөрчлөлтийн шалтгааныг (өв залгамжлал, худалдаа,
        цалин г.м.) эх мэдүүлгээс шалгана уу.
      </p>

      <Attendance shortName={p.shortName} nameShared={nameSharedNow} termStart={p.termStart} />

      {hiddenYears.length > 0 && (
        <p className="rounded-2xl bg-secondary p-4 text-sm text-secondary">
          {hiddenYears.join(", ")} оны мэдүүлгийг редактор харьцуулалтаас хассан (эх мэдүүлэгт нэгжийн алдаа илэрсэн). Тоо нь{" "}
          {p.xacxomId ? (
            <a href={`https://xacxom.iaac.mn/xacxom/${p.xacxomId}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-secondary hover:underline">
              ХАСХОМ-ын эх мэдүүлэгт
            </a>
          ) : (
            "ХАСХОМ-ын эх мэдүүлэгт"
          )}{" "}
          хэвээр байна.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-tertiary">Энэ гишүүний мэдүүлэг ХАСХОМ системээс олдсонгүй.</p>
      ) : (
        <>
          {latest && (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: `Нийт хөрөнгө (${latest.year})`, value: money(latest.totalAssets) },
                { label: "Өөрийн орлого", value: money(latest.incomeOwn) },
                { label: "Гэр бүлийн орлого", value: money(latest.incomeFamily) },
                { label: "Зээл (өр)", value: money(latest.loans) },
              ].map((t) => (
                <div key={t.label} className="rounded-2xl bg-primary p-4 ring-1 ring-line ring-inset">
                  <p className="text-xs text-tertiary">{t.label}</p>
                  <p className="mt-1 text-lg font-semibold text-primary tabular-nums">{t.value}</p>
                </div>
              ))}
            </section>
          )}

          {flags.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl bg-signal-soft p-4 ring-1 ring-signal ring-inset">
              <h2 className="text-sm font-semibold text-primary">Анхаарах өөрчлөлт (тооцоолсон, дүгнэлт биш)</h2>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-secondary">
                {flags.map((f) => (
                  <li key={`${f.kind}-${f.year}`}>{f.text}</li>
                ))}
              </ul>
            </section>
          )}

          {rows.length > 1 && (
            <section className="rounded-2xl bg-primary p-4 ring-1 ring-line ring-inset">
              <h2 className="mb-2 text-sm font-semibold text-primary">Нийт хөрөнгө жилээр (сая ₮)</h2>
              <SeriesLineChart data={rows.map((r) => ({ label: String(r.year), value: Math.round((r.totalAssets ?? 0) / 1e5) / 10 }))} name="Нийт хөрөнгө" unit="сая ₮" ariaLabel="Нийт хөрөнгө жилээр" />
            </section>
          )}

          <section className="overflow-x-auto rounded-2xl bg-primary ring-1 ring-line ring-inset">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-tertiary">
                  <th className="p-3 font-medium">Үзүүлэлт</th>
                  {rows.map((r) => (
                    <th key={r.year} className="p-3 text-right font-medium">
                      {r.year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className="p-3 text-tertiary">Албан тушаал</td>
                  {rows.map((r) => (
                    <td key={r.year} className="p-3 text-right text-xs text-tertiary">
                      {r.positionName ?? "—"}
                    </td>
                  ))}
                </tr>
                {COLUMNS.map((c) => (
                  <tr key={c.key} className={c.key === "totalAssets" ? "border-b border-line bg-secondary font-semibold" : "border-b border-line"}>
                    <td className="p-3 text-secondary">{c.label}</td>
                    {rows.map((r) => (
                      <td key={r.year} className="p-3 text-right text-primary tabular-nums">
                        {money(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {latest?.details?.transports && <p className="text-sm text-tertiary">Тээврийн хэрэгсэл ({latest.year}): {latest.details.transports}</p>}
          <p className="text-xs text-quaternary">
            Эх сурвалж: Авлигатай тэмцэх газар, ХАСХОМ · шинэчлэгдсэн <TimeAgo date={latest?.fetchedAt ?? null} />
          </p>
          {latest && (
            <DeclaredCompanies details={latest.details} year={latest.year} xacxomUrl={p.xacxomId ? `https://xacxom.iaac.mn/xacxom/${p.xacxomId}` : null} snapshot={companies} tenders={companyTenders} />
          )}
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">Мэдээнд дурдагдсан</h2>
        {mentions.length ? (
          <ul className="flex flex-col divide-y divide-line-soft">
            {mentions.map((m) => (
              <li key={m.slug} className="py-3">
                <Link href={`/article/${m.slug}`} className="font-medium text-primary hover:text-brand-secondary">
                  {m.title}
                </Link>
                <p className="text-xs text-tertiary">
                  {m.sourceName} · <TimeAgo date={m.publishedAt} />
                </p>
              </li>
            ))}
          </ul>
        ) : nameShared ? (
          <p className="text-sm text-tertiary">
            {p.shortName} гэсэн товч нэртэй өөр гишүүн {nameSharedNow ? "одоогийн парламентад" : "өмнөх парламентад"} байсан тул мэдээн дэх дурдлагыг хэнийх нь гэж ялгах боломжгүй: харуулаагүй.
          </p>
        ) : (
          <p className="text-sm text-tertiary">Төрийн эх сурвалжуудын мэдээнд {p.shortName} одоогоор дурдагдаагүй байна.</p>
        )}
      </section>
    </article>
  );
}

export default async function PoliticianPage(props: PageProps<"/officials/[id]">) {
  // Checked before anything streams, so an unknown member is a real 404 (see the article page).
  const id = parseRouteId((await props.params).id);
  if (!id || !(await getPolitician(id))) notFound();
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-secondary" />}>
      <Profile params={props.params} />
    </Suspense>
  );
}
