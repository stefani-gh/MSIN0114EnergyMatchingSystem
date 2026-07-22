import { createContext, useContext } from 'react'
import type {
  BusinessGroup,
  ManagedUser,
  PermissionName,
  RoleName,
} from './data/mockData'

export type RolePermissions = Record<PermissionName, Record<RoleName, boolean>>

export type SystemSettingsContextValue = {
  roles: RoleName[]
  users: ManagedUser[]
  businessGroups: BusinessGroup[]
  addBusinessGroup: (businessGroup: Omit<BusinessGroup, 'id'>) => void
  updateBusinessGroup: (businessGroup: BusinessGroup) => void
  deleteBusinessGroup: (businessGroupId: string) => void
  addRole: (role: RoleName, selectedPermissions: PermissionName[]) => void
  addUser: (user: Omit<ManagedUser, 'id'>) => void
  updateUser: (user: ManagedUser) => void
  deleteUser: (userId: string) => void
  permissions: RolePermissions
  togglePermission: (permission: PermissionName, role: RoleName) => void
  updatePermissions: (permissions: RolePermissions) => void
}

export const SystemSettingsContext =
  createContext<SystemSettingsContextValue | null>(null)

export function useSystemSettings() {
  const context = useContext(SystemSettingsContext)

  if (!context) {
    throw new Error('useSystemSettings must be used inside SystemSettingsProvider')
  }

  return context
}
