// Hifz Tracker v3: yo'naltiruvchi (admin) tasdiqlaydigan haftalik reja tizimi
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PAGE_FIRST, SURAH_AYAHS, SURAH_NAMES } from "./quran-data.ts";
import { align, words, type Ref } from "./analyze.ts";
import { ayahId, dayBlocks, fromId, splitBlocks, eta as etaDate, label, nextBlock, pagesIn, TOTAL, validSA, weekBlock, type Dir } from "./plan.ts";

const BOT = Deno.env.get("BOT_TOKEN")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const TZ = 5; // Toshkent UTC+5
const SITE = (Deno.env.get("SITE_URL") ?? "https://hifz-bot.vercel.app/").replace(/\/?$/, "/");

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return k.default ?? (Object.values(k)[0] as string) ?? "";
  } catch {
    return "";
  }
}
const sb = createClient(SB_URL, serviceKey());

// ---------- umumiy yordamchilar ----------
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const text = (s: string, status = 200) =>
  new Response(s, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

const nowShift = (s = 0) => new Date(Date.now() + TZ * 3600e3 + s * 864e5);
const day = (s = 0) => nowShift(s).toISOString().slice(0, 10);
const dow = () => nowShift().getUTCDay(); // 0 = yakshanba
const weekStart = () => day(-((dow() + 6) % 7)); // dushanba
// dam kuni (0=yakshanba..6=shanba): admin belgilaydi (circles.rest_day), hafta dushanbadan boshlanadi
let REST = 0, restAt = 0, REV_DAILY = 5, PRIZE = "";
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WORKDOW = () => ORDER.filter((x) => x !== REST);
const elapsed = () => ORDER.slice(0, ORDER.indexOf(dow()) + 1).filter((x) => x !== REST).length; // o'tgan ish kunlari (bugun bilan)
const dayIdx = () => WORKDOW().indexOf(dow()); // 0..5, dam kunida -1
const expected = (goal: number) => (goal * elapsed()) / 6;
const FULLDAY = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const SHORTDAY = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
async function loadRest() {
  if (Date.now() - restAt < 30000) return;
  const { data } = await sb.from("circles").select("*").limit(1).maybeSingle();
  REST = Number(data?.rest_day ?? 0);
  REV_DAILY = data?.rev_daily != null ? Number(data.rev_daily) : 5;
  PRIZE = String(data?.prize ?? "");
  restAt = Date.now();
}
async function setRest(adminUid: number, n: number) {
  if (!Number.isInteger(n) || n < 0 || n > 6) return false;
  const { error } = await sb.from("circles").update({ rest_day: n }).eq("admin_id", adminUid);
  if (error) return false;
  REST = n; restAt = Date.now();
  return true;
}
const restKb = () => ({
  inline_keyboard: [
    ORDER.slice(0, 4).map((d) => ({ text: (d === REST ? "✅ " : "") + FULLDAY[d], callback_data: `rd:${d}` })),
    ORDER.slice(4).map((d) => ({ text: (d === REST ? "✅ " : "") + FULLDAY[d], callback_data: `rd:${d}` })),
    [{ text: "⬅️ Orqaga", callback_data: "m" }],
  ],
});

// vaqt statistikasi (study_sessions): daqiqa, bir betga ketgan vaqt
async function timeStats(ids: number[], fromDay: string) {
  type T = { min: number; n: number; pages: number; perPage: number | null; today: number };
  const out = new Map<number, T>();
  ids.forEach((i) => out.set(i, { min: 0, n: 0, pages: 0, perPage: null, today: 0 }));
  if (!ids.length) return out;
  const from = new Date(new Date(fromDay + "T00:00:00Z").getTime() - TZ * 3600e3).toISOString();
  const todayFrom = new Date(day() + "T00:00:00Z").getTime() - TZ * 3600e3;
  const { data } = await sb.from("study_sessions").select("tg_id,started_at,ended_at,pages")
    .in("tg_id", ids).eq("status", "done").gte("started_at", from).not("ended_at", "is", null);
  const pm = new Map<number, { m: number; p: number }>();
  for (const r of data ?? []) {
    const t0 = Date.parse(r.started_at), mins = (Date.parse(r.ended_at) - t0) / 60000;
    if (!(mins >= 1 && mins <= 240)) continue; // tugatish unutilgan seanslar hisobga olinmaydi
    const o = out.get(r.tg_id)!; o.min += mins; o.n++;
    if (t0 >= todayFrom) o.today += mins;
    const p = Number(r.pages || 0);
    if (p > 0) { o.pages += p; const x = pm.get(r.tg_id) ?? { m: 0, p: 0 }; x.m += mins; x.p += p; pm.set(r.tg_id, x); }
  }
  for (const [id, o] of out) {
    const x = pm.get(id);
    o.min = Math.round(o.min); o.today = Math.round(o.today);
    o.perPage = x && x.p > 0 ? Math.round(x.m / x.p) : null;
  }
  return out;
}
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} soat ${Math.round(m % 60)} daq` : `${Math.round(m)} daq`);
const monthStart = () => day().slice(0, 8) + "01";
async function timeLines(uid: number) {
  const w = (await timeStats([uid], weekStart())).get(uid)!, m = (await timeStats([uid], monthStart())).get(uid)!;
  if (!m.n) return "";
  return `\n⏱ <b>Vaqt</b>\nBugun: ${fmtMin(w.today)} · Hafta: ${fmtMin(w.min)} (${w.n} seans)\nOy: ${fmtMin(m.min)}` +
    (m.perPage ? `\n📖 Bir betga o'rtacha: ${m.perPage} daq` : "");
}

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  const w = Math.floor(r);
  if (Math.abs(r - w - 0.5) < 1e-9) return w ? `${w}½` : "½";
  return String(r);
};
const chunk = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const rndCode = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

const JUZ = 20; // 1 juz = 20 sahifa
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const ceilHalf = (x: number) => Math.ceil(x * 2 - 1e-9) / 2;
const monthEnd = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

let _key = "";
async function secretKey() {
  if (_key) return _key;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hifz:" + BOT));
  _key = [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return _key;
}

async function tg(method: string, body: unknown) {
  return await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function send(chat_id: number, msg: string, reply_markup?: unknown) {
  await tg("sendMessage", {
    chat_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true, reply_markup,
  });
}
async function edit(chat_id: number, message_id: number, msg: string, reply_markup?: unknown) {
  await tg("editMessageText", {
    chat_id, message_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: reply_markup ?? { inline_keyboard: [] },
  });
}

let _uname = "";
async function botUsername() {
  if (_uname) return _uname;
  const r = await (await tg("getMe", {})).json();
  _uname = r?.result?.username ?? "";
  return _uname;
}

let commandsSet = false;
async function ensureCommands() {
  if (commandsSet) return;
  commandsSet = true;
  await tg("setMyCommands", { commands: [{ command: "menyu", description: "Tugmalarni ochish" }] });
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "🌐 Sayt", web_app: { url: SITE } } });
  if (ADMIN_ID) {
    await tg("setChatMenuButton", {
      chat_id: ADMIN_ID,
      menu_button: { type: "web_app", text: "👑 Panel", web_app: { url: SITE + "admin/" } },
    });
  }
}

// ---------- ma'lumotlar ----------
// Yagona yo'naltiruvchi: Supabase → Edge Functions → Secrets → ADMIN_ID (Telegram ID)
const ADMIN_ID = Number(Deno.env.get("ADMIN_ID") ?? "0");

async function circleOfAdmin(uid: number) {
  if (ADMIN_ID && uid !== ADMIN_ID) return null;
  return (await sb.from("circles").select("*").eq("admin_id", uid).maybeSingle()).data;
}

// ADMIN_ID egasi botni ochganda halqa o'zi yaratiladi (yoki eski halqa unga o'tadi)
async function adminCircle(uid: number, name: string) {
  const c = await circleOfAdmin(uid);
  if (c || !ADMIN_ID || uid !== ADMIN_ID) return c;
  const { data: any1 } = await sb.from("circles").select("*").limit(1).maybeSingle();
  if (any1) {
    const { data } = await sb.from("circles").update({ admin_id: uid, admin_name: name }).eq("id", any1.id).select().single();
    return data;
  }
  const { data } = await sb.from("circles")
    .insert({ admin_id: uid, admin_name: name, join_code: rndCode(), view_code: rndCode() })
    .select().single();
  return data;
}
const circleById = async (id: number) =>
  (await sb.from("circles").select("*").eq("id", id).maybeSingle()).data;
const memberOf = async (uid: number) =>
  (await sb.from("members").select("*").eq("tg_id", uid).maybeSingle()).data;

type St = { goal: number; approved: number; pending: number };
async function statsFor(ids: number[], ws: string): Promise<Map<number, St>> {
  const map = new Map<number, St>();
  ids.forEach((id) => map.set(id, { goal: 0, approved: 0, pending: 0 }));
  if (!ids.length) return map;
  const { data: gs } = await sb.from("goals").select("tg_id,pages").eq("week_start", ws).in("tg_id", ids);
  const { data: rs } = await sb.from("reports").select("tg_id,pages,status").eq("week_start", ws).in("tg_id", ids);
  for (const g of gs ?? []) map.get(g.tg_id)!.goal = Number(g.pages);
  for (const r of rs ?? []) {
    const s = map.get(r.tg_id)!;
    if (r.status === "approved") s.approved += Number(r.pages);
    if (r.status === "pending") s.pending += Number(r.pages);
  }
  if (ws === weekStart()) {
    const need = ids.filter((id) => !map.get(id)!.goal);
    if (need.length) {
      const { data: mps } = await sb.from("month_plans").select("tg_id,pages,from_date").eq("month", day().slice(0, 7)).in("tg_id", need);
      for (const mp of mps ?? []) {
        const dates = planDates(mp.from_date);
        const inWeek = dates.filter((d) => d >= ws && d <= addDays(ws, 5)).length;
        if (inWeek) map.get(mp.tg_id)!.goal = ceilHalf((Number(mp.pages) * inWeek) / dates.length);
      }
    }
  }
  return map;
}

// ---------- uzoq muddatli reja (yillik / oylik) ----------
type LT = {
  plan?: { juz: number; pages: number; approved: number; weeksLeft: number; end: string };
  month?: { name: string; target: number; approved: number; manual: boolean };
  suggest?: number;
};

async function longTerm(uid: number): Promise<LT> {
  const out: LT = {};
  const today = day(), ws = weekStart();
  const mKey = today.slice(0, 7), mStart = mKey + "-01", mEnd = monthEnd(today);
  const { data: plan } = await sb.from("plans").select("*").eq("tg_id", uid).maybeSingle();
  const { data: ov } = await sb.from("month_goals").select("pages").eq("tg_id", uid).eq("month", mKey).maybeSingle();
  if (!plan && !ov) return out;
  const { data: rs } = await sb.from("reports").select("day,pages").eq("tg_id", uid).eq("status", "approved");
  const sum = (f: (d: string) => boolean) =>
    (rs ?? []).filter((r) => f(r.day)).reduce((x, r) => x + Number(r.pages), 0);

  let autoTarget: number | undefined;
  if (plan) {
    const pages = Number(plan.juz) * JUZ;
    const end = addDays(plan.start_date, plan.weeks * 7 - 1);
    out.plan = {
      juz: Number(plan.juz), pages, end,
      approved: sum((d) => d >= plan.start_date),
      weeksLeft: Math.max(0, Math.ceil((daysBetween(today, end) + 1) / 7)),
    };
    if (today <= end) {
      const base = mStart > plan.start_date ? mStart : plan.start_date;
      const monthsLeft = Math.max(1, Math.ceil((daysBetween(base, end) + 1) / 30.44));
      autoTarget = Math.max(0, pages - sum((d) => d >= plan.start_date && d < mStart)) / monthsLeft;
      const weeksLeft = Math.max(1, Math.ceil((daysBetween(ws, end) + 1) / 7));
      out.suggest = ceilHalf(Math.max(0, pages - sum((d) => d >= plan.start_date && d < ws)) / weeksLeft);
    }
  }
  const target = ov ? Number(ov.pages) : autoTarget;
  if (target !== undefined) {
    out.month = {
      name: MONTHS[Number(mKey.slice(5)) - 1], target, manual: !!ov,
      approved: sum((d) => d >= mStart && d <= mEnd),
    };
  }
  if (ov) {
    const weeksLeftM = Math.max(1, Math.ceil((daysBetween(ws, mEnd) + 1) / 7));
    out.suggest = ceilHalf(Math.max(0, Number(ov.pages) - sum((d) => d >= mStart && d < ws)) / weeksLeftM);
  }
  return out;
}

function ltLines(lt: LT) {
  const l: string[] = [];
  if (lt.plan) {
    const p = lt.plan;
    l.push(`📆 Yillik: <b>${fmt(p.juz)}</b> juz (${fmt(p.pages)} sahifa) — ${fmt(p.approved)}/${fmt(p.pages)} (${Math.round((p.approved / p.pages) * 100)}%), ${p.weeksLeft} hafta qoldi`);
  }
  if (lt.month) {
    l.push(`🗓 ${lt.month.name}: ${fmt(lt.month.approved)} / ${fmt(lt.month.target)} sahifa${lt.month.manual ? " ✍️" : ""}`);
  }
  if (lt.suggest) l.push(`💡 Tavsiya etilgan haftalik: <b>${fmt(lt.suggest)}</b> sahifa`);
  return l.length ? "\n" + l.join("\n") : "";
}

// bajarilgan haftalar va ketma-ket hafta seriyasi
async function weekRecord(uid: number) {
  const { data: gs } = await sb.from("goals").select("week_start,pages").eq("tg_id", uid);
  const { data: rs } = await sb.from("reports").select("week_start,pages").eq("tg_id", uid).eq("status", "approved");
  const app = new Map<string, number>();
  for (const r of rs ?? []) app.set(r.week_start, (app.get(r.week_start) ?? 0) + Number(r.pages));
  const done = new Set<string>();
  for (const g of gs ?? []) {
    if (Number(g.pages) > 0 && (app.get(g.week_start) ?? 0) + 1e-9 >= Number(g.pages)) done.add(g.week_start);
  }
  let w = weekStart();
  if (!done.has(w)) w = addDays(w, -7);
  let streak = 0;
  while (done.has(w)) { streak++; w = addDays(w, -7); }
  return { streak, total: done.size };
}

async function kbFor(uid: number) {
  return menuKb(!!(await circleOfAdmin(uid)), !!(await memberOf(uid)));
}

// ---------- tugmalar ----------
const NUMS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12];
const numKb = (prefix: string, back: string, nums: number[] = NUMS) => ({
  inline_keyboard: [
    ...chunk(nums, 4).map((row) => row.map((n) => ({ text: fmt(n), callback_data: `${prefix}:${n}` }))),
    [{ text: "✍️ Boshqa son", callback_data: `${prefix}:x` }],
    [{ text: "⬅️ Orqaga", callback_data: back }],
  ],
});

function menuKb(isAdmin: boolean, isMem: boolean, pending = 0) {
  const rows: unknown[][] = [];
  if (isAdmin) {
    rows.push([{ text: `⏳ Tekshirish${pending ? ` (${pending})` : ""}`, callback_data: "ap" }]);
    rows.push([
      { text: "👥 A'zolar", callback_data: "al" },
      { text: "🏆 Reyting", callback_data: "top:w" },
    ]);
    rows.push([{ text: "🔴 Hozir kim yodlayapti", callback_data: "lv" }]);
    rows.push([
      { text: "👑 Panel", web_app: { url: SITE + "admin/" } },
      { text: "🗑 Savat", callback_data: "tr" },
    ]);
    if (!isMem) rows.push([{ text: "➕ Men ham a'zoman", callback_data: "join" }]);
  }
  if (isMem) {
    rows.push([{ text: "📖 Yodladim", callback_data: "rp" }, { text: "🔁 Takror", callback_data: "tk" }]);
    rows.push([{ text: "▶️ Yodlashni boshlash / tugatish", callback_data: "lm" }]);
    rows.push([
      { text: "🗺 Rejam", callback_data: "pl" },
      { text: "📊 Natijam", callback_data: "me" },
    ]);
    if (!isAdmin) rows.push([
      { text: "🏆 Reyting", callback_data: "top:w" },
      { text: "🔴 Hozir kim?", callback_data: "lv" },
    ]);
    if (!isAdmin) rows.push([{ text: "✉️ Yo'naltiruvchiga yozish", callback_data: "wm" }]);
    if (!isAdmin) rows.push([{ text: "🌐 Sayt", web_app: { url: SITE } }]);
  }
  return { inline_keyboard: rows };
}

async function showMenu(uid: number, name: string, pre?: string) {
  const circ = await adminCircle(uid, name);
  const mem = await memberOf(uid);
  if (!circ && !mem) {
    if (!ADMIN_ID) {
      return send(uid,
        `Assalomu alaykum, <b>${esc(name)}</b>! 🌙\n\nYo'naltiruvchi (admin) hali belgilanmagan.\n` +
        `Sizning Telegram ID: <code>${uid}</code>\nAdmin siz bo'lsangiz, shu raqamni Supabase → Edge Functions → Secrets ichiga <code>ADMIN_ID</code> nomi bilan yozing.`);
    }
    return send(uid,
      `Assalomu alaykum, <b>${esc(name)}</b>! 🌙\n\n🔒 Bu bot yopiq: faqat yo'naltiruvchi qo'shgan a'zolar foydalana oladi.\n\n` +
      `Qo'shilish uchun yo'naltiruvchiga <b>telefon raqamingiz</b> va <b>Telegram ID</b>ingizni yuboring:\n🆔 <code>${uid}</code>`);
  }
  let pending = 0;
  if (circ) {
    const { count } = await sb.from("reports").select("*", { count: "exact", head: true })
      .eq("circle_id", circ.id).eq("status", "pending");
    pending = count ?? 0;
  }
  const head = pre ?? `Assalomu alaykum, <b>${esc(name)}</b>! 🌙`;
  return send(uid, `${head}\n\n${circ ? "Nima qilamiz?" : "Tugmalardan birini bosing 👇"}`, menuKb(!!circ, !!mem, pending));
}

// ---------- matnlar ----------
function statsText(name: string, s: St, allTime: number, lt?: LT, rec?: { streak: number; total: number }) {
  const lines = [`👤 <b>${esc(name)}</b>`, ""];
  if (!s.goal) {
    lines.push("🎯 Bu hafta uchun maqsad hali belgilanmagan.");
    lines.push("Maqsadni yo'naltiruvchi belgilaydi.");
  } else {
    const left = Math.max(0, s.goal - s.approved - s.pending);
    const need = expected(s.goal);
    lines.push(`🎯 Hafta maqsadi: <b>${fmt(s.goal)}</b> sahifa (kuniga ~${fmt(s.goal / 6)})`);
    lines.push(`✅ Tasdiqlangan: <b>${fmt(s.approved)}</b>`);
    if (s.pending) lines.push(`⏳ Tekshirilmoqda: ${fmt(s.pending)}`);
    lines.push(`📌 Qoldi: ${fmt(left)}`);
    lines.push(
      s.approved + s.pending + 1e-9 >= need
        ? "👍 Reja bo'yicha ketyapsiz"
        : `⚠️ Bugungacha ${fmt(need)} sahifa bo'lishi kerak edi`,
    );
  }
  if (lt) { const x = ltLines(lt).trim(); if (x) lines.push("", x); }
  lines.push("", `🏅 Hamma vaqt: ${fmt(allTime)} sahifa`);
  if (rec) lines.push(`🏆 Bajarilgan haftalar: ${rec.total} · 🔥 seriya: ${rec.streak}`);
  return lines.join("\n");
}

