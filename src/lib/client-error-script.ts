/**
 * Inline in the root layout's <head>: the page view's first own-origin JavaScript error
 * (src/lib/client-errors.ts). A broken page must not turn every reader into a request: one report
 * per browser per day at most (localStorage), and only CLIENT_SAMPLE of browsers send it.
 */
export const CLIENT_SAMPLE = 0.1;

export const CLIENT_ERROR_SCRIPT =
  "(function(){var n=0;function s(m){if(n++||!m)return;try{var k='iltod-err',d=new Date().toDateString();if(localStorage.getItem(k)===d)return;localStorage.setItem(k,d)}catch(e){return}" +
  `if(Math.random()<${CLIENT_SAMPLE})try{navigator.sendBeacon('/api/client-error',JSON.stringify({m:String(m).slice(0,200),p:location.pathname}))}catch(e){}}` +
  "addEventListener('error',function(e){if(e.filename&&e.filename.indexOf(location.origin)===0)s(e.message)});" +
  "addEventListener('unhandledrejection',function(e){var r=e.reason;s(r&&r.message||r)})})()";
