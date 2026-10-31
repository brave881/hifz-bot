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
