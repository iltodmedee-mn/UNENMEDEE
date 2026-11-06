/**
 * The "ХҮН БҮРТ ХУВААВАЛ" video as one HTML page with `render(t)` (the same frame-by-frame
 * contract as scene-html.ts, rendered by render.ts). The hook is readable with the sound off from
 * the first frame: the story's headline on a white card, the amount huge in yellow and
 * "÷ 3.43 сая хүн = ?" popping in under it. Then the guess (three options, 3-2-1), the answer,
 * what it buys at today's prices as blocks, the comment ask. Text comes only from the spec, as
 * JSON with `<` escaped, and is set with textContent.
 */
import { POPULATION_LABEL } from "@/lib/per-person";

import type { MoneySpec } from "./money-video";
import { FRAME, type SceneAssets } from "./scene-html";
import { BLOCK_STEP_S, BLOCKS_AFTER_S, captionWords, type Timeline } from "./timing";
import { CINEMA_BG_JS, CINEMA_CSS, CINEMA_LAYERS } from "./theme";

export function moneyHtml(spec: MoneySpec, tl: Timeline, assets: SceneAssets): string {
  const data = JSON.stringify({
    series: spec.series,
    headline: spec.headline,
    sub: spec.sub,
    source: spec.source,
    amount: spec.amountLabel,
    divide: `÷ ${POPULATION_LABEL} хүн = ?`,
    question: spec.question,
    options: spec.options,
    relate: spec.relate,
    link: spec.link.replace(/\/article\/.*$/, ""),
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
#card{left:60px;right:70px;top:206px;height:236px;background:#fff;color:#000;padding:26px 32px;overflow:hidden}
#hl{font-family:Disp;font-weight:800;font-size:46px;line-height:1.1;letter-spacing:-.02em}
#sub{left:66px;right:60px;top:470px;font-size:28px;color:#e4e5e8}
.layer{position:absolute;left:60px;right:60px;top:540px;height:770px;opacity:0}
#amt{font-family:Disp;font-weight:850;font-size:150px;line-height:1;letter-spacing:-.05em;color:#ffd166;text-shadow:0 10px 0 #000}
#div{display:inline-block;margin-top:56px;background:#ff4fa3;color:#fff;font-family:Disp;font-weight:850;font-size:74px;padding:10px 30px;transform-origin:left center}
#q{width:740px;font-size:60px;line-height:1.08;text-shadow:0 6px 0 #000}
.opt{position:absolute;left:0;right:0;height:140px;background:#fff;color:#000;display:flex;align-items:center;gap:30px;padding:0 34px;transform-origin:center}
.opt .l{width:88px;height:88px;border-radius:50%;background:#ffd166;border:5px solid #000;display:grid;place-items:center;font-family:Disp;font-weight:850;font-size:52px}
.opt .v{font-family:Mono;font-size:72px;letter-spacing:-.03em}
.opt .x{position:absolute;left:-10px;right:-10px;top:50%;height:10px;background:#ff3d6e;transform:rotate(-4deg) scaleX(0);transform-origin:left;border-radius:5px}
.opt .ok{position:absolute;right:30px;width:92px;height:92px;border-radius:50%;background:#000;display:grid;place-items:center;opacity:0}
#count{position:absolute;right:0;top:-10px;width:170px;height:170px;border-radius:50%;background:#ffd166;color:#000;display:grid;place-items:center;font-family:Disp;font-weight:850;font-size:112px;opacity:0}
.p{position:absolute;width:26px;height:26px;border:4px solid #000;border-radius:6px}
#rel h2{font-size:70px;text-shadow:0 6px 0 #000}
.blocks{display:flex;flex-wrap:wrap;gap:16px;margin-top:44px;width:960px}
.blk{width:96px;height:96px;background:#ffd166;border:5px solid #000;box-shadow:6px 6px 0 #000;border-radius:14px;transform:scale(0)}
#relN{margin-top:46px;font-family:Disp;font-weight:850;font-size:96px;color:#2de2b0;text-shadow:0 8px 0 #000}
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
<div id="L-hook" class="layer"><div id="amt"></div><span id="div" class="sticker"></span></div>
<div id="L-quiz" class="layer"><div id="q" class="disp"></div><div id="count" class="sticker"></div></div>
<div id="L-relate" class="layer"><div id="rel"><h2 class="disp">Энэ мөнгөөр өнөөдөр:</h2><div class="blocks" id="blocks"></div><div id="relN"></div></div></div>
<div id="L-cta" class="layer"><div id="bubble" class="sticker">Юунд зарцуулагдах вэ?</div>
 <div class="chips"><span class="chip sticker">iltodmedee.mn</span><span class="chip sticker" style="background:#2de2b0">Эх сурвалжтай</span></div>
 <div id="link"></div><div id="src" class="mono"></div></div>
<div id="cap" class="abs"></div>
<script>
${CINEMA_BG_JS}
const D=${data};
const T=D.tl, S=T.starts;
const $=id=>document.getElementById(id);
const clamp=v=>v<0?0:v>1?1:v;
const easeOut=t=>1-Math.pow(1-clamp(t),3);
const spring=t=>{t=clamp(t);return 1-Math.exp(-6*t)*Math.cos(9*t)};
$('tag').textContent=D.series;$('hl').textContent=D.headline;$('sub').textContent=D.sub;
$('amt').textContent=D.amount;$('div').textContent=D.divide;$('q').textContent=D.question;$('link').textContent=D.link;$('src').textContent=D.source;
const COLORS={hook:['#ffd166','#ff3d6e'],quiz:['#ffd166','#0fb5ae'],reveal:['#2de2b0','#ffd166'],relate:['#3a7bff','#2de2b0'],cta:['#0fb5ae','#ff4fa3']};
const L=$('L-quiz');const opts=D.options.map((o,i)=>{const e=document.createElement('div');e.className='opt sticker';e.style.top=(190+i*170)+'px';
 const l=document.createElement('div');l.className='l';l.textContent='ABC'[i];const v=document.createElement('div');v.className='v';v.textContent=o.text;
 const x=document.createElement('div');x.className='x';const ok=document.createElement('div');ok.className='ok';
 ok.innerHTML='<svg width="54" height="54" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#2de2b0" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 e.append(l,v,x,ok);L.appendChild(e);return {e,o,x,ok}});
const PC=['#ffd166','#ff4fa3','#2de2b0','#3a7bff','#fff'];
const parts=Array.from({length:16},(_,i)=>{const p=document.createElement('div');p.className='p';p.style.background=PC[i%PC.length];L.appendChild(p);return {p,a:i*(Math.PI*2/16)+0.2*Math.sin(i*7),d:260+60*((i*37)%5)}});
const R=D.relate,blocks=[];
if(R){const n=Math.min(12,Math.ceil(R.count));for(let i=0;i<n;i++){const b=document.createElement('div');b.className='blk';const frac=R.count-i;if(frac<1)b.style.width=Math.max(24,96*frac)+'px';$('blocks').appendChild(b);blocks.push(b)}
 $('relN').textContent=R.text}
function sceneAt(t){let s=0;for(let i=0;i<S.length;i++)if(t>=S[i]-0.12)s=i;return s}
const layerOf=sc=>sc==='reveal'?'quiz':sc;
const LAYERS=['hook','quiz','relate','cta'];
window.render=function(t){
 const s=sceneAt(t),sc=D.scenes[s],start=S[s];
 const c1=(COLORS[sc]||COLORS.quiz)[0];
 $('bg').style.background=cinemaBg(t,c1);
 $('bar').firstElementChild.style.width=(100*clamp(t/T.total))+'%';
 // The headline card lands first and stays: the hook for viewers with the sound off.
 const ck=spring(t/0.5);$('card').style.transform='rotate('+(-1.2*ck)+'deg) scale('+(0.85+0.15*ck)+')';$('card').style.opacity=Math.min(1,t/0.1);
 for(const id of LAYERS){const e=$('L-'+id),on=layerOf(sc)===id;let from=start;for(let j=s;j>=0&&layerOf(D.scenes[j])===id;j--)from=S[j];
  const v=on?spring((t-from)/0.45):0;e.style.opacity=on?Math.min(1,(t-from)/0.12):0;e.style.transform='translateY('+((1-v)*60)+'px) scale('+(0.94+0.06*v)+')'}
 // Hook: the amount slams in, then "÷ 3.43 сая хүн = ?".
 const ak=spring((t-0.15)/0.5);$('amt').style.transform='scale('+(1.6-0.6*ak)+')';$('amt').style.transformOrigin='left top';
 const dk=spring((t-0.9)/0.5);$('div').style.transform='rotate('+(-4+2*Math.sin(t*5))+'deg) scale('+dk+')';
 const qs=S[D.scenes.indexOf('quiz')]??1e9,reveal=S[D.scenes.indexOf('reveal')]??1e9;
 opts.forEach((o,i)=>{const k=spring((t-qs-0.35-i*0.22)/0.5);let sc2=0.6+0.4*k;const r=clamp((t-reveal)/0.35);
  if(o.o.correct){o.e.style.background=r>0?'#2de2b0':'#fff';sc2*=1+0.09*Math.sin(Math.PI*r);o.ok.style.opacity=r;o.ok.style.transform='scale('+spring((t-reveal)/0.4)+')';o.e.style.opacity=k}
  else{o.e.style.opacity=k*(1-0.6*r);o.x.style.transform='rotate(-4deg) scaleX('+easeOut((t-reveal-0.1)/0.3)+')'}
  o.e.style.transform='scale('+sc2+') rotate('+((i-1)*0.8*(1-k))+'deg)'});
 const cd=$('count'),pc=t-T.pauseAt;
 if(T.pause&&pc>=0&&pc<T.pause){const n=3-Math.floor(pc/0.7);const ph=(pc%0.7)/0.7;cd.style.opacity=1;cd.textContent=String(Math.max(1,n));cd.style.transform='scale('+(1.25-0.25*easeOut(ph*2))+') rotate('+(-6+12*ph)+'deg)'}else cd.style.opacity=0;
 const ci=opts.findIndex(o=>o.o.correct),pr=t-reveal;
 parts.forEach((q,i)=>{if(pr<0||pr>1){q.p.style.opacity=0;return}const k=easeOut(pr/0.8);q.p.style.opacity=1-clamp((pr-0.5)/0.5);
  q.p.style.left=(480+Math.cos(q.a)*q.d*k-13)+'px';q.p.style.top=(190+ci*170+70+Math.sin(q.a)*q.d*0.7*k-13)+'px';q.p.style.transform='rotate('+(pr*400+i*30)+'deg)'});
 const rs=S[D.scenes.indexOf('relate')]??1e9;
 blocks.forEach((b,i)=>{b.style.transform='scale('+spring((t-rs-D.blocksAfter-i*D.blockStep)/0.35)+')'});
 $('relN').style.opacity=clamp((t-rs-D.blocksAfter-blocks.length*D.blockStep)/0.2);
 // Captions: three words at a time, the spoken word lifted; the sentence before the answer ends at the pause.
 const words=D.words[s],next=s+1<S.length?S[s+1]-0.15:T.speechEnd,end=D.scenes[s+1]==='reveal'&&T.pause?T.pauseAt:next,from=s===0?0.2:start,span=Math.max(0.3,end-from)*0.96;
 const sum=words.reduce((x,w)=>x+w.weight,0)||1;let acc=0,cur=0;
 for(let i=0;i<words.length;i++){if(t>=from+span*acc/sum)cur=i;acc+=words[i].weight}
 const g0=Math.floor(cur/3)*3,cap=$('cap');cap.textContent='';
 for(let i=g0;i<Math.min(words.length,g0+3);i++){const w=document.createElement('span');w.textContent=words[i].text;if(words[i].hl)w.className='hl';if(i===cur)w.classList.add('on');cap.appendChild(w)}
};
// Long headlines and amounts shrink to fit their boxes.
window.fit=function(){const h=$('hl'),c=$('card');let fs=46;while(h.scrollHeight>c.clientHeight-52&&fs>28){fs-=2;h.style.fontSize=fs+'px'}
 const m=$('amt');let ms=150;while(m.scrollWidth>960&&ms>80){ms-=6;m.style.fontSize=ms+'px'}};
window.render(0);
</script></body></html>`;
}