const lineFor = (name: string, s: St) =>
  `${s.goal && s.approved >= s.goal ? "🎉" : "•"} ${esc(name)} — ✅${fmt(s.approved)}` +
  `${s.pending ? ` ⏳${fmt(s.pending)}` : ""} / ${s.goal ? fmt(s.goal) : "reja yo'q"}`;

// ---------- amallar ----------
async function createReport(uid: number, name: string, pages: number, quiet = false) {
  const mem = await memberOf(uid);
  if (!mem) return showMenu(uid, name);
  const circ = await circleById(mem.circle_id);
  if (!circ) return;
  const { data: r } = await sb.from("reports").insert({
    tg_id: uid, circle_id: circ.id, week_start: weekStart(), day: day(), pages,
  }).select().single();
  await send(circ.admin_id,
    `📖 <b>${esc(mem.name)}</b> — <b>${fmt(pages)}</b> sahifa yodladi\n📅 ${day()}\n\n` +
    `📞 Qo'ng'iroq qilib eshiting, keyin tasdiqlang.\n<a href="tg://user?id=${uid}">👤 ${esc(mem.name)} profiliga o'tish</a>`,
    { inline_keyboard: [[
      { text: "✅ Tasdiqlash", callback_data: `ok:${r.id}` },
      { text: "🔁 Qayta", callback_data: `rt:${r.id}` },
    ]] });
  if (quiet) return;
  return send(uid, `📨 Yuborildi: <b>${fmt(pages)}</b> sahifa.\nYo'naltiruvchi tekshirib, tasdiqlaydi ✅`,
    menuKb(!!(await circleOfAdmin(uid)), true));
}

// a'zoning hozirgi rejasi (so'rov yuborilganda "oldingi reja" sifatida ko'rsatiladi)
async function planSnapshot(uid: number) {
  const s = (await statsFor([uid], weekStart())).get(uid)!;
  const lt = await longTerm(uid);
  const L: string[] = [];
  L.push(s.goal ? `📅 Kunlik: ~${fmt(s.goal / 6)} sahifa` : "📅 Kunlik: belgilanmagan");
  L.push(s.goal ? `🎯 Haftalik: ${fmt(s.goal)} sahifa` : "🎯 Haftalik: belgilanmagan");
  L.push(lt.month ? `🗓 Oylik (${lt.month.name}): ${fmt(lt.month.target)} sahifa` : "🗓 Oylik: belgilanmagan");
  if (lt.plan) L.push(`📆 Yillik: ${fmt(lt.plan.juz)} juz`);
  return L.join("\n");
}
const REQ_NAME: Record<string, string> = { d: "kunlik", w: "haftalik", m: "oylik" };
const reqText = (v: number, kind: string) =>
  kind === "d" ? `kuniga <b>${fmt(v)}</b> sahifa (haftasiga ${fmt(v * 6)})`
    : kind === "m" ? `shu oy <b>${fmt(v)}</b> sahifa`
    : `bu hafta <b>${fmt(v)}</b> sahifa`;

async function sendRequest(uid: number, name: string, v: number, kind = "w", quiet = false) {
  const mem = await memberOf(uid);
  if (!mem) return showMenu(uid, name);
  const circ = await circleById(mem.circle_id);
  if (!circ) return;
  if (!REQ_NAME[kind]) kind = "w";
  const old = await planSnapshot(uid); // so'rovdan OLDINGI reja
  const cb = kind === "d" ? `gd:${uid}:${v}` : kind === "m" ? `gm:${uid}:${v}` : `ga:${uid}:${v}`;
  await send(circ.admin_id,
    `🎯 <b>${esc(mem.name)}</b> ${REQ_NAME[kind]} maqsad so'radi: ${reqText(v, kind)}\n\n📝 Uning rejasi bu edi:\n${old}`,
    { inline_keyboard: [[
      { text: "✅ Qabul qilish", callback_data: cb },
      { text: "✏️ O'zgartirish", callback_data: `as:${uid}` },
    ]] });
  if (quiet) return old;
  return send(uid, `📨 So'rov yuborildi: ${reqText(v, kind)}.\n\n📝 Sening rejang bu edi:\n${old}\n\nYo'naltiruvchi tasdiqlaydi.`,
    menuKb(!!(await circleOfAdmin(uid)), true));
}

async function setGoal(adminUid: number, memberId: number, pages: number, quiet = false) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return;
  const { data: m } = await sb.from("members").select("*").eq("tg_id", memberId).eq("circle_id", circ.id).maybeSingle();
  if (!m) return send(adminUid, "A'zo topilmadi.");
  const gkey = { tg_id: memberId, week_start: weekStart() };
  const { data: oldGoal } = await sb.from("goals").select("*").match(gkey).maybeSingle();
  const { data: newGoal } = await sb.from("goals").upsert({ ...gkey, pages }, { onConflict: "tg_id,week_start" }).select().single();
  await auditWrite(circ.id, adminUid, memberId, "goal_set", "goals", gkey, oldGoal, newGoal);
  const mem = await memberOf(adminUid);
  if (!quiet) await send(adminUid, `✅ <b>${esc(m.name)}</b> uchun bu hafta: <b>${fmt(pages)}</b> sahifa`, menuKb(true, !!mem));
  if (memberId !== adminUid) {
    await send(memberId,
      `🎯 Sizga bu hafta <b>${fmt(pages)}</b> sahifa belgilandi (kuniga ~${fmt(pages / 6)}).\nShanbagacha ezberlang, barakalla! 🌙`,
      menuKb(false, true));
  }
}

async function decide(uid: number, rid: number, status: "approved" | "repeat", mid?: number) {
  const circ = await circleOfAdmin(uid);
  if (!circ) return;
  const { data: upd } = await sb.from("reports")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", rid).eq("circle_id", circ.id).eq("status", "pending").select();
  const r = upd?.[0];
  if (!r) {
    if (mid) await edit(uid, mid, "Bu hisobot allaqachon ko'rib chiqilgan.");
    return;
  }
  const { data: m } = await sb.from("members").select("*").eq("tg_id", r.tg_id).maybeSingle();
  const nm = m?.name ?? "A'zo";
  if (mid) {
    await edit(uid, mid,
      `${status === "approved" ? "✅ Tasdiqlandi" : "🔁 Qayta so'raldi"}: <b>${esc(nm)}</b> — ${fmt(Number(r.pages))} sahifa`);
  }
  if (status === "approved") {
    const st = (await statsFor([r.tg_id], r.week_start)).get(r.tg_id)!;
    const crossed = st.goal > 0 && st.approved + 1e-9 >= st.goal && st.approved - Number(r.pages) + 1e-9 < st.goal;
    let msg = `✅ Tasdiqlandi: <b>${fmt(Number(r.pages))}</b> sahifa. Barakalla! 🌟\n` +
      (st.goal ? `Bu hafta: ${fmt(st.approved)} / ${fmt(st.goal)}` : "");
    if (crossed) {
      const rec = await weekRecord(r.tg_id);
      msg += `\n\n🎉 <b>Haftalik maqsad bajarildi!</b> 🏆\n` +
        (r.week_start === weekStart() && elapsed() < 6
          ? "🏖️ Haftaning qolgan kunlari — dam olish kuni, eslatma kelmaydi.\n" : "") +
        `🔥 Hafta seriyasi: ${rec.streak}`;
      await send(circ.admin_id,
        `🏆 <b>${esc(nm)}</b> haftalik maqsadni bajardi (${fmt(st.approved)} / ${fmt(st.goal)}). Mukofotlang! 🎁`);
    }
    await send(r.tg_id, msg, await kbFor(r.tg_id));
  } else {
    await send(r.tg_id,
      `🔁 Yo'naltiruvchi <b>${fmt(Number(r.pages))}</b> sahifani qaytadan takrorlashingizni so'radi.\nTayyor bo'lgach, yana «📖 Yodladim» ni bosing.`,
      menuKb(false, true));
  }
}

async function memberInCircle(adminUid: number, memberId: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return null;
  const { data: m } = await sb.from("members").select("*").eq("tg_id", memberId).eq("circle_id", circ.id).maybeSingle();
  return m;
}

async function setYear(adminUid: number, memberId: number, juz: number, quiet = false) {
  const m = await memberInCircle(adminUid, memberId);
  if (!m) return send(adminUid, "A'zo topilmadi.");
  const { data: oldPlan } = await sb.from("plans").select("*").eq("tg_id", memberId).maybeSingle();
  const { data: newPlan } = await sb.from("plans").upsert({ tg_id: memberId, juz, start_date: weekStart(), weeks: 52 }, { onConflict: "tg_id" }).select().single();
  await auditWrite(m.circle_id, adminUid, memberId, "year_plan", "plans", { tg_id: memberId }, oldPlan, newPlan);
  const lt = await longTerm(memberId);
  if (memberId !== adminUid) {
    await send(memberId,
      `📆 Sizga yillik reja belgilandi: <b>${fmt(juz)}</b> juz (${fmt(juz * JUZ)} sahifa).` +
      `${lt.suggest ? `\n💡 Haftalik taxminiy: <b>${fmt(lt.suggest)}</b> sahifa` : ""}\nInsha'Allah, barakali bo'lsin! 🌙`,
      await kbFor(memberId));
  }
  if (quiet) return;
  await send(adminUid, `✅ <b>${esc(m.name)}</b> uchun yillik reja: <b>${fmt(juz)}</b> juz`);
  return act(`as:${memberId}`, adminUid, "");
}

async function setMonth(adminUid: number, memberId: number, juz: number | null, quiet = false) {
  const m = await memberInCircle(adminUid, memberId);
  if (!m) return send(adminUid, "A'zo topilmadi.");
  const key = day().slice(0, 7);
  if (juz === null) {
    await sb.from("month_goals").delete().eq("tg_id", memberId).eq("month", key);
  } else {
    await sb.from("month_goals").upsert({ tg_id: memberId, month: key, pages: juz * JUZ }, { onConflict: "tg_id,month" });
  }
  const lt = await longTerm(memberId);
  if (memberId !== adminUid && juz !== null) {
    await send(memberId,
      `🗓 Shu oy uchun maqsad: <b>${fmt(juz)}</b> juz (${fmt(juz * JUZ)} sahifa).` +
      `${lt.suggest ? `\n💡 Haftalik taxminiy: <b>${fmt(lt.suggest)}</b> sahifa` : ""}`,
      await kbFor(memberId));
  }
  if (quiet) return;
  await send(adminUid, juz === null
    ? `♻️ <b>${esc(m.name)}</b>: oylik maqsad avtomatik hisobga qaytdi`
    : `✅ <b>${esc(m.name)}</b>: shu oy <b>${fmt(juz)}</b> juz`);
  return act(`as:${memberId}`, adminUid, "");
}

const MEDALS = ["🥇", "🥈", "🥉"];

async function rankingText(circId: number, scope: string) {
  if (scope === "s") return await scoreText(circId);
  const { data: ms } = await sb.from("members").select("*").eq("circle_id", circId);
  const list = ms ?? [];
  type Row = { name: string; goal: number; done: number };
  const rows: Row[] = [];
  const none: string[] = [];
  let title = "";
  if (scope === "w") {
    title = `Hafta (${weekStart()})`;
    const st = await statsFor(list.map((m) => m.tg_id), weekStart());
    for (const m of list) {
      const s = st.get(m.tg_id)!;
      if (s.goal) rows.push({ name: m.name, goal: s.goal, done: s.approved }); else none.push(m.name);
    }
  } else {
    for (const m of list) {
      const lt = await longTerm(m.tg_id);
      const t = scope === "m"
        ? (lt.month ? { goal: lt.month.target, done: lt.month.approved } : null)
        : (lt.plan ? { goal: lt.plan.pages, done: lt.plan.approved } : null);
      if (t && t.goal > 0) rows.push({ name: m.name, ...t }); else none.push(m.name);
    }
    title = scope === "m" ? `Oy (${MONTHS[Number(day().slice(5, 7)) - 1]})` : "Yil";
  }
  rows.sort((a, b) => b.done / b.goal - a.done / a.goal || b.done - a.done);
  const lines = rows.map((r, i) =>
    `${MEDALS[i] ?? `${i + 1}.`} ${esc(r.name)} — <b>${Math.round((r.done / r.goal) * 100)}%</b> (${fmt(r.done)}/${fmt(r.goal)})${r.done + 1e-9 >= r.goal ? " 🎉" : ""}`);
  let out = `🏆 <b>Reyting: ${title}</b>\n(maqsadga nisbatan)\n\n` + (lines.length ? lines.join("\n") : "Hali reja belgilanmagan.");
  if (none.length) out += `\n\nReja yo'q: ${none.map(esc).join(", ")}`;
  return out;
}

const rankKb = (scope: string) => ({
  inline_keyboard: [
    [["w", "📅 Hafta"], ["m", "🗓 Oy"], ["y", "📆 Yil"], ["s", "🏅 Ball"]].map(([k, l]) => ({
      text: (k === scope ? "• " : "") + l, callback_data: `top:${k}`,
    })),
    [{ text: "⬅️ Menyu", callback_data: "m" }],
  ],
});

