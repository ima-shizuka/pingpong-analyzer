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

    // ── 過去の対戦分析を取得（相手・自分両方）──────────────
    const opponentIds = players?.filter(p => p.opponent_id).map(p => p.opponent_id) ?? []
    const memberIds   = players?.filter(p => p.member_user_id).map(p => p.member_user_id) ?? []

    // 相手の過去分析
    let opponentPastAnalyses = []
    if (opponentIds.length > 0) {
      const { data: pastMatches } = await supabase
        .from('match_players').select('match_id')
        .in('opponent_id', opponentIds).neq('match_id', matchId)
      if (pastMatches?.length > 0) {
        const ids = [...new Set(pastMatches.map(pm => pm.match_id))]
        const { data: pa } = await supabase
          .from('analysis_results').select('result_json, created_at')
          .in('match_id', ids).order('created_at', { ascending: false }).limit(3)
        opponentPastAnalyses = pa ?? []
      }
    }

    // 自クラブメンバーの過去分析（自分自身の成長確認）
    let memberPastAnalyses = []
    if (memberIds.length > 0) {
      const { data: pastMatches } = await supabase
        .from('match_players').select('match_id')
        .in('member_user_id', memberIds).neq('match_id', matchId)
      if (pastMatches?.length > 0) {
        const ids = [...new Set(pastMatches.map(pm => pm.match_id))]
        const { data: pa } = await supabase
          .from('analysis_results').select('result_json, created_at')
          .in('match_id', ids).order('created_at', { ascending: false }).limit(3)
        memberPastAnalyses = pa ?? []
      }
    }

    // 学習材料（serve_hints）を取得
    let serveHints = []
    if (match?.club_id) {
      const { data: hints } = await supabase
        .from('serve_hints').select('*').eq('club_id', match.club_id)
      serveHints = hints ?? []
    }

    // 自分が出場したかどうか
    const selfPlayer = players?.find(p => p.member_user_id === userId)
    const pastAnalyses = opponentPastAnalyses // 後方互換

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
      ? `\n【コーチ・本人メモ（重要：この情報も分析に活用してください）】\n${match.coach_memo}\n` : ''

    // 相手の過去分析
    const opponentPastText = opponentPastAnalyses.length > 0
      ? `【相手の過去の対戦分析（直近${opponentPastAnalyses.length}回）】\n${opponentPastAnalyses.map((pa, i) => `--- 対戦${i+1}回目 (${new Date(pa.created_at).toLocaleDateString('ja-JP')}) ---\n${JSON.stringify(pa.result_json, null, 2)}`).join('\n\n')}\n`
      : ''

    // 自クラブメンバーの過去分析
    const memberPastText = memberPastAnalyses.length > 0
      ? `【自クラブ選手の過去の試合分析（直近${memberPastAnalyses.length}回）】\n${memberPastAnalyses.map((pa, i) => `--- 試合${i+1}回目 (${new Date(pa.created_at).toLocaleDateString('ja-JP')}) ---\n${JSON.stringify(pa.result_json, null, 2)}`).join('\n\n')}\n`
      : ''

    // 学習材料（サーブ回転ヒント）
    const hintsText = serveHints.length > 0
      ? `【サーブ回転の判定ヒント（登録済み学習材料）】\n${serveHints.map(h =>
          `・${h.serve_type}（${h.spin_type}）: ${[h.racket_angle, h.swing_direction, h.receive_reaction ? `受けると${h.receive_reaction}` : '', h.counter_strategy ? `対策: ${h.counter_strategy}` : '', h.notes].filter(Boolean).join(' / ')}`
        ).join('\n')}\n`
      : `【サーブ回転の一般的な判定基準】
・ラケット面が下向き＋上から下スイング → 下回転（受けるとネットに引っかかりやすい）
・ラケット面が上向き＋下から上スイング → 上回転（受けるとオーバーしやすい）
・ラケット面が縦向き＋横スイング → 横回転（受けると横に曲がる）
・ラケット面が立てて軽く当てる → ナックル（回転が少ない・読みにくい）
・コーチメモの「レシーブ反応」も回転判定の根拠として使用すること\n`

    const hasPastData = opponentPastAnalyses.length > 0 || memberPastAnalyses.length > 0

    content.push({
      type: 'text',
      text: `あなたは日本の卓球専門コーチです。以下の試合フレーム画像を詳細に分析し、指定のJSON形式のみで回答してください。

【試合基本情報】
- 試合形式: ${match?.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
- 日時: ${match?.played_at ? new Date(match.played_at).toLocaleString('ja-JP') : '不明'}

【選手情報】
${playersInfo}
${coachMemoText}
${hintsText}
${opponentPastText}
${memberPastText}
${selfPlayer ? '※ 分析依頼者が出場しています。selfTasksには具体的な改善課題・練習方法を記載してください。' : ''}
${hasPastData ? '※ 相手・自クラブ選手双方について、過去との変化・改善・悪化をdiffFromLastTimeに記載してください。' : ''}

【分析指示】
フレーム画像を順番に見ながら以下を読み取ってください：

1. サーブ回転の判定（最優先）:
   - ラケット面の角度と向き
   - スイングの方向と速度
   - インパクトの位置（ラバーのどこで当てているか）
   - コーチメモや学習材料のヒントも根拠として活用
   - レシーバーの反応（ネット/オーバー/横方向）から逆算して回転を推定
   ※ 必ず「〇〇回転（根拠：ラケットが〜のため）」の形式で記載

2. コース・配球パターン:
   - フォア前・バック前・ミドル・ロング
   - クロス or ストレート
   - 短い or 長い・得意コース

3. 得点・失点パターン:
   - どんな技術・展開で得点しているか
   - どんな状況でミスしているか
   - ミスの具体的な原因（体勢が崩れた・タイミングが遅れた等）

4. 両者の変化（過去データがある場合）:
   - 前回から相手が修正・改善した点
   - 前回から自クラブ選手が改善・悪化した点

以下のJSON形式のみで回答してください（日本語・他の文字は一切含めないこと）：
{
  "serveAnalysis": {
    "types": ["確認されたサーブ種類1", "確認されたサーブ種類2"],
    "spinDetails": "各サーブの回転詳細と判定根拠（ラケット角度・スイング・レシーバー反応から）",
    "favoriteServe": "最頻出サーブ",
    "coursePattern": "配球コースのパターン",
    "counterStrategy": "有効なレシーブ戦略（具体的に）"
  },
  "scoringPattern": {
    "howTheyScore": "得点パターンと使用技術",
    "howTheyLose": "失点・ミスのパターン",
    "missReasons": "ミスの主な原因（体勢・タイミング・判断ミス等）",
    "rallyTendency": "ラリーの傾向（テンポ・得意な展開）"
  },
  "weaknesses": "弱点（技術・体勢・コース・心理面を具体的に）",
  "habits": "癖・傾向（フォーム・動き・特定状況でのパターン）",
  "attackDefensePattern": "攻守パターン（3球目・5球目攻撃の有無・守り方）",
  "gamePlan": {
    "early": "序盤の戦略（サーブ選択・レシーブ戦略）",
    "mid": "中盤の戦略（ラリー展開・コース選択）",
    "late": "終盤・デュース時の戦略"
  },
  "winLoseFactor": "この試合の勝因または敗因（具体的な場面・技術レベルで）",
  "selfTasks": ${selfPlayer ? '"自分の具体的な改善課題と練習方法の提案（出場者向け）"' : 'null'},
  "diffFromLastTime": ${hasPastData ? '"【相手の変化】前回と比べた相手選手の改善点・悪化点・新たな癖\n【自クラブ選手の変化】前回と比べた自クラブ選手の改善点・課題・変化"' : 'null'}
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
