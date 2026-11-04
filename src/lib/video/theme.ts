/**
 * The shared look of the daily videos (Nov 2026: the owner liked the Launchpad videos' dark
 * cinematic style better than the bright sticker cards): a deep burgundy room lit from the middle,
 * a drifting spot tinted by the scene's accent, film grain and a vignette, soft rounded cards with
 * deep shadows instead of black outlines, the site's dark-mode signal yellow, and captions with a
 * soft shadow. Each page keeps its own layout and appends these rules after its own, so they win.
 */

/** CSS appended after a video page's own rules. */
export const CINEMA_CSS = `
html,body{background:#0b0708}
#grain{position:absolute;inset:-20px;z-index:60;pointer-events:none;opacity:.06;mix-blend-mode:screen;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")}
#vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(closest-side at 50% 52%,transparent 62%,rgba(0,0,0,.6))}
.sticker{border:0;border-radius:44px;box-shadow:0 50px 100px -36px rgba(0,0,0,.9),0 0 0 2px rgba(255,170,185,.22)}
#bar{height:8px;background:rgba(255,255,255,.12)}
#head img{border:0;border-radius:16px}
#head b{color:rgba(255,255,255,.88)}
#tag{border:0;box-shadow:none;border-radius:999px;transform:none;color:#141413;letter-spacing:.08em}
#title,#q,#rel h2,#link,#amt,#relN,#nowNum{text-shadow:0 18px 50px rgba(0,0,0,.65)}
.opt .l,.blk,.p{border:0}
.blk{box-shadow:0 14px 30px -8px rgba(0,0,0,.7)}
#bubble{border-bottom-left-radius:12px}
#bubble:after{display:none}
.chip{border-radius:999px}
.lbl{border:0;box-shadow:none;border-radius:999px;transform:none}
#cap span{text-shadow:0 3px 0 rgba(0,0,0,.55),0 6px 24px rgba(0,0,0,.95)}
`;

/** Markup placed right after the page's `#bg` element. */
export const CINEMA_LAYERS = `<div id="vig"></div><div id="grain"></div>`;

/**
 * `cinemaBg(t, accent)`: the frame's background, the burgundy room plus a slow spot tinted by the
 * scene's accent colour (`#rrggbb`).
 */
export const CINEMA_BG_JS = `function cinemaBg(t,c){const a=t*0.35;return 'radial-gradient(900px 900px at '+(50+12*Math.sin(a))+'% '+(42+7*Math.cos(a*1.2))+'%,'+c+'2e 0,transparent 62%),radial-gradient(1100px 1000px at 50% 58%,#3a1019 0%,#1a0a0e 45%,#0b0708 80%)'}`;
