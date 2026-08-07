import {
  pagePrivileges,
  permissionList,
  type PagePrivilegeKey,
  type PermissionName,
  type RoleName,
} from './data/mockData'
import type { UserRole } from './session'
import type { RolePermissions } from './systemSettingsContext'

export type PageAccess = {
  canRead: boolean
  canMaintain: boolean
}

export function getSessionRoleName(role: UserRole): RoleName {
  return role === 'admin' ? 'Admin' : 'Standard user'
}

export function getPagePrivilege(pageKey: PagePrivilegeKey) {
  return pagePrivileges.find((page) => page.key === pageKey)
}

export function getPagePrivilegeByPath(path: string) {
  return pagePrivileges.find((page) => page.path === path)
}

export function getPageAccess(
  permissions: RolePermissions,
  role: RoleName,
  pageKey: PagePrivilegeKey,
): PageAccess {
  const page = getPagePrivilege(pageKey)

  if (!page) {
    return {
      canRead: false,
      canMaintain: false,
    }
  }

  const canMaintain = hasPermission(permissions, role, page.maintainPermission)
  const canRead =
    canMaintain || hasPermission(permissions, role, page.readPermission)

  return {
    canRead,
    canMaintain,
  }
}

export function getFirstReadablePagePath(
  permissions: RolePermissions,
  role: RoleName,
) {
  return pagePrivileges.find((page) =>
    getPageAccess(permissions, role, page.key).canRead,
  )?.path
}

export function getSystemSettingPageKey(subFunction: string | undefined) {
  if (subFunction === 'manage-users') {
    return 'manage-users'
  }

  if (subFunction === 'manage-role') {
    return 'manage-role'
  }

  if (subFunction === 'audit-logs') {
    return 'audit-logs'
  }

  if (subFunction === 'database') {
    return 'database'
  }

  if (subFunction === 'calendar-setup') {
    return 'calendar-setup'
  }

  return null
}

export function setRolePermission(
  permissions: RolePermissions,
  role: RoleName,
  permission: PermissionName,
  enabled: boolean,
) {
  const nextPermissions = cloneRolePermissions(permissions)
  const page = pagePrivileges.find(
    (pagePrivilege) =>
      pagePrivilege.readPermission === permission ||
      pagePrivilege.maintainPermission === permission,
  )

  if (!page) {
    return nextPermissions
  }

  if (permission === page.maintainPermission) {
    nextPermissions[page.maintainPermission][role] = enabled

    if (enabled) {
      nextPermissions[page.readPermission][role] = true
    }
  } else {
    nextPermissions[page.readPermission][role] = enabled

    if (!enabled) {
      nextPermissions[page.maintainPermission][role] = false
    }
  }

  return nextPermissions
}

export function normalizeRolePermissions(
  source: RolePermissions,
  roles: RoleName[],
) {
  const nextPermissions = {} as RolePermissions

  permissionList.forEach((permission) => {
    nextPermissions[permission] = {}

    roles.forEach((role) => {
      nextPermissions[permission][role] = Boolean(source[permission]?.[role])
    })
  })

  pagePrivileges.forEach((page) => {
    roles.forEach((role) => {
      if (nextPermissions[page.maintainPermission][role]) {
        nextPermissions[page.readPermission][role] = true
      }
    })
  })

  return nextPermissions
}

export function cloneRolePermissions(source: RolePermissions) {
  const nextPermissions = {} as RolePermissions

  permissionList.forEach((permission) => {
    nextPermissions[permission] = { ...(source[permission] ?? {}) }
  })

  return nextPermissions
}

function hasPermission(
  permissions: RolePermissions,
  role: RoleName,
  permission: PermissionName,
) {
  return Boolean(permissions[permission]?.[role])
}
