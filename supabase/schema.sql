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
