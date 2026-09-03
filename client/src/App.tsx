import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { ChatPage } from './pages/ChatPage'
import { LoginPage } from './pages/LoginPage'
import { AdminAgentsPage } from './pages/admin/AdminAgentsPage'
import { AdminCalibrationPage } from './pages/admin/AdminCalibrationPage'
import { AdminConstitutionPage } from './pages/admin/AdminConstitutionPage'
import { AdminIdentityPage } from './pages/admin/AdminIdentityPage'
import { AdminInboxPage } from './pages/admin/AdminInboxPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminLoginPage } from './pages/admin/AdminLoginPage'
import { AdminMemoryPage } from './pages/admin/AdminMemoryPage'
import { AdminModesPage } from './pages/admin/AdminModesPage'
import { AdminPeersPage } from './pages/admin/AdminPeersPage'
import { AdminSentinelPage } from './pages/admin/AdminSentinelPage'
import { AdminSessionsPage } from './pages/admin/AdminSessionsPage'
import { AdminTasksPage } from './pages/admin/AdminTasksPage'
import { AdminToolLogPage } from './pages/admin/AdminToolLogPage'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <div className="theme-kuze min-h-screen text-[var(--nx-text)]">
              <Routes>
                <Route path="/" element={<ChatPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/admin/login" element={<AdminLoginPage />} />
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<Navigate to="/admin/identity" replace />} />
                  <Route path="identity" element={<AdminIdentityPage />} />
                  <Route path="constitution" element={<AdminConstitutionPage />} />
                  <Route path="calibrate" element={<AdminCalibrationPage />} />
                  <Route path="memory" element={<AdminMemoryPage />} />
                  <Route path="sessions" element={<AdminSessionsPage />} />
                  <Route path="modes" element={<AdminModesPage />} />
                  <Route path="peers" element={<AdminPeersPage />} />
                  <Route path="agents" element={<AdminAgentsPage />} />
                  <Route path="tasks" element={<AdminTasksPage />} />
                  <Route path="inbox" element={<AdminInboxPage />} />
                  <Route path="tool-log" element={<AdminToolLogPage />} />
                  <Route path="sentinel" element={<AdminSentinelPage />} />
                </Route>
              </Routes>
            </div>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
