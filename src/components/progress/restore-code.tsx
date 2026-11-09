"use client";

import { useState } from "react";

import { decodeProgress, encodeProgress } from "@/lib/progress-code";
import { parseProgress } from "@/lib/progress";
import { progressRaw, saveProgress } from "@/lib/progress-store";
import { formatNumber } from "@/lib/format";

/**
 * «Сэргээх код» on /amjilt: copy the whole progress as one code, or paste a code from another phone
 * to bring it here (src/lib/progress-code.ts). No account, no server: the reader keeps the code.
 */
export function RestoreCode() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [input, setInput] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const make = async () => {
    const text = await encodeProgress(parseProgress(progressRaw()));
    setCode(text);
    setNote(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const restore = async () => {
    const next = await decodeProgress(input);
    if (!next) return setNote("Код буруу эсвэл дутуу байна. Бүтнээр нь хуулж оруулаарай.");
    const now = parseProgress(progressRaw());
    if (now.xp > 0 && !window.confirm(`Энэ утасны одоогийн ахиц (${formatNumber(now.xp)} XP) кодын ахицаар (${formatNumber(next.xp)} XP) солигдоно. Үргэлжлүүлэх үү?`)) return;
    saveProgress(next);
    setInput("");
    setPasting(false);
    setNote(`Сэргээгдлээ ✓ ${formatNumber(next.xp)} XP, ${formatNumber(next.reads)} мэдээ`);
  };

  return (
    <section aria-labelledby="restore-heading" className="flex flex-col gap-3 border-t border-line pt-4">
      <h2 id="restore-heading" className="label-mono text-tertiary">
        Сэргээх код
      </h2>
      <p className="text-sm text-secondary">Утас эсвэл хөтөч солих үед ахицаа шилжүүлнэ. Кодоо өөртөө хадгалаарай, жишээ нь Messenger-ээр өөртөө илгээгээрэй.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={make} className="rounded-xl bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover">
          {copied ? "Хуулсан ✓" : "Кодоо хуулах"}
        </button>
        <button type="button" onClick={() => setPasting((v) => !v)} aria-expanded={pasting} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-secondary ring-1 ring-line ring-inset hover:bg-primary_hover">
          Код оруулах
        </button>
      </div>
      {code && (
        <textarea readOnly value={code} onFocus={(e) => e.currentTarget.select()} rows={3} aria-label="Таны сэргээх код" className="num-mono w-full resize-none rounded-xl bg-secondary p-3 text-xs break-all text-secondary ring-1 ring-line ring-inset" />
      )}
      {pasting && (
        <div className="flex flex-col gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="ILTOD1.…" aria-label="Сэргээх кодоо энд буулгана уу" className="num-mono w-full resize-none rounded-xl bg-primary p-3 text-xs break-all text-primary ring-1 ring-line ring-inset" />
          <button type="button" onClick={restore} disabled={!input.trim()} className="w-fit rounded-xl bg-brand-solid px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-solid_hover disabled:opacity-50">
            Сэргээх
          </button>
        </div>
      )}
      {note && (
        <p role="status" className="text-sm text-secondary">
          {note}
        </p>
      )}
    </section>
  );
}
