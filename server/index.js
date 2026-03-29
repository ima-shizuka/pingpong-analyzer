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

    // テキスト情報
    const playersInfo = players?.map(p => {
      const person = p.users ?? p.opponents
      return `${p.side === 'left' ? '左側' : '右側'} ${p.position}人目: ${person?.name ?? '不明'} (フォア:${person?.rubber_forehand ?? '不明'}, バック:${person?.rubber_backhand ?? '不明'})`
    }).join('\n')

    content.push({
      type: 'text',
      text: `あなたは卓球の専門コーチです。以下の試合動画のフレーム画像を分析して、JSON形式で結果を返してください。

【試合情報】
- 試合形式: ${match?.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
- 日時: ${match?.played_at ?? '不明'}

【選手情報】
${playersInfo}

${pastAnalyses.length > 0 ? `【過去の分析結果（参考）】\n${pastAnalyses.map((pa, i) => `分析${i + 1}: ${JSON.stringify(pa.result_json)}`).join('\n')}` : ''}

${selfPlayer ? '※ 分析依頼者は左側のプレイヤーとして出場しています。selfTasksフィールドに自分の課題を含めてください。' : ''}
${pastAnalyses.length > 0 ? '※ 過去の分析との違いをdiffFromLastTimeフィールドに記載してください。' : ''}

以下のJSON形式で回答してください：
{
  "weaknesses": "相手の弱点（具体的な技術・体勢・心理面）",
  "servePattern": "サーブの特徴と有効な対策",
  "attackDefensePattern": "攻守のパターン（どんな状況で攻めるか、守るか）",
  "gamePlan": {
    "early": "序盤の戦略",
    "mid": "中盤の戦略",
    "late": "終盤の戦略"
  },
  "habits": "プレーの癖・傾向（フォームや動き方など）",
  "winLoseFactor": "この試合の勝因または敗因",
  "selfTasks": "自分が出場した場合の課題と次戦への対策（出場していない場合はnull）",
  "diffFromLastTime": "前回の分析との違い（初回の場合はnull）"
}

JSON以外の文字は含めないでください。`
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
      max_tokens: 2000,
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
