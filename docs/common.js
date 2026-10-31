// Ortak yordamchilar: ham a'zo sahifasi, ham admin paneli ishlatadi
const RPC = "https://fsmfhyustigomtvtnevo.supabase.co/functions/v1/hifz-bot/rpc";
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); if (tg.colorScheme) document.documentElement.dataset.theme = tg.colorScheme; }
const $app = document.getElementById("app");

const NUMS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12];
const MEDALS = ["🥇", "🥈", "🥉"];
const fmt = n => { const r = Math.round(n * 100) / 100, w = Math.floor(r); if (Math.abs(r - w - 0.5) < 1e-9) return w ? w + "½" : "½"; return String(r); };

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

async function rpc(a, p = {}) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ initData: tg.initData, a, ...p }) });
  const j = await r.json().catch(() => ({ error: "server" }));
  if (!r.ok || j.error) throw new Error(j.error || "server");
  return j;
}

let toastT;
function toast(t) {
  const el = document.getElementById("toast");
  el.textContent = t; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2200);
}

function bar(done, pending, goal, expected) {
  const pct = v => Math.max(0, Math.min(100, goal ? (v / goal) * 100 : 0));
  const a = h("i", { class: "a" }), p = h("i", { class: "p" }), b = h("div", { class: "bar" }, a, p);
  a.style.width = pct(done) + "%";
  p.style.left = pct(done) + "%"; p.style.width = Math.min(100 - pct(done), pct(pending || 0)) + "%";
  if (expected) { const e = h("i", { class: "e" }); e.style.width = pct(expected) + "%"; b.append(e); }
  return b;
}

function ltInfo(lt) {
  const out = [];
  if (lt.plan) out.push(["📆 Yillik", fmt(lt.plan.juz) + " juz — " + fmt(lt.plan.approved) + "/" + fmt(lt.plan.pages) + " (" + Math.round(lt.plan.approved / lt.plan.pages * 100) + "%), " + lt.plan.weeksLeft + " hafta qoldi", lt.plan.approved, lt.plan.pages]);
  if (lt.month) out.push(["🗓 " + lt.month.name + (lt.month.manual ? " ✍️" : ""), fmt(lt.month.approved) + " / " + fmt(lt.month.target) + " sahifa", lt.month.approved, lt.month.target]);
  return out;
}

function openSheet(title, build) {
  const close = () => ov.remove();
  const ov = h("div", { class: "ov", onclick: e => { if (e.target === ov) close(); } },
    h("div", { class: "sheet" }, h("div", { class: "row" }, h("b", {}, title), h("button", { class: "x", onclick: close }, "✕")), build(close)));
  document.body.append(ov);
}

function numberSheet({ title, nums, max = 100, hint, suggest, extras = [], onPick }) {
  openSheet(title, close => {
    const wrap = h("div");
    const pick = async v => { close(); await onPick(v); };
    if (suggest) wrap.append(h("button", { class: "btn primary wide", onclick: () => pick(suggest) }, "💡 Tavsiya: " + fmt(suggest)));
    wrap.append(h("div", { class: "chips" }, nums.map(n => h("button", { class: "chip", onclick: () => pick(n) }, fmt(n)))));
    const inp = h("input", { type: "number", inputmode: "decimal", step: "0.5", min: "0", max: String(max), placeholder: "Boshqa son" });
    wrap.append(h("div", { class: "custom" }, inp, h("button", { class: "btn", onclick: () => {
      const n = Math.round(parseFloat(String(inp.value).replace(",", ".")) * 100) / 100;
      if (!(n > 0 && n <= max)) return toast("Son noto'g'ri");
      pick(n);
    } }, "OK")));
    extras.forEach(([label, fn]) => wrap.append(h("button", { class: "btn wide", onclick: () => { close(); fn(); } }, label)));
    if (hint) wrap.append(h("div", { class: "meta" }, hint));
    return wrap;
  });
}

let S = { me: null, tab: null, scope: "w" };
async function reload() { S.me = await rpc("me"); await render(); }
async function act(a, p, okMsg) {
  try { await rpc(a, p); toast(okMsg || "✅"); await reload(); }
  catch (e) { toast("Xato: " + e.message); }
}

function showMsg(html, title) {
  $app.replaceChildren(h("h1", {}, title || "🌙 Hifz Tracker"));
  const d = h("div", { class: "msg" }); d.innerHTML = html; $app.append(d);
}

async function rankView() {
  const d = await rpc("ranking", { scope: S.scope }), root = h("div");
  root.append(h("div", { class: "seg" }, [["w", "📅 Hafta"], ["m", "🗓 Oy"], ["y", "📆 Yil"]].map(([k, l]) =>
    h("button", { class: k === S.scope ? "on" : "", onclick: () => { S.scope = k; render(); } }, l))));
  root.append(h("div", { class: "sub" }, d.title + " · maqsadga nisbatan"));
  if (!d.rows.length) root.append(h("div", { class: "msg" }, "Hali reja belgilanmagan."));
  d.rows.forEach((r, i) => root.append(h("div", { class: "card" },
    h("div", { class: "row" }, h("b", {}, (MEDALS[i] || (i + 1) + ".") + " " + r.name), h("span", { class: "num" }, r.pct + "%")),
    bar(r.done, 0, r.goal),
    h("div", { class: "meta" }, fmt(r.done) + " / " + fmt(r.goal) + " sahifa" + (r.done + 1e-9 >= r.goal ? " 🎉" : "")))));
  if (d.none.length) root.append(h("div", { class: "meta" }, "Reja yo'q: " + d.none.join(", ")));
  return root;
}
