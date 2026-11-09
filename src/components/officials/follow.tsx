"use client";

import { Star01 } from "@untitledui/icons";
import Link from "next/link";
import { useEffect, useMemo } from "react";

import { setFollows } from "@/app/push-actions";
import { usePwa } from "@/components/pwa/use-pwa";
import { useLocalStorage } from "@/lib/local-store";
import { AREA_KEY, FOLLOW_KEY, MAX_FOLLOWS, parseFollows } from "@/lib/officials/follow";
import { PLACES, placeMatchesConstituency } from "@/lib/places";
import type { PoliticianSummary } from "@/lib/queries";
import { cx } from "@/utils/cx";
import { MpPhoto } from "@/components/officials/mp-photo";

/** Followed MP ids in localStorage; mirrored to the push subscription when there is one. */
function useFollows() {
  const [raw, setRaw] = useLocalStorage(FOLLOW_KEY, "[]");
  const follows = useMemo(() => parseFollows(raw), [raw]);
  const toggle = (id: number) => setRaw(JSON.stringify(follows.includes(id) ? follows.filter((x) => x !== id) : [...follows, id].slice(-MAX_FOLLOWS)));
  return { follows, toggle, setAll: (ids: number[]) => setRaw(JSON.stringify([...new Set([...follows, ...ids])].slice(-MAX_FOLLOWS))) };
}

function useSyncFollows(follows: number[]) {
  const { endpoint } = usePwa();
  useEffect(() => {
    if (endpoint) setFollows(endpoint, follows).catch(() => {});
  }, [endpoint, follows]);
}

function AlertCta({ count }: { count: number }) {
  const { pushSupported, needsInstallForPush, subscribed, enablePush, busy, error } = usePwa();
  if (!count) return null;
  if (subscribed) return <p className="text-sm text-success-primary">🔔 Дагасан {count} гишүүн тань мэдээнд гарахад мэдэгдэл ирнэ.</p>;
  // iOS Safari has no PushManager outside a home-screen app, so explain that before giving up.
  if (needsInstallForPush) return <p className="text-sm text-tertiary">🔔 iPhone дээр мэдэгдэл авахын тулд эхлээд сайтыг &quot;Add to Home Screen&quot;-ээр нэмнэ үү.</p>;
  if (!pushSupported) return null;
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={enablePush} disabled={busy} className="w-fit rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-bg-primary transition hover:opacity-90 disabled:opacity-60">
        🔔 Мэдээнд гарахад мэдэгдэл авах
      </button>
      {error && <p className="text-xs text-error-primary">{error}</p>}
    </div>
  );
}

export function FollowToggle({ id, name, className }: { id: number; name: string; className?: string }) {
  const { follows, toggle } = useFollows();
  useSyncFollows(follows);
  const on = follows.includes(id);
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-pressed={on}
      aria-label={on ? `${name}: дагахаа болих` : `${name}: дагах`}
      className={cx(
        "flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-inset transition",
        on ? "bg-signal-soft text-primary ring-signal" : "text-secondary ring-line hover:bg-primary_hover hover:text-primary",
        className,
      )}
    >
      <Star01 className={cx("size-4", on && "fill-current")} aria-hidden />
      {on ? "Дагаж байна" : "Дагах"}
    </button>
  );
}

/** "Миний гишүүн": pick your aimag/district, see and follow the MPs elected there. */
export function MyMps({ people }: { people: PoliticianSummary[] }) {
  // The places of /place (21 aimags, the capital, its 9 districts) that elect at least one member,
  // matched like the place pages (placeMatchesConstituency): the bare constituency words made
  // "Сүхбаатар" one option for both the aimag and the district, listing both areas' members.
  const places = useMemo(() => PLACES.filter((pl) => people.some((p) => placeMatchesConstituency(pl, p.constituency))), [people]);
  const [stored, setArea] = useLocalStorage(AREA_KEY, "");
  // Older choices were the bare area word: read it as that place's slug (aimag first).
  const place = places.find((pl) => pl.slug === stored) ?? places.find((pl) => pl.name === stored);
  const area = place?.slug ?? "";
  const { follows, toggle, setAll } = useFollows();
  useSyncFollows(follows);
  const mine = place ? people.filter((p) => placeMatchesConstituency(place, p.constituency)) : [];
  const followed = people.filter((p) => follows.includes(p.id));
  const listOnly = people.filter((p) => !p.constituency).length;

  return (
    <section aria-labelledby="my-mps" className="flex flex-col gap-4 rounded-3xl bg-primary p-5 ring-1 ring-line ring-inset md:p-6">
      <header className="flex flex-col gap-1">
        <h2 id="my-mps" className="text-lg font-semibold text-primary">
          ⭐ Миний гишүүн
        </h2>
        <p className="text-sm text-tertiary">Аймаг, дүүргээ сонгоод тойргийнхоо гишүүдийг дагаарай. Тэд мэдээнд гарахад мэдэгдэл авна.</p>
      </header>
      <label className="flex flex-col gap-1.5 sm:max-w-xs">
        <span className="text-sm font-semibold text-primary">Би амьдардаг:</span>
        <select value={area} onChange={(e) => setArea(e.target.value)} className="rounded-lg bg-primary px-3 py-2.5 text-md text-primary ring-1 ring-line-strong ring-inset">
          <option value="">— аймаг, дүүрэг сонгох —</option>
          {places.map((pl) => (
            <option key={pl.slug} value={pl.slug}>
              {pl.name}
              {pl.kind === "district" ? " дүүрэг" : pl.kind === "aimag" ? " аймаг" : ""}
            </option>
          ))}
        </select>
      </label>
      {mine.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-3 rounded-2xl bg-secondary p-3">
                {p.photoUrl && <MpPhoto src={p.photoUrl} size={48} className="size-12 shrink-0 rounded-full object-cover" />}
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/officials/${p.id}`} prefetch={false} className="truncate font-semibold text-primary hover:underline">
                    {p.fullName}
                  </Link>
                  <span className="truncate text-xs text-tertiary">{p.party ?? "—"}</span>
                </div>
                <FollowToggleInline on={follows.includes(p.id)} onClick={() => toggle(p.id)} name={p.fullName} />
              </li>
            ))}
          </ul>
          {mine.some((p) => !follows.includes(p.id)) && (
            <button type="button" onClick={() => setAll(mine.map((p) => p.id))} className="w-fit text-sm font-semibold text-brand-secondary hover:underline">
              Тойргийнхоо бүх гишүүнийг дагах
            </button>
          )}
        </>
      )}
      {followed.length > 0 && (
        <p className="text-sm text-secondary">
          Дагаж буй: {followed.map((p) => p.shortName).join(", ")}
        </p>
      )}
      <AlertCta count={followed.length} />
      <p className="text-xs text-tertiary">Намын жагсаалтаар сонгогдсон {listOnly} гишүүн тойрог төлөөлдөггүй: тэднийг өөрийнх нь хуудаснаас дагаж болно. Сонголт тань энэ төхөөрөмжид хадгалагдана; мэдэгдэл асаасан бол зөвхөн мэдэгдэл илгээхэд ашиглагдана.</p>
    </section>
  );
}

function FollowToggleInline({ on, onClick, name }: { on: boolean; onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? `${name}: дагахаа болих` : `${name}: дагах`}
      className={cx("grid size-10 shrink-0 place-items-center rounded-full transition", on ? "text-primary" : "text-quaternary hover:text-secondary")}
    >
      <Star01 className={cx("size-5", on && "fill-current")} aria-hidden />
    </button>
  );
}
