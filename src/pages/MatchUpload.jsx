import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const TARGET_FRAMES = 20   // 最大フレーム数
const FRAME_QUALITY = 0.82 // JPEG品質

// 動画から均等間隔でN枚フレームを抽出
async function extractMultipleFrames(file, count, onProgress) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = URL.createObjectURL(file)

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration
      const interval = duration / (count + 1)
      const results = []

      for (let i = 1; i <= count; i++) {
        const t = interval * i
        await new Promise(res => {
          video.currentTime = t
          video.addEventListener('seeked', () => {
            const canvas = document.createElement('canvas')
            // 解像度を下げて容量削減（横960px以下）
            const scale = Math.min(1, 960 / video.videoWidth)
            canvas.width = Math.round(video.videoWidth * scale)
            canvas.height = Math.round(video.videoHeight * scale)
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
            results.push({ dataUrl: canvas.toDataURL('image/jpeg', FRAME_QUALITY), time: Math.round(t) })
            onProgress && onProgress(i / count)
            res()
          }, { once: true })
        })
      }
      URL.revokeObjectURL(video.src)
      resolve({ frames: results, duration })
    })

    video.addEventListener('error', () => resolve({ frames: [], duration: 0 }))
  })
}

// プレビュー用：1枚だけ取得
async function extractSingleFrame(file, timeSeconds) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = URL.createObjectURL(file)
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(timeSeconds, video.duration * 0.9)
    })
    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 960 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(video.src)
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', FRAME_QUALITY), duration: video.duration })
    }, { once: true })
    video.addEventListener('error', () => resolve(null))
  })
}

