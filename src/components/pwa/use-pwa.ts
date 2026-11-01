"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { sendTestPush, setFollows, subscribePush, unsubscribePush } from "@/app/push-actions";
import { FOLLOW_KEY, parseFollows } from "@/lib/officials/follow";

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
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then(setSharedSub, () => {});
    // sw.js posts this on `pushsubscriptionchange`: the browser replaced the subscription, so the
    // server must learn the new endpoint or alerts stop without a word.
    navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "iltod-push-renew") void renewSubscription();
    });
  }
  return () => subListeners.delete(l);
};

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
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
      const res = await subscribePush(JSON.parse(JSON.stringify(sub)));
      if (!res.ok) {
        await sub.unsubscribe();
        setError(res.error ?? "Бүртгэж чадсангүй.");
        return;
      }
      setSharedSub(sub);
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
