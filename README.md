# Hifz Tracker

Quron yodlash guruhi uchun Telegram bot + sayt.

- bot va API: supabase/functions/hifz-bot
- sayt: docs/ (GitHub Pages)

## v9: batafsil reja, jonli yodlash, xatolar
- **Reja**: a'zo boshlanish nuqtasini (sura/oyat yoki bet, oldinga/orqaga) o'zi tanlaydi. Bot hafta oralig'ini, kunlik oyatlar oralig'ini, oxirgi yodlangan joyni, qolganini, o'rtacha tezlik va tugash sanasini hisoblaydi (Madina mushafi, 604 bet).
- **Jonli yodlash**: «▶️ Boshladim / ⏹ Tugatdim», vaqt oralig'i (bomdoddan keyin / xufton / boshqa), hamma ko'radi va xabar oladi. Tugatganda oraliq + ovoz yo'naltiruvchiga ketadi va avtomatik hisobot yaratiladi.
- **Xatolar**: a'zo ham, yo'naltiruvchi ham oyat/so'z bo'yicha qo'lda belgilaydi (AI tahlil keyingi bosqich).
- Yangi jadvallar uchun `supabase/schema.sql` ni qayta Run qiling (xavfsiz, takrorlansa zarar qilmaydi).
- Arabcha matn saytda quran-json (jsDelivr CDN) dan olinadi.
