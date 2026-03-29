import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function Admin() {
  const { profile } = useAuth()
  const [members, setMembers] = useState([])
  const [inviteCodes, setInviteCodes] = useState([])
  const [club, setClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newCode, setNewCode] = useState('')
  const [generatingCode, setGeneratingCode] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!profile?.club_id || profile?.role !== 'club_admin') return
    load()
  }, [profile])

  async function load() {
    const [{ data: c }, { data: m }, { data: ic }] = await Promise.all([
      supabase.from('clubs').select('*').eq('id', profile.club_id).single(),
      supabase.from('users').select('id, name, grade, role, rubber_forehand, rubber_backhand, created_at').eq('club_id', profile.club_id).order('name'),
      supabase.from('invite_codes').select('*').eq('club_id', profile.club_id).order('created_at', { ascending: false }),
    ])
    setClub(c)
    setMembers(m ?? [])
    setInviteCodes(ic ?? [])
    setLoading(false)
  }

  async function issueInviteCode() {
    setGeneratingCode(true)
    const code = generateCode()
    const { data } = await supabase
      .from('invite_codes')
      .insert({ club_id: profile.club_id, code, created_by: profile.id, expires_at: null, is_active: true })
      .select()
      .single()
    if (data) {
      setInviteCodes(prev => [data, ...prev])
      setNewCode(code)
      // クラブのコードも更新（常に最新を使う場合）
      await supabase.from('clubs').update({ code }).eq('id', profile.club_id)
    }
    setGeneratingCode(false)
  }

  async function toggleCodeActive(codeId, current) {
    await supabase.from('invite_codes').update({ is_active: !current }).eq('id', codeId)
    setInviteCodes(prev => prev.map(c => c.id === codeId ? { ...c, is_active: !current } : c))
  }

  async function changeRole(userId, newRole) {
    await supabase.from('users').update({ role: newRole }).eq('id', userId)
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m))
  }

  async function copyCode(code) {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (profile?.role !== 'club_admin') {
    return (
      <Layout>
        <div className="py-12 text-center text-gray-400">
          <div className="text-5xl mb-3">🔒</div>
          <p>管理者のみアクセスできます</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">クラブ管理</h2>

      {loading ? (
        <div className="py-12 text-center text-gray-400">読み込み中...</div>
      ) : (
        <div className="space-y-6 max-w-3xl">
          {/* クラブ情報 */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h3 className="font-semibold text-gray-700 mb-3">クラブ情報</h3>
            <div className="text-lg font-bold text-gray-800">{club?.name}</div>
            <div className="flex items-center gap-3 mt-2">
              <div className="font-mono text-xl tracking-widest font-bold text-blue-700 bg-blue-50 px-4 py-2 rounded-lg">
                {club?.code}
              </div>
              <button
                onClick={() => copyCode(club?.code)}
                className="text-sm text-gray-500 hover:text-blue-600 border border-gray-300 px-3 py-1.5 rounded-lg"
              >
                {copied ? 'コピー済み ✓' : 'コピー'}
              </button>
            </div>
          </div>

          {/* 招待コード管理 */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-700">招待コード管理</h3>
              <button
                onClick={issueInviteCode}
                disabled={generatingCode}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
              >
                {generatingCode ? '生成中...' : '新しいコードを発行'}
              </button>
            </div>

            {newCode && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <div className="text-sm text-green-700 mb-1">新しいコードを発行しました</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xl font-bold tracking-widest text-green-800">{newCode}</span>
                  <button onClick={() => copyCode(newCode)} className="text-xs text-green-600 border border-green-300 px-2 py-1 rounded">
                    コピー
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {inviteCodes.map(ic => (
                <div key={ic.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className={`font-mono font-bold tracking-widest ${ic.is_active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                      {ic.code}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ic.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {ic.is_active ? '有効' : '無効'}
                    </span>
                  </div>
                  <button
                    onClick={() => toggleCodeActive(ic.id, ic.is_active)}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2 py-1 rounded"
                  >
                    {ic.is_active ? '無効化' : '有効化'}
                  </button>
                </div>
              ))}
              {inviteCodes.length === 0 && (
                <p className="text-sm text-gray-400">まだ招待コードがありません</p>
              )}
            </div>
          </div>

          {/* メンバー一覧 */}
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h3 className="font-semibold text-gray-700 mb-4">メンバー一覧（{members.length}名）</h3>
            <div className="space-y-2">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-800">{m.name}</div>
                    <div className="text-xs text-gray-500">
                      {m.grade && <span>{m.grade} / </span>}
                      フォア: {m.rubber_forehand ?? '未設定'} / バック: {m.rubber_backhand ?? '未設定'}
                    </div>
                  </div>
                  <select
                    value={m.role ?? 'member'}
                    onChange={e => changeRole(m.id, e.target.value)}
                    disabled={m.id === profile.id}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none disabled:opacity-50"
                  >
                    <option value="member">メンバー</option>
                    <option value="club_admin">管理者</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
