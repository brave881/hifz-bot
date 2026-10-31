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
