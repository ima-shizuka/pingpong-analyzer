import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Layout from '../components/Layout'

const ANALYSIS_TABS = [
  { key: 'serveAnalysis', label: '🏓 サーブ分析' },
  { key: 'scoringPattern', label: '📊 得点パターン' },
  { key: 'weaknesses', label: '⚠️ 弱点' },
  { key: 'attackDefensePattern', label: '⚔️ 攻守' },
  { key: 'gamePlan', label: '🎯 戦略' },
  { key: 'habits', label: '👁 癖' },
  { key: 'winLoseFactor', label: '🏆 勝敗因' },
  { key: 'selfTasks', label: '📝 自分の課題' },
  { key: 'diffFromLastTime', label: '🔄 前回比較' },
]

export default function MatchDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [match, setMatch] = useState(null)
  const [players, setPlayers] = useState([])
  const [frames, setFrames] = useState([])
  const [analyses, setAnalyses] = useState([])
  const [analyzing, setAnalyzing] = useState(false)
  const [activeTab, setActiveTab] = useState('serveAnalysis')
  const [compareIdx, setCompareIdx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [coachMemo, setCoachMemo] = useState('')
  const [savingMemo, setSavingMemo] = useState(false)
  const [memoSaved, setMemoSaved] = useState(false)

  useEffect(() => {
    load()
    // Supabase Realtimeでframe_status更新を監視
    const channel = supabase
      .channel(`match-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${id}` },
        (payload) => {
          setMatch(prev => ({ ...prev, ...payload.new }))
          if (payload.new.frame_status === 'done') {
            loadFrames()
          }
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [id])

  async function saveMemo() {
    setSavingMemo(true)
    await supabase.from('matches').update({ coach_memo: coachMemo }).eq('id', id)
    setSavingMemo(false)
    setMemoSaved(true)
    setTimeout(() => setMemoSaved(false), 2000)
  }

  async function load() {
    const [{ data: m }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('matches').select('*').eq('id', id).single(),
      supabase.from('match_players').select('*, users:member_user_id(name, rubber_forehand, rubber_backhand, handedness), opponents:opponent_id(name, rubber_forehand, rubber_backhand, handedness)').eq('match_id', id),
      supabase.from('analysis_results').select('*').eq('match_id', id).order('created_at', { ascending: false }),
    ])
    setMatch(m)
    setPlayers(p ?? [])
    setAnalyses(a ?? [])
    setCoachMemo(m?.coach_memo ?? '')
    if (m?.frame_status === 'done') await loadFrames()
    setLoading(false)
  }

  async function loadFrames() {
    const { data } = await supabase.from('match_frames').select('*').eq('match_id', id).order('frame_time')
    setFrames(data ?? [])
  }

  async function startAnalysis() {
    if (!match) return
    const renderUrl = import.meta.env.VITE_RENDER_API_URL
    if (!renderUrl) {
      alert('分析サーバー（Render）がまだ設定されていません。\nVITE_RENDER_API_URLをVercelの環境変数に設定してください。')
      return
    }
    setAnalyzing(true)
    try {
      const resp = await fetch(`${renderUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: match.id, userId: profile.id }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`サーバーエラー (${resp.status}): ${text.slice(0, 100)}`)
      }
      const result = await resp.json()
      if (result.error) throw new Error(result.error)
      const { data: a } = await supabase
        .from('analysis_results')
        .select('*')
        .eq('match_id', id)
        .order('created_at', { ascending: false })
      setAnalyses(a ?? [])
    } catch (err) {
      alert('分析に失敗しました:\n' + err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) return <Layout><div className="py-12 text-center text-gray-400">読み込み中...</div></Layout>
  if (!match) return <Layout><div className="py-12 text-center text-gray-400">見つかりません</div></Layout>

  const latestAnalysis = analyses[0]
  const result = latestAnalysis?.result_json ?? {}
  const compareResult = compareIdx !== null ? analyses[compareIdx]?.result_json ?? {} : null

  const frameStatus = match.frame_status
  const canAnalyze = frameStatus === 'done'

  return (
    <Layout>
      <div className="max-w-3xl">
        {/* ヘッダー情報 */}
        <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-xl font-bold text-gray-800">
                {match.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
              </h2>
              {match.played_at && (
                <p className="text-sm text-gray-500">{new Date(match.played_at).toLocaleString('ja-JP')}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* フレーム抽出状態 */}
              <FrameStatusBadge status={frameStatus} />
              {/* 分析ボタン */}
              {canAnalyze && !analyzing && (
                <button
                  onClick={startAnalysis}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  📊 分析開始
                </button>
              )}
              {analyzing && (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                  AI分析中...
                </div>
              )}
            </div>
          </div>

          {/* 選手情報 */}
          {players.length > 0 && (
            <div className="flex gap-4 mt-3">
              {['left', 'right'].map(side => {
                const ps = players.filter(p => p.side === side)
                return (
                  <div key={side} className={`flex-1 p-3 rounded-lg ${side === 'left' ? 'bg-blue-50' : 'bg-red-50'}`}>
                    <div className="text-xs text-gray-500 mb-1">{side === 'left' ? '左側' : '右側'}</div>
                    {ps.map((p, i) => {
                      const person = p.users ?? p.opponents
                      return person ? (
                        <div key={i} className="font-medium text-sm text-gray-800">{person.name}</div>
                      ) : null
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* フレーム一覧（サムネイル） */}
        {frames.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
            <h3 className="font-semibold text-gray-700 mb-3">抽出フレーム（{frames.length}枚）</h3>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {frames.map(f => (
                <div key={f.id} className="aspect-video bg-gray-100 rounded overflow-hidden">
                  <img src={f.image_url} alt={`${f.frame_time}s`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* コーチ・本人メモ */}
        <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
          <h3 className="font-semibold text-gray-700 mb-2">📝 コーチ・本人メモ</h3>
          <p className="text-xs text-gray-400 mb-2">
            気づいた点・サーブの種類・ミスのパターンなど自由に記録してください。AI分析時に参考情報として使用されます。
          </p>
          <textarea
            value={coachMemo}
            onChange={e => setCoachMemo(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="例：相手は下回転サーブが多め。バック側が弱い。3球目はフォアドライブを狙ってくる..."
          />
          <div className="flex items-center justify-end mt-2 gap-2">
            {memoSaved && <span className="text-xs text-green-600">保存しました ✓</span>}
            <button
              type="button"
              onClick={saveMemo}
              disabled={savingMemo}
              className="text-sm bg-gray-700 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {savingMemo ? '保存中...' : 'メモを保存'}
            </button>
          </div>
        </div>

        {/* 分析結果 */}
        {latestAnalysis && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-700">AI分析結果</h3>
                <p className="text-xs text-gray-400">{new Date(latestAnalysis.created_at).toLocaleString('ja-JP')}</p>
              </div>
              <div className="flex items-center gap-2">
                {analyses.length > 1 && (
                  <select
                    value={compareIdx ?? ''}
                    onChange={e => setCompareIdx(e.target.value === '' ? null : Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
                  >
                    <option value="">比較なし</option>
                    {analyses.slice(1).map((a, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(a.created_at).toLocaleDateString('ja-JP')}と比較
                      </option>
                    ))}
                  </select>
                )}
                {canAnalyze && !analyzing && (
                  <button onClick={startAnalysis} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                    再分析
                  </button>
                )}
              </div>
            </div>

            {/* タブ */}
            <div className="flex gap-1 overflow-x-auto pb-2 mb-4 border-b">
              {ANALYSIS_TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeTab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* タブコンテンツ */}
            <div className={compareResult ? 'grid grid-cols-2 gap-4' : ''}>
              <AnalysisSection data={result[activeTab]} label={compareResult ? '最新' : null} />
              {compareResult && <AnalysisSection data={compareResult[activeTab]} label="比較" muted />}
            </div>
          </div>
        )}

        {!latestAnalysis && canAnalyze && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">
            <div className="text-4xl mb-3">📊</div>
            <p>分析はまだ実行されていません</p>
            <p className="text-sm mt-1">上のメモを入力してから「分析開始」を押してください</p>
            {!analyzing ? (
              <button onClick={startAnalysis} className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium">
                📊 分析開始
              </button>
            ) : (
              <div className="mt-4 flex items-center justify-center gap-2 text-blue-600 text-sm">
                <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                AI分析中...
              </div>
            )}
          </div>
        )}

        {!canAnalyze && frameStatus !== 'done' && (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">
            <div className="text-4xl mb-3">⏳</div>
            <p>フレーム処理待ち...</p>
          </div>
        )}
      </div>
    </Layout>
  )
}

function FrameStatusBadge({ status }) {
  const map = {
    pending: { label: 'フレーム抽出待ち', cls: 'bg-yellow-100 text-yellow-700' },
    processing: { label: 'フレーム抽出中', cls: 'bg-blue-100 text-blue-700' },
    done: { label: 'フレーム抽出完了', cls: 'bg-green-100 text-green-700' },
    error: { label: 'エラー', cls: 'bg-red-100 text-red-700' },
  }
  const { label, cls } = map[status] ?? map.pending
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

function AnalysisSection({ data, label, muted }) {
  if (!data) return <div className="text-sm text-gray-400 italic py-4 text-center">このデータは含まれていません</div>

  // オブジェクトの場合はキーごとに表示
  if (typeof data === 'object' && !Array.isArray(data)) {
    return (
      <div>
        {label && <div className={`text-xs font-medium mb-3 ${muted ? 'text-gray-400' : 'text-blue-600'}`}>{label}</div>}
        <div className="space-y-3">
          {Object.entries(data).map(([key, val]) => (
            <div key={key} className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">{key}</div>
              <div className={`text-sm leading-relaxed ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
                {Array.isArray(val) ? val.join('、') : (val ?? 'データなし')}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 配列の場合
  if (Array.isArray(data)) {
    return (
      <div>
        {label && <div className={`text-xs font-medium mb-2 ${muted ? 'text-gray-400' : 'text-blue-600'}`}>{label}</div>}
        <ul className="space-y-1">
          {data.map((item, i) => (
            <li key={i} className={`text-sm flex gap-2 ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
              <span className="text-blue-400 mt-0.5">•</span><span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const text = String(data)
  return (
    <div>
      {label && <div className={`text-xs font-medium mb-2 ${muted ? 'text-gray-400' : 'text-blue-600'}`}>{label}</div>}
      <div className={`text-sm leading-relaxed whitespace-pre-wrap ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
        {text}
      </div>
    </div>
  )
}
