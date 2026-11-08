import { LinkExternal01 } from "@untitledui/icons";

import { OUTLETS } from "@/lib/press/outlets";
import type { PressCoverage } from "@/lib/queries";
import { safeHttpUrl } from "@/lib/site";

import { Panel } from "./panel";

/**
 * "Хэвлэлд": which independent newsrooms wrote about the same story (headline + link only,
 * src/lib/press). With none, an important story a day old says so in neutral words: we read three
 * feeds, so it is "not found", never "ignored". Server markup.
 */
export function PressPanel({ press, blindspot }: { press: PressCoverage[]; blindspot: boolean }) {
  const outlets = OUTLETS.map((o) => o.domain).join(", ");
  if (press.length === 0 && !blindspot) return null;
  return (
    <Panel title="Хэвлэлд" note={`${outlets}-ийн гарчгаас`} id="press">
      {press.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line-soft">
          {press.map((p) => (
            <li key={p.url} className="py-2.5 first:pt-0 last:pb-0">
              <a href={safeHttpUrl(p.url)} target="_blank" rel="noreferrer nofollow" data-progress="press" className="group flex items-start gap-3">
                <span className="label-mono w-20 shrink-0 pt-[0.2em] text-tertiary">{p.outlet}</span>
                <span className="flex-1 text-md text-primary group-hover:text-brand-secondary group-hover:underline">{p.title}</span>
                <LinkExternal01 aria-hidden className="mt-1 size-3.5 shrink-0 text-fg-quaternary" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-secondary ring-1 ring-line-soft ring-inset">
          Бидний уншдаг {OUTLETS.length} хэвлэлд ({outlets}) энэ мэдээтэй ижил гарчиг олдсонгүй. Төрийн шийдвэр хэвлэлээр дамжаагүй байж болно, эсвэл
          өөр үгээр бичигдсэн байж болно.
        </p>
      )}
    </Panel>
  );
}
