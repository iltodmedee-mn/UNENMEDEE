"use client";

import { errorDigest, reportMailto } from "@/lib/error-report";

/**
 * The root layout itself failed. It replaces the whole document, so it carries its own minimal
 * markup and inline styles (global CSS and fonts are not loaded here). The reference code and the
 * report link are the same as on error.tsx.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  const button = { marginTop: 16, padding: "10px 16px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 } as const;
  return (
    <html lang="mn">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#101828" }}>
        <title>Алдаа · ИЛ ТОД МЭДЭЭ</title>
        <main style={{ maxWidth: 480, margin: "15vh auto", padding: "0 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Хуудас ачаалахад алдаа гарлаа</h1>
          <p style={{ color: "#475467" }}>Хэсэг хугацааны дараа дахин оролдоно уу. Давтагдвал лавлах кодын хамт бидэнд мэдэгдээрэй.</p>
          {digest && (
            <p style={{ color: "#475467", fontSize: 13 }}>
              Лавлах код: <code style={{ userSelect: "all" }}>{digest}</code>
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ ...button, border: 0, background: "#047c78", color: "#fff" }}>
              Дахин оролдох
            </button>
            <a href={reportMailto(path, digest)} style={{ ...button, border: "1px solid #d0d5dd", color: "#344054", textDecoration: "none", display: "inline-block" }}>
              Мэдэгдэх
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
