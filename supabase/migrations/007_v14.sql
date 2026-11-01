-- v14: dam kuni admin tomonidan belgilanadi (0=yakshanba, 1=dushanba ... 6=shanba)
alter table circles add column if not exists rest_day smallint not null default 0;
