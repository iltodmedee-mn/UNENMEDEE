"use client";

import { Bell01, BellRinging01, Download01, PlusSquare, Share01, XClose } from "@untitledui/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cx } from "@/utils/cx";

import { HEADER_ICON_BUTTON } from "@/components/layout/header-styles";

import { usePwa } from "./use-pwa";
import { digestWindowsLabel } from "@/lib/edition";
import { askDelay, DISMISS_KEY, INSTALLED_KEY, parseAskState, STEPS_KEY } from "@/lib/install-ask";

/** An ignored strip slides away by itself after this long (counts as a ✕). */
const AUTO_HIDE_MS = 20_000;
/** Busy reader (a menu or sheet open, typing): try again this much later. */
const BUSY_RETRY_MS = 30_000;

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the strip asks again on the next page */
  }
}
const rememberDismiss = () => remember(DISMISS_KEY, String(Date.now()));

/** ms until the strip may show, null = never (installed). Storage errors read as "never closed". */
function nextAsk(): number | null {
  try {
    return askDelay(parseAskState((k) => localStorage.getItem(k)), Date.now());
  } catch {
    return askDelay({ dismissedAt: 0, stepsAt: 0, installed: false }, Date.now());
  }
}

/**
 * Not now: another dialog or menu is open, the reader is typing, this is /admin, or the screen is
 * wide (the strip is phones only; a phone turned back to portrait is asked on the next check).
 */
function readerBusy(): boolean {
  const el = document.activeElement;
  return (
    location.pathname.startsWith("/admin") ||
    window.matchMedia("(min-width: 768px)").matches ||
    document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"], [data-popover]') !== null ||
    (el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)))
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-solid text-xs font-semibold text-primary_on-brand">{n}</span>
      {children}
    </li>
  );
}

/** inApp: opened in Facebook/Instagram/Threads' own browser, which cannot add to the home screen. */
function IosSteps({ inApp = false }: { inApp?: boolean }) {
  const first = inApp ? 2 : 1;
  return (
    <ol className="flex flex-col gap-2 text-sm text-secondary">
      {inApp && (
        <Step n={1}>
          <span>
            Энэ хуудсыг <b>Safari</b>-д нээнэ: баруун дээд/доод буланд байгаа <b>⋯</b> цэс → <b>Open in Safari</b> (эсвэл «Open in external browser»)
          </span>
        </Step>
      )}
      <Step n={first}>
        <span>
          Safari-ийн доод хэсгийн <Share01 className="inline size-4 text-brand-secondary" aria-label="Share" /> товчийг дарна
        </span>
      </Step>
      <Step n={first + 1}>
        <span>
          <PlusSquare className="inline size-4 text-brand-secondary" aria-hidden /> <b>Add to Home Screen</b> (Нүүр дэлгэцэнд нэмэх)
        </span>
      </Step>
      <Step n={first + 2}>Аппаа нээгээд 🔔 товчоор мэдэгдлээ асаана</Step>
    </ol>
  );
}

const noopSubscribe = () => () => {};

/**
 * Bottom sheet on phones, centered card on desktop. Portaled to <body>: the sticky header
 * uses backdrop-filter, which would otherwise trap `position: fixed` inside the header.
 */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const dialog = useRef<HTMLDivElement>(null);
  // Callers pass a fresh arrow each render: read it through a ref so the effect below runs only
  // when the sheet opens or closes (re-running it moved focus on every parent re-render).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // A modal dialog: focus moves into it, Tab stays inside, and closing gives focus back to the
  // button that opened it (it was left on the page behind the overlay).
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialog.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !dialog.current) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex='0']"));
      if (items.length === 0) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    open && (
      // CSS enter animations (@starting-style utilities in globals.css): no animation library in the shared header bundle.
      <div className="fade-enter fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 sm:items-center" onClick={onClose}>
        <div
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="sheet-enter w-full max-w-md outline-hidden rounded-t-2xl bg-primary p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-line sm:rounded-2xl sm:pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Хаах" className="-m-2 rounded-lg p-2 text-fg-quaternary hover:bg-primary_hover">
              <XClose className="size-5" />
            </button>
          </div>
          {children}
        </div>
      </div>
    ),
    document.body,
  );
}

