// Reja, jonli yodlash va xatolar ekranlari (a'zo sayti va admin paneli uchun ortak)
const SURAH_URL = n => "https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/" + n + ".json";
const SURAH_CACHE = {};
async function surahVerses(n) {
  if (!SURAH_CACHE[n]) SURAH_CACHE[n] = fetch(SURAH_URL(n)).then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => j.verses);
  return SURAH_CACHE[n];
}
// [s,a] dan [s,a] gacha arabcha matn (kamida bitta oyat, ko'pi bilan 40 oyat ko'rsatiladi)
async function arabicRange(from, to) {
  const out = []; let [s, a] = from;
  while (out.length < 40) {
    const vs = await surahVerses(s);
    out.push({ s, a, t: (vs[a - 1] || {}).text || "" });
    if (s === to[0] && a === to[1]) break;
    if (a >= vs.length) { s++; a = 1; if (s > 114) break; } else a++;
  }
  return out;
}
function arabicBox(from, to) {
  const box = h("div", { class: "ar" }, h("div", { class: "meta" }, "Matn yuklanmoqda…"));
  arabicRange(from, to).then(vs => {
    box.replaceChildren(...vs.map(v => h("span", { class: "ay" }, v.t, " ", h("span", { class: "no" }, "﴿" + v.a + "﴾"), " ")));
  }).catch(() => box.replaceChildren(h("div", { class: "meta" }, "Arabcha matn yuklanmadi (internet kerak)")));
  return box;
}

