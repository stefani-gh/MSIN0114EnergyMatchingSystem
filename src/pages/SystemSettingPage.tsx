import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { AuditLogsTable } from '../components/AdminTables'
import {
  Button,
  DataTable,
  PageContainer,
  PlaceholderNotice,
  SelectInput,
  StatusBadge,
  TextInput,
} from '../components/ui'
import {
  pagePrivileges,
  permissionList,
  type BusinessGroup,
  type ManagedUser,
  type PermissionName,
  type RoleName,
} from '../data/mockData'
import {
  runMatchingEngine,
  validateEnergyFileTemplate,
  type EnergyUploadType,
} from '../matchingClient'
import {
  useMatchingResults,
  type DatabaseRecord,
  type MatchingSourceFiles,
  type StoredUploadFile,
} from '../matchingResultsContext'
import {
  cloneRolePermissions,
  getFirstReadablePagePath,
  getPageAccess,
  getSessionRoleName,
  getSystemSettingPageKey,
  normalizeRolePermissions,
  setRolePermission,
} from '../permissions'
import { readCustomerAllocationsFromStorage } from '../registryStorage'
import {
  readSettlementCalendar,
  loadAndMergeSettlementCalendar,
  saveSettlementCalendar,
  writeSettlementCalendar,
  type CalendarDayType,
  type CalendarStatus,
  type SettlementCalendarEntry,
} from '../calendarSettings'
import { useMockSession } from '../session'
import {
  useSystemSettings,
  type RolePermissions,
} from '../systemSettingsContext'

type UserForm = {
  id?: string
  username: string
  email: string
  role: RoleName
  businessGroupId: string
}

type DatabaseRecordForm = {
  title: string
  titleError: string
  consumptionFile: File | null
  generationFile: File | null
  consumptionError: string
  generationError: string
  consumptionWarning: string
  generationWarning: string
  submitError: string
}

const emptyUserForm: UserForm = {
  username: '',
  email: '',
  role: 'Standard user',
  businessGroupId: '',
}

export function SystemSettingPage() {
  const { subFunction } = useParams()
  const { session } = useMockSession()
  const { permissions } = useSystemSettings()
  const roleName = getSessionRoleName(session.role)

  if (subFunction === 'business-group') {
    return <Navigate to="/business-group" replace />
  }

  const pageKey = getSystemSettingPageKey(subFunction)

  if (!pageKey) {
    return <Navigate to="/system-setting/manage-users" replace />
  }

  const access = getPageAccess(permissions, roleName, pageKey)

  if (!access.canRead) {
    return (
      <Navigate
        to={getFirstReadablePagePath(permissions, roleName) ?? '/access-denied'}
        replace
      />
    )
  }

  const readOnly = !access.canMaintain

  if (subFunction === 'manage-users') {
    return <ManageUsersPage readOnly={readOnly} />
  }

  if (subFunction === 'manage-role') {
    return <ManageRolePage readOnly={readOnly} />
  }

  if (subFunction === 'audit-logs') {
    return <AuditLogsPage />
  }

  if (subFunction === 'database') {
    return <DatabasePage readOnly={readOnly} />
  }

  if (subFunction === 'calendar-setup') {
    return <CalendarSetupPage readOnly={readOnly} />
  }

  return <Navigate to="/system-setting/manage-users" replace />
}

function CalendarSetupPage({ readOnly = false }: { readOnly?: boolean }) {
  const [entries, setEntries] = useState<SettlementCalendarEntry[]>(
    readSettlementCalendar,
  )
  const [date, setDate] = useState('')
  const [dayType, setDayType] = useState<CalendarDayType>('46-period')
  const [status, setStatus] = useState<CalendarStatus>('Active')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadAndMergeSettlementCalendar(entries)
      .then((mergedEntries) => {
        if (!cancelled) setEntries(mergedEntries)
      })
      .catch(() => {
        if (!cancelled) setError('Calendar settings could not be loaded from the database.')
      })
    return () => { cancelled = true }
    // Existing browser entries are intentionally migrated only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function saveEntries(nextEntries: SettlementCalendarEntry[]) {
    setEntries(nextEntries)
    writeSettlementCalendar(nextEntries)
    void saveSettlementCalendar(nextEntries).catch(() => {
      setError('Calendar settings could not be saved to the database.')
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedDate = normalizeCalendarDate(date)

    if (!normalizedDate) {
      setError('Enter a valid date in dd/mm/yy format.')
      return
    }

    if (entries.some((entry) => entry.date === normalizedDate)) {
      setError('A calendar entry already exists for this date.')
      return
    }

    saveEntries([
      ...entries,
      {
        id: `calendar-${Date.now()}`,
        date: normalizedDate,
        dayType,
        status,
      },
    ])
    setDate('')
    setError('')
  }

  return (
    <PageContainer
      title="Calendar Setup"
      description="Configure active UK short and long settlement days used during file validation."
    >
      <form
        className="mb-6 grid gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-4 md:items-end"
        onSubmit={handleSubmit}
      >
        <CalendarDateInput
          value={date}
          error={error}
          disabled={readOnly}
          onChange={(value) => {
            setDate(value)
            setError('')
          }}
        />
        <SelectInput
          label="Day type"
          value={dayType}
          disabled={readOnly}
          onChange={(event) => setDayType(event.target.value as CalendarDayType)}
        >
          <option value="46-period">Short day (46 periods)</option>
          <option value="50-period">Long day (50 periods)</option>
        </SelectInput>
        <SelectInput
          label="Status"
          value={status}
          disabled={readOnly}
          onChange={(event) => setStatus(event.target.value as CalendarStatus)}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </SelectInput>
        <Button type="submit" icon={Plus} disabled={readOnly}>Add</Button>
      </form>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {entries.length ? (
          <DataTable
            columns={['Date', 'Day type', 'Status', 'Actions']}
            rows={[...entries]
              .sort((a, b) => getCalendarDateSortValue(b.date) - getCalendarDateSortValue(a.date))
              .map((entry) => [
                entry.date,
                entry.dayType === '46-period' ? 'Short day (46 periods)' : 'Long day (50 periods)',
                <StatusBadge tone={entry.status === 'Active' ? 'green' : 'slate'}>
                  {entry.status}
                </StatusBadge>,
                <Button
                  type="button"
                  variant="secondary"
                  disabled={readOnly}
                  onClick={() => saveEntries(entries.filter((item) => item.id !== entry.id))}
                >Delete</Button>,
              ])}
          />
        ) : (
          <PlaceholderNotice>No calendar entries are configured.</PlaceholderNotice>
        )}
      </div>
    </PageContainer>
  )
}

function formatCalendarDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 6)
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
    .filter(Boolean)
    .join('/')
}

