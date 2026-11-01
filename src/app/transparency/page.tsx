import { CpuChip01, Database01, Server03, ShieldTick } from "@untitledui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DailySpendChart, LedgerChart } from "@/components/iltod/charts";
import { PageHeader } from "@/components/iltod/page-header";
import { budgetConfig } from "@/lib/ai/limits";
import { getPrice } from "@/lib/ai/pricing";
import { formatNumber, formatUsd } from "@/lib/format";
import { ANONYMOUS_LABEL, type DonationsSummary } from "@/lib/donations";
import { getDonations, getSiteStats, getTransparency } from "@/lib/queries";
import { LOG_KEEP_MONTHS } from "@/lib/retention";
import { REPO_URL } from "@/lib/site";
import type { AIProvider } from "@/lib/types";

export const metadata: Metadata = {
  title: "Ил тод байдлын тайлан — зардал, орлого",
  alternates: { canonical: "/transparency" },
  description: "Серверийн зардал, AI токен бүрийн зардал, зар сурталчилгаа, хандивын орлогыг шууд мэдээллийн сангаас харуулна.",
};

function Tile({ icon: Icon, label, value, hint }: { icon: typeof Server03; label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line-soft py-3">
      <div className="label-mono flex items-center gap-2 text-tertiary">
        <Icon className="size-4 text-fg-brand-primary" /> {label}
      </div>
      <p className="num-mono text-2xl text-primary">{value}</p>
      <p className="text-xs text-tertiary">{hint}</p>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-4">
      <div>
        <h2 className="label-mono text-tertiary">{title}</h2>
        {description && <p className="mt-1 text-sm text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "DeepSeek (Tier 1)",
  grok: "xAI Grok (Tier 2)",
  gemini: "Google Gemini · хамгийн хямд загвар (төлбөртэй)",
  nvidia: "NVIDIA NIM · Gemma (үнэгүй)",
  groq: "Groq · Qwen (үнэгүй)",
  requesty: "Requesty · Gemma (үнэгүй загвар)",
  mistral: "Mistral AI (үнэгүй багц)",
  openrouter: "OpenRouter · үнэгүй загварууд",
  zai: "Z.ai · GLM Flash (үнэгүй)",
  ollama: "Ollama (локал, 0$)",
  elevenlabs: "ElevenLabs · видеоны дуу (сарын багц)",
};

/** Legend names in the daily chart. */
const PROVIDER_SHORT: Record<string, string> = {
  deepseek: "DeepSeek",
  grok: "Grok",
  gemini: "Gemini",
  requesty: "Requesty",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  zai: "Z.ai",
  nvidia: "NVIDIA",
  groq: "Groq",
  ollama: "Ollama",
  elevenlabs: "ElevenLabs",
};

/** Every donation as it reached the account: day, name as the donor allowed, amount. */
function Donations({ gifts }: { gifts: DonationsSummary }) {
  return (
    <Panel
      title="Ирсэн хандив"
      description="Дансанд орсон хандив бүрийг өдөр, дүнгээр нь энд бүртгэдэг. Нэрийг товчилж (Б.Б.) бичнэ; гүйлгээний утгад «нэрээр» гэвэл бүтэн нэрээр, «нууц» гэвэл нэргүй гаргана."
    >
      <div className="grid grid-cols-2 gap-x-6 sm:max-w-md">
        <div className="flex flex-col gap-1 border-t border-line-soft py-3">
          <span className="label-mono text-tertiary">Энэ сард</span>
          <span className="num-mono text-2xl text-primary">{formatNumber(gifts.monthMnt)} ₮</span>
        </div>
        <div className="flex flex-col gap-1 border-t border-line-soft py-3">
          <span className="label-mono text-tertiary">Нийт · {formatNumber(gifts.count)} хандив</span>
          <span className="num-mono text-2xl text-primary">{formatNumber(gifts.totalMnt)} ₮</span>
        </div>
      </div>
      {gifts.rows.length ? (
        <ol className="flex flex-col divide-y divide-line-soft border-y border-line">
          {gifts.rows.map((d) => (
            <li key={d.id} className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 py-2.5 text-sm">
              <span className="num-mono text-xs text-tertiary">{d.receivedOn}</span>
              <span className="min-w-0">
                <span className={d.donor ? "font-medium text-primary" : "text-tertiary"}>{d.donor ?? ANONYMOUS_LABEL}</span>
                {d.note && <span className="block text-xs break-words text-tertiary">«{d.note}»</span>}
              </span>
              <span className="num-mono font-semibold text-primary">{formatNumber(d.amountMnt)} ₮</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-tertiary">Хандив хараахан бүртгэгдээгүй байна.</p>
      )}
      {gifts.count > gifts.rows.length && <p className="text-xs text-tertiary">Сүүлийн {gifts.rows.length} хандивыг харуулав; нийт дүнд бүгд орсон.</p>}
      <p className="text-sm text-secondary">
        Баярлалаа! Дэмжих бол{" "}
        <Link href="/support" prefetch={false} className="font-semibold text-brand-secondary hover:underline">
          хандивын данс →
        </Link>
      </p>
    </Panel>
  );
}

async function Dashboard() {
  const [data, stats, gifts] = await Promise.all([getTransparency(), getSiteStats(), getDonations(50)]);
  const limits = budgetConfig();
  const ledgerRows = [...data.ledger].reverse().map((l) => ({
    month: l.month,
    expenses: l.infraCostUsd + l.aiCostUsd,
    // Nobody entered this month's income: no bar (the table says "бүртгээгүй"), never a $0 bar.
    income: l.adRevenueUsd === null && l.donationsUsd === null ? null : (l.adRevenueUsd ?? 0) + (l.donationsUsd ?? 0),
  }));
  const paidSeries = data.paidProviders.map((key) => ({ key, name: PROVIDER_SHORT[key] ?? key }));
  const paidNames = paidSeries.map((s) => s.name).join(", ");
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={Server03} label="Серверийн зардал" value="$0.00" hint="Vercel Hobby + Supabase Free + үнэгүй автомат ажлын сервер" />
        <Tile icon={CpuChip01} label="Нийт AI зардал" value={formatUsd(data.totals.costUsd)} hint={`Сүүлийн ${LOG_KEEP_MONTHS} сард ${formatNumber(data.totals.calls)} дуудлага · ${formatNumber(data.totals.tokens)} токен`} />
        <Tile icon={Database01} label="Уншсан төрийн хуудас" value={formatNumber(stats.articles)} hint={`${formatNumber(stats.analyzed)} нь AI-аар шүүгдсэн`} />
        <Tile
          icon={ShieldTick}
          label="Энэ сарын AI зардал"
          value={formatUsd(stats.aiCostThisMonthUsd)}
          hint={`Хатуу хязгаар: сард ${formatUsd(limits.monthlyUsd)}, өдөрт ${formatUsd(limits.dailyUsd)}. Хэтэрвэл зөвхөн үнэгүй AI ажиллана.`}
        />
      </div>

      <Panel
        title="Өдөр бүрийн төлбөртэй AI зардал"
        description={`Сүүлийн 30 хоног, дуудлага бүрийн бодит үнээр${paidNames ? ` (${paidNames})` : ""}. Үнэгүй AI $0 тул графикт биш, доорх хүснэгтэд (сүүлийн ${LOG_KEEP_MONTHS} сар) харагдана.`}
      >
        {data.dailySpend.length ? (
          <DailySpendChart data={data.dailySpend} series={paidSeries} />
        ) : (
          <p className="text-sm text-tertiary">Сүүлийн 30 хоногт төлбөр гарсан AI дуудлага алга: бүгд үнэгүй үйлчилгээгээр хийгдсэн.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">AI үйлчилгээ үзүүлэгчээр задалсан зардал</caption>
            <thead className="border-b border-line text-xs text-tertiary">
              <tr>
                <th className="py-2 pr-4 font-semibold">Үйлчилгээ</th>
                <th className="py-2 pr-4 text-right font-semibold">Дуудлага</th>
                <th className="py-2 pr-4 text-right font-semibold">Оролтын токен</th>
                <th className="py-2 pr-4 text-right font-semibold">Гаралтын токен</th>
                <th className="py-2 pr-4 text-right font-semibold">Үнэ / 1M (оролт · гаралт)</th>
                <th className="py-2 text-right font-semibold">Зардал</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {data.byProvider.map((p) => {
                const price = getPrice(p.provider as AIProvider);
                return (
                  <tr key={p.provider}>
                    <td className="py-2 pr-4 font-medium text-primary">{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                    <td className="py-2 pr-4 text-right text-secondary tabular-nums">{formatNumber(p.calls)}</td>
                    <td className="py-2 pr-4 text-right text-secondary tabular-nums">{formatNumber(p.promptTokens)}</td>
                    <td className="py-2 pr-4 text-right text-secondary tabular-nums">{formatNumber(p.completionTokens)}</td>
                    <td className="py-2 pr-4 text-right text-tertiary tabular-nums">
                      ${price.input} · ${price.output}
                    </td>
                    <td className="py-2 text-right font-semibold text-primary tabular-nums">{formatUsd(p.costUsd, 4)}</td>
                  </tr>
                );
              })}
              {data.byProvider.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-tertiary">
                    Мэдээлэл алга.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Donations gifts={gifts} />

      <Panel title="Зардал ба орлого (сар бүр)" description="Зар сурталчилгаа, олон нийтийн хандивын орлогыг админ гараар бүртгэдэг. AI зардал автоматаар тооцогдоно.">
        {ledgerRows.length ? <LedgerChart data={ledgerRows} /> : <p className="text-sm text-tertiary">Санхүүгийн бүртгэл хараахан алга.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">Сар бүрийн санхүүгийн бүртгэл</caption>
            <thead className="border-b border-line text-xs text-tertiary">
              <tr>
                <th className="py-2 pr-4 font-semibold">Сар</th>
                <th className="py-2 pr-4 text-right font-semibold">Сервер</th>
                <th className="py-2 pr-4 text-right font-semibold">AI</th>
                <th className="py-2 pr-4 text-right font-semibold">Зар</th>
                <th className="py-2 pr-4 text-right font-semibold">Хандив</th>
                <th className="py-2 font-semibold">Тайлбар</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {data.ledger.map((l) => (
                <tr key={l.month}>
                  <td className="py-2 pr-4 font-medium text-primary">{l.month}</td>
                  <td className="py-2 pr-4 text-right text-secondary tabular-nums">{formatUsd(l.infraCostUsd)}</td>
                  <td className="py-2 pr-4 text-right text-secondary tabular-nums">{formatUsd(l.aiCostUsd, 4)}</td>
                  <td className="py-2 pr-4 text-right text-secondary tabular-nums">{l.adRevenueUsd === null ? <span className="text-tertiary">бүртгээгүй</span> : formatUsd(l.adRevenueUsd)}</td>
                  <td className="py-2 pr-4 text-right text-secondary tabular-nums">{l.donationsUsd === null ? <span className="text-tertiary">бүртгээгүй</span> : formatUsd(l.donationsUsd)}</td>
                  <td className="py-2 text-tertiary">{l.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Яаж шалгах вэ?">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-secondary">
          <li>AI дуудлага бүр (амжилттай эсвэл алдаатай) токены тоо, үнийн хамт <code>ai_usage_logs</code> хүснэгтэд бичигдэнэ.</li>
          <li>Зардлыг үйлчилгээ үзүүлэгч бүрийн албан ёсны үнээр (1 сая токен тутамд) тооцно; үнэгүй квотоор хийсэн дуудлага $0.</li>
          <li>Скрапер, AI pipeline цаг тутам автоматаар ажиллаж (GitHub Actions-ийн үнэгүй хуваарь ачааллаас болж заримдаа хойшилдог), ажил бүрийн бүртгэл GitHub Actions дээр нээлттэй хадгалагдана.</li>
          <li>
            Бүх код, AI-д өгдөг заавар нээлттэй:{" "}
            <a className="font-semibold text-brand-secondary hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>{" "}
            ·{" "}
            <Link className="font-semibold text-brand-secondary hover:underline" href="/method">
              Арга зүй
            </Link>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

export default function TransparencyPage() {
  return (
    <>
      <PageHeader
        eyebrow="📊 100% ил тод"
        title="Ил тод байдлын тайлан"
        description="Бид хэр их мөнгө зарцуулж, хаанаас орлого олж байгаагаа токен бүрийн нарийвчлалтай нийтэлдэг. Бүх тоо мэдээллийн сангаас шууд гарна."
      />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-primary ring-1 ring-line ring-inset" />}>
        <Dashboard />
      </Suspense>
    </>
  );
}