function planCard(pi, opts = {}) {
  const root = h("div");
  if (!pi.has) {
    root.append(h("div", { class: "card" }, h("b", {}, "🗺 Reja"),
      h("div", { class: "meta" }, "Boshlanish nuqtasi hali tanlanmagan. Nimani yodlashni o'zingiz tanlaysiz.")));
    return root;
  }
  const dir = pi.dir === 1 ? "oldinga ➡️" : "orqaga ⬅️";
  if (!pi.monthPlan) root.append(h("div", { class: "card" },
    h("div", { class: "row" }, h("b", {}, "📍 Joriy holat"), h("span", { class: "meta" }, dir)),
    h("div", { class: "row" }, h("span", {}, "✅ Oxirgi yodlangan"), h("b", {}, pi.last || "—")),
    h("div", { class: "row" }, h("span", {}, "➡️ Keyingi"), h("b", {}, pi.next)),
    h("div", { class: "meta" }, "Boshlangan: " + pi.start)));
  if (pi.monthPlan) {
    const m = pi.monthPlan;
    root.append(h("div", { class: "card" },
      h("div", { class: "row" }, h("b", {}, "🗓 Oylik reja"), h("span", { class: "num" }, fmt(m.done) + " / " + fmt(m.pages))),
      bar(m.done, 0, m.pages, m.planned),
      h("div", { class: "meta" }, h("span", {}, m.daysCount + " kun · boshlanish: " + m.start + " (" + (m.dir === -1 ? "orqaga" : "oldinga") + ")"),
        h("span", { class: m.behind > 0.05 ? "warn" : "ok" }, m.behind > 0.05 ? "⚠️ Orqada: " + (Math.round(m.behind * 10) / 10) + " bet" : "👍 Reja bo'yicha"))));
    if (pi.restDay) root.append(h("div", { class: "banner" }, "🏖 Bugun dam olish kuni"));
    else if (pi.todayDone) root.append(h("div", { class: "banner" }, "🌟 Bugungi reja bajarilgan!"));
    if (pi.today) {
      const t = h("div", { class: "card live" }, h("b", {}, "📌 Bugun"),
        h("div", {}, pi.today.from + " → " + pi.today.to),
        h("div", { class: "meta" }, "≈ " + (Math.round(pi.today.pages * 10) / 10) + " bet"));
      if (pi.todayRef && !opts.noText) t.append(arabicBox(pi.todayRef.from, pi.todayRef.to));
      root.append(t);
    }
    const tb = h("div", { class: "card" }, h("b", {}, "🗓 Kunlar bo'yicha"));
    (pi.days || []).forEach(d => { if (d.pages > 0) tb.append(h("div", { class: "row day" + (d.today ? " now" : "") + (d.past ? " past" : "") },
      h("span", {}, (d.today ? "👉 " : "") + d.day), h("span", { class: "rng" }, d.from + " → " + d.to))); });
    root.append(tb);
    return root;
  }
  if (pi.goal) {
    const c = h("div", { class: "card" },
      h("div", { class: "row" }, h("b", {}, "🎯 Hafta"), h("span", { class: "num" }, fmt(pi.done) + " / " + fmt(pi.goal))),
      bar(pi.done, 0, pi.goal),
      h("div", { class: "meta" }, h("span", {}, "Qoldi: " + fmt(pi.left) + " sahifa"),
        pi.week ? h("span", {}, "Oraliq: " + pi.week.from + " → " + pi.week.to) : null));
    root.append(c);
    if (pi.todayDone) root.append(h("div", { class: "banner" }, "🌟 Bugungi reja bajarilgan!"));
    else if (pi.today) {
      const t = h("div", { class: "card" }, h("b", {}, "📌 Bugun"),
        h("div", {}, pi.today.from + " → " + pi.today.to),
        h("div", { class: "meta" }, "≈ " + (Math.round(pi.today.pages * 10) / 10) + " bet"));
      if (pi.todayRef && !opts.noText) t.append(arabicBox(pi.todayRef.from, pi.todayRef.to));
      root.append(t);
    }
    if (pi.days && pi.days.some(d => d.pages > 0)) {
      const tb = h("div", { class: "card" }, h("b", {}, "🗓 Kunlar bo'yicha"));
      pi.days.forEach(d => { if (d.pages > 0) tb.append(h("div", { class: "row day" + (d.today ? " now" : "") },
        h("span", {}, (d.today ? "👉 " : "") + d.day), h("span", { class: "rng" }, d.from + " → " + d.to))); });
      root.append(tb);
    }
  } else if (pi.today) {
    root.append(h("div", { class: "card" }, h("b", {}, "📌 Taxminan 1 bet"), h("div", {}, pi.today.from + " → " + pi.today.to)));
  }
  const sp = h("div", { class: "card" },
    h("div", { class: "row" }, h("span", {}, "⚡ O'rtacha tezlik"), h("b", {}, (Math.round(pi.avgWeek * 10) / 10) + " bet/hafta")));
  if (pi.planPages) {
    sp.append(h("div", { class: "row" }, h("span", {}, "🏁 Yillik rejadan qoldi"), h("b", {}, fmt(pi.remainPlan) + " bet")),
      h("div", { class: "row" }, h("span", {}, "📆 Shu tezlikda tugash"), h("b", {}, pi.eta || "—")));
  }
  root.append(sp);
  return root;
}

function startPicker() {
  openSheet("📍 Qayerdan boshlaysiz?", close => {
    const w = h("div");
    const set = async (p) => { close(); await act("plan_set", p, "✅ Nuqta saqlandi"); };
    [["🔰 Amma (30-juz) — Naba'dan", { s: 78, ay: 1, dir: 1 }],
     ["🔰 Amma — Nas'dan orqaga", { s: 114, ay: 6, dir: -1 }],
     ["📖 Baqara — boshidan", { s: 2, ay: 1, dir: 1 }]].forEach(([l, p]) => w.append(h("button", { class: "btn wide", onclick: () => set(p) }, l)));
    const s = h("input", { type: "number", inputmode: "numeric", min: "1", max: "114", placeholder: "Sura (1–114)" });
    const a = h("input", { type: "number", inputmode: "numeric", min: "1", placeholder: "Oyat" });
    const pg = h("input", { type: "number", inputmode: "numeric", min: "1", max: "604", placeholder: "yoki bet (1–604)" });
    const dsel = h("select", {}, h("option", { value: "1" }, "Oldinga ➡️"), h("option", { value: "-1" }, "Orqaga ⬅️"));
    w.append(h("div", { class: "sec" }, "O'zim tanlayman"),
      h("div", { class: "custom" }, s, a), h("div", { class: "custom", style: "margin-top:8px" }, pg),
      h("div", { class: "custom", style: "margin-top:8px" }, dsel,
        h("button", { class: "btn primary", onclick: () => {
          if (pg.value) return set({ page: Number(pg.value), dir: Number(dsel.value) });
          if (!s.value) return toast("Sura raqamini yozing");
          set({ s: Number(s.value), ay: Number(a.value || 1), dir: Number(dsel.value) });
        } }, "Saqlash")));
    return w;
  });
}