async function act(a: string, uid: number, name: string, mid?: number) {
  const circ = await adminCircle(uid, name);
  const mem = await memberOf(uid);
  const isAdmin = !!circ, isMem = !!mem;
  const ws = weekStart();
  const setSession = (state: string) => sb.from("sessions").upsert({ tg_id: uid, state, data: {} });

  if (a === "start" || a === "menu" || a === "m") {
    await ensureCommands();
    return showMenu(uid, name);
  }

  if (a === "new") return showMenu(uid, name);

  if (a === "rdm" && circ) return send(uid, `🛌 Dam kuni: <b>${FULLDAY[REST]}</b>\nQaysi kun dam bo'lsin?`, restKb());
  if (a.startsWith("rd:") && circ) {
    const ok = await setRest(uid, Number(a.slice(3)));
    return send(uid, ok ? `✅ Dam kuni: <b>${FULLDAY[REST]}</b>.\nOylik reja va haftalik hisob shunga moslanadi.` : "Xato.", restKb());
  }
  if (await actEditPlus(a, uid)) return;
  if (await actAdminPlus(a, uid, name, mid)) return;
  if (await actPlus(a, uid, name, mid)) return;

  if (a === "site") {
    if (!circ) return;
    return send(uid, "👑 Panelni ochish 👇", { inline_keyboard: [[{ text: "👑 Panel", web_app: { url: SITE + "admin/" } }], [{ text: `🛌 Dam kuni: ${FULLDAY[REST]}`, callback_data: "rdm" }]] });
  }

  if (a === "join") {
    if (!circ) return;
    await sb.from("members").upsert({ tg_id: uid, circle_id: circ.id, name }, { onConflict: "tg_id" });
    return showMenu(uid, name, "✅ Siz endi a'zosiz ham.");
  }

  if (a.startsWith("top:")) {
    const c = circ ?? (mem ? await circleById(mem.circle_id) : null);
    if (!c) return showMenu(uid, name);
    const scope = a.slice(4);
    const t = await rankingText(c.id, scope);
    if (mid) return edit(uid, mid, t, rankKb(scope));
    return send(uid, t, rankKb(scope));
  }

  // ----- a'zo amallari -----
  if (a === "rp" && isMem) {
    return send(uid, "📖 Necha sahifa yodladingiz?", numKb("r", "m"));
  }
  if (a.startsWith("r:") && isMem) {
    const v = a.slice(2);
    if (v === "x") {
      await setSession("report");
      return send(uid, "Necha sahifa? Son yozing. Masalan: <code>2</code> yoki <code>1.5</code>");
    }
    return createReport(uid, name, Number(v));
  }

  if (a === "tk" && isMem) return send(uid, `🔁 Necha sahifa takror qildingiz?\n<i>Norma: kuniga ${fmt(REV_DAILY)} sahifa</i>`, numKb("tk", "m", [1, 2, 3, 4, 5, 6, 8, 10]));
  if (a.startsWith("tk:") && isMem) {
    const v = a.slice(3);
    if (v === "x") { await setSession("rev"); return send(uid, "Necha sahifa? Son yozing. Masalan: <code>3</code>"); }
    return void (await addRevision(uid, Number(v)));
  }
  if (a === "me" && isMem) {
    const s = (await statsFor([uid], ws)).get(uid)!;
    const { data: all } = await sb.from("reports").select("pages").eq("tg_id", uid).eq("status", "approved");
    const total = (all ?? []).reduce((x, r) => x + Number(r.pages), 0);
    const lt = await longTerm(uid);
    const rec = await weekRecord(uid);
    return send(uid, statsText(mem.name, s, total, lt, rec) + (await revLine(uid)) + (await timeLines(uid)), menuKb(isAdmin, true));
  }

  // ----- yo'naltiruvchi amallari -----
  if (!isAdmin) return showMenu(uid, name);

  if (a === "al") {
    const { data: ms } = await sb.from("members").select("*").eq("circle_id", circ.id).order("joined_at");
    if (!ms?.length) return send(uid, "Hali a'zolar yo'q.", { inline_keyboard: [[{ text: "➕ A'zo qo'shish", callback_data: "ma" }], [{ text: "⬅️ Orqaga", callback_data: "m" }]] });
    const st = await statsFor(ms.map((m) => m.tg_id), ws);
    const body = ms.map((m) => lineFor(m.name, st.get(m.tg_id)!)).join("\n");
    return send(uid,
      `👥 <b>A'zolar</b>\n\n${body}\n\nReja kiritish uchun ismni bosing 👇`,
      { inline_keyboard: [
        [{ text: "➕ A'zo qo'shish", callback_data: "ma" }],
        ...ms.map((m) => [{ text: `👤 ${m.name}`, callback_data: `as:${m.tg_id}` }]),
        [{ text: "⬅️ Orqaga", callback_data: "m" }],
      ] });
  }

  if (a.startsWith("as:")) {
    const id = Number(a.slice(3));
    const { data: m } = await sb.from("members").select("*").eq("tg_id", id).eq("circle_id", circ.id).maybeSingle();
    if (!m) return send(uid, "A'zo topilmadi.");
    const s = (await statsFor([id], ws)).get(id)!;
    const lt = await longTerm(id);
    const rows: unknown[][] = [
      [{ text: "🗓 Oylik reja", callback_data: `mp:${id}` }],
      [{ text: "🎯 Haftalik", callback_data: `aw:${id}` }, { text: "📆 Yillik", callback_data: `ay:${id}` }],
      [{ text: "🗺 Reja", callback_data: `ap:${id}` }, { text: "⚠️ Xatolar", callback_data: `xa:${id}` }],
      [{ text: "📖 Hisobotlar", callback_data: `rl:${id}` }, { text: "📜 Tarix", callback_data: `hl:${id}` }],
      [{ text: "🗑 A'zoni o'chirish", callback_data: `mdc:${id}` }],
      [{ text: "⬅️ Orqaga", callback_data: "al" }],
    ];
    return send(uid,
      `👤 <b>${esc(m.name)}</b>${m.phone ? `\n📞 ${esc(m.phone)}` : ""}\n🆔 <code>${id}</code>\n🎯 Bu hafta: ${s.goal ? `${fmt(s.approved)} / ${fmt(s.goal)}` : "reja yo'q"}${ltLines(lt)}`,
      { inline_keyboard: rows });
  }
  if (a.startsWith("aw:")) {
    const id = Number(a.slice(3));
    const kbw = numKb(`sg:${id}`, `as:${id}`);
    kbw.inline_keyboard.splice(kbw.inline_keyboard.length - 1, 0, [{ text: "🧹 Maqsadni tozalash", callback_data: `gc:${id}` }]);
    return send(uid, "🎯 Bu hafta necha sahifa?", kbw);
  }
  if (a.startsWith("ss:")) {
    const [, id, v] = a.split(":");
    return setGoal(uid, Number(id), Number(v));
  }
  if (a.startsWith("ay:")) {
    const id = Number(a.slice(3));
    return send(uid, "🗓 Yillik reja: necha juz? (1 juz = 20 sahifa)",
      numKb(`yg:${id}`, `as:${id}`, [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30]));
  }
  if (a.startsWith("yg:")) {
    const [, id, v] = a.split(":");
    if (v === "x") {
      await setSession(`yg:${id}`);
      return send(uid, "Necha juz? Son yozing. Masalan: <code>10</code> yoki <code>1.5</code>");
    }
    return setYear(uid, Number(id), Number(v));
  }
  if (a.startsWith("am:")) {
    const id = Number(a.slice(3));
    const kb = numKb(`mg:${id}`, `as:${id}`, [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
    kb.inline_keyboard.splice(kb.inline_keyboard.length - 2, 0, [{ text: "♻️ Avtomatik hisob", callback_data: `mg:${id}:auto` }]);
    return send(uid, "📅 Shu oy uchun maqsad: necha juz?\n(Odatda yillikdan avtomatik hisoblanadi, xohlasangiz o'zgartiring)", kb);
  }
  if (a.startsWith("mg:")) {
    const [, id, v] = a.split(":");
    if (v === "auto") return setMonth(uid, Number(id), null);
    if (v === "x") {
      await setSession(`mg:${id}`);
      return send(uid, "Necha juz? Son yozing. Masalan: <code>1</code> yoki <code>0.5</code>");
    }
    return setMonth(uid, Number(id), Number(v));
  }
  if (a.startsWith("sg:")) {
    const [, id, v] = a.split(":");
    if (v === "x") {
      await setSession(`sg:${id}`);
      return send(uid, "Necha sahifa? Son yozing. Masalan: <code>3</code>");
    }
    return setGoal(uid, Number(id), Number(v));
  }
  if (a.startsWith("gd:")) {
    const [, id, v] = a.split(":");
    if (mid) await edit(uid, mid, "✅ Qabul qilindi (kunlik)");
    return setGoal(uid, Number(id), Number(v) * 6);
  }
  if (a.startsWith("gm:")) {
    const [, id, v] = a.split(":");
    if (mid) await edit(uid, mid, "✅ Oylik so'rov qabul qilindi — boshlanish nuqtasini kiriting");
    return askMonthStart(uid, Number(id), Number(v));
  }
  if (a.startsWith("ga:")) {
    const [, id, v] = a.split(":");
    if (mid) await edit(uid, mid, "✅ Qabul qilindi");
    return setGoal(uid, Number(id), Number(v));
  }

  if (a === "ap") {
    const { data: rs } = await sb.from("reports").select("*")
      .eq("circle_id", circ.id).eq("status", "pending").order("created_at").limit(10);
    if (!rs?.length) return send(uid, "Tekshiradigan hisobot yo'q 👍", menuKb(true, isMem));
    const { data: ms } = await sb.from("members").select("tg_id,name").in("tg_id", rs.map((r) => r.tg_id));
    const names = new Map((ms ?? []).map((m) => [m.tg_id, m.name]));
    for (const r of rs) {
      const nm = names.get(r.tg_id) ?? "A'zo";
      await send(uid,
        `📖 <b>${esc(nm)}</b> — <b>${fmt(Number(r.pages))}</b> sahifa\n📅 ${r.day}\n<a href="tg://user?id=${r.tg_id}">👤 profiliga o'tish</a>`,
        { inline_keyboard: [[
          { text: "✅ Tasdiqlash", callback_data: `ok:${r.id}` },
          { text: "🔁 Qayta", callback_data: `rt:${r.id}` },
        ]] });
    }
    return;
  }
  if (a.startsWith("ok:")) return decide(uid, Number(a.slice(3)), "approved", mid);
  if (a.startsWith("rt:")) return decide(uid, Number(a.slice(3)), "repeat", mid);

  if (a === "ar") {
    const { data: ms } = await sb.from("members").select("*").eq("circle_id", circ.id).order("joined_at");
    if (!ms?.length) return send(uid, "Hali a'zolar yo'q.", menuKb(true, isMem));
    const st = await statsFor(ms.map((m) => m.tg_id), ws);
    const total = [...st.values()].reduce((x, s) => x + s.approved, 0);
    return send(uid,
      `📈 <b>Hafta hisoboti</b> (${ws})\n\n${ms.map((m) => lineFor(m.name, st.get(m.tg_id)!)).join("\n")}\n\nJami tasdiqlangan: <b>${fmt(total)}</b> sahifa`,
      menuKb(true, isMem));
  }
}

// ---------- v10: oylik reja (admin kiritadi, kunlarga bo'linadi) ----------
// reja belgilangan kundan oy oxirigacha, dam kunisiz
function planDates(fromDate: string): string[] {
  const out: string[] = [];
  const end = monthEnd(fromDate);
  for (let d = fromDate; d <= end; d = addDays(d, 1)) {
    if (new Date(d + "T00:00:00Z").getUTCDay() !== REST) out.push(d);
  }
  return out.length ? out : [end];
}
const WD = ["Yak", "Du", "Se", "Chor", "Pay", "Ju", "Sha"];
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)} ${WD[new Date(d + "T00:00:00Z").getUTCDay()]}`;

async function monthPlan(uid: number) {
  const { data: mp } = await sb.from("month_plans").select("*").eq("tg_id", uid).eq("month", day().slice(0, 7)).maybeSingle();
  if (!mp) return null;
  const dir = (mp.dir === -1 ? -1 : 1) as Dir;
  const dates = planDates(mp.from_date);
  const total = Number(mp.pages);
  const blocks = splitBlocks(mp.start_ayah, total, dates.length, dir);
  const t = day();
  const days = dates.map((d, i) => {
    const b = blocks[i];
    return {
      date: d, label: dmy(d), from: b ? label(b.from) : "—", to: b ? label(b.to) : "—", pages: b ? b.pages : 0,
      fromId: b?.from ?? 0, toId: b?.to ?? 0, today: d === t, past: d < t,
    };
  });
  const { data: rs } = await sb.from("reports").select("pages,status").eq("tg_id", uid)
    .gte("day", mp.from_date).lte("day", monthEnd(mp.from_date)).in("status", ["approved", "pending"]);
  const done = (rs ?? []).reduce((x, r) => x + Number(r.pages), 0);
  const planned = days.filter((d) => d.date <= t).reduce((x, d) => x + d.pages, 0);
  return { pages: total, start: label(mp.start_ayah), dir: mp.dir as number, fromDate: mp.from_date, days, done, planned, behind: Math.max(0, planned - done) };
}

async function setMonthPlan(adminUid: number, memberId: number, pages: number, startId: number, dir: number) {
  const m = await memberInCircle(adminUid, memberId);
  if (!m) return send(adminUid, "A'zo topilmadi.");
  const key = day().slice(0, 7);
  const mkey = { tg_id: memberId, month: key };
  const { data: oldMp } = await sb.from("month_plans").select("*").match(mkey).maybeSingle();
  const { data: newMp } = await sb.from("month_plans").upsert({ ...mkey, pages, start_ayah: startId, dir: dir === -1 ? -1 : 1, from_date: day(), set_by: adminUid }).select().single();
  await auditWrite(m.circle_id, adminUid, memberId, "month_plan", "month_plans", mkey, oldMp, newMp);
  await sb.from("month_goals").upsert({ tg_id: memberId, month: key, pages }, { onConflict: "tg_id,month" });
  const dates = planDates(day());
  const ws = weekStart();
  const inWeek = dates.filter((d) => d >= ws && d <= addDays(ws, 5)).length;
  if (inWeek) await sb.from("goals").upsert({ tg_id: memberId, week_start: ws, pages: ceilHalf((pages * inWeek) / dates.length) }, { onConflict: "tg_id,week_start" });
  const mp = await monthPlan(memberId);
  if (!mp) return;
  const today = mp.days.find((d) => d.today);
  const head = `🗓 <b>Oylik reja</b>: ${fmt(pages)} sahifa, ${mp.days.length} kun (${FULLDAY[REST]} dam)\n📍 Boshlanish: ${mp.start} (${mp.dir === -1 ? "orqaga" : "oldinga"})\n⚡ Kuniga ≈ ${pageStr(pages / mp.days.length)} sahifa`;
  const sched = mp.days.slice(0, 7).map((d) => `${d.today ? "👉" : "▫️"} ${d.label}: ${d.from} → ${d.to}`).join("\n");
  if (memberId !== adminUid) {
    await send(memberId,
      `${head}\n\n${today ? `📌 Bugun: <b>${today.from} → ${today.to}</b> (≈ ${pageStr(today.pages)} bet)\n\n` : ""}Birinchi kunlar:\n${sched}\n\nTo'liq jadval: «🗺 Rejam».`,
      menuKb(false, true)).catch(() => {});
  }
  await send(adminUid, `✅ <b>${esc(m.name)}</b> uchun oylik reja belgilandi.\n\n${head}\n\nA'zoga yuborildi.`, menuKb(true, !!(await memberOf(adminUid))));
}

async function askMonthStart(adminUid: number, memberId: number, pages: number) {
  const pos = await getPos(memberId);
  await sb.from("sessions").upsert({ tg_id: adminUid, state: "mps", data: { id: memberId, pages } });
  const rows: unknown[][] = [];
  if (pos) rows.push([{ text: `➡️ Oxirgi nuqtadan: ${label(pos.ptr)}`, callback_data: "mpl" }]);
  return send(adminUid,
    `🗓 <b>${fmt(pages)}</b> sahifa. Qayerdan boshlanadi?\nSura va oyatni yozing: <code>78 1</code>\nyoki bet raqami: <code>bet 582</code>`,
    { inline_keyboard: [...rows, [{ text: "⬅️ Bekor", callback_data: `as:${memberId}` }]] });
}

// ---------- v11: AI ovoz tahlili (Whisper + so'zma-so'z solishtirish) ----------
// Sozlash: Supabase secret GROQ_API_KEY. Kalit yo'q bo'lsa, tahlil o'chiq turadi (hech narsa buzilmaydi).
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "whisper-large-v3";
const QURAN_CDN = "https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/";
const _surahCache = new Map<number, string[]>();
async function surahTexts(n: number): Promise<string[]> {
  const c = _surahCache.get(n);
  if (c) return c;
  const r = await fetch(`${QURAN_CDN}${n}.json`);
  if (!r.ok) throw new Error("quran_text");
  const j = await r.json();
  const v = (j.verses as { text: string }[]).map((x) => x.text);
  _surahCache.set(n, v);
  return v;
}
async function refWords(from: number, to: number): Promise<Ref[]> {
  const out: Ref[] = [];
  for (let id = from; id <= to; id++) {
    const [su, ay] = fromId(id);
    const txt = (await surahTexts(su))[ay - 1] ?? "";
    words(txt).forEach((w, i) => out.push({ w, ayah: id, no: i + 1 }));
  }
  return out;
}
async function transcribe(fileId: string, hint = ""): Promise<string> {
  const f = await (await tg("getFile", { file_id: fileId })).json();
  const path = f?.result?.file_path;
  if (!path) throw new Error("tg_file");
  const audio = await (await fetch(`https://api.telegram.org/file/bot${BOT}/${path}`)).arrayBuffer();
  const fd = new FormData();
  fd.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  fd.append("model", GROQ_MODEL);
  fd.append("language", "ar");
  fd.append("temperature", "0");
  fd.append("response_format", "json");
  // ipucu: faqat boshlang'ich 1-2 oyat (imlo va uslubni to'g'ri tanishi uchun). Hammasini bermaymiz,
  // aks holda Whisper o'qilmagan joyni ham "to'g'ri" qilib yozib, haqiqiy xatolarni yashirib qo'yadi.
  if (hint) fd.append("prompt", hint.slice(0, 400));
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: fd,
  });
  if (!r.ok) throw new Error("groq_" + r.status);
  return String((await r.json()).text ?? "");
}
// fon rejimida bajarish (Edge Runtime bo'lsa javobni to'xtatmaydi)
function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("ai", e));
  const er = (globalThis as any).EdgeRuntime;
  return er?.waitUntil ? er.waitUntil(safe) : safe;
}

const AI_MAX_ITEMS = 8;
async function aiAnalyze(uid: number, range: [number, number], fileId: string, sessionId: number) {
  const mem = await memberOf(uid);
  const circ = mem ? await circleById(mem.circle_id) : null;
  if (!mem || !circ) return;
  try {
    if (pagesIn(range[0], range[1]) > 4) {
      return send(circ.admin_id, `🤖 AI tahlil: <b>${esc(mem.name)}</b> oralig'i juda katta (4 betdan ko'p), tahlil qilinmadi.`);
    }
    const ref = await refWords(range[0], range[1]);
    const hint = (await Promise.all([range[0], Math.min(range[0] + 1, range[1])].filter((x, i, a) => a.indexOf(x) === i)
      .map(async (id) => { const [su, ay] = fromId(id); return (await surahTexts(su))[ay - 1] ?? ""; }))).join(" ");
    const text = await transcribe(fileId, hint);
    let hyp = words(text);
    // Whisper ipucuni o'zi qaytarib yuborgan bo'lsa (ovoz bo'sh/shovqin) — haqiqiy o'qish emas
    if (hyp.join(" ") === words(hint).join(" ")) hyp = [];
    if (hyp.length < Math.min(3, ref.length)) {
      return send(circ.admin_id, `🤖 AI tahlil: <b>${esc(mem.name)}</b> ovozidan matn deyarli chiqmadi (tovush past yoki shovqin). O'zingiz eshiting.`);
    }
    const res = align(ref, hyp);
    const pct = Math.round((res.matched / res.total) * 100);
    const items = res.issues.slice(0, AI_MAX_ITEMS);
    const head = `🤖 <b>AI tahlil (taxminiy)</b> — ${esc(mem.name)}\n📖 ${label(range[0])} → ${label(range[1])}\n✅ Mos so'zlar: <b>${pct}%</b> (${res.matched}/${res.total})`;
    if (!items.length) {
      return send(circ.admin_id, `${head}\n\nShubhali joy topilmadi 👍\n<i>Tajvid va talaffuzni AI baholamaydi — baribir eshiting.</i>`);
    }
    const rows: string[] = [];
    const kb: unknown[][] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const [su, ay] = fromId(it.ayah);
      const wno = it.kind === "missing" ? it.from : it.no;
      const desc = it.kind === "missing" ? `so'z tushib qolgan: «${it.text}»`
        : it.kind === "wrong" ? `boshqacha eshitildi: «${it.heard}» (kerak: «${it.expected}»)`
        : `ortiqcha so'z: «${it.text}»`;
      const { data: m } = await sb.from("mistakes").insert({
        tg_id: uid, circle_id: mem.circle_id, by_id: uid, ayah: it.ayah, word: wno,
        kind: it.kind === "missing" ? "forgot" : it.kind === "wrong" ? "wrong" : "other",
        note: `🤖 ${desc}`.slice(0, 200), session_id: sessionId, status: "suggested", source: "ai",
      }).select().single();
      rows.push(`${i + 1}. ${SURAH_NAMES[su - 1]} ${ay}, ${wno}-so'z — ${desc}`);
      if (m) kb.push([{ text: `✅ ${i + 1} — xato`, callback_data: `xy:${m.id}` }, { text: `❌ ${i + 1} — xato emas`, callback_data: `xn:${m.id}` }]);
    }
    const more = res.issues.length > items.length ? `\n… yana ${res.issues.length - items.length} ta (faqat birinchi ${AI_MAX_ITEMS} ko'rsatildi)` : "";
    kb.push([{ text: "✅ Hammasini xato deb belgilash", callback_data: `xya:${sessionId}` }]);
    await send(circ.admin_id,
      `${head}\n\n${esc(rows.join("\n"))}${more}\n\n<i>AI adashishi mumkin (ayniqsa shovqin, tez o'qish). Qaror sizniki: tasdiqlasangiz a'zoga xato bo'lib boradi.</i>`,
      { inline_keyboard: kb });
  } catch (e) {
    console.error("aiAnalyze", e);
    await send(circ.admin_id, `🤖 AI tahlil bajarilmadi (${esc(String((e as Error).message ?? e))}). Ovozni o'zingiz eshiting.`).catch(() => {});
  }
}
async function confirmMistake(adminUid: number, id: number, ok: boolean) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return;
  const { data: m } = await sb.from("mistakes").select("*").eq("id", id).eq("circle_id", circ.id).eq("status", "suggested").maybeSingle();
  if (!m) return;
  await sb.from("mistakes").update({ status: ok ? "open" : "rejected" }).eq("id", id);
  if (ok) {
    await send(m.tg_id, `⚠️ Yo'naltiruvchi xato belgiladi:\n<b>${label(m.ayah)}</b>${m.word ? `, ${m.word}-so'z` : ""}${m.note ? `\n${esc(String(m.note).replace(/^🤖 /, ""))}` : ""}\n\nTuzatgach «📋 Xatolarim» dan belgilang.`).catch(() => {});
  }
}

// ---------- v9: batafsil reja, jonli yodlash, xatolar ----------
const hm = (d: Date | string | number) => new Date(new Date(d).getTime() + TZ * 3600e3).toISOString().slice(11, 16);
const SLOTS: Record<string, string> = { fajr: "🌅 Bomdoddan keyin", isha: "🌙 Xufton namozidan keyin", other: "🕒 Boshqa vaqt" };
const KINDS: Record<string, string> = { forgot: "Unutdim/to'xtadim", wrong: "Almashtirdim", tajweed: "Tajvid/talaffuz", other: "Boshqa" };
const halfRound = (p: number) => Math.max(0.5, Math.round(p * 2) / 2);
const pageStr = (n: number) => (Math.round(n * 10) / 10).toString().replace(".", ",");

// "78", "78 1", "78:1", "bet 582" -> global oyat raqami
function parseAyah(t: string): number | null {
  const s = t.trim().toLowerCase().replace(/[:,.\-–]+/g, " ").replace(/\s+/g, " ");
  const m = s.match(/^(?:bet|b|page|p)\s*(\d+)$/);
  if (m) { const p = Number(m[1]); return p >= 1 && p <= 604 ? PAGE_FIRST[p - 1] : null; }
  const parts = s.split(" ").map(Number);
  if (!parts.length || parts.some((x) => !Number.isInteger(x))) return null;
  const [su, ay = 1] = parts;
  return parts.length <= 2 && validSA(su, ay) ? ayahId(su, ay) : null;
}
// "78:1 - 78:20" yoki "78 1 78 20" -> [from, to]
function parseRange(t: string): [number, number] | null {
  const nums = t.replace(/[:\-–→,.]+/g, " ").trim().split(/\s+/).map(Number);
  if (nums.some((x) => !Number.isInteger(x))) return null;
  let a: number | null = null, b: number | null = null;
  if (nums.length === 4) { a = validSA(nums[0], nums[1]) ? ayahId(nums[0], nums[1]) : null; b = validSA(nums[2], nums[3]) ? ayahId(nums[2], nums[3]) : null; }
  else if (nums.length === 3 && validSA(nums[0], nums[1]) && nums[2] >= nums[1] && nums[2] <= SURAH_AYAHS[nums[0] - 1]) { a = ayahId(nums[0], nums[1]); b = ayahId(nums[0], nums[2]); }
  if (!a || !b || b < a) return null;
  return [a, b];
}

