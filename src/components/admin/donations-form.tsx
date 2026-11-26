"use client";

import { useActionState } from "react";

import { type ActionResult, addDonation } from "@/app/admin/actions";
import { ANON_MAX_MNT, DONOR_MAX, NAME_MODE_LABEL, NAME_MODES, NOTE_MAX } from "@/lib/donations";
import { formatNumber } from "@/lib/format";

const input = "w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary shadow-xs ring-1 ring-primary ring-inset outline-none focus:ring-2 focus:ring-brand";

export function DonationsForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addDonation, null);
  return (
    // A saved entry clears the form; after an error the typed values stay.
    <form key={state?.ok ? state.message : "entry"} action={action} className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr] sm:items-end">
      <label className="flex flex-col gap-1 text-xs font-medium text-tertiary">
        Орсон өдөр
        <input type="date" name="receivedOn" defaultValue={today} max={today} min="2024-01-01" required className={input} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-tertiary">
        Дүн (₮)
        <input name="amount" inputMode="numeric" required placeholder="50000" maxLength={16} className={`${input} font-mono`} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-tertiary">
        Илгээгчийн нэр (банкны хуулгаас)
        <input name="donor" maxLength={DONOR_MAX} placeholder="Б.Батболд" className={input} />
      </label>
      <fieldset className="flex flex-col gap-1 sm:col-span-3">
        <legend className="text-xs font-medium text-tertiary">Нийтэд хэрхэн харагдах вэ</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {NAME_MODES.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm text-secondary">
              <input type="radio" name="mode" value={m} defaultChecked={m === "initials"} className="accent-brand-600" />
              {NAME_MODE_LABEL[m]}
            </label>
          ))}
        </div>
        <p className="text-xs text-tertiary">
          Бүтэн нэрийг зөвхөн тухайн хүн зөвшөөрсөн бол (гүйлгээний утгад «нэрээр» гэх мэт) сонгоно. «Нууц» гэж бичсэн бол «Нэргүй». Бүтэн нэрээр биш бол банкны нэр хадгалагдахгүй. {formatNumber(ANON_MAX_MNT)} ₮-өөс их хандивыг зөвхөн бүтэн нэрээр бүртгэнэ.
        </p>
      </fieldset>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-tertiary">
          Гүйлгээний утга (заавал биш; утас, данс, линк автоматаар нуугдана)
          <input name="note" maxLength={NOTE_MAX} placeholder="Амжилт хүсье!" className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" name="notePublic" className="accent-brand-600" />
          Уншсан, сайт дээр гаргаж болно (хараал, улс төрийн уриа, сурталчилгаа биш)
        </label>
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-brand-solid_hover disabled:opacity-60">
        {pending ? "Нэмж байна…" : "Хандив нэмэх"}
      </button>
      {state && <p className={`text-sm sm:col-span-3 ${state.ok ? "text-success-primary" : "text-error-primary"}`}>{state.message}</p>}
    </form>
  );
}