async function planView() {
  const pi = await rpc("plan"), root = h("div");
  root.append(h("div", { class: "actions" },
    h("button", { class: "btn primary", onclick: startPicker }, "📍 Boshlanish nuqtasi"),
    pi.has ? h("button", { class: "btn", onclick: () => act("plan_dir", {}, "🔄 Yo'nalish o'zgardi") }, pi.dir === 1 ? "🔄 Orqaga" : "🔄 Oldinga") : null));
  root.append(planCard(pi));
  root.append(h("div", { class: "sec" }, "⚠️ Xatolarim"));
  root.append(h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => mistakeSheet(null, render) }, "⚠️ Xato belgilash")));
  root.append(await mistakesList(null, true, render));
  return root;
}

// ---- jonli yodlash ----
function hoursSheet(title, onPick) {
  openSheet(title, close => h("div", { class: "chips" }, [1, 2, 3, 4].map(n =>
    h("button", { class: "chip", onclick: () => { close(); onPick(n); } }, n + " soat"))));
}
function startLive() {
  openSheet("▶️ Qaysi vaqtda yodlaysiz?", close => {
    const w = h("div");
    [["fajr", "🌅 Bomdoddan keyin"], ["isha", "🌙 Xufton namozidan keyin"], ["other", "🕒 Boshqa vaqt"]].forEach(([k, l]) =>
      w.append(h("button", { class: "btn wide", onclick: () => { close(); hoursSheet("Necha soat?", n => act("live_start", { slot: k, hours: n }, "▶️ Boshlandi, hamma ko'radi")); } }, l)));
    return w;
  });
}
function finishLive(pi) {
  openSheet("⏹ Nimani yodladingiz?", close => {
    const w = h("div");
    if (pi && pi.today) w.append(h("button", { class: "btn primary wide", onclick: () => { close(); act("live_finish", { mode: "plan" }, "⏹ Yuborildi"); } }, "✅ Reja: " + pi.today.from + " → " + pi.today.to));
    const f = [h("input", { type: "number", min: "1", max: "114", placeholder: "Sura" }), h("input", { type: "number", min: "1", placeholder: "Oyat" })];
    const t = [h("input", { type: "number", min: "1", max: "114", placeholder: "Sura" }), h("input", { type: "number", min: "1", placeholder: "Oyat" })];
    w.append(h("div", { class: "sec" }, "Boshqa oraliq"), h("div", { class: "meta" }, "Qayerdan"), h("div", { class: "custom" }, f),
      h("div", { class: "meta", style: "margin-top:8px" }, "Qayergacha"), h("div", { class: "custom" }, t),
      h("button", { class: "btn wide", onclick: () => {
        const v = [...f, ...t].map(i => Number(i.value));
        if (v.some(x => !x)) return toast("Hammasini to'ldiring");
        close(); act("live_finish", { mode: "range", from: [v[0], v[1]], to: [v[2], v[3]] }, "⏹ Yuborildi");
      } }, "Yuborish"),
      h("button", { class: "btn wide", onclick: () => { close(); act("live_finish", { mode: "none" }, "⏹ Tugadi"); } }, "➖ Hech narsa yodlamadim"),
      h("div", { class: "meta" }, "🎙 Ovozli xabarni botga yuboring — yo'naltiruvchi eshitadi."));
    return w;
  });
}
async function liveView() {
  const d = await rpc("live"), root = h("div");
  if (d.isMember) {
    if (d.mine) {
      root.append(h("div", { class: "card live" }, h("b", {}, "▶️ Siz yodlayapsiz"),
        h("div", { class: "meta" }, (d.slots[d.mine.slot] || "") + " · " + d.mine.from + "–" + d.mine.to)));
      root.append(h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: async () => { let pi = null; try { pi = await rpc("plan"); } catch (e) {} finishLive(pi); } }, "⏹ Tugatdim"),
        h("button", { class: "btn", onclick: () => hoursSheet("Hozirdan necha soatgacha?", n => act("live_time", { hours: n }, "🕒 Vaqt o'zgardi")) }, "🕒 Vaqtni o'zgartirdim")));
    } else {
      root.append(h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: startLive }, "▶️ Yodlashni boshladim")));
    }
  }
  root.append(h("div", { class: "sec" }, "🔴 Hozir yodlayotganlar"));
  if (!d.live.length) root.append(h("div", { class: "msg" }, "Hozir hech kim yodlamayapti."));
  d.live.forEach(x => root.append(h("div", { class: "card live" },
    h("div", { class: "row" }, h("b", {}, "▶️ " + x.name), h("span", { class: "num" }, x.from + "–" + x.to)),
    h("div", { class: "meta" }, d.slots[x.slot] || ""))));
  if (d.done.length) {
    root.append(h("div", { class: "sec" }, "⏹ So'nggi tugatganlar"));
    d.done.slice(0, 12).forEach(x => root.append(h("div", { class: "card" },
      h("div", { class: "row" }, h("b", {}, x.name), h("span", { class: "meta" }, x.started + "–" + x.ended)),
      x.range ? h("div", { class: "meta" }, "📖 " + x.range + (x.pages ? " · ≈ " + fmt(x.pages) + " sahifa" : "")) : null,
      x.voice && S.me && S.me.isAdmin ? h("div", { style: "margin-top:8px" }, voiceBtn(x.id)) : null)));
  }
  root.append(h("div", { class: "meta" }, h("button", { class: "btn", onclick: render }, "🔄 Yangilash")));
  return root;
}

