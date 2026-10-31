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
