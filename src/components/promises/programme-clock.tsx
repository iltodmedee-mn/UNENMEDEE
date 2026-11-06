import { formatNumber } from "@/lib/format";
import { programmeClock, PROGRAMME_END } from "@/lib/promises/programme";

/**
 * How much of the programme's time has passed: a bar of days, never of goals. Server markup;
 * `today` comes from the page's daily cached clock.
 */
export function ProgrammeClock({ today, approved, compact = false }: { today: string; approved: string; compact?: boolean }) {
  const c = programmeClock(today, approved);
  return (
    <section aria-label="Хөтөлбөрийн хугацаа" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-secondary">
          {c.daysLeft > 0 ? (
            <>
              Хугацаа дуусахад <b className="num-mono text-primary">{formatNumber(c.daysLeft)}</b> өдөр үлдлээ ({PROGRAMME_END.slice(0, 4)} оны УИХ-ын сонгууль хүртэл)
            </>
          ) : (
            "Хөтөлбөрийн хугацаа дууссан"
          )}
        </p>
        <p className="label-mono text-tertiary">хугацааны {c.elapsedPct}% өнгөрсөн</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary ring-1 ring-line ring-inset" role="img" aria-label={`Хугацааны ${c.elapsedPct}% өнгөрсөн`}>
        <div className="h-full rounded-full bg-fg-quaternary" style={{ width: `${c.elapsedPct}%` }} />
      </div>
      {!compact && (
        <p className="text-xs text-tertiary">
          Энэ нь <b>хугацаа</b>, зорилтын биелэлт биш. 620 зорилтоос 619 нь өөрийн гэсэн огноогүй: бүгд хөтөлбөрийн хугацаанд хамаарна.
        </p>
      )}
    </section>
  );
}