// ---- xatolar ----
function mistakeSheet(memberId, onDone) {
  openSheet("⚠️ Xato belgilash", close => {
    const s = h("input", { type: "number", inputmode: "numeric", min: "1", max: "114", placeholder: "Sura" });
    const a = h("input", { type: "number", inputmode: "numeric", min: "1", placeholder: "Oyat" });
    const wd = h("input", { type: "number", inputmode: "numeric", min: "1", placeholder: "So'z № (ixtiyoriy)" });
    const note = h("input", { type: "text", maxlength: "200", placeholder: "Izoh (ixtiyoriy)" });
    const kind = h("select", {}, Object.entries({ forgot: "Unutdim/to'xtadim", wrong: "Almashtirdim", tajweed: "Tajvid/talaffuz", other: "Boshqa" }).map(([k, v]) => h("option", { value: k }, v)));
    return h("div", {}, h("div", { class: "custom" }, s, a), h("div", { class: "custom", style: "margin-top:8px" }, wd),
      h("div", { class: "custom", style: "margin-top:8px" }, kind), h("div", { class: "custom", style: "margin-top:8px" }, note),
      h("button", { class: "btn primary wide", onclick: async () => {
        if (!s.value || !a.value) return toast("Sura va oyatni yozing");
        try {
          await rpc("mist_add", { id: memberId, s: Number(s.value), ay: Number(a.value), word: wd.value ? Number(wd.value) : null, kind: kind.value, note: note.value });
          close(); toast("⚠️ Saqlandi"); onDone();
        } catch (e) { toast("Xato: " + e.message); }
      } }, "Saqlash"));
  });
}
async function mistakesList(memberId, canFix, onChange) {
  const d = await rpc("mist_list", memberId ? { id: memberId } : {}), root = h("div");
  const open = d.items.filter(m => m.status === "open"), fixed = d.items.filter(m => m.status !== "open");
  const row = (m) => h("div", { class: "card" },
    h("div", { class: "row" }, h("b", {}, m.ref + (m.word ? " · " + m.word + "-so'z" : "")), h("span", { class: "meta" }, d.kinds[m.kind] || m.kind)),
    m.note ? h("div", { class: "meta" }, "💬 " + m.note) : null,
    h("div", { class: "meta" }, m.day + (m.byAdmin ? " · yo'naltiruvchi belgiladi" : " · o'zi belgiladi")),
    m.status === "open" && canFix ? h("button", { class: "btn wide", onclick: async () => { try { await rpc("mist_fix", { id: m.id }); toast("✅ Tuzatildi"); onChange(); } catch (e) { toast("Xato: " + e.message); } } }, "✅ Tuzatdim") : null,
    S.me && S.me.isAdmin && memberId ? h("button", { class: "btn wide", onclick: async () => { try { await rpc("mist_delete", { id: m.id }); toast("🗑 Savatga o'tdi"); onChange(); } catch (e) { toast("Xato: " + e.message); } } }, "🗑 O'chirish") : null);
  root.append(h("div", { class: "sec" }, "Ochiq xatolar (" + open.length + ")"));
  if (!open.length) root.append(h("div", { class: "msg" }, "Ochiq xato yo'q 🎉"));
  open.forEach(m => root.append(row(m)));
  if (fixed.length) { root.append(h("div", { class: "sec" }, "Tuzatilganlar")); fixed.slice(0, 10).forEach(m => root.append(row(m))); }
  return root;
}
async function mistakesView() {
  const root = h("div");
  root.append(h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => mistakeSheet(null, render) }, "⚠️ Xato belgilash")));
  root.append(await mistakesList(null, true, render));
  return root;
}