function CalendarDateInput({
  value,
  error,
  disabled,
  onChange,
}: {
  value: string
  error: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const initialDate = getCalendarPickerDate(value) ?? new Date()
  const [isOpen, setIsOpen] = useState(false)
  const [displayYear, setDisplayYear] = useState(initialDate.getFullYear())
  const [displayMonth, setDisplayMonth] = useState(initialDate.getMonth())
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const firstWeekday = new Date(displayYear, displayMonth, 1).getDay()
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate()
  const selectedDate = getCalendarPickerDate(value)

  function changeMonth(offset: number) {
    const nextDate = new Date(displayYear, displayMonth + offset, 1)
    setDisplayYear(nextDate.getFullYear())
    setDisplayMonth(nextDate.getMonth())
  }

  function selectDay(day: number) {
    onChange(
      `${String(day).padStart(2, '0')}/${String(displayMonth + 1).padStart(2, '0')}/${String(displayYear).slice(-2)}`,
    )
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="calendar-date">
        Date
      </label>
      <div className="relative">
        <input
          id="calendar-date"
          value={value}
          placeholder="dd/mm/yy"
          inputMode="numeric"
          disabled={disabled}
          className={`w-full rounded-md border bg-white px-3 py-2 pr-10 text-sm outline-none transition focus:ring-2 ${
            error
              ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
              : 'border-slate-300 focus:border-[#3A61F4] focus:ring-[#3A61F4]/15'
          } disabled:bg-slate-100`}
          onChange={(event) => onChange(formatCalendarDateInput(event.target.value))}
        />
        <button
          type="button"
          aria-label="Open calendar"
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-[#3A61F4] disabled:text-slate-300"
          onClick={() => setIsOpen((current) => !current)}
        >
          <CalendarDays size={18} />
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}

      {isOpen && !disabled && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[320px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="mb-4 flex items-center gap-2">
            <button type="button" aria-label="Previous month" className="rounded-md border border-slate-200 p-2 hover:bg-slate-50" onClick={() => changeMonth(-1)}>
              <ChevronLeft size={18} />
            </button>
            <select className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-sm font-medium" value={displayMonth} onChange={(event) => setDisplayMonth(Number(event.target.value))}>
              {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
            </select>
            <select className="w-24 rounded-md border border-slate-300 px-2 py-2 text-sm font-medium" value={displayYear} onChange={(event) => setDisplayYear(Number(event.target.value))}>
              {Array.from({ length: 21 }, (_, index) => new Date().getFullYear() - 10 + index).map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button type="button" aria-label="Next month" className="rounded-md border border-slate-200 p-2 hover:bg-slate-50" onClick={() => changeMonth(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <div key={day} className="py-1">{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }, (_, index) => <div key={`blank-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
              const isSelected = selectedDate?.getFullYear() === displayYear && selectedDate.getMonth() === displayMonth && selectedDate.getDate() === day
              return (
                <button
                  key={day}
                  type="button"
                  className={`h-9 rounded-full text-sm transition ${isSelected ? 'bg-[#3A61F4] font-semibold text-white' : 'text-slate-700 hover:bg-[#3A61F4]/10'}`}
                  onClick={() => selectDay(day)}
                >{day}</button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function getCalendarPickerDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(`20${match[3]}`), Number(match[2]) - 1, Number(match[1]))
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeCalendarDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (!match) return ''
  const day = Number(match[1]); const month = Number(match[2]); const year = 2000 + Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? `${match[1]}/${match[2]}/${year}`
    : ''
}

function getCalendarDateSortValue(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match
    ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
    : 0
}


function ManageUsersPage({ readOnly = false }: { readOnly?: boolean }) {
  const {
    roles,
    users,
    businessGroups,
    addUser,
    updateUser,
    deleteUser,
  } = useSystemSettings()
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [form, setForm] = useState<UserForm>(emptyUserForm)
  const [errors, setErrors] = useState<{ username?: string; email?: string }>(
    {},
  )

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.username.localeCompare(b.username)),
    [users],
  )

  function openAddUser() {
    if (readOnly) {
      return
    }

    setForm(emptyUserForm)
    setErrors({})
    setModalMode('add')
  }

  function openEditUser(user: ManagedUser) {
    if (readOnly) {
      return
    }

    setForm({
      ...user,
      businessGroupId: user.businessGroupId ?? '',
    })
    setErrors({})
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setForm(emptyUserForm)
    setErrors({})
  }

  function validateForm() {
    const nextErrors: { username?: string; email?: string } = {}
    const username = form.username.trim()
    const email = form.email.trim()

    if (!username) {
      nextErrors.username = 'Username is required.'
    } else if (/\s/.test(username)) {
      nextErrors.username = 'Username cannot contain spaces.'
    } else {
      const duplicate = users.some(
        (user) =>
          user.username.toLowerCase() === username.toLowerCase() &&
          user.id !== form.id,
      )

      if (duplicate) {
        nextErrors.username = 'This username already exists.'
      }
    }

    if (!email) {
      nextErrors.email = 'Email is required.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = 'Enter a valid email address.'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function handleUserFormChange(
    nextForm: UserForm,
    clearedField?: 'username' | 'email',
  ) {
    setForm(nextForm)

    if (clearedField) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        [clearedField]: undefined,
      }))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    if (!validateForm()) {
      return
    }

    const nextUser = {
      id: form.id,
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
      businessGroupId: form.businessGroupId,
    }

    if (modalMode === 'edit' && nextUser.id) {
      updateUser(nextUser as ManagedUser)
    } else {
      addUser({
        username: nextUser.username,
        email: nextUser.email,
        role: nextUser.role,
        businessGroupId: nextUser.businessGroupId,
      })
    }

    closeModal()
  }

  return (
    <PageContainer
      title="Manage User"
      description="Add, edit, and delete users."
      actions={
        <Button icon={Plus} disabled={readOnly} onClick={openAddUser}>
          Add
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <DataTable
          columns={['Username', 'Email', 'Role', 'Business Group', 'Action']}
          rows={sortedUsers.map((user) => [
            <span className="font-medium text-slate-950">{user.username}</span>,
            user.email,
            user.role,
            getUserBusinessGroupDisplayNames(user, businessGroups),
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={readOnly}
                onClick={() => openEditUser(user)}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                disabled={readOnly}
                onClick={() => {
                  if (!readOnly) {
                    deleteUser(user.id)
                  }
                }}
              >
                Delete
              </Button>
            </div>,
          ])}
        />
      </div>

      {modalMode && (
        <UserModal
          title={modalMode === 'edit' ? 'Edit User' : 'Add User'}
          form={form}
          roles={roles}
          errors={errors}
          onClose={closeModal}
          onSubmit={handleSubmit}
          onChange={handleUserFormChange}
        />
      )}
    </PageContainer>
  )
}

function ManageRolePage({ readOnly = false }: { readOnly?: boolean }) {
  const { roles, permissions, addRole, updatePermissions } = useSystemSettings()
  const [draftPermissions, setDraftPermissions] = useState<RolePermissions>(() =>
    cloneRolePermissions(permissions),
  )
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [roleName, setRoleName] = useState('')
  const [roleNameError, setRoleNameError] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<
    PermissionName[]
  >([])
  const [permissionSavedMessage, setPermissionSavedMessage] = useState('')

  function openRoleModal() {
    if (readOnly) {
      return
    }

    setRoleName('')
    setRoleNameError('')
    setSelectedPermissions([])
    setRoleModalOpen(true)
  }

  function closeRoleModal() {
    setRoleModalOpen(false)
    setRoleName('')
    setRoleNameError('')
    setSelectedPermissions([])
  }

  function updateSelectedPermission(
    permission: PermissionName,
    enabled: boolean,
  ) {
    setSelectedPermissions((currentPermissions) =>
      setPermissionInList(currentPermissions, permission, enabled),
    )
  }

  function toggleDraftPermission(permission: PermissionName, role: RoleName) {
    if (readOnly) {
      return
    }

    setPermissionSavedMessage('')
    setDraftPermissions((currentPermissions) =>
      setRolePermission(
        currentPermissions,
        role,
        permission,
        !currentPermissions[permission]?.[role],
      ),
    )
  }

  function savePermissions() {
    if (readOnly) {
      return
    }

    updatePermissions(draftPermissions)
    setPermissionSavedMessage('Permissions saved.')
  }

  function cancelPermissionChanges() {
    if (readOnly) {
      return
    }

    setDraftPermissions(cloneRolePermissions(permissions))
    setPermissionSavedMessage('')
  }

  function handleAddRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    const nextRoleName = roleName.trim()
    if (!nextRoleName) {
      setRoleNameError('Role name is required.')
      return
    }

    const duplicate = roles.some(
      (role) => role.toLowerCase() === nextRoleName.toLowerCase(),
    )
    if (duplicate) {
      setRoleNameError('This role already exists.')
      return
    }

    addRole(nextRoleName, selectedPermissions)
    setPermissionSavedMessage('')
    setDraftPermissions((currentPermissions) =>
      addRoleToPermissions(
        currentPermissions,
        nextRoleName,
        selectedPermissions,
        [...roles, nextRoleName],
      ),
    )
    closeRoleModal()
  }

  return (
    <PageContainer
      title="Manage Role"
      description="Grant permissions by role."
      actions={
        <Button icon={Plus} disabled={readOnly} onClick={openRoleModal}>
          Add
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                <th className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-600 first:rounded-l-lg">
                  Page
                </th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-center font-semibold text-slate-600 last:rounded-r-lg"
                  >
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagePrivileges.map((page) => (
                <tr key={page.key}>
                  <td className="border-b border-slate-100 px-4 py-4 font-medium text-slate-950">
                    {page.label}
                  </td>
                  {roles.map((role) => (
                    <td
                      key={`${page.key}-${role}`}
                      className="border-b border-slate-100 px-4 py-4"
                    >
                      <div className="flex flex-wrap justify-center gap-4">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              draftPermissions[page.readPermission]?.[role],
                            )}
                            disabled={
                              readOnly ||
                              Boolean(
                                draftPermissions[page.maintainPermission]?.[
                                  role
                                ],
                              )
                            }
                            onChange={() =>
                              toggleDraftPermission(page.readPermission, role)
                            }
                            aria-label={`${role} ${page.readPermission} permission`}
                            className="size-5 rounded border-slate-300 accent-[#3A61F4]"
                          />
                          Read
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              draftPermissions[page.maintainPermission]?.[
                                role
                              ],
                            )}
                            disabled={readOnly}
                            onChange={() =>
                              toggleDraftPermission(
                                page.maintainPermission,
                                role,
                              )
                            }
                            aria-label={`${role} ${page.maintainPermission} permission`}
                            className="size-5 rounded border-slate-300 accent-[#3A61F4]"
                          />
                          Maintain
                        </label>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {permissionSavedMessage && (
          <div className="mt-5">
            <PlaceholderNotice>{permissionSavedMessage}</PlaceholderNotice>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" disabled={readOnly} onClick={savePermissions}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={readOnly}
            onClick={cancelPermissionChanges}
          >
            Cancel
          </Button>
        </div>
      </div>

      {roleModalOpen && (
        <RoleModal
          roleName={roleName}
          roleNameError={roleNameError}
          selectedPermissions={selectedPermissions}
          onRoleNameChange={(value) => {
            setRoleName(value)
            setRoleNameError('')
          }}
          onPermissionChange={updateSelectedPermission}
          onClose={closeRoleModal}
          onSubmit={handleAddRole}
        />
      )}
    </PageContainer>
  )
}

function addRoleToPermissions(
  source: RolePermissions,
  role: RoleName,
  selectedPermissions: PermissionName[],
  roles: RoleName[],
) {
  const nextPermissions = normalizeRolePermissions(source, roles)

  permissionList.forEach((permission) => {
    nextPermissions[permission] = {
      ...nextPermissions[permission],
      [role]: selectedPermissions.includes(permission),
    }
  })

  return normalizeRolePermissions(nextPermissions, roles)
}

function setPermissionInList(
  permissions: PermissionName[],
  permission: PermissionName,
  enabled: boolean,
) {
  const page = pagePrivileges.find(
    (pagePrivilege) =>
      pagePrivilege.readPermission === permission ||
      pagePrivilege.maintainPermission === permission,
  )

  if (!page) {
    return permissions
  }

  const nextPermissions = new Set(permissions)

  if (permission === page.maintainPermission) {
    if (enabled) {
      nextPermissions.add(page.maintainPermission)
      nextPermissions.add(page.readPermission)
    } else {
      nextPermissions.delete(page.maintainPermission)
    }
  } else if (enabled) {
    nextPermissions.add(page.readPermission)
  } else {
    nextPermissions.delete(page.readPermission)
    nextPermissions.delete(page.maintainPermission)
  }

  return [...nextPermissions]
}

function getUserBusinessGroupDisplayNames(
  user: ManagedUser,
  businessGroups: BusinessGroup[],
) {
  const businessGroupNames = new Map<string, string>()

  if (user.businessGroupId) {
    businessGroupNames.set(
      user.businessGroupId,
      businessGroups.find(
        (businessGroup) => businessGroup.id === user.businessGroupId,
      )?.name ?? 'Business group removed',
    )
  }

  businessGroups.forEach((businessGroup) => {
    const selectedUserIds = new Set([
      ...(businessGroup.toUserIds ?? []),
      ...(businessGroup.ccUserIds ?? []),
    ])

    if (selectedUserIds.has(user.id)) {
      businessGroupNames.set(businessGroup.id, businessGroup.name)
    }
  })

  return businessGroupNames.size
    ? Array.from(businessGroupNames.values()).join(', ')
    : 'No business group'
}

export function BusinessGroupPage({ readOnly = false }: { readOnly?: boolean }) {
  const {
    users,
    businessGroups,
    addBusinessGroup,
    updateBusinessGroup,
    deleteBusinessGroup,
  } = useSystemSettings()
  const [modalMode, setModalMode] = useState<'add' | 'modify' | null>(null)
  const [editingBusinessGroupId, setEditingBusinessGroupId] = useState<
    string | null
  >(null)
  const [businessGroupName, setBusinessGroupName] = useState('')
  const [businessGroupToUserIds, setBusinessGroupToUserIds] = useState<string[]>(
    [],
  )
  const [businessGroupCcUserIds, setBusinessGroupCcUserIds] = useState<string[]>(
    [],
  )
  const [businessGroupNameError, setBusinessGroupNameError] = useState('')

  const sortedBusinessGroups = useMemo(
    () =>
      [...businessGroups].sort((firstGroup, secondGroup) =>
        firstGroup.name.localeCompare(secondGroup.name),
      ),
    [businessGroups],
  )

  function openBusinessGroupModal() {
    if (readOnly) {
      return
    }

    setEditingBusinessGroupId(null)
    setBusinessGroupName('')
    setBusinessGroupToUserIds([])
    setBusinessGroupCcUserIds([])
    setBusinessGroupNameError('')
    setModalMode('add')
  }

  function openModifyBusinessGroup(businessGroup: BusinessGroup) {
    if (readOnly) {
      return
    }

    setEditingBusinessGroupId(businessGroup.id)
    setBusinessGroupName(businessGroup.name)
    setBusinessGroupToUserIds(businessGroup.toUserIds ?? [])
    setBusinessGroupCcUserIds(businessGroup.ccUserIds ?? [])
    setBusinessGroupNameError('')
    setModalMode('modify')
  }

  function closeBusinessGroupModal() {
    setModalMode(null)
    setEditingBusinessGroupId(null)
    setBusinessGroupName('')
    setBusinessGroupToUserIds([])
    setBusinessGroupCcUserIds([])
    setBusinessGroupNameError('')
  }

  function handleBusinessGroupNameChange(value: string) {
    setBusinessGroupName(value)
    setBusinessGroupNameError(
      getBusinessGroupNameError(
        value,
        businessGroups,
        false,
        editingBusinessGroupId,
      ),
    )
  }

  function handleSaveBusinessGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    const nextError = getBusinessGroupNameError(
      businessGroupName,
      businessGroups,
      true,
      editingBusinessGroupId,
    )

    if (nextError) {
      setBusinessGroupNameError(nextError)
      return
    }

    const nextBusinessGroupName =
      normalizeBusinessGroupDisplayName(businessGroupName)

    if (modalMode === 'modify' && editingBusinessGroupId) {
      updateBusinessGroup({
        id: editingBusinessGroupId,
        name: nextBusinessGroupName,
        toUserIds: businessGroupToUserIds,
        ccUserIds: businessGroupCcUserIds,
      })
    } else {
      addBusinessGroup({
        name: nextBusinessGroupName,
        toUserIds: businessGroupToUserIds,
        ccUserIds: businessGroupCcUserIds,
      })
    }

    closeBusinessGroupModal()
  }

  return (
    <PageContainer
      title="Business Group"
      description="Add or edit business groups for sending emails to business users."
      actions={
        <Button icon={Plus} disabled={readOnly} onClick={openBusinessGroupModal}>
          Add
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {sortedBusinessGroups.length ? (
          <DataTable
            columns={['Business Group', 'User', 'Action']}
            rows={sortedBusinessGroups.map((businessGroup) => [
              <span className="font-medium text-slate-950">
                {businessGroup.name}
              </span>,
              getBusinessGroupUserDisplayNames(businessGroup, users),
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={readOnly}
                  onClick={() => openModifyBusinessGroup(businessGroup)}
                >
                  Edit
                </Button>
                <Button
                  variant="danger"
                  disabled={readOnly}
                  onClick={() => {
                    if (!readOnly) {
                      deleteBusinessGroup(businessGroup.id)
                    }
                  }}
                >
                  Delete
                </Button>
              </div>,
            ])}
          />
        ) : (
          <PlaceholderNotice>
            No business groups have been added yet.
          </PlaceholderNotice>
        )}
      </div>

      {modalMode && (
        <BusinessGroupModal
          title={
            modalMode === 'modify'
              ? 'Edit Business Group'
              : 'Add Business Group'
          }
          businessGroupName={businessGroupName}
          businessGroupNameError={businessGroupNameError}
          users={users}
          toUserIds={businessGroupToUserIds}
          ccUserIds={businessGroupCcUserIds}
          onBusinessGroupNameChange={handleBusinessGroupNameChange}
          onToUserIdsChange={setBusinessGroupToUserIds}
          onCcUserIdsChange={setBusinessGroupCcUserIds}
          onClose={closeBusinessGroupModal}
          onSubmit={handleSaveBusinessGroup}
        />
      )}
    </PageContainer>
  )
}

function AuditLogsPage() {
  return (
    <PageContainer
      title="Audit Logs"
      description="Audit records for system review."
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <AuditLogsTable />
      </div>
    </PageContainer>
  )
}

function getBusinessGroupUserDisplayNames(
  businessGroup: BusinessGroup,
  users: ManagedUser[],
) {
  const selectedUserIds = new Set([
    ...(businessGroup.toUserIds ?? []),
    ...(businessGroup.ccUserIds ?? []),
  ])
  const selectedUsers = users.filter((user) => selectedUserIds.has(user.id))

  if (!selectedUsers.length) {
    return 'No users'
  }

  return selectedUsers.map((user) => getShortUserDisplayName(user)).join(', ')
}

function getShortUserDisplayName(user: ManagedUser) {
  return user.username
    .split('.')
    .filter(Boolean)
    .map((namePart) => namePart.charAt(0).toUpperCase() + namePart.slice(1))
    .join(' ')
}

function getBusinessGroupNameError(
  value: string,
  businessGroups: BusinessGroup[],
  requireValue: boolean,
  ignoredBusinessGroupId: string | null,
) {
  const normalizedValue = normalizeBusinessGroupName(value)

  if (!normalizedValue) {
    return requireValue ? 'Business group name is required.' : ''
  }

  const duplicate = businessGroups.some(
    (businessGroup) =>
      businessGroup.id !== ignoredBusinessGroupId &&
      normalizeBusinessGroupName(businessGroup.name) === normalizedValue,
  )

  return duplicate ? 'This business group already exists.' : ''
}

function normalizeBusinessGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeBusinessGroupDisplayName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function DatabasePage({ readOnly = false }: { readOnly?: boolean }) {
  const { databaseRecords, results, setResult, deleteResult } =
    useMatchingResults()
  const { session } = useMockSession()
  const [editingRecord, setEditingRecord] = useState<DatabaseRecord | null>(null)
  const [recordForm, setRecordForm] = useState<DatabaseRecordForm>(
    createDatabaseRecordForm(null),
  )
  const [isSavingRecord, setIsSavingRecord] = useState(false)
  const activeResultIds = useMemo(
    () => new Set(results.map((result) => result.id)),
    [results],
  )
  const sortedRecords = useMemo(
    () =>
      [...databaseRecords].sort(
        (firstRecord, secondRecord) =>
          getDateTimeValue(secondRecord.createdAt) -
          getDateTimeValue(firstRecord.createdAt),
      ),
    [databaseRecords],
  )

  function openModifyRecord(record: DatabaseRecord) {
    if (readOnly) {
      return
    }

    setEditingRecord(record)
    setRecordForm(createDatabaseRecordForm(record))
  }

  function closeModifyRecord() {
    if (isSavingRecord) {
      return
    }

    setEditingRecord(null)
    setRecordForm(createDatabaseRecordForm(null))
  }

  async function handleReplacementFileSelect(
    uploadType: EnergyUploadType,
    file: File,
  ) {
    if (readOnly) {
      return
    }

    setRecordForm((currentForm) =>
      clearRecordFileValidation(currentForm, uploadType),
    )

    const validationResult = await validateEnergyFileTemplate(file, uploadType)

    if (validationResult.error) {
      setRecordForm((currentForm) =>
        setRecordFileValidation(currentForm, uploadType, {
          file: null,
          error: validationResult.error,
          warning: '',
        }),
      )
      return
    }

    setRecordForm((currentForm) =>
      setRecordFileValidation(currentForm, uploadType, {
        file,
        error: '',
        warning: validationResult.emptyCells.length
          ? `${getUploadTypeLabel(uploadType)} file "${file.name}" contains empty value in ${formatCellList(validationResult.emptyCells)}. Empty values will be pre-filled as 0 when regenerating.`
          : '',
      }),
    )
  }

  async function saveModifiedRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly || !editingRecord) {
      return
    }

    const resolvedTitle = recordForm.title.trim()

    if (!resolvedTitle) {
      setRecordForm((currentForm) => ({
        ...currentForm,
        titleError: 'Title is required.',
      }))
      return
    }

    setIsSavingRecord(true)
    setRecordForm((currentForm) => ({
      ...currentForm,
      titleError: '',
      submitError: '',
    }))

    try {
      const sourceFiles = await getDatabaseRecordSourceFiles(
        editingRecord,
        recordForm,
      )

      if (!sourceFiles) {
        setRecordForm((currentForm) => ({
          ...currentForm,
          submitError:
            'This record cannot be regenerated because the original uploaded files are not available.',
        }))
        return
      }

      const existingGeneratorCommodityMappings =
        results.find(
          (matchingResult) => matchingResult.id === editingRecord.resultId,
        )?.generatorCommodityMappings ?? []
      const existingMatchingApproach =
        results.find(
          (matchingResult) => matchingResult.id === editingRecord.resultId,
        )?.matchingApproach ?? 'non-carry-forward'
      const result = await runMatchingEngine(
        sourceFiles.consumptionFile,
        sourceFiles.generationFile,
        {
          customerAllocations: readCustomerAllocationsFromStorage(),
          generatorCommodityMappings: existingGeneratorCommodityMappings,
          matchingApproach: existingMatchingApproach,
        },
      )

      await setResult(
        {
          ...result,
          id: editingRecord.resultId,
          title: resolvedTitle,
          createdBy: session.user.displayName?.trim() || session.user.username,
          createdAt: result.generatedAt,
          generatorCommodityMappings: existingGeneratorCommodityMappings,
          matchingApproach: result.matchingApproach ?? existingMatchingApproach,
        },
        sourceFiles,
      )
      setEditingRecord(null)
      setRecordForm(createDatabaseRecordForm(null))
    } catch (error) {
      setRecordForm((currentForm) => ({
        ...currentForm,
        submitError:
          error instanceof Error
            ? error.message
            : 'The matching engine could not regenerate this result.',
      }))
    } finally {
      setIsSavingRecord(false)
    }
  }

  function deleteRecord(record: DatabaseRecord) {
    if (readOnly || isDatabaseRecordDeleted(record, activeResultIds)) {
      return
    }

    deleteResult(record.resultId)
  }

  return (
    <PageContainer
      title="Database"
      description="Manage records held in the system."
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {sortedRecords.length ? (
          <DataTable
            columns={[
              'Title',
              'Consumption File',
              'Generation File',
              'User',
              'Created Date and Time',
              'Status',
              'Action',
            ]}
            rows={sortedRecords.map((record) => {
              const recordDeleted = isDatabaseRecordDeleted(
                record,
                activeResultIds,
              )
              const canEditRecord = hasStoredSourceFiles(record)

              return [
                <span className="font-medium text-slate-950">
                  {record.title}
                </span>,
                <span className="break-all">{record.consumptionFileName}</span>,
                <span className="break-all">{record.generationFileName}</span>,
                record.createdBy,
                formatDatabaseDateTime(record.createdAt),
                <StatusBadge tone={recordDeleted ? 'red' : 'green'}>
                  {recordDeleted ? 'Record deleted' : 'Active'}
                </StatusBadge>,
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={readOnly || !canEditRecord}
                    title={
                      canEditRecord
                        ? 'Edit uploaded record'
                        : 'Original uploaded files are not available'
                    }
                    onClick={() => openModifyRecord(record)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    disabled={readOnly || recordDeleted}
                    onClick={() => deleteRecord(record)}
                  >
                    Delete
                  </Button>
                </div>,
              ]
            })}
          />
        ) : (
          <PlaceholderNotice>
            No database records are available yet. Upload and submit valid
            consumption and generation files to create a record.
          </PlaceholderNotice>
        )}
      </div>

      {editingRecord && (
        <RecordModal
          record={editingRecord}
          form={recordForm}
          isSaving={isSavingRecord}
          onChange={setRecordForm}
          onFileSelect={handleReplacementFileSelect}
          onClose={closeModifyRecord}
          onSubmit={saveModifiedRecord}
        />
      )}
    </PageContainer>
  )
}

function RecordModal({
  record,
  form,
  isSaving,
  onChange,
  onFileSelect,
  onClose,
  onSubmit,
}: {
  record: DatabaseRecord
  form: DatabaseRecordForm
  isSaving: boolean
  onChange: (form: DatabaseRecordForm) => void
  onFileSelect: (uploadType: EnergyUploadType, file: File) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              Database
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Edit uploaded record
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            disabled={isSaving}
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <TextInput
            label="Title"
            value={form.title}
            error={form.titleError}
            disabled={isSaving}
            onChange={(event) =>
              onChange({
                ...form,
                title: event.target.value,
                titleError: '',
                submitError: '',
              })
            }
          />
          <RecordFileField
            label="Consumption file"
            uploadType="consumption"
            currentFileName={record.consumptionFileName}
            selectedFileName={form.consumptionFile?.name}
            error={form.consumptionError}
            warning={form.consumptionWarning}
            disabled={isSaving}
            onFileSelect={onFileSelect}
          />
          <RecordFileField
            label="Generation file"
            uploadType="generation"
            currentFileName={record.generationFileName}
            selectedFileName={form.generationFile?.name}
            error={form.generationError}
            warning={form.generationWarning}
            disabled={isSaving}
            onFileSelect={onFileSelect}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <ReadOnlyField label="User" value={record.createdBy} />
            <ReadOnlyField
              label="Created date and time"
              value={formatDatabaseDateTime(record.createdAt)}
            />
          </div>

          {form.submitError && (
            <PlaceholderNotice>{form.submitError}</PlaceholderNotice>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Regenerating result' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isSaving}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function RecordFileField({
  label,
  uploadType,
  currentFileName,
  selectedFileName,
  error,
  warning,
  disabled,
  onFileSelect,
}: {
  label: string
  uploadType: EnergyUploadType
  currentFileName: string
  selectedFileName?: string
  error: string
  warning: string
  disabled: boolean
  onFileSelect: (uploadType: EnergyUploadType, file: File) => void
}) {
  return (
    <div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-2 rounded-lg border border-dashed border-[#C2C9FF] bg-[#F7F8FF] px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">
              {selectedFileName ?? currentFileName}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {selectedFileName
                ? 'Replacement file selected.'
                : 'Current file will be reused unless replaced.'}
            </p>
          </div>
          <label
            className={[
              'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold shadow-sm transition focus-within:ring-2 focus-within:ring-[#3A61F4]/25',
              disabled
                ? 'cursor-not-allowed bg-slate-300 text-slate-500'
                : 'cursor-pointer bg-[#3A61F4] text-white hover:bg-[#2949c7]',
            ].join(' ')}
          >
            <UploadCloud className="size-4" aria-hidden="true" />
            Upload file
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={disabled}
              className="sr-only"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0]

                if (selectedFile) {
                  onFileSelect(uploadType, selectedFile)
                }
              }}
            />
          </label>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      {!error && warning && (
        <p className="mt-1 text-xs text-amber-700">{warning}</p>
      )}
    </div>
  )
}

function createDatabaseRecordForm(
  record: DatabaseRecord | null,
): DatabaseRecordForm {
  return {
    title: record?.title ?? '',
    titleError: '',
    consumptionFile: null,
    generationFile: null,
    consumptionError: '',
    generationError: '',
    consumptionWarning: '',
    generationWarning: '',
    submitError: '',
  }
}

function clearRecordFileValidation(
  form: DatabaseRecordForm,
  uploadType: EnergyUploadType,
) {
  return setRecordFileValidation(form, uploadType, {
    file: null,
    error: '',
    warning: '',
  })
}

function setRecordFileValidation(
  form: DatabaseRecordForm,
  uploadType: EnergyUploadType,
  validation: {
    file: File | null
    error: string
    warning: string
  },
) {
  if (uploadType === 'consumption') {
    return {
      ...form,
      consumptionFile: validation.file,
      consumptionError: validation.error,
      consumptionWarning: validation.warning,
      submitError: '',
    }
  }

  return {
    ...form,
    generationFile: validation.file,
    generationError: validation.error,
    generationWarning: validation.warning,
    submitError: '',
  }
}

async function getDatabaseRecordSourceFiles(
  record: DatabaseRecord,
  form: DatabaseRecordForm,
): Promise<MatchingSourceFiles | null> {
  if (!record.consumptionFile || !record.generationFile) {
    return null
  }

  const [consumptionFile, generationFile] = await Promise.all([
    form.consumptionFile ?? storedUploadFileToFile(record.consumptionFile),
    form.generationFile ?? storedUploadFileToFile(record.generationFile),
  ])

  return {
    consumptionFile,
    generationFile,
  }
}

async function storedUploadFileToFile(storedFile: StoredUploadFile) {
  const response = await fetch(storedFile.dataUrl)
  const blob = await response.blob()

  return new File([blob], storedFile.fileName, {
    type: storedFile.mimeType,
    lastModified: storedFile.lastModified,
  })
}

function hasStoredSourceFiles(record: DatabaseRecord) {
  return Boolean(record.consumptionFile && record.generationFile)
}

function isDatabaseRecordDeleted(
  record: DatabaseRecord,
  activeResultIds: Set<string>,
) {
  return record.deletedFromResults || !activeResultIds.has(record.resultId)
}

function formatDatabaseDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getDateTimeValue(value: string) {
  const dateTimeValue = new Date(value).getTime()

  return Number.isNaN(dateTimeValue) ? 0 : dateTimeValue
}

function getUploadTypeLabel(uploadType: EnergyUploadType) {
  return uploadType === 'consumption' ? 'Consumption' : 'Generation'
}

function formatCellList(cells: string[]) {
  const visibleCells = cells.slice(0, 8)
  const suffix =
    cells.length > visibleCells.length
      ? ` and ${cells.length - visibleCells.length} more`
      : ''

  return `${visibleCells.join(', ')}${suffix}`
}

function BusinessGroupModal({
  title,
  businessGroupName,
  businessGroupNameError,
  users,
  toUserIds,
  ccUserIds,
  onBusinessGroupNameChange,
  onToUserIdsChange,
  onCcUserIdsChange,
  onClose,
  onSubmit,
}: {
  title: string
  businessGroupName: string
  businessGroupNameError: string
  users: ManagedUser[]
  toUserIds: string[]
  ccUserIds: string[]
  onBusinessGroupNameChange: (value: string) => void
  onToUserIdsChange: (userIds: string[]) => void
  onCcUserIdsChange: (userIds: string[]) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const sortedUsers = [...users].sort((firstUser, secondUser) =>
    firstUser.username.localeCompare(secondUser.username),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              Business Group
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <TextInput
            autoFocus
            label="Business Group Name"
            value={businessGroupName}
            error={businessGroupNameError}
            onChange={(event) =>
              onBusinessGroupNameChange(event.target.value)
            }
            placeholder="e.g. Corporate Energy"
          />
          <UserMultiSelect
            label="To:"
            users={sortedUsers}
            selectedUserIds={toUserIds}
            onChange={onToUserIdsChange}
          />
          <UserMultiSelect
            label="cc:"
            users={sortedUsers}
            selectedUserIds={ccUserIds}
            onChange={onCcUserIdsChange}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit" disabled={Boolean(businessGroupNameError)}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function UserMultiSelect({
  label,
  users,
  selectedUserIds,
  onChange,
}: {
  label: string
  users: ManagedUser[]
  selectedUserIds: string[]
  onChange: (userIds: string[]) => void
}) {
  function toggleUser(userId: string) {
    if (selectedUserIds.includes(userId)) {
      onChange(selectedUserIds.filter((selectedUserId) => selectedUserId !== userId))
      return
    }

    onChange([...selectedUserIds, userId])
  }

  return (
    <div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1.4fr)] border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
          <div className="px-3 py-2" />
          <div className="px-3 py-2">Username</div>
          <div className="px-3 py-2">Email</div>
        </div>

        {users.length ? (
          users.map((user) => {
            const checked = selectedUserIds.includes(user.id)

            return (
              <label
                key={user.id}
                className="grid cursor-pointer grid-cols-[44px_minmax(0,1fr)_minmax(0,1.4fr)] items-center border-b border-slate-100 text-sm last:border-b-0 hover:bg-[#C2C9FF]/15"
              >
                <div className="flex justify-center px-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleUser(user.id)}
                    className="size-4 rounded border-slate-300 accent-[#3A61F4]"
                    aria-label={`Select ${user.username}`}
                  />
                </div>
                <div className="min-w-0 truncate px-3 py-2 font-medium text-slate-950">
                  {user.username}
                </div>
                <div className="min-w-0 truncate px-3 py-2 text-slate-600">
                  {user.email}
                </div>
              </label>
            )
          })
        ) : (
          <div className="px-3 py-3 text-sm text-slate-500">
            No users available.
          </div>
        )}
      </div>
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div
        aria-readonly="true"
        className="mt-2 min-h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500"
      >
        {value}
      </div>
    </div>
  )
}

function UserModal({
  title,
  form,
  roles,
  errors,
  onClose,
  onSubmit,
  onChange,
}: {
  title: string
  form: UserForm
  roles: RoleName[]
  errors: { username?: string; email?: string }
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onChange: (form: UserForm, clearedField?: 'username' | 'email') => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        noValidate
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              Manage Users
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <TextInput
            label="Username"
            value={form.username}
            error={errors.username}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...form, username: event.target.value }, 'username')
            }
            placeholder="example.user"
          />
          <TextInput
            label="Email"
            type="text"
            inputMode="email"
            value={form.email}
            error={errors.email}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...form, email: event.target.value }, 'email')
            }
            placeholder="example.user@company.com"
          />
          <SelectInput
            label="Role"
            value={form.role}
            onChange={(event) =>
              onChange({ ...form, role: event.target.value as RoleName })
            }
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </SelectInput>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function RoleModal({
  roleName,
  roleNameError,
  selectedPermissions,
  onRoleNameChange,
  onPermissionChange,
  onClose,
  onSubmit,
}: {
  roleName: string
  roleNameError: string
  selectedPermissions: PermissionName[]
  onRoleNameChange: (value: string) => void
  onPermissionChange: (permission: PermissionName, enabled: boolean) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        onSubmit={onSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              Manage Role
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Add Role
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-140px)] space-y-5 overflow-y-auto px-5 py-5">
          <TextInput
            label="Role Name"
            value={roleName}
            error={roleNameError}
            onChange={(event) => onRoleNameChange(event.target.value)}
            placeholder="e.g. Business reviewer"
          />

          <div>
            <p className="text-sm font-medium text-slate-700">Permission</p>
            <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {pagePrivileges.map((page) => {
                const readChecked = selectedPermissions.includes(
                  page.readPermission,
                )
                const maintainChecked = selectedPermissions.includes(
                  page.maintainPermission,
                )

                return (
                  <div
                    key={page.key}
                    className="flex flex-col gap-3 px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-slate-950">
                      {page.label}
                    </span>
                    <div className="flex flex-wrap gap-4">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={readChecked}
                          disabled={maintainChecked}
                          onChange={(event) =>
                            onPermissionChange(
                              page.readPermission,
                              event.target.checked,
                            )
                          }
                          className="size-5 rounded border-slate-300 accent-[#3A61F4]"
                        />
                        Read
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={maintainChecked}
                          onChange={(event) =>
                            onPermissionChange(
                              page.maintainPermission,
                              event.target.checked,
                            )
                          }
                          className="size-5 rounded border-slate-300 accent-[#3A61F4]"
                        />
                        Maintain
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
