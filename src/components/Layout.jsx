import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'ダッシュボード', icon: '🏠' },
  { to: '/opponents', label: '対戦相手', icon: '🏓' },
  { to: '/matches', label: '試合記録', icon: '🎥' },
  { to: '/profile', label: 'プロフィール', icon: '👤' },
]

export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-blue-700 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏓</span>
            <span className="font-bold text-lg">卓球試合分析</span>
            {profile?.clubs?.name && (
              <span className="text-blue-200 text-sm ml-2">/ {profile.clubs.name}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-blue-100">{profile?.name ?? ''}</span>
            <button
              onClick={handleSignOut}
              className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* ナビゲーション */}
      <nav className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 flex gap-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <Link
              key={to}
              to={to}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                location.pathname.startsWith(to)
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-600 hover:text-blue-600'
              }`}
            >
              <span className="mr-1">{icon}</span>{label}
            </Link>
          ))}
        </div>
      </nav>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  )
}
