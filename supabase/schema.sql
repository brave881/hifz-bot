-- 1) JADVALLAR ---------------------------------------------------------
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

-- Bot service_role kaliti bilan ishlaydi, shuning uchun tashqaridan yopamiz
alter table members enable row level security;
alter table logs    enable row level security;

-- 2) AVTOMATIK ESLATMALAR (pg_cron) -----------------------------------
-- Avval: Dashboard > Database > Extensions: pg_cron va pg_net ni yoqing.
-- PROJECT_REF va MAXFIY_SOZ ni o'zingiznikiga almashtiring.
-- Vaqt UTC da: 16:00 UTC = Toshkent 21:00

select cron.schedule('hifz-remind', '0 16 * * *', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/hifz-bot',
    headers := '{"Content-Type":"application/json","x-cron-secret":"MAXFIY_SOZ"}'::jsonb,
    body := '{"action":"remind"}'::jsonb
  );
$$);

-- Juma kuni haftalik natija
select cron.schedule('hifz-weekly', '5 16 * * 5', $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/hifz-bot',
    headers := '{"Content-Type":"application/json","x-cron-secret":"MAXFIY_SOZ"}'::jsonb,
    body := '{"action":"weekly"}'::jsonb
  );
$$);
