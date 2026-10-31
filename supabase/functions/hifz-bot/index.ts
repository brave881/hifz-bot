// Hifz Tracker: Telegram bot + sayt uchun API (bitta Supabase Edge Function)
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

// maxfiy kalit: bot tokenidan o'zi yasaladi (alohida parol kerak emas)
let _key = "";
async function secretKey() {
  if (_key) return _key;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hifz:" + BOT));
  _key = [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return _key;
}

async function send(chat_id: number, msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: msg, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

// ---------- Telegram buyruqlari ----------
async function handleMessage(msg: any) {
  if (!msg?.text || !msg.text.startsWith("/")) return;

  const [raw, ...args] = msg.text.trim().split(/\s+/);
  const cmd = raw.split("@")[0].toLowerCase();
  const chat = msg.chat.id;
  const uid = msg.from.id;
  const name = msg.from.first_name ?? "Do'st";

  await sb.from("members").upsert(
    { chat_id: chat, tg_id: uid, name },
    { onConflict: "chat_id,tg_id" },
  );
  const { data: m } = await sb.from("members").select("*")
    .eq("chat_id", chat).eq("tg_id", uid).single();

  if (cmd === "/start") {
    return send(chat,
      `Assalomu alaykum, <b>${esc(name)}</b>! 🌙\n\n` +
      `/reja 5 — kunlik maqsad (oyat soni)\n` +
      `/yodladim — bugungi yodlashni belgilash\n` +
      `/men — shaxsiy natijam\n` +
      `/reyting — guruh reytingi\n` +
      `/sayt — guruh sahifasi (havola)`);
  }

  if (cmd === "/reja") {
    const n = parseInt(args[0]);
    if (!n || n < 1 || n > 100) return send(chat, "Masalan: <code>/reja 5</code> (1 dan 100 gacha)");
    await sb.from("members").update({ daily_goal: n }).eq("chat_id", chat).eq("tg_id", uid);
    return send(chat, `✅ ${esc(name)}, kunlik maqsad: <b>${n}</b> oyat`);
  }

  if (cmd === "/yodladim") {
    const today = day();
    if (m.last_date === today) return send(chat, `${esc(name)}, bugun allaqachon belgilagansiz ✅`);
    const streak = m.last_date === day(-1) ? m.streak + 1 : 1;
    await sb.from("members").update({
      streak,
      best_streak: Math.max(m.best_streak, streak),
      total_days: m.total_days + 1,
      last_date: today,
    }).eq("chat_id", chat).eq("tg_id", uid);
    await sb.from("logs").upsert({ chat_id: chat, tg_id: uid, day: today });
    return send(chat, `🔥 Barakalla, <b>${esc(name)}</b>! Ketma-ket: <b>${streak}</b> kun`);
  }

  if (cmd === "/men") {
    return send(chat,
      `👤 <b>${esc(name)}</b>\n` +
      `Kunlik maqsad: ${m.daily_goal} oyat\n` +
      `Hozirgi streak: ${liveStreak(m)} kun 🔥\n` +
      `Eng yaxshi streak: ${m.best_streak} kun\n` +
      `Jami kunlar: ${m.total_days}`);
  }

  if (cmd === "/reyting") {
    const { data } = await sb.from("members").select("*").eq("chat_id", chat);
    const top = (data ?? [])
      .map((x) => ({ ...x, s: liveStreak(x) }))
      .sort((a, b) => b.s - a.s || b.total_days - a.total_days)
      .slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = top.map((x, i) => `${medals[i] ?? `${i + 1}.`} ${esc(x.name)} — ${x.s} kun`);
    return send(chat, `🏆 <b>Reyting</b>\n\n${lines.join("\n")}`);
  }

  if (cmd === "/sayt") {
    let { data: g } = await sb.from("groups").select("code").eq("chat_id", chat).maybeSingle();
    if (!g) {
      const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
      await sb.from("groups").insert({ chat_id: chat, code });
      g = { code };
    }
    return send(chat, `🌐 Guruh sahifasi:\n${SITE}?c=${g.code}`);
  }
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
      `⏰ Bugun hali yodlamaganlar:\n${list.map((m) => "• " + esc(m.name)).join("\n")}\n\n/yodladim ni bosishni unutmang!`);
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
    await send(chat, `📊 <b>Haftalik natija</b>\n\n` + rows.map((r) => `${esc(r.name)} — ${r.n}/7 kun`).join("\n"));
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
    // bir martalik sozlash: webhook ulaydi va cron SQL ni beradi
    if (path.endsWith("/setup")) {
      if (url.searchParams.get("token") !== BOT) return text("token noto'g'ri", 401);
      const k = await secretKey();
      const hook = `${SB_URL}/functions/v1/hifz-bot`;
      const r = await fetch(`https://api.telegram.org/bot${BOT}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: hook, secret_token: k, drop_pending_updates: true }),
      });
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
      await handleMessage(update.message);
      return text("ok");
    }

    return text("Hifz bot ishlayapti ✅");
  } catch (e) {
    console.error(e);
    return req.method === "POST" ? text("ok") : json({ error: "server_error" }, 500);
  }
});
