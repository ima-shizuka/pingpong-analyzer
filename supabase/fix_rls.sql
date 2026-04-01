-- =============================================
-- RLSポリシー修正（保存・登録が動かない問題の修正）
-- Supabase SQL Editorで実行してください
-- =============================================

-- ① usersテーブルの更新ポリシーを修正
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_update_admin" on public.users;

create policy "users_update_own" on public.users
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users_update_admin" on public.users
  for update
  using (
    club_id in (
      select club_id from public.users where id = auth.uid() and role = 'club_admin'
    )
  )
  with check (
    club_id in (
      select club_id from public.users where id = auth.uid() and role = 'club_admin'
    )
  );

-- ② opponentsテーブルのポリシーをSELECT/INSERT/UPDATE/DELETEに分割
drop policy if exists "opponents_all" on public.opponents;

create policy "opponents_select" on public.opponents
  for select
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "opponents_insert" on public.opponents
  for insert
  with check (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "opponents_update" on public.opponents
  for update
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  )
  with check (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "opponents_delete" on public.opponents
  for delete
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

-- ③ matchesテーブルも同様に修正
drop policy if exists "matches_all" on public.matches;

create policy "matches_select" on public.matches
  for select
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "matches_insert" on public.matches
  for insert
  with check (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "matches_update" on public.matches
  for update
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  )
  with check (
    club_id in (select club_id from public.users where id = auth.uid())
  );

create policy "matches_delete" on public.matches
  for delete
  using (
    club_id in (select club_id from public.users where id = auth.uid())
  );

-- ④ match_playersも修正
drop policy if exists "match_players_all" on public.match_players;

create policy "match_players_select" on public.match_players
  for select
  using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

create policy "match_players_insert" on public.match_players
  for insert
  with check (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

create policy "match_players_delete" on public.match_players
  for delete
  using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- ⑤ analysis_resultsも修正
drop policy if exists "analysis_results_all" on public.analysis_results;

create policy "analysis_results_select" on public.analysis_results
  for select
  using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

create policy "analysis_results_insert" on public.analysis_results
  for insert
  with check (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

-- ⑥ pointsも修正
drop policy if exists "points_all" on public.points;

create policy "points_select" on public.points
  for select
  using (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );

create policy "points_insert" on public.points
  for insert
  with check (
    match_id in (
      select id from public.matches
      where club_id in (select club_id from public.users where id = auth.uid())
    )
  );
