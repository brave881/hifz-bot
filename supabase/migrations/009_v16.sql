-- v16: fazilat eslatmalari (oyat / hadis / ulamo so'zi), ertalabki eslatma vaqti
create table if not exists virtues (
  id         bigserial primary key,
  circle_id  bigint,                          -- null = hamma halqalar uchun (boshlang'ich to'plam)
  kind       text   not null default 'hadith', -- ayah | hadith | scholar
  body       text   not null,
  source     text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table virtues enable row level security;

alter table circles add column if not exists morning_hour smallint not null default 8; -- Toshkent vaqti bilan, 0..23
alter table circles add column if not exists last_morning date;

-- Boshlang'ich to'plam. Tarjimalarni ishonchli ustoz bilan tekshirib chiqing; admin o'zgartira/o'chira oladi.
insert into virtues (circle_id, kind, body, source)
select null, v.kind, v.body, v.source from (values
  ('hadith', 'Sizlarning eng yaxshingiz — Qur''onni o''rganib, uni o''rgatgan kishingizdir.', 'Buxoriy, 5027'),
  ('hadith', 'Qur''onni mohirlik bilan o''qiydigan kishi ulug'' va itoatkor elchi farishtalar bilan birgadir. Qur''onni duduqlanib, qiynalib o''qiydigan kishiga esa ikki ajr bor.', 'Buxoriy, Muslim'),
  ('hadith', 'Kim Allohning Kitobidan bir harf o''qisa, unga bir hasana bor, hasana esa o''n barobar qilib yoziladi.', 'Termiziy, 2910'),
  ('hadith', 'Ichida Qur''ondan hech narsa bo''lmagan odam xarob uy kabidir.', 'Termiziy, 2913'),
  ('hadith', 'Qur''on o''qinglar, chunki u qiyomat kuni o''z egalariga shafoatchi bo''lib keladi.', 'Muslim, 804'),
  ('hadith', 'Qur''on egasiga: «O''qi va yuksal, dunyoda tartil bilan o''qiganingdek tartil bilan o''qi. Sening manzilging o''qigan oxirgi oyatingdadir», deyiladi.', 'Abu Dovud, Termiziy'),
  ('hadith', 'Qur''onni doimiy takrorlab turinglar. Jonim qo''lida bo''lgan Zotga qasamki, u tuyaning bog''ichidan qochishidan ham tezroq (yoddan) chiqib ketadi.', 'Buxoriy, Muslim'),
  ('ayah', 'Biz Qur''onni zikr uchun oson qildik. Bas, eslab oluvchi bormi?', 'Qamar surasi, 17-oyat'),
  ('ayah', 'Albatta, Zikrni (Qur''onni) Biz nozil qildik va Biz uni albatta saqlovchimiz.', 'Hijr surasi, 9-oyat'),
  ('ayah', 'Albatta, Alloh Kitobini tilovat qiladiganlar, namozni to''kis ado etadiganlar va Biz rizq qilib bergan narsalardan yashirin va oshkora infoq qiladiganlar hech zarar ko''rmaydigan savdoni umid qiladilar.', 'Fotir surasi, 29-oyat'),
  ('ayah', 'Rabbim, ilmimni ziyoda qil.', 'Toha surasi, 114-oyat')
) as v(kind, body, source)
where not exists (select 1 from virtues);
