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
