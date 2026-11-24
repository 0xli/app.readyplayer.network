// @decentnetwork/beagle-embed@0.2.2, bundled for the browser by app/vendor.sh. Do not edit.
var p=`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#root{margin:0;height:100%;background:#0b0b0f}</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  function safe(value) {
    try {
      var u = new URL(value, location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return "";
      return u.href;
    } catch (e) { return ""; }
  }
  try {
    var ua = navigator.userAgent || "";
    if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)) {
      localStorage.setItem("beagle-web:backend", "ls");
    }
  } catch (e) {}
  var q = new URLSearchParams(location.search);
  globalThis.__BEAGLE_BRIDGE__ = q.get("bridge") || "";
  try {
    var mirror = "beagle-web:kv:identity";
    if (!localStorage.getItem(mirror)) {
      var raw = localStorage.getItem("beagle-connect:identity");
      if (raw) {
        var file = JSON.parse(raw);
        if (file && file.format === "decent-peer-tox-keypair-v1" && typeof file.publicKey === "string" && typeof file.secretKey === "string") {
          localStorage.setItem(mirror, JSON.stringify({ v: { format: file.format, publicKey: file.publicKey, secretKey: file.secretKey } }));
        }
      }
    }
  } catch (e) {}
  var names = ["react", "reactDom", "qrcode", "peerWebrtc", "chatComponents", "beagleWeb"];
  for (var i = 0; i < names.length; i++) {
    var src = safe(q.get(names[i]) || "");
    if (src) document.write("<script src=" + JSON.stringify(src) + "><\\/script>");
  }
  var ui = safe(q.get("beagleUi") || "");
  if (!ui) return;
  document.write("<script type=module>import { mount, setUiHost } from " + JSON.stringify(ui) + ";\\n"
    + "setUiHost({ hostNeedsWelcome: true, hostPrefersRtcFile: true, hostHasKeyBackup: true, hostAssistant: false, hostEnsWrite: false,"
    + " fileUrl: function (name) { return '/api/file-download?name=' + encodeURIComponent(name); },"
    + " fileDownloadUrl: function (name) { return '/api/file-download?name=' + encodeURIComponent(name) + '&dl=1'; } });\\n"
    + "mount(document.getElementById('root'));\\n"
    + "var raw = ''; try { raw = sessionStorage.getItem('beagle-embed:profile') || ''; } catch (e) {}\\n"
    + "if (!raw) {} else { var profile; try { profile = JSON.parse(raw); } catch (e) { profile = null; }\\n"
    + "var want = profile && String(profile.name || '').trim();\\n"
    + "if (want && want !== 'visitor') { var n = 0; var tick = function () {\\n"
    + "fetch('/api/state').then(function (r) { return r.json(); }).then(function (j) {\\n"
    + "var me = j.me || {}; var held = String(me.name || '').trim();\\n"
    + "if (!(me.userId || me.hasIdentity)) throw new Error('wait');\\n"
    + "if (held === want) return;\\n"
    + "var punk = Number.isInteger(profile.punkId) ? profile.punkId : null;\\n"
    + "var avatar = typeof profile.avatarDataUrl === 'string' && profile.avatarDataUrl.indexOf('data:image/') === 0 ? profile.avatarDataUrl : null;\\n"
    + "return fetch('/api/set-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: want, description: profile.description || '', punkId: punk, avatarDataUrl: avatar, onboarded: true }) });\\n"
    + "}).catch(function () { if (n++ < 20) setTimeout(tick, 300); }); }; tick(); } }\\n"
    + "<\\/script>");
})();
<\/script>
</body>
</html>
`;var v="https://app.beagle.chat",x=["http://127.0.0.1:8766","http://localhost:8766"];function S({pageLoopback:e,localUp:t}){return e&&t?"choose":"web"}function k(){try{let e=location.hostname;return e==="localhost"||e==="127.0.0.1"||e==="[::1]"}catch{return!1}}async function I(){for(let e of x)try{if((await fetch(e+"/api/state",{signal:AbortSignal.timeout(800)})).ok)return e}catch{}return null}function u(e){let t={title:e&&e.title||"Sign in with Beagle",local:e&&e.localLabel||"This computer",web:e&&e.webLabel||"app.beagle.chat"},n=JSON.stringify(t).replace(/</g,"\\u003c");return`<!doctype html>
<html><head><meta charset="utf-8"><title>${t.title.replace(/[<>&]/g,"")}</title>
<style>
  body { margin: 0; padding: 28px; background: #0b0b0f; color: #f4f4f5; font: 15px/1.4 ui-sans-serif, system-ui, sans-serif; }
  p { margin: 0 0 16px; }
  button { display: block; width: 100%; margin: 8px 0; padding: 12px 14px; border-radius: 10px; border: 1px solid #3f3f46; background: #18181b; color: #fff; font: inherit; text-align: left; cursor: pointer; }
  button:hover { border-color: #a78bfa; }
</style></head><body>
<p id="t"></p>
<button type="button" id="local"></button>
<button type="button" id="web"></button>
<script>
var L = ${n};
document.getElementById("t").textContent = L.title;
document.getElementById("local").textContent = L.local;
document.getElementById("web").textContent = L.web;
function pick(which) { if (window.opener) window.opener.postMessage({ type: "beagle-embed:pick", which: which }, "*"); }
document.getElementById("local").onclick = function () { pick("local"); };
document.getElementById("web").onclick = function () { pick("web"); };
<\/script>
</body></html>`}function E(e,t){return new Promise(n=>{let r=!1,o=c=>{r||(r=!0,window.removeEventListener("message",s),clearInterval(i),n(c))};function s(c){if(!e||c.source!==e)return;let l=c.data;!l||l.type!=="beagle-embed:pick"||o(l.which==="web"?"web":"local")}let i=setInterval(()=>{(!e||e.closed)&&o("closed")},300);window.addEventListener("message",s);try{e.document.open(),e.document.write(u(t)),e.document.close()}catch{o("closed")}})}function U(){return'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 17 6-6-6-6"/><path d="M12 18.5h7.5"/></svg>'}var D="0.2.2",g="/beagle-frame.html",m="beagle-embed:profile",C="https://app.beagle.chat",b="beagle-connect:identity",O=["http://127.0.0.1:8766","http://localhost:8766"];function d(e,t){let n=new URL(e||C);return t&&n.searchParams.set("address",t),n.href}function f(e){return JSON.stringify(e==null?"":String(e)).replace(/</g,"\\u003c")}function L(){return`<script>
(function () {
  try {
    var ua = navigator.userAgent || "";
    if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)) {
      localStorage.setItem("beagle-web:backend", "ls");
    }
  } catch (e) {}
  try {
    var mirror = "beagle-web:kv:identity";
    if (localStorage.getItem(mirror)) return;
    var raw = localStorage.getItem(${f(b)});
    if (!raw) return;
    var file = JSON.parse(raw);
    if (!file || file.format !== "decent-peer-tox-keypair-v1") return;
    if (typeof file.publicKey !== "string" || typeof file.secretKey !== "string") return;
    localStorage.setItem(mirror, JSON.stringify({ v: { format: file.format, publicKey: file.publicKey, secretKey: file.secretKey } }));
  } catch (e) {}
})();
<\/script>`}function y(e){try{let t=new URL(e);return t.protocol!=="http:"&&t.protocol!=="https:"?!1:t.hostname==="127.0.0.1"||t.hostname==="localhost"||t.hostname==="[::1]"}catch{return!1}}function B(e){if(!e||y(e))return!1;try{let t=new URL(e);return t.protocol==="http:"||t.protocol==="https:"}catch{return!1}}var w=["react","reactDom","qrcode","peerWebrtc","chatComponents","beagleWeb","beagleUi"];function R(e,t,n){let r=new URL(e||g,n||"http://localhost/"),o=t&&t.address,s=t&&t.bridgeUrl;o&&r.searchParams.set("address",o),s&&r.searchParams.set("bridge",s);let i=t&&t.assets||{};for(let c of w)i[c]&&r.searchParams.set(c,i[c]);return r.href}function F({address:e,bridgeUrl:t,assets:n}){let r=n||{},o=[r.react,r.reactDom,r.qrcode,r.peerWebrtc,r.chatComponents,r.beagleWeb].filter(Boolean).map(s=>`<script src=${f(s)}><\/script>`).join(`
`);return`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body,#root{margin:0;height:100%;background:#0b0b0f}</style>
</head>
<body>
<div id="root"></div>
${L()}
<script>
globalThis.__BEAGLE_BRIDGE__ = ${f(t||"")};
var address = ${f(e||"")};
<\/script>
${o}
<script type="module">
import { mount, setUiHost } from ${f(r.beagleUi)};
setUiHost({
  hostNeedsWelcome: true,
  hostPrefersRtcFile: true,
  hostHasKeyBackup: true,
  hostAssistant: false,
  hostEnsWrite: false,
  fileUrl: (name) => "/api/file-download?name=" + encodeURIComponent(name),
  fileDownloadUrl: (name) => "/api/file-download?name=" + encodeURIComponent(name) + "&dl=1",
});
mount(document.getElementById("root"));
<\/script>
</body>
</html>`}function K(){try{return localStorage.getItem(b)}catch{return null}}async function W(){for(let e of O)try{if((await fetch(e+"/api/state",{signal:AbortSignal.timeout(400)})).ok)return e}catch{}return null}function _(e){return new URL(e,location.href).href}function h(e,t){let n=document.createElement("iframe");return n.title="Beagle",n.style.cssText="border:0;width:100%;height:100%;display:block;background:#0b0b0f",n.src=t,e.replaceChildren(n),n}function T(e,t,n){let r=n||{},o=document.createElement("div");o.style.cssText="height:100%;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:24px;background:#0b0b0f;color:#f4f4f5;font:14px/1.45 ui-sans-serif,system-ui,sans-serif";let s=document.createElement("p");s.style.cssText="margin:0",s.textContent=r.webClient||"This Beagle keeps its key in its own tab, so this panel cannot use it.";let i=document.createElement("a");i.href=t,i.target="_blank",i.rel="noopener noreferrer",i.textContent=r.openWeb||"Open in a new tab",i.style.cssText="align-self:flex-start;padding:8px 12px;border:1px solid rgba(255,255,255,.25);border-radius:8px;color:#f4f4f5;text-decoration:none",o.append(s,i),e.replaceChildren(o)}function A(e){try{e&&String(e.name||"").trim()?sessionStorage.setItem(m,JSON.stringify(e)):sessionStorage.removeItem(m)}catch{}}function J(){return p}async function M(e,t={}){let n=t.address||"",r=t.clientOrigin||"";if(y(r)){let a=new URL(r.endsWith("/")?r:r+"/");return n&&a.searchParams.set("address",n),h(e,a.href),{opened:!0,reason:"client",installedOrigin:r,openUrl:a.href}}if(B(r)){let a=d(r,n);return T(e,a,t.labels),{opened:!1,reason:"web-client",installedOrigin:null,openUrl:a}}let o=t.mode==="in-tab"?"in-tab":"auto";if(!K()){let a=o==="in-tab"?null:await W();return{opened:!1,reason:a?"installed":"need-sign-in",installedOrigin:a,openUrl:d(a||t.beagleOrigin,n)}}let i=t.assets||{},c={};for(let a of w)i[a]&&(c[a]=_(i[a]));A(t.profile);let l=R(t.frameUrl||g,{address:n,bridgeUrl:t.bridgeUrl,assets:c},location.href);return h(e,l),{opened:!0,reason:"site",installedOrigin:null,openUrl:d(t.beagleOrigin,n)}}export{p as FRAME_HTML,g as FRAME_PATH,D as VERSION,v as WEB_CLIENT,d as beagleChatUrl,U as beagleMarkSvg,J as frameHtml,R as frameSrc,y as isInstalledOrigin,B as isWebOrigin,I as localBeagle,M as openChat,k as pageIsLoopback,F as panelHtml,E as showSignInChoice,S as signInChoice,u as signInChoiceHtml};
