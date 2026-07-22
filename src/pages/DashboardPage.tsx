import {
  BarChart3,
  Building2,
  Download,
  Factory,
  FileUp,
  Settings,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageContainer } from '../components/ui'
import type { PagePrivilegeKey } from '../data/mockData'
import { getPageAccess, getSessionRoleName } from '../permissions'
import { useMockSession } from '../session'
import { useSystemSettings } from '../systemSettingsContext'

type Shortcut = {
  label: string
  path: string
  pageKey: PagePrivilegeKey
  icon: LucideIcon
}

export function DashboardPage({ readOnly = false }: { readOnly?: boolean }) {
  const { session } = useMockSession()
  const { permissions } = useSystemSettings()
  const roleName = getSessionRoleName(session.role)
  const welcomeName =
    session.user.displayName?.trim() || session.user.username

  const shortcuts: Shortcut[] = [
    {
      label: 'Data Upload',
      path: '/data-upload',
      pageKey: 'data-upload',
      icon: FileUp,
    },
    {
      label: 'Results',
      path: '/results',
      pageKey: 'results',
      icon: BarChart3,
    },
    {
      label: 'Download Templates',
      path: '/download-templates',
      pageKey: 'download-templates',
      icon: Download,
    },
    {
      label: 'Customer Creation',
      path: '/customer',
      pageKey: 'customer',
      icon: UserRound,
    },
    {
      label: 'Generator Creation',
      path: '/generator',
      pageKey: 'generator',
      icon: Factory,
    },
    {
      label: 'User Settings',
      path: '/settings',
      pageKey: 'settings',
      icon: Settings,
    },
  ]

  if (getPageAccess(permissions, roleName, 'business-group').canRead) {
    shortcuts.splice(5, 0, {
      label: 'Business Group',
      path: '/business-group',
      pageKey: 'business-group',
      icon: Building2,
    })
  }

  if (getPageAccess(permissions, roleName, 'manage-users').canRead) {
    shortcuts.push({
      label: 'System Setting',
      path: '/system-setting/manage-users',
      pageKey: 'manage-users',
      icon: ShieldCheck,
    })
  }

  const visibleShortcuts = shortcuts.filter((shortcut) =>
    getPageAccess(permissions, roleName, shortcut.pageKey).canRead,
  )

  return (
    <PageContainer
      title={`Welcome back, ${welcomeName}`}
    >

      <section className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-950">Shortcuts</h1>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleShortcuts.map((shortcut) => (
            <ShortcutCard
              key={shortcut.path}
              shortcut={shortcut}
              disabled={readOnly}
            />
          ))}
        </div>
      </section>
    </PageContainer>
  )
}

function ShortcutCard({
  shortcut,
  disabled,
}: {
  shortcut: Shortcut
  disabled: boolean
}) {
  const Icon = shortcut.icon
  const className = [
    'group flex min-h-[76px] items-center gap-4 rounded-lg border border-[#C2C9FF] bg-white p-5 text-[#3A61F4] shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#3A61F4]/25',
    disabled
      ? 'cursor-not-allowed opacity-55'
      : 'hover:border-[#3A61F4]/45 hover:bg-[#C2C9FF]/20 hover:shadow-md',
  ].join(' ')
  const content = (
    <>
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#3A61F4] bg-white text-[#3A61F4]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 truncate text-base font-semibold text-[#3A61F4]">
        {shortcut.label}
      </span>
    </>
  )

  if (disabled) {
    return (
      <div className={className} aria-disabled="true">
        {content}
      </div>
    )
  }

  return (
    <Link
      to={shortcut.path}
      className={className}
    >
      {content}
    </Link>
  )
}
