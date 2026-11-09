"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { sendTestPush, setFollows, subscribePush, unsubscribePush } from "@/app/push-actions";
import { FOLLOW_KEY, parseFollows } from "@/lib/officials/follow";
import { track } from "@/lib/track";

/** Chrome/Edge/Samsung fire this when the app can be installed with one tap. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// The install prompt fires once, possibly before React mounts, even before this chunk loads: the
// root layout's inline script keeps such an early one in `window.__iltodBip`. Keep it module-wide.
declare global {
  interface Window {
    __iltodBip?: BeforeInstallPromptEvent | null;
  }
}
let deferredPrompt: BeforeInstallPromptEvent | null = typeof window !== "undefined" ? (window.__iltodBip ?? null) : null;
const promptListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    promptListeners.forEach((l) => l());
  });
}

const subscribePrompt = (l: () => void) => {
  promptListeners.add(l);
  return () => promptListeners.delete(l);
};
const noop = () => () => {};

/**
 * Facebook, Messenger, Instagram, Threads ("Barcelona"), TikTok and LINE open links in their own
 * browser, which has no "Add to Home Screen" and no web push: the reader must open Safari first.
 */
export const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Barcelona|Threads|MessengerForiOS|musical_ly|BytedanceWebview|TikTok|\bLine\//;

/**
 * The push subscription, shared by every component that calls usePwa() (the bell, the sheet, the
 * follow buttons): with per-hook state, turning push on in the sheet left the bell showing "off".
 */
let currentSub: PushSubscription | null = null;
let subLoaded = false;
const subListeners = new Set<() => void>();
const setSharedSub = (sub: PushSubscription | null) => {
  currentSub = sub;
  subListeners.forEach((l) => l());
};
const subscribeSub = (l: () => void) => {
  subListeners.add(l);
  if (!subLoaded && typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window) {
    subLoaded = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setSharedSub(sub);
        // The browser dropped or replaced the subscription while no tab was open (Chrome never
        // fires pushsubscriptionchange): the reader turned push on and still allows it, so it is
        // renewed quietly instead of the bell showing "off" and alerts stopping (Nov 2026 audit).
        if (sub) {
          rememberPush(true);
          // A replaced subscription (Firefox/Safari swap it in place) must reach the server too:
          // re-send what the browser holds, at most once a day.
          void resendSubscription(sub);
        } else if (pushWasOn()) void renewSubscription();
      }, () => {});
    // sw.js posts this on `pushsubscriptionchange`: the browser replaced the subscription, so the
    // server must learn the new endpoint or alerts stop without a word.
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "iltod-push-renew") void renewSubscription();
    });
  }
  return () => subListeners.delete(l);
};

/** Set when the reader turns push on here, cleared when they turn it off. */
const PUSH_ON_KEY = "iltod-push-on";
function pushWasOn(): boolean {
  try {
    return localStorage.getItem(PUSH_ON_KEY) === "1" && Notification.permission === "granted";
  } catch {
    return false;
  }
}
function rememberPush(on: boolean) {
  try {
    if (on) localStorage.setItem(PUSH_ON_KEY, "1");
    else localStorage.removeItem(PUSH_ON_KEY);
  } catch {
    // Private mode: only the quiet renewal is lost.
  }
}

const RESENT_KEY = "iltod-push-sent";
const RESEND_EVERY_MS = 24 * 3_600_000;

/** Push is on and the browser holds a subscription: tell the server about it once a day. */
async function resendSubscription(sub: PushSubscription) {
  try {
    if (!pushWasOn()) return;
    const last = Number(localStorage.getItem(RESENT_KEY) ?? 0);
    if (Date.now() - last < RESEND_EVERY_MS) return;
    const res = await subscribePush(JSON.parse(JSON.stringify(sub)));
    if (!res.ok) return;
    localStorage.setItem(RESENT_KEY, String(Date.now()));
    const follows = parseFollows(localStorage.getItem(FOLLOW_KEY));
    if (follows.length) await setFollows(sub.endpoint, follows);
  } catch {
    // Offline or private mode: the next visit tries again.
  }
}

async function renewSubscription() {
  try {
    if (Notification.permission !== "granted" || !VAPID_PUBLIC_KEY) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
    const res = await subscribePush(JSON.parse(JSON.stringify(sub)));
    if (!res.ok) return;
    setSharedSub(sub);
    const follows = parseFollows(localStorage.getItem(FOLLOW_KEY));
    if (follows.length) await setFollows(sub.endpoint, follows);
  } catch {
    // The next visit with the 🔔 sheet open can turn it on again.
  }
}

export function usePwa() {
  const canPromptInstall = useSyncExternalStore(subscribePrompt, () => deferredPrompt !== null, () => false);
  const env = useSyncExternalStore(
    noop,
    () => {
      const ua = navigator.userAgent;
      const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(VAPID_PUBLIC_KEY);
      return `${ios ? 1 : 0}${standalone ? 1 : 0}${pushSupported ? 1 : 0}${IN_APP_BROWSER.test(ua) ? 1 : 0}`;
    },
    () => "0000",
  );
  const [isIOS, isStandalone, pushSupported, inAppBrowser] = [env[0] === "1", env[1] === "1", env[2] === "1", env[3] === "1"];

  const subscription = useSyncExternalStore(subscribeSub, () => currentSub, () => null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    window.__iltodBip = null;
    promptListeners.forEach((l) => l());
    return outcome === "accepted";
  }, []);

  const enablePush = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Мэдэгдэл зөвшөөрөгдөөгүй. Хөтчийн тохиргооноос зөвшөөрнө үү.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
      const res = await subscribePush(JSON.parse(JSON.stringify(sub)));
      if (!res.ok) {
        // Only undo a subscription made just now: one the browser already had may be registered.
        if (!existing) await sub.unsubscribe();
        setError(res.error ?? "Бүртгэж чадсангүй.");
        return;
      }
      setSharedSub(sub);
      rememberPush(true);
      track("Push subscribe", { app: window.matchMedia("(display-mode: standalone)").matches ? "installed" : "browser", new: !existing });
      const follows = parseFollows(localStorage.getItem(FOLLOW_KEY));
      if (follows.length) await setFollows(sub.endpoint, follows);
    } catch {
      setError("Мэдэгдэл асааж чадсангүй. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disablePush = useCallback(async () => {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      await unsubscribePush(subscription.endpoint);
      await subscription.unsubscribe();
      setSharedSub(null);
      rememberPush(false);
    } catch {
      setError("Мэдэгдэл унтрааж чадсангүй. Дахин оролдоно уу.");
    } finally {
      setBusy(false);
    }
  }, [subscription]);

  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const sendTest = useCallback(async () => {
    if (!subscription) return;
    setTestState("sending");
    try {
      const res = await sendTestPush(subscription.endpoint);
      setTestState(res.ok ? "sent" : (res.error ?? "Илгээж чадсангүй."));
    } catch {
      setTestState("Илгээж чадсангүй. Холболтоо шалгаад дахин оролдоно уу.");
    }
  }, [subscription]);

  return {
    isIOS,
    /** Opened inside a social app's own browser (see IN_APP_BROWSER). */
    inAppBrowser,
    sendTest,
    /** "idle" | "sending" | "sent" | an error message */
    testState,
    isStandalone,
    canPromptInstall,
    install,
    pushSupported,
    /** iOS only allows web push inside an app added to the home screen. */
    needsInstallForPush: isIOS && !isStandalone,
    subscribed: subscription !== null,
    endpoint: subscription?.endpoint ?? null,
    enablePush,
    disablePush,
    busy,
    error,
  };
}
