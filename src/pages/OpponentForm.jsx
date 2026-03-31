import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '一般']
const RUBBER_TYPES = ['裏ソフト', '表ソフト', '粒高', 'アンチ', 'ラージ']
const HANDEDNESS = ['右利き', '左利き', '両利き']

export default function OpponentForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: '',
    grade: '',
    handedness: '右利き',
    team_name_1: '',
    team_name_2: '',
    team_name_3: '',
    rubber_forehand: '裏ソフト',
    rubber_backhand: '裏ソフト',
    is_member: false,
    member_user_id: '',
  })
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile?.club_id) return
    // クラブメンバー取得
    supabase
      .from('users')
      .select('id, name, grade, rubber_forehand, rubber_backhand')
      .eq('club_id', profile.club_id)
      .order('name')
      .then(({ data }) => setMembers(data ?? []))

    // 編集時は既存データ取得
    if (isEdit) {
      supabase.from('opponents').select('*').eq('id', id).single().then(({ data }) => {
        if (data) setForm({
          name: data.name ?? '',
          grade: data.grade ?? '',
          handedness: data.handedness ?? '右利き',
          team_name_1: data.team_name_1 ?? '',
          team_name_2: data.team_name_2 ?? '',
          team_name_3: data.team_name_3 ?? '',
          rubber_forehand: data.rubber_forehand ?? '裏ソフト',
          rubber_backhand: data.rubber_backhand ?? '裏ソフト',
          is_member: data.is_member ?? false,
          member_user_id: data.member_user_id ?? '',
        })
      })
    }
  }, [profile, id, isEdit])

  // メンバー選択時に自動入力
  function handleMemberSelect(userId) {
    const m = members.find(m => m.id === userId)
    if (!m) {
      setForm(f => ({ ...f, member_user_id: '', name: '', grade: '', handedness: '右利き', rubber_forehand: '裏ソフト', rubber_backhand: '裏ソフト' }))
      return
    }
    setForm(f => ({
      ...f,
      member_user_id: userId,
      name: m.name,
      grade: m.grade ?? '',
      handedness: m.handedness ?? '右利き',
      rubber_forehand: m.rubber_forehand ?? '裏ソフト',
      rubber_backhand: m.rubber_backhand ?? '裏ソフト',
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('名前は必須です'); return }
    if (!profile?.club_id) { setError('クラブ情報が取得できません。再ログインしてください。'); return }
    setSaving(true)
    setError('')

    try {
      const payload = { ...form, club_id: profile.club_id }
      if (!payload.member_user_id) payload.member_user_id = null

      const { error: err } = isEdit
        ? await supabase.from('opponents').update(payload).eq('id', id)
        : await supabase.from('opponents').insert(payload)

      if (err) { setError(`登録エラー: ${err.message}`); return }
      navigate('/opponents')
    } catch (e) {
      setError(`予期しないエラー: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-lg">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">
          {isEdit ? '対戦相手を編集' : '対戦相手を登録'}
        </h2>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 自クラブメンバーから選択 */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_member}
                  onChange={e => setForm(f => ({ ...f, is_member: e.target.checked, member_user_id: '' }))}
                  className="rounded"
                />
                自クラブのメンバーを相手として設定
              </label>
              {form.is_member && (
                <select
                  value={form.member_user_id}
                  onChange={e => handleMemberSelect(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">メンバーを選択...</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>{m.name}{m.grade ? `（${m.grade}）` : ''}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名前 <span className="text-red-500">*</span></label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="田中 二郎"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">利き手</label>
              <div className="flex gap-3">
                {HANDEDNESS.map(h => (
                  <label key={h} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="handedness"
                      value={h}
                      checked={form.handedness === h}
                      onChange={e => setForm(f => ({ ...f, handedness: e.target.value }))}
                      className="text-blue-600"
                    />
                    <span className="text-sm text-gray-700">{h}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">学年</label>
              <select
                value={form.grade}
                onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">選択してください</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>

            <fieldset className="border border-gray-200 rounded-lg p-4">
              <legend className="text-sm font-medium text-gray-700 px-2">所属チーム（最大3つ）</legend>
              <div className="space-y-2">
                {[1, 2, 3].map(n => (
                  <input
                    key={n}
                    type="text"
                    value={form[`team_name_${n}`]}
                    onChange={e => setForm(f => ({ ...f, [`team_name_${n}`]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`チーム名 ${n}${n === 1 ? '（必要なら）' : '（任意）'}`}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="border border-gray-200 rounded-lg p-4">
              <legend className="text-sm font-medium text-gray-700 px-2">ラバー設定</legend>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">フォア面</label>
                  <select
                    value={form.rubber_forehand}
                    onChange={e => setForm(f => ({ ...f, rubber_forehand: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {RUBBER_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">バック面</label>
                  <select
                    value={form.rubber_backhand}
                    onChange={e => setForm(f => ({ ...f, rubber_backhand: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {RUBBER_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </fieldset>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate('/opponents')}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {saving ? '保存中...' : isEdit ? '更新する' : '登録する'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
}
