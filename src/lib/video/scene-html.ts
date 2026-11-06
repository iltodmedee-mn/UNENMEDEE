/**
 * The video as one HTML page (1080×1920) with a `render(t)` function: Playwright calls it for every
 * frame and screenshots the result (render.ts), so the animation is exact and the same every time.
 * The look is made for short-video feeds, not a slide: a moving colour field per scene, sticker
 * cards with thick outlines and hard shadows, springy pop-ins, a progress bar, big outlined
 * word-by-word captions, all inside the Reels/TikTok safe zone (no text under the top 200 px of
 * app chrome or the bottom 420 px of captions and buttons). Text comes only from the spec (our
 * data and wording) as JSON with `<` escaped, and is put on the page with textContent, never as HTML.
 */
import type { VideoSpec } from "./price-video";
import { BLOCK_STEP_S, BLOCKS_AFTER_S, captionWords, type Timeline } from "./timing";
import { CINEMA_BG_JS, CINEMA_CSS, CINEMA_LAYERS, posterFontFace } from "./theme";

export interface SceneAssets {
  /** Absolute directory holding inter-var.woff2, inter-display-var.woff2, jetbrains-mono-500.woff2 and oswald-700.woff. */
  fontsDir: string;
  /** Absolute path of the square logo PNG. */
  logo: string;
}

export const FRAME = { width: 1080, height: 1920 };

