// supabase/functions/hifz-bot/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT = Deno.env.get("BOT_TOKEN")!;
const SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const TZ = 5; // Toshkent UTC+5. Boshqa vaqt zonasi bo'lsa o'zgartiring.

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------- yordamchilar ----------
const day = (shift = 0) =>
  new Date(Date.now() + TZ * 3600e3 + shift * 864e5).toISOString().slice(0, 10);

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

async function send(chat_id: number, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  });
}

// kecha yoki bugun yodlamagan bo'lsa, streak uzilgan
const liveStreak = (m: any) => ((m.last_date ?? "") >= day(-1) ? m.streak : 0);

// ---------- buyruqlar ----------
async function handleMessage(msg: any) {
  if (!msg?.text || !msg.text.startsWith("/")) return;

  const [raw, ...args] = msg.text.trim().split(/\s+/);
  const cmd = raw.split("@")[0].toLowerCase();
  const chat = msg.chat.id;
  const uid = msg.from.id;
  const name = msg.from.first_name ?? "Do'st";

  // a'zoni ro'yxatga olish (bor bo'lsa faqat ismini yangilaydi)
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
      `/reyting — guruh reytingi`);
  }

  if (cmd === "/reja") {
    const n = parseInt(args[0]);
    if (!n || n < 1 || n > 100) {
      return send(chat, "Masalan: <code>/reja 5</code> (1 dan 100 gacha)");
    }
    await sb.from("members").update({ daily_goal: n })
      .eq("chat_id", chat).eq("tg_id", uid);
    return send(chat, `✅ ${esc(name)}, kunlik maqsad: <b>${n}</b> oyat`);
  }

  if (cmd === "/yodladim") {
    const today = day();
    if (m.last_date === today) {
      return send(chat, `${esc(name)}, bugun allaqachon belgilagansiz ✅`);
    }
    const streak = m.last_date === day(-1) ? m.streak + 1 : 1;
    await sb.from("members").update({
      streak,
      best_streak: Math.max(m.best_streak, streak),
      total_days: m.total_days + 1,
      last_date: today,
    }).eq("chat_id", chat).eq("tg_id", uid);
    await sb.from("logs").upsert({ chat_id: chat, tg_id: uid, day: today });
    return send(chat,
      `🔥 Barakalla, <b>${esc(name)}</b>! Ketma-ket: <b>${streak}</b> kun`);
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
    const lines = top.map((x, i) =>
      `${medals[i] ?? `${i + 1}.`} ${esc(x.name)} — ${x.s} kun`);
    return send(chat, `🏆 <b>Reyting</b>\n\n${lines.join("\n")}`);
  }
}

// ---------- cron: eslatma va haftalik natija ----------
async function remind() {
  const { data } = await sb.from("members").select("*");
  const byChat = new Map<number, any[]>();
  for (const m of data ?? []) {
    if (m.last_date !== day()) {
      byChat.set(m.chat_id, [...(byChat.get(m.chat_id) ?? []), m]);
    }
  }
  for (const [chat, list] of byChat) {
    await send(chat,
      `⏰ Bugun hali yodlamaganlar:\n${list.map((m) => "• " + esc(m.name)).join("\n")}\n\n` +
      `/yodladim ni bosishni unutmang!`);
  }
}

async function weekly() {
  const since = day(-6);
  const { data: members } = await sb.from("members").select("*");
  const { data: logs } = await sb.from("logs").select("*").gte("day", since);
  const chats = new Set((members ?? []).map((m) => m.chat_id));
  for (const chat of chats) {
    const rows = (members ?? []).filter((m) => m.chat_id === chat).map((m) => ({
      name: m.name,
      n: (logs ?? []).filter((l) => l.chat_id === chat && l.tg_id === m.tg_id).length,
    })).sort((a, b) => b.n - a.n);
    await send(chat,
      `📊 <b>Haftalik natija</b>\n\n` +
      rows.map((r) => `${esc(r.name)} — ${r.n}/7 kun`).join("\n"));
  }
}

// ---------- kirish nuqtasi ----------
Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-telegram-bot-api-secret-token") === SECRET) {
      const update = await req.json();
      await handleMessage(update.message);
      return new Response("ok");
    }
    if (req.headers.get("x-cron-secret") === SECRET) {
      const { action } = await req.json();
      if (action === "remind") await remind();
      if (action === "weekly") await weekly();
      return new Response("ok");
    }
    return new Response("unauthorized", { status: 401 });
  } catch (e) {
    console.error(e);
    return new Response("ok"); // Telegram qayta-qayta yubormasligi uchun
  }
});
