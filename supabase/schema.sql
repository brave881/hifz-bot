-- Xavfsiz: qayta Run qilsangiz ma'lumotlar o'chmaydi.
-- Faqat eng eski (guruh) tuzilmasi bo'lsa, o'sha sinov jadvallari o'chadi.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'members')
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'members' and column_name = 'circle_id') then
    drop table if exists logs, groups, members cascade;
  end if;
end $$;

create table if not exists circles (
  id         bigint generated always as identity primary key,
  admin_id   bigint not null unique,
  admin_name text   not null,
  name       text   not null default 'Hifz halqasi',
  join_code  text   not null unique,
  view_code  text   not null unique
);

create table if not exists members (
  tg_id     bigint primary key,
  circle_id bigint not null references circles(id) on delete cascade,
  name      text   not null,
  joined_at timestamptz not null default now()
);

create table if not exists goals (
  tg_id      bigint not null references members(tg_id) on delete cascade,
  week_start date   not null,
  pages      numeric not null,
  primary key (tg_id, week_start)
);

create table if not exists reports (
  id         bigint generated always as identity primary key,
  tg_id      bigint not null references members(tg_id) on delete cascade,
  circle_id  bigint not null,
  week_start date   not null,
  day        date   not null,
  pages      numeric not null,
  status     text   not null default 'pending', -- pending | approved | repeat
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists sessions (
  tg_id bigint primary key,
  state text   not null,
  data  jsonb  not null default '{}'
);

-- yillik reja (juz) va oylik qo'lda belgilangan maqsad
create table if not exists plans (
  tg_id      bigint primary key references members(tg_id) on delete cascade,
  juz        numeric not null,
  start_date date    not null,
  weeks      int     not null default 52
);

create table if not exists month_goals (
  tg_id bigint not null references members(tg_id) on delete cascade,
  month text   not null, -- YYYY-MM
  pages numeric not null,
  primary key (tg_id, month)
);

alter table circles      enable row level security;
alter table members      enable row level security;
alter table goals        enable row level security;
alter table reports      enable row level security;
alter table sessions     enable row level security;
alter table plans        enable row level security;
alter table month_goals  enable row level security;

-- ===== v9: batafsil reja, jonli yodlash, xatolar =====
-- a'zoning joriy nuqtasi: ptr = keyingi yodlanadigan oyat (global raqam 1..6236)
-- dir=1 oldinga (ptr blokning boshi), dir=-1 orqaga (ptr blokning oxirgi oyati)
create table if not exists positions (
  tg_id      bigint primary key,
  ptr        int not null,
  dir        int not null default 1,
  start_ayah int not null,
  week_start date,
  week_ptr   int,
  updated_at timestamptz not null default now()
);

create table if not exists study_sessions (
  id         bigserial primary key,
  tg_id      bigint not null,
  circle_id  bigint not null,
  slot       text   not null default 'other',
  started_at timestamptz not null default now(),
  win_from   text,
  win_to     text,
  ended_at   timestamptz,
  status     text   not null default 'live',
  from_ayah  int,
  to_ayah    int,
  pages      numeric,
  voice_file text,
  report_id  bigint
);
create index if not exists study_sessions_circle_idx on study_sessions (circle_id, status, started_at desc);

create table if not exists mistakes (
  id         bigserial primary key,
  tg_id      bigint not null,
  circle_id  bigint not null,
  by_id      bigint not null,
  ayah       int    not null,
  word       int,
  kind       text   not null default 'other',
  note       text,
  session_id bigint,
  status     text   not null default 'open',
  created_at timestamptz not null default now(),
  fixed_at   timestamptz
);
create index if not exists mistakes_member_idx on mistakes (tg_id, status);

alter table positions      enable row level security;
alter table study_sessions enable row level security;
alter table mistakes       enable row level security;

-- ===== v10: oylik reja (admin kiritadi, kunlarga bo'linadi) =====
create table if not exists month_plans (
  tg_id      bigint not null,
  month      text   not null,           -- YYYY-MM
  pages      numeric not null,          -- oy uchun jami sahifa
  start_ayah int    not null,           -- boshlanish oyati (global raqam 1..6236)
  dir        int    not null default 1, -- 1 oldinga, -1 orqaga
  from_date  date   not null,           -- reja belgilangan kun (kunlarga bo'lish shundan boshlanadi)
  set_by     bigint,
  created_at timestamptz not null default now(),
  primary key (tg_id, month)
);
alter table month_plans enable row level security;

-- ===== v11: AI tahlil =====
-- source: 'manual' (qo'lda) yoki 'ai' (ovoz tahlili); status: open | fixed | suggested (AI taklifi, admin tasdig'ini kutadi) | rejected
alter table mistakes add column if not exists source text not null default 'manual';
-- ===== v12: a'zoni admin qo'shadi (telefon), savat (o'chirilganlarni ko'rish/tiklash) =====
alter table members add column if not exists phone text;

create table if not exists trash (
  id          bigserial primary key,
  circle_id   bigint not null,
  kind        text   not null,           -- member | report | mistake
  label       text,
  data        jsonb  not null,
  deleted_by  bigint,
  deleted_at  timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists trash_circle_idx on trash (circle_id, restored_at, deleted_at desc);
alter table trash enable row level security;
-- ===== v13: tahrirlash tarixi (audit): admin o'zgartirgan statistikani kuzatish va qaytarish =====
create table if not exists audit (
  id         bigserial primary key,
  circle_id  bigint not null,
  actor      bigint not null,
  member_id  bigint,
  action     text   not null,      -- report_edit | report_add | goal_set | goal_clear | month_plan | year_plan
  tbl        text   not null,
  row_key    jsonb  not null,      -- qaysi qator (masalan {"id":12})
  old_row    jsonb,                -- avvalgi holat (null = oldin yo'q edi)
  new_row    jsonb,                -- yangi holat (null = o'chirildi)
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
create index if not exists audit_circle_idx on audit (circle_id, member_id, created_at desc);
alter table audit enable row level security;
-- v14: dam kuni admin tomonidan belgilanadi (0=yakshanba, 1=dushanba ... 6=shanba)
alter table circles add column if not exists rest_day smallint not null default 0;
-- v15: takror (revision) hisobi, sozlamalar (takror normasi, sovrin), oylik natijalar
create table if not exists revisions (
  id         bigserial primary key,
  tg_id      bigint  not null,
  circle_id  bigint  not null,
  day        date    not null,
  pages      numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists revisions_tg_day_idx on revisions (tg_id, day);
alter table revisions enable row level security;

alter table circles add column if not exists rev_daily numeric not null default 5; -- kuniga takror normasi (sahifa)
alter table circles add column if not exists prize     text;                       -- oylik sovrin (admin yozadi)

create table if not exists month_awards (
  circle_id bigint not null,
  month     text   not null,   -- YYYY-MM
  result    jsonb  not null,
  sent_at   timestamptz not null default now(),
  primary key (circle_id, month)
);
alter table month_awards enable row level security;

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

-- v16b: qo'shimcha fazilatlar (oyat, hadis, ulamo so'zlari). Takror ishga tushirilsa ikki marta qo'shilmaydi.
insert into virtues (circle_id, kind, body, source)
select null, v.kind, v.body, v.source from (values
  ('hadith', 'Alloh uchun odamlardan ahllar bor. — «Ey Allohning elchisi, ular kimlar?» — «Qur''on ahli: ular Allohning ahli va Unga xos bandalaridir», dedi.', 'Ibn Moja, 215 (Anas roziyallohu anhu); isnodi sahih deb baholangan'),
  ('hadith', 'Qaysi bir qavm Allohning uylaridan birida to''planib, Allohning Kitobini tilovat qilsa va uni o''zaro o''rgansa, ularga sakina tushadi, rahmat o''rab oladi, farishtalar qurshab oladi va Alloh ularni huzuridagilar orasida eslaydi.', 'Muslim, 2699'),
  ('hadith', 'Albatta, Alloh bu Kitob (Qur''on) sabab ba''zi qavmlarni ko''taradi, boshqalarini esa tushiradi.', 'Muslim, 817'),
  ('hadith', 'Faqat ikki kishiga havas qilinadi: Alloh unga Qur''on bergan, u kecha-kunduz uni (tilovat qilib, unga amal qilib) turgan kishi va (ikkinchisi) mol berilib, uni kecha-kunduz Alloh yo''lida sarflab turgan kishi.', 'Buxoriy, Muslim'),
  ('ayah', 'Qur''onni tartil bilan (shoshilmay, ravshan) o''qi.', 'Muzzammil surasi, 4-oyat'),
  ('ayah', 'Aslida u (Qur''on) ilm berilgan kishilarning ko''ksidagi ravshan oyatlardir.', 'Ankabut surasi, 49-oyat'),
  ('ayah', 'Albatta, uni (qalbingda) jam qilish va (tilingda) o''qitish Bizning zimmamizdadir.', 'Qiyoma surasi, 17-oyat'),
  ('ayah', 'Bilingki, qalblar faqat Allohning zikri bilan xotirjam bo''ladi.', 'Ra''d surasi, 28-oyat'),
  ('ayah', 'Albatta, bu Qur''on eng to''g''ri yo''lga yo''llaydi va yaxshi amallar qiladigan mo''minlarga katta ajr borligini xushxabar qiladi.', 'Isro surasi, 9-oyat'),
  ('scholar', 'Qur''on hamili odamlar uxlab yotganda kechasi bilan, odamlar yeb-ichib yurganda kunduzi bilan tanilishi kerak: odamlar xursand bo''lganda g''amgin, odamlar kulganda yig''loq, odamlar behuda gapirganda sukutli, odamlar kibrlanganda xokisor bo''lishi lozim.', 'Abdulloh ibn Mas''ud roziyallohu anhu; Ahmad, «az-Zuhd», 892 (ma''noviy tarjima)'),
  ('scholar', 'Sizdan oldingilar Qur''onni Robbilaridan kelgan maktub deb bilardilar: kechasi uni mulohaza qilardilar, kunduzi unga amal qilardilar.', 'Hasan Basriy rahimahulloh; Imom Navaviy, «at-Tibyon» (ma''noviy tarjima)'),
  ('scholar', 'Qur''on hamili Islom bayrog''ini ko''taruvchidir. Unga bekorchilar bilan birga bekor gap qilish yarashmaydi.', 'Fudayl ibn Iyoz rahimahulloh; Ajurriy, «Axloqu hamalatil Qur''on», 37 (ma''noviy tarjima)'),
  ('scholar', 'Qur''on hamilining na xalifaga, na undan pastdagi kimsaga hojati bo''lmasligi kerak.', 'Fudayl ibn Iyoz rahimahulloh; Abu Nuaym, «Hilyatul avliyo», 8/92 (ma''noviy tarjima)')
) as v(kind, body, source)
where not exists (select 1 from virtues x where x.body = v.body);
