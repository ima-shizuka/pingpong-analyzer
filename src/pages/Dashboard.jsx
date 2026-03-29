import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

export default function Dashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ matches: 0, opponents: 0, analyses: 0 })

  useEffect(() => {
    if (!profile?.club_id) return
    async function loadStats() {
      const [{ count: matches }, { count: opponents }, { count: analyses }] = await Promise.all([
        supabase.from('matches').select('*', { count: 'exact', head: true }).eq('club_id', profile.club_id),
        supabase.from('opponents').select('*', { count: 'exact', head: true }).eq('club_id', profile.club_id),
        supabase.from('analysis_results').select('*', { count: 'exact', head: true }),
      ])
      setStats({ matches: matches ?? 0, opponents: opponents ?? 0, analyses: analyses ?? 0 })
    }
    loadStats()
  }, [profile])

  const cards = [
    { label: '試合記録', value: stats.matches, unit: '件', to: '/matches', icon: '🎥', color: 'blue' },
    { label: '対戦相手', value: stats.opponents, unit: '人', to: '/opponents', icon: '🏓', color: 'green' },
    { label: '分析完了', value: stats.analyses, unit: '件', to: '/matches', icon: '📊', color: 'purple' },
  ]

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">
          こんにちは、{profile?.name ?? 'ゲスト'}さん
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {profile?.clubs?.name ? `${profile.clubs.name} のダッシュボード` : ''}
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map(({ label, value, unit, to, icon, color }) => (
          <Link
            key={to}
            to={to}
            className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-3xl">{icon}</span>
              <span className={`text-xs font-medium bg-${color}-100 text-${color}-700 px-2 py-0.5 rounded-full`}>
                {label}
              </span>
            </div>
            <div className="text-3xl font-bold text-gray-800">
              {value}<span className="text-base font-normal text-gray-500 ml-1">{unit}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* クイックアクション */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h3 className="font-semibold text-gray-700 mb-4">クイックアクション</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            to="/matches/upload"
            className="flex items-center gap-3 p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            <span className="text-2xl">🎬</span>
            <div>
              <div className="font-medium text-gray-800">試合動画をアップロード</div>
              <div className="text-xs text-gray-500">最大10分の動画に対応</div>
            </div>
          </Link>
          <Link
            to="/opponents/new"
            className="flex items-center gap-3 p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
          >
            <span className="text-2xl">➕</span>
            <div>
              <div className="font-medium text-gray-800">対戦相手を登録</div>
              <div className="text-xs text-gray-500">相手の情報を記録する</div>
            </div>
          </Link>
          <Link
            to="/profile"
            className="flex items-center gap-3 p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span className="text-2xl">👤</span>
            <div>
              <div className="font-medium text-gray-800">プロフィール設定</div>
              <div className="text-xs text-gray-500">名前・学年・ラバー情報</div>
            </div>
          </Link>
          {profile?.role === 'club_admin' && (
            <Link
              to="/admin"
              className="flex items-center gap-3 p-4 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
            >
              <span className="text-2xl">⚙️</span>
              <div>
                <div className="font-medium text-gray-800">クラブ管理</div>
                <div className="text-xs text-gray-500">招待コード・メンバー管理</div>
              </div>
            </Link>
          )}
        </div>
      </div>
    </Layout>
  )
}