async function getPos(uid: number) {
  const { data: p } = await sb.from("positions").select("*").eq("tg_id", uid).maybeSingle();
  if (!p) return null;
  const ws = weekStart();
  if (p.week_start !== ws) {
    p.week_start = ws; p.week_ptr = p.ptr;
    await sb.from("positions").update({ week_start: ws, week_ptr: p.ptr }).eq("tg_id", uid);
  }
  return p as { tg_id: number; ptr: number; dir: number; start_ayah: number; week_start: string; week_ptr: number };
}
async function setPos(uid: number, ptr: number, dir: number) {
  const ws = weekStart();
  await sb.from("positions").upsert({ tg_id: uid, ptr, dir, start_ayah: ptr, week_start: ws, week_ptr: ptr, updated_at: new Date().toISOString() });
}

type PlanInfo = {
  has: boolean; dir?: number; start?: string; last?: string | null; next?: string;
  goal: number; done: number; left: number;
  today?: { from: string; to: string; pages: number; fromId: number; toId: number } | null; todayDone?: boolean;
  week?: { from: string; to: string; pages: number } | null;
  days?: { day: string; from: string; to: string; pages: number; today: boolean; past?: boolean }[];
  avgWeek: number; remainPlan?: number; eta?: string | null; planPages?: number; weekPtr?: number;
  monthPlan?: { pages: number; start: string; dir: number; done: number; planned: number; behind: number; daysCount: number };
  restDay?: boolean;
};
const DAYN = { at: (i: number) => SHORTDAY[WORKDOW()[i]] };
async function planInfo(uid: number): Promise<PlanInfo> {
  const ws = weekStart();
  const s = (await statsFor([uid], ws)).get(uid)!;
  const goal = s.goal, done = s.approved + s.pending;
  const info: PlanInfo = { has: false, goal, done, left: Math.max(0, goal - done), avgWeek: 0 };
  // o'rtacha tezlik: oxirgi 28 kun (yoki boshlanganidan beri), tasdiqlangan sahifalar
  const { data: rs } = await sb.from("reports").select("day,pages").eq("tg_id", uid).eq("status", "approved");
  if (rs?.length) {
    const first = rs.map((r) => r.day).sort()[0];
    const span = Math.min(28, Math.max(7, daysBetween(first, day()) + 1));
    const since = addDays(day(), -27);
    const tot = rs.filter((r) => r.day >= since).reduce((x, r) => x + Number(r.pages), 0);
    info.avgWeek = (tot / span) * 7;
  }
  const lt = await longTerm(uid);
  if (lt.plan) {
    info.planPages = lt.plan.pages;
    info.remainPlan = Math.max(0, lt.plan.pages - lt.plan.approved);
    info.eta = etaDate(info.remainPlan, info.avgWeek, day());
  }
  const mpl = await monthPlan(uid);
  if (mpl) {
    info.has = true; info.dir = mpl.dir === -1 ? -1 : 1; info.start = mpl.start;
    info.monthPlan = { pages: mpl.pages, start: mpl.start, dir: mpl.dir, done: mpl.done, planned: mpl.planned, behind: mpl.behind, daysCount: mpl.days.length };
    info.days = mpl.days.map((d) => ({ day: d.label, from: d.from, to: d.to, pages: d.pages, today: d.today, past: d.past }));
    const td = mpl.days.find((d) => d.today);
    if (td && td.pages > 0) {
      if (mpl.behind <= 0.05) info.todayDone = true;
      info.today = { from: td.from, to: td.to, pages: td.pages, fromId: td.fromId, toId: td.toId };
    } else info.restDay = true;
    return info;
  }
  const p = await getPos(uid);
  if (!p) return info;
  info.has = true;
  const dir = (p.dir === -1 ? -1 : 1) as Dir;
  info.dir = dir; info.start = label(p.start_ayah); info.next = label(p.ptr); info.weekPtr = p.week_ptr;
  const lastId = dir === 1 ? p.ptr - 1 : p.ptr + 1;
  info.last = p.ptr !== p.start_ayah && lastId >= 1 && lastId <= TOTAL ? label(lastId) : null;
  if (goal > 0) {
    const wb = weekBlock(p.week_ptr, goal, dir);
    info.week = wb ? { from: label(wb.from), to: label(wb.to), pages: wb.pages } : null;
    const di = dayIdx();
    info.days = dayBlocks(p.week_ptr, goal, dir).map((b, i) => ({
      day: DAYN.at(i), from: b ? label(b.from) : "—", to: b ? label(b.to) : "—", pages: b ? b.pages : 0, today: i === di,
    }));
    const need = expected(goal) - done;
    if (need <= 0.05) info.todayDone = true;
    else {
      const b = nextBlock(p.ptr, need, dir);
      if (b) info.today = { from: label(b.from), to: label(b.to), pages: b.pages, fromId: b.from, toId: b.to };
    }
  } else {
    const b = nextBlock(p.ptr, 1, dir);
    if (b) info.today = { from: label(b.from), to: label(b.to), pages: b.pages, fromId: b.from, toId: b.to };
  }
  return info;
}

function planText(pi: PlanInfo) {
  if (!pi.has) {
    return "🗺 <b>Rejam</b>\n\nHali boshlanish nuqtasi tanlanmagan.\nNimani, qayerdan yodlashni <b>o'zingiz</b> tanlaysiz 👇";
  }
  if (pi.monthPlan) {
    const m = pi.monthPlan;
    const L2 = [`🗺 <b>Oylik rejam</b>`, "", `🗓 ${fmt(m.pages)} sahifa, ${m.daysCount} kun · boshlanish: ${m.start} (${m.dir === -1 ? "orqaga" : "oldinga"})`,
      `✅ Bajarildi: ${fmt(m.done)} / ${fmt(m.pages)} sahifa`];
    L2.push(m.behind > 0.05 ? `⚠️ Rejadan orqada: ${pageStr(m.behind)} bet` : "👍 Reja bo'yicha ketyapsiz");
    if (pi.restDay) L2.push("🏖 Bugun dam olish kuni");
    else if (pi.todayDone) L2.push("🌟 Bugungi reja bajarilgan!");
    if (pi.today) L2.push(`📌 Bugun: <b>${pi.today.from} → ${pi.today.to}</b> (≈ ${pageStr(pi.today.pages)} bet)`);
    L2.push("", "🗓 Kunlar bo'yicha:");
    for (const d of pi.days ?? []) if (d.pages > 0) L2.push(`${d.today ? "👉" : d.past ? "▪️" : "▫️"} ${d.day}: ${d.from} → ${d.to}`);
    return L2.join("\n");
  }
  const L = [`🗺 <b>Rejam</b>`, ""];
  L.push(`📍 Boshlangan joy: ${pi.start} (${pi.dir === 1 ? "oldinga ➡️" : "orqaga ⬅️"})`);
  L.push(pi.last ? `✅ Oxirgi yodlangan: <b>${pi.last}</b>` : "✅ Hali yodlash boshlanmagan");
  L.push(`➡️ Keyingi: <b>${pi.next}</b>`);
  if (pi.goal) {
    L.push("", `🎯 Hafta: ${fmt(pi.done)} / ${fmt(pi.goal)} sahifa — qoldi <b>${fmt(pi.left)}</b>`);
    if (pi.week) L.push(`📅 Haftalik oraliq: ${pi.week.from} → ${pi.week.to} (${pageStr(pi.week.pages)} bet)`);
    if (pi.todayDone) L.push("🌟 Bugungi reja bajarilgan!");
    else if (pi.today) L.push(`📌 Bugun: <b>${pi.today.from} → ${pi.today.to}</b> (~${pageStr(pi.today.pages)} bet)`);
    if (pi.days?.length) {
      L.push("", "🗓 Kunlar bo'yicha:");
      for (const d of pi.days) if (d.pages > 0) L.push(`${d.today ? "👉" : "▫️"} ${d.day}: ${d.from} → ${d.to}`);
    }
  } else {
    L.push("", "🎯 Bu hafta maqsad hali belgilanmagan — yo'naltiruvchi belgilaydi.");
    if (pi.today) L.push(`📌 Taxminan 1 bet: ${pi.today.from} → ${pi.today.to}`);
  }
  L.push("", `⚡ O'rtacha tezlik: ${pageStr(pi.avgWeek)} bet/hafta`);
  if (pi.planPages) {
    L.push(`🏁 Yillik rejadan qoldi: ${fmt(pi.remainPlan ?? 0)} bet`);
    L.push(pi.eta ? `📆 Shu tezlikda tugash: <b>${pi.eta}</b>` : "📆 Tugash sanasi: tezlik hisoblash uchun hisobotlar kerak");
  }
  return L.join("\n");
}
const planKb = (pi: PlanInfo) => ({
  inline_keyboard: [
    [{ text: "📍 Boshlanish nuqtasini tanlash", callback_data: "ps" }],
    ...(pi.has ? [[{ text: pi.dir === 1 ? "🔄 Orqaga yodlayman" : "🔄 Oldinga yodlayman", callback_data: "pd" }]] : []),
    [{ text: "⚠️ Xato belgilash", callback_data: "xs" }, { text: "📋 Xatolarim", callback_data: "xl" }],
    [{ text: "⬅️ Orqaga", callback_data: "m" }],
  ],
});

// hammaga xabar (halqa a'zolari + yo'naltiruvchi), harakat qilgandan tashqari
async function broadcast(circId: number, exceptUid: number, msg: string) {
  const circ = await circleById(circId);
  if (!circ) return;
  const { data: ms } = await sb.from("members").select("tg_id").eq("circle_id", circId);
  const ids = new Set<number>([circ.admin_id, ...(ms ?? []).map((m) => m.tg_id)]);
  ids.delete(exceptUid);
  await Promise.all([...ids].map((id) => send(id, msg).catch(() => {})));
}

// 14 soatdan eski "jonli" holat o'z-o'zidan yopilgan hisoblanadi
const liveCutoff = () => new Date(Date.now() - 14 * 3600e3).toISOString();
async function liveOf(uid: number) {
  return (await sb.from("study_sessions").select("*").eq("tg_id", uid).eq("status", "live").gte("started_at", liveCutoff())
    .order("started_at", { ascending: false }).limit(1).maybeSingle()).data;
}

async function liveStart(uid: number, name: string, slot: string, hours: number, quiet = false) {
  const mem = await memberOf(uid);
  if (!mem) return showMenu(uid, name);
  const ex = await liveOf(uid);
  if (ex) return quiet ? undefined : send(uid, "Siz allaqachon yodlayapsiz ▶️. Tugatsangiz «⏹ Tugatdim» ni bosing.", liveMenuKb(true));
  const now = new Date(), end = new Date(now.getTime() + hours * 3600e3);
  const { data: s } = await sb.from("study_sessions").insert({
    tg_id: uid, circle_id: mem.circle_id, slot, win_from: hm(now), win_to: hm(end),
  }).select().single();
  const pi = await planInfo(uid);
  const where = pi.has ? (pi.today ? `\n📌 Reja: ${pi.today.from} → ${pi.today.to}` : `\n➡️ Keyingi: ${pi.next}`) : "";
  await broadcast(mem.circle_id, uid,
    `▶️ <b>${esc(mem.name)}</b> yodlashni boshladi\n${SLOTS[slot] ?? SLOTS.other} · ${s.win_from}–${s.win_to}${where}`);
  if (quiet) return;
  return send(uid, `▶️ Boshladingiz: ${s.win_from}–${s.win_to}\nBarakalla! Hamma ko'rdi 🌙\nTugatganda «⏹ Tugatdim» ni bosing.`, liveMenuKb(true));
}

async function liveTime(uid: number, name: string, hours: number, quiet = false) {
  const mem = await memberOf(uid);
  const s = await liveOf(uid);
  if (!mem || !s) return quiet ? undefined : send(uid, "Hozir faol yodlash yo'q.");
  const end = new Date(Date.now() + hours * 3600e3);
  await sb.from("study_sessions").update({ win_to: hm(end) }).eq("id", s.id);
  await broadcast(mem.circle_id, uid, `🕒 <b>${esc(mem.name)}</b> vaqtni o'zgartirdi: ${s.win_from}–${hm(end)}`);
  if (quiet) return;
  return send(uid, `🕒 Yangi vaqt: ${s.win_from}–${hm(end)}`, liveMenuKb(true));
}

