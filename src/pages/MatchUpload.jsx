import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const MAX_BYTES = 600 * 1024 * 1024 // 600MB

export default function MatchUpload() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef(null)

  const [matchType, setMatchType] = useState('singles')
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 16))
  const [file, setFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState('')

  // 選手選択
  const [members, setMembers] = useState([])
  const [opponents, setOpponents] = useState([])
  // シングルス
  const [leftPlayer, setLeftPlayer] = useState({ type: 'member', id: '' })
  const [rightPlayer, setRightPlayer] = useState({ type: 'opponent', id: '' })
  // ダブルス
  const [leftPair, setLeftPair] = useState([{ type: 'member', id: '' }, { type: 'member', id: '' }])
  const [rightPair, setRightPair] = useState([{ type: 'opponent', id: '' }, { type: 'opponent', id: '' }])

  useEffect(() => {
    if (!profile?.club_id) return
    Promise.all([
      supabase.from('users').select('id, name, grade').eq('club_id', profile.club_id).order('name'),
      supabase.from('opponents').select('id, name, grade').eq('club_id', profile.club_id).order('name'),
    ]).then(([{ data: m }, { data: o }]) => {
      setMembers(m ?? [])
      setOpponents(o ?? [])
    })
  }, [profile])

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > MAX_BYTES) { setError('ファイルサイズは600MB以下にしてください'); return }
    if (!f.type.startsWith('video/')) { setError('動画ファイルを選択してください'); return }
    setFile(f)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('動画ファイルを選択してください'); return }
    setUploading(true)
    setError('')

    try {
      // 1. Supabase Storageにアップロード
      const ext = file.name.split('.').pop()
      const path = `${profile.club_id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('match-videos')
        .upload(path, file, {
          onUploadProgress: (e) => setUploadProgress(Math.round((e.loaded / e.total) * 100)),
        })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage.from('match-videos').getPublicUrl(path)

      // 2. matchesテーブルに保存
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

      // 3. match_playersを登録
      const playerRows = buildPlayerRows(match.id)
      if (playerRows.length > 0) {
        const { error: pErr } = await supabase.from('match_players').insert(playerRows)
        if (pErr) console.warn('match_players insert error:', pErr)
      }

      // 4. Renderのフレーム抽出APIを呼び出し
      setUploading(false)
      setExtracting(true)
      const renderUrl = import.meta.env.VITE_RENDER_API_URL
      if (renderUrl) {
        await fetch(`${renderUrl}/extract-frames`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: match.id, videoPath: path }),
        })
      }

      navigate(`/matches/${match.id}`)
    } catch (err) {
      setError(err.message ?? 'アップロードに失敗しました')
      setUploading(false)
      setExtracting(false)
    }
  }

  function buildPlayerRows(matchId) {
    if (matchType === 'singles') {
      const rows = []
      if (leftPlayer.id) rows.push({ match_id: matchId, side: 'left', position: 1, ...resolvePlayer(leftPlayer) })
      if (rightPlayer.id) rows.push({ match_id: matchId, side: 'right', position: 1, ...resolvePlayer(rightPlayer) })
      return rows
    } else {
      return [
        ...leftPair.map((p, i) => p.id ? { match_id: matchId, side: 'left', position: i + 1, ...resolvePlayer(p) } : null),
        ...rightPair.map((p, i) => p.id ? { match_id: matchId, side: 'right', position: i + 1, ...resolvePlayer(p) } : null),
      ].filter(Boolean)
    }
  }

  function resolvePlayer(p) {
    return p.type === 'member'
      ? { member_user_id: p.id, opponent_id: null }
      : { member_user_id: null, opponent_id: p.id }
  }

  function PlayerSelect({ value, onChange, label }) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <div className="flex gap-2">
          <select
            value={value.type}
            onChange={e => onChange({ type: e.target.value, id: '' })}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="member">メンバー</option>
            <option value="opponent">対戦相手</option>
          </select>
          <select
            value={value.id}
            onChange={e => onChange({ ...value, id: e.target.value })}
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">選択...</option>
            {(value.type === 'member' ? members : opponents).map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.grade ? `（${p.grade}）` : ''}</option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  const isProcessing = uploading || extracting

  return (
    <Layout>
      <div className="max-w-lg">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">試合動画をアップロード</h2>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 動画ファイル選択 */}
            <div>
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

            {/* アップロード進捗 */}
            {uploading && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>アップロード中...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
            {extracting && (
              <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 rounded-lg px-4 py-3">
                <div className="animate-spin w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full" />
                フレームを抽出中（バックグラウンドで処理）...
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">試合日時</label>
              <input
                type="datetime-local"
                value={playedAt}
                onChange={e => setPlayedAt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* シングルス / ダブルス */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">試合形式</label>
              <div className="flex gap-3">
                {['singles', 'doubles'].map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMatchType(t)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      matchType === t
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t === 'singles' ? 'シングルス' : 'ダブルス'}
                  </button>
                ))}
              </div>
            </div>

            {/* 選手割り当て */}
            <fieldset className="border border-gray-200 rounded-lg p-4">
              <legend className="text-sm font-medium text-gray-700 px-2">選手設定</legend>
              {matchType === 'singles' ? (
                <div className="space-y-3">
                  <PlayerSelect value={leftPlayer} onChange={setLeftPlayer} label="左側プレイヤー" />
                  <PlayerSelect value={rightPlayer} onChange={setRightPlayer} label="右側プレイヤー" />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">左ペア</div>
                    <div className="space-y-2">
                      <PlayerSelect value={leftPair[0]} onChange={v => setLeftPair(p => [v, p[1]])} label="左ペア 1人目" />
                      <PlayerSelect value={leftPair[1]} onChange={v => setLeftPair(p => [p[0], v])} label="左ペア 2人目" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">右ペア</div>
                    <div className="space-y-2">
                      <PlayerSelect value={rightPair[0]} onChange={v => setRightPair(p => [v, p[1]])} label="右ペア 1人目" />
                      <PlayerSelect value={rightPair[1]} onChange={v => setRightPair(p => [p[0], v])} label="右ペア 2人目" />
                    </div>
                  </div>
                </div>
              )}
            </fieldset>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate('/matches')}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={isProcessing}
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={isProcessing || !file}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {isProcessing ? '処理中...' : 'アップロード'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
}
