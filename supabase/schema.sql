-- =============================================
-- 卓球試合分析アプリ Supabase スキーマ
-- Supabase SQL Editorで実行してください
-- =============================================

-- UUID拡張を有効化
create extension if not exists "uuid-ossp";

-- =============================================
-- 1. clubs（クラブ情報）
-- =============================================
create table public.clubs (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  code        text not null unique,       -- 招待コード（現在アクティブなもの）
  created_at  timestamptz default now()
);

-- =============================================
-- 2. invite_codes（招待コード履歴）
-- =============================================
create table public.invite_codes (
  id          uuid primary key default uuid_generate_v4(),
  club_id     uuid not null references public.clubs(id) on delete cascade,
  code        text not null unique,
  is_active   boolean default true,
  created_by  uuid,                       -- 管理者のuser ID（後からFK追加）
  expires_at  timestamptz,               -- nullなら無期限
  created_at  timestamptz default now()
);

-- =============================================
-- 3. users（クラブメンバー）
-- =============================================
create table public.users (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  name             text not null default '',
  grade            text,                  -- 学年
  club_id          uuid references public.clubs(id) on delete set null,
  role             text not null default 'member', -- 'member' | 'club_admin'
  rubber_forehand  text default '裏ソフト',
  rubber_backhand  text default '裏ソフト',
  created_at       timestamptz default now()
);

-- invite_codes.created_by のFK追加
alter table public.invite_codes
  add constraint fk_invite_codes_created_by
  foreign key (created_by) references public.users(id) on delete set null;

-- =============================================
-- 4. opponents（対戦相手）
-- =============================================
create table public.opponents (
  id               uuid primary key default uuid_generate_v4(),
  club_id          uuid not null references public.clubs(id) on delete cascade,
  name             text not null,
  grade            text,
  team_name_1      text,                  -- 所属チーム1
  team_name_2      text,                  -- 所属チーム2（任意）
  team_name_3      text,                  -- 所属チーム3（任意）
  rubber_forehand  text default '裏ソフト',
  rubber_backhand  text default '裏ソフト',
  is_member        boolean default false, -- 自クラブメンバーをopponentとして設定した場合
  member_user_id   uuid references public.users(id) on delete set null,
  created_at       timestamptz default now()
);

-- =============================================
-- 5. matches（試合記録）
-- =============================================
create table public.matches (
  id            uuid primary key default uuid_generate_v4(),
  club_id       uuid not null references public.clubs(id) on delete cascade,
  video_url     text,                    -- Supabase Storage公開URL
  video_path    text,                   -- Storage内パス（削除用）
  played_at     timestamptz,
  match_type    text not null default 'singles', -- 'singles' | 'doubles'
  frame_status  text not null default 'pending', -- 'pending'|'processing'|'done'|'error'
  created_at    timestamptz default now()
);

-- =============================================
-- 6. match_players（試合の選手割り当て）
-- =============================================
create table public.match_players (
  id               uuid primary key default uuid_generate_v4(),
  match_id         uuid not null references public.matches(id) on delete cascade,
  side             text not null,        -- 'left' | 'right'
  position         integer not null default 1, -- ダブルスの場合 1 or 2
  member_user_id   uuid references public.users(id) on delete set null,
  opponent_id      uuid references public.opponents(id) on delete set null,
  created_at       timestamptz default now(),
  constraint chk_player_type check (
    (member_user_id is not null and opponent_id is null) or
    (member_user_id is null and opponent_id is not null)
  )
);

-- =============================================
-- 7. match_frames（抽出フレーム画像）
-- =============================================
create table public.match_frames (
  id          uuid primary key default uuid_generate_v4(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  frame_time  integer not null,          -- 動画の何秒目か
  image_url   text not null,            -- Supabase Storage URL
  image_path  text not null,            -- Storage内パス
  created_at  timestamptz default now()
);

-- =============================================
-- 8. analysis_results（Claude API分析結果）
-- =============================================
create table public.analysis_results (
  id          uuid primary key default uuid_generate_v4(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  result_json jsonb not null,            -- Claude APIのJSONレスポンス全体
  analyzed_by uuid references public.users(id) on delete set null,
  created_at  timestamptz default now()
);

-- =============================================
-- 9. points（1点ごとのデータ ※将来拡張用）
-- =============================================
create table public.points (
  id          uuid primary key default uuid_generate_v4(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  point_num   integer not null,
  winner_side text,                      -- 'left' | 'right'
  rally_data  jsonb,                     -- ラリー詳細データ（拡張用）
  created_at  timestamptz default now()
);

-- =============================================
-- インデックス
-- =============================================
create index on public.users(club_id);
create index on public.opponents(club_id);
create index on public.matches(club_id);
create index on public.matches(played_at desc);
create index on public.match_players(match_id);
create index on public.match_players(opponent_id);
create index on public.match_frames(match_id);
create index on public.analysis_results(match_id);
create index on public.points(match_id);

-- =============================================
-- Row Level Security (RLS)
-- =============================================
alter table public.clubs enable row level security;
alter table public.invite_codes enable row level security;
alter table public.users enable row level security;
alter table public.opponents enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_frames enable row level security;
alter table public.analysis_results enable row level security;
alter table public.points enable row level security;

-- clubs: 自クラブのみ参照可
create policy "clubs_select" on public.clubs
  for select using (
    id in (select club_id from public.users where id = auth.uid())
  );

-- invite_codes: 招待コードを使った登録のためアノン（未認証）でも code+club_id で参照可
create policy "invite_codes_select_anon" on public.invite_codes
  for select using (true);

create policy "invite_codes_manage" on public.invite_codes
  for all using (
    club_id in (
      select club_id from public.users where id = auth.uid() and role = 'club_admin'
    )
  );

-- users: 自クラブメンバーのみ参照可
create policy "users_select" on public.users
  for select using (
    club_id in (select club_id from public.users where id = auth.uid())
    or id = auth.uid()
  );

create policy "users_update_own" on public.users
  for update using (id = auth.uid());

create policy "users_insert_own" on public.users
  for insert with check (id = auth.uid());

-- 管理者は自クラブメンバーのroleを変更可
create policy "users_update_admin" on public.users
  for update using (
    club_id in (
      select club_id from public.users where id = auth.uid() and role = 'club_admin'
    )
  );

-- opponents: 自クラブのみ
create policy "opponents_all" on public.opponents
  for all using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

-- matches: 自クラブのみ
create policy "matches_all" on public.matches
  for all using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

-- match_players: matchに紐づくものは自クラブ
create policy "match_players_all" on public.match_players
  for all using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- match_frames: matchに紐づくもの
create policy "match_frames_all" on public.match_frames
  for all using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- analysis_results: matchに紐づくもの
create policy "analysis_results_all" on public.analysis_results
  for all using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- points: matchに紐づくもの
create policy "points_all" on public.points
  for all using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- =============================================
-- サンプルクラブ（動作確認用）
-- ※ 本番では削除してください
-- =============================================
-- insert into public.clubs (name, code) values ('細江卓研', 'HOSOI1');
