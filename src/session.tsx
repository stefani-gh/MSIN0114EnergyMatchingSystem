import { createContext, useContext } from 'react'

export type UserRole = 'admin' | 'standard'

export type DemoUser = {
  displayName?: string
  username: string
  email: string
  role: UserRole
}

export type MockSession = {
  isLoggedIn: boolean
  role: UserRole
  user: DemoUser
}

export type MockSessionContextValue = {
  session: MockSession
  login: (role: UserRole) => void
  logout: () => void
  updateUser: (user: Partial<DemoUser>) => void
}

export const demoUsers: Record<UserRole, DemoUser> = {
  admin: {
    displayName: 'Admin',
    username: 'admin.user',
    email: 'admin.user@example-energy.co.uk',
    role: 'admin',
  },
  standard: {
    displayName: 'Standard User',
    username: 'standard.user',
    email: 'standard.user@example-energy.co.uk',
    role: 'standard',
  },
}

export const defaultSession: MockSession = {
  isLoggedIn: false,
  role: 'standard',
  user: demoUsers.standard,
}

export const MockSessionContext =
  createContext<MockSessionContextValue | null>(null)

export function useMockSession() {
  const context = useContext(MockSessionContext)

  if (!context) {
    throw new Error('useMockSession must be used inside MockSessionContext')
  }

  return context
}
