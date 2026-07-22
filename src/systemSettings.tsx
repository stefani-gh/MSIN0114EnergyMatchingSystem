import { useState, type ReactNode } from 'react'
import {
  initialBusinessGroups,
  initialUsers,
  pagePrivileges,
  permissionList,
  rolesList,
  type BusinessGroup,
  type ManagedUser,
  type PagePrivilegeKey,
  type PermissionName,
  type RoleName,
} from './data/mockData'
import {
  normalizeRolePermissions,
  setRolePermission,
} from './permissions'
import {
  SystemSettingsContext,
  type RolePermissions,
} from './systemSettingsContext'

const standardUserMaintainPages = new Set<PagePrivilegeKey>([
  'dashboard',
  'data-upload',
  'results',
  'download-templates',
  'customer',
  'generator',
  'business-group',
  'how-to-use',
  'settings',
])

const initialPermissions = createInitialPermissions()

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const [roles, setRoles] = useState<RoleName[]>(rolesList)
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers)
  const [businessGroups, setBusinessGroups] =
    useState<BusinessGroup[]>(initialBusinessGroups)
  const [permissions, setPermissions] =
    useState<RolePermissions>(initialPermissions)

  function addRole(role: RoleName, selectedPermissions: PermissionName[]) {
    setRoles((currentRoles) => [...currentRoles, role])
    setPermissions((currentPermissions) => {
      const nextPermissions = normalizeRolePermissions(currentPermissions, [
        ...roles,
        role,
      ])

      permissionList.forEach((permission) => {
        nextPermissions[permission] = {
          ...nextPermissions[permission],
          [role]: selectedPermissions.includes(permission),
        }
      })

      return normalizeRolePermissions(nextPermissions, [...roles, role])
    })
  }

  function addUser(user: Omit<ManagedUser, 'id'>) {
    setUsers((currentUsers) => [
      ...currentUsers,
      {
        ...user,
        id: `u-${Date.now()}`,
      },
    ])
  }

  function updateUser(updatedUser: ManagedUser) {
    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === updatedUser.id ? updatedUser : user,
      ),
    )
  }

  function addBusinessGroup(businessGroup: Omit<BusinessGroup, 'id'>) {
    setBusinessGroups((currentBusinessGroups) => [
      ...currentBusinessGroups,
      {
        ...businessGroup,
        id: `bg-${Date.now()}`,
      },
    ])
  }

  function updateBusinessGroup(updatedBusinessGroup: BusinessGroup) {
    setBusinessGroups((currentBusinessGroups) =>
      currentBusinessGroups.map((businessGroup) =>
        businessGroup.id === updatedBusinessGroup.id
          ? updatedBusinessGroup
          : businessGroup,
      ),
    )
  }

  function deleteBusinessGroup(businessGroupId: string) {
    setBusinessGroups((currentBusinessGroups) =>
      currentBusinessGroups.filter(
        (businessGroup) => businessGroup.id !== businessGroupId,
      ),
    )
  }

  function deleteUser(userId: string) {
    setUsers((currentUsers) => currentUsers.filter((user) => user.id !== userId))
  }

  function togglePermission(permission: PermissionName, role: RoleName) {
    setPermissions((currentPermissions) =>
      setRolePermission(
        currentPermissions,
        role,
        permission,
        !currentPermissions[permission]?.[role],
      ),
    )
  }

  function updatePermissions(nextPermissions: RolePermissions) {
    setPermissions(normalizeRolePermissions(nextPermissions, roles))
  }

  return (
    <SystemSettingsContext.Provider
      value={{
        roles,
        users,
        businessGroups,
        addBusinessGroup,
        updateBusinessGroup,
        deleteBusinessGroup,
        addRole,
        addUser,
        updateUser,
        deleteUser,
        permissions,
        togglePermission,
        updatePermissions,
      }}
    >
      {children}
    </SystemSettingsContext.Provider>
  )
}

function createInitialPermissions() {
  const initialPermissions = {} as RolePermissions

  permissionList.forEach((permission) => {
    initialPermissions[permission] = {}
  })

  pagePrivileges.forEach((page) => {
    initialPermissions[page.readPermission] = {
      'Standard user': standardUserMaintainPages.has(page.key),
      Admin: true,
    }
    initialPermissions[page.maintainPermission] = {
      'Standard user': standardUserMaintainPages.has(page.key),
      Admin: true,
    }
  })

  return normalizeRolePermissions(initialPermissions, rolesList)
}
