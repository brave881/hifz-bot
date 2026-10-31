-- DIQQAT: eski sinov ma'lumotlari o'chadi (yangi tizim boshqa tuzilma).
drop table if exists reports, goals, sessions, members, circles, logs, groups cascade;

create table circles (
  id         bigint generated always as identity primary key,
  admin_id   bigint not null unique,
  admin_name text   not null,
  name       text   not null default 'Hifz halqasi',
  join_code  text   not null unique,
  view_code  text   not null unique
);

create table members (
  tg_id     bigint primary key,
  circle_id bigint not null references circles(id) on delete cascade,
  name      text   not null,
  joined_at timestamptz not null default now()
);

create table goals (
  tg_id      bigint not null references members(tg_id) on delete cascade,
  week_start date   not null,
  pages      numeric not null,
  primary key (tg_id, week_start)
);

create table reports (
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

create table sessions (
  tg_id bigint primary key,
  state text   not null,
  data  jsonb  not null default '{}'
);

alter table circles  enable row level security;
alter table members  enable row level security;
alter table goals    enable row level security;
alter table reports  enable row level security;
alter table sessions enable row level security;
