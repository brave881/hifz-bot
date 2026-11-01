# Migratsiyalar

Har yangilanish alohida fayl. Hammasi takrorlansa ham zarar qilmaydi (idempotent).

- Yangi o'rnatish: `../schema.sql` ni bir marta Run qiling (hammasi birlashgan).
- Yangilash: faqat hali ishga tushirmagan fayllarni tartib bilan Run qiling (SQL Editor).

| Fayl | Nima qo'shadi |
| --- | --- |
| `001_asos_v1-v8.sql` | asosiy jadvallar |
| `002_v9.sql` | yangi jadvallar/ustunlar |
| `003_v10.sql` | yangi jadvallar/ustunlar |
| `004_v11.sql` | yangi jadvallar/ustunlar |
| `005_v12.sql` | a'zo telefoni, savat |
| `006_v13.sql` | audit (tuzatish tarixi) |
| `007_v14.sql` | dam kuni sozlamasi |
