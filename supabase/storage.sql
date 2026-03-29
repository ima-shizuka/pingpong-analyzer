-- =============================================
-- Supabase Storage バケット設定
-- Supabase SQL Editorで実行してください
-- =============================================

-- 試合動画バケット（非公開）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-videos',
  'match-videos',
  false,                    -- 署名付きURLでアクセス
  629145600,                -- 600MB
  array['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg']
)
on conflict (id) do nothing;

-- フレーム画像バケット（公開）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-frames',
  'match-frames',
  true,                     -- 公開URL
  5242880,                  -- 5MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- =============================================
-- Storage RLSポリシー
-- =============================================

-- match-videos: 自クラブのフォルダのみ操作可
create policy "match_videos_upload" on storage.objects
  for insert with check (
    bucket_id = 'match-videos' and
    (storage.foldername(name))[1] in (
      select club_id::text from public.users where id = auth.uid()
    )
  );

create policy "match_videos_read" on storage.objects
  for select using (
    bucket_id = 'match-videos' and
    (storage.foldername(name))[1] in (
      select club_id::text from public.users where id = auth.uid()
    )
  );

create policy "match_videos_delete" on storage.objects
  for delete using (
    bucket_id = 'match-videos' and
    (storage.foldername(name))[1] in (
      select club_id::text from public.users where id = auth.uid()
    )
  );

-- match-frames: 認証済みユーザーなら読み取り可（公開バケットのため任意）
create policy "match_frames_read" on storage.objects
  for select using (bucket_id = 'match-frames');

-- match-frames: サーバー（service_role）のみ書き込み可 → service_roleはRLSをバイパスするため設定不要
