import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const MAX_BYTES = 600 * 1024 * 1024 // 600MB

// 動画ファイルから指定秒数のフレームを抽出（ブラウザ内）
function extractFrame(file, timeSeconds = 5) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    video.muted = true
    video.playsInline = true
    video.src = URL.createObjectURL(file)
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(timeSeconds, video.duration * 0.9)
    })
    video.addEventListener('seeked', () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      URL.revokeObjectURL(video.src)
      resolve({ dataUrl, duration: video.duration })
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
  const [frameDataUrl, setFrameDataUrl] = useState(null)
  const [frameTime, setFrameTime] = useState(5)
  const [videoDuration, setVideoDuration] = useState(0)
  const [extractingFrame, setExtractingFrame] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')

  const [members, setMembers] = useState([])
  const [opponents, setOpponents] = useState([])

  // ピン：クリック位置 + 割り当て選手
  const [pins, setPins] = useState([])
  const [pendingPin, setPendingPin] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const maxPlayers = matchType === 'singles' ? 2 : 4

  useEffect(() => {
    if (!profile?.club_id) return
    Promise.all([
      supabase.from('users').select('id, name, grade, handedness').eq('club_id', profile.club_id).order('name'),
      supabase.from('opponents').select('id, name, grade, handedness').eq('club_id', profile.club_id).order('name'),
    ]).then(([{ data: m }, { data: o }]) => {
      setMembers(m ?? [])
      setOpponents(o ?? [])
    })
  }, [profile])

  async function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > MAX_BYTES) { setError('ファイルサイズは600MB以下にしてください'); return }
    if (!f.type.startsWith('video/')) { setError('動画ファイルを選択してください'); return }
    setFile(f)
    setError('')
    setPins([])
    setExtractingFrame(true)
    const result = await extractFrame(f, 5)
    if (result) {
      setFrameDataUrl(result.dataUrl)
      setVideoDuration(result.duration)
      setFrameTime(5)
    }
    setExtractingFrame(false)
  }

  async function handleFrameTimeChange(t) {
    if (!file) return
    setFrameTime(t)
    setExtractingFrame(true)
    const result = await extractFrame(file, t)
    if (result) setFrameDataUrl(result.dataUrl)
    setExtractingFrame(false)
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
    setPins(prev => [...prev, {
      id: Date.now(),
      x: pendingPin.x,
      y: pendingPin.y,
      type,
      playerId,
      playerName: person.name,
      grade: person.grade,
      handedness: person.handedness,
    }])
    setShowModal(false)
    setPendingPin(null)
    setError('')
  }

  function removePin(pinId) {
    setPins(prev => prev.filter(p => p.id !== pinId))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('動画ファイルを選択してください'); return }
    if (pins.length === 0) { setError('選手を最低1人設定してください'); return }
    setUploading(true)
    setError('')

    try {
      const ext = file.name.split('.').pop()
      const path = `${profile.club_id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('match-videos')
        .upload(path, file, {
          onUploadProgress: (ev) => setUploadProgress(Math.round((ev.loaded / ev.total) * 100)),
        })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('match-videos').getPublicUrl(path)

      const { data: match, error: matchErr } = await supabase
        .from('matches')
        .insert({
          club_id: profile.club_id,
          video_url: publicUrl,
          video_path: path,
          played_at: playedAt,
          match_type: matchType,
          frame_status: 'pending',
        })
        .select()
        .single()
      if (matchErr) throw matchErr

      // ピン情報をmatch_playersに保存
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

      // Renderサーバーにフレーム抽出を依頼（設定済みの場合）
      const renderUrl = import.meta.env.VITE_RENDER_API_URL
      if (renderUrl) {
        fetch(`${renderUrl}/extract-frames`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: match.id, videoPath: path }),
        }).catch(console.warn)
      }

      navigate(`/matches/${match.id}`)
    } catch (err) {
      setError(err.message ?? 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const allPlayersSet = pins.length >= maxPlayers

  return (
    <Layout>
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">試合動画をアップロード</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* 動画ファイル選択 */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">動画ファイル（最大600MB）</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              {file ? (
                <div>
                  <div className="text-2xl mb-1">🎥</div>
                  <div className="font-medium text-gray-700">{file.name}</div>
                  <div className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
              ) : (
                <div>
                  <div className="text-3xl mb-2">📁</div>
                  <div className="text-sm text-gray-500">クリックして動画を選択</div>
                  <div className="text-xs text-gray-400 mt-1">MP4, MOV, AVI など</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
          </div>

          {/* 試合形式（先に選ぶ） */}
          <div className="bg-white rounded-xl shadow-sm border p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">試合形式</label>
              <div className="flex gap-3">
                {['singles', 'doubles'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setMatchType(t); setPins([]) }}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      matchType === t ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t === 'singles' ? 'シングルス（2人）' : 'ダブルス（4人）'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">試合日時</label>
              <input
                type="datetime-local"
                value={playedAt}
                onChange={e => setPlayedAt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* フレームプレビュー＋選手タグ付け */}
          {(frameDataUrl || extractingFrame) && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-gray-700">選手をクリックして割り当て</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    動画の中の選手の位置をクリック → 名前を選択
                    （{pins.length} / {maxPlayers}人）
                  </p>
                </div>
                {allPlayersSet
                  ? <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">✓ 全員設定済み</span>
                  : <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">あと{maxPlayers - pins.length}人</span>
                }
              </div>

              {/* フレームスライダー */}
              {videoDuration > 0 && (
                <div className="mb-3">
                  <label className="text-xs text-gray-500 mb-1 block">
                    フレーム位置：{Math.round(frameTime)}秒 / {Math.round(videoDuration)}秒
                    <span className="ml-2 text-gray-400">（スライダーで選手が見やすい場面に調整）</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, Math.floor(videoDuration) - 1)}
                    value={frameTime}
                    onChange={e => handleFrameTimeChange(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              )}

              {/* フレーム画像（クリックでピン） */}
              <div
                className="relative rounded-lg overflow-hidden bg-gray-900 select-none"
                style={{ cursor: pins.length < maxPlayers ? 'crosshair' : 'default' }}
                onClick={pins.length < maxPlayers ? handleFrameClick : undefined}
              >
                {extractingFrame && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
                    <div className="text-white text-sm flex items-center gap-2">
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      フレーム取得中...
                    </div>
                  </div>
                )}
                {frameDataUrl && (
                  <img ref={imgRef} src={frameDataUrl} alt="動画フレーム" className="w-full h-auto block" draggable={false} />
                )}

                {/* ピンマーカー */}
                {pins.map((pin, i) => (
                  <div
                    key={pin.id}
                    className="absolute"
                    style={{ left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%, -100%)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap flex items-center gap-1 mb-1">
                      <span className="w-4 h-4 bg-white text-blue-600 rounded-full flex items-center justify-center text-xs font-black">{i + 1}</span>
                      <span>{pin.playerName}</span>
                      <button
                        type="button"
                        onClick={() => removePin(pin.id)}
                        className="ml-1 text-blue-200 hover:text-white leading-none"
                      >×</button>
                    </div>
                    <div className="w-0 h-0 mx-auto" style={{ borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid #2563eb' }} />
                  </div>
                ))}

                {/* ガイドテキスト */}
                {pins.length < maxPlayers && !extractingFrame && (
                  <div className="absolute bottom-2 inset-x-0 flex justify-center pointer-events-none">
                    <div className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                      👆 選手の体をクリックしてください
                    </div>
                  </div>
                )}
              </div>

              {/* 設定済み選手リスト */}
              {pins.length > 0 && (
                <div className="mt-3 space-y-1">
                  {pins.map((pin, i) => (
                    <div key={pin.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center font-bold">{i + 1}</span>
                        <span className="text-sm font-medium text-gray-800">{pin.playerName}</span>
                        <span className="text-xs text-gray-400">{pin.type === 'member' ? '自クラブ' : '対戦相手'}</span>
                        {pin.handedness && <span className="text-xs text-gray-400">{pin.handedness}</span>}
                      </div>
                      <button type="button" onClick={() => removePin(pin.id)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* アップロード進捗 */}
          {uploading && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>アップロード中...</span><span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="flex gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate('/matches')}
              disabled={uploading}
              className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={uploading || !file || pins.length === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {uploading ? 'アップロード中...' : 'アップロード'}
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
                <div className="text-xs font-semibold text-orange-600 mb-2 flex items-center gap-1">
                  <span className="w-4 h-4 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-xs font-black">自</span>
                  クラブメンバー
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  {members
                    .filter(m => !pins.find(p => p.type === 'member' && p.playerId === m.id))
                    .map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => assignPlayer('member', m.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-200 text-sm transition-colors"
                      >
                        <span className="font-medium text-gray-800">{m.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{[m.grade, m.handedness].filter(Boolean).join(' / ')}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {opponents.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1">
                  <span className="w-4 h-4 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-black">相</span>
                  対戦相手
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto">
                  {opponents
                    .filter(o => !pins.find(p => p.type === 'opponent' && p.playerId === o.id))
                    .map(o => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => assignPlayer('opponent', o.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-200 text-sm transition-colors"
                      >
                        <span className="font-medium text-gray-800">{o.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{[o.grade, o.handedness].filter(Boolean).join(' / ')}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {members.length === 0 && opponents.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                先にプロフィールか対戦相手を登録してください
              </p>
            )}

            <button
              type="button"
              onClick={() => { setShowModal(false); setPendingPin(null) }}
              className="mt-4 w-full border border-gray-300 text-gray-600 py-2 rounded-lg hover:bg-gray-50 text-sm"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
