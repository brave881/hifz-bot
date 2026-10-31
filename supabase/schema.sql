-- Jadvallar (SQL Editor'da bir marta Run qiling)
create table if not exists members (
  chat_id     bigint not null,
  tg_id       bigint not null,
  name        text   not null,
  daily_goal  int    not null default 5,
  streak      int    not null default 0,
  best_streak int    not null default 0,
  total_days  int    not null default 0,
  last_date   date,
  primary key (chat_id, tg_id)
);

create table if not exists logs (
  chat_id bigint not null,
  tg_id   bigint not null,
  day     date   not null,
  primary key (chat_id, tg_id, day)
);

-- sayt havolasi uchun guruh kodi
create table if not exists groups (
  chat_id bigint primary key,
  code    text   not null unique
);

alter table members enable row level security;
alter table logs    enable row level security;
alter table groups  enable row level security;