/** 🔔 in the header: subscribe/unsubscribe to "important news" push notifications. */
export function NotifyButton() {
  const pwa = usePwa();
  const [sheet, setSheet] = useState(false);
  if (!pwa.pushSupported && !pwa.needsInstallForPush) return null;

  // Always open the sheet first: it says what is sent, and "Асаах" asks the browser for
  // permission. Asking on the bell itself looked dead where the browser hides its prompt.
  const onClick = () => setSheet(true);
  const label = pwa.subscribed ? "Мэдэгдлийн тохиргоо" : "Шинэ мэдээний мэдэгдэл авах";

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pwa.busy}
        aria-label={label}
        title={label}
        className={cx(HEADER_ICON_BUTTON, "relative disabled:opacity-50", pwa.subscribed && "text-brand-secondary ring-brand")}
      >
        {pwa.subscribed ? <BellRinging01 className="size-[18px]" /> : <Bell01 className="size-[18px]" />}
        {!pwa.subscribed && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-risk ring-2 ring-bg-primary" aria-hidden />}
      </button>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={pwa.needsInstallForPush ? "iPhone дээр мэдэгдэл авах" : pwa.subscribed ? "Мэдэгдэл асаалттай 🔔" : "Чухал мэдээг мэдэгдлээр авах"}
      >
        {pwa.needsInstallForPush ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tertiary">Apple зөвхөн нүүр дэлгэцэнд нэмсэн аппад мэдэгдэл зөвшөөрдөг. Нэг удаа нэмэхэд л болно:</p>
            <IosSteps inApp={pwa.inAppBrowser} />
          </div>
        ) : !pwa.subscribed ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tertiary">
              Өдөрт хэдхэн удаа: улс орны хэмжээний чухал шийдвэр, өндөр эрсдэлтэй мэдээ, {digestWindowsLabel()} гарах онцлох тойм. Зар сурталчилгаа илгээхгүй.
            </p>
            {pwa.error && <p className="text-sm text-error-primary">{pwa.error}</p>}
            <button
              type="button"
              onClick={pwa.enablePush}
              disabled={pwa.busy}
              className="rounded-xl bg-brand-solid py-3 text-md font-semibold text-primary_on-brand shadow-xs hover:bg-brand-solid_hover disabled:opacity-60"
            >
              {pwa.busy ? "Асааж байна…" : "Асаах"}
            </button>
            <p className="text-xs text-quaternary">Хөтөч зөвшөөрөл асууна. Дараа нь энэ хонхоор хэзээ ч унтрааж болно.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-tertiary">
              Улс орны хэмжээний чухал шийдвэр, өндөр эрсдэлтэй мэдээ гарахад (цаг тутмын шалгалтаар нэг мэдэгдэл) болон {digestWindowsLabel()} гарах онцлох тойм бэлэн болоход танд мэдэгдэнэ.
            </p>
            <button
              type="button"
              onClick={pwa.sendTest}
              disabled={pwa.testState === "sending"}
              className="rounded-xl bg-brand-solid py-3 text-md font-semibold text-primary_on-brand shadow-xs hover:bg-brand-solid_hover disabled:opacity-60"
            >
              {pwa.testState === "sending" ? "Илгээж байна…" : "Туршилтын мэдэгдэл илгээх"}
            </button>
            {pwa.testState === "sent" && (
              <p className="text-sm text-success-primary">Илгээлээ. Хэдэн секундэд утсанд тань ирнэ. Ирэхгүй бол Тохиргоо → Мэдэгдэл → ИЛ ТОД асаалттай эсэхийг шалгаарай.</p>
            )}
            {pwa.testState !== "idle" && pwa.testState !== "sending" && pwa.testState !== "sent" && <p className="text-sm text-error-primary">{pwa.testState}</p>}
            <button
              type="button"
              onClick={async () => {
                await pwa.disablePush();
                setSheet(false);
              }}
              className="rounded-xl py-3 text-md font-semibold text-secondary ring-1 ring-primary ring-inset hover:bg-primary_hover"
            >
              Мэдэгдэл унтраах
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/**
 * Phones only: invites to install the app (Android one tap, iOS instructions). Until the app is
 * installed it comes back 5 minutes after every ✕ (also across pages and reloads), only while the
 * tab is visible, so it never "fires" unseen; timing rules in `src/lib/install-ask.ts`. It stays
 * out of the way: it waits while a menu or sheet is open or the reader is typing, and an ignored
 * strip slides away after 20 s. Installed means never: Android stops offering the install (not
 * eligible), and on iPhone the reader taps "Нэмчихсэн" in the steps sheet.
 */
export function InstallBanner() {
  const pwa = usePwa();
  const [visible, setVisible] = useState(false);
  const [iosSheet, setIosSheet] = useState(false);
  const eligible = !pwa.isStandalone && (pwa.canPromptInstall || pwa.isIOS);

  useEffect(() => {
    if (!eligible || visible || iosSheet) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      if (document.visibilityState !== "visible") return;
      if (readerBusy()) t = setTimeout(show, BUSY_RETRY_MS);
      else setVisible(true);
    };
    const arm = () => {
      clearTimeout(t);
      const wait = nextAsk();
      if (wait === null || document.visibilityState !== "visible") return;
      t = setTimeout(show, wait);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [eligible, visible, iosSheet]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      rememberDismiss();
    }, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  const dismiss = () => {
    setVisible(false);
    rememberDismiss();
  };

  const onInstall = async () => {
    setVisible(false);
    if (pwa.isIOS) {
      remember(STEPS_KEY, String(Date.now()));
      setIosSheet(true);
      return;
    }
    // A cancelled Android prompt counts as a ✕; an accepted one ends it (Chrome stops offering it).
    if (!(await pwa.install())) rememberDismiss();
  };

  const installedOnIos = () => {
    remember(INSTALLED_KEY, "1");
    setIosSheet(false);
  };

  return (
    <>
      {visible && eligible && (
        <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sheet-enter z-40 md:hidden">
          <div className="flex items-center gap-3 rounded-2xl bg-primary p-3 shadow-xl ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="size-11 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary">ИЛ ТОД апп</p>
              <p className="line-clamp-2 text-xs text-tertiary">Нүүр дэлгэцнээс нэг товшилтоор, шинэ мэдээний мэдэгдэлтэй</p>
            </div>
            <button
              type="button"
              onClick={onInstall}
              className="flex items-center gap-1 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-primary_on-brand shadow-xs hover:bg-brand-solid_hover"
            >
              <Download01 className="size-4" /> Суулгах
            </button>
            <button type="button" onClick={dismiss} aria-label="Хаах" className="rounded-lg p-1.5 text-fg-quaternary hover:bg-primary_hover">
              <XClose className="size-4" />
            </button>
          </div>
        </div>
      )}
      <Sheet open={iosSheet} onClose={() => setIosSheet(false)} title="iPhone-д суулгах">
        <div className="flex flex-col gap-4">
          <IosSteps inApp={pwa.inAppBrowser} />
          <button type="button" onClick={installedOnIos} className="rounded-xl py-3 text-md font-semibold text-secondary ring-1 ring-primary ring-inset hover:bg-primary_hover">
            ✓ Нүүр дэлгэцэнд нэмчихсэн
          </button>
          <p className="text-xs text-quaternary">Нэмсэн бол дарна уу: энэ санал дахиж гарахгүй.</p>
        </div>
      </Sheet>
    </>
  );
}
