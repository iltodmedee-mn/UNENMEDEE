"use client";

import { useLocalStorage } from "@/lib/local-store";

import { usePwa } from "./use-pwa";

/**
 * One-line invite under the home story list (below the fold, so appearing after hydration
 * shifts nothing on screen). Hidden once subscribed, dismissed, or where push is unsupported.
 */
export function PushInvite() {
  const { pushSupported, needsInstallForPush, inAppBrowser, subscribed, enablePush, busy, error } = usePwa();
  // A social app's own browser has no web push (and on iPhone no "Add to Home Screen").
  const elsewhere = needsInstallForPush || inAppBrowser;
  const [dismissed, setDismissed] = useLocalStorage("iltod-push-invite", "");
  if (subscribed || dismissed || (!pushSupported && !needsInstallForPush)) return null;
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-secondary p-4 text-sm ring-1 ring-line-soft ring-inset">
      <p className="font-semibold text-primary">🔔 Өдөрт хамгийн чухал мэдээг утсандаа аваарай</p>
      <p className="text-tertiary">
        {inAppBrowser
          ? "Facebook, Instagram доторх хөтөч мэдэгдэл дэмждэггүй: ⋯ цэсээр Safari эсвэл Chrome-д нээгээд асаана."
          : needsInstallForPush
            ? "iPhone дээр эхлээд Share → \"Add to Home Screen\"-ээр сайтыг нэмээд, тэндээс асаана."
            : "Спам биш: нэг ажиллалтад нэг л мэдэгдэл, хүссэн үедээ унтраана."}
      </p>
      <div className="flex gap-2">
        {!elsewhere && (
          <button type="button" onClick={enablePush} disabled={busy} className="rounded-lg bg-ink px-4 py-2 font-semibold text-bg-primary hover:opacity-90 disabled:opacity-60">
            Мэдэгдэл асаах
          </button>
        )}
        <button type="button" onClick={() => setDismissed("1")} className="rounded-lg px-3 py-2 font-semibold text-tertiary hover:text-secondary">
          Дараа
        </button>
      </div>
      {error && <p className="text-xs text-error-primary">{error}</p>}
    </div>
  );
}
