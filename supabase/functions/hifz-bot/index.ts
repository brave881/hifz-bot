// Hifz Tracker v3: yo'naltiruvchi (admin) tasdiqlaydigan haftalik reja tizimi
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PAGE_FIRST, SURAH_AYAHS } from "./quran-data.ts";
import { ayahId, dayBlocks, fromId, eta as etaDate, label, nextBlock, pagesIn, TOTAL, validSA, weekBlock, type Dir } from "./plan.ts";

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
const dayIdx = () => (dow() === 0 ? 5 : dow() - 1); // 0..5 (du..sh), yakshanba = 5
const expected = (goal: number) => (goal * (dayIdx() + 1)) / 6;

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
  if (isMem) {
    rows.push([{ text: "📖 Yodladim", callback_data: "rp" }]);
    rows.push([
      { text: "📊 Natijam", callback_data: "me" },
      { text: "🎯 Maqsad so'rash", callback_data: "gp" },
    ]);
    rows.push([
      { text: "▶️ Yodlash (jonli)", callback_data: "lm" },
      { text: "🗺 Rejam", callback_data: "pl" },
    ]);
  }
  if (isMem || isAdmin) rows.push([
    { text: "🏆 Reyting", callback_data: "top:w" },
    { text: "🔴 Hozir kim?", callback_data: "lv" },
  ]);
  if (isMem) rows.push([{ text: "🌐 Sayt", web_app: { url: SITE } }]);
  if (isAdmin) {
    rows.push([{ text: `⏳ Tekshirish${pending ? ` (${pending})` : ""}`, callback_data: "ap" }]);
    rows.push([
      { text: "👥 A'zolar va rejalar", callback_data: "al" },
      { text: "📈 Hafta hisoboti", callback_data: "ar" },
    ]);
    rows.push([
      { text: "🔗 Taklif havolasi", callback_data: "inv" },
      { text: "👑 Panel", web_app: { url: SITE + "admin/" } },
    ]);
    if (!isMem) rows.push([{ text: "➕ Men ham a'zoman", callback_data: "join" }]);
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
      `Assalomu alaykum, <b>${esc(name)}</b>! 🌙\n\nHalqaga qo'shilish uchun yo'naltiruvchidan taklif havolasini so'rang.`);
  }
  let pending = 0;
  if (circ) {
    const { count } = await sb.from("reports").select("*", { count: "exact", head: true })
      .eq("circle_id", circ.id).eq("status", "pending");
    pending = count ?? 0;
  }
  const head = pre ?? `Assalomu alaykum, <b>${esc(name)}</b>! 🌙`;
  return send(uid, `${head}\n\nPastdagi tugmalardan foydalaning 👇`, menuKb(!!circ, !!mem, pending));
}

