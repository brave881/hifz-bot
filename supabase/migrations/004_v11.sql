-- ===== v11: AI tahlil =====
-- source: 'manual' (qo'lda) yoki 'ai' (ovoz tahlili); status: open | fixed | suggested (AI taklifi, admin tasdig'ini kutadi) | rejected
alter table mistakes add column if not exists source text not null default 'manual';
