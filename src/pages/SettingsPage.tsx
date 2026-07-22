import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  Button,
  PageContainer,
  PlaceholderNotice,
  TextInput,
} from '../components/ui'
import { demoUsers, useMockSession } from '../session'
import { useSystemSettings } from '../systemSettingsContext'

type PasswordForm = {
  currentPassword: string
  newPassword: string
  confirmNewPassword: string
}

type PasswordFormErrors = Partial<Record<keyof PasswordForm, string>>

const emptyPasswordForm: PasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
}

export function SettingsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { session, updateUser } = useMockSession()
  const { users } = useSystemSettings()
  const [displayName, setDisplayName] = useState(
    session.user.displayName ?? '',
  )
  const [username, setUsername] = useState(session.user.username)
  const [email, setEmail] = useState(session.user.email)
  const [password, setPassword] = useState('demo-password')
  const [profileSavedMessage, setProfileSavedMessage] = useState('')
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordForm, setPasswordForm] =
    useState<PasswordForm>(emptyPasswordForm)
  const [passwordErrors, setPasswordErrors] = useState<PasswordFormErrors>({})
  const usernameError = getUsernameError(
    username,
    session.user.username,
    demoUsers[session.role].username,
    users.map((user) => user.username),
  )
  const emailError = getEmailError(email)
  const hasProfileError = Boolean(usernameError || emailError)

  function openPasswordModal() {
    if (readOnly) {
      return
    }

    setPasswordForm(emptyPasswordForm)
    setPasswordErrors({})
    setPasswordModalOpen(true)
  }

  function closePasswordModal() {
    setPasswordModalOpen(false)
    setPasswordForm(emptyPasswordForm)
    setPasswordErrors({})
  }

  function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    if (emailError) {
      return
    }

    if (usernameError) {
      return
    }

    updateUser({
      displayName: displayName.trim(),
      username: username.trim(),
      email: email.trim(),
    })
    setProfileSavedMessage('Profile saved.')
  }

  function handleCancelProfileChanges() {
    setDisplayName(session.user.displayName ?? '')
    setUsername(session.user.username)
    setEmail(session.user.email)
    setProfileSavedMessage('')
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    const nextPasswordErrors = getPasswordFormErrors(passwordForm)

    if (Object.keys(nextPasswordErrors).length) {
      setPasswordErrors(nextPasswordErrors)
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      setPasswordErrors({
        confirmNewPassword: 'New password and confirmation must match.',
      })
      return
    }

    setPassword(passwordForm.newPassword)
    closePasswordModal()
  }

  return (
    <PageContainer
      title="User Settings"
      description="Manage your profile details here."
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <form className="space-y-5" noValidate onSubmit={handleProfileSubmit}>
          <TextInput
            label="Display Name"
            value={displayName}
            disabled={readOnly}
            onChange={(event) => {
              setDisplayName(event.target.value)
              setProfileSavedMessage('')
            }}
          />
          <TextInput
            label="Username"
            value={username}
            error={usernameError}
            disabled={readOnly}
            onChange={(event) => {
              setUsername(event.target.value)
              setProfileSavedMessage('')
            }}
          />
          <TextInput
            label="Email"
            type="email"
            value={email}
            error={emailError}
            disabled={readOnly}
            onChange={(event) => {
              setEmail(event.target.value)
              setProfileSavedMessage('')
            }}
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextInput label="Password" type="password" value={password} readOnly />
            <Button
              type="button"
              variant="secondary"
              aria-label="Change password"
              disabled={readOnly}
              onClick={openPasswordModal}
            >
              Change Password
            </Button>
          </div>
          <ReadOnlyField
            label="Role"
            value={session.role === 'admin' ? 'Admin user' : 'Standard user'}
          />
          {profileSavedMessage && (
            <PlaceholderNotice>{profileSavedMessage}</PlaceholderNotice>
          )}
          <div className="flex w-full justify-end gap-2 pt-2">
            <Button type="submit" disabled={readOnly || hasProfileError}>
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={readOnly}
              onClick={handleCancelProfileChanges}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>

      {passwordModalOpen && (
        <PasswordModal
          form={passwordForm}
          errors={passwordErrors}
          onChange={(nextForm) => {
            setPasswordForm(nextForm)
            setPasswordErrors({})
          }}
          onClose={closePasswordModal}
          onSubmit={handlePasswordSubmit}
        />
      )}
    </PageContainer>
  )
}

function getUsernameError(
  username: string,
  currentUsername: string,
  defaultUsername: string,
  existingUsernames: string[],
) {
  const trimmedUsername = username.trim()

  if (!trimmedUsername) {
    return 'Username is required.'
  }

  if (/\s/.test(username)) {
    return 'Username cannot contain spaces.'
  }

  const normalizedUsername = trimmedUsername.toLowerCase()
  const ownUsernames = new Set([
    currentUsername.toLowerCase(),
    defaultUsername.toLowerCase(),
  ])
  const isDuplicate = existingUsernames.some(
    (existingUsername) =>
      existingUsername.toLowerCase() === normalizedUsername &&
      !ownUsernames.has(existingUsername.toLowerCase()),
  )

  return isDuplicate ? 'Username already exists.' : undefined
}

function getEmailError(email: string) {
  const trimmedEmail = email.trim()

  if (!trimmedEmail) {
    return 'Email is required.'
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    ? undefined
    : 'Enter a valid email address.'
}

function getPasswordFormErrors(form: PasswordForm) {
  const errors: PasswordFormErrors = {}

  if (!form.currentPassword.trim()) {
    errors.currentPassword = 'Current password is required.'
  }

  if (!form.newPassword.trim()) {
    errors.newPassword = 'New password is required.'
  }

  if (!form.confirmNewPassword.trim()) {
    errors.confirmNewPassword = 'Confirm new password is required.'
  }

  return errors
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

function PasswordModal({
  form,
  errors,
  onChange,
  onClose,
  onSubmit,
}: {
  form: PasswordForm
  errors: PasswordFormErrors
  onChange: (form: PasswordForm) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              User Profile
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Change password
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
            label="Current Password"
            type="password"
            value={form.currentPassword}
            error={errors.currentPassword}
            onChange={(event) =>
              onChange({ ...form, currentPassword: event.target.value })
            }
          />
          <TextInput
            label="New Password"
            type="password"
            value={form.newPassword}
            error={errors.newPassword}
            onChange={(event) =>
              onChange({ ...form, newPassword: event.target.value })
            }
          />
          <TextInput
            label="Confirm New Password"
            type="password"
            value={form.confirmNewPassword}
            error={errors.confirmNewPassword}
            onChange={(event) =>
              onChange({ ...form, confirmNewPassword: event.target.value })
            }
          />
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
