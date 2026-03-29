import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '一般']
const RUBBER_TYPES = ['裏ソフト', '表ソフト', '粒高', 'アンチ', 'ラージ']

function RubberBadge({ rubber }) {
  const colors = {
    '裏ソフト': 'bg-blue-100 text-blue-700',
    '表ソフト': 'bg-green-100 text-green-700',
    '粒高': 'bg-yellow-100 text-yellow-700',
    'アンチ': 'bg-red-100 text-red-700',
    'ラージ': 'bg-purple-100 text-purple-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[rubber] ?? 'bg-gray-100 text-gray-600'}`}>
      {rubber}
    </span>
  )
}

export default function Opponents() {
  const { profile } = useAuth()
  const [opponents, setOpponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterGrade, setFilterGrade] = useState('')
  const [filterRubber, setFilterRubber] = useState('')
  const [showMembersOnly, setShowMembersOnly] = useState(false)

  const fetchOpponents = useCallback(async () => {
    if (!profile?.club_id) return
    setLoading(true)
    let query = supabase
      .from('opponents')
      .select('*')
      .eq('club_id', profile.club_id)
      .order('name')

    if (search) query = query.ilike('name', `%${search}%`)
    if (filterGrade) query = query.eq('grade', filterGrade)
    if (filterRubber) query = query.or(`rubber_forehand.eq.${filterRubber},rubber_backhand.eq.${filterRubber}`)
    if (showMembersOnly) query = query.eq('is_member', true)

    const { data } = await query
    setOpponents(data ?? [])
    setLoading(false)
  }, [profile, search, filterGrade, filterRubber, showMembersOnly])

  useEffect(() => { fetchOpponents() }, [fetchOpponents])

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">対戦相手</h2>
        <Link
          to="/opponents/new"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          ＋ 相手を登録
        </Link>
      </div>

      {/* フィルター */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="名前で検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterGrade}
            onChange={e => setFilterGrade(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全学年</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select
            value={filterRubber}
            onChange={e => setFilterRubber(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全ラバー</option>
            {RUBBER_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showMembersOnly}
              onChange={e => setShowMembersOnly(e.target.checked)}
              className="rounded"
            />
            自クラブメンバーのみ
          </label>
        </div>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">読み込み中...</div>
      ) : opponents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-5xl mb-3">🏓</div>
          <p>対戦相手が登録されていません</p>
          <Link to="/opponents/new" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
            最初の相手を登録する
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {opponents.map(opp => (
            <Link
              key={opp.id}
              to={`/opponents/${opp.id}`}
              className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-shadow p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{opp.name}</span>
                    {opp.is_member && (
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">メンバー</span>
                    )}
                  </div>
                  {opp.grade && <div className="text-xs text-gray-500 mt-0.5">{opp.grade}</div>}
                  {opp.team_name_1 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {[opp.team_name_1, opp.team_name_2, opp.team_name_3].filter(Boolean).join(' / ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {opp.rubber_forehand && <RubberBadge rubber={opp.rubber_forehand} />}
                  {opp.rubber_backhand && opp.rubber_backhand !== opp.rubber_forehand && (
                    <RubberBadge rubber={opp.rubber_backhand} />
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  )
}
