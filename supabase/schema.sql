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
