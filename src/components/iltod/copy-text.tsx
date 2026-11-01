"use client";

import { Check, Copy01 } from "@untitledui/icons";
import { useState } from "react";

import { cx } from "@/utils/cx";

/** Copies `text` (e.g. a bank account) with a short "Хуулагдлаа" confirmation. */
export function CopyText({ text, label = "Хуулах", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard access: the reader copies it by hand, so we do not claim "Хуулагдлаа".
      window.prompt("Хуулна уу:", text);
      return;
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Хуулагдлаа" : `${label}: ${text}`}
      className={cx("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition", done ? "text-success-primary" : "text-brand-secondary hover:bg-primary_hover", className)}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy01 className="size-3.5" aria-hidden />}
      {done ? "Хуулагдлаа" : label}
    </button>
  );
}