// yodlash tugadi: oraliq (from..to) bo'lsa pozitsiya suriladi va avtomatik hisobot ketadi
async function liveFinish(uid: number, name: string, range: [number, number] | null, voice: string | null, quiet = false) {
  const mem = await memberOf(uid);
  const s = await liveOf(uid);
  if (!mem || !s) return quiet ? undefined : send(uid, "Hozir faol yodlash yo'q.");
  let pages = 0, rid: number | null = null;
  if (range) {
    pages = halfRound(pagesIn(range[0], range[1]));
    const p = await getPos(uid);
    const dir = p?.dir === -1 ? -1 : 1;
    const newPtr = dir === 1 ? range[1] + 1 : range[0] - 1;
    if (newPtr >= 1 && newPtr <= TOTAL) await sb.from("positions").upsert({
      tg_id: uid, ptr: newPtr, dir, start_ayah: p?.start_ayah ?? (dir === 1 ? range[0] : range[1]),
      week_start: p?.week_start ?? weekStart(), week_ptr: p?.week_ptr ?? (dir === 1 ? range[0] : range[1]),
      updated_at: new Date().toISOString(),
    });
    const circ = await circleById(mem.circle_id);
    const { data: r } = await sb.from("reports").insert({
      tg_id: uid, circle_id: mem.circle_id, week_start: weekStart(), day: day(), pages,
    }).select().single();
    rid = r?.id ?? null;
    if (circ && r) {
      await send(circ.admin_id,
        `📖 <b>${esc(mem.name)}</b> yodladi: <b>${label(range[0])} → ${label(range[1])}</b>\n≈ <b>${fmt(pages)}</b> sahifa · 📅 ${day()}\n\n` +
        `📞 Qo'ng'iroq qilib eshiting, keyin tasdiqlang.\n<a href="tg://user?id=${uid}">👤 ${esc(mem.name)} profiliga o'tish</a>`,
        { inline_keyboard: [
          [{ text: "✅ Tasdiqlash", callback_data: `ok:${r.id}` }, { text: "🔁 Qayta", callback_data: `rt:${r.id}` }],
          [{ text: "⚠️ Xato belgilash", callback_data: `xm:${uid}` }],
        ] });
      if (voice) await tg("sendVoice", { chat_id: circ.admin_id, voice, caption: `🎙 ${mem.name}` });
    }
  } else {
    const circ = await circleById(mem.circle_id);
    if (circ && voice) await tg("sendVoice", { chat_id: circ.admin_id, voice, caption: `🎙 ${mem.name}` });
  }
  const durMin = Math.round((Date.now() - Date.parse(s.started_at)) / 60000);
  await sb.from("study_sessions").update({
    status: "done", ended_at: new Date().toISOString(),
    from_ayah: range?.[0] ?? null, to_ayah: range?.[1] ?? null, pages: range ? pages : null,
    voice_file: voice, report_id: rid,
  }).eq("id", s.id);
  // AI tahlil hozircha o'chirilgan: yo'naltiruvchi ovozni o'zi eshitib qaror qiladi (aiAnalyze kodi saqlangan)
  await broadcast(mem.circle_id, uid,
    `⏹ <b>${esc(mem.name)}</b> yodlashni tugatdi (${s.win_from}–${hm(new Date())})` +
    (durMin >= 1 && durMin <= 240 ? `\n⏱ ${fmtMin(durMin)}` : "") +
    (range ? `\n📖 ${label(range[0])} → ${label(range[1])} (≈ ${fmt(pages)} sahifa)` : "") + (voice ? "\n🎙 Ovoz yo'naltiruvchiga yuborildi" : ""));
  if (quiet) return;
  return send(uid, `⏹ Tugadi!${durMin >= 1 && durMin <= 240 ? ` ⏱ ${fmtMin(durMin)}.` : ""} ${range ? `${label(range[0])} → ${label(range[1])} (≈ ${fmt(pages)} sahifa) yo'naltiruvchiga yuborildi ✅` : "Saqlandi."}`, menuKb(!!(await circleOfAdmin(uid)), true));
}

async function liveList(circId: number) {
  const { data: live } = await sb.from("study_sessions").select("*").eq("circle_id", circId).eq("status", "live").gte("started_at", liveCutoff()).order("started_at");
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const { data: done } = await sb.from("study_sessions").select("*").eq("circle_id", circId).eq("status", "done").gte("ended_at", since).order("ended_at", { ascending: false }).limit(20);
  const ids = [...new Set([...(live ?? []), ...(done ?? [])].map((x) => x.tg_id))];
  const { data: ms } = ids.length ? await sb.from("members").select("tg_id,name").in("tg_id", ids) : { data: [] };
  const names = new Map((ms ?? []).map((m: any) => [m.tg_id, m.name]));
  const nm = (id: number) => names.get(id) ?? "A'zo";
  const mapS = (x: any) => ({
    id: x.id, tg_id: x.tg_id, name: nm(x.tg_id), slot: x.slot, from: x.win_from, to: x.win_to,
    started: hm(x.started_at), ended: x.ended_at ? hm(x.ended_at) : null, day: x.ended_at ? day(0) : null,
    range: x.from_ayah ? `${label(x.from_ayah)} → ${label(x.to_ayah)}` : null, pages: x.pages ? Number(x.pages) : null,
    voice: !!x.voice_file, since: x.started_at,
    mins: x.ended_at ? Math.round((Date.parse(x.ended_at) - Date.parse(x.started_at)) / 60000) : null,
  });
  return { live: (live ?? []).map(mapS), done: (done ?? []).map(mapS) };
}
async function liveText(circId: number) {
  const { live, done } = await liveList(circId);
  const L = ["🔴 <b>Hozir yodlayotganlar</b>", ""];
  if (!live.length) L.push("Hozir hech kim yodlamayapti.");
  for (const x of live) L.push(`▶️ <b>${esc(x.name)}</b> — ${SLOTS[x.slot] ?? ""} ${x.from}–${x.to}`);
  if (done.length) {
    L.push("", "⏹ So'nggi tugatganlar:");
    for (const x of done.slice(0, 8)) L.push(`• ${esc(x.name)} ${x.started}–${x.ended}${x.range ? ` — ${x.range}` : ""}`);
  }
  return L.join("\n");
}
const liveMenuKb = (isLive: boolean) => ({
  inline_keyboard: [
    isLive
      ? [{ text: "⏹ Tugatdim", callback_data: "lf" }, { text: "🕒 Vaqtni o'zgartirdim", callback_data: "lc" }]
      : [{ text: "▶️ Boshladim", callback_data: "ls" }],
    [{ text: "🔴 Hozir kim yodlayapti", callback_data: "lv" }, { text: "⬅️ Orqaga", callback_data: "m" }],
  ],
});
const hoursKb = (prefix: string, back: string) => ({
  inline_keyboard: [
    [1, 2, 3, 4].map((h) => ({ text: `${h} soat`, callback_data: `${prefix}:${h}` })),
    [{ text: "⬅️ Orqaga", callback_data: back }],
  ],
});

// ---- xatolar ----
async function addMistake(byUid: number, targetUid: number, ayah: number, word: number | null, kind: string, note: string | null) {
  const target = await memberOf(targetUid);
  if (!target) return null;
  const live = await liveOf(targetUid);
  const { data: m } = await sb.from("mistakes").insert({
    tg_id: targetUid, circle_id: target.circle_id, by_id: byUid, ayah, word, kind: KINDS[kind] ? kind : "other",
    note, session_id: live?.id ?? null,
  }).select().single();
  if (byUid !== targetUid) {
    await send(targetUid,
      `⚠️ Yo'naltiruvchi xato belgiladi:\n<b>${label(ayah)}</b>${word ? `, ${word}-so'z` : ""} — ${KINDS[m.kind]}${note ? `\n💬 ${esc(note)}` : ""}\n\nTuzatgach «📋 Xatolarim» dan belgilang.`).catch(() => {});
  } else {
    const circ = await circleById(target.circle_id);
    if (circ && circ.admin_id !== byUid) {
      await send(circ.admin_id, `⚠️ <b>${esc(target.name)}</b> xato belgiladi: <b>${label(ayah)}</b>${word ? `, ${word}-so'z` : ""} — ${KINDS[m.kind]}${note ? `\n💬 ${esc(note)}` : ""}`).catch(() => {});
    }
  }
  return m;
}
const mistakeKindKb = () => ({
  inline_keyboard: [
    ...chunk(Object.entries(KINDS), 2).map((r) => r.map(([k, v]) => ({ text: v, callback_data: `xk:${k}` }))),
  ],
});
async function mistakeList(uid: number) {
  const { data } = await sb.from("mistakes").select("*").eq("tg_id", uid).eq("status", "open").order("created_at", { ascending: false }).limit(30);
  return data ?? [];
}
// "78:5" yoki "78:5 3 izoh" -> oyat, so'z, izoh
function parseMistake(t: string): { ayah: number; word: number | null; note: string | null } | null {
  const m = t.trim().match(/^(\d{1,3})\s*[:\s.-]\s*(\d{1,3})(?:\s+(\d{1,3}))?(?:\s+(.+))?$/s);
  if (!m) return null;
  const su = Number(m[1]), ay = Number(m[2]);
  if (!validSA(su, ay)) return null;
  return { ayah: ayahId(su, ay), word: m[3] ? Number(m[3]) : null, note: m[4]?.trim().slice(0, 200) || null };
}

// callback amallari (a'zo va admin); true qaytarsa — ishlov berildi
async function actPlus(a: string, uid: number, name: string, mid?: number): Promise<boolean> {
  const circ = await circleOfAdmin(uid);
  const mem = await memberOf(uid);
  const setS = (state: string, data: unknown = {}) => sb.from("sessions").upsert({ tg_id: uid, state, data });

  if ((a.startsWith("xy:") || a.startsWith("xn:")) && circ) {
    await confirmMistake(uid, Number(a.slice(3)), a.startsWith("xy:"));
    await send(uid, a.startsWith("xy:") ? "✅ Xato sifatida belgilandi, a'zoga yuborildi." : "❌ Xato emas deb olib tashlandi.");
    return true;
  }
  if (a.startsWith("xya:") && circ) {
    const { data: ms } = await sb.from("mistakes").select("id").eq("circle_id", circ.id).eq("session_id", Number(a.slice(4))).eq("status", "suggested");
    for (const m of ms ?? []) await confirmMistake(uid, m.id, true);
    await send(uid, `✅ ${(ms ?? []).length} ta xato belgilandi, a'zoga yuborildi.`);
    return true;
  }
  if (a.startsWith("mp:") && circ) {
    const id = Number(a.slice(3));
    await send(uid, "🗓 Oylik reja: shu oy necha sahifa?", numKb(`mn:${id}`, `as:${id}`, [5, 10, 15, 20, 25, 30, 40, 60]));
    return true;
  }
  if (a.startsWith("mn:") && circ) {
    const [, id, v] = a.split(":");
    if (v === "x") { await setS("mnp", { id: Number(id) }); await send(uid, "Necha sahifa? Son yozing. Masalan: <code>15</code>"); return true; }
    await askMonthStart(uid, Number(id), Number(v));
    return true;
  }
  if (a === "mpl" && circ) {
    const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).eq("state", "mps").maybeSingle();
    if (!s) return true;
    const pos = await getPos(s.data.id);
    await sb.from("sessions").delete().eq("tg_id", uid);
    if (pos) await setMonthPlan(uid, s.data.id, s.data.pages, pos.ptr, pos.dir);
    return true;
  }
  if (a.startsWith("mpd:") && circ) {
    const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).eq("state", "mpd").maybeSingle();
    if (!s) return true;
    await sb.from("sessions").delete().eq("tg_id", uid);
    await setMonthPlan(uid, s.data.id, s.data.pages, s.data.start, Number(a.slice(4)));
    return true;
  }
  if (a === "pl" && mem) { const pi = await planInfo(uid); await send(uid, planText(pi), planKb(pi)); return true; }
  if (a === "ps" && mem) {
    await send(uid, "📍 Qayerdan boshlaysiz? O'zingiz tanlang:", { inline_keyboard: [
      [{ text: "🔰 Amma (30-juz) — Naba'dan", callback_data: "pp:78:1:1" }],
      [{ text: "🔰 Amma — Nas'dan orqaga", callback_data: "pp:114:6:-1" }],
      [{ text: "📖 Baqara — boshidan", callback_data: "pp:2:1:1" }],
      [{ text: "✍️ O'zim yozaman (sura va oyat)", callback_data: "px" }],
      [{ text: "⬅️ Orqaga", callback_data: "pl" }],
    ] });
    return true;
  }
  if (a.startsWith("pp:") && mem) {
    const [, s, ay, d] = a.split(":");
    if (!validSA(Number(s), Number(ay))) return true;
    await setPos(uid, ayahId(Number(s), Number(ay)), Number(d) === -1 ? -1 : 1);
    const pi = await planInfo(uid);
    await send(uid, "✅ Nuqta saqlandi.\n\n" + planText(pi), planKb(pi));
    return true;
  }
  if (a === "px" && mem) {
    await setS("pos");
    await send(uid, "Sura raqami va oyatni yozing.\nMasalan: <code>78 1</code> (Naba' 1-oyat)\nYoki bet: <code>bet 582</code>");
    return true;
  }
  if (a === "pd" && mem) {
    const p = await getPos(uid);
    if (p) {
      const dir = p.dir === 1 ? -1 : 1;
      // yo'nalish almashsa, ptr bir blok chetiga o'tmasligi uchun joriy ptr saqlanadi
      await sb.from("positions").update({ dir, week_ptr: p.ptr }).eq("tg_id", uid);
    }
    const pi = await planInfo(uid);
    await send(uid, planText(pi), planKb(pi));
    return true;
  }

  if (a === "lm" && mem) { await send(uid, "🔴 Jonli yodlash", liveMenuKb(!!(await liveOf(uid)))); return true; }
  if (a === "lv" && (mem || circ)) {
    const cid = circ?.id ?? mem!.circle_id;
    const t = await liveText(cid);
    if (mid) await edit(uid, mid, t, { inline_keyboard: [[{ text: "🔄 Yangilash", callback_data: "lv" }, { text: "⬅️ Orqaga", callback_data: "m" }]] }).catch(() => {});
    else await send(uid, t, { inline_keyboard: [[{ text: "🔄 Yangilash", callback_data: "lv" }, { text: "⬅️ Orqaga", callback_data: "m" }]] });
    return true;
  }
  if (a === "ls" && mem) {
    await send(uid, "▶️ Qaysi vaqtda yodlaysiz?", { inline_keyboard: [
      [{ text: SLOTS.fajr, callback_data: "lw:fajr" }],
      [{ text: SLOTS.isha, callback_data: "lw:isha" }],
      [{ text: SLOTS.other, callback_data: "lw:other" }],
      [{ text: "⬅️ Orqaga", callback_data: "lm" }],
    ] });
    return true;
  }
  if (a.startsWith("lw:") && mem) { await send(uid, "Necha soat yodlaysiz?", hoursKb(`lh:${a.slice(3)}`, "ls")); return true; }
  if (a.startsWith("lh:") && mem) { const [, slot, h] = a.split(":"); await liveStart(uid, name, slot, Number(h)); return true; }
  if (a === "lc" && mem) { await send(uid, "🕒 Yangi tugash vaqti — hozirdan necha soat?", hoursKb("lt", "lm")); return true; }
  if (a.startsWith("lt:") && mem) { await liveTime(uid, name, Number(a.slice(3))); return true; }
  if (a === "lf" && mem) {
    if (!(await liveOf(uid))) { await send(uid, "Hozir faol yodlash yo'q.", liveMenuKb(false)); return true; }
    const pi = await planInfo(uid);
    const rows: unknown[][] = [];
    if (pi.today) rows.push([{ text: `✅ Reja: ${pi.today.from} → ${pi.today.to}`, callback_data: "lr:p" }]);
    rows.push([{ text: "✍️ Boshqa oraliq yozaman", callback_data: "lr:x" }]);
    rows.push([{ text: "➖ Hech narsa yodlamadim", callback_data: "lr:n" }]);
    await send(uid, "⏹ Nimani yodladingiz?", { inline_keyboard: rows });
    return true;
  }
  if (a.startsWith("lr:") && mem) {
    const v = a.slice(3);
    if (v === "x") { await setS("range"); await send(uid, "Oraliqni yozing.\nMasalan: <code>78:1 - 78:20</code> yoki <code>78 1 20</code>"); return true; }
    let range: [number, number] | null = null;
    if (v === "p") { const pi = await planInfo(uid); if (pi.today) range = [pi.today.fromId, pi.today.toId]; }
    await setS("voice", { range });
    await send(uid, "🎙 Ovozli xabar yuboring (yo'naltiruvchi eshitadi) yoki o'tkazib yuboring:", { inline_keyboard: [[{ text: "⏭ Ovozsiz yakunlash", callback_data: "lz" }]] });
    return true;
  }
  if (a === "lz" && mem) {
    const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).eq("state", "voice").maybeSingle();
    await sb.from("sessions").delete().eq("tg_id", uid);
    await liveFinish(uid, name, s?.data?.range ?? null, null);
    return true;
  }

  // xatolar
  if (a === "xs" && mem) { await setS("mist", { target: uid }); await send(uid, "⚠️ Qaysi oyatda xato qildingiz?\nYozing: <code>78:5</code>\n(ixtiyoriy: so'z raqami va izoh — <code>78:5 3 bahona</code>)"); return true; }
  if (a.startsWith("xm:") && circ) { const id = Number(a.slice(3)); await setS("mist", { target: id }); await send(uid, "⚠️ Qaysi oyatda xato? Yozing: <code>78:5</code>\n(ixtiyoriy: so'z raqami va izoh — <code>78:5 3 izoh</code>)"); return true; }
  if (a.startsWith("xk:")) {
    const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).eq("state", "mistk").maybeSingle();
    if (!s) return true;
    await sb.from("sessions").delete().eq("tg_id", uid);
    const d = s.data;
    const m = await addMistake(uid, d.target, d.ayah, d.word ?? null, a.slice(3), d.note ?? null);
    await send(uid, m ? `✅ Xato saqlandi: <b>${label(d.ayah)}</b>` : "Saqlanmadi.", menuKb(!!circ, !!mem));
    return true;
  }
  if (a === "xl" && mem) {
    const ms = await mistakeList(uid);
    if (!ms.length) { await send(uid, "Ochiq xato yo'q 🎉", menuKb(!!circ, true)); return true; }
    await send(uid, "📋 <b>Xatolarim</b>\n\n" + ms.map((m) => `• ${label(m.ayah)}${m.word ? `, ${m.word}-so'z` : ""} — ${KINDS[m.kind] ?? m.kind}${m.note ? ` (${esc(m.note)})` : ""}`).join("\n"),
      { inline_keyboard: [...ms.slice(0, 10).map((m) => [{ text: `✅ Tuzatdim: ${label(m.ayah)}`, callback_data: `xf:${m.id}` }]), [{ text: "⬅️ Orqaga", callback_data: "pl" }]] });
    return true;
  }
  if (a.startsWith("xf:") && mem) {
    await sb.from("mistakes").update({ status: "fixed", fixed_at: new Date().toISOString() }).eq("id", Number(a.slice(3))).eq("tg_id", uid);
    await send(uid, "✅ Tuzatildi, barakalla!", { inline_keyboard: [[{ text: "📋 Xatolarim", callback_data: "xl" }, { text: "⬅️ Menyu", callback_data: "m" }]] });
    return true;
  }
  if (a.startsWith("xa:") && circ) {
    const id = Number(a.slice(3));
    const ms = await mistakeList(id);
    await send(uid, ms.length ? "📋 <b>Ochiq xatolar</b>\n\n" + ms.map((m) => `• ${label(m.ayah)}${m.word ? `, ${m.word}-so'z` : ""} — ${KINDS[m.kind] ?? m.kind}${m.note ? ` (${esc(m.note)})` : ""}`).join("\n") : "Ochiq xato yo'q 🎉",
      { inline_keyboard: [
        ...ms.slice(0, 10).map((m) => [{ text: `🗑 ${label(m.ayah)}`, callback_data: `xd:${m.id}:${id}` }]),
        [{ text: "⚠️ Xato qo'shish", callback_data: `xm:${id}` }], [{ text: "⬅️ Orqaga", callback_data: `as:${id}` }]] });
    return true;
  }
  if (a.startsWith("ap:") && circ) { // a'zo rejasi (admin ko'radi)
    const id = Number(a.slice(3));
    const pi = await planInfo(id);
    await send(uid, planText(pi).replace("🗺 <b>Rejam</b>", "🗺 <b>A'zo rejasi</b>"), { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: `as:${id}` }]] });
    return true;
  }
  return false;
}

// matn / ovoz kiritish oqimlari (true — ishlov berildi)
async function textPlus(uid: number, name: string, t: string, s: any): Promise<boolean> {
  if (s.state === "mnp") {
    const n = Math.round(parseFloat(t.replace(",", ".")) * 100) / 100;
    if (!(n > 0 && n <= 600)) { await send(uid, "Son yozing. Masalan: <code>15</code>"); return true; }
    await sb.from("sessions").delete().eq("tg_id", uid);
    await askMonthStart(uid, s.data.id, n);
    return true;
  }
  if (s.state === "mps") {
    const id = parseAyah(t);
    if (!id) { await send(uid, "Tushunmadim. Masalan: <code>78 1</code> yoki <code>bet 582</code>"); return true; }
    await sb.from("sessions").upsert({ tg_id: uid, state: "mpd", data: { ...s.data, start: id } });
    await send(uid, `📍 ${label(id)}\nQaysi tomonga yodlanadi?`, { inline_keyboard: [[
      { text: "➡️ Oldinga", callback_data: "mpd:1" }, { text: "⬅️ Orqaga", callback_data: "mpd:-1" },
    ]] });
    return true;
  }
  if (s.state === "pos") {
    const id = parseAyah(t);
    if (!id) { await send(uid, "Tushunmadim. Masalan: <code>78 1</code> yoki <code>bet 582</code>"); return true; }
    const p = await getPos(uid);
    await sb.from("sessions").delete().eq("tg_id", uid);
    await setPos(uid, id, p?.dir === -1 ? -1 : 1);
    const pi = await planInfo(uid);
    await send(uid, "✅ Nuqta saqlandi.\n\n" + planText(pi), planKb(pi));
    return true;
  }
  if (s.state === "range") {
    const r = parseRange(t);
    if (!r) { await send(uid, "Tushunmadim. Masalan: <code>78:1 - 78:20</code> yoki <code>78 1 20</code>"); return true; }
    await sb.from("sessions").upsert({ tg_id: uid, state: "voice", data: { range: r } });
    await send(uid, `📖 ${label(r[0])} → ${label(r[1])}\n\n🎙 Ovozli xabar yuboring yoki o'tkazib yuboring:`, { inline_keyboard: [[{ text: "⏭ Ovozsiz yakunlash", callback_data: "lz" }]] });
    return true;
  }
  if (s.state === "mist") {
    const m = parseMistake(t);
    if (!m) { await send(uid, "Tushunmadim. Masalan: <code>78:5</code> yoki <code>78:5 3 izoh</code>"); return true; }
    await sb.from("sessions").upsert({ tg_id: uid, state: "mistk", data: { ...s.data, ...m } });
    await send(uid, `⚠️ ${label(m.ayah)} — xato turi?`, mistakeKindKb());
    return true;
  }
  if (s.state === "voice") { await send(uid, "Ovozli xabar yuboring yoki «⏭ Ovozsiz yakunlash» ni bosing.", { inline_keyboard: [[{ text: "⏭ Ovozsiz yakunlash", callback_data: "lz" }]] }); return true; }
  return false;
}

async function voicePlus(uid: number, name: string, fileId: string): Promise<boolean> {
  const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).eq("state", "voice").maybeSingle();
  if (!s) return false;
  await sb.from("sessions").delete().eq("tg_id", uid);
  await liveFinish(uid, name, s.data?.range ?? null, fileId);
  return true;
}

// ---------- v12: a'zoni admin qo'shadi, savat, a'zo -> yo'naltiruvchi xabari ----------
const MEMBER_TABLES = ["goals", "reports", "plans", "month_goals", "month_plans", "positions", "study_sessions", "mistakes"];

async function addMember(adminUid: number, id: number, name: string, phone: string | null) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return { ok: false as const, err: "forbidden" };
  if (!Number.isInteger(id) || id < 10000) return { ok: false as const, err: "bad_id" };
  const { data: ex } = await sb.from("members").select("*").eq("tg_id", id).maybeSingle();
  if (ex && ex.circle_id !== circ.id) return { ok: false as const, err: "other_circle" };
  const row: Record<string, unknown> = { tg_id: id, circle_id: circ.id, name: name.slice(0, 60) || ex?.name || "A'zo" };
  if (phone) row.phone = phone;
  await sb.from("members").upsert(row, { onConflict: "tg_id" });
  // a'zoga xabar (u botni hali ochmagan bo'lsa, yetib bormasligi mumkin)
  send(id, `✅ Siz Hifz halqasiga qo'shildingiz! 🌙\nBoshlash uchun /start ni bosing.`).catch(() => {});
  return { ok: true as const, existed: !!ex, name: String(row.name) };
}

async function trashPut(circId: number, kind: string, label: string, data: unknown, by: number) {
  await sb.from("trash").insert({ circle_id: circId, kind, label, data, deleted_by: by });
}

async function deleteMember(adminUid: number, memberId: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ || memberId === adminUid) return false;
  const { data: m } = await sb.from("members").select("*").eq("tg_id", memberId).eq("circle_id", circ.id).maybeSingle();
  if (!m) return false;
  const tables: Record<string, unknown[]> = {};
  for (const t of MEMBER_TABLES) {
    const { data } = await sb.from(t).select("*").eq("tg_id", memberId);
    tables[t] = data ?? [];
  }
  await trashPut(circ.id, "member", `A'zo: ${m.name}${m.phone ? " · " + m.phone : ""}`, { member: m, tables }, adminUid);
  for (const t of MEMBER_TABLES) await sb.from(t).delete().eq("tg_id", memberId);
  await sb.from("sessions").delete().eq("tg_id", memberId);
  await sb.from("members").delete().eq("tg_id", memberId);
  return true;
}

async function deleteReport(adminUid: number, rid: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return false;
  const { data: r } = await sb.from("reports").select("*").eq("id", rid).eq("circle_id", circ.id).maybeSingle();
  if (!r) return false;
  const { data: m } = await sb.from("members").select("name").eq("tg_id", r.tg_id).maybeSingle();
  await trashPut(circ.id, "report", `Hisobot: ${m?.name ?? "A'zo"} — ${fmt(Number(r.pages))} sahifa, ${r.day}`, { row: r }, adminUid);
  await sb.from("reports").delete().eq("id", rid);
  return true;
}

