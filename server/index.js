const express = require('express')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')
const Anthropic = require('@anthropic-ai/sdk')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')

const app = express()
app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_roleキーを使用（RLSをバイパス）
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// =============================================
// ヘルスチェック
// =============================================
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// =============================================
// POST /extract-frames
// ffmpegで動画から30秒ごとにフレーム抽出
// =============================================
app.post('/extract-frames', async (req, res) => {
  const { matchId, videoPath } = req.body
  if (!matchId || !videoPath) return res.status(400).json({ error: 'matchId and videoPath are required' })

  res.json({ message: 'Frame extraction started' })

  // バックグラウンドで実行
  extractFrames(matchId, videoPath).catch(err => {
    console.error('Frame extraction error:', err)
    supabase.from('matches').update({ frame_status: 'error' }).eq('id', matchId)
  })
})

async function extractFrames(matchId, videoPath) {
  // 処理中に更新
  await supabase.from('matches').update({ frame_status: 'processing' }).eq('id', matchId)

  // 動画を一時ファイルにダウンロード
  const { data: signedData } = await supabase.storage
    .from('match-videos')
    .createSignedUrl(videoPath, 3600)
  if (!signedData?.signedUrl) throw new Error('Failed to get signed URL')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingpong-'))
  const videoFile = path.join(tmpDir, 'video.mp4')
  const framesDir = path.join(tmpDir, 'frames')
  fs.mkdirSync(framesDir)

  await downloadFile(signedData.signedUrl, videoFile)

  // ffmpegで動画の長さを取得し、30秒ごとにフレーム抽出（最大20枚）
  const duration = await getVideoDuration(videoFile)
  const interval = Math.max(30, Math.ceil(duration / 20))
  const frameTimes = []
  for (let t = 0; t < duration; t += interval) frameTimes.push(Math.floor(t))

  // 各フレームを抽出
  for (const t of frameTimes) {
    const framePath = path.join(framesDir, `frame_${t}.jpg`)
    await extractSingleFrame(videoFile, framePath, t)

    // Supabase Storageにアップロード
    const storagePath = `${matchId}/frame_${t}.jpg`
    const fileBuffer = fs.readFileSync(framePath)
    const { error: uploadErr } = await supabase.storage
      .from('match-frames')
      .upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: true })

    if (!uploadErr) {
      const { data: { publicUrl } } = supabase.storage.from('match-frames').getPublicUrl(storagePath)
      await supabase.from('match_frames').insert({
        match_id: matchId,
        frame_time: t,
        image_url: publicUrl,
        image_path: storagePath,
      })
    }
  }

  // 完了に更新（Realtimeでフロントに通知される）
  await supabase.from('matches').update({ frame_status: 'done' }).eq('id', matchId)

  // 一時ファイルを削除
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// =============================================
// POST /analyze
// Claude APIで試合分析
// =============================================
app.post('/analyze', async (req, res) => {
  const { matchId, userId } = req.body
  if (!matchId) return res.status(400).json({ error: 'matchId is required' })

  try {
    // フレーム画像を取得（最大20枚）
    const { data: frames } = await supabase
      .from('match_frames')
      .select('*')
      .eq('match_id', matchId)
      .order('frame_time')
      .limit(20)

    // 選手情報を取得
    const { data: players } = await supabase
      .from('match_players')
      .select('*, users:member_user_id(name, grade, rubber_forehand, rubber_backhand), opponents:opponent_id(name, grade, rubber_forehand, rubber_backhand, team_name_1, team_name_2, team_name_3)')
      .eq('match_id', matchId)

    // 試合情報
    const { data: match } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single()

    // このmatchに登場するopponentの過去の分析結果を取得
    const opponentIds = players
      ?.filter(p => p.opponent_id)
      .map(p => p.opponent_id) ?? []

    let pastAnalyses = []
    if (opponentIds.length > 0) {
      const { data: pastMatches } = await supabase
        .from('match_players')
        .select('match_id')
        .in('opponent_id', opponentIds)
        .neq('match_id', matchId)

      if (pastMatches?.length > 0) {
        const pastMatchIds = [...new Set(pastMatches.map(pm => pm.match_id))]
        const { data: pa } = await supabase
          .from('analysis_results')
          .select('result_json, created_at')
          .in('match_id', pastMatchIds)
          .order('created_at', { ascending: false })
          .limit(3)
        pastAnalyses = pa ?? []
      }
    }

    // 自分が出場したかどうか
    const selfPlayer = players?.find(p => p.member_user_id === userId)

    // Claude APIに送るメッセージを構築
    const content = []

    // 選手情報テキスト生成
    const playersInfo = players?.map(p => {
      const person = p.users ?? p.opponents
      const teams = p.opponents ? [p.opponents.team_name_1, p.opponents.team_name_2, p.opponents.team_name_3].filter(Boolean).join('/') : ''
      return [
        `【${p.side === 'left' ? '左側' : '右側'}${p.position}番】${person?.name ?? '不明'}`,
        `  利き手: ${person?.handedness ?? '不明'}`,
        `  フォアラバー: ${person?.rubber_forehand ?? '不明'}`,
        `  バックラバー: ${person?.rubber_backhand ?? '不明'}`,
        `  学年: ${person?.grade ?? '不明'}`,
        teams ? `  所属: ${teams}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n')

    // コーチメモ
    const coachMemoText = match?.coach_memo
      ? `\n【コーチ・本人メモ】\n${match.coach_memo}\n` : ''

    // 過去分析
    const pastText = pastAnalyses.length > 0
      ? `【過去の分析結果（直近${pastAnalyses.length}回）】\n${pastAnalyses.map((pa, i) => `--- 過去${i+1}回目 (${new Date(pa.created_at).toLocaleDateString('ja-JP')}) ---\n${JSON.stringify(pa.result_json, null, 2)}`).join('\n\n')}\n`
      : ''

    content.push({
      type: 'text',
      text: `あなたは日本の卓球専門コーチです。以下の試合フレーム画像を詳細に分析し、指定のJSON形式のみで回答してください。

【試合基本情報】
- 試合形式: ${match?.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
- 日時: ${match?.played_at ? new Date(match.played_at).toLocaleString('ja-JP') : '不明'}

【選手情報】
${playersInfo}
${coachMemoText}
${pastText}
${selfPlayer ? '※ 分析依頼者が出場しています。selfTasksには具体的な改善課題を記載してください。' : ''}
${pastAnalyses.length > 0 ? '※ 過去の分析と比較し、変化・改善・悪化をdiffFromLastTimeに記載してください。' : ''}

【分析指示】
フレーム画像から以下を詳しく読み取ってください：

1. サーブ回転の判定（重要）:
   - ラケット面の角度（前向き=下回転、上向き=上回転、横=横回転）
   - スイング方向（下から上=上回転、上から下=下回転、横=横回転）
   - インパクト位置（ラバー面のどこで当てているか）
   - トスの高さと位置
   ※ 断定できない場合は「〇〇回転の可能性が高い」と表記

2. コース分析:
   - フォア前・バック前・ミドル・ロング
   - クロス or ストレート
   - 短い or 長い

3. 得点パターン:
   - どのような展開で得点しているか
   - どのような場面でミスしているか
   - ミスの原因（体勢・タイミング・コース判断など）

4. フォーム・動き:
   - 構えの特徴
   - フットワークのパターン
   - バックスイングの大きさ・速さ

以下のJSON形式のみで回答してください（他の文字は一切含めないこと）：
{
  "serveAnalysis": {
    "types": ["確認されたサーブの種類（例：下回転ショートサーブ、横回転ロングサーブ等）"],
    "spinDetails": "回転の詳細（ラケット角度・スイング方向から判定した根拠も含める）",
    "favoriteServe": "最も多く使っているサーブ",
    "coursePattern": "サーブコースのパターン（フォア前多め・ミドル多め等）",
    "counterStrategy": "このサーブに対する有効なレシーブ戦略"
  },
  "scoringPattern": {
    "howTheyScore": "どのような展開・技術で得点しているか",
    "howTheyLose": "どのような場面でミスや失点しているか",
    "missReasons": "ミスの主な原因（体勢・タイミング・コース判断・ラバー特性等）",
    "rallyTendency": "ラリーの傾向（早いテンポ/遅いテンポ、強打多め/つなぎ多め等）"
  },
  "weaknesses": "弱点の詳細（具体的な技術・体勢・コース・心理面）",
  "habits": "プレーの癖・傾向（フォーム・動き方・特定状況でのパターン）",
  "attackDefensePattern": "攻守のパターン（どんな状況で攻めるか守るか、3球目攻撃の有無等）",
  "gamePlan": {
    "early": "序盤の戦略（サーブ選択・レシーブ戦略）",
    "mid": "中盤の戦略（ラリー展開・コース選択）",
    "late": "終盤・デュース時の戦略"
  },
  "winLoseFactor": "この試合の勝因または敗因（具体的な場面・技術レベルで）",
  "selfTasks": ${selfPlayer ? '"自分の具体的な改善課題と練習方法の提案（出場者向け）"' : 'null'},
  "diffFromLastTime": ${pastAnalyses.length > 0 ? '"前回の分析との比較（改善点・悪化点・新たに発見した癖）"' : 'null'}
}`
    })

    // フレーム画像を追加（最大20枚）
    for (const frame of frames ?? []) {
      try {
        const imgData = await fetchImageAsBase64(frame.image_url)
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imgData },
        })
        content.push({
          type: 'text',
          text: `↑ 動画の${frame.frame_time}秒時点のフレーム`
        })
      } catch (e) {
        console.warn(`Failed to fetch frame ${frame.frame_time}:`, e.message)
      }
    }

    // Claude API呼び出し
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    })

    // JSONパース
    const rawText = message.content[0]?.text ?? '{}'
    let resultJson
    try {
      // JSON部分を抽出
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      resultJson = JSON.parse(jsonMatch?.[0] ?? rawText)
    } catch {
      resultJson = { raw: rawText }
    }

    // DBに保存
    const { data: saved, error: saveErr } = await supabase
      .from('analysis_results')
      .insert({ match_id: matchId, result_json: resultJson, analyzed_by: userId })
      .select()
      .single()

    if (saveErr) throw saveErr

    res.json({ success: true, analysisId: saved.id, result: resultJson })
  } catch (err) {
    console.error('Analysis error:', err)
    res.status(500).json({ error: err.message })
  }
})

// =============================================
// ユーティリティ関数
// =============================================
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    proto.get(url, res => {
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', reject)
  })
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err)
      else resolve(metadata.format.duration ?? 0)
    })
  })
}

function extractSingleFrame(videoPath, outputPath, timeInSeconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timeInSeconds)
      .frames(1)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
}

function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    proto.get(url, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')))
      res.on('error', reject)
    }).on('error', reject)
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
