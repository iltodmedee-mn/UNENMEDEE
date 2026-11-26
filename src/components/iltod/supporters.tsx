import Link from "next/link";

import {
  ANON_MAX_MNT,
  ANONYMOUS_LABEL,
  daysInMonth,
  type DonationDay,
  type DonationsSummary,
} from "@/lib/donations";
import { formatMntShort, formatNumber } from "@/lib/format";
import { cx } from "@/utils/cx";

/** Newest donations shown as cells; the rest are in the list under "Бүх хандив". */
export const RECENT = 6;

/** One square per donation, stacked per day: a single SVG, so 600 donations are one element. */
const CELL = 10;
const SQUARE = 8;

const monthLabel = (month: string) => `${Number(month.slice(5, 7))}-р сар`;

/** The month's donations by day as stacked squares; hollow squares are anonymous gifts. */
export function DayTicks({
  month,
  days,
}: {
  month: string;
  days: DonationDay[];
}) {
  const n = daysInMonth(month);
  const tallest = Math.max(3, ...days.map((d) => d.named + d.anonymous));
  const width = n * CELL;
  const height = tallest * CELL;
  const squares: React.ReactNode[] = [];
  for (const d of days) {
    const x = (d.day - 1) * CELL + 1;
    for (let k = 0; k < d.named + d.anonymous; k++) {
      const y = height - (k + 1) * CELL + 1;
      const anonymous = k >= d.named;
      squares.push(
        anonymous ? (
          <rect
            key={`${d.day}-${k}`}
            x={x + 0.5}
            y={y + 0.5}
            width={SQUARE - 1}
            height={SQUARE - 1}
            rx={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        ) : (
          <rect
            key={`${d.day}-${k}`}
            x={x}
            y={y}
            width={SQUARE}
            height={SQUARE}
            rx={1}
            fill="currentColor"
          />
        ),
      );
    }
  }
  const ticks = [1, 10, 20, n];
  const total = days.reduce((a, d) => a + d.named + d.anonymous, 0);
  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full border-b border-line text-fg-brand-primary"
        style={{ aspectRatio: `${width} / ${height}` }}
        role="img"
        aria-label={`${monthLabel(month)}: ${total} хандив, өдөр бүрээр`}
      >
        {squares}
      </svg>
      <div className="num-mono relative h-4 text-xs text-tertiary" aria-hidden>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${((t - 0.5) / n) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Cell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex min-w-0 flex-col gap-1 border-t border-line py-3",
        className,
      )}
    >
      <p className="label-mono truncate text-tertiary">{label}</p>
      <p className="num-mono text-xl text-primary">{value}</p>
      {sub && <p className="text-xs text-tertiary">{sub}</p>}
    </div>
  );
}

/**
 * "Энэ сайтыг дэмждэг хүмүүс" on /transparency (Nov 2026, the owner's pick from mockups in the
 * Ledger style): totals, the newest gifts as cells, this month by day, the two months before, and
 * every gift in a list. In the order received, never ranked by amount. A note shows only once the
 * owner has cleared it (`notePublic`). Server markup, no client JS.
 */