async function deleteMistake(adminUid: number, mid: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return false;
  const { data: x } = await sb.from("mistakes").select("*").eq("id", mid).eq("circle_id", circ.id).maybeSingle();
  if (!x) return false;
  const { data: m } = await sb.from("members").select("name").eq("tg_id", x.tg_id).maybeSingle();
  await sb.from("trash").insert({ circle_id: circ.id, kind: "mistake", label: `Xato: ${m?.name ?? "A'zo"} — ${label(x.ayah)}`, data: { row: x }, deleted_by: adminUid });
  await sb.from("mistakes").delete().eq("id", mid);
  return true;
}

async function trashItems(circId: number) {
  const { data } = await sb.from("trash").select("id,kind,label,deleted_at").eq("circle_id", circId).is("restored_at", null)
    .order("deleted_at", { ascending: false }).limit(30);
  return data ?? [];
}

async function restoreTrash(adminUid: number, tid: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return false;
  const { data: t } = await sb.from("trash").select("*").eq("id", tid).eq("circle_id", circ.id).is("restored_at", null).maybeSingle();
  if (!t) return false;
  const d = t.data as any;
  if (t.kind === "member") {
    await sb.from("members").upsert(d.member, { onConflict: "tg_id" });
    for (const tb of MEMBER_TABLES) if (d.tables?.[tb]?.length) await sb.from(tb).upsert(d.tables[tb]);
  } else if (t.kind === "report") {
    const { data: m } = await sb.from("members").select("tg_id").eq("tg_id", d.row.tg_id).maybeSingle();
    if (!m) return false; // a'zo o'chirilgan: avval a'zoni tiklang
    await sb.from("reports").upsert(d.row);
  } else if (t.kind === "mistake") {
    const { data: m } = await sb.from("members").select("tg_id").eq("tg_id", d.row.tg_id).maybeSingle();
    if (!m) return false;
    await sb.from("mistakes").upsert(d.row);
  }
  await sb.from("trash").update({ restored_at: new Date().toISOString() }).eq("id", tid);
  return true;
}

// a'zo -> yo'naltiruvchi (xato qilsa, shu yo'l bilan aytadi)
async function messageAdmin(uid: number, text: string) {
  const mem = await memberOf(uid);
  const circ = mem ? await circleById(mem.circle_id) : null;
  if (!mem || !circ) return false;
  await send(circ.admin_id,
    `✉️ <b>${esc(mem.name)}</b> yozdi:\n\n${esc(text.slice(0, 1000))}\n\n<a href="tg://user?id=${uid}">👤 ${esc(mem.name)} profiliga o'tish</a>`,
    { inline_keyboard: [[{ text: "👤 A'zo kartasi", callback_data: `as:${uid}` }]] });
  return true;
}

// "123456789 Ali Valiyev +998901234567" -> id, ism, telefon
function parseNewMember(t: string): { id: number; name: string; phone: string | null } | null {
  const parts = t.trim().split(/\s+/);
  const id = Number(parts[0]);
  if (!/^\d{5,12}$/.test(parts[0] ?? "") || !Number.isSafeInteger(id)) return null;
  let phone: string | null = null;
  const rest: string[] = [];
  for (const x of parts.slice(1)) {
    if (!phone && /^\+?[\d()-]{9,16}$/.test(x)) phone = x; else rest.push(x);
  }
  return { id, name: rest.join(" "), phone };
}

async function actAdminPlus(a: string, uid: number, name: string, mid?: number): Promise<boolean> {
  const circ = await circleOfAdmin(uid);
  const mem = await memberOf(uid);
  if (a === "wm" && mem) {
    await sb.from("sessions").upsert({ tg_id: uid, state: "msg", data: {} });
    await send(uid, "✉️ Yo'naltiruvchiga xabaringizni yozing (masalan, noto'g'ri kiritilgan narsa haqida):");
    return true;
  }
  if (!circ) return false;
  if (a === "ma") {
    await sb.from("sessions").upsert({ tg_id: uid, state: "madd", data: {} });
    await send(uid, "➕ <b>A'zo qo'shish</b>\n\nA'zo yuborgan ma'lumotni bitta xabarda yozing: Telegram ID, ism, telefon.\n\nMasalan:\n<code>123456789 Ali +998901234567</code>");
    return true;
  }
  if (a.startsWith("mdc:")) {
    const id = Number(a.slice(4));
    await send(uid, "🗑 Bu a'zoni o'chiraymi? U botdan foydalana olmaydi. Ma'lumotlari «Savat»da saqlanadi, tiklash mumkin.", { inline_keyboard: [[
      { text: "🗑 Ha, o'chirish", callback_data: `mdd:${id}` }, { text: "Bekor", callback_data: `as:${id}` },
    ]] });
    return true;
  }
  if (a.startsWith("mdd:")) {
    const ok = await deleteMember(uid, Number(a.slice(4)));
    await send(uid, ok ? "🗑 A'zo savatga o'tkazildi." : "O'chirib bo'lmadi.", menuKb(true, !!mem));
    return true;
  }
  if (a.startsWith("rl:")) {
    const id = Number(a.slice(3));
    const { data: rs } = await sb.from("reports").select("*").eq("tg_id", id).eq("circle_id", circ.id).order("created_at", { ascending: false }).limit(12);
    if (!rs?.length) { await send(uid, "Hisobot yo'q.", { inline_keyboard: [[{ text: "➕ Hisobot qo'shish", callback_data: `ra:${id}` }], [{ text: "⬅️ Orqaga", callback_data: `as:${id}` }]] }); return true; }
    const ic = (st: string) => (st === "approved" ? "✅" : st === "pending" ? "⏳" : "🔁");
    await send(uid, "📖 <b>Hisobotlar</b>\nTuzatish yoki o'chirish uchun bosing 👇", { inline_keyboard: [
      [{ text: "➕ Hisobot qo'shish", callback_data: `ra:${id}` }],
      ...rs.map((r) => [{ text: `${ic(r.status)} ${fmt(Number(r.pages))} sahifa · ${r.day}`, callback_data: `rv:${r.id}:${id}` }]),
      [{ text: "⬅️ Orqaga", callback_data: `as:${id}` }],
    ] });
    return true;
  }
  if (a.startsWith("rx:")) {
    const [, rid, id] = a.split(":");
    await deleteReport(uid, Number(rid));
    await send(uid, "🗑 Hisobot savatga o'tkazildi.", { inline_keyboard: [[{ text: "📖 Hisobotlar", callback_data: `rl:${id}` }, { text: "⬅️ A'zo", callback_data: `as:${id}` }]] });
    return true;
  }
  if (a.startsWith("xd:")) {
    const [, xid, id] = a.split(":");
    await deleteMistake(uid, Number(xid));
    await send(uid, "🗑 Xato savatga o'tkazildi.", { inline_keyboard: [[{ text: "⚠️ Xatolar", callback_data: `xa:${id}` }]] });
    return true;
  }
  if (a === "tr") {
    const items = await trashItems(circ.id);
    if (!items.length) { await send(uid, "🗑 Savat bo'sh.", { inline_keyboard: [[{ text: "⬅️ Orqaga", callback_data: "m" }]] }); return true; }
    await send(uid, "🗑 <b>Savat</b> — o'chirilganlar. Tiklash uchun bosing 👇", { inline_keyboard: [
      ...items.slice(0, 15).map((t) => [{ text: `♻️ ${t.label}`.slice(0, 60), callback_data: `tre:${t.id}` }]),
      [{ text: "⬅️ Orqaga", callback_data: "m" }],
    ] });
    return true;
  }
  if (a.startsWith("tre:")) {
    const ok = await restoreTrash(uid, Number(a.slice(4)));
    await send(uid, ok ? "♻️ Tiklandi." : "Tiklab bo'lmadi (a'zo o'chirilgan bo'lsa, avval a'zoni tiklang).", { inline_keyboard: [[{ text: "🗑 Savat", callback_data: "tr" }, { text: "⬅️ Menyu", callback_data: "m" }]] });
    return true;
  }
  return false;
}

// ---------- v13: statistikani tuzatish (audit + qaytarish) ----------
const weekStartOf = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const ACTION_NAME: Record<string, string> = {
  report_edit: "Hisobot tuzatildi", report_add: "Hisobot qo'shildi", goal_set: "Haftalik maqsad",
  goal_clear: "Maqsad tozalandi", month_plan: "Oylik reja", year_plan: "Yillik reja",
};
const STATUS_NAME: Record<string, string> = { approved: "✅ tasdiqlangan", pending: "⏳ kutilmoqda", repeat: "🔁 qayta" };

async function auditWrite(circId: number, actor: number, memberId: number | null, action: string, tbl: string,
  key: Record<string, unknown>, oldRow: unknown, newRow: unknown) {
  await sb.from("audit").insert({ circle_id: circId, actor, member_id: memberId, action, tbl, row_key: key, old_row: oldRow ?? null, new_row: newRow ?? null });
}
function describeAudit(a: any): string {
  const o = a.old_row, n = a.new_row;
  if (a.action === "report_edit" && o && n) {
    const parts: string[] = [];
    if (Number(o.pages) !== Number(n.pages)) parts.push(`${fmt(Number(o.pages))} → ${fmt(Number(n.pages))} sahifa`);
    if (o.status !== n.status) parts.push(`${STATUS_NAME[o.status] ?? o.status} → ${STATUS_NAME[n.status] ?? n.status}`);
    if (o.day !== n.day) parts.push(`${o.day} → ${n.day}`);
    return parts.join(", ") || "o'zgarish";
  }
  if (a.action === "report_add" && n) return `${fmt(Number(n.pages))} sahifa, ${n.day}`;
  if (a.action === "goal_set" || a.action === "goal_clear") return `${o ? fmt(Number(o.pages)) : "yo'q"} → ${n ? fmt(Number(n.pages)) : "yo'q"} sahifa`;
  if (a.action === "month_plan") return `${o ? fmt(Number(o.pages)) : "yo'q"} → ${n ? fmt(Number(n.pages)) : "yo'q"} sahifa`;
  if (a.action === "year_plan") return `${o ? fmt(Number(o.juz)) : "yo'q"} → ${n ? fmt(Number(n.juz)) : "yo'q"} juz`;
  return "";
}

async function validateReportPatch(p: { pages?: number; day?: string; status?: string }): Promise<string | null> {
  if (p.pages !== undefined && !(p.pages > 0 && p.pages <= 100)) return "bad_pages";
  if (p.day !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(p.day) || p.day > day() || p.day < addDays(day(), -400))) return "bad_day";
  if (p.status !== undefined && !STATUS_NAME[p.status]) return "bad_status";
  return null;
}

async function editReport(adminUid: number, rid: number, patch: { pages?: number; day?: string; status?: string }) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return { ok: false as const, err: "forbidden" };
  const bad = await validateReportPatch(patch);
  if (bad) return { ok: false as const, err: bad };
  const { data: old } = await sb.from("reports").select("*").eq("id", rid).eq("circle_id", circ.id).maybeSingle();
  if (!old) return { ok: false as const, err: "not_found" };
  const upd: Record<string, unknown> = {};
  if (patch.pages !== undefined) upd.pages = patch.pages;
  if (patch.day !== undefined) { upd.day = patch.day; upd.week_start = weekStartOf(patch.day); }
  if (patch.status !== undefined) { upd.status = patch.status; upd.decided_at = patch.status === "pending" ? null : new Date().toISOString(); }
  if (!Object.keys(upd).length) return { ok: false as const, err: "nothing" };
  const { data: nw } = await sb.from("reports").update(upd).eq("id", rid).select().single();
  await auditWrite(circ.id, adminUid, old.tg_id, "report_edit", "reports", { id: rid }, old, nw);
  const d = describeAudit({ action: "report_edit", old_row: old, new_row: nw });
  if (old.tg_id !== adminUid) send(old.tg_id, `📝 Yo'naltiruvchi hisobotingizni tuzatdi: ${d}`).catch(() => {});
  return { ok: true as const, desc: d };
}

async function addReportManual(adminUid: number, memberId: number, pages: number, dayStr: string) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return { ok: false as const, err: "forbidden" };
  const bad = await validateReportPatch({ pages, day: dayStr });
  if (bad) return { ok: false as const, err: bad };
  if (!(await memberInCircle(adminUid, memberId))) return { ok: false as const, err: "not_found" };
  const { data: nw } = await sb.from("reports").insert({
    tg_id: memberId, circle_id: circ.id, week_start: weekStartOf(dayStr), day: dayStr, pages, status: "approved", decided_at: new Date().toISOString(),
  }).select().single();
  await auditWrite(circ.id, adminUid, memberId, "report_add", "reports", { id: nw.id }, null, nw);
  if (memberId !== adminUid) send(memberId, `📝 Yo'naltiruvchi sizga hisobot qo'shdi: ${fmt(pages)} sahifa, ${dayStr}`).catch(() => {});
  return { ok: true as const };
}

async function clearGoal(adminUid: number, memberId: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ || !(await memberInCircle(adminUid, memberId))) return false;
  const key = { tg_id: memberId, week_start: weekStart() };
  const { data: old } = await sb.from("goals").select("*").match(key).maybeSingle();
  if (!old) return false;
  await sb.from("goals").delete().match(key);
  await auditWrite(circ.id, adminUid, memberId, "goal_clear", "goals", key, old, null);
  return true;
}

async function auditList(circId: number, memberId: number) {
  const { data } = await sb.from("audit").select("*").eq("circle_id", circId).eq("member_id", memberId)
    .order("created_at", { ascending: false }).limit(15);
  return (data ?? []).map((a: any) => ({ id: a.id, action: ACTION_NAME[a.action] ?? a.action, desc: describeAudit(a), at: String(a.created_at).slice(0, 16).replace("T", " "), undone: !!a.undone_at }));
}

// qaytarish: faqat qator hali yozuvdan keyin o'zgarmagan bo'lsa (xavfsizlik)
async function auditUndo(adminUid: number, aid: number): Promise<"ok" | "changed" | "missing"> {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return "missing";
  const { data: a } = await sb.from("audit").select("*").eq("id", aid).eq("circle_id", circ.id).is("undone_at", null).maybeSingle();
  if (!a) return "missing";
  const { data: cur } = await sb.from(a.tbl).select("*").match(a.row_key).maybeSingle();
  if (JSON.stringify(cur ?? null) !== JSON.stringify(a.new_row ?? null)) return "changed";
  if (a.old_row) await sb.from(a.tbl).upsert(a.old_row);
  else await sb.from(a.tbl).delete().match(a.row_key);
  await sb.from("audit").update({ undone_at: new Date().toISOString() }).eq("id", aid);
  return "ok";
}
const AUDIT_ERR: Record<string, string> = { bad_pages: "Sahifa 0 dan katta va 100 dan oshmasin.", bad_day: "Sana noto'g'ri (kelajak yoki juda eski).", bad_status: "Holat noto'g'ri.", not_found: "Topilmadi.", nothing: "O'zgarish yo'q.", forbidden: "Ruxsat yo'q." };

async function actEditPlus(a: string, uid: number): Promise<boolean> {
  const circ = await circleOfAdmin(uid);
  if (!circ) return false;
  const setS = (state: string, data: unknown = {}) => sb.from("sessions").upsert({ tg_id: uid, state, data });
  const back = (id: string | number) => ({ inline_keyboard: [[{ text: "📖 Hisobotlar", callback_data: `rl:${id}` }, { text: "⬅️ A'zo", callback_data: `as:${id}` }]] });

  if (a.startsWith("rv:")) {
    const [, rid, id] = a.split(":");
    const { data: r } = await sb.from("reports").select("*").eq("id", Number(rid)).eq("circle_id", circ.id).maybeSingle();
    if (!r) { await send(uid, "Topilmadi."); return true; }
    await send(uid, `📖 <b>Hisobot</b>\n${fmt(Number(r.pages))} sahifa · ${r.day}\nHolat: ${STATUS_NAME[r.status] ?? r.status}`, { inline_keyboard: [
      [{ text: "✏️ Sahifani o'zgartirish", callback_data: `re:${rid}:${id}` }],
      [{ text: "✅", callback_data: `rs:${rid}:approved:${id}` }, { text: "⏳", callback_data: `rs:${rid}:pending:${id}` }, { text: "🔁", callback_data: `rs:${rid}:repeat:${id}` }],
      [{ text: "🗑 O'chirish", callback_data: `rx:${rid}:${id}` }],
      [{ text: "⬅️ Orqaga", callback_data: `rl:${id}` }],
    ] });
    return true;
  }
  if (a.startsWith("re:")) {
    const [, rid, id] = a.split(":");
    await send(uid, "✏️ To'g'ri sahifa soni?", numKb(`rn:${rid}:${id}`, `rv:${rid}:${id}`, [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12]));
    return true;
  }
  if (a.startsWith("rn:")) {
    const [, rid, id, v] = a.split(":");
    if (v === "x") { await setS("rnx", { rid: Number(rid), id: Number(id) }); await send(uid, "Sahifa sonini yozing. Masalan: <code>2.5</code>"); return true; }
    return confirmReportPages(uid, Number(rid), Number(id), Number(v));
  }
  if (a.startsWith("rc:")) {
    const [, rid, id, v] = a.split(":");
    const r = await editReport(uid, Number(rid), { pages: Number(v) });
    await send(uid, r.ok ? `✅ Tuzatildi: ${r.desc}\nA'zoga xabar yuborildi. Xato bo'lsa, «📜 Tarix» dan qaytarasiz.` : `❌ ${AUDIT_ERR[r.err] ?? r.err}`, back(id));
    return true;
  }
  if (a.startsWith("rs:")) {
    const [, rid, st, id] = a.split(":");
    const r = await editReport(uid, Number(rid), { status: st });
    await send(uid, r.ok ? `✅ Holat o'zgardi: ${r.desc}\n(Mukofot xabari yuborilmaydi; qaytarish: «📜 Tarix»)` : `❌ ${AUDIT_ERR[r.err] ?? r.err}`, back(id));
    return true;
  }
  if (a.startsWith("ra:")) {
    const id = a.slice(3);
    await send(uid, "➕ Qo'lda hisobot: necha sahifa? (bugungi sana bilan tasdiqlangan holda qo'shiladi)", numKb(`rm:${id}`, `rl:${id}`, [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]));
    return true;
  }
  if (a.startsWith("rm:")) {
    const [, id, v] = a.split(":");
    if (v === "x") { await setS("rmx", { id: Number(id) }); await send(uid, "Sahifa sonini yozing. Masalan: <code>2.5</code>"); return true; }
    return confirmReportAdd(uid, Number(id), Number(v));
  }
  if (a.startsWith("rk:")) {
    const [, id, v] = a.split(":");
    const r = await addReportManual(uid, Number(id), Number(v), day());
    await send(uid, r.ok ? `✅ Qo'shildi: ${fmt(Number(v))} sahifa. Xato bo'lsa, «📜 Tarix» dan qaytarasiz.` : `❌ ${AUDIT_ERR[r.err] ?? r.err}`, back(id));
    return true;
  }
  if (a.startsWith("hl:")) {
    const id = Number(a.slice(3));
    const items = await auditList(circ.id, id);
    if (!items.length) { await send(uid, "📜 Tarix bo'sh.", { inline_keyboard: [[{ text: "⬅️ A'zo", callback_data: `as:${id}` }]] }); return true; }
    await send(uid, "📜 <b>O'zgarishlar tarixi</b>\n\n" + items.map((x, i) => `${i + 1}. ${x.at} — ${x.action}: ${esc(x.desc)}${x.undone ? " (qaytarilgan)" : ""}`).join("\n") + "\n\nQaytarish uchun raqamni bosing 👇", { inline_keyboard: [
      ...chunk(items.map((x, i) => ({ text: `↩️ ${i + 1}`, callback_data: `hu:${x.id}:${id}` })).filter((_, i) => !items[i].undone), 5),
      [{ text: "⬅️ A'zo", callback_data: `as:${id}` }],
    ] });
    return true;
  }
  if (a.startsWith("hu:")) {
    const [, aid, id] = a.split(":");
    const r = await auditUndo(uid, Number(aid));
    await send(uid, r === "ok" ? "↩️ Qaytarildi." : r === "changed" ? "Qaytarib bo'lmadi: shundan keyin yana o'zgartirilgan. Avval keyingisini qaytaring." : "Topilmadi yoki allaqachon qaytarilgan.",
      { inline_keyboard: [[{ text: "📜 Tarix", callback_data: `hl:${id}` }, { text: "⬅️ A'zo", callback_data: `as:${id}` }]] });
    return true;
  }
  if (a.startsWith("gc:")) {
    const id = Number(a.slice(3));
    const ok = await clearGoal(uid, id);
    await send(uid, ok ? "🧹 Bu haftaning maqsadi tozalandi. Xato bo'lsa, «📜 Tarix» dan qaytarasiz." : "Bu hafta maqsad yo'q edi.", { inline_keyboard: [[{ text: "⬅️ A'zo", callback_data: `as:${id}` }]] });
    return true;
  }
  return false;
}
async function confirmReportPages(uid: number, rid: number, id: number, v: number) {
  if (!(v > 0 && v <= 100)) return send(uid, "Sahifa 0 dan katta va 100 dan oshmasin.");
  const { data: r } = await sb.from("reports").select("pages,day").eq("id", rid).maybeSingle();
  return send(uid, `✏️ Tasdiqlang:\n${fmt(Number(r?.pages ?? 0))} → <b>${fmt(v)}</b> sahifa (${r?.day ?? ""})`, { inline_keyboard: [[
    { text: "✅ Ha, o'zgartirish", callback_data: `rc:${rid}:${id}:${v}` }, { text: "Bekor", callback_data: `rv:${rid}:${id}` },
  ]] });
}
async function confirmReportAdd(uid: number, id: number, v: number) {
  if (!(v > 0 && v <= 100)) return send(uid, "Sahifa 0 dan katta va 100 dan oshmasin.");
  return send(uid, `➕ Tasdiqlang: <b>${fmt(v)}</b> sahifa, ${day()}, tasdiqlangan holda qo'shiladi.`, { inline_keyboard: [[
    { text: "✅ Ha, qo'shish", callback_data: `rk:${id}:${v}` }, { text: "Bekor", callback_data: `rl:${id}` },
  ]] });
}

