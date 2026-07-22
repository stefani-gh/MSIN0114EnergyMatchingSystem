import { useState, type ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/Layout'
import { PageContainer, PlaceholderNotice } from './components/ui'
import { DashboardPage } from './pages/DashboardPage'
import { DataUploadPage } from './pages/DataUploadPage'
import { DownloadTemplatesPage } from './pages/DownloadTemplatesPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { HowToUsePage } from './pages/HowToUsePage'
import { LoginPage } from './pages/LoginPage'
import { CustomerPage, GeneratorPage } from './pages/RegistryPage'
import { ResultsDetailPage, ResultsPage } from './pages/ResultsPage'
import { SettingsPage } from './pages/SettingsPage'
import { BusinessGroupPage, SystemSettingPage } from './pages/SystemSettingPage'
import type { PagePrivilegeKey } from './data/mockData'
import { MatchingResultsProvider } from './matchingResults'
import {
  getFirstReadablePagePath,
  getPageAccess,
  getSessionRoleName,
} from './permissions'
import {
  MockSessionContext,
  defaultSession,
  demoUsers,
  useMockSession,
  type DemoUser,
  type MockSession,
  type UserRole,
} from './session'
import { SystemSettingsProvider } from './systemSettings'
import { useSystemSettings } from './systemSettingsContext'

const sessionKey = 'energy-matching-demo-session'

function readStoredSession(): MockSession {
  try {
    const stored = window.localStorage.getItem(sessionKey)
    if (!stored) {
      return defaultSession
    }

    const parsed = JSON.parse(stored) as MockSession
    if (parsed.role !== 'admin' && parsed.role !== 'standard') {
      return defaultSession
    }

    return {
      isLoggedIn: Boolean(parsed.isLoggedIn),
      role: parsed.role,
      user: {
        ...demoUsers[parsed.role],
        ...sanitizeStoredUser(parsed.user, parsed.role),
      },
    }
  } catch {
    return defaultSession
  }
}

function sanitizeStoredUser(user: unknown, role: UserRole): Partial<DemoUser> {
  if (!user || typeof user !== 'object') {
    return {}
  }

  const storedUser = user as Partial<DemoUser>

  return {
    displayName:
      typeof storedUser.displayName === 'string' &&
      storedUser.displayName.trim()
        ? storedUser.displayName
        : demoUsers[role].displayName,
    username:
      typeof storedUser.username === 'string'
        ? storedUser.username
        : demoUsers[role].username,
    email:
      typeof storedUser.email === 'string'
        ? storedUser.email
        : demoUsers[role].email,
    role,
  }
}

function App() {
  const [session, setSession] = useState<MockSession>(readStoredSession)

  function login(role: UserRole) {
    const nextSession: MockSession = {
      isLoggedIn: true,
      role,
      user: demoUsers[role],
    }

    window.localStorage.setItem(sessionKey, JSON.stringify(nextSession))
    setSession(nextSession)
  }

  function logout() {
    window.localStorage.removeItem(sessionKey)
    setSession(defaultSession)
  }

  function updateUser(user: Partial<DemoUser>) {
    const nextSession: MockSession = {
      ...session,
      user: {
        ...session.user,
        ...user,
        role: session.role,
      },
    }

    window.localStorage.setItem(sessionKey, JSON.stringify(nextSession))
    setSession(nextSession)
  }

  return (
    <MockSessionContext.Provider value={{ session, login, logout, updateUser }}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              session.isLoggedIn ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <LoginPage />
              )
            }
          />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route
            element={
              session.isLoggedIn ? (
                <MatchingResultsProvider>
                  <SystemSettingsProvider>
                    <AppLayout />
                  </SystemSettingsProvider>
                </MatchingResultsProvider>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={
                <PageAccessGate pageKey="dashboard">
                  {({ readOnly }) => <DashboardPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/data-upload"
              element={
                <PageAccessGate pageKey="data-upload">
                  {({ readOnly }) => <DataUploadPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/results"
              element={
                <PageAccessGate pageKey="results">
                  {() => <ResultsPage />}
                </PageAccessGate>
              }
            />
            <Route
              path="/results/view"
              element={
                <PageAccessGate pageKey="results">
                  {({ readOnly }) => (
                    <ResultsDetailPage readOnly={readOnly} />
                  )}
                </PageAccessGate>
              }
            />
            <Route
              path="/download-templates"
              element={
                <PageAccessGate pageKey="download-templates">
                  {({ readOnly }) => (
                    <DownloadTemplatesPage readOnly={readOnly} />
                  )}
                </PageAccessGate>
              }
            />
            <Route
              path="/customer"
              element={
                <PageAccessGate pageKey="customer">
                  {({ readOnly }) => <CustomerPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/generator"
              element={
                <PageAccessGate pageKey="generator">
                  {({ readOnly }) => <GeneratorPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/business-group"
              element={
                <PageAccessGate pageKey="business-group">
                  {({ readOnly }) => <BusinessGroupPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/how-to-use"
              element={
                <PageAccessGate pageKey="how-to-use">
                  {() => <HowToUsePage />}
                </PageAccessGate>
              }
            />
            <Route
              path="/settings"
              element={
                <PageAccessGate pageKey="settings">
                  {({ readOnly }) => <SettingsPage readOnly={readOnly} />}
                </PageAccessGate>
              }
            />
            <Route
              path="/system-admin"
              element={<Navigate to="/system-setting/manage-users" replace />}
            />
            <Route
              path="/system-setting/:subFunction"
              element={<SystemSettingPage />}
            />
            <Route path="/access-denied" element={<AccessDeniedPage />} />
          </Route>
          <Route
            path="*"
            element={
              <Navigate
                to={session.isLoggedIn ? '/dashboard' : '/login'}
                replace
              />
            }
          />
        </Routes>
      </BrowserRouter>
    </MockSessionContext.Provider>
  )
}

function PageAccessGate({
  pageKey,
  children,
}: {
  pageKey: PagePrivilegeKey
  children: (access: { readOnly: boolean }) => ReactElement
}) {
  const { session } = useMockSession()
  const { permissions } = useSystemSettings()
  const roleName = getSessionRoleName(session.role)
  const access = getPageAccess(permissions, roleName, pageKey)

  if (!access.canRead) {
    return (
      <Navigate
        to={getFirstReadablePagePath(permissions, roleName) ?? '/access-denied'}
        replace
      />
    )
  }

  return children({ readOnly: !access.canMaintain })
}

function AccessDeniedPage() {
  return (
    <PageContainer
      title="Access Denied"
      description="Your role does not currently have access to any pages."
    >
      <PlaceholderNotice>
        Ask an administrator to update your role permissions.
      </PlaceholderNotice>
    </PageContainer>
  )
}

export default App
