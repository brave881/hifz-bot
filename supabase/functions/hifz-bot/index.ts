// Hifz Tracker: Telegram bot (tugmalar bilan) + sayt uchun API (bitta Supabase Edge Function)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT = Deno.env.get("BOT_TOKEN")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const TZ = 5; // Toshkent UTC+5
const SITE = Deno.env.get("SITE_URL") ?? "https://brave881.github.io/hifz-bot/";

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

// ---------- yordamchilar ----------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
const text = (s: string, status = 200) =>
  new Response(s, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

const day = (shift = 0) =>
  new Date(Date.now() + TZ * 3600e3 + shift * 864e5).toISOString().slice(0, 10);

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

const liveStreak = (m: any) => ((m.last_date ?? "") >= day(-1) ? m.streak : 0);

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
    chat_id,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup,
  });
}

// ---------- tugmalar ----------
const MENU = {
  inline_keyboard: [
    [{ text: "✅ Bugun yodladim", callback_data: "done" }],
    [
      { text: "📊 Natijam", callback_data: "me" },
      { text: "🏆 Reyting", callback_data: "top" },
    ],
    [
      { text: "🎯 Kunlik maqsad", callback_data: "goal" },
      { text: "🌐 Sayt", callback_data: "site" },
    ],
  ],
};

const GOALS = {
  inline_keyboard: [
    [3, 5, 10].map((n) => ({ text: `${n} oyat`, callback_data: `g${n}` })),
    [15, 20, 30].map((n) => ({ text: `${n} oyat`, callback_data: `g${n}` })),
    [{ text: "⬅️ Orqaga", callback_data: "menu" }],
  ],
};

// "/" bosilganda chiqadigan oddiy ro'yxat (bir marta o'rnatiladi)
let commandsSet = false;
async function ensureCommands() {
  if (commandsSet) return;
  commandsSet = true;
  await tg("setMyCommands", {
    commands: [
      { command: "menyu", description: "Tugmalarni ochish" },
      { command: "yodladim", description: "Bugun yodladim" },
      { command: "natija", description: "Mening natijam" },
      { command: "reyting", description: "Guruh reytingi" },
      { command: "sayt", description: "Guruh sahifasi" },
    ],
  });
}

// ---------- asosiy amallar (buyruq ham, tugma ham shu yerga keladi) ----------
async function act(a: string, chat: number, uid: number, name: string) {
  await sb.from("members").upsert(
    { chat_id: chat, tg_id: uid, name },
    { onConflict: "chat_id,tg_id" },
  );
  const { data: m } = await sb.from("members").select("*")
    .eq("chat_id", chat).eq("tg_id", uid).single();

  if (a === "start" || a === "menu") {
    await ensureCommands();
    return send(chat,
      `Assalomu alaykum, <b>${esc(name)}</b>! 🌙\n\nPastdagi tugmalardan foydalaning 👇`, MENU);
  }

  if (a === "goal") {
    return send(chat, `🎯 <b>${esc(name)}</b>, kuniga nechta oyat yodlaysiz?`, GOALS);
  }

  if (/^g\d+$/.test(a)) {
    const n = parseInt(a.slice(1));
    await sb.from("members").update({ daily_goal: n }).eq("chat_id", chat).eq("tg_id", uid);
    return send(chat, `✅ ${esc(name)}, kunlik maqsad: <b>${n} oyat</b>`, MENU);
  }

  if (a === "done") {
    const today = day();
    if (m.last_date === today) {
      return send(chat, `${esc(name)}, bugun allaqachon belgilagansiz ✅`, MENU);
    }
    const streak = m.last_date === day(-1) ? m.streak + 1 : 1;
    await sb.from("members").update({
      streak,
      best_streak: Math.max(m.best_streak, streak),
      total_days: m.total_days + 1,
      last_date: today,
    }).eq("chat_id", chat).eq("tg_id", uid);
    await sb.from("logs").upsert({ chat_id: chat, tg_id: uid, day: today });
    return send(chat, `🔥 Barakalla, <b>${esc(name)}</b>! Ketma-ket: <b>${streak}</b> kun`, MENU);
  }

  if (a === "me") {
    return send(chat,
      `👤 <b>${esc(name)}</b>\n` +
      `🎯 Kunlik maqsad: ${m.daily_goal} oyat\n` +
      `🔥 Ketma-ket: ${liveStreak(m)} kun\n` +
      `🏅 Eng yaxshi: ${m.best_streak} kun\n` +
      `📅 Jami: ${m.total_days} kun`, MENU);
  }

  if (a === "top") {
    const { data } = await sb.from("members").select("*").eq("chat_id", chat);
    const top = (data ?? [])
      .map((x) => ({ ...x, s: liveStreak(x) }))
      .sort((a, b) => b.s - a.s || b.total_days - a.total_days)
      .slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = top.map((x, i) => `${medals[i] ?? `${i + 1}.`} ${esc(x.name)} — ${x.s} kun`);
    return send(chat, `🏆 <b>Reyting</b>\n\n${lines.join("\n")}`, MENU);
  }

  if (a === "site") {
    let { data: g } = await sb.from("groups").select("code").eq("chat_id", chat).maybeSingle();
    if (!g) {
      const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      await sb.from("groups").insert({ chat_id: chat, code });
      g = { code };
    }
    return send(chat, `🌐 Guruh sahifasi:\n${SITE}?c=${g.code}`, MENU);
  }
}

