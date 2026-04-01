-- =============================================
-- 学習材料テーブル（サーブ回転ヒント）
-- =============================================
create table if not exists public.serve_hints (
  id          uuid primary key default uuid_generate_v4(),
  club_id     uuid references public.clubs(id) on delete cascade,
  serve_type  text not null,      -- 例: 下回転ショートサーブ
  spin_type   text not null,      -- 上回転/下回転/横回転（右）/横回転（左）/ナックル
  racket_angle text,              -- ラケットの角度の説明
  swing_direction text,           -- スイング方向の説明
  receive_reaction text,          -- 受けた時の典型的な反応
  counter_strategy text,          -- 有効なレシーブ戦略
  notes       text,               -- 補足メモ
  created_by  uuid references public.users(id),
  created_at  timestamptz default now()
);

alter table public.serve_hints enable row level security;

create policy "serve_hints_all" on public.serve_hints
  for all using (club_id = public.my_club_id())
  with check (club_id = public.my_club_id());

-- =============================================
-- サンプルデータ（一般的な卓球の回転ヒント）
-- club_idは実際のIDに変更してください
-- =============================================
-- insert into public.serve_hints (club_id, serve_type, spin_type, racket_angle, swing_direction, receive_reaction, counter_strategy)
-- select id, '下回転サーブ', '下回転', 'ラケット面が下向き（約45度）', '上から下へスイング', 'レシーブがネットに引っかかりやすい', 'ツッツキで返球。持ち上げすぎない'
-- from public.clubs limit 1;