export default function MatchUpload() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const imgRef = useRef(null)

  const [matchType, setMatchType] = useState('singles')
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 16))
  const [file, setFile] = useState(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [frameTime, setFrameTime] = useState(5)
  const [previewDataUrl, setPreviewDataUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [videoRefUrl, setVideoRefUrl] = useState('')

  // フレーム抽出・アップロード進捗
  const [phase, setPhase] = useState('idle') // idle|extracting|uploading|done
  const [extractProgress, setExtractProgress] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')

  const [members, setMembers] = useState([])
  const [opponents, setOpponents] = useState([])
  const [pins, setPins] = useState([])
  const [pendingPin, setPendingPin] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const maxPlayers = matchType === 'singles' ? 2 : 4

  useEffect(() => {
    if (!profile?.club_id) return
    Promise.all([
      supabase.from('users').select('id, name, grade, handedness, rubber_forehand, rubber_backhand').eq('club_id', profile.club_id).order('name'),
      supabase.from('opponents').select('id, name, grade, handedness, rubber_forehand, rubber_backhand').eq('club_id', profile.club_id).order('name'),
    ]).then(([{ data: m }, { data: o }]) => {
      setMembers(m ?? [])
      setOpponents(o ?? [])
    })
  }, [profile])

  async function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    if (!f.type.startsWith('video/')) { setError('動画ファイルを選択してください'); return }
    setFile(f)
    setError('')
    setPins([])
    setPreviewLoading(true)
    const result = await extractSingleFrame(f, 5)
    if (result) {
      setPreviewDataUrl(result.dataUrl)
      setVideoDuration(result.duration)
      setFrameTime(5)
    }
    setPreviewLoading(false)
  }

  async function handleFrameTimeChange(t) {
    if (!file) return
    setFrameTime(t)
    setPreviewLoading(true)
    const result = await extractSingleFrame(file, t)
    if (result) setPreviewDataUrl(result.dataUrl)
    setPreviewLoading(false)
  }

  function handleFrameClick(e) {
    if (pins.length >= maxPlayers) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingPin({ x, y })
    setShowModal(true)
  }

  function assignPlayer(type, playerId) {
    if (!pendingPin) return
    const list = type === 'member' ? members : opponents
    const person = list.find(p => p.id === playerId)
    if (!person) return
    if (pins.find(p => p.type === type && p.playerId === playerId)) {
      setError('同じ選手は2回選択できません')
      setShowModal(false)
      return
    }
    setPins(prev => [...prev, { id: Date.now(), x: pendingPin.x, y: pendingPin.y, type, playerId, playerName: person.name, grade: person.grade, handedness: person.handedness }])
    setShowModal(false)
    setPendingPin(null)
    setError('')
  }

  function removePin(pinId) { setPins(prev => prev.filter(p => p.id !== pinId)) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('動画ファイルを選択してください'); return }
    if (pins.length === 0) { setError('選手を最低1人設定してください'); return }
    setError('')

    try {
      // ── Phase 1: フレーム抽出 ──────────────────────────
      setPhase('extracting')
      setExtractProgress(0)

      // 動画の長さに応じてフレーム数を決定（最大20枚）
      // 5分→15枚、10分→20枚
      const duration = videoDuration || 300
      const frameCount = Math.min(TARGET_FRAMES, Math.max(8, Math.floor(duration / 20)))

      const { frames } = await extractMultipleFrames(file, frameCount, (p) => setExtractProgress(p))

      if (frames.length === 0) throw new Error('フレームの抽出に失敗しました')

      // ── Phase 2: matchレコード作成 ─────────────────────
      setPhase('uploading')
      setUploadProgress(0)

      const { data: match, error: matchErr } = await supabase
        .from('matches')
        .insert({
          club_id: profile.club_id,
          video_url: videoRefUrl || null,
          video_ref_url: videoRefUrl || null,
          played_at: playedAt,
          match_type: matchType,
          frame_status: 'processing',
        })
        .select()
        .single()
      if (matchErr) throw matchErr

      // ── Phase 3: フレームをSupabase Storageにアップロード ──
      const frameRecords = []
      for (let i = 0; i < frames.length; i++) {
        const { dataUrl, time } = frames[i]
        const base64 = dataUrl.split(',')[1]
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: 'image/jpeg' })

        const storagePath = `${match.id}/frame_${String(time).padStart(5, '0')}.jpg`
        const { error: upErr } = await supabase.storage
          .from('match-frames')
          .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: true })

        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('match-frames').getPublicUrl(storagePath)
          frameRecords.push({ match_id: match.id, frame_time: time, image_url: publicUrl, image_path: storagePath })
        }

        setUploadProgress(Math.round(((i + 1) / frames.length) * 100))
      }

      // ── Phase 4: match_framesとmatch_playersをDB保存 ────
      if (frameRecords.length > 0) {
        await supabase.from('match_frames').insert(frameRecords)
      }

      await supabase.from('matches').update({ frame_status: 'done' }).eq('id', match.id)

      const playerRows = pins.map((pin, i) => ({
        match_id: match.id,
        side: i % 2 === 0 ? 'left' : 'right',
        position: Math.floor(i / 2) + 1,
        member_user_id: pin.type === 'member' ? pin.playerId : null,
        opponent_id: pin.type === 'opponent' ? pin.playerId : null,
      }))
      if (playerRows.length > 0) {
        await supabase.from('match_players').insert(playerRows)
      }

      setPhase('done')
      navigate(`/matches/${match.id}`)
    } catch (err) {
      setError(err.message ?? 'アップロードに失敗しました')
      setPhase('idle')
    }
  }

  const isProcessing = phase !== 'idle' && phase !== 'done'
  const allPlayersSet = pins.length >= maxPlayers

  return (
    <Layout>
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">試合動画を登録</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* 動画ファイル選択 */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              動画ファイル
              <span className="ml-2 text-xs text-gray-400 font-normal">（5〜10分の動画対応・サイズ制限なし）</span>
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              {file ? (
                <div>
                  <div className="text-2xl mb-1">🎥</div>
                  <div className="font-medium text-gray-700">{file.name}</div>
                  <div className="text-xs text-gray-400">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                    {videoDuration > 0 && ` / ${Math.floor(videoDuration / 60)}分${Math.round(videoDuration % 60)}秒`}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-3xl mb-2">📁</div>
                  <div className="text-sm text-gray-500">クリックして動画を選択</div>
                  <div className="text-xs text-gray-400 mt-1">MP4, MOV, AVI など（動画はブラウザ内で処理・画像のみ保存）</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="video/*" onChange={handleFileChange} className="hidden" />

            {/* YouTube/Drive参照URL（任意） */}
            <div className="mt-3">
              <label className="block text-xs text-gray-500 mb-1">動画の参照URL（任意：YouTube・Google Driveなど）</label>
              <input
                type="url"
                value={videoRefUrl}
                onChange={e => setVideoRefUrl(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://youtube.com/..."
              />
            </div>
          </div>

          {/* 試合形式・日時 */}
          <div className="bg-white rounded-xl shadow-sm border p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">試合形式</label>
              <div className="flex gap-3">
                {['singles', 'doubles'].map(t => (
                  <button key={t} type="button"
                    onClick={() => { setMatchType(t); setPins([]) }}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${matchType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {t === 'singles' ? 'シングルス（2人）' : 'ダブルス（4人）'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">試合日時</label>
              <input type="datetime-local" value={playedAt} onChange={e => setPlayedAt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* フレームプレビュー + 選手タグ付け */}
          {(previewDataUrl || previewLoading) && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-700">選手をクリックして識別</h3>
                  <p className="text-xs text-gray-400 mt-0.5">選手の位置をクリック → 名前を選択（{pins.length}/{maxPlayers}人）</p>
                </div>
                {allPlayersSet
                  ? <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">✓ 全員設定済み</span>
                  : <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">あと{maxPlayers - pins.length}人</span>
                }
              </div>

              {videoDuration > 0 && (
                <div className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 block">
                    場面選択：{Math.round(frameTime)}秒 / {Math.round(videoDuration)}秒
                  </label>
                  <input type="range" min={0} max={Math.max(0, Math.floor(videoDuration) - 1)}
                    value={frameTime} onChange={e => handleFrameTimeChange(Number(e.target.value))}
                    className="w-full accent-blue-600" />
                </div>
              )}

              <div
                className="relative rounded-lg overflow-hidden bg-gray-900 select-none"
                style={{ cursor: pins.length < maxPlayers ? 'crosshair' : 'default' }}
                onClick={pins.length < maxPlayers ? handleFrameClick : undefined}
              >
                {previewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
                    <div className="text-white text-sm flex items-center gap-2">
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      フレーム取得中...
                    </div>
                  </div>
                )}
                {previewDataUrl && <img ref={imgRef} src={previewDataUrl} alt="フレーム" className="w-full h-auto block" draggable={false} />}

                {pins.map((pin, i) => (
                  <div key={pin.id} className="absolute" style={{ left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%,-100%)' }}
                    onClick={e => e.stopPropagation()}>
                    <div className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap flex items-center gap-1 mb-1">
                      <span className="w-4 h-4 bg-white text-blue-600 rounded-full flex items-center justify-center text-xs font-black">{i+1}</span>
                      <span>{pin.playerName}</span>
                      <button type="button" onClick={() => removePin(pin.id)} className="ml-1 text-blue-200 hover:text-white">×</button>
                    </div>
                    <div className="w-0 h-0 mx-auto" style={{ borderLeft:'6px solid transparent', borderRight:'6px solid transparent', borderTop:'8px solid #2563eb' }} />
                  </div>
                ))}

                {pins.length < maxPlayers && !previewLoading && (
                  <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                    <div className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">👆 選手の体をクリック</div>
                  </div>
                )}
              </div>

              {pins.length > 0 && (
                <div className="mt-3 space-y-1">
                  {pins.map((pin, i) => (
                    <div key={pin.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold">{i+1}</span>
                        <span className="text-sm font-medium text-gray-800">{pin.playerName}</span>
                        <span className="text-xs text-gray-400">{pin.type === 'member' ? '自クラブ' : '対戦相手'}{pin.handedness ? ` / ${pin.handedness}` : ''}</span>
                      </div>
                      <button type="button" onClick={() => removePin(pin.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 進捗表示 */}
          {isProcessing && (
            <div className="bg-white rounded-xl shadow-sm border p-5 space-y-3">
              {phase === 'extracting' && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>🎞️ フレームを抽出中...</span>
                    <span>{Math.round(extractProgress * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${extractProgress * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">動画はアップロードせず、画像のみ保存します</p>
                </div>
              )}
              {phase === 'uploading' && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>☁️ フレームをアップロード中...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pb-8">
            <button type="button" onClick={() => navigate('/matches')} disabled={isProcessing}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
              キャンセル
            </button>
            <button type="submit" disabled={isProcessing || !file || pins.length === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {isProcessing ? '処理中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>

      {/* 選手割り当てモーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-800 mb-1">この選手は誰ですか？</h3>
            <p className="text-xs text-gray-400 mb-4">クリックした位置の選手を選択してください</p>

            {members.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-orange-600 mb-2">自クラブメンバー</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {members.filter(m => !pins.find(p => p.type==='member' && p.playerId===m.id)).map(m => (
                    <button key={m.id} type="button" onClick={() => assignPlayer('member', m.id)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-orange-50 text-sm transition-colors">
                      <span className="font-medium text-gray-800">{m.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{[m.grade, m.handedness].filter(Boolean).join(' / ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {opponents.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-blue-600 mb-2">対戦相手</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {opponents.filter(o => !pins.find(p => p.type==='opponent' && p.playerId===o.id)).map(o => (
                    <button key={o.id} type="button" onClick={() => assignPlayer('opponent', o.id)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-blue-50 text-sm transition-colors">
                      <span className="font-medium text-gray-800">{o.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{[o.grade, o.handedness].filter(Boolean).join(' / ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button type="button" onClick={() => { setShowModal(false); setPendingPin(null) }}
              className="mt-4 w-full border border-gray-300 text-gray-600 py-2 rounded-lg hover:bg-gray-50 text-sm">
              キャンセル
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
