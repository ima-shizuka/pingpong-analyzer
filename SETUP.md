# セットアップ手順

## 1. Supabaseプロジェクトの準備

1. [supabase.com](https://supabase.com) でプロジェクト作成
2. SQL Editor で以下を順番に実行：
   - `supabase/schema.sql`（テーブル・RLS作成）
   - `supabase/storage.sql`（Storageバケット作成）
3. **サンプルクラブを作成**（SQL Editorで実行）：
   ```sql
   insert into public.clubs (name, code) values ('あなたのクラブ名', 'XXXX01');
   ```
4. Project Settings → API から以下をコピー：
   - Project URL
   - anon public key
   - service_role key（サーバー用）

## 2. フロントエンドの設定

```bash
cd pingpong-analyzer
cp .env.template .env.local
# .env.local を編集してSupabaseの値を設定
npm install
npm run dev
```

## 3. Renderサーバーのデプロイ

1. `server/` フォルダを別のGitHubリポジトリにpush（またはmonorepoのまま）
2. [render.com](https://render.com) でNew Web Serviceを作成
3. 環境変数を設定：
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`（service_roleキー）
   - `ANTHROPIC_API_KEY`
4. デプロイ後のURLを `.env.local` の `VITE_RENDER_API_URL` に設定

## 4. Vercelデプロイ

```bash
npm run build
# Vercelにデプロイ（vercel CLIまたはGitHub連携）
# 環境変数（VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_RENDER_API_URL）を設定
```

## 5. 最初の管理者ユーザーを設定

新規登録後、SQL Editorで実行：
```sql
update public.users
set role = 'club_admin'
where email = 'あなたのメールアドレス';
```

## 実装済み機能

### Phase 1
- [x] Supabaseセットアップ（.envテンプレート）
- [x] メール＋パスワード認証
- [x] クラブコード制（招待制）
- [x] ダッシュボード
- [x] DBテーブル設計（全9テーブル）
- [x] プロフィール設定画面

### Phase 2: 対戦相手管理
- [x] 相手選手の登録（名前・チーム名×3・学年・ラバー）
- [x] 相手一覧（検索・フィルター）
- [x] 相手詳細（過去の対戦履歴表示枠）
- [x] 自クラブメンバーを相手として選択

### Phase 2.5: 動画アップロード
- [x] 動画アップロード（Supabase Storage）
- [x] アップロード進捗バー
- [x] シングルス/ダブルス選択
- [x] 選手割り当て（左/右・ペア）
- [x] Renderサーバーでffmpegフレーム抽出（30秒ごと、最大20枚）
- [x] Supabase Realtimeで抽出完了をフロントに通知

### Phase 3: AI分析
- [x] Claude API（claude-sonnet-4-20250514）による分析
- [x] フレーム画像（最大20枚）+ 選手情報 + 過去の分析を入力
- [x] 8項目のJSON出力（弱点・サーブ・攻守・ゲームプラン・癖・勝敗因・自分の課題・前回差分）
- [x] タブ切り替えで各項目表示
- [x] 過去の分析との比較ビュー

### Phase 4: 管理者機能
- [x] club_adminロール
- [x] 招待コード発行・有効/無効管理
- [x] メンバー一覧・権限変更
