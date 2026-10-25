// On your PC (Live Server) it talks to localhost. Online it uses its own address.
const API = ["5500", "5501"].includes(location.port) ? "http://localhost:5001" : location.origin;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

// Redraw a section only when its content changed (stops the shaking)
const _cache = {};
function setHTML(id, html) {
  const e = $(id);
  if (e && _cache[id] !== html) { _cache[id] = html; e.innerHTML = html; }
}

async function api(path, method = "GET", body) {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.token },
    body: body && JSON.stringify(body),
  });
  const d = await r.json();
  // Wrong or expired login: go back to the login page
  if (r.status === 401 || r.status === 403) {
    localStorage.clear();
    location = "index.html";
    throw new Error("Please login again");
  }
  if (!r.ok) throw new Error(d.error);
  return d;
}
function guard(role) { if (localStorage.role !== role) location = "index.html"; }
function logout() { localStorage.clear(); location = "index.html"; }

// A different beep pattern for each message type
function beep(type) {
  const seq = { placed: [660, 880], flying: [523, 659, 784], delayed: [300, 220, 300],
    delivered: [880, 1100, 880, 1320], alert: [440, 440] }[type] || [600];
  const a = new (window.AudioContext || window.webkitAudioContext)();
  seq.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = f; o.connect(g); g.connect(a.destination);
    o.start(a.currentTime + i * 0.25); o.stop(a.currentTime + i * 0.25 + 0.2);
  });
}

