/** Inline in the root layout's <head>: the page view's first own-origin JavaScript error, sent once (src/lib/client-errors.ts). */
export const CLIENT_ERROR_SCRIPT =
  "(function(){var n=0;function s(m){if(n++||!m)return;try{navigator.sendBeacon('/api/client-error',JSON.stringify({m:String(m).slice(0,200),p:location.pathname}))}catch(e){}}" +
  "addEventListener('error',function(e){if(e.filename&&e.filename.indexOf(location.origin)===0)s(e.message)});" +
  "addEventListener('unhandledrejection',function(e){var r=e.reason;s(r&&r.message||r)})})()";
