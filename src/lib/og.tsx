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

/** Social feed card (1080×1350, 4:5) shared by Instagram, Facebook, Threads, Telegram and Discord. */
export const FEED_SIZE = { width: 1080, height: 1350 };

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

type Ghost = string | "mark" | null;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const display = (size: number, color: string) => ({ fontFamily: CONDENSED_FAMILY, fontSize: size, lineHeight: 0.98, color, letterSpacing: 0 });

/** The small two-line credits bottom right ("Эх сурвалж / Засгийн газар"), mogul.plus style. */
function credit(rows: [string, string][], ink: string) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 22, color: ink, opacity: 0.95 }}>{k}</span>
          <span style={{ fontSize: 20, color: ink, opacity: 0.7 }}>{clip(v, 34)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The poster frame shared by the feed cards and the quiz cards: red (or yellow) full bleed, the
 * giant faint glyph or logo mark where noorog / mogul put a photo (we print no photos of people),
 * film grain, "logo | SERIES" on the left and `corner` on the right, then the body and the bottom row.
 */
async function posterCard({ series, corner, yellow = false, ghost = null, ghostAt = [60, 330], body, bottom }: { series: string; corner: string; yellow?: boolean; ghost?: Ghost; ghostAt?: [number, number]; body: ReactNode; bottom: ReactNode }) {
  const [regular, condensed, [, mono], markSrc] = await Promise.all([loadFonts(), loadCondensedFont(), loadCardFonts(), loadMark()]);
  const ink = yellow ? QUIZ_INK : "#ffffff";
  const [top, left] = ghostAt;
  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "54px 64px 56px", background: yellow ? QUIZ_YELLOW : QUIZ_RED, fontFamily: FONT_FAMILY, overflow: "hidden" }}>
        {ghost === "mark" ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img>
          <img src={markSrc} width={900} height={548} alt="" style={{ position: "absolute", top: 420, left: 300, opacity: 0.07 }} />
        ) : ghost ? (
          <div style={{ position: "absolute", top, left, display: "flex", fontFamily: CONDENSED_FAMILY, fontSize: ghost.length > 2 ? 520 : 1200, lineHeight: 1, color: yellow ? "rgba(196,29,29,0.10)" : "rgba(255,255,255,0.08)" }}>{ghost}</div>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
        <img src={grainSrc()} width={1080} height={1350} alt="" style={{ position: "absolute", top: 0, left: 0, opacity: yellow ? 0.08 : 0.13 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", background: "#ffffff", borderRadius: 16, padding: "8px 12px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> */}
              <img src={markSrc} width={92} height={56} alt="" />
            </div>
            <div style={{ display: "flex", width: 3, height: 54, background: ink, opacity: 0.6 }} />
            <span style={{ ...display(44, ink), letterSpacing: 1 }}>{clip(series.toUpperCase(), 30)}</span>
          </div>
          <span style={{ fontSize: 28, color: ink }}>{corner}</span>
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

type QuizSlide = number | "answers";

/**
 * One card of the weekly quiz (1080×1350): `0` the cover, `1…n` a question with its amount hidden
 * and four options, `n + 1` the closing card, `"answers"` the next day's answers (yellow, so it
 * reads as the other half of the series). Every text comes from the stored quiz, i.e. from our own
 * stories.
 */
export async function quizCard(quiz: WeeklyQuiz, slide: QuizSlide) {
  const n = quiz.questions.length;
  const answers = slide === "answers";
  const ink = answers ? QUIZ_INK : "#ffffff";
  const accent = answers ? "#c41d1d" : QUIZ_YELLOW;
  const letters = ["А", "Б", "В", "Г"];
  const right = answers ? quiz.label : slide === 0 ? quiz.label : slide === n + 1 ? "iltodmedee.mn" : `АСУУЛТ ${slide}/${n}`;
  const show = (size: number, color = ink) => display(size, color);
  const swipe = (
    <div style={{ display: "flex", alignItems: "center", gap: 14, color: ink, fontSize: 24 }}>
      <div style={{ display: "flex", width: 150, height: 3, background: ink }} />
      <span style={{ marginLeft: -22, fontSize: 30 }}>›</span>
      <span style={{ marginLeft: 6 }}>Гүйлгэ</span>
    </div>
  );
  let body: ReactNode;
  let bottom: ReactNode;
  let ghost: Ghost = null;
  let ghostAt: [number, number] = [60, 330];
  if (answers) {
    ghost = "✓";
    ghostAt = [120, 260];
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 34, color: ink }}>7 хоногийн тестийн хариулт</span>
          <span style={{ ...show(150), marginTop: 22 }}>ХЭДИЙГ ЗӨВ</span>
          <span style={show(150, accent)}>ТААВ??!</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {quiz.questions.map((x, i) => {
            const share = perPersonLineShort(x.answer);
            return (
              <div key={i} style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                <div style={{ display: "flex", width: 60, height: 60, borderRadius: 30, background: QUIZ_INK, color: QUIZ_YELLOW, alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0 }}>{letters[x.correct]}</div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
                    <span style={show(46, accent)}>{x.answer.toUpperCase()}</span>
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
        {credit([["Эх мэдээ бүр", "iltodmedee.mn"]], ink)}
      </div>
    );
  } else if (slide === 0) {
    ghost = "?";
    ghostAt = [40, 300];
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 36, color: ink }}>Энэ 7 хоногийн албан мэдээнээс</span>
        <span style={{ ...show(300, QUIZ_YELLOW), marginTop: 18 }}>{`${n} ТОО`}</span>
        <span style={show(200)}>ТААГААРАЙ!</span>
        <span style={{ fontSize: 36, lineHeight: 1.35, color: ink, marginTop: 40, maxWidth: 860 }}>Төр энэ долоо хоногт хэдэн ₮-ийн шийдвэр гаргав? Хариултаа тэмдэглээд, маргааш шалгаарай.</span>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        {swipe}
        {credit([["Асуулт бүр", "албан мэдээнээс"], ["Хариулт", "маргааш 19:00"]], ink)}
      </div>
    );
  } else if (slide === n + 1) {
    ghost = "19:00";
    ghostAt = [330, 40];
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={show(210)}>ХАРИУЛТ</span>
        <span style={show(210, QUIZ_YELLOW)}>МАРГААШ</span>
        <span style={show(210, QUIZ_YELLOW)}>19:00</span>
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
        <span style={show(84, QUIZ_YELLOW)}>ILTODMEDEE.MN</span>
        {credit([["Дараагийн тест", "ням гараг 19:00"]], ink)}
      </div>
    );
  } else {
    const x = quiz.questions[slide - 1];
    const [tail = "", ...rest] = x.after.split(/\s+/).filter(Boolean);
    const length = x.before.length + x.after.length + 4;
    const size = length > 100 ? 80 : length > 75 ? 92 : length > 50 ? 108 : 128;
    ghost = "₮";
    body = (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 30, letterSpacing: 2, color: QUIZ_YELLOW }}>{`${x.topic} · ${x.day}`.toUpperCase()}</span>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", ...show(size), marginTop: 22 }}>
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
              <span style={show(54, QUIZ_INK)}>{o.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    );
    bottom = (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <span style={{ fontSize: 28, color: ink }}>Хариулт маргааш 19:00</span>
        {credit([["Эх сурвалж", x.source]], ink)}
      </div>
    );
  }

  return posterCard({ series: "7 хоногийн тест", corner: right, yellow: answers, ghost, ghostAt, body, bottom });
}

