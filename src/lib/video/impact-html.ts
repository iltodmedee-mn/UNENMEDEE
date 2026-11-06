/**
 * The "ЧАМД ХАМААТАЙ ЮУ?" video as one HTML page with `render(t)` (the same frame-by-frame contract
 * as scene-html.ts and money-html.ts, rendered by render.ts). Readable with the sound off from the
 * first frame: the headline on a white card, a huge "ЧАМД ХАМААТАЙ ЮУ?" sticker under it, then one
 * card per answer (who / what changes / from when / what to do) sliding in as the voice reaches it,
 * the comment ask, the source and the AI labels. Text comes only from the spec, as JSON with `<`
 * escaped, and is set with textContent.
 */
import type { ImpactSpec } from "./impact-video";
import { FRAME, type SceneAssets } from "./scene-html";
import { captionWords, type Timeline } from "./timing";
import { CINEMA_BG_JS, CINEMA_CSS, CINEMA_LAYERS, posterFontFace } from "./theme";

const CARD_COLORS: Record<ImpactSpec["cards"][number]["scene"], string> = {
  who: "#2de2b0",
  change: "#ffd166",
  when: "#ff4fa3",
  action: "#7cc4ff",
};

export function impactHtml(spec: ImpactSpec, tl: Timeline, assets: SceneAssets): string {
  const data = JSON.stringify({
    series: spec.series,
    headline: spec.headline,
    sub: spec.sub,
    source: spec.source,
    cards: spec.cards.map((c) => ({ ...c, color: CARD_COLORS[c.scene] })),
    link: spec.link.replace(/\/article\/.*$/, ""),
    scenes: spec.sentences.map((s) => s.scene),
    words: spec.sentences.map((s) => captionWords(s.caption)),
    tl,
  }).replace(/</g, "\\u003c");
  const f = (name: string) => `file://${assets.fontsDir.replace(/\/$/, "")}/${name}`;
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${f("inter-var.woff2")}) format("woff2");font-weight:100 900}
@font-face{font-family:Disp;src:url(${f("inter-display-var.woff2")}) format("woff2");font-weight:650 850}
@font-face{font-family:Mono;src:url(${f("jetbrains-mono-500.woff2")}) format("woff2")}
${posterFontFace(assets.fontsDir)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden;background:#0d0e11;color:#fff;font-family:Inter}
#bg{position:absolute;inset:0}
.abs{position:absolute}
.mono{font-family:Mono;letter-spacing:.02em}
.disp{font-family:Disp;font-weight:850;letter-spacing:-.035em}
.sticker{border:6px solid #000;box-shadow:10px 10px 0 #000;border-radius:26px}
#bar{left:60px;right:60px;top:60px;height:12px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden}
#bar i{display:block;height:100%;background:#ffd166}
#head{left:60px;right:60px;top:104px;display:flex;align-items:center;gap:18px}
#head img{width:64px;height:64px;border-radius:14px;border:4px solid #000}
#head b{font-family:Disp;font-weight:800;font-size:34px;letter-spacing:-.02em}
#tag{margin-left:auto;background:#ffd166;color:#000;font-family:Mono;font-size:26px;padding:8px 16px;border:4px solid #000;box-shadow:6px 6px 0 #000;border-radius:10px;transform:rotate(-3deg)}
#card{left:60px;right:70px;top:206px;height:260px;background:#fff;color:#000;padding:26px 32px;overflow:hidden}
#hl{font-family:Disp;font-weight:800;font-size:50px;line-height:1.1;letter-spacing:-.02em}
#sub{left:66px;right:60px;top:494px;font-size:28px;color:#e4e5e8}
.layer{position:absolute;left:60px;right:60px;top:570px;height:740px;opacity:0}
#ask{display:inline-block;background:#ffd166;color:#141413;font-size:118px;line-height:.98;padding:26px 40px 34px;transform-origin:left center}
#ask small{display:block;font-size:44px;letter-spacing:-.01em;margin-top:18px;color:#5c1526}
.lbl{display:inline-block;color:#000;font-family:Mono;font-size:38px;padding:10px 22px;border:5px solid #000;box-shadow:6px 6px 0 #000;border-radius:12px;transform:rotate(-2deg)}
.box{margin-top:34px;background:#fff;color:#000;padding:34px 38px;max-height:560px;overflow:hidden}
.box p{font-family:Disp;font-weight:800;font-size:66px;line-height:1.12;letter-spacing:-.02em}
#bubble{background:#fff;color:#000;font-family:Disp;font-weight:850;font-size:84px;line-height:1.05;padding:40px 44px;position:relative}
#bubble:after{content:"";position:absolute;left:90px;bottom:-46px;border:22px solid transparent;border-top:24px solid #fff}
.chips{display:flex;gap:20px;margin-top:70px}
.chip{background:#ffd166;color:#000;font-family:Disp;font-weight:850;font-size:46px;padding:14px 26px}
#link{margin-top:50px;font-family:Disp;font-weight:850;font-size:62px;color:#ffd166;text-shadow:0 6px 0 #000}
#src{margin-top:26px;font-size:24px;color:#e4e5e8;line-height:1.35}
#cap{left:70px;right:70px;top:1330px;height:230px;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:0 26px;font-family:Disp;font-weight:850;font-size:76px;line-height:1.12;text-align:center}
#cap span{display:inline-block;color:#fff;text-shadow:-4px -4px 0 #000,4px -4px 0 #000,-4px 4px 0 #000,4px 4px 0 #000,0 9px 0 #000}
#cap span.hl{color:#ffd166}
#cap span.on{transform:translateY(-8px)}
${CINEMA_CSS}</style></head><body>
<div id="bg"></div>${CINEMA_LAYERS}
<div id="bar" class="abs"><i></i></div>
<div id="head" class="abs"><img src="file://${assets.logo}" alt=""><b>ИЛ ТОД МЭДЭЭ</b><span id="tag"></span></div>
<div id="card" class="abs sticker"><div id="hl"></div></div>
<div id="sub" class="abs mono"></div>
<div id="L-hook" class="layer"><div id="ask" class="sticker disp">ЧАМД<br>ХАМААТАЙ<br>ЮУ?<small>30 секундэд ойлгоё</small></div></div>
<div id="cards"></div>
<div id="L-cta" class="layer"><div id="bubble" class="sticker">Чамд хамаатай юу?</div>
 <div class="chips"><span class="chip sticker">iltodmedee.mn</span><span class="chip sticker" style="background:#2de2b0">Эх сурвалжтай</span></div>
 <div id="link"></div><div id="src" class="mono"></div></div>
<div id="cap" class="abs"></div>
<script>
${CINEMA_BG_JS}
const D=${data};
const T=D.tl, S=T.starts;
const $=id=>document.getElementById(id);
const clamp=v=>v<0?0:v>1?1:v;
const spring=t=>{t=clamp(t);return 1-Math.exp(-6*t)*Math.cos(9*t)};
$('tag').textContent=D.series;$('hl').textContent=D.headline;$('sub').textContent=D.sub;$('link').textContent=D.link;$('src').textContent=D.source;
for(const c of D.cards){const l=document.createElement('div');l.className='layer';l.id='L-'+c.scene;
 const b=document.createElement('span');b.className='lbl';b.style.background=c.color;b.textContent=c.label;
 const box=document.createElement('div');box.className='box sticker';const p=document.createElement('p');p.textContent=c.text;box.appendChild(p);
 l.append(b,box);$('cards').appendChild(l)}
const COLORS={hook:['#ff3d6e','#ffd166'],who:['#2de2b0','#3a7bff'],change:['#ffd166','#ff4fa3'],when:['#ff4fa3','#7b5cff'],action:['#3a7bff','#2de2b0'],cta:['#0fb5ae','#ff4fa3']};
const LAYERS=['hook',...D.cards.map(c=>c.scene),'cta'];
function sceneAt(t){let s=0;for(let i=0;i<S.length;i++)if(t>=S[i]-0.12)s=i;return s}
window.render=function(t){
 const s=sceneAt(t),sc=D.scenes[s],start=S[s];
 const c1=(COLORS[sc]||COLORS.hook)[0];
 $('bg').style.background=cinemaBg(t,c1);
 $('bar').firstElementChild.style.width=(100*clamp(t/T.total))+'%';
 const ck=spring(t/0.5);$('card').style.transform='rotate('+(-1.2*ck)+'deg) scale('+(0.85+0.15*ck)+')';$('card').style.opacity=Math.min(1,t/0.1);
 for(const id of LAYERS){const e=$('L-'+id);if(!e)continue;const on=sc===id;const v=on?spring((t-start)/0.45):0;
  e.style.opacity=on?Math.min(1,(t-start)/0.12):0;e.style.transform='translateX('+((1-v)*120)+'px) rotate('+((1-v)*3)+'deg)'}
 const ak=spring((t-0.25)/0.55);$('ask').style.transform='rotate('+(-3+1.5*Math.sin(t*4))+'deg) scale('+(0.4+0.6*ak)+')';
 // Captions: three words at a time, the spoken word lifted.
 const words=D.words[s],next=s+1<S.length?S[s+1]-0.15:T.speechEnd,from=s===0?0.2:start,span=Math.max(0.3,next-from)*0.96;
 const sum=words.reduce((x,w)=>x+w.weight,0)||1;let acc=0,cur=0;
 for(let i=0;i<words.length;i++){if(t>=from+span*acc/sum)cur=i;acc+=words[i].weight}
 const g0=Math.floor(cur/3)*3,cap=$('cap');cap.textContent='';
 for(let i=g0;i<Math.min(words.length,g0+3);i++){const w=document.createElement('span');w.textContent=words[i].text;if(words[i].hl)w.className='hl';if(i===cur)w.classList.add('on');cap.appendChild(w)}
};
// Long headlines and card texts shrink to fit their boxes.
window.fit=function(){const h=$('hl'),c=$('card');let fs=50;while(h.scrollHeight>c.clientHeight-52&&fs>28){fs-=2;h.style.fontSize=fs+'px'}
 // The box grows with its text up to 560 px (68 px of it padding): shrink only past that.
 document.querySelectorAll('.box p').forEach(p=>{let s=66;while(p.scrollHeight>492&&s>34){s-=2;p.style.fontSize=s+'px'}})};
window.render(0);
</script></body></html>`;
}
