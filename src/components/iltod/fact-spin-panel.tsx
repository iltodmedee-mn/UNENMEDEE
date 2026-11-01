import { useId } from "react";

import { Panel } from "./panel";
import { SpinMeter } from "./spin-meter";

/**
 * "Баримт vs Пи-ар": the facts and the PR the AI separated, side by side on desktop and
 * switched with a segmented control on phones. CSS only (radio inputs + :has on their value),
 * no client JavaScript and no animation library: the article page used to ship `motion` for
 * this one toggle. Server markup; useId keeps the radio names unique.
 */
export function FactSpinPanel({ facts, spin, neutrality }: { facts: string[]; spin: string; neutrality: number | null }) {
  const id = useId();
  const tab = "cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold text-tertiary transition peer-checked:bg-primary peer-checked:text-primary peer-checked:ring-1 peer-checked:ring-line";
  return (
    <Panel title="Баримт vs пи-ар" note="AI-ийн үнэлгээ, буруутгал биш">
      <div className="group/fs flex flex-col gap-3">
        {/* Phones: one view at a time. The checked radio hides the other box through :has(). */}
        <div role="group" aria-label="Харах хэсэг" className="flex w-fit gap-1 rounded-lg bg-secondary p-1 md:hidden">
          <span className="contents">
            <input type="radio" name={id} id={`${id}f`} value="facts" defaultChecked className="peer sr-only" />
            <label htmlFor={`${id}f`} className={tab}>
              Баримт
            </label>
          </span>
          <span className="contents">
            <input type="radio" name={id} id={`${id}s`} value="spin" className="peer sr-only" />
            <label htmlFor={`${id}s`} className={tab}>
              Пи-ар
            </label>
          </span>
        </div>
        <div className="grid overflow-hidden rounded-2xl ring-1 ring-line ring-inset md:grid-cols-2">
          <div className="flex flex-col gap-2 p-4 max-md:group-has-[input[value=spin]:checked]/fs:hidden">
            <h3 className="label-mono flex items-center gap-2 text-brand-secondary">
              <span aria-hidden className="size-2 rounded-[2px] bg-brand-solid" /> Баримт
            </h3>
            {facts.length ? (
              <ul className="flex flex-col gap-1.5 text-sm text-secondary">
                {facts.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-[1px] bg-brand-solid" />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-tertiary">Шалгаж болох тодорхой баримт олдсонгүй.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-line p-4 max-md:border-t max-md:group-has-[input[value=facts]:checked]/fs:hidden md:border-l">
            <h3 className="label-mono flex items-center gap-2 text-warning-primary">
              <span aria-hidden className="size-2 rounded-[2px] bg-signal" /> Пи-ар, үнэлэмж
            </h3>
            {/* No text and no score: the model gave no assessment, so nothing is claimed either way. */}
            <p className="text-sm text-secondary">{spin || (neutrality === null ? "AI энэ мэдээнд пи-арын үнэлгээ өгөөгүй." : "Илэрхий пи-ар илрээгүй.")}</p>
          </div>
        </div>
        <SpinMeter neutrality={neutrality} size="md" />
      </div>
    </Panel>
  );
}
