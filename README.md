# Hifz Tracker

Quron yodlash guruhi uchun Telegram bot + sayt.

- bot va API: supabase/functions/hifz-bot
- sayt: docs/ (GitHub Pages)

## v9: batafsil reja, jonli yodlash, xatolar
- **Reja**: a'zo boshlanish nuqtasini (sura/oyat yoki bet, oldinga/orqaga) o'zi tanlaydi. Bot hafta oralig'ini, kunlik oyatlar oralig'ini, oxirgi yodlangan joyni, qolganini, o'rtacha tezlik va tugash sanasini hisoblaydi (Madina mushafi, 604 bet).
- **Jonli yodlash**: «▶️ Boshladim / ⏹ Tugatdim», vaqt oralig'i (bomdoddan keyin / xufton / boshqa), hamma ko'radi va xabar oladi. Tugatganda oraliq + ovoz yo'naltiruvchiga ketadi va avtomatik hisobot yaratiladi.
- **Xatolar**: a'zo ham, yo'naltiruvchi ham oyat/so'z bo'yicha qo'lda belgilaydi (AI tahlil keyingi bosqich).
- Yangi jadvallar: `supabase/migrations/` ichidagi yangi faylni Run qiling (har yangilanish alohida fayl); `schema.sql` — hammasi birlashgan.
- Arabcha matn saytda quran-json (jsDelivr CDN) dan olinadi.

## v10–v11
- **Oylik reja** (faqat yo'naltiruvchi kiritadi): sahifa soni + boshlanish nuqtasi → reja belgilangan kundan oy oxirigacha (yakshanbasiz) kunlarga bo'linadi; a'zo har kuni qayerdan qayergacha ekanini ko'radi. A'zo reja so'ray olmaydi.
- **AI ovoz tahlili** (hozircha O‘CHIRILGAN, kod saqlangan; yo‘naltiruvchi ovozni o‘zi eshitadi) (ixtiyoriy): a'zo «Tugatdim» da ovozli xabar yuborsa, bot uni Groq Whisper bilan matnga o'giradi va Qur'on matni bilan so'zma-so'z solishtiradi. Tushib qolgan, almashgan, ortiqcha so'zlar yo'naltiruvchiga **taklif** sifatida boradi; u «✅ xato / ❌ xato emas» deb hal qiladi, faqat tasdiqlangani a'zoga xato bo'lib ko'rinadi. Tajvid va talaffuzni baholamaydi.
  - Yoqish: Supabase → Edge Functions → Secrets → `GROQ_API_KEY` (console.groq.com dan bepul kalit). Kalit bo'lmasa, tahlil o'chiq.
  - `schema.sql` ni qayta Run qiling (`mistakes.source` ustuni).

## v12: yopiq bot, savat
- Bot **yopiq**: taklif havolasi olib tashlandi. A'zoni faqat yo'naltiruvchi qo'shadi (Telegram ID + ism + telefon), qo'shilmaganlar botdan foydalana olmaydi (faqat o'z ID'sini ko'radi).
- Yo'naltiruvchi a'zo, hisobot va xatolarni o'chira oladi; hammasi **Savat**da saqlanadi va tiklanadi (bot: «🗑 Savat», sayt: «Savat» bo'limi).
- A'zo hech narsani o'zgartira olmaydi; xato qilsa «✉️ Yo'naltiruvchiga yozish» orqali xabar yuboradi.
- Migratsiya: `supabase/migrations/005_v12.sql`.
