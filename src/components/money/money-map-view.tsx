"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";

import { formatMntShort } from "@/lib/format";
import { type Category, CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, CATEGORY_SVG } from "@/lib/money-map/categories";
import type { MoneyAimag, MoneyItems, MoneyMap, MoneyPoint } from "@/lib/money-map/build";

/**
 * The «Миний ₮» map. Speed first (the owner, Nov 2026): MapLibre (~200 KB) is imported only here,
 * after the page renders; tiles come from OpenFreeMap's CDN to the reader; the circles, icons and
 * labels are three WebGL layers per level (no DOM markers), and MapLibre itself keeps labels from
 * overlapping. Country view: one circle per aimag (size = money, icon = what most of it bought); a
 * tap zooms to that aimag's sums. A sum's lots come from /money/items (one CDN-cached request).
 */
const STYLE = { light: "https://tiles.openfreemap.org/styles/liberty", dark: "https://tiles.openfreemap.org/styles/dark" };
const MONGOLIA: [number, number, number, number] = [87.7, 41.5, 119.9, 52.2];
/** Below this zoom the map shows aimags, from it the sums and districts. */
const SUM_ZOOM = 5.4;

function Icon({ cat, className = "size-4" }: { cat: Category; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={CATEGORY_COLOR[cat]}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      // Constant icon paths from categories.ts (the site's own topic icons), never user text.
      dangerouslySetInnerHTML={{ __html: CATEGORY_SVG[cat] }}
    />
  );
}

const radius = (mnt: number, max: number, lo: number, hi: number) => Math.round(lo + (hi - lo) * Math.sqrt(mnt / Math.max(max, 1)));

type Picked = { kind: "aimag"; a: MoneyAimag } | { kind: "point"; p: MoneyPoint } | null;