/** A daily feed card: one story or a digest edition (src/app/ig-image/route.ts builds it). */
export interface FeedCard {
  /** Next to the logo: "Шинэ мэдээ", "Анхаарах мэдээ", "Өглөөний тойм · 07:05". */
  series: string;
  /** Top right: the day ("11.06") or "10 мэдээ". */
  corner: string;
  /** Small yellow line above the headline (the topic, "Гол мэдээ"). */
  kicker?: string;
  /** The headline, its strongest fact marked hot (hookWords, rule-based). */
  words: { word: string; hot: boolean }[];
  /** "who: what changes", "why it matters" or the first summary sentence. */
  sub?: string;
  /** The largest ₮ amount and its per-person share ("≈ 49,700₮"). */
  amount?: string;
  share?: string | null;
  /** A digest's next headlines. */
  list?: string[];
  /** fact_vs_spin.neutrality_score, drawn as the fact/PR bar labelled as the AI's estimate. */
  fact?: number | null;
  credit: [string, string][];
  ghost?: Ghost;
}

/**
 * The Facebook / Instagram / Threads / Telegram / Discord card for a story or a digest, in the same
 * poster look as the weekly quiz (Nov 2026, the owner's pick after noorog.mn and mogul.plus): the
 * headline in huge condensed capitals with its number in yellow, the reader's line under it, the ₮
 * amount on a yellow pill with its per-person share, the AI's fact/PR estimate, the source as a
 * credit. Text only from our own data.
 */