function toast(n) {
  let box = $("toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const d = document.createElement("div");
  d.className = "toast " + n.type;
  d.textContent = n.text;
  box.appendChild(d);
  setTimeout(() => d.remove(), 7000);
  try { beep(n.type); } catch {}
}

let lastId = 0, firstLoad = true;
async function pollNotes() {
  const list = await api("/api/notifications");
  list.forEach((x) => { if (x.id > lastId) { lastId = x.id; if (!firstLoad) toast(x); } });
  firstLoad = false;
  setHTML("notes", list.slice(-6).reverse()
    .map((x) => `<div class="card ${x.type}">${esc(x.text)}</div>`).join("") || "No messages yet.");
}

// ---------- MAYVEX brand: logo, splash screen, app setup ----------
const LOGO = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="mvg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5252"/><stop offset="1" stop-color="#7f0000"/></linearGradient></defs>
<rect width="120" height="120" rx="28" fill="url(#mvg)"/>
<circle class="mv-ring" cx="60" cy="64" r="30" fill="none" stroke="#fff" stroke-width="2"/>
<g class="mv-float">
<path d="M34 42 L52 58 M86 42 L68 58 M34 88 L52 72 M86 88 L68 72" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
<ellipse class="mv-spin" cx="30" cy="38" rx="14" ry="3" fill="#fff" opacity=".9"/>
<ellipse class="mv-spin" cx="90" cy="38" rx="14" ry="3" fill="#fff" opacity=".9"/>
<ellipse class="mv-spin" cx="30" cy="92" rx="14" ry="3" fill="#fff" opacity=".9"/>
<ellipse class="mv-spin" cx="90" cy="92" rx="14" ry="3" fill="#fff" opacity=".9"/>
<rect x="46" y="52" width="28" height="26" rx="9" fill="#fff"/>
<rect x="57" y="57" width="6" height="16" rx="1.5" fill="#d32f2f"/>
<rect x="52" y="62" width="16" height="6" rx="1.5" fill="#d32f2f"/>
</g></svg>`;

function splash() {
  if (sessionStorage.splashed) return;
  sessionStorage.splashed = "1";
  const s = document.createElement("div");
  s.id = "splash";
  s.innerHTML = `<div class="sp-logo">${LOGO}</div>
    <div class="sp-name">${"MAYVEX".split("").map((c, i) =>
      `<span style="animation-delay:${0.6 + i * 0.12}s">${c}</span>`).join("")}</div>
    <div class="sp-tag">Medicine, delivered from the sky</div>`;
  document.body.appendChild(s);
  setTimeout(() => s.classList.add("out"), 2700);
  setTimeout(() => s.remove(), 3400);
}

function brand() {
  document.title = "MAYVEX";
  document.head.insertAdjacentHTML("beforeend",
    `<link rel="manifest" href="manifest.json"><meta name="theme-color" content="#b71c1c">
     <link rel="icon" href="logo.svg" type="image/svg+xml">`);
  const b = document.querySelector(".top b");
  if (b) {
    const seller = /Seller/.test(b.textContent);
    b.innerHTML = `<span class="brand">${LOGO}<span>MAYVEX</span></span>` +
      (seller ? ' <small style="font-weight:normal">Seller</small>' : "");
  }
  splash();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("DOMContentLoaded", brand);

document.head.insertAdjacentHTML("beforeend", `<style>
html{overflow-y:scroll;overflow-anchor:none}
body{font-family:Arial,sans-serif;margin:0;background:#f4f6f8}
.top{background:linear-gradient(90deg,#b71c1c,#d32f2f);color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center}
.wrap{display:flex;gap:12px;padding:12px;flex-wrap:wrap;align-items:flex-start}.col{flex:1;min-width:300px}
.box{background:#fff;border-radius:6px;padding:12px;margin-bottom:12px;border:1px solid #ddd}
.card{border:1px solid #ddd;border-left:4px solid #1976d2;padding:6px;margin:5px 0;font-size:13px;background:#fff}
.card.delayed{border-left-color:#f57c00}.card.delivered{border-left-color:#2e7d32}.card.alert{border-left-color:#c62828}
input,select,button{width:100%;padding:7px;margin-top:6px;box-sizing:border-box}
button{background:#d32f2f;color:#fff;border:0;border-radius:4px;cursor:pointer;transition:transform .15s,filter .15s}
button:hover{filter:brightness(1.12);transform:translateY(-1px)}button:active{transform:scale(.97)}
.card button{width:auto;padding:3px 8px;margin:2px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #eee;padding:5px;text-align:left}
#toasts{position:fixed;right:16px;top:60px;z-index:9999;width:300px}
.toast{background:#263238;color:#fff;padding:12px 16px;border-radius:6px;margin-bottom:8px;animation:slideIn .4s ease}
.toast.delayed{background:#e65100}.toast.delivered{background:#2e7d32}.toast.alert{background:#b71c1c}
@keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:none;opacity:1}}
.low{color:#e65100;font-weight:bold}.out{color:#c62828;font-weight:bold}
#notes{min-height:120px}
.med{transition:transform .2s,box-shadow .2s}.med:hover{transform:translateY(-3px);box-shadow:0 6px 14px #0002}
.chip{transition:background .2s}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:800;letter-spacing:3px;font-size:20px}
.brand svg{width:36px;height:36px}
.mv-spin{animation:mvspin .45s linear infinite;transform-box:fill-box;transform-origin:center}
.mv-float{animation:mvfloat 3s ease-in-out infinite}
.mv-ring{animation:mvring 2.4s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes mvspin{to{transform:rotate(360deg)}}
@keyframes mvfloat{50%{transform:translateY(-4px)}}
@keyframes mvring{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.5);opacity:0}}
#splash{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(circle at 50% 40%,#d32f2f,#4a0000);color:#fff;transition:opacity .6s}
#splash.out{opacity:0;pointer-events:none}
.sp-logo svg{width:140px;height:140px;animation:pop .9s cubic-bezier(.2,1.4,.4,1) both;filter:drop-shadow(0 10px 20px #0006)}
.sp-name{margin-top:18px;font-size:44px;font-weight:800;letter-spacing:10px}
.sp-name span{display:inline-block;opacity:0;animation:letter .5s ease forwards}
.sp-tag{margin-top:8px;opacity:0;font-size:14px;letter-spacing:2px;animation:fade 1s ease 1.6s forwards}
@keyframes pop{from{transform:scale(0) rotate(-120deg);opacity:0}to{transform:none;opacity:1}}
@keyframes letter{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes fade{to{opacity:.9}}
</style>`);