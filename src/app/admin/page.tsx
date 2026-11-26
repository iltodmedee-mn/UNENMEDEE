import { desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { deleteDonation, toggleDonationNote } from "@/app/admin/actions";
import { logout } from "@/app/admin/auth-actions";
import { AboutForm } from "@/components/admin/about-form";
import { DonationForm } from "@/components/admin/donation-form";
import { DonationsForm } from "@/components/admin/donations-form";
import { HiddenYearsForm } from "@/components/admin/hidden-years-form";
import { LedgerForm } from "@/components/admin/ledger-form";
import { PublishToggle, ReanalyzeButtons } from "@/components/admin/row-actions";
import { RiskBadge, SourceBadge } from "@/components/iltod/badges";
import { getDb, hasDatabase } from "@/db";
import { articles, sources, transparencyLedger } from "@/db/schema";
import { monthKey } from "@/lib/ai/usage-log";
import { ubDateKey } from "@/lib/archive";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDateMn, formatNumber } from "@/lib/format";
import { ANONYMOUS_LABEL } from "@/lib/donations";
import { getAbout, getDonation, getDonations, getHiddenYearsText } from "@/lib/queries";

export const metadata: Metadata = { title: "Редакцийн самбар", robots: { index: false } };
// AI re-analysis runs inside server actions on this page.
export const maxDuration = 60;

