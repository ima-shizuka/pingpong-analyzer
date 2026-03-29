import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

function RubberBadge({ label, rubber }) {
  const colors = {
    '裏ソフト': 'bg-blue-100 text-blue-700',
    '表ソフト': 'bg-green-100 text-green-700',
    '粒高': 'bg-yellow-100 text-yellow-700',
    'アンチ': 'bg-red-100 text-red-700',
    'ラージ': 'bg-purple-100 text-purple-700',
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-12">{label}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[rubber] ?? 'bg-gray-100 text-gray-600'}`}>
        {rubber}
      </span>
    </div>
  )
}

export default function OpponentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [opponent, setOpponent] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: opp }, { data: matchData }] = await Promise.all([
        supabase.from('opponents').select('*').eq('id', id).single(),
        supabase
          .from('match_players')
          .select('match_id, side, matches(id, played_at, match_type, analysis_results(id))')
          .eq('opponent_id', id)
          .order('created_at', { ascending: false }),
      ])
      setOpponent(opp)
      setMatches(matchData ?? [])
      setLoading(false)
    }
    load()
  }, [id])

  async function handleDelete() {
    if (!confirm(`「${opponent?.name}」を削除しますか？`)) return
    await supabase.from('opponents').delete().eq('id', id)
    navigate('/opponents')
  }

  if (loading) return <Layout><div className="py-12 text-center text-gray-400">読み込み中...</div></Layout>
  if (!opponent) return <Layout><div className="py-12 text-center text-gray-400">見つかりません</div></Layout>

  const teams = [opponent.team_name_1, opponent.team_name_2, opponent.team_name_3].filter(Boolean)

  return (
    <Layout>
      <div className="max-w-2xl">
        {/* ヘッダー */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold text-gray-800">{opponent.name}</h2>
              {opponent.is_member && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">メンバー</span>
              )}
            </div>
            {opponent.grade && <p className="text-gray-500 text-sm">{opponent.grade}</p>}
            {teams.length > 0 && (
              <p className="text-gray-500 text-sm">{teams.join(' / ')}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              to={`/opponents/${id}/edit`}
              className="text-sm border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              編集
            </Link>
            <button
              onClick={handleDelete}
              className="text-sm border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
            >
              削除
            </button>
          </div>
        </div>

        {/* ラバー情報 */}
        <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
          <h3 className="font-semibold text-gray-700 mb-3">ラバー設定</h3>
          <div className="space-y-2">
            <RubberBadge label="フォア" rubber={opponent.rubber_forehand} />
            <RubberBadge label="バック" rubber={opponent.rubber_backhand} />
          </div>
        </div>

        {/* 対戦履歴 */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700">対戦履歴</h3>
            <span className="text-sm text-gray-400">{matches.length}件</span>
          </div>

          {matches.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2">🎥</div>
              <p className="text-sm">まだ対戦記録がありません</p>
              <Link to="/matches/upload" className="text-blue-600 hover:underline text-sm mt-1 inline-block">
                試合動画をアップロードする
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {matches.map(mp => {
                const match = mp.matches
                if (!match) return null
                const hasAnalysis = match.analysis_results?.length > 0
                return (
                  <Link
                    key={mp.match_id}
                    to={`/matches/${mp.match_id}`}
                    className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium text-gray-700">
                        {match.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {match.played_at ? new Date(match.played_at).toLocaleDateString('ja-JP') : '日時未設定'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasAnalysis ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">分析済み</span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">未分析</span>
                      )}
                      <span className="text-gray-300">›</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
