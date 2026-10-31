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