// ---------- kiruvchi xabarlar ----------
async function handleText(uid: number, name: string, t: string) {
  const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).maybeSingle();
  if (!s) return showMenu(uid, name);
  if (s.state === "madd") {
    const p = parseNewMember(t);
    if (!p) { await send(uid, "Tushunmadim. Masalan: <code>123456789 Ali +998901234567</code>"); return; }
    await sb.from("sessions").delete().eq("tg_id", uid);
    const r = await addMember(uid, p.id, p.name || "A'zo", p.phone);
    await send(uid, r.ok ? `✅ ${r.existed ? "Yangilandi" : "Qo'shildi"}: <b>${esc(r.name)}</b>${p.phone ? " · " + esc(p.phone) : ""}\n🆔 <code>${p.id}</code>\n\nA'zo botni ochib /start bossin.`
      : r.err === "other_circle" ? "Bu ID boshqa halqada." : "ID noto'g'ri.", { inline_keyboard: [[{ text: "➕ Yana qo'shish", callback_data: "ma" }, { text: "👥 A'zolar", callback_data: "al" }]] });
    return;
  }
  if (s.state === "rnx" || s.state === "rmx") {
    const v = Math.round(parseFloat(t.replace(",", ".")) * 100) / 100;
    if (!(v > 0 && v <= 100)) { await send(uid, "Son yozing. Masalan: <code>2.5</code>"); return; }
    await sb.from("sessions").delete().eq("tg_id", uid);
    return s.state === "rnx" ? confirmReportPages(uid, s.data.rid, s.data.id, v) : confirmReportAdd(uid, s.data.id, v);
  }
  if (s.state === "msg") {
    await sb.from("sessions").delete().eq("tg_id", uid);
    const ok = await messageAdmin(uid, t);
    await send(uid, ok ? "✅ Yo'naltiruvchiga yuborildi." : "Yuborib bo'lmadi.", menuKb(false, true));
    return;
  }
  if (await textPlus(uid, name, t, s)) return;
  const n = Math.round(parseFloat(t.replace(",", ".")) * 100) / 100;
  if (!(n > 0 && n <= 100)) {
    return send(uid, "Iltimos, son yozing. Masalan: <code>2</code> yoki <code>1.5</code>");
  }
  if ((s.state.startsWith("yg:") || s.state.startsWith("mg:")) && n > 30) {
    return send(uid, "Juz soni 30 dan oshmasin. Masalan: <code>10</code>");
  }
  await sb.from("sessions").delete().eq("tg_id", uid);
  if (s.state === "report") return createReport(uid, name, n);
  if (s.state === "rev") { await addRevision(uid, n); return; }
  if (s.state === "req" || s.state.startsWith("req:")) {
    const kind = s.state.startsWith("req:") ? s.state.slice(4) : "w";
    return sendRequest(uid, name, n, kind);
  }
  if (s.state.startsWith("sg:")) return setGoal(uid, Number(s.state.slice(3)), n);
  if (s.state.startsWith("yg:")) return setYear(uid, Number(s.state.slice(3)), n);
  if (s.state.startsWith("mg:")) return setMonth(uid, Number(s.state.slice(3)), n);
}

async function handleMessage(msg: any) {
  if (msg?.voice && msg.chat?.type === "private") {
    if (await voicePlus(msg.from.id, msg.from.first_name ?? "Do'st", msg.voice.file_id)) return;
  }
  if (!msg?.text || msg.chat?.type !== "private") return;
  const uid = msg.from.id;
  const name = msg.from.first_name ?? "Do'st";
  const t: string = msg.text.trim();

  if (t === "/id" || t.startsWith("/id@")) {
    return send(uid, `🆔 Sizning Telegram ID: <code>${uid}</code>`);
  }
  if (t.startsWith("/start")) {
    const payload = t.split(/\s+/)[1] ?? "";
    return act("start", uid, name);
  }
  if (t.startsWith("/dam")) return act("rdm", uid, name);
  if (t.startsWith("/takror") || t.startsWith("/sovga")) {
    const c = await adminCircle(uid, name);
    if (!c) return;
    const arg = t.replace(/^\/\S+\s*/, "").trim();
    if (t.startsWith("/takror")) {
      const n = Math.round(parseFloat(arg.replace(",", ".")) * 100) / 100;
      if (!arg) return send(uid, `🔁 Takror normasi: kuniga <b>${fmt(REV_DAILY)}</b> sahifa.\nO'zgartirish: <code>/takror 6</code>`);
      return send(uid, (await setRevDaily(uid, n)) ? `✅ Takror normasi: kuniga <b>${fmt(REV_DAILY)}</b> sahifa.` : "Son noto'g'ri (0 dan katta, 50 gacha).");
    }
    if (!arg) return send(uid, `🎁 Oylik sovrin: <b>${esc(PRIZE || "belgilanmagan")}</b>\nO'zgartirish: <code>/sovga Umra safari</code>\nO'chirish: <code>/sovga -</code>`);
    return send(uid, (await setPrize(uid, arg === "-" ? "" : arg)) ? `✅ Sovrin: <b>${esc(PRIZE || "o'chirildi")}</b>` : "Xato.");
  }
  if (t.startsWith("/menyu") || t.startsWith("/menu")) return act("menu", uid, name);
  if (t.startsWith("/")) return;
  return handleText(uid, name, t);
}

async function handleCallback(cq: any) {
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  if (!cq.message || !cq.data) return;
  await act(cq.data, cq.from.id, cq.from.first_name ?? "Do'st", cq.message.message_id);
}

// ---------- sayt uchun API ----------
async function groupApi(code: string) {
  const { data: c } = await sb.from("circles").select("*").eq("view_code", code).maybeSingle();
  if (!c) return json({ error: "not_found" }, 404);
  const { data: ms } = await sb.from("members").select("*").eq("circle_id", c.id).order("joined_at");
  const ws = weekStart();
  const st = await statsFor((ms ?? []).map((m) => m.tg_id), ws);
  const members = (ms ?? []).map((m) => {
    const s = st.get(m.tg_id)!;
    return { name: m.name, goal: s.goal, approved: s.approved, pending: s.pending, expected: s.goal ? expected(s.goal) : 0 };
  }).sort((a, b) => (b.goal ? b.approved / b.goal : 0) - (a.goal ? a.approved / a.goal : 0));
  return json({ name: c.name, week_start: ws, today: day(), members });
}


// ---------- v15: takror, ball, oylik g'olib ----------
const W_PLAN = 50, W_CONS = 30, W_REV = 20; // ball: reja foizi + muntazamlik + takror = 100
async function setRevDaily(adminUid: number, n: number) {
  if (!(n > 0 && n <= 50)) return false;
  const { error } = await sb.from("circles").update({ rev_daily: n }).eq("admin_id", adminUid);
  if (error) return false;
  REV_DAILY = n; restAt = Date.now();
  return true;
}
async function setPrize(adminUid: number, t: string) {
  const v = t.trim().slice(0, 200);
  const { error } = await sb.from("circles").update({ prize: v || null }).eq("admin_id", adminUid);
  if (error) return false;
  PRIZE = v; restAt = Date.now();
  return true;
}
async function revToday(uid: number) {
  const { data } = await sb.from("revisions").select("pages").eq("tg_id", uid).eq("day", day());
  return (data ?? []).reduce((x, r) => x + Number(r.pages), 0);
}
async function addRevision(uid: number, pages: number, quiet = false) {
  const mem = await memberOf(uid);
  const p = Math.round(pages * 100) / 100;
  if (!mem || !(p > 0 && p <= 50)) return null;
  await sb.from("revisions").insert({ tg_id: uid, circle_id: mem.circle_id, day: day(), pages: p });
  const tot = await revToday(uid);
  if (!quiet) await send(uid, `🔁 Takror yozildi: <b>${fmt(p)}</b> sahifa.\nBugun jami: <b>${fmt(tot)}</b> / ${fmt(REV_DAILY)} 🌙`, await kbFor(uid));
  return tot;
}
const workDaysBetween = (a: string, b: string) => {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (new Date(d + "T00:00:00Z").getUTCDay() !== REST) n++;
  return n;
};
type ScoreRow = { id: number; name: string; score: number; planPct: number; done: number; target: number; days: number; wd: number; rev: number; revTarget: number };
async function monthScore(circId: number, month: string): Promise<ScoreRow[]> {
  const { data: ms } = await sb.from("members").select("tg_id,name,joined_at").eq("circle_id", circId);
  const list = ms ?? [], ids = list.map((m) => m.tg_id);
  if (!ids.length) return [];
  const first = month + "-01", last = monthEnd(first);
  const endDay = day() < first ? first : day() < last ? day() : last;
  const [{ data: rs }, { data: vs }, { data: mps }, { data: gs }] = await Promise.all([
    sb.from("reports").select("tg_id,pages,day").eq("status", "approved").gte("day", first).lte("day", last).in("tg_id", ids),
    sb.from("revisions").select("tg_id,pages,day").gte("day", first).lte("day", last).in("tg_id", ids),
    sb.from("month_plans").select("tg_id,pages").eq("month", month).in("tg_id", ids),
    sb.from("goals").select("tg_id,pages,week_start").gte("week_start", first).lte("week_start", last).in("tg_id", ids),
  ]);
  const rows: ScoreRow[] = list.map((m) => {
    const joined = new Date(Date.parse(m.joined_at) + TZ * 3600e3).toISOString().slice(0, 10);
    const start = joined > first ? joined : first;
    const elapsedWd = workDaysBetween(start, endDay), wd = workDaysBetween(start, last);
    const mine = (rs ?? []).filter((r) => r.tg_id === m.tg_id && r.day >= start && r.day <= endDay);
    const done = mine.reduce((x, r) => x + Number(r.pages), 0);
    const mp = (mps ?? []).find((x) => x.tg_id === m.tg_id);
    const target = mp ? Number(mp.pages) : (gs ?? []).filter((g) => g.tg_id === m.tg_id).reduce((x, g) => x + Number(g.pages), 0);
    const planGoal = wd ? (target * elapsedWd) / wd : 0;
    const planPct = planGoal > 0 ? Math.min(1, done / planGoal) : 0;
    const days = new Set(mine.map((r) => r.day)).size;
    const cons = elapsedWd ? Math.min(1, days / elapsedWd) : 0;
    const rev = (vs ?? []).filter((v) => v.tg_id === m.tg_id && v.day >= start && v.day <= endDay).reduce((x, v) => x + Number(v.pages), 0);
    const revTarget = REV_DAILY * elapsedWd;
    const revPct = revTarget > 0 ? Math.min(1, rev / revTarget) : 0;
    return {
      id: m.tg_id, name: m.name, score: Math.round(W_PLAN * planPct + W_CONS * cons + W_REV * revPct),
      planPct: Math.round(planPct * 100), done, target, days, wd: elapsedWd, rev, revTarget,
    };
  });
  return rows.sort((a, b) => b.score - a.score || b.done - a.done);
}
const medalOf = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
function scoreLines(rows: ScoreRow[]) {
  return rows.map((r, i) =>
    `${medalOf(i)} <b>${esc(r.name)}</b> — <b>${r.score}</b> ball\n    📖 ${fmt(r.done)}${r.target ? `/${fmt(r.target)}` : ""} (${r.planPct}%) · 📅 ${r.days}/${r.wd} kun · 🔁 ${fmt(r.rev)}/${fmt(r.revTarget)}`).join("\n");
}
async function scoreText(circId: number) {
  const m = day().slice(0, 7), rows = await monthScore(circId, m);
  const head = `🏅 <b>${MONTHS[Number(m.slice(5)) - 1]} — ball reytingi</b>\n<i>Reja ${W_PLAN} + muntazamlik ${W_CONS} + takror ${W_REV} = 100</i>` + (PRIZE ? `\n🎁 Sovrin: <b>${esc(PRIZE)}</b>` : "");
  return head + "\n\n" + (rows.length ? scoreLines(rows) : "A'zolar yo'q.");
}
// har oyning boshida o'tgan oy natijasi bir marta yuboriladi (takror yozilgan bo'lsa)
async function awardMonths() {
  if (Number(day().slice(8)) > 5) return;
  const dt = new Date(day().slice(0, 8) + "01T00:00:00Z"); dt.setUTCDate(0);
  const pm = dt.toISOString().slice(0, 7);
  const { data: cs } = await sb.from("circles").select("*");
  for (const c of cs ?? []) {
    const { data: ex } = await sb.from("month_awards").select("month").eq("circle_id", c.id).eq("month", pm).maybeSingle();
    if (ex) continue;
    const { count } = await sb.from("revisions").select("*", { count: "exact", head: true }).eq("circle_id", c.id).gte("day", pm + "-01").lte("day", monthEnd(pm + "-01"));
    if (!count) continue;
    const rows = await monthScore(c.id, pm);
    if (!rows.length) continue;
    const { error } = await sb.from("month_awards").insert({ circle_id: c.id, month: pm, result: rows });
    if (error) continue;
    const prize = String(c.prize ?? "");
    const msg = `🏆 <b>${MONTHS[Number(pm.slice(5)) - 1]} oyi natijalari</b>\n\n${scoreLines(rows)}\n\n` +
      (prize ? `🎁 Sovrin: <b>${esc(prize)}</b>\n🎉 Tabriklaymiz, <b>${esc(rows[0].name)}</b>!` : `🎉 G'olib: <b>${esc(rows[0].name)}</b>!`);
    const { data: ms } = await sb.from("members").select("tg_id").eq("circle_id", c.id);
    const to = new Set<number>([c.admin_id, ...(ms ?? []).map((m) => m.tg_id)]);
    for (const id of to) await send(id, msg).catch(() => {});
  }
}
async function revLine(uid: number) {
  const t = await revToday(uid);
  return `\n🔁 Takror bugun: ${fmt(t)} / ${fmt(REV_DAILY)} sahifa`;
}

// ---------- eslatmalar ----------
async function remind() {
  await awardMonths();
  if (dow() === REST) return; // dam kuni
  const { data: cs } = await sb.from("circles").select("*");
  for (const c of cs ?? []) {
    const { data: ms } = await sb.from("members").select("*").eq("circle_id", c.id);
    const st = await statsFor((ms ?? []).map((m) => m.tg_id), weekStart());
    const noGoal: string[] = [];
    for (const m of ms ?? []) {
      const s = st.get(m.tg_id)!;
      if (!s.goal) {
        const lt = await longTerm(m.tg_id);
        noGoal.push(lt.suggest ? `${m.name} (tavsiya: ${fmt(lt.suggest)})` : m.name);
        continue;
      }
      if (s.approved + s.pending + 1e-9 < expected(s.goal)) {
        await send(m.tg_id,
          `⏰ Bu hafta qoldi: <b>${fmt(Math.max(0, s.goal - s.approved - s.pending))}</b> sahifa.\nBugun yodlagan bo'lsangiz, belgilang 👇`,
          menuKb(false, true));
      }
    }
    if (dow() <= 2 && noGoal.length) {
      await send(c.admin_id, `🎯 Hali reja belgilanmagan:\n${noGoal.map((n) => "• " + esc(n)).join("\n")}`,
        { inline_keyboard: [[{ text: "👥 A'zolar va rejalar", callback_data: "al" }]] });
    }
    const { count } = await sb.from("reports").select("*", { count: "exact", head: true })
      .eq("circle_id", c.id).eq("status", "pending");
    if ((count ?? 0) > 0) {
      await send(c.admin_id, `⏳ Tekshirilmagan hisobotlar: <b>${count}</b>`,
        { inline_keyboard: [[{ text: "⏳ Tekshirish", callback_data: "ap" }]] });
    }
  }
}

async function weekly() {
  const { data: cs } = await sb.from("circles").select("*");
  const ws = weekStart();
  for (const c of cs ?? []) {
    const { data: ms } = await sb.from("members").select("*").eq("circle_id", c.id);
    if (!ms?.length) continue;
    const st = await statsFor(ms.map((m) => m.tg_id), ws);
    const total = [...st.values()].reduce((x, s) => x + s.approved, 0);
    await send(c.admin_id,
      `📈 <b>Hafta yakuni</b> (${ws})\n\n${ms.map((m) => lineFor(m.name, st.get(m.tg_id)!)).join("\n")}\n\nJami tasdiqlangan: <b>${fmt(total)}</b> sahifa`);
    for (const m of ms) {
      const s = st.get(m.tg_id)!;
      if (!s.goal) continue;
      const rec = await weekRecord(m.tg_id);
      await send(m.tg_id,
        s.approved >= s.goal
          ? `🎉 Barakalla! Bu hafta <b>${fmt(s.approved)}</b> / ${fmt(s.goal)} sahifani bajardingiz.\n🔥 Hafta seriyasi: ${rec.streak}`
          : `📊 Bu hafta: <b>${fmt(s.approved)}</b> / ${fmt(s.goal)} sahifa tasdiqlandi. Yangi haftada davom etamiz, insha'Allah 🌙`);
    }
  }
}

function cronSql(hook: string, k: string) {
  return `create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('hifz-remind','hifz-weekly');

select cron.schedule('hifz-remind', '0 16 * * *', $$
  select net.http_post(url := '${hook}/cron?a=remind&k=${k}');
$$);

select cron.schedule('hifz-weekly', '5 16 * * 6', $$
  select net.http_post(url := '${hook}/cron?a=weekly&k=${k}');
$$);`;
}