const CMD: Record<string, string> = {
  "/start": "start", "/menyu": "menu", "/yodladim": "done", "/natija": "me", "/men": "me",
  "/reyting": "top", "/sayt": "site", "/reja": "goal", "/maqsad": "goal",
};

async function handleMessage(msg: any) {
  if (!msg?.text || !msg.text.startsWith("/")) return;
  const cmd = msg.text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  const a = CMD[cmd];
  if (!a) return;
  await act(a, msg.chat.id, msg.from.id, msg.from.first_name ?? "Do'st");
}

async function handleCallback(cq: any) {
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  if (!cq.message || !cq.data) return;
  await act(cq.data, cq.message.chat.id, cq.from.id, cq.from.first_name ?? "Do'st");
}

// ---------- sayt uchun API ----------
async function groupApi(code: string) {
  const { data: g } = await sb.from("groups").select("chat_id").eq("code", code).maybeSingle();
  if (!g) return json({ error: "not_found" }, 404);

  const { data: ms } = await sb.from("members").select("*").eq("chat_id", g.chat_id);
  const { data: ls } = await sb.from("logs").select("tg_id,day").eq("chat_id", g.chat_id).gte("day", day(-6));

  const days = [...Array(7)].map((_, i) => day(i - 6));
  const members = (ms ?? []).map((m) => ({
    name: m.name,
    goal: m.daily_goal,
    streak: liveStreak(m),
    best: m.best_streak,
    total: m.total_days,
    today: m.last_date === day(),
    marks: days.map((d) => ((ls ?? []).some((l) => l.tg_id === m.tg_id && l.day === d) ? 1 : 0)),
  })).sort((a, b) => b.streak - a.streak || b.total - a.total);

  return json({ today: day(), days, members });
}

// ---------- eslatma va haftalik natija ----------
async function remind() {
  const { data } = await sb.from("members").select("*");
  const byChat = new Map<number, any[]>();
  for (const m of data ?? []) {
    if (m.last_date !== day()) byChat.set(m.chat_id, [...(byChat.get(m.chat_id) ?? []), m]);
  }
  for (const [chat, list] of byChat) {
    await send(chat,
      `⏰ Bugun hali yodlamaganlar:\n${list.map((m) => "• " + esc(m.name)).join("\n")}\n\nPastdagi tugmani bosing 👇`,
      MENU);
  }
}

async function weekly() {
  const { data: members } = await sb.from("members").select("*");
  const { data: logs } = await sb.from("logs").select("*").gte("day", day(-6));
  const chats = new Set((members ?? []).map((m) => m.chat_id));
  for (const chat of chats) {
    const rows = (members ?? []).filter((m) => m.chat_id === chat).map((m) => ({
      name: m.name,
      n: (logs ?? []).filter((l) => l.chat_id === chat && l.tg_id === m.tg_id).length,
    })).sort((a, b) => b.n - a.n);
    await send(chat, `📊 <b>Haftalik natija</b>\n\n` + rows.map((r) => `${esc(r.name)} — ${r.n}/7 kun`).join("\n"), MENU);
  }
}

function cronSql(hook: string, k: string) {
  return `create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('hifz-remind','hifz-weekly');

select cron.schedule('hifz-remind', '0 16 * * *', $$
  select net.http_post(url := '${hook}/cron?a=remind&k=${k}');
$$);

select cron.schedule('hifz-weekly', '5 16 * * 5', $$
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
      const res = await r.json();
      return text(`Webhook: ${JSON.stringify(res)}\n\n--- SQL Editor'da Run qiling ---\n\n${cronSql(hook, k)}`);
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
