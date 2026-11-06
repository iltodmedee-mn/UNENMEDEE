"use client";

import { Mail01 } from "@untitledui/icons";
import { useId, useState } from "react";

import { CopyText } from "@/components/iltod/copy-text";
import { addWorkingDays, ANSWER_DAYS, buildLetter, DELIVERY_LABEL, type DeliveryForm, EXTENSION_DAYS, letterDate, missingFields, type RequestInput } from "@/lib/info-request";

const FIELD = "w-full rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary ring-1 ring-line-strong outline-none ring-inset focus:ring-2 focus:ring-brand";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-primary">{label}</span>
      {children}
      {hint && <span className="text-xs text-tertiary">{hint}</span>}
    </label>
  );
}

/**
 * /request: builds the letter in the browser. Nothing typed here is sent anywhere; the reader
 * copies the letter or opens it in their own mail app. `day` = today in Ulaanbaatar (the page's
 * cached clock), so prerendered HTML never reads the clock.
 */
export function InfoRequestForm({ orgs, day }: { orgs: string[]; day: string }) {
  const listId = useId();
  const [r, setR] = useState<RequestInput>({ org: "", name: "", address: "", phone: "", email: "", question: "", form: "electronic", date: day });
  const set = <K extends keyof RequestInput>(k: K) => (v: RequestInput[K]) => setR((prev) => ({ ...prev, [k]: v }));
  const letter = buildLetter(r);
  const missing = missingFields(r);
  const mailto = `mailto:?subject=${encodeURIComponent("Мэдээлэл хүсэх тухай")}&body=${encodeURIComponent(letter)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Хэнээс асуух вэ" hint="Яам, агентлаг, аймаг, дүүрэг, сургууль… Жагсаалтаас сонгох эсвэл өөрөө бичнэ.">
            <input className={FIELD} list={listId} value={r.org} onChange={(e) => set("org")(e.target.value)} placeholder="Жишээ нь: Сангийн яам" autoComplete="off" />
          </Field>
          <datalist id={listId}>
            {orgs.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <Field label="Ямар мэдээлэл хүсэх вэ" hint="Тодорхой бичих тусам хариу хурдан ирнэ: юуны, аль оны, ямар баримт.">
            <textarea
              className={`${FIELD} min-h-32`}
              value={r.question}
              onChange={(e) => set("question")(e.target.value)}
              placeholder="Жишээ нь: 2026 онд манай сумын сургуулийн засварт зарцуулсан төсөв, гүйцэтгэгч компанийн нэр, гэрээний хуулбар"
            />
          </Field>
        </div>
        <Field label="Таны нэр">
          <input className={FIELD} value={r.name} onChange={(e) => set("name")(e.target.value)} placeholder="Б.Болд" autoComplete="name" />
        </Field>
        <Field label="Утас">
          <input className={FIELD} value={r.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="9911 2233" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field label="Цахим шуудан">
          <input className={FIELD} value={r.email} onChange={(e) => set("email")(e.target.value)} placeholder="ner@gmail.com" inputMode="email" autoComplete="email" />
        </Field>
        <Field label="Хаяг" hint="Цаасаар авах бол заавал.">
          <input className={FIELD} value={r.address} onChange={(e) => set("address")(e.target.value)} placeholder="Дүүрэг, хороо, байр" autoComplete="street-address" />
        </Field>
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1.5 text-sm font-semibold text-primary">Хэрхэн авах вэ</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DELIVERY_LABEL) as DeliveryForm[]).map((f) => (
              <label key={f} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-secondary ring-1 ring-line ring-inset has-checked:bg-secondary has-checked:text-primary has-checked:ring-brand">
                <input type="radio" name="form" value={f} checked={r.form === f} onChange={() => set("form")(f)} className="accent-brand-600" />
                {f === "electronic" ? "Цахимаар (үнэгүй)" : f === "paper" ? "Цаасаар" : "Биечлэн танилцах"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <section aria-labelledby="letter-heading" className="flex flex-col gap-3 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="letter-heading" className="label-mono text-tertiary">
            Таны захидал
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            <CopyText text={letter} label="Хуулах" />
            <a href={mailto} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-brand-secondary hover:bg-primary_hover">
              <Mail01 className="size-3.5" aria-hidden />
              Имэйлээр илгээх
            </a>
          </div>
        </div>
        {missing.length > 0 && <p className="text-sm text-tertiary">Дутуу: {missing.join(", ")}.</p>}
        <pre className="overflow-x-auto rounded-xl bg-secondary p-4 font-sans text-sm leading-relaxed whitespace-pre-wrap text-primary ring-1 ring-line ring-inset">{letter}</pre>
        <p className="text-sm text-secondary">
          Өнөөдөр ({letterDate(r.date)}) хүргүүлбэл хуулиар хариу өгөх хугацаа: <b className="num-mono">{addWorkingDays(r.date, ANSWER_DAYS)}</b> хүртэл (ажлын {ANSWER_DAYS} өдөр). Албан тушаалтан сунгавал{" "}
          <span className="num-mono">{addWorkingDays(r.date, ANSWER_DAYS + EXTENSION_DAYS)}</span> хүртэл. Баярын өдрийг тооцоогүй.
        </p>
      </section>
    </div>
  );
}
