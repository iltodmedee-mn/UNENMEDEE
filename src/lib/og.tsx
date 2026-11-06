import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { encode as encodePng } from "fast-png";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

import { formatShare, perPersonShare } from "@/lib/per-person";
import type { WeeklyQuiz } from "@/lib/social/weekly-quiz";

/** Social preview cards (Facebook, Messenger, X, Google Discover): 1200×630 PNG. */
export const OG_SIZE = { width: 1200, height: 630 };

// Satori reads WOFF (not WOFF2). One Inter 700 subset covers Latin, Mongolian Cyrillic (Ө, Ү) and ₮
// (U+20AE), built from the Inter release with pyftsubset (see CLAUDE.md §6c); the brand row and
// the story image use it.
const FONT_FAMILY = "Inter";
let fonts: Promise<Buffer> | undefined;
function loadFonts() {
  fonts ??= readFile(join(process.cwd(), "src/assets/fonts/inter-700.woff"));
  return fonts;
}
let mark: Promise<string> | undefined;
function loadMark() {
  mark ??= readFile(join(process.cwd(), "src/assets/brand/mark.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
  return mark;
}

// The share card's own faces: Inter Display 750 for the headline and JetBrains Mono 500 for the
// labels (the site's display and mono fonts, same subset, WOFF because Satori reads no WOFF2).
const DISPLAY_FAMILY = "InterDisplay";
const MONO_FAMILY = "JetBrainsMono";
let displayFont: Promise<Buffer> | undefined;
let monoFont: Promise<Buffer> | undefined;
function loadCardFonts() {
  displayFont ??= readFile(join(process.cwd(), "src/assets/fonts/inter-display-750.woff"));
  monoFont ??= readFile(join(process.cwd(), "src/assets/fonts/jetbrains-mono-500.woff"));
  return Promise.all([displayFont, monoFont]);
}

/** The site's paper and ink; the dark card is for risk-flagged stories. */
const CARD = {
  light: { bg: "#fbfbf9", ink: "#121314", muted: "#4a4b4f", line: "rgba(0,0,0,0.14)", brand: "#047c78" },
  dark: { bg: "#0f1012", ink: "#ecebe6", muted: "#b4b3ad", line: "rgba(255,255,255,0.16)", brand: "#2dd4bf" },
} as const;
const SIGNAL = "#ffd400";
const SIGNAL_INK = "#1a1500";

/**
 * Social preview card in the site's «Тунгалаг дэвтэр» look: brand row and a mono eyebrow with the
 * topic's square, the headline in Inter Display, hairlines, and below them the story's largest ₮
 * amount on the signal chip with its share per resident. `tone: "dark"` for risk-flagged stories.
 */
export async function ogImage({
  eyebrow,
  title,
  footer,
  amount,
  share,
  tone = "light",
  dot,
  photo,
}: {
  eyebrow: string;
  title: string;
  footer: string;
  /** The largest ₮ amount ("186.2 тэрбум ₮"), shown on the signal chip. */
  amount?: string;
  /** Its share per resident ("≈ 54 400₮"). */
  share?: string | null;
  tone?: "light" | "dark";
  /** The topic's colour for the eyebrow square. */
  dot?: string;
  /** An official portrait as a data URI (MP profiles: parliament.mn's own photo), drawn round on the right. */
  photo?: string | null;
}) {
  const [data, [display, mono], markSrc] = await Promise.all([loadFonts(), loadCardFonts(), loadMark()]);
  const c = CARD[tone];
  const size = title.length > 90 ? 50 : title.length > 50 ? 60 : 70;
  const mono20 = { fontFamily: MONO_FAMILY, fontSize: 20, letterSpacing: 1.6, textTransform: "uppercase" as const, color: c.muted };
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 64px", background: c.bg, color: c.ink, fontFamily: FONT_FAMILY }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${c.line}`, paddingBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 26, letterSpacing: -0.5 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
            <img src={markSrc} width={72} height={44} alt="" />
            <span>ИЛ ТОД</span>
            <span style={{ color: c.brand }}>МЭДЭЭ</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, ...mono20 }}>
            {dot && <div style={{ display: "flex", width: 14, height: 14, borderRadius: 3, background: dot }} />}
            <span>{eyebrow.length > 44 ? `${eyebrow.slice(0, 43)}…` : eyebrow}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <div style={{ display: "flex", flex: 1, fontFamily: DISPLAY_FAMILY, fontSize: photo ? Math.min(size, 62) : size, lineHeight: 1.04, letterSpacing: -2 }}>{title.length > 140 ? `${title.slice(0, 137)}…` : title}</div>
          {photo && (
            <div style={{ display: "flex", width: 270, height: 270, borderRadius: 135, overflow: "hidden", border: `6px solid ${c.line}`, flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
              <img src={photo} width={270} height={360} style={{ width: 270, height: 360 }} alt="" />
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${c.line}`, paddingTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {amount && <div style={{ display: "flex", background: SIGNAL, color: SIGNAL_INK, fontFamily: MONO_FAMILY, fontSize: 22, padding: "8px 14px", borderRadius: 6 }}>{amount}</div>}
            {amount && share && <span style={{ fontFamily: MONO_FAMILY, fontSize: 20, color: c.muted }}>1 хүнд {share}</span>}
            {!amount && <span style={{ fontFamily: MONO_FAMILY, fontSize: 20, color: c.muted }}>{footer}</span>}
          </div>
          <span style={mono20}>{amount ? `iltodmedee.mn · ${footer}` : "iltodmedee.mn"}</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: FONT_FAMILY, data, weight: 700 as const, style: "normal" as const },
        { name: DISPLAY_FAMILY, data: display, weight: 700 as const, style: "normal" as const },
        { name: MONO_FAMILY, data: mono, weight: 500 as const, style: "normal" as const },
      ],
    },
  );
}

/** Social feed card (1080×1350, 4:5): the "hook" style shared by Instagram, Facebook and Threads. */
export const FEED_SIZE = { width: 1080, height: 1350 };

const HOOK_FAMILY = "InterDisplay";
let hookFont: Promise<Buffer> | undefined;
function loadHookFont() {
  // Inter Display Black Italic, subset like inter-700.woff (Latin, Cyrillic, Ө Ү, ₮).
  hookFont ??= readFile(join(process.cwd(), "src/assets/fonts/inter-display-900i.woff"));
  return hookFont;
}

const YELLOW = "#ffd60a";

/**
 * Bold typographic card: dark background, yellow frame, the label as a yellow pill, the headline in
 * huge black italic capitals with its strongest fact in yellow (hookWords), an optional sub-line
 * ("why it matters" / the first summary sentence) and up to three more headlines.
 */
/**
 * The Facebook / Instagram / Threads card. `fact` (fact_vs_spin.neutrality_score) draws the site's
 * fact-vs-PR bar, labelled as the AI's estimate, so the post shows it without a tap.
 */
export async function hookCard({ label, words, sub, more = [], footer, fact }: { label: string; words: { word: string; hot: boolean }[]; sub?: string; more?: string[]; footer: string; fact?: number | null }) {
  const [regular, black, markSrc] = await Promise.all([loadFonts(), loadHookFont(), loadMark()]);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const length = words.reduce((n, w) => n + w.word.length + 1, 0);
  const size = length > 110 ? 62 : length > 80 ? 72 : length > 55 ? 86 : 100;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 16, background: YELLOW, fontFamily: FONT_FAMILY }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px", background: "linear-gradient(160deg, #1d1856 0%, #0b0a24 70%)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ display: "flex", background: "#ffffff", borderRadius: 18, padding: "10px 14px" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
                <img src={markSrc} width={104} height={64} alt="" />
              </div>
              <span style={{ fontSize: 30, color: "#ffffff", letterSpacing: 1 }}>ИЛ ТОД МЭДЭЭ</span>
            </div>
            <div style={{ display: "flex", background: YELLOW, color: "#0b0a24", fontSize: 26, padding: "10px 20px", borderRadius: 999 }}>{clip(label.toUpperCase(), 32)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <div style={{ display: "flex", flexWrap: "wrap", fontFamily: HOOK_FAMILY, fontSize: size, lineHeight: 1.04, letterSpacing: -1 }}>
              {words.slice(0, 40).map((w, i) => (
                <span key={i} style={{ color: w.hot ? YELLOW : "#ffffff", marginRight: size * 0.24 }}>
                  {w.word.toUpperCase()}
                </span>
              ))}
            </div>
            {sub && <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: "#d0d5dd" }}>→ {clip(sub, 170)}</div>}
            {typeof fact === "number" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", width: "100%", height: 18, borderRadius: 9, overflow: "hidden", background: "#344054" }}>
                  <div style={{ display: "flex", width: `${Math.max(0, Math.min(100, fact))}%`, background: "#2ed3b7" }} />
                  <div style={{ display: "flex", flex: 1, background: YELLOW }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#d0d5dd" }}>
                  <span style={{ color: "#2ed3b7" }}>БАРИМТ {Math.round(Math.max(0, Math.min(100, fact)))}%</span>
                  <span>AI-ийн үнэлгээ, буруутгал биш</span>
                  <span style={{ color: YELLOW }}>ПИ-АР {100 - Math.round(Math.max(0, Math.min(100, fact)))}%</span>
                </div>
              </div>
            )}
            {more.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, borderLeft: `6px solid ${YELLOW}`, paddingLeft: 22 }}>
                {more.slice(0, 3).map((line, i) => (
                  <span key={i} style={{ fontSize: 28, lineHeight: 1.25, color: "#e4e7ec" }}>
                    + {clip(line, 80)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 28, color: "#98a2b3" }}>
            <span>{clip(footer, 46)}</span>
            <span style={{ color: YELLOW }}>iltodmedee.mn</span>
          </div>
        </div>
      </div>
    ),
    {
      ...FEED_SIZE,
      fonts: [
        { name: FONT_FAMILY, data: regular, weight: 700 as const, style: "normal" as const },
        { name: HOOK_FAMILY, data: black, weight: 700 as const, style: "normal" as const },
      ],
    },
  );
}

/** Instagram / Facebook story image (1080×1920), shared as a file from the phone share sheet. */
export const STORY_SIZE = { width: 1080, height: 1920 };

export async function storyImage({ eyebrow, title, footer }: { eyebrow: string; title: string; footer: string }) {
  const [data, markSrc] = await Promise.all([loadFonts(), loadMark()]);
  const size = title.length > 110 ? 64 : title.length > 60 ? 76 : 92;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "160px 88px 200px", background: "linear-gradient(180deg, #ffffff 0%, #e6fbfa 100%)", fontFamily: FONT_FAMILY }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
          <img src={markSrc} width={208} height={128} alt="" />
          <div style={{ display: "flex", fontSize: 40, color: "#047c78", letterSpacing: 3 }}>{eyebrow.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", fontSize: size, lineHeight: 1.15, color: "#171043", letterSpacing: -1 }}>{title.length > 160 ? `${title.slice(0, 157)}…` : title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "6px solid #05beb8", paddingTop: 36, fontSize: 38, color: "#475467" }}>
          <span>{footer}</span>
          <span style={{ color: "#171043" }}>iltodmedee.mn</span>
        </div>
      </div>
    ),
    { ...STORY_SIZE, fonts: [{ name: FONT_FAMILY, data, weight: 700 as const, style: "normal" as const }] },
  );
}

/**
 * The weekly quiz cards (src/lib/social/weekly-quiz.ts), in the full-bleed look young Mongolian
 * readers follow (noorog.mn, mogul.plus, Nov 2026): one saturated colour with film grain, a series
 * label next to the logo and the dates on the right, huge condensed capitals in yellow and white, a
 * giant faint glyph where those pages put a photo (we print no photos of people), a swipe arrow
 * and a small credit block. Oswald 700 (SIL OFL, src/assets/fonts/OFL-Oswald.txt) for the display
 * type, subset like the others (Latin, Cyrillic with Ө Ү, ₮).
 */
const CONDENSED_FAMILY = "Oswald";
let condensedFont: Promise<Buffer> | undefined;
function loadCondensedFont() {
  condensedFont ??= readFile(join(process.cwd(), "src/assets/fonts/oswald-700.woff"));
  return condensedFont;
}

const QUIZ_RED = "radial-gradient(circle at 50% 30%, #e8402f 0%, #c41d1d 48%, #7a0b0e 100%)";
const QUIZ_YELLOW = "#ffd84a";
const QUIZ_INK = "#160606";
/**
 * Film grain: a grey noise PNG (deterministic, made once per instance; resvg ignores SVG filters
 * inside an <img>), drawn over the card at low opacity and scaled up 2×.
 */
let grain: string | undefined;
function grainSrc(): string {
  if (grain) return grain;
  const w = 540;
  const h = 675;
  const data = new Uint8Array(w * h * 2);
  let seed = 0x2f6b4a1d;
  for (let i = 0; i < w * h; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i * 2] = seed >>> 24;
    data[i * 2 + 1] = 255;
  }
  grain = `data:image/png;base64,${Buffer.from(encodePng({ width: w, height: h, data, channels: 2, depth: 8 })).toString("base64")}`;
  return grain;
}

type QuizSlide = number | "answers";

/**
 * One card of the weekly quiz (1080×1350): `0` the cover, `1…n` a question with its amount hidden
 * and four options, `n + 1` the closing card, `"answers"` the next day's answers (yellow, so it
 * reads as the other half of the series). Every text comes from the stored quiz, i.e. from our own
 * stories.
 */
export async function quizCard(quiz: WeeklyQuiz, slide: QuizSlide) {
  const [regular, condensed, [, mono], markSrc] = await Promise.all([loadFonts(), loadCondensedFont(), loadCardFonts(), loadMark()]);
  const n = quiz.questions.length;
  const answers = slide === "answers";
  const ink = answers ? QUIZ_INK : "#ffffff";
  const accent = answers ? "#c41d1d" : QUIZ_YELLOW;
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const letters = ["А", "Б", "В", "Г"];
  const right = answers ? quiz.label : slide === 0 ? quiz.label : slide === n + 1 ? "iltodmedee.mn" : `АСУУЛТ ${slide}/${n}`;
  const display = (size: number, color = ink) => ({ fontFamily: CONDENSED_FAMILY, fontSize: size, lineHeight: 0.98, color, letterSpacing: 0 });
  const credit = (rows: [string, string][]) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 22, color: ink, opacity: 0.95 }}>{k}</span>
          <span style={{ fontSize: 20, color: ink, opacity: 0.7 }}>{clip(v, 34)}</span>
        </div>
      ))}
    </div>
  );
  const swipe = (
    <div style={{ display: "flex", alignItems: "center", gap: 14, color: ink, fontSize: 24 }}>
      <div style={{ display: "flex", width: 150, height: 3, background: ink }} />
      <span style={{ marginLeft: -22, fontSize: 30 }}>›</span>
      <span style={{ marginLeft: 6 }}>Гүйлгэ</span>
    </div>
  );
  // The giant faint glyph behind the type, where noorog / mogul put a photo.
  const ghost = (glyph: string, size: number, top: number, left: number) => (
    <div style={{ position: "absolute", top, left, display: "flex", fontFamily: CONDENSED_FAMILY, fontSize: size, lineHeight: 1, color: answers ? "rgba(196,29,29,0.10)" : "rgba(255,255,255,0.08)" }}>{glyph}</div>
  );

  let body: ReactNode;
  let bottom: ReactNode;
  let background: ReactNode = null;
  if (answers) {
    background = ghost("✓", 1100, 120, 260);
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 34, color: ink }}>7 хоногийн тестийн хариулт</span>
          <span style={{ ...display(150), marginTop: 22 }}>ХЭДИЙГ ЗӨВ</span>
          <span style={display(150, accent)}>ТААВ??!</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {quiz.questions.map((x, i) => {
            const share = perPersonLineShort(x.answer);
            return (
              <div key={i} style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                <div style={{ display: "flex", width: 60, height: 60, borderRadius: 30, background: QUIZ_INK, color: QUIZ_YELLOW, alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0 }}>{letters[x.correct]}</div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
                    <span style={display(46, accent)}>{x.answer.toUpperCase()}</span>
                    {share && <span style={{ fontFamily: MONO_FAMILY, fontSize: 22, color: QUIZ_INK, opacity: 0.75 }}>{share}</span>}
                  </div>
                  <span style={{ fontSize: 25, lineHeight: 1.3, color: QUIZ_INK, marginTop: 4 }}>{clip(x.title, 100)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <span style={{ fontSize: 20, color: QUIZ_INK, opacity: 0.75, maxWidth: 560 }}>
          {quiz.questions.some((x) => perPersonLineShort(x.answer)) ? "1 хүнд = 3.43 сая хүнд хуваавал (ҮСХ). Хүн бүр төлнө гэсэн үг биш." : "Тоо бүр албан мэдээнээс."}
        </span>
        {credit([["Эх мэдээ бүр", "iltodmedee.mn"]])}
      </div>
    );
  } else if (slide === 0) {
    background = ghost("?", 1300, 40, 300);
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 36, color: ink }}>Энэ 7 хоногийн албан мэдээнээс</span>
        <span style={{ ...display(300, QUIZ_YELLOW), marginTop: 18 }}>{`${n} ТОО`}</span>
        <span style={display(200)}>ТААГААРАЙ!</span>
        <span style={{ fontSize: 36, lineHeight: 1.35, color: ink, marginTop: 40, maxWidth: 860 }}>Төр энэ долоо хоногт хэдэн ₮-ийн шийдвэр гаргав? Хариултаа тэмдэглээд, маргааш шалгаарай.</span>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        {swipe}
        {credit([["Асуулт бүр", "албан мэдээнээс"], ["Хариулт", "маргааш 19:00"]])}
      </div>
    );
  } else if (slide === n + 1) {
    background = ghost("19:00", 520, 330, 40);
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={display(210)}>ХАРИУЛТ</span>
        <span style={display(210, QUIZ_YELLOW)}>МАРГААШ</span>
        <span style={display(210, QUIZ_YELLOW)}>19:00</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 50 }}>
          {["Бүх тоо албан мэдээнээс, эх холбоостой", "Тоо бүрийг 3.43 сая хүнд хуваавал хэд болохыг харуулна", "Өдөр бүр 2 тойм, баримтаар"].map((line) => (
            <div key={line} style={{ display: "flex", gap: 20, fontSize: 34, lineHeight: 1.3, color: ink }}>
              <span style={{ color: QUIZ_YELLOW, width: 36 }}>✓</span>
              <span style={{ flex: 1 }}>{line}</span>
            </div>
          ))}
        </div>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <span style={display(84, QUIZ_YELLOW)}>ILTODMEDEE.MN</span>
        {credit([["Дараагийн тест", "ням гараг 19:00"]])}
      </div>
    );
  } else {
    const x = quiz.questions[slide - 1];
    const [tail = "", ...rest] = x.after.split(/\s+/).filter(Boolean);
    const length = x.before.length + x.after.length + 4;
    const size = length > 100 ? 80 : length > 75 ? 92 : length > 50 ? 108 : 128;
    background = ghost("₮", 1200, 60, 330);
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 30, letterSpacing: 2, color: QUIZ_YELLOW }}>{`${x.topic} · ${x.day}`.toUpperCase()}</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", ...display(size), marginTop: 22 }}>
          {x.before
            .split(/\s+/)
            .filter(Boolean)
            .map((w, i) => (
              <span key={`b${i}`} style={{ marginRight: size * 0.22 }}>{w.toUpperCase()}</span>
            ))}
          <div style={{ display: "flex", alignItems: "center", marginRight: size * 0.22 }}>
            <div style={{ display: "flex", background: QUIZ_YELLOW, color: QUIZ_INK, borderRadius: 12, padding: `0 ${Math.round(size * 0.2)}px`, marginRight: size * 0.16 }}>???</div>
            <span>{tail.toUpperCase()}</span>
          </div>
          {rest.map((w, i) => (
            <span key={`a${i}`} style={{ marginRight: size * 0.22 }}>{w.toUpperCase()}</span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 44 }}>
          {x.options.map((o, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, width: 466, background: "#ffffff", borderRadius: 20, padding: "18px 22px" }}>
              <div style={{ display: "flex", width: 62, height: 62, borderRadius: 31, background: QUIZ_YELLOW, color: QUIZ_INK, alignItems: "center", justifyContent: "center", fontSize: 34, flexShrink: 0 }}>{letters[i]}</div>
              <span style={display(54, QUIZ_INK)}>{o.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <span style={{ fontSize: 28, color: ink }}>Хариулт маргааш 19:00</span>
        {credit([["Эх сурвалж", x.source]])}
      </div>
    );
  }

  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "54px 64px 56px", background: answers ? QUIZ_YELLOW : QUIZ_RED, fontFamily: FONT_FAMILY, overflow: "hidden" }}>
        {background}
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
        <img src={grainSrc()} width={1080} height={1350} alt="" style={{ position: "absolute", top: 0, left: 0, opacity: answers ? 0.08 : 0.13 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", background: "#ffffff", borderRadius: 16, padding: "8px 12px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
              <img src={markSrc} width={92} height={56} alt="" />
            </div>
            <div style={{ display: "flex", width: 3, height: 54, background: ink, opacity: 0.6 }} />
            <span style={{ ...display(44), letterSpacing: 1 }}>7 ХОНОГИЙН ТЕСТ</span>
          </div>
          <span style={{ fontSize: 28, color: ink }}>{right}</span>
        </div>
        {body}
        {bottom}
      </div>
    ),
    {
      ...FEED_SIZE,
      fonts: [
        { name: FONT_FAMILY, data: regular, weight: 700 as const, style: "normal" as const },
        { name: CONDENSED_FAMILY, data: condensed, weight: 700 as const, style: "normal" as const },
        { name: MONO_FAMILY, data: mono, weight: 500 as const, style: "normal" as const },
      ],
    },
  );
}

/** "1 хүнд ≈ 379,500₮" for amounts from 1 тэрбум, else null (the card's short form of perPersonLine). */
function perPersonLineShort(answer: string): string | null {
  const share = perPersonShare([answer]);
  return share === null ? null : `1 хүнд ${formatShare(share)}`;
}