export function MoneyMapView({ map }: { map: MoneyMap }) {
  const box = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const [picked, setPicked] = useState<Picked>(null);
  const [items, setItems] = useState<MoneyItems | null>(null);
  const [failed, setFailed] = useState(false);

  // A sum's lots: one request, the first time any point is picked.
  useEffect(() => {
    if (picked?.kind !== "point" || items) return;
    let gone = false;
    fetch("/money/items")
      .then((r) => (r.ok ? r.json() : {}))
      .then((v: MoneyItems) => !gone && setItems(v))
      .catch(() => !gone && setItems({}));
    return () => {
      gone = true;
    };
  }, [picked, items]);

  useEffect(() => {
    let gone = false;
    let instance: { remove(): void } | null = null;
    import("maplibre-gl")
      .then(async (ml) => {
        if (gone || !box.current) return;
        ml.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
        const cl = document.documentElement.classList;
        const dark = cl.contains("dark-mode") || (!cl.contains("light-mode") && window.matchMedia("(prefers-color-scheme: dark)").matches);
        const m = new ml.Map({ container: box.current, style: dark ? STYLE.dark : STYLE.light, bounds: MONGOLIA, fitBoundsOptions: { padding: 12 }, attributionControl: false, cooperativeGestures: true });
        instance = m;
        m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        reset.current = () => {
          m.fitBounds(MONGOLIA, { padding: 12 });
          setPicked(null);
        };
        await m.once("load");
        if (gone) return;
        for (const l of m.getStyle().layers) {
          if (l.type === "symbol" && l.layout?.["text-field"]) m.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:mn"], ["get", "name"]]);
        }
        // The six category icons, drawn dark on the coloured circles.
        await Promise.all(
          CATEGORIES.map(async (c) => {
            const img = new Image(48, 48);
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#0f1012" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${CATEGORY_SVG[c]}</svg>`)}`;
            await img.decode();
            if (!m.hasImage(`cat-${c}`)) m.addImage(`cat-${c}`, img, { pixelRatio: 2 });
          }),
        );
        if (gone) return;
        const maxA = map.aimags[0]?.mnt ?? 1;
        const maxP = map.points[0]?.mnt ?? 1;
        const fc = (rows: { id: string; name: string; lon: number; lat: number; mnt: number; cat: Category; r: number }[]) => ({
          type: "FeatureCollection" as const,
          features: rows.map((r) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] }, properties: { id: r.id, name: r.name, amount: formatMntShort(r.mnt), cat: r.cat, color: CATEGORY_COLOR[r.cat], r: r.r } })),
        });
        m.addSource("aimags", { type: "geojson", data: fc(map.aimags.map((a) => ({ id: a.aimag, name: a.aimag, lon: a.lon, lat: a.lat, mnt: a.mnt, cat: a.cat, r: radius(a.mnt, maxA, 9, 24) }))) });
        m.addSource("points", { type: "geojson", data: fc(map.points.map((p) => ({ id: p.id, name: p.name, lon: p.lon, lat: p.lat, mnt: p.mnt, cat: p.cat, r: radius(p.mnt, maxP, 7, 22) }))) });
        const ink = dark ? "#f2f2ef" : "#141414";
        const halo = dark ? "#0f1012" : "#ffffff";
        for (const [src, zoom] of [
          ["aimags", { maxzoom: SUM_ZOOM }],
          ["points", { minzoom: SUM_ZOOM }],
        ] as const) {
          m.addLayer({ id: `${src}-circle`, type: "circle", source: src, ...zoom, paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-stroke-color": halo, "circle-stroke-width": 2 } });
          m.addLayer({ id: `${src}-icon`, type: "symbol", source: src, ...zoom, layout: { "icon-image": ["concat", "cat-", ["get", "cat"]], "icon-size": ["/", ["get", "r"], 13], "icon-allow-overlap": true, "icon-ignore-placement": true } });
          m.addLayer({
            id: `${src}-label`,
            type: "symbol",
            source: src,
            ...zoom,
            layout: {
              "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "amount"], { "font-scale": 0.85 }],
              "text-font": ["Noto Sans Bold"],
              "text-size": 12.5,
              "text-variable-anchor": ["left", "right", "top", "bottom"],
              "text-radial-offset": ["+", 0.6, ["/", ["get", "r"], 12.5]],
              "text-justify": "auto",
              "symbol-sort-key": ["-", 0, ["get", "r"]],
            },
            paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.6 },
          });
        }
        m.on("click", "aimags-circle", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          const a = map.aimags.find((x) => x.aimag === id);
          if (!a) return;
          setPicked({ kind: "aimag", a });
          const pts = map.points.filter((p) => p.aimag === a.aimag);
          const lons = pts.map((p) => p.lon);
          const lats = pts.map((p) => p.lat);
          const pad = 0.4;
          m.fitBounds([Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad], { padding: 40, maxZoom: 8, minZoom: SUM_ZOOM + 0.2 });
        });
        m.on("click", "points-circle", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          const p = map.points.find((x) => x.id === id);
          if (p) setPicked({ kind: "point", p });
        });
        for (const l of ["aimags-circle", "points-circle"]) {
          m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
        }
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      instance?.remove();
    };
  }, [map]);

  const lots = picked?.kind === "point" ? items?.[picked.p.id] : undefined;

  return (
    <section className="flex flex-col gap-3">
      <div ref={box} className="relative h-[28rem] overflow-hidden rounded-2xl bg-secondary ring-1 ring-line sm:h-[34rem]" role="region" aria-label="Төсвийн мөнгөний газрын зураг">
        {failed && <p className="p-4 text-sm text-secondary">Газрын зураг ачаалж чадсангүй. Доорх жагсаалтаас харна уу.</p>}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Тайлбар">
        {CATEGORIES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-sm text-secondary">
            <Icon cat={c} />
            {CATEGORY_LABEL[c]}
          </li>
        ))}
      </ul>
      <p className="label-mono text-tertiary">© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles · GeoNames</p>
      <div className="rounded-2xl bg-primary p-4 ring-1 ring-line" aria-live="polite">
        {!picked && <p className="text-sm text-secondary">Аймгаа товшвол сумдаар нь томруулна; сумаа товшвол тэнд байгуулсан гэрээнүүд энд гарна.</p>}
        {picked?.kind === "aimag" && (
          <>
            <p className="label-mono text-brand-secondary">{picked.a.aimag} · аймаг</p>
            <p className="mt-1 font-display text-2xl font-bold text-primary">
              {formatMntShort(picked.a.mnt)} <span className="text-base font-medium text-secondary">· {picked.a.count} гэрээ</span>
            </p>
            <ul className="mt-2 flex flex-col">
              {map.points
                .filter((p) => p.aimag === picked.a.aimag)
                .slice(0, 8)
                .map((p) => (
                  <li key={p.id} className="border-t border-line">
                    <button type="button" onClick={() => setPicked({ kind: "point", p })} className="flex w-full items-center gap-2.5 py-2.5 text-left">
                      <Icon cat={p.cat} className="size-5 shrink-0" />
                      <span className="font-semibold text-primary">{p.name}</span>
                      <span className="num-mono ml-auto text-sm text-primary">{formatMntShort(p.mnt)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
        {picked?.kind === "point" && (
          <>
            <p className="label-mono text-brand-secondary">
              {picked.p.name}
              {picked.p.kind === "centre" ? " · аймгийн төв (зөвхөн аймаг нь тодорхой)" : ` · ${picked.p.aimag}`}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-primary">
              {formatMntShort(picked.p.mnt)} <span className="text-base font-medium text-secondary">· {picked.p.count} гэрээ</span>
            </p>
            {!items && <div className="mt-3 h-24 animate-pulse rounded-xl bg-secondary" />}
            <ul className="mt-2 flex flex-col">
              {(lots ?? []).map((it, i) => (
                <li key={i} className="flex gap-3 border-t border-line py-2.5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                    <Icon cat={it.c} className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{it.t}</p>
                    <p className="label-mono mt-0.5 truncate text-tertiary">
                      {it.o}
                      {it.w ? ` → ${it.w}` : ""}
                      {it.d ? ` · ${it.d}` : ""}
                    </p>
                  </div>
                  <span className="num-mono ml-auto shrink-0 self-start rounded-md bg-signal px-2 py-0.5 text-sm text-signal-ink">{formatMntShort(it.m)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {picked && (
          <button type="button" onClick={() => reset.current()} className="mt-3 text-sm font-semibold text-brand-secondary hover:underline">
            ← Бүх Монгол
          </button>
        )}
      </div>
    </section>
  );
}