async function Dashboard({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await requireAdmin();
  if (!hasDatabase()) return <p className="text-sm text-error-primary">DATABASE_URL тохируулаагүй байна.</p>;
  const q = String((await searchParams).q ?? "").trim();
  const db = getDb();
  const month = monthKey();
  const [rows, [ledger], [counts]] = await Promise.all([
    db
      .select({
        id: articles.id,
        title: articles.title,
        slug: articles.slug,
        isPublished: articles.isPublished,
        riskScore: articles.riskScore,
        analyzed: sql<boolean>`${articles.tldrSummary} is not null`,
        aiError: articles.aiError,
        createdAt: articles.createdAt,
        domain: sources.domain,
        category: sources.category,
      })
      .from(articles)
      .innerJoin(sources, eq(articles.sourceId, sources.id))
      .where(q ? or(ilike(articles.title, `%${q}%`), ilike(sources.domain, `%${q}%`)) : undefined)
      .orderBy(desc(articles.createdAt))
      .limit(60),
    db.select().from(transparencyLedger).where(eq(transparencyLedger.month, month)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${articles.tldrSummary} is null and ${articles.aiError} is null)::int`,
        failed: sql<number>`count(*) filter (where ${articles.aiError} is not null)::int`,
        hidden: sql<number>`count(*) filter (where not ${articles.isPublished})::int`,
      })
      .from(articles),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Нийт", counts.total],
          ["AI хүлээгдэж буй", counts.pending],
          ["AI алдаатай", counts.failed],
          ["Нуусан", counts.hidden],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset">
            <p className="text-xs text-tertiary">{label}</p>
            <p className="text-xl font-semibold text-primary tabular-nums">{n}</p>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset">
        <h2 className="text-md font-semibold text-primary">Санхүүгийн бүртгэл (ил тод тайлан)</h2>
        <LedgerForm
          month={month}
          defaults={{
            infra: Number(ledger?.infraCostUsd ?? 0),
            ads: ledger?.adRevenueUsd == null ? null : Number(ledger.adRevenueUsd),
            donations: ledger?.donationsUsd == null ? null : Number(ledger.donationsUsd),
            notes: ledger?.notes ?? "",
          }}
        />
      </section>

      <DonationsSection />

      <section className="flex flex-col gap-3 rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset">
        <h2 className="text-md font-semibold text-primary">Дэмжих: хандивын данс</h2>
        <p className="text-xs text-tertiary">Толгой хэсэг, хөл хэсэг болон /support хуудсанд харагдана. Хадгалсны дараа шууд шинэчлэгдэнэ.</p>
        <DonationForm current={await getDonation()} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset">
        <h2 className="text-md font-semibold text-primary">«Бид хэн бэ» хуудас (/about)</h2>
        <p className="text-xs text-tertiary">Энгийн текст: хоосон мөрөөр догол мөр тусгаарлана. Хоосон үлдээсэн хэсэгт анхдагч текст харагдана. «Ил тод гэдэг 4 амлалт», холбоо барих хэсэг автоматаар гарна.</p>
        <AboutForm current={await getAbout()} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset">
        <h2 className="text-md font-semibold text-primary">Улстөрчид: харьцуулалтаас хасах мэдүүлгийн жил</h2>
        <p className="text-xs text-tertiary">
          Эх мэдүүлэгт нэгжийн алдаа (мянган ₮-ийн оронд ₮) байвал тэр жилийг хувийн өөрчлөлт, тэмдэглэгээнээс хасна. Профайл дээр хассан гэж бичигдэж, ХАСХОМ-ын эх мэдүүлэг рүү холбоос үлдэнэ.
        </p>
        <HiddenYearsForm current={await getHiddenYearsText()} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-md font-semibold text-primary">Нийтлэлүүд</h2>
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Гарчиг эсвэл домэйнээр хайх"
              className="w-64 rounded-lg bg-primary px-3 py-2 text-sm text-primary ring-1 ring-primary ring-inset outline-none focus:ring-2 focus:ring-brand"
            />
            <button className="rounded-lg px-3 py-2 text-sm font-semibold text-secondary ring-1 ring-primary ring-inset hover:bg-primary_hover">Хайх</button>
          </form>
        </div>
        <div className="overflow-x-auto rounded-2xl bg-primary ring-1 ring-secondary ring-inset">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-secondary bg-secondary text-xs font-semibold text-tertiary">
              <tr>
                <th className="px-4 py-3">Нийтлэл</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">Төлөв</th>
                <th className="px-4 py-3 text-right">Үйлдэл</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <SourceBadge domain={r.domain} category={r.category} />
                      <span className="text-xs text-tertiary">{formatDateMn(r.createdAt)}</span>
                    </div>
                    <Link href={`/admin/articles/${r.id}`} className="mt-1 block font-medium text-primary hover:text-brand-secondary">
                      {r.title}
                    </Link>
                    {r.aiError && <p className="mt-1 text-xs text-error-primary">{r.aiError.slice(0, 140)}</p>}
                  </td>
                  <td className="px-4 py-3">{r.analyzed ? <RiskBadge score={r.riskScore} /> : <span className="text-xs text-tertiary">хүлээгдэж буй</span>}</td>
                  <td className="px-4 py-3">
                    <PublishToggle id={r.id} published={r.isPublished} />
                  </td>
                  <td className="px-4 py-3">
                    <ReanalyzeButtons id={r.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Today in Ulaanbaatar for the date field (the admin page is dynamic: it reads the session cookie). */
const ubToday = () => ubDateKey(Date.now());

/** Received donations: add one as it arrives in the bank, delete a mistyped one. */
async function DonationsSection() {
  const { rows, count, totalMnt, monthMnt } = await getDonations(20);
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset">
      <h2 className="text-md font-semibold text-primary">Ирсэн хандив (ил тод тайланд нийтлэгдэнэ)</h2>
      <p className="text-xs text-tertiary">
        Банкны хуулгаас орсон хандив бүрийг нэмнэ: /transparency дээр огноо, дүн, нэрийн хамт шууд гарна. Нийт {formatNumber(count)} хандив · {formatNumber(totalMnt)} ₮ · энэ сард {formatNumber(monthMnt)} ₮.
      </p>
      <DonationsForm today={ubToday()} />
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-secondary border-t border-secondary">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="num-mono text-tertiary">{d.receivedOn}</span>
              <span className="num-mono font-semibold text-primary">{formatNumber(d.amountMnt)} ₮</span>
              <span className="text-secondary">{d.donor ?? ANONYMOUS_LABEL}</span>
              {d.note && (
                <span className={d.notePublic ? "text-tertiary" : "text-tertiary line-through decoration-1"}>
                  «{d.note}» <span className="text-xs">{d.notePublic ? "· нийтэлсэн" : "· нуугдсан"}</span>
                </span>
              )}
              {d.note && (
                <form action={toggleDonationNote} className="ml-auto">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="show" value={d.notePublic ? "0" : "1"} />
                  <button className="rounded-md px-2 py-1 text-xs font-semibold text-secondary ring-1 ring-primary ring-inset hover:bg-primary_hover">
                    {d.notePublic ? "Утгыг нуух" : "Утгыг нийтлэх"}
                  </button>
                </form>
              )}
              <form action={deleteDonation} className={d.note ? "" : "ml-auto"}>
                <input type="hidden" name="id" value={d.id} />
                <button className="rounded-md px-2 py-1 text-xs font-semibold text-error-primary ring-1 ring-primary ring-inset hover:bg-primary_hover">Устгах</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminPage(props: PageProps<"/admin">) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-display-xs font-semibold text-primary">Редакцийн самбар</h1>
          <p className="text-sm text-tertiary">Нийтлэл засах, нуух, AI-аар дахин шинжлэх, санхүүгийн тайлан бүртгэх.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/filter" className="rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover">
            🧠 Тархи угаалтын шүүлтүүр
          </Link>
          <form action={logout}>
            <button className="rounded-lg px-4 py-2.5 text-sm font-semibold text-secondary ring-1 ring-primary ring-inset hover:bg-primary_hover">Гарах</button>
          </form>
        </div>
      </header>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-primary ring-1 ring-secondary ring-inset" />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