// ---------- matnlar ----------
function statsText(name: string, s: St, allTime: number, lt?: LT, rec?: { streak: number; total: number }) {
  const lines = [`👤 <b>${esc(name)}</b>`, ""];
  if (!s.goal) {
    lines.push("🎯 Bu hafta uchun maqsad hali belgilanmagan.");
    lines.push("«🎯 Haftalik maqsad» tugmasi bilan yo'naltiruvchiga yuboring.");
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
  L.push(lt.month ? `🗓 Oylik (${lt.month.name}): ${fmt(lt.month.target / JUZ)} juz (${fmt(lt.month.target)} sahifa)` : "🗓 Oylik: belgilanmagan");
  if (lt.plan) L.push(`📆 Yillik: ${fmt(lt.plan.juz)} juz`);
  return L.join("\n");
}
const REQ_NAME: Record<string, string> = { d: "kunlik", w: "haftalik", m: "oylik" };
const reqText = (v: number, kind: string) =>
  kind === "d" ? `kuniga <b>${fmt(v)}</b> sahifa (haftasiga ${fmt(v * 6)})`
    : kind === "m" ? `shu oy <b>${fmt(v)}</b> juz (${fmt(v * JUZ)} sahifa)`
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
  await sb.from("goals").upsert({ tg_id: memberId, week_start: weekStart(), pages }, { onConflict: "tg_id,week_start" });
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
        (r.week_start === weekStart() && dow() !== 6 && dow() !== 0
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
  await sb.from("plans").upsert({ tg_id: memberId, juz, start_date: weekStart(), weeks: 52 }, { onConflict: "tg_id" });
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
    [["w", "📅 Hafta"], ["m", "🗓 Oy"], ["y", "📆 Yil"]].map(([k, l]) => ({
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

  if (await actPlus(a, uid, name, mid)) return;

  if (a === "inv") {
    if (!circ) return;
    const u = await botUsername();
    return send(uid,
      `🔗 <b>Taklif havolasi</b>\n\nShuni a'zolarga yuboring, bosganda bot ochiladi va ular halqaga qo'shiladi:\n\nhttps://t.me/${u}?start=j_${circ.join_code}`,
      menuKb(true, isMem));
  }

  if (a === "site") {
    if (!circ) return;
    return send(uid, "👑 Panelni ochish 👇", { inline_keyboard: [[{ text: "👑 Panel", web_app: { url: SITE + "admin/" } }]] });
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

  if (a === "gp" && isMem) {
    const lt = await longTerm(uid);
    const x = ltLines(lt).trim();
    return send(uid, `🎯 <b>Maqsad so'rash</b>\n\n📝 Hozirgi rejang:\n${await planSnapshot(uid)}${x ? "\n\n" + x : ""}\n\nQaysi maqsadni belgilamoqchisiz?`, { inline_keyboard: [
      [{ text: "📅 Kunlik", callback_data: "gk:d" }, { text: "🎯 Haftalik", callback_data: "gk:w" }, { text: "🗓 Oylik", callback_data: "gk:m" }],
      [{ text: "⬅️ Orqaga", callback_data: "m" }],
    ] });
  }
  if (a.startsWith("gk:") && isMem) {
    const k = a.slice(3);
    const lt = await longTerm(uid);
    const kb = k === "d" ? numKb("qd", "gp", [0.5, 1, 1.5, 2, 2.5, 3, 4])
      : k === "m" ? numKb("qm", "gp", [0.5, 1, 1.5, 2, 2.5, 3, 4, 5])
      : numKb("q", "gp");
    if (k === "w" && lt.suggest) kb.inline_keyboard.unshift([{ text: `💡 Tavsiya: ${fmt(lt.suggest)} sahifa`, callback_data: `q:${lt.suggest}` }]);
    const q = k === "d" ? "Kuniga necha sahifa yodlamoqchisiz?" : k === "m" ? "Shu oy necha juz yodlamoqchisiz? (1 juz = 20 sahifa)" : "Bu hafta necha sahifa yodlamoqchisiz?";
    return send(uid, `${q}\n(Yo'naltiruvchiga yuboriladi)`, kb);
  }
  for (const [pre, kind] of [["q:", "w"], ["qd:", "d"], ["qm:", "m"]] as const) {
    if (a.startsWith(pre) && isMem) {
      const v = a.slice(pre.length);
      if (v === "x") {
        await setSession("req:" + kind);
        return send(uid, kind === "m" ? "Necha juz? Son yozing. Masalan: <code>1</code> yoki <code>0.5</code>" : "Necha sahifa? Son yozing. Masalan: <code>3</code>");
      }
      return sendRequest(uid, name, Number(v), kind);
    }
  }

  if (a === "me" && isMem) {
    const s = (await statsFor([uid], ws)).get(uid)!;
    const { data: all } = await sb.from("reports").select("pages").eq("tg_id", uid).eq("status", "approved");
    const total = (all ?? []).reduce((x, r) => x + Number(r.pages), 0);
    const lt = await longTerm(uid);
    const rec = await weekRecord(uid);
    return send(uid, statsText(mem.name, s, total, lt, rec), menuKb(isAdmin, true));
  }

  // ----- yo'naltiruvchi amallari -----
  if (!isAdmin) return showMenu(uid, name);

  if (a === "al") {
    const { data: ms } = await sb.from("members").select("*").eq("circle_id", circ.id).order("joined_at");
    if (!ms?.length) return send(uid, "Hali a'zolar yo'q. «🔗 Taklif havolasi» ni yuboring.", menuKb(true, isMem));
    const st = await statsFor(ms.map((m) => m.tg_id), ws);
    const body = ms.map((m) => lineFor(m.name, st.get(m.tg_id)!)).join("\n");
    return send(uid,
      `👥 <b>A'zolar</b> (hafta: ${ws})\n\n${body}\n\nReja belgilash uchun ismni bosing 👇`,
      { inline_keyboard: [
        ...ms.map((m) => [{ text: `🎯 ${m.name}`, callback_data: `as:${m.tg_id}` }]),
        [{ text: "⬅️ Orqaga", callback_data: "m" }],
      ] });
  }

  if (a.startsWith("as:")) {
    const id = Number(a.slice(3));
    const { data: m } = await sb.from("members").select("*").eq("tg_id", id).eq("circle_id", circ.id).maybeSingle();
    if (!m) return send(uid, "A'zo topilmadi.");
    const s = (await statsFor([id], ws)).get(id)!;
    const lt = await longTerm(id);
    const rows: unknown[][] = [];
    if (lt.suggest) rows.push([{ text: `💡 Tavsiya: haftalik ${fmt(lt.suggest)} sahifa`, callback_data: `ss:${id}:${lt.suggest}` }]);
    rows.push([
      { text: "🎯 Haftalik", callback_data: `aw:${id}` },
      { text: "📅 Oylik", callback_data: `am:${id}` },
      { text: "🗓 Yillik", callback_data: `ay:${id}` },
    ]);
    rows.push([
      { text: "🗺 Reja", callback_data: `ap:${id}` },
      { text: "⚠️ Xatolar", callback_data: `xa:${id}` },
    ]);
    rows.push([{ text: "⬅️ Orqaga", callback_data: "al" }]);
    return send(uid,
      `👤 <b>${esc(m.name)}</b>\n🎯 Bu hafta: ${s.goal ? `${fmt(s.approved)} / ${fmt(s.goal)}` : "reja yo'q"}${ltLines(lt)}`,
      { inline_keyboard: rows });
  }
  if (a.startsWith("aw:")) {
    const id = Number(a.slice(3));
    return send(uid, "🎯 Bu hafta necha sahifa?", numKb(`sg:${id}`, `as:${id}`));
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
    if (mid) await edit(uid, mid, "✅ Qabul qilindi (oylik)");
    return setMonth(uid, Number(id), Number(v), true);
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
  days?: { day: string; from: string; to: string; pages: number; today: boolean }[];
  avgWeek: number; remainPlan?: number; eta?: string | null; planPages?: number; weekPtr?: number;
};
const DAYN = ["Du", "Se", "Ch", "Pa", "Ju", "Sh"];
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
      day: DAYN[i], from: b ? label(b.from) : "—", to: b ? label(b.to) : "—", pages: b ? b.pages : 0, today: i === di,
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
    L.push("", "🎯 Bu hafta maqsad belgilanmagan — «🎯 Haftalik maqsad» ni bosing.");
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
  await sb.from("study_sessions").update({
    status: "done", ended_at: new Date().toISOString(),
    from_ayah: range?.[0] ?? null, to_ayah: range?.[1] ?? null, pages: range ? pages : null,
    voice_file: voice, report_id: rid,
  }).eq("id", s.id);
  await broadcast(mem.circle_id, uid,
    `⏹ <b>${esc(mem.name)}</b> yodlashni tugatdi (${s.win_from}–${hm(new Date())})` +
    (range ? `\n📖 ${label(range[0])} → ${label(range[1])} (≈ ${fmt(pages)} sahifa)` : "") + (voice ? "\n🎙 Ovoz yo'naltiruvchiga yuborildi" : ""));
  if (quiet) return;
  return send(uid, `⏹ Tugadi! ${range ? `${label(range[0])} → ${label(range[1])} (≈ ${fmt(pages)} sahifa) yo'naltiruvchiga yuborildi ✅` : "Saqlandi."}`, menuKb(!!(await circleOfAdmin(uid)), true));
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
    const p = await getPos(uid);
    if (!p) { await send(uid, "Avval boshlanish nuqtasini tanlang 👇", { inline_keyboard: [[{ text: "📍 Tanlash", callback_data: "ps" }]] }); return true; }
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
      { inline_keyboard: [[{ text: "⚠️ Xato qo'shish", callback_data: `xm:${id}` }], [{ text: "⬅️ Orqaga", callback_data: `as:${id}` }]] });
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

// ---------- kiruvchi xabarlar ----------
async function joinByCode(code: string, uid: number, name: string) {
  const { data: c } = await sb.from("circles").select("*").eq("join_code", code).maybeSingle();
  if (!c) return send(uid, "Havola noto'g'ri yoki eskirgan. Yo'naltiruvchidan yangisini so'rang.");
  const { data: ex } = await sb.from("members").select("tg_id").eq("tg_id", uid).maybeSingle();
  await sb.from("members").upsert({ tg_id: uid, circle_id: c.id, name }, { onConflict: "tg_id" });
  if (!ex && c.admin_id !== uid) await send(c.admin_id, `👤 Yangi a'zo qo'shildi: <b>${esc(name)}</b>`);
  await ensureCommands();
  return showMenu(uid, name, `✅ Halqaga qo'shildingiz, <b>${esc(name)}</b>! 🌙`);
}

async function handleText(uid: number, name: string, t: string) {
  const { data: s } = await sb.from("sessions").select("*").eq("tg_id", uid).maybeSingle();
  if (!s) return showMenu(uid, name);
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
  if (s.state === "req" || s.state.startsWith("req:")) {
    const kind = s.state.startsWith("req:") ? s.state.slice(4) : "w";
    if (kind === "m" && n > 30) return send(uid, "Juz soni 30 dan oshmasin.");
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
    if (payload.startsWith("j_")) return joinByCode(payload.slice(2), uid, name);
    return act("start", uid, name);
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

// ---------- eslatmalar ----------
async function remind() {
  if (dow() === 0) return; // yakshanba dam olish
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
        uid, name, isAdmin: admin, isMember: !!mem, week_start: ws, today: day(),
      };
      if (mem) {
        const s = (await statsFor([uid], ws)).get(uid)!;
        const { data: all } = await sb.from("reports").select("pages").eq("tg_id", uid).eq("status", "approved");
        out.my = {
          goal: s.goal, approved: s.approved, pending: s.pending,
          expected: s.goal ? expected(s.goal) : 0,
          allTime: (all ?? []).reduce((x, r) => x + Number(r.pages), 0),
          lt: await longTerm(uid), rec: await weekRecord(uid),
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
    case "request": {
      const kind = ["d", "w", "m"].includes(body.kind) ? body.kind : "w";
      const n = numIn(kind === "m" ? body.juz ?? body.pages : body.pages, kind === "m" ? 30 : 100);
      if (!mem || !n) return bad();
      const old = await sendRequest(uid, name, n, kind, true);
      return json({ ok: true, old: typeof old === "string" ? old : "" });
    }
    case "members": {
      if (!admin) return forbid();
      const { data: ms } = await sb.from("members").select("*").eq("circle_id", circId).order("joined_at");
      const st = await statsFor((ms ?? []).map((m) => m.tg_id), ws);
      const members = await Promise.all((ms ?? []).map(async (m) => {
        const s = st.get(m.tg_id)!;
        return {
          id: m.tg_id, name: m.name, goal: s.goal, approved: s.approved, pending: s.pending,
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
      const { data: ms } = ids.length ? await sb.from("members").select("tg_id,name").in("tg_id", ids) : { data: [] };
      const names = new Map((ms ?? []).map((m: any) => [m.tg_id, m.name]));
      return json({
        items: (rs ?? []).map((r) => ({
          id: r.id, tg_id: r.tg_id, name: names.get(r.tg_id) ?? "A'zo", pages: Number(r.pages), day: r.day,
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
      return json({ link: `https://t.me/${await botUsername()}?start=j_${circ.join_code}` });
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
      return json({ ...l, slots: SLOTS, mine: mine ? { slot: mine.slot, from: mine.win_from, to: mine.win_to } : null, isMember: !!mem });
    }
    case "live_start": {
      if (!mem) return forbid();
      const h = numIn(body.hours, 12), slot = SLOTS[String(body.slot)] ? String(body.slot) : "other";
      if (!h) return bad();
      if (!(await getPos(uid))) return json({ error: "no_position" }, 400);
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
    case "mist_list": {
      const target = admin && body.id ? Number(body.id) : uid;
      if (target !== uid && !(await memberInCircle(uid, target))) return forbid();
      const { data } = await sb.from("mistakes").select("*").eq("tg_id", target)
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
