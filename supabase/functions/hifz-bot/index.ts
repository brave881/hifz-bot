// Hifz Tracker v3: yo'naltiruvchi (admin) tasdiqlaydigan haftalik reja tizimi
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT = Deno.env.get("BOT_TOKEN")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const TZ = 5; // Toshkent UTC+5
const SITE = Deno.env.get("SITE_URL") ?? "https://hifz-bot.vercel.app/";

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
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
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
      { text: "🎯 Haftalik maqsad", callback_data: "gp" },
    ]);
  }
  if (isMem || isAdmin) rows.push([{ text: "🏆 Reyting", callback_data: "top:w" }]);
  if (isAdmin) {
    rows.push([{ text: `⏳ Tekshirish${pending ? ` (${pending})` : ""}`, callback_data: "ap" }]);
    rows.push([
      { text: "👥 A'zolar va rejalar", callback_data: "al" },
      { text: "📈 Hafta hisoboti", callback_data: "ar" },
    ]);
    rows.push([
      { text: "🔗 Taklif havolasi", callback_data: "inv" },
      { text: "🌐 Sayt", callback_data: "site" },
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
async function createReport(uid: number, name: string, pages: number) {
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
  return send(uid, `📨 Yuborildi: <b>${fmt(pages)}</b> sahifa.\nYo'naltiruvchi tekshirib, tasdiqlaydi ✅`,
    menuKb(!!(await circleOfAdmin(uid)), true));
}

async function sendRequest(uid: number, name: string, pages: number) {
  const mem = await memberOf(uid);
  if (!mem) return showMenu(uid, name);
  const circ = await circleById(mem.circle_id);
  if (!circ) return;
  await send(circ.admin_id,
    `🎯 <b>${esc(mem.name)}</b> bu hafta <b>${fmt(pages)}</b> sahifa yodlamoqchi.`,
    { inline_keyboard: [[
      { text: "✅ Qabul qilish", callback_data: `ga:${uid}:${pages}` },
      { text: "✏️ O'zgartirish", callback_data: `as:${uid}` },
    ]] });
  return send(uid, `📨 Maqsadingiz yuborildi: <b>${fmt(pages)}</b> sahifa.\nYo'naltiruvchi tasdiqlaydi.`,
    menuKb(!!(await circleOfAdmin(uid)), true));
}

async function setGoal(adminUid: number, memberId: number, pages: number) {
  const circ = await circleOfAdmin(adminUid);
  if (!circ) return;
  const { data: m } = await sb.from("members").select("*").eq("tg_id", memberId).eq("circle_id", circ.id).maybeSingle();
  if (!m) return send(adminUid, "A'zo topilmadi.");
  await sb.from("goals").upsert({ tg_id: memberId, week_start: weekStart(), pages }, { onConflict: "tg_id,week_start" });
  const mem = await memberOf(adminUid);
  await send(adminUid, `✅ <b>${esc(m.name)}</b> uchun bu hafta: <b>${fmt(pages)}</b> sahifa`, menuKb(true, !!mem));
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

async function setYear(adminUid: number, memberId: number, juz: number) {
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
  await send(adminUid, `✅ <b>${esc(m.name)}</b> uchun yillik reja: <b>${fmt(juz)}</b> juz`);
  return act(`as:${memberId}`, adminUid, "");
}

async function setMonth(adminUid: number, memberId: number, juz: number | null) {
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

  if (a === "inv") {
    if (!circ) return;
    const u = await botUsername();
    return send(uid,
      `🔗 <b>Taklif havolasi</b>\n\nShuni a'zolarga yuboring, bosganda bot ochiladi va ular halqaga qo'shiladi:\n\nhttps://t.me/${u}?start=j_${circ.join_code}`,
      menuKb(true, isMem));
  }

  if (a === "site") {
    if (!circ) return;
    return send(uid, `🌐 Sayt:\n${SITE}?c=${circ.view_code}`, menuKb(true, isMem));
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
    const s = (await statsFor([uid], ws)).get(uid)!;
    const cur = s.goal ? `Joriy maqsad: <b>${fmt(s.goal)}</b> sahifa.\n\n` : "";
    const lt = await longTerm(uid);
    const kb = numKb("q", "m");
    if (lt.suggest) kb.inline_keyboard.unshift([{ text: `💡 Tavsiya: ${fmt(lt.suggest)} sahifa`, callback_data: `q:${lt.suggest}` }]);
    const x = ltLines(lt).trim();
    return send(uid, `🎯 ${cur}${x ? x + "\n\n" : ""}Bu hafta necha sahifa yodlamoqchisiz?\n(Yo'naltiruvchiga yuboriladi)`, kb);
  }
  if (a.startsWith("q:") && isMem) {
    const v = a.slice(2);
    if (v === "x") {
      await setSession("req");
      return send(uid, "Necha sahifa? Son yozing. Masalan: <code>3</code>");
    }
    return sendRequest(uid, name, Number(v));
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
  const n = Math.round(parseFloat(t.replace(",", ".")) * 100) / 100;
  if (!(n > 0 && n <= 100)) {
    return send(uid, "Iltimos, son yozing. Masalan: <code>2</code> yoki <code>1.5</code>");
  }
  if ((s.state.startsWith("yg:") || s.state.startsWith("mg:")) && n > 30) {
    return send(uid, "Juz soni 30 dan oshmasin. Masalan: <code>10</code>");
  }
  await sb.from("sessions").delete().eq("tg_id", uid);
  if (s.state === "report") return createReport(uid, name, n);
  if (s.state === "req") return sendRequest(uid, name, n);
  if (s.state.startsWith("sg:")) return setGoal(uid, Number(s.state.slice(3)), n);
  if (s.state.startsWith("yg:")) return setYear(uid, Number(s.state.slice(3)), n);
  if (s.state.startsWith("mg:")) return setMonth(uid, Number(s.state.slice(3)), n);
}

async function handleMessage(msg: any) {
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