// ---------- sayt (Telegram Mini App) uchun xavfsiz API ----------
async function hmacBytes(key: Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}

// Telegram initData imzosini tekshiradi: foydalanuvchini soxtalashtirib bo'lmaydi
async function verifyInit(initData: string): Promise<{ uid: number; name: string } | null> {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmacBytes(new TextEncoder().encode("WebAppData"), BOT);
  const sig = [...(await hmacBytes(secret, dcs))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (sig !== hash) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") ?? 0) > 86400) return null;
  try {
    const u = JSON.parse(p.get("user") ?? "null");
    return u?.id ? { uid: Number(u.id), name: String(u.first_name ?? "Do'st") } : null;
  } catch {
    return null;
  }
}

async function rankingData(circId: number, scope: string) {
  const { data: ms } = await sb.from("members").select("*").eq("circle_id", circId);
  const list = ms ?? [];
  const rows: { name: string; goal: number; done: number; pct: number }[] = [];
  const none: string[] = [];
  let title = "";
  if (scope === "w") {
    title = `Hafta (${weekStart()})`;
    const st = await statsFor(list.map((m) => m.tg_id), weekStart());
    for (const m of list) {
      const s = st.get(m.tg_id)!;
      if (s.goal) rows.push({ name: m.name, goal: s.goal, done: s.approved, pct: 0 }); else none.push(m.name);
    }
  } else {
    for (const m of list) {
      const lt = await longTerm(m.tg_id);
      const t = scope === "m"
        ? (lt.month ? { goal: lt.month.target, done: lt.month.approved } : null)
        : (lt.plan ? { goal: lt.plan.pages, done: lt.plan.approved } : null);
      if (t && t.goal > 0) rows.push({ name: m.name, ...t, pct: 0 }); else none.push(m.name);
    }
    title = scope === "m" ? `Oy (${MONTHS[Number(day().slice(5, 7)) - 1]})` : "Yil";
  }
  for (const r of rows) r.pct = Math.round((r.done / r.goal) * 100);
  rows.sort((a, b) => b.done / b.goal - a.done / a.goal || b.done - a.done);
  return { title, rows, none };
}

const numIn = (v: unknown, max = 100) => {
  const n = Math.round(Number(v) * 100) / 100;
  return n > 0 && n <= max ? n : null;
};

async function rpc(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "bad" }, 400);
  const me = await verifyInit(String(body.initData ?? ""));
  if (!me) return json({ error: "auth" }, 401);
  const { uid, name } = me;
  const circ = await adminCircle(uid, name);
  const mem = await memberOf(uid);
  const circId = circ?.id ?? mem?.circle_id;
  if (!circId) return json({ error: "no_circle" }, 403);
  const ws = weekStart();
  const admin = !!circ;
  const bad = () => json({ error: "bad" }, 400);
  const forbid = () => json({ error: "forbidden" }, 403);
  const ok = () => json({ ok: true });

  switch (body.a) {
    case "me": {
      const out: Record<string, unknown> = {
        uid, name, isAdmin: admin, isMember: !!mem, week_start: ws, today: day(), rest_day: REST, rest_name: FULLDAY[REST], rev_daily: REV_DAILY, prize: PRIZE,
      };
      if (mem) {
        const s = (await statsFor([uid], ws)).get(uid)!;
        const { data: all } = await sb.from("reports").select("pages").eq("tg_id", uid).eq("status", "approved");
        out.my = {
          goal: s.goal, approved: s.approved, pending: s.pending,
          expected: s.goal ? expected(s.goal) : 0,
          allTime: (all ?? []).reduce((x, r) => x + Number(r.pages), 0),
          lt: await longTerm(uid), rec: await weekRecord(uid), revToday: await revToday(uid),
          time: { week: (await timeStats([uid], ws)).get(uid), month: (await timeStats([uid], monthStart())).get(uid) },
        };
      }
      if (admin) {
        const { count } = await sb.from("reports").select("*", { count: "exact", head: true })
          .eq("circle_id", circId).eq("status", "pending");
        out.pendingCount = count ?? 0;
      }
      return json(out);
    }
    case "ranking":
      return json(await rankingData(circId, String(body.scope ?? "w")));
    case "report": {
      const n = numIn(body.pages);
      if (!mem || !n) return bad();
      await createReport(uid, name, n, true);
      return ok();
    }
    case "request":
      return forbid(); // maqsadni faqat yo'naltiruvchi belgilaydi
    case "members": {
      if (!admin) return forbid();
      const { data: ms } = await sb.from("members").select("*").eq("circle_id", circId).order("joined_at");
      const st = await statsFor((ms ?? []).map((m) => m.tg_id), ws);
      const tw = await timeStats((ms ?? []).map((m) => m.tg_id), ws), tm = await timeStats((ms ?? []).map((m) => m.tg_id), monthStart());
      const members = await Promise.all((ms ?? []).map(async (m) => {
        const s = st.get(m.tg_id)!;
        return {
          id: m.tg_id, name: m.name, phone: m.phone ?? null, goal: s.goal, approved: s.approved, pending: s.pending,
          time: { week: tw.get(m.tg_id), month: tm.get(m.tg_id) },
          expected: s.goal ? expected(s.goal) : 0, lt: await longTerm(m.tg_id),
        };
      }));
      return json({ week_start: ws, members });
    }
    case "pending": {
      if (!admin) return forbid();
      const { data: rs } = await sb.from("reports").select("*")
        .eq("circle_id", circId).eq("status", "pending").order("created_at");
      const ids = (rs ?? []).map((r) => r.tg_id);
      const rids = (rs ?? []).map((r) => r.id);
      const { data: vs } = rids.length ? await sb.from("study_sessions").select("id,report_id").in("report_id", rids).not("voice_file", "is", null) : { data: [] };
      const voiceBy = new Map((vs ?? []).map((v: any) => [v.report_id, v.id]));
      const { data: ms } = ids.length ? await sb.from("members").select("tg_id,name").in("tg_id", ids) : { data: [] };
      const names = new Map((ms ?? []).map((m: any) => [m.tg_id, m.name]));
      return json({
        items: (rs ?? []).map((r) => ({
          id: r.id, tg_id: r.tg_id, name: names.get(r.tg_id) ?? "A'zo", pages: Number(r.pages), day: r.day,
          sid: voiceBy.get(r.id) ?? null,
        })),
      });
    }
    case "decide": {
      if (!admin) return forbid();
      const id = Number(body.id);
      if (!id || !["approved", "repeat"].includes(body.status)) return bad();
      await decide(uid, id, body.status);
      return ok();
    }
    case "setgoal": {
      if (!admin) return forbid();
      const id = Number(body.id), n = numIn(body.pages);
      if (!id || !n) return bad();
      await setGoal(uid, id, n, true);
      return ok();
    }
    case "setyear": {
      if (!admin) return forbid();
      const id = Number(body.id), n = numIn(body.juz, 30);
      if (!id || !n) return bad();
      await setYear(uid, id, n, true);
      return ok();
    }
    case "setmonth": {
      if (!admin) return forbid();
      const id = Number(body.id);
      if (!id) return bad();
      if (body.juz === null) {
        await setMonth(uid, id, null, true);
      } else {
        const n = numIn(body.juz, 30);
        if (!n) return bad();
        await setMonth(uid, id, n, true);
      }
      return ok();
    }
    case "invite": {
      if (!admin) return forbid();
      return json({ error: "disabled" }, 410);
    }
    case "join": {
      if (!admin) return forbid();
      await sb.from("members").upsert({ tg_id: uid, circle_id: circ.id, name }, { onConflict: "tg_id" });
      return ok();
    }
    case "plan": {
      const target = admin && body.id ? Number(body.id) : uid;
      if (target !== uid && !(await memberInCircle(uid, target))) return forbid();
      if (!(await memberOf(target))) return bad();
      const pi = await planInfo(target);
      const sa = (id: number) => fromId(id);
      return json({
        ...pi,
        todayRef: pi.today ? { from: sa(pi.today.fromId), to: sa(pi.today.toId) } : null,
        live: await liveOf(target) ? true : false,
        slots: SLOTS,
      });
    }
    case "monthplan_set": {
      if (!admin) return forbid();
      const id = Number(body.id), n = numIn(body.pages, 600);
      if (!id || !n || !(await memberInCircle(uid, id))) return bad();
      let start: number | null = null, dir = Number(body.dir) === -1 ? -1 : 1;
      if (body.cont) { const p = await getPos(id); if (p) { start = p.ptr; dir = p.dir; } }
      else if (body.page) { const pg = Number(body.page); start = pg >= 1 && pg <= 604 ? PAGE_FIRST[pg - 1] : null; }
      else { const su = Number(body.s), ay = Number(body.ay ?? 1); start = validSA(su, ay) ? ayahId(su, ay) : null; }
      if (!start) return bad();
      await setMonthPlan(uid, id, n, start, dir);
      return ok();
    }
    case "plan_set": {
      if (!mem) return forbid();
      let id: number | null = null;
      if (body.page) { const pg = Number(body.page); id = pg >= 1 && pg <= 604 ? PAGE_FIRST[pg - 1] : null; }
      else { const su = Number(body.s), ay = Number(body.ay ?? 1); id = validSA(su, ay) ? ayahId(su, ay) : null; }
      if (!id) return bad();
      await setPos(uid, id, Number(body.dir) === -1 ? -1 : 1);
      return ok();
    }
    case "plan_dir": {
      if (!mem) return forbid();
      const p = await getPos(uid);
      if (!p) return bad();
      await sb.from("positions").update({ dir: p.dir === 1 ? -1 : 1, week_ptr: p.ptr }).eq("tg_id", uid);
      return ok();
    }
    case "live": {
      const l = await liveList(circId);
      const mine = mem ? await liveOf(uid) : null;
      return json({ ...l, slots: SLOTS, mine: mine ? { slot: mine.slot, from: mine.win_from, to: mine.win_to, since: mine.started_at } : null, isMember: !!mem });
    }
    case "live_start": {
      if (!mem) return forbid();
      const h = numIn(body.hours, 12), slot = SLOTS[String(body.slot)] ? String(body.slot) : "other";
      if (!h) return bad();
      await liveStart(uid, name, slot, h, true);
      return ok();
    }
    case "live_time": {
      if (!mem) return forbid();
      const h = numIn(body.hours, 12);
      if (!h) return bad();
      await liveTime(uid, name, h, true);
      return ok();
    }
    case "live_finish": {
      if (!mem) return forbid();
      let range: [number, number] | null = null;
      if (body.mode === "plan") {
        const pi = await planInfo(uid);
        if (pi.today) range = [pi.today.fromId, pi.today.toId];
      } else if (body.mode === "range") {
        const f = body.from ?? [], t = body.to ?? [];
        if (!validSA(Number(f[0]), Number(f[1])) || !validSA(Number(t[0]), Number(t[1]))) return bad();
        const a = ayahId(Number(f[0]), Number(f[1])), b = ayahId(Number(t[0]), Number(t[1]));
        if (b < a) return bad();
        range = [a, b];
      }
      await liveFinish(uid, name, range, null, true);
      return ok();
    }
    case "score": {
      const m = day().slice(0, 7);
      return json({ month: MONTHS[Number(m.slice(5)) - 1], prize: PRIZE, weights: { plan: W_PLAN, cons: W_CONS, rev: W_REV }, rev_daily: REV_DAILY, rows: await monthScore(circId, m) });
    }
    case "rev_add": {
      if (!mem) return forbid();
      const tot = await addRevision(uid, Number(body.pages), true);
      return tot === null ? bad() : json({ ok: true, today: tot, norm: REV_DAILY });
    }
    case "rev_list": {
      if (!admin) return forbid();
      const id = Number(body.id);
      if (!(await memberInCircle(uid, id))) return forbid();
      const { data } = await sb.from("revisions").select("id,pages,day").eq("tg_id", id).order("created_at", { ascending: false }).limit(30);
      return json({ items: (data ?? []).map((r) => ({ id: r.id, pages: Number(r.pages), day: r.day })) });
    }
    case "rev_delete": {
      if (!admin) return forbid();
      await sb.from("revisions").delete().eq("id", Number(body.id)).eq("circle_id", circId);
      return ok();
    }
    case "settings_set": {
      if (!admin) return forbid();
      if (body.rev_daily !== undefined && !(await setRevDaily(uid, Math.round(Number(body.rev_daily) * 100) / 100))) return json({ error: "bad_rev" }, 400);
      if (body.prize !== undefined && !(await setPrize(uid, String(body.prize)))) return bad();
      return json({ ok: true, rev_daily: REV_DAILY, prize: PRIZE });
    }
    case "rest_set": {
      if (!admin) return forbid();
      return (await setRest(uid, Number(body.day))) ? json({ ok: true, rest_day: REST, rest_name: FULLDAY[REST] }) : bad();
    }
    case "member_add": {
      if (!admin) return forbid();
      const r = await addMember(uid, Number(body.id), String(body.name ?? "").trim(), String(body.phone ?? "").trim() || null);
      return r.ok ? json({ ok: true, existed: r.existed }) : json({ error: r.err }, 400);
    }
    case "member_delete": {
      if (!admin) return forbid();
      return (await deleteMember(uid, Number(body.id))) ? ok() : bad();
    }
    case "report_list": {
      if (!admin) return forbid();
      const id = Number(body.id);
      if (!(await memberInCircle(uid, id))) return forbid();
      const { data } = await sb.from("reports").select("id,pages,day,status").eq("tg_id", id).order("created_at", { ascending: false }).limit(30);
      return json({ items: (data ?? []).map((r) => ({ id: r.id, pages: Number(r.pages), day: r.day, status: r.status })) });
    }
    case "report_edit": {
      if (!admin) return forbid();
      const patch: { pages?: number; day?: string; status?: string } = {};
      if (body.pages !== undefined) patch.pages = Math.round(Number(body.pages) * 100) / 100;
      if (body.day !== undefined) patch.day = String(body.day);
      if (body.status !== undefined) patch.status = String(body.status);
      const r = await editReport(uid, Number(body.id), patch);
      return r.ok ? json({ ok: true, desc: r.desc }) : json({ error: r.err }, 400);
    }
    case "report_add": {
      if (!admin) return forbid();
      const r = await addReportManual(uid, Number(body.id), Math.round(Number(body.pages) * 100) / 100, String(body.day ?? day()));
      return r.ok ? ok() : json({ error: r.err }, 400);
    }
    case "goal_clear": {
      if (!admin) return forbid();
      return (await clearGoal(uid, Number(body.id))) ? ok() : json({ error: "no_goal" }, 400);
    }
    case "audit_list": {
      if (!admin) return forbid();
      const id = Number(body.id);
      if (!(await memberInCircle(uid, id))) return forbid();
      return json({ items: await auditList(circId, id) });
    }
    case "audit_undo": {
      if (!admin) return forbid();
      const r = await auditUndo(uid, Number(body.id));
      return r === "ok" ? ok() : json({ error: r }, 400);
    }
    case "report_delete":
      if (!admin) return forbid();
      return (await deleteReport(uid, Number(body.id))) ? ok() : bad();
    case "mist_delete":
      if (!admin) return forbid();
      return (await deleteMistake(uid, Number(body.id))) ? ok() : bad();
    case "trash_list": {
      if (!admin) return forbid();
      return json({ items: await trashItems(circId) });
    }
    case "trash_restore": {
      if (!admin) return forbid();
      return (await restoreTrash(uid, Number(body.id))) ? ok() : json({ error: "restore_failed" }, 400);
    }
    case "message": {
      const t = String(body.text ?? "").trim();
      if (!mem || !t) return bad();
      return (await messageAdmin(uid, t)) ? ok() : bad();
    }
    case "voice_get":
    case "voice_send": {
      if (!admin) return forbid();
      const { data: ss } = await sb.from("study_sessions").select("voice_file,circle_id").eq("id", Number(body.id)).maybeSingle();
      if (!ss?.voice_file || ss.circle_id !== circId) return json({ error: "no_voice" }, 404);
      if (body.a === "voice_send") {
        await tg("sendVoice", { chat_id: uid, voice: ss.voice_file });
        return ok();
      }
      const f = await (await tg("getFile", { file_id: ss.voice_file })).json();
      const path = f?.result?.file_path;
      if (!path) return json({ error: "no_voice" }, 404);
      const buf = new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${BOT}/${path}`)).arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) return json({ error: "too_big" }, 413);
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return json({ data: btoa(bin), type: "audio/ogg" });
    }
    case "mist_list": {
      const target = admin && body.id ? Number(body.id) : uid;
      if (target !== uid && !(await memberInCircle(uid, target))) return forbid();
      const { data } = await sb.from("mistakes").select("*").eq("tg_id", target).in("status", ["open", "fixed"])
        .order("created_at", { ascending: false }).limit(60);
      return json({
        kinds: KINDS,
        items: (data ?? []).map((m) => {
          const [su, ay] = fromId(m.ayah);
          return { id: m.id, ref: label(m.ayah), s: su, a: ay, word: m.word, kind: m.kind, note: m.note, status: m.status, byAdmin: m.by_id !== m.tg_id, day: String(m.created_at).slice(0, 10) };
        }),
      });
    }
    case "mist_add": {
      const target = admin && body.id ? Number(body.id) : uid;
      if (target !== uid && !(await memberInCircle(uid, target))) return forbid();
      if (!(await memberOf(target))) return forbid();
      const su = Number(body.s), ay = Number(body.ay);
      if (!validSA(su, ay)) return bad();
      const word = body.word ? Math.min(999, Math.max(1, Number(body.word) | 0)) : null;
      const note = body.note ? String(body.note).slice(0, 200) : null;
      await addMistake(uid, target, ayahId(su, ay), word, String(body.kind ?? "other"), note);
      return ok();
    }
    case "mist_fix": {
      const id = Number(body.id);
      if (!id) return bad();
      const { data: m } = await sb.from("mistakes").select("tg_id,circle_id").eq("id", id).maybeSingle();
      if (!m || (m.tg_id !== uid && m.circle_id !== circId)) return forbid();
      if (m.tg_id !== uid && !admin) return forbid();
      await sb.from("mistakes").update({ status: "fixed", fixed_at: new Date().toISOString() }).eq("id", id);
      return ok();
    }
    default:
      return bad();
  }
}

// ---------- kirish nuqtasi ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    await loadRest();
    if (path.endsWith("/setup")) {
      if (url.searchParams.get("token") !== BOT) return text("token noto'g'ri", 401);
      const k = await secretKey();
      const hook = `${SB_URL}/functions/v1/hifz-bot`;
      const r = await tg("setWebhook", { url: hook, secret_token: k, drop_pending_updates: true });
      return text(`Webhook: ${JSON.stringify(await r.json())}\n\n--- SQL Editor'da Run qiling ---\n\n${cronSql(hook, k)}`);
    }
    if (path.endsWith("/rpc")) return await rpc(req);
    if (path.endsWith("/api")) return await groupApi(url.searchParams.get("c") ?? "");
    if (path.endsWith("/cron")) {
      if (url.searchParams.get("k") !== (await secretKey())) return text("unauthorized", 401);
      const a = url.searchParams.get("a");
      if (a === "remind") await remind();
      if (a === "weekly") await weekly();
      return text("ok");
    }
    if (req.method === "POST") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== (await secretKey())) {
        return text("unauthorized", 401);
      }
      const update = await req.json();
      if (update.callback_query) await handleCallback(update.callback_query);
      else await handleMessage(update.message);
      return text("ok");
    }
    return text("Hifz bot ishlayapti ✅");
  } catch (e) {
    console.error(e);
    return req.method === "POST" ? text("ok") : json({ error: "server_error" }, 500);
  }
});
