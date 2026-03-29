import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import PrivateRoute from './components/PrivateRoute'

import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Opponents from './pages/Opponents'
import OpponentForm from './pages/OpponentForm'
import OpponentDetail from './pages/OpponentDetail'
import Matches from './pages/Matches'
import MatchUpload from './pages/MatchUpload'
import MatchDetail from './pages/MatchDetail'
import Admin from './pages/Admin'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />

          <Route path="/opponents" element={<PrivateRoute><Opponents /></PrivateRoute>} />
          <Route path="/opponents/new" element={<PrivateRoute><OpponentForm /></PrivateRoute>} />
          <Route path="/opponents/:id" element={<PrivateRoute><OpponentDetail /></PrivateRoute>} />
          <Route path="/opponents/:id/edit" element={<PrivateRoute><OpponentForm /></PrivateRoute>} />

          <Route path="/matches" element={<PrivateRoute><Matches /></PrivateRoute>} />
          <Route path="/matches/upload" element={<PrivateRoute><MatchUpload /></PrivateRoute>} />
          <Route path="/matches/:id" element={<PrivateRoute><MatchDetail /></PrivateRoute>} />

          <Route path="/admin" element={<PrivateRoute><Admin /></PrivateRoute>} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