function monthPlanSheet(m) {
  numberSheet({ title: "🗓 " + m.name + ": shu oy necha sahifa?", nums: [5, 10, 15, 20, 25, 30, 40, 60], max: 600,
    hint: "Keyingi qadamda boshlanish nuqtasini kiritasiz; reja kunlarga bo'linadi.",
    onPick: pages => openSheet("📍 Qayerdan boshlanadi?", close => {
      const w = h("div");
      const send = async p => { close(); await act("monthplan_set", { id: m.id, pages, ...p }, "✅ Oylik reja belgilandi"); };
      const s = h("input", { type: "number", inputmode: "numeric", min: "1", max: "114", placeholder: "Sura (1–114)" });
      const a = h("input", { type: "number", inputmode: "numeric", min: "1", placeholder: "Oyat" });
      const pg = h("input", { type: "number", inputmode: "numeric", min: "1", max: "604", placeholder: "yoki bet (1–604)" });
      const dsel = h("select", {}, h("option", { value: "1" }, "Oldinga ➡️"), h("option", { value: "-1" }, "Orqaga ⬅️"));
      w.append(h("button", { class: "btn wide", onclick: () => send({ cont: true }) }, "➡️ A'zoning oxirgi nuqtasidan davom"),
        h("div", { class: "sec" }, "Yoki o'zingiz kiriting"),
        h("div", { class: "custom" }, s, a), h("div", { class: "custom", style: "margin-top:8px" }, pg),
        h("div", { class: "custom", style: "margin-top:8px" }, dsel, h("button", { class: "btn primary", onclick: () => {
          if (pg.value) return send({ page: Number(pg.value), dir: Number(dsel.value) });
          if (!s.value) return toast("Sura yoki betni yozing");
          send({ s: Number(s.value), ay: Number(a.value || 1), dir: Number(dsel.value) });
        } }, "Saqlash")));
      return w;
    }) });
}

