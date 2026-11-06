/**
 * The shared look of the daily videos, the same poster style as the social cards (Nov 2026: the
 * owner pointed to noorog.mn and mogul.plus, the pages young Mongolian readers follow): a
 * saturated red lit from above with a slow drifting light, strong film grain and a soft vignette,
 * Oswald 700 condensed capitals (SIL OFL, src/assets/fonts/OFL-Oswald.txt) in yellow and white,
 * white cards with dark ink, yellow chips, "logo | ИЛ ТОД МЭДЭЭ" with the series name in yellow on
 * the right. Each page keeps its own layout and appends these rules after its own, so they win
 * (the `!important`s beat colours a page sets inline per scene).
 */

const INK = "#160606";
const YELLOW = "#ffd84a";

/** The condensed face; each page passes its fonts directory. */
export const posterFontFace = (fontsDir: string) => `@font-face{font-family:Cond;src:url(file://${fontsDir.replace(/\/$/, "")}/oswald-700.woff) format("woff");font-weight:700}`;

/** CSS appended after a video page's own rules. */
export const CINEMA_CSS = `
html,body{background:#8f1013}
#grain{position:absolute;inset:-20px;z-index:60;pointer-events:none;opacity:.2;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")}
#vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(closest-side at 50% 46%,transparent 58%,rgba(55,0,4,.55))}
.sticker{border:0;border-radius:28px;box-shadow:0 36px 70px -34px rgba(50,0,4,.85)}
#bar{height:8px;background:rgba(255,255,255,.25)}
#bar i{background:${YELLOW}}
#head img{border:0;border-radius:14px;background:#fff}
#head b{font-family:Cond;font-weight:700;font-size:46px;line-height:1;letter-spacing:.01em;color:#fff;padding-left:20px;border-left:3px solid rgba(255,255,255,.65)}
#tag{background:none;border:0;box-shadow:none;transform:none;padding:0;color:${YELLOW};font-family:Cond;font-weight:700;font-size:40px;letter-spacing:.02em;text-transform:uppercase}
#card,.box,#bubble,.opt{color:${INK}}
.disp,#hl,#title,#q,#amt,#div,#count,#nowTag,#ratio,#big .s,#big .b,#rel h2,#relN,#bubble,.chip,#link,#ask,.box p,.lbl,.opt .l,.opt .v,#nowNum,.row .n,.row .y,#cap{font-family:Cond;font-weight:700;letter-spacing:0;text-transform:uppercase}
#hl{line-height:1.04}
#title,#q,#rel h2,#link,#amt,#relN,#nowNum{text-shadow:0 14px 40px rgba(60,0,4,.55)}
#q{font-size:56px;line-height:1.04;width:770px}
#rel h2{font-size:82px;line-height:1.02}
#amt,#relN,#nowNum,#link{color:${YELLOW}}
#link{font-size:88px}
#div,#nowTag{background:#fff!important;color:#c41d1d}
#count,#ratio,#big{background:${YELLOW}!important;color:${INK}}
.opt .l{border:0;background:${YELLOW};color:${INK}}
.opt .v{font-size:84px}
.opt .x{background:${INK}}
.blk{border:0;background:${YELLOW};box-shadow:0 14px 30px -8px rgba(50,0,4,.7)}
#bubble{border-bottom-left-radius:12px}
#bubble:after{display:none}
.chip{border-radius:999px;background:${YELLOW}!important;color:${INK}}
.chip+.chip{background:#fff!important}
.lbl{border:0;box-shadow:none;border-radius:999px;transform:none;background:${YELLOW}!important;color:${INK};font-size:42px;padding:10px 28px}
#ask{background:${YELLOW};color:${INK};font-size:168px;line-height:.92}
#ask small{margin-top:30px}
#sub,#src,.row .y{color:rgba(255,255,255,.86)}
#cap{font-size:94px;line-height:1.02;gap:0 22px}
#cap span{color:#fff;text-shadow:0 4px 0 rgba(70,0,6,.55),0 10px 30px rgba(40,0,4,.6)}
#cap span.hl{color:${YELLOW}}
`;

/** Markup placed right after the page's `#bg` element. */
export const CINEMA_LAYERS = `<div id="vig"></div><div id="grain"></div>`;

/**
 * `cinemaBg(t, accent)`: the frame's background, the red poster with a slow warm light drifting
 * across its top half (the accent is no longer mixed in: on red it turned muddy).
 */
export const CINEMA_BG_JS = `function cinemaBg(t,c){const a=t*0.35;return 'radial-gradient(820px 820px at '+(50+14*Math.sin(a))+'% '+(34+8*Math.cos(a*1.2))+'%,rgba(255,150,110,.30) 0,transparent 65%),radial-gradient(1300px 1500px at 50% 36%,#e8402f 0%,#c41d1d 46%,#7a0b0e 100%)'}`;
