import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

export default function Matches() {
  const { profile } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.club_id) return
    supabase
      .from('matches')
      .select('*, analysis_results(id)')
      .eq('club_id', profile.club_id)
      .order('played_at', { ascending: false })
      .then(({ data }) => {
        setMatches(data ?? [])
        setLoading(false)
      })
  }, [profile])

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  }

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">試合記録</h2>
        <Link
          to="/matches/upload"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          ＋ 動画をアップロード
        </Link>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">読み込み中...</div>
      ) : matches.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-5xl mb-3">🎥</div>
          <p>試合記録がありません</p>
          <Link to="/matches/upload" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
            最初の動画をアップロードする
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map(m => (
            <Link
              key={m.id}
              to={`/matches/${m.id}`}
              className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-medium text-gray-800">
                  {m.match_type === 'doubles' ? 'ダブルス' : 'シングルス'}
                </div>
                <div className="text-sm text-gray-500">
                  {m.played_at ? new Date(m.played_at).toLocaleString('ja-JP') : '日時未設定'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[m.frame_status] ?? statusColors.pending}`}>
                  {{ pending: '待機中', processing: '抽出中', done: '完了', error: 'エラー' }[m.frame_status] ?? '待機中'}
                </span>
                {m.analysis_results?.length > 0 && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                    分析済み
                  </span>
                )}
                <span className="text-gray-300">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  )
}
