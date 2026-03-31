import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '一般']
const RUBBER_TYPES = ['裏ソフト', '表ソフト', '粒高', 'アンチ', 'ラージ']
const HANDEDNESS = ['右利き', '左利き', '両利き']

export default function Profile() {
  const { profile, refreshProfile } = useAuth()
  const [form, setForm] = useState({
    name: '',
    grade: '',
    handedness: '右利き',
    rubber_forehand: '裏ソフト',
    rubber_backhand: '裏ソフト',
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        grade: profile.grade ?? '',
        handedness: profile.handedness ?? '右利き',
        rubber_forehand: profile.rubber_forehand ?? '裏ソフト',
        rubber_backhand: profile.rubber_backhand ?? '裏ソフト',
      })
    }
  }, [profile])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!profile?.id) { setError('ログイン情報が取得できません。再ログインしてください。'); return }
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const { data, error: err } = await supabase
        .from('users')
        .update(form)
        .eq('id', profile.id)
        .select()
      if (err) {
        setError(`保存エラー: ${err.message}`)
      } else {
        await refreshProfile()
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      }
    } catch (e) {
      setError(`予期しないエラー: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-lg">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">プロフィール設定</h2>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-4 text-sm">
              プロフィールを保存しました
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">お名前</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="山田 太郎"
              />
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

            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">所属クラブ</label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 text-sm">
                {profile?.clubs?.name ?? '—'}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {saving ? '保存中...' : '保存する'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  )
}