export function Supporters({ gifts }: { gifts: DonationsSummary }) {
  const recent = gifts.rows.slice(0, RECENT);
  const tickTotal = gifts.days.reduce((a, d) => a + d.named + d.anonymous, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 border-b border-line">
        <Cell
          label={monthLabel(gifts.month)}
          value={`${formatMntShort(gifts.monthMnt)}`}
          sub={`${formatNumber(gifts.monthCount)} хандив`}
          className="pr-3"
        />
        <Cell
          label="Нийт"
          value={`${formatMntShort(gifts.totalMnt)}`}
          sub={`${formatNumber(gifts.count)} хандив`}
          className="border-l pl-3"
        />
      </div>

      {recent.length > 0 ? (
        <div>
          <p className="label-mono mb-2 text-tertiary">Сүүлд ирсэн</p>
          <ol className="grid grid-cols-3 border-b border-line">
            {recent.map((d, i) => (
              <li
                key={d.id}
                className={cx(
                  "flex min-w-0 flex-col gap-0.5 border-t border-line py-3",
                  i % 3 ? "border-l pl-3" : "pr-3",
                )}
              >
                <span
                  className={cx(
                    "num-mono text-lg break-words",
                    d.donor ? "text-primary" : "text-tertiary",
                  )}
                >
                  {d.donor ?? "нууц"}
                  {d.id === gifts.firstId && (
                    <span
                      className="label-mono ml-2 rounded bg-signal px-1 align-middle text-[10px] text-signal-ink"
                      title="Анхны хандив"
                    >
                      №1
                    </span>
                  )}
                </span>
                <span className="num-mono text-sm font-semibold text-primary">
                  {formatNumber(d.amountMnt)} ₮
                </span>
                <span className="label-mono text-tertiary">
                  {d.receivedOn.slice(5)}
                </span>
                {d.note && d.notePublic && (
                  <span className="text-xs break-words text-tertiary">
                    «{d.note}»
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-tertiary">
          Хандив хараахан бүртгэгдээгүй байна.
        </p>
      )}

      {tickTotal > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="label-mono text-tertiary">
              {monthLabel(gifts.month)} · өдөр бүрийн хандив
            </p>
            <p className="text-xs text-tertiary">■ = 1 хандив</p>
          </div>
          <DayTicks month={gifts.month} days={gifts.days} />
          <p className="mt-1 text-xs text-tertiary">
            Хөндий дөрвөлжин нь нэрээ нууцалсан хандив.
          </p>
        </div>
      )}

      {gifts.months.length > 0 && (
        <div className="grid grid-cols-2 border-b border-line">
          {gifts.months.map((m, i) => (
            <Cell
              key={m.month}
              label={monthLabel(m.month)}
              value={formatMntShort(m.totalMnt)}
              sub={`${formatNumber(m.count)} хандив`}
              className={i ? "border-l pl-3" : "pr-3"}
            />
          ))}
        </div>
      )}

      {gifts.rows.length > RECENT && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-tertiary">
            Сүүлийн {gifts.rows.length} хандив жагсаалтаар
          </summary>
          <ol className="mt-2 flex flex-col divide-y divide-line-soft border-y border-line">
            {gifts.rows.map((d) => (
              <li
                key={d.id}
                className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 py-2.5 text-sm"
              >
                <span className="num-mono text-xs text-tertiary">
                  {d.receivedOn}
                </span>
                <span className="min-w-0">
                  <span
                    className={
                      d.donor ? "font-medium text-primary" : "text-tertiary"
                    }
                  >
                    {d.donor ?? ANONYMOUS_LABEL}
                  </span>
                  {d.note && d.notePublic && (
                    <span className="block text-xs break-words text-tertiary">
                      «{d.note}»
                    </span>
                  )}
                </span>
                <span className="num-mono font-semibold text-primary">
                  {formatNumber(d.amountMnt)} ₮
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {gifts.count > gifts.rows.length && (
        <p className="text-xs text-tertiary">
          Сүүлийн {gifts.rows.length} хандивыг жагсаав; нийт дүнд бүгд орсон.
        </p>
      )}

      <p className="text-sm text-secondary">
        Баярлалаа! Дэмжих бол{" "}
        <Link
          href="/support"
          prefetch={false}
          className="font-semibold text-brand-secondary hover:underline"
        >
          хандивын данс →
        </Link>
      </p>
    </div>
  );
}

/** The panel's description: how names, notes and large gifts are published. */
export const SUPPORTERS_RULES = `Ирсэн дарааллаар нь, дүнгээр эрэмбэлэхгүй. Нэрийг товчилж (Б.Б.) бичнэ; гүйлгээний утгад «нэрээр» гэвэл бүтэн нэрээр, «нууц» гэвэл нэргүй гаргана. ${formatNumber(ANON_MAX_MNT)} ₮-өөс их хандивыг зөвхөн бүтэн нэрээр хүлээн авна. Гүйлгээний утгыг уншиж шалгасны дараа гаргана.`;