// ---- ovozni tinglash (faqat yo'naltiruvchi) ----
let _audio = null;
function voiceBtn(sid) {
  const b = h("button", { class: "btn", onclick: async () => {
    if (_audio) { _audio.pause(); _audio = null; }
    b.textContent = "⏳ Yuklanmoqda…"; b.disabled = true;
    try {
      const r = await rpc("voice_get", { id: sid });
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      const a = new Audio(URL.createObjectURL(new Blob([bytes], { type: r.type })));
      _audio = a;
      a.onended = () => { b.textContent = "🎧 Qayta tinglash"; };
      a.onerror = () => voiceFallback(b, sid);
      await a.play();
      b.textContent = "⏸ To'xtatish"; b.disabled = false;
      b.onclick = () => { if (a.paused) { a.play(); b.textContent = "⏸ To'xtatish"; } else { a.pause(); b.textContent = "▶️ Davom"; } };
    } catch (e) { voiceFallback(b, sid); }
  } }, "🎧 Ovozni tinglash");
  return b;
}
async function voiceFallback(b, sid) {
  b.disabled = false; b.textContent = "🎧 Ovozni tinglash";
  openSheet("🎧 Ovoz", close => h("div", {}, h("div", { class: "meta" }, "Bu qurilmada ovozni saytda ijro etib bo'lmadi. Telegramning o'zida eshiting:"),
    h("button", { class: "btn primary wide", onclick: async () => { try { await rpc("voice_send", { id: sid }); toast("📨 Botga yuborildi"); close(); } catch (e) { toast("Xato: " + e.message); } } }, "📨 Botga yuborish")));
}