export async function hookCard(card: FeedCard) {
  const length = card.words.reduce((n, w) => n + w.word.length + 1, 0);
  const size = length > 120 ? 72 : length > 90 ? 84 : length > 65 ? 98 : length > 45 ? 116 : 134;
  const fact = typeof card.fact === "number" ? Math.round(Math.max(0, Math.min(100, card.fact))) : null;
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {card.kicker && <span style={{ fontSize: 28, letterSpacing: 2, color: QUIZ_YELLOW }}>{clip(card.kicker.toUpperCase(), 48)}</span>}
      <div style={{ display: "flex", flexWrap: "wrap", ...display(size, "#ffffff") }}>
        {card.words.slice(0, 40).map((w, i) => (
          <span key={i} style={{ color: w.hot ? QUIZ_YELLOW : "#ffffff", marginRight: size * 0.22 }}>
            {w.word.toUpperCase()}
          </span>
        ))}
      </div>
      {card.sub && <span style={{ fontSize: 33, lineHeight: 1.32, color: "#ffffff", opacity: 0.92 }}>→ {clip(card.sub, card.list?.length ? 130 : 165)}</span>}
      {card.amount && (
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", background: QUIZ_YELLOW, borderRadius: 999, padding: "8px 26px", ...display(48, QUIZ_INK) }}>{card.amount.toUpperCase()}</div>
          {card.share && <span style={{ fontFamily: MONO_FAMILY, fontSize: 26, color: "#ffffff", opacity: 0.88 }}>1 хүнд {card.share}</span>}
        </div>
      )}
      {fact !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", width: "100%", height: 16, borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", width: `${fact}%`, background: "#ffffff" }} />
            <div style={{ display: "flex", flex: 1, background: QUIZ_YELLOW }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#ffffff" }}>
            <span>БАРИМТ {fact}%</span>
            <span style={{ opacity: 0.75 }}>AI-ийн үнэлгээ, буруутгал биш</span>
            <span style={{ color: QUIZ_YELLOW }}>ПИ-АР {100 - fact}%</span>
          </div>
        </div>
      )}
      {card.list && card.list.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
          {card.list.slice(0, 3).map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
              <span style={{ ...display(38, QUIZ_YELLOW), width: 52 }}>{`0${i + 2}`}</span>
              <span style={{ flex: 1, fontSize: 29, lineHeight: 1.25, color: "#ffffff" }}>{clip(line, 78)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const bottom = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <span style={display(66, QUIZ_YELLOW)}>ILTODMEDEE.MN</span>
      {credit(card.credit, "#ffffff")}
    </div>
  );
  return posterCard({ series: card.series, corner: card.corner, ghost: card.ghost ?? "mark", body, bottom });
}

/** "1 хүнд ≈ 379,500₮" for amounts from 1 тэрбум, else null (the card's short form of perPersonLine). */
function perPersonLineShort(answer: string): string | null {
  const share = perPersonShare([answer]);
  return share === null ? null : `1 хүнд ${formatShare(share)}`;
}