export function sceneHtml(spec: VideoSpec, tl: Timeline, assets: SceneAssets): string {
  const data = JSON.stringify({
    title: spec.title,
    sub: spec.sub,
    source: spec.source,
    series: spec.series,
    question: spec.question,
    options: spec.options,
    months: spec.months.slice(spec.from, spec.to + 1),
    values: spec.series_.slice(spec.from, spec.to + 1),
    then: spec.then,
    now: spec.now,
    ratio: Math.round((spec.now.value / spec.then.value) * 10) / 10,
    units: spec.units,
    yearPct: spec.yearPct,
    link: spec.link.replace(/#.*$/, ""),
    scenes: spec.sentences.map((s) => s.scene),
    words: spec.sentences.map((s) => captionWords(s.caption)),
    tl,
    blocksAfter: BLOCKS_AFTER_S,
    blockStep: BLOCK_STEP_S,
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
#title{left:60px;right:60px;top:210px;font-size:112px;line-height:1;text-shadow:0 8px 0 #000}
#sub{left:60px;right:60px;top:336px;font-size:30px;color:#c9cbd0}
#src{left:60px;right:60px;top:380px;font-size:22px;color:#9ea1a8}
.layer{position:absolute;left:60px;right:60px;top:440px;height:860px;opacity:0}
#q{width:740px;font-size:62px;line-height:1.08;text-shadow:0 6px 0 #000}
.opt{position:absolute;left:0;right:0;height:150px;background:#fff;color:#000;display:flex;align-items:center;gap:30px;padding:0 34px;transform-origin:center}
.opt .l{width:92px;height:92px;border-radius:50%;background:#ffd166;border:5px solid #000;display:grid;place-items:center;font-family:Disp;font-weight:850;font-size:54px}
.opt .v{font-family:Mono;font-size:76px;letter-spacing:-.03em}
.opt .x{position:absolute;left:-10px;right:-10px;top:50%;height:10px;background:#ff3d6e;transform:rotate(-4deg) scaleX(0);transform-origin:left;border-radius:5px}
.opt .ok{position:absolute;right:30px;width:96px;height:96px;border-radius:50%;background:#000;display:grid;place-items:center;opacity:0}
#count{position:absolute;right:0;top:-10px;width:176px;height:176px;border-radius:50%;background:#ffd166;color:#000;display:grid;place-items:center;font-family:Disp;font-weight:850;font-size:116px;opacity:0}
.p{position:absolute;width:26px;height:26px;border:4px solid #000;border-radius:6px}
#nowTag{display:inline-block;background:#ff4fa3;color:#fff;font-family:Disp;font-weight:850;font-size:64px;padding:6px 26px;transform:rotate(2deg)}
#nowNum{position:absolute;left:0;top:120px;font-family:Mono;font-size:196px;letter-spacing:-.05em;color:#ffd166;text-shadow:0 10px 0 #000,0 0 40px rgba(0,0,0,.4)}
#ratio{position:absolute;right:0;top:330px;background:#2de2b0;color:#000;font-family:Disp;font-weight:850;font-size:84px;padding:4px 26px;opacity:0}
#chart{position:absolute;left:0;top:470px;width:960px;height:360px}
#rel h2{font-size:70px;text-shadow:0 6px 0 #000}
.row{display:flex;align-items:center;gap:22px;margin-top:40px}
.row .y{font-family:Mono;font-size:44px;width:130px;color:#c9cbd0}
.blocks{display:flex;flex-wrap:wrap;gap:14px;width:540px}
.blk{width:74px;height:74px;background:#ffd166;border:5px solid #000;box-shadow:6px 6px 0 #000;border-radius:12px;transform:scale(0)}
.row .n{font-family:Mono;font-size:56px;margin-left:auto;white-space:nowrap}
#big{position:absolute;left:50%;top:150px;transform:translateX(-50%) rotate(-6deg);background:#ff3d6e;padding:24px 50px 34px;text-align:center}
#big .s{font-family:Disp;font-weight:850;font-size:64px}
#big .b{font-family:Disp;font-weight:850;font-size:230px;line-height:1;letter-spacing:-.05em}
#bubble{background:#fff;color:#000;font-family:Disp;font-weight:850;font-size:84px;line-height:1.05;padding:40px 44px;position:relative}
#bubble:after{content:"";position:absolute;left:90px;bottom:-46px;border:22px solid transparent;border-top:24px solid #fff}
.chips{display:flex;gap:20px;margin-top:70px}
.chip{background:#ffd166;color:#000;font-family:Disp;font-weight:850;font-size:46px;padding:14px 26px}
#link{margin-top:56px;font-family:Disp;font-weight:850;font-size:66px;color:#ffd166;text-shadow:0 6px 0 #000}
#cap{left:70px;right:70px;top:1330px;height:230px;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:0 26px;font-family:Disp;font-weight:850;font-size:76px;line-height:1.12;text-align:center}
#cap span{display:inline-block;color:#fff;text-shadow:-4px -4px 0 #000,4px -4px 0 #000,-4px 4px 0 #000,4px 4px 0 #000,0 9px 0 #000}
#cap span.hl{color:#ffd166}
#cap span.on{transform:translateY(-8px)}
${CINEMA_CSS}</style></head><body>
<div id="bg"></div>${CINEMA_LAYERS}
<div id="bar" class="abs"><i></i></div>
<div id="head" class="abs"><img src="file://${assets.logo}" alt=""><b>ИЛ ТОД МЭДЭЭ</b><span id="tag"></span></div>
<div id="title" class="abs disp"></div>
<div id="sub" class="abs"></div>
<div id="src" class="abs mono"></div>
<div id="L-quiz" class="layer"><div id="q" class="disp"></div><div id="count" class="sticker"></div></div>
<div id="L-now" class="layer"><span id="nowTag" class="sticker">ОДОО</span><div id="nowNum"></div><div id="ratio" class="sticker"></div>
 <svg id="chart" viewBox="0 0 960 360"><path id="area" fill="rgba(255,255,255,.14)"/><path id="line" fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/><circle id="dot" r="16" fill="#ffd166" stroke="#000" stroke-width="5"/><text id="y0" x="0" y="350" fill="#c9cbd0" font-family="Mono" font-size="30"></text><text id="y1" x="960" y="350" text-anchor="end" fill="#c9cbd0" font-family="Mono" font-size="30"></text></svg></div>
<div id="L-relate" class="layer"><div id="rel"><h2 class="disp">Энэ мөнгөөр:</h2>
 <div class="row"><span class="y" id="rY0"></span><div class="blocks" id="bThen"></div><span class="n" id="nThen"></span></div>
 <div class="row"><span class="y" id="rY1"></span><div class="blocks" id="bNow"></div><span class="n" id="nNow"></span></div></div></div>
<div id="L-change" class="layer"><div id="big2" class="sticker" style="position:absolute;left:50%;top:150px;transform:translateX(-50%) rotate(-6deg);background:#2de2b0;color:#000;padding:24px 50px 34px"><div class="disp" id="chg" style="font-size:200px;line-height:1"></div></div></div>
<div id="L-year" class="layer"><div id="big" class="sticker"><div class="s">1 жилд</div><div class="b" id="yr"></div></div></div>
<div id="L-cta" class="layer"><div id="bubble" class="sticker">Танайд хэд байна?</div>
 <div class="chips"><span class="chip sticker">iltodmedee.mn</span><span class="chip sticker" style="background:#2de2b0">Эх сурвалжтай</span></div>
 <div id="link"></div></div>
<div id="cap" class="abs"></div>
<script>
${CINEMA_BG_JS}
const D=${data};
const T=D.tl, S=T.starts;
const $=id=>document.getElementById(id);
const clamp=v=>v<0?0:v>1?1:v;
const easeOut=t=>1-Math.pow(1-clamp(t),3);
// A spring with a small overshoot: pop-ins land with a bounce.
const spring=t=>{t=clamp(t);return 1-Math.exp(-6*t)*Math.cos(9*t)};
const fmt=n=>Math.round(n).toLocaleString('en-US').replace(/,/g,'\\u2009');
$('tag').textContent=D.series;$('title').textContent=D.title;$('sub').textContent=D.sub;$('src').textContent=D.source;
$('q').textContent=D.question;
const COLORS={quiz:['#ffd166','#0fb5ae'],reveal:['#2de2b0','#ffd166'],now:['#ff4fa3','#7b5cff'],relate:['#3a7bff','#2de2b0'],change:['#2de2b0','#3a7bff'],year:['#ff3d6e','#ffd166'],cta:['#0fb5ae','#ff4fa3']};
// Options
const L=$('L-quiz');const opts=D.options.map((o,i)=>{const e=document.createElement('div');e.className='opt sticker';e.style.top=(200+i*184)+'px';
 const l=document.createElement('div');l.className='l';l.textContent='ABC'[i];const v=document.createElement('div');v.className='v';v.textContent=o.text;
 const x=document.createElement('div');x.className='x';const ok=document.createElement('div');ok.className='ok';
 ok.innerHTML='<svg width="56" height="56" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#2de2b0" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 e.append(l,v,x,ok);L.appendChild(e);return {e,o,x,ok}});
// Confetti squares
const PC=['#ffd166','#ff4fa3','#2de2b0','#3a7bff','#fff'];
const parts=Array.from({length:16},(_,i)=>{const p=document.createElement('div');p.className='p';p.style.background=PC[i%PC.length];L.appendChild(p);return {p,a:i*(Math.PI*2/16)+0.2*Math.sin(i*7),d:260+60*((i*37)%5)}});
// Chart
const V=D.values,W=960,H=320,max=Math.max(...V.filter(v=>v!=null))*1.08,min=0;
const cx=i=>12+(W-24)*i/(V.length-1),cy=v=>H-12-(H-24)*(v-min)/(max-min);
function path(k){let p='';for(let i=0;i<=k;i++){if(V[i]==null)continue;p+=(p?'L':'M')+cx(i).toFixed(1)+','+cy(V[i]).toFixed(1)}return [p,p?p+'L'+cx(k)+','+H+'L'+cx(0)+','+H+'Z':'']}
$('y0').textContent=D.then.month.slice(0,4);$('y1').textContent=D.now.month.slice(0,4);
// Relate blocks
const units=D.units;
if(units){$('rY0').textContent=D.then.month.slice(0,4);$('rY1').textContent=D.now.month.slice(0,4);
 $('nThen').textContent=units.count+' '+units.unit;$('nNow').textContent='1 '+units.unit;}
const bThen=[],n=units?Math.min(12,Math.ceil(units.count)):0;
for(let i=0;i<n;i++){const b=document.createElement('div');b.className='blk';const frac=units.count-i;if(frac<1)b.style.width=Math.max(18,74*frac)+'px';$('bThen').appendChild(b);bThen.push(b)}
const bNow=document.createElement('div');bNow.className='blk';bNow.style.background='#ff4fa3';$('bNow').appendChild(bNow);
if(D.yearPct!==null){$('yr').textContent=(D.yearPct>0?'+':'−')+Math.abs(D.yearPct)+'%'}
const chgPct=Math.round((D.now.value/D.then.value-1)*100);$('chg').textContent=(chgPct>=0?'+':'−')+Math.abs(chgPct)+'%';
$('ratio').textContent='×'+D.ratio.toFixed(1);
$('link').textContent=D.link;
function sceneAt(t){let s=0;for(let i=0;i<S.length;i++)if(t>=S[i]-0.12)s=i;return s}
const layerOf=sc=>sc==='reveal'?'quiz':sc;
const LAYERS=['quiz','now','relate','change','year','cta'];
window.render=function(t){
 const s=sceneAt(t),sc=D.scenes[s],start=S[s];
 // Background: two drifting colour fields per scene.
 const c1=COLORS[sc][0];
 $('bg').style.background=cinemaBg(t,c1);
 $('bar').firstElementChild.style.width=(100*clamp(t/T.total))+'%';
 for(const id of LAYERS){const e=$('L-'+id),on=layerOf(sc)===id;let from=start;for(let j=s;j>=0&&layerOf(D.scenes[j])===id;j--)from=S[j];
  const v=on?spring((t-from)/0.45):0;e.style.opacity=on?Math.min(1,(t-from)/0.12):0;e.style.transform='translateY('+((1-v)*60)+'px) scale('+(0.94+0.06*v)+')'}
 // Quiz: options pop in, then the 3-2-1, then the reveal.
 const reveal=S[D.scenes.indexOf('reveal')]??1e9;
 opts.forEach((o,i)=>{const k=spring((t-0.35-i*0.22)/0.5);let sc2=0.6+0.4*k;
  const r=clamp((t-reveal)/0.35);
  if(o.o.correct){o.e.style.background=r>0?'#2de2b0':'#fff';sc2*=1+0.09*Math.sin(Math.PI*r);o.ok.style.opacity=r;o.ok.style.transform='scale('+spring((t-reveal)/0.4)+')'}
  else{o.e.style.opacity=k*(1-0.6*r);o.x.style.transform='rotate(-4deg) scaleX('+easeOut((t-reveal-0.1)/0.3)+')'}
  if(o.o.correct)o.e.style.opacity=k;
  o.e.style.transform='scale('+sc2+') rotate('+((i-1)*0.8*(1-k))+'deg)'});
 const cd=$('count'),pc=t-T.pauseAt;
 if(T.pause&&pc>=0&&pc<T.pause){const n=3-Math.floor(pc/0.7);const ph=(pc%0.7)/0.7;cd.style.opacity=1;cd.textContent=String(Math.max(1,n));cd.style.transform='scale('+(1.25-0.25*easeOut(ph*2))+') rotate('+(-6+12*ph)+'deg)'}else cd.style.opacity=0;
 const ci=opts.findIndex(o=>o.o.correct),pr=t-reveal;
 parts.forEach((q,i)=>{if(pr<0||pr>1){q.p.style.opacity=0;return}const k=easeOut(pr/0.8);q.p.style.opacity=1-clamp((pr-0.5)/0.5);
  q.p.style.left=(480+Math.cos(q.a)*q.d*k-13)+'px';q.p.style.top=(200+ci*184+75+Math.sin(q.a)*q.d*0.7*k-13)+'px';q.p.style.transform='rotate('+(pr*400+i*30)+'deg)'});
 // Now: the counter runs from then to now while the line draws.
 const ns=S[D.scenes.indexOf('now')]??1e9,k=easeOut((t-ns-0.35)/1.7);
 const val=D.then.value+(D.now.value-D.then.value)*k;$('nowNum').textContent=fmt(val)+'₮';
 const ki=Math.round((V.length-1)*k);const [p,ar]=path(ki);$('line').setAttribute('d',p);$('area').setAttribute('d',ar);
 $('dot').setAttribute('cx',cx(ki));$('dot').setAttribute('cy',cy(V[ki]??D.now.value));
 const rr=spring((t-ns-2.15)/0.5);$('ratio').style.opacity=t>ns+2.15?1:0;$('ratio').style.transform='rotate(6deg) scale('+rr+')';
 // Relate: blocks pop one by one.
 const rs=S[D.scenes.indexOf('relate')]??1e9;
 bThen.forEach((b,i)=>{b.style.transform='scale('+spring((t-rs-D.blocksAfter-i*D.blockStep)/0.35)+')'});
 bNow.style.transform='scale('+spring((t-rs-D.blocksAfter-n*D.blockStep-0.2)/0.35)+')';
 // Year sticker wiggles.
 const ys=S[D.scenes.indexOf('year')]??1e9,yk=spring((t-ys)/0.5);
 $('big').style.transform='translateX(-50%) rotate('+(-6+2.5*Math.sin((t-ys)*7))+'deg) scale('+(0.5+0.5*yk)+')';
 // Captions: three words at a time, the spoken word lifted.
 const words=D.words[s],end=(s+1<S.length?S[s+1]-0.15:T.speechEnd),from=s===0?0.2:start,span=Math.max(0.3,(s===0?T.pauseAt:end)-from)*0.96;
 const sum=words.reduce((x,w)=>x+w.weight,0)||1;let acc=0,cur=0;
 for(let i=0;i<words.length;i++){if(t>=from+span*acc/sum)cur=i;acc+=words[i].weight}
 const g0=Math.floor(cur/3)*3,cap=$('cap');cap.textContent='';
 for(let i=g0;i<Math.min(words.length,g0+3);i++){const w=document.createElement('span');w.textContent=words[i].text;if(words[i].hl)w.className='hl';if(i===cur)w.classList.add('on');cap.appendChild(w)}
};
window.fit=function(){const e=$('title');let fs=112;while(e.scrollWidth>e.clientWidth&&fs>64){fs-=6;e.style.fontSize=fs+'px'}};
window.render(0);
</script></body></html>`;
}