// ---- a'zoni qo'shish / o'chirish / savat / xabar (admin va a'zo) ----
function addMemberSheet() {
  openSheet("➕ A'zo qo'shish", close => {
    const id = h("input", { type: "number", inputmode: "numeric", placeholder: "Telegram ID" });
    const nm = h("input", { type: "text", maxlength: "60", placeholder: "Ism" });
    const ph = h("input", { type: "tel", maxlength: "20", placeholder: "Telefon (+998...)" });
    return h("div", {}, h("div", { class: "meta" }, "A'zo yuborgan ID va telefonni kiriting. Faqat qo'shilganlar botdan foydalana oladi."),
      h("div", { class: "custom", style: "margin-top:10px" }, id), h("div", { class: "custom", style: "margin-top:8px" }, nm),
      h("div", { class: "custom", style: "margin-top:8px" }, ph),
      h("button", { class: "btn primary wide", onclick: async () => {
        if (!id.value) return toast("Telegram ID yozing");
        try { await rpc("member_add", { id: Number(id.value), name: nm.value, phone: ph.value }); close(); toast("✅ Qo'shildi"); await reload(); }
        catch (e) { toast(e.message === "bad_id" ? "ID noto'g'ri" : e.message === "other_circle" ? "Bu ID boshqa halqada" : "Xato: " + e.message); }
      } }, "Qo'shish"));
  });
}
const REP_ST = { approved: "✅ Tasdiqlangan", pending: "⏳ Kutilmoqda", repeat: "🔁 Qayta" };
const ERR_UZ = { bad_pages: "Sahifa 0 dan katta va 100 dan oshmasin", bad_day: "Sana noto'g'ri (kelajak yoki juda eski)", changed: "Shundan keyin yana o'zgartirilgan, avval keyingisini qaytaring", not_found: "Topilmadi", nothing: "O'zgarish yo'q" };
const errTxt = e => ERR_UZ[e.message] || ("Xato: " + e.message);
async function memberReportsSheet(m) {
  try {
    const d = await rpc("report_list", { id: m.id });
    openSheet("📖 " + m.name + ": hisobotlar", close => {
      const w = h("div", {}, h("div", { class: "meta" }, "Tuzatish uchun hisobotni bosing. Hamma o'zgarish «Tarix»da saqlanadi va qaytariladi."),
        h("button", { class: "btn primary wide", onclick: () => { close(); addReportSheet(m); } }, "➕ Hisobot qo'shish"),
        h("button", { class: "btn wide", onclick: () => { close(); historySheet(m); } }, "📜 Tarix"));
      if (!d.items.length) w.append(h("div", { class: "msg" }, "Hisobot yo'q."));
      d.items.forEach(r => w.append(h("div", { class: "card tap", onclick: () => { close(); editReportSheet(m, r); } }, h("div", { class: "row" },
        h("span", {}, fmt(r.pages) + " sahifa · " + r.day), h("span", { class: "meta" }, REP_ST[r.status] || r.status)))));
      return w;
    });
  } catch (e) { toast("Xato: " + e.message); }
}
function confirmSheet(title, lines, onYes) {
  openSheet(title, close => h("div", {}, h("div", { class: "card" }, lines.map(l => h("div", { class: "row" }, l))),
    h("button", { class: "btn primary wide", onclick: async () => { close(); await onYes(); } }, "✅ Ha, tasdiqlayman"),
    h("button", { class: "btn wide", onclick: close }, "Bekor")));
}
function editReportSheet(m, r) {
  openSheet("✏️ Hisobotni tuzatish", close => {
    const pg = h("input", { type: "number", inputmode: "decimal", step: "0.5", min: "0", max: "100", value: String(r.pages) });
    const dy = h("input", { type: "date", value: r.day, max: new Date().toISOString().slice(0, 10) });
    const st = h("select", {}, Object.entries(REP_ST).map(([k, v]) => h("option", Object.assign({ value: k }, k === r.status ? { selected: "selected" } : {}), v)));
    return h("div", {}, h("div", { class: "meta" }, m.name), h("div", { class: "sec" }, "Sahifa"), h("div", { class: "custom" }, pg),
      h("div", { class: "sec" }, "Sana"), h("div", { class: "custom" }, dy), h("div", { class: "sec" }, "Holat"), h("div", { class: "custom" }, st),
      h("button", { class: "btn primary wide", onclick: () => {
        const np = Math.round(parseFloat(String(pg.value).replace(",", ".")) * 100) / 100;
        if (!(np > 0 && np <= 100)) return toast("Sahifa 0 dan katta va 100 dan oshmasin");
        const patch = {}; const lines = [];
        if (np !== r.pages) { patch.pages = np; lines.push("Sahifa: " + fmt(r.pages) + " → " + fmt(np)); }
        if (dy.value !== r.day) { patch.day = dy.value; lines.push("Sana: " + r.day + " → " + dy.value); }
        if (st.value !== r.status) { patch.status = st.value; lines.push("Holat: " + REP_ST[r.status] + " → " + REP_ST[st.value]); }
        if (!lines.length) return toast("O'zgarish yo'q");
        close();
        confirmSheet("Tasdiqlang", [...lines, "A'zoga xabar yuboriladi."], async () => {
          try { await rpc("report_edit", { id: r.id, ...patch }); toast("✅ Tuzatildi"); await reload(); } catch (e) { toast(errTxt(e)); }
        });
      } }, "Saqlash"),
      h("button", { class: "btn wide", onclick: async () => { try { await rpc("report_delete", { id: r.id }); close(); toast("🗑 Savatga o'tdi"); reload(); } catch (e) { toast("Xato: " + e.message); } } }, "🗑 O'chirish"));
  });
}
function addReportSheet(m) {
  openSheet("➕ Hisobot qo'shish", close => {
    const pg = h("input", { type: "number", inputmode: "decimal", step: "0.5", min: "0", max: "100", placeholder: "Sahifa" });
    const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    const dy = h("input", { type: "date", value: today, max: today });
    return h("div", {}, h("div", { class: "meta" }, m.name + ": tasdiqlangan holda qo'shiladi."), h("div", { class: "custom", style: "margin-top:8px" }, pg), h("div", { class: "custom", style: "margin-top:8px" }, dy),
      h("button", { class: "btn primary wide", onclick: () => {
        const np = Math.round(parseFloat(String(pg.value).replace(",", ".")) * 100) / 100;
        if (!(np > 0 && np <= 100)) return toast("Sahifa 0 dan katta va 100 dan oshmasin");
        close();
        confirmSheet("Tasdiqlang", ["+ " + fmt(np) + " sahifa", "Sana: " + dy.value], async () => {
          try { await rpc("report_add", { id: m.id, pages: np, day: dy.value }); toast("✅ Qo'shildi"); await reload(); } catch (e) { toast(errTxt(e)); }
        });
      } }, "Qo'shish"));
  });
}
async function historySheet(m) {
  try {
    const d = await rpc("audit_list", { id: m.id });
    openSheet("📜 " + m.name + ": tarix", close => {
      const w = h("div", {}, h("div", { class: "meta" }, "Statistikadagi o'zgarishlar. Qaytarish faqat shundan keyin o'zgartirilmagan bo'lsa ishlaydi."));
      if (!d.items.length) w.append(h("div", { class: "msg" }, "Tarix bo'sh."));
      d.items.forEach(x => w.append(h("div", { class: "card" }, h("div", { class: "row" }, h("b", {}, x.action), h("span", { class: "meta" }, x.at)),
        h("div", { class: "meta" }, x.desc + (x.undone ? " · qaytarilgan" : "")),
        x.undone ? null : h("button", { class: "btn wide", onclick: async () => { try { await rpc("audit_undo", { id: x.id }); close(); toast("↩️ Qaytarildi"); await reload(); } catch (e) { toast(errTxt(e)); } } }, "↩️ Qaytarish"))));
      return w;
    });
  } catch (e) { toast("Xato: " + e.message); }
}
function deleteMemberSheet(m) {
  openSheet("🗑 " + m.name, close => h("div", {},
    h("div", { class: "meta" }, "A'zo botdan foydalana olmaydi. Hamma ma'lumoti Savatda saqlanadi, tiklash mumkin."),
    h("button", { class: "btn primary wide", onclick: async () => { try { await rpc("member_delete", { id: m.id }); close(); toast("🗑 Savatga o'tdi"); await reload(); } catch (e) { toast("Xato: " + e.message); } } }, "🗑 Ha, o'chirish"),
    h("button", { class: "btn wide", onclick: close }, "Bekor")));
}
async function trashView() {
  const d = await rpc("trash_list"), root = h("div");
  root.append(h("div", { class: "sub" }, "O'chirilganlar. Tiklash uchun ♻️ ni bosing."));
  if (!d.items.length) root.append(h("div", { class: "msg" }, "Savat bo'sh."));
  const kind = { member: "👤", report: "📖", mistake: "⚠️" };
  d.items.forEach(t => root.append(h("div", { class: "card" },
    h("div", { class: "row" }, h("span", {}, (kind[t.kind] || "") + " " + t.label), h("button", { class: "btn", onclick: async () => {
      try { await rpc("trash_restore", { id: t.id }); toast("♻️ Tiklandi"); render(); }
      catch (e) { toast("Tiklab bo'lmadi (a'zo o'chirilgan bo'lsa, avval a'zoni tiklang)"); } } }, "♻️")),
    h("div", { class: "meta" }, String(t.deleted_at).slice(0, 16).replace("T", " ")))));
  return root;
}
function writeAdminSheet() {
  openSheet("✉️ Yo'naltiruvchiga yozish", close => {
    const t = h("textarea", { class: "rep", style: "min-height:110px", placeholder: "Masalan: kecha noto'g'ri sahifa yuborib qo'ydim…" });
    return h("div", {}, h("div", { class: "meta" }, "Xato qilsangiz yoki savolingiz bo'lsa, shu yerga yozing — yo'naltiruvchi o'zi tuzatadi."), t,
      h("button", { class: "btn primary wide", onclick: async () => { if (!t.value.trim()) return toast("Matn yozing"); try { await rpc("message", { text: t.value }); close(); toast("✅ Yuborildi"); } catch (e) { toast("Xato: " + e.message); } } }, "Yuborish"));
  });
}
