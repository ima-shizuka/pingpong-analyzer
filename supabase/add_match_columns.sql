-- =============================================
-- matchesテーブルに追加カラム
-- =============================================
alter table public.matches
  add column if not exists coach_memo    text,
  add column if not exists video_ref_url text;
