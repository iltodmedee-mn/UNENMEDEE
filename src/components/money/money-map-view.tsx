"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";

import { formatMntShort } from "@/lib/format";
import type { MoneyMap, MoneyPoint } from "@/lib/money-map/build";

/**
 * The «Миний ₮» map (OpenFreeMap vector tiles of OpenStreetMap: free, no key, straight from their
 * CDN to the reader; nothing passes through our server or Supabase). MapLibre (~200 KB) loads only
 * on this page and only after it renders. Labels prefer the Mongolian name. A circle's size follows
 * the amount; a tap shows that place's biggest lots below the map.
 */
const STYLE = { light: "https://tiles.openfreemap.org/styles/liberty", dark: "https://tiles.openfreemap.org/styles/dark" };

export function MoneyMapView({ map }: { map: MoneyMap }) {
  const box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<MoneyPoint | null>(map.points[0] ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    let instance: { remove(): void } | null = null;
    import("maplibre-gl")
      .then((ml) => {
        if (gone || !box.current) return;
        // MapLibre 6 loads its worker by URL; scripts/copy-map-worker.mjs puts it in public/.
        ml.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
        const cl = document.documentElement.classList;
        const dark = cl.contains("dark-mode") || (!cl.contains("light-mode") && window.matchMedia("(prefers-color-scheme: dark)").matches);
        const m = new ml.Map({ container: box.current, style: dark ? STYLE.dark : STYLE.light, bounds: [87.7, 41.5, 119.9, 52.2], fitBoundsOptions: { padding: 8 }, attributionControl: false, cooperativeGestures: true });
        instance = m;
        m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        m.on("load", () => {
          for (const l of m.getStyle().layers) {
            if (l.type === "symbol" && l.layout?.["text-field"]) m.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:mn"], ["get", "name"]]);
          }
          const max = Math.max(...map.points.map((p) => p.mnt), 1);
          map.points.forEach((p, i) => {
            const el = document.createElement("button");
            const size = Math.round(14 + 30 * Math.sqrt(p.mnt / max));
            el.type = "button";
            el.title = `${p.name}: ${formatMntShort(p.mnt)}`;
            el.setAttribute("aria-label", el.title);
            el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:rgb(255 209 102 / .85);border:2px solid #1a1500;cursor:pointer`;
            el.addEventListener("click", () => setPicked(map.points[i]));
            new ml.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(m);
          });
        });
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      instance?.remove();
    };
  }, [map]);

  return (
    <section className="flex flex-col gap-4">
      <div ref={box} className="h-[26rem] overflow-hidden rounded-2xl bg-secondary ring-1 ring-line sm:h-[32rem]" role="region" aria-label="Төсвийн мөнгөний газрын зураг">
        {failed && <p className="p-4 text-sm text-secondary">Газрын зураг ачаалж чадсангүй. Доорх жагсаалтаас харна уу.</p>}
      </div>
      <p className="label-mono -mt-2 text-tertiary">© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles · GeoNames</p>
      {picked && (
        <div className="rounded-2xl bg-primary p-4 ring-1 ring-line" aria-live="polite">
          <p className="label-mono text-brand-secondary">
            {picked.name}
            {picked.kind === "centre" ? " · аймгийн төв (зөвхөн аймаг нь тодорхой)" : ` · ${picked.aimag}`}
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-primary">
            {formatMntShort(picked.mnt)} <span className="text-base font-medium text-secondary">· {picked.count} гэрээ</span>
          </p>
          <ul className="mt-3 flex flex-col">
            {picked.items.map((it, i) => (
              <li key={i} className="flex gap-3 border-t border-line py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{it.title}</p>
                  <p className="label-mono mt-0.5 truncate text-tertiary">
                    {it.org}
                    {it.winner ? ` → ${it.winner}` : ""}
                    {it.date ? ` · ${it.date}` : ""}
                  </p>
                </div>
                <span className="num-mono ml-auto shrink-0 self-start rounded-md bg-signal px-2 py-0.5 text-sm text-signal-ink">{formatMntShort(it.mnt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
