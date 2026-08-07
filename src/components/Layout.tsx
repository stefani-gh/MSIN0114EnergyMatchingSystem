import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Factory,
  FileUp,
  HelpCircle,
  Home,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import utilidexLogoBlue from '../assets/Utilidex Logo - white background.png'
import utilidexLogoWhite from '../assets/Utilidex White Logo - No background - No margin.png'
import type { PagePrivilegeKey } from '../data/mockData'
import { getPageAccess, getSessionRoleName } from '../permissions'
import { useMockSession } from '../session'
import { useSystemSettings } from '../systemSettingsContext'
import { Button } from './ui'

type NavItem = {
  label: string
  path?: string
  pageKey?: PagePrivilegeKey
  icon: LucideIcon
  subItems?: Array<{
    label: string
    path: string
    pageKey: PagePrivilegeKey
    icon: LucideIcon
  }>
}

const navigation: NavItem[] = [
  {
    label: 'Dashboard Home',
    path: '/dashboard',
    pageKey: 'dashboard',
    icon: Home,
  },
  {
    label: 'Data Upload',
    path: '/data-upload',
    pageKey: 'data-upload',
    icon: FileUp,
  },
  { label: 'Results', path: '/results', pageKey: 'results', icon: BarChart3 },
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
    label: 'Business Group',
    path: '/business-group',
    pageKey: 'business-group',
    icon: Building2,
  },
  {
    label: 'How to Use',
    path: '/how-to-use',
    pageKey: 'how-to-use',
    icon: HelpCircle,
  },
  {
    label: 'User Settings',
    path: '/settings',
    pageKey: 'settings',
    icon: Settings,
  },
  {
    label: 'System Setting',
    icon: ShieldCheck,
    subItems: [
      {
        label: 'Manage User',
        path: '/system-setting/manage-users',
        pageKey: 'manage-users',
        icon: Users,
      },
      {
        label: 'Manage Role',
        path: '/system-setting/manage-role',
        pageKey: 'manage-role',
        icon: ShieldCheck,
      },
      {
        label: 'Calendar Setup',
        path: '/system-setting/calendar-setup',
        pageKey: 'calendar-setup',
        icon: CalendarDays,
      },
      {
        label: 'Audit Logs',
        path: '/system-setting/audit-logs',
        pageKey: 'audit-logs',
        icon: ListChecks,
      },
      {
        label: 'Database',
        path: '/system-setting/database',
        pageKey: 'database',
        icon: Database,
      },
    ],
  },
]

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { session, logout } = useMockSession()
  const { permissions } = useSystemSettings()
  const roleName = getSessionRoleName(session.role)
  const visibleNavigation = navigation.flatMap((item) => {
    if (item.subItems?.length) {
      const subItems = item.subItems.filter(
        (subItem) =>
          getPageAccess(permissions, roleName, subItem.pageKey).canRead,
      )

      return subItems.length ? [{ ...item, subItems }] : []
    }

    if (!item.pageKey) {
      return []
    }

    return getPageAccess(permissions, roleName, item.pageKey).canRead
      ? [item]
      : []
  })

  return (
    <div className="min-h-screen bg-[#F7F8FF] text-slate-900">
      <header className="fixed inset-x-0 top-0 z-40 h-16 border-b border-[#C2C9FF]/20 bg-[#3A61F4] shadow-sm">
        <div className="flex h-full items-center">
          <div className="flex h-full w-[78px] shrink-0 items-center justify-center border-r border-white/15 bg-[#3A61F4]">
            <button
              type="button"
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              onClick={() =>
                window.innerWidth >= 1024
                  ? setCollapsed((value) => !value)
                  : setMobileOpen(true)
              }
              className="inline-flex size-11 items-center justify-center rounded-md text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-[#FEFEDF]/70"
            >
              <Menu className="size-6" aria-hidden="true" />
            </button>
          </div>

          <div className="hidden h-full w-[178px] shrink-0 items-center justify-center border-r border-white/15 px-4 lg:flex">
            <LogoHomeButton />
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-5">
              <div className="lg:hidden">
                <LogoHomeButton />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-normal text-white sm:text-base">
                  Half-Hourly Energy Matching Engine
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                icon={LogOut}
                onClick={logout}
                className="text-white hover:bg-white/15 hover:text-white focus:ring-white/40"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <aside
        className={[
          'fixed bottom-0 left-0 top-16 z-30 hidden border-r border-[#C2C9FF]/60 bg-[#3A61F4] shadow-sm lg:block',
          collapsed ? 'w-[78px]' : 'w-64',
        ].join(' ')}
      >
        <Sidebar
          collapsed={collapsed}
          navigation={visibleNavigation}
          onToggle={() => setCollapsed((value) => !value)}
        />
      </aside>

      <div className={collapsed ? 'pt-16 lg:pl-[78px]' : 'pt-16 lg:pl-64'}>
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative h-full w-80 max-w-[88vw] border-r border-[#C2C9FF]/60 bg-[#3A61F4] shadow-xl">
            <Sidebar
              collapsed={false}
              navigation={visibleNavigation}
              onToggle={() => setMobileOpen(false)}
              mobileClose
            />
          </aside>
        </div>
      )}
    </div>
  )
}

function Sidebar({
  collapsed,
  navigation,
  onToggle,
  mobileClose = false,
}: {
  collapsed: boolean
  navigation: NavItem[]
  onToggle: () => void
  mobileClose?: boolean
}) {
  const location = useLocation()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    'System Setting': true,
  })

  function toggleGroup(label: string) {
    setOpenGroups((current) => ({
      ...current,
      [label]: !current[label],
    }))
  }

  function openGroup(label: string) {
    setOpenGroups((current) => ({
      ...current,
      [label]: true,
    }))
  }

  return (
    <div className="flex h-full flex-col p-[5px]">
      {mobileClose && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            aria-label="Close navigation"
            title="Close navigation"
            onClick={onToggle}
            className="inline-flex size-10 items-center justify-center rounded-md text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-[#FEFEDF]/70"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      )}

      <nav className="space-y-1">
        {navigation.map((item) => {
          const hasSubItems = Boolean(item.subItems?.length)
          const isGroupActive =
            hasSubItems &&
            item.subItems?.some((subItem) => location.pathname === subItem.path)
          const isOpen = Boolean(openGroups[item.label])

          if (hasSubItems) {
            return (
              <div key={item.label}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => {
                    if (collapsed) {
                      onToggle()
                      openGroup(item.label)
                      return
                    }

                    toggleGroup(item.label)
                  }}
                  className={[
                    'flex h-12 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition',
                    isGroupActive
                      ? 'bg-[#FEFEDF] text-[#3A61F4] shadow-sm'
                      : 'text-white/85 hover:bg-[#C2C9FF]/25 hover:text-white',
                    collapsed ? 'justify-center' : '',
                  ].join(' ')}
                >
                  <item.icon className="size-5 shrink-0" aria-hidden="true" />
                  {!collapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">
                        {item.label}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden="true" />
                      )}
                    </>
                  )}
                </button>

                {isOpen && !collapsed && (
                  <div className="mt-1 space-y-1 pl-3">
                    {item.subItems?.map((subItem) => (
                      <NavLink
                        key={subItem.path}
                        to={subItem.path}
                        onClick={mobileClose ? onToggle : undefined}
                        className={({ isActive }) =>
                          [
                            'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition',
                            isActive
                              ? 'bg-white text-[#3A61F4] shadow-sm'
                              : 'text-white/75 hover:bg-[#C2C9FF]/20 hover:text-white',
                          ].join(' ')
                        }
                      >
                        <subItem.icon
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate">{subItem.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          }

          if (!item.path) {
            return null
          }

          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={mobileClose ? onToggle : undefined}
              className={({ isActive }) =>
                [
                  'flex h-12 items-center gap-3 rounded-md px-3 text-sm font-medium transition',
                  isActive
                    ? 'bg-[#FEFEDF] text-[#3A61F4] shadow-sm'
                    : 'text-white/85 hover:bg-[#C2C9FF]/25 hover:text-white',
                  collapsed ? 'justify-center' : '',
                ].join(' ')
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

function LogoHomeButton() {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      aria-label="Go to dashboard home"
      title="Go to dashboard home"
      onClick={() => navigate('/dashboard')}
      onMouseDown={(event) => event.preventDefault()}
      className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FEFEDF]/70"
    >
      <CompanyLogo light />
    </button>
  )
}

export function CompanyLogo({
  collapsed = false,
  light = false,
}: {
  collapsed?: boolean
  light?: boolean
}) {
  const logo = light ? utilidexLogoWhite : utilidexLogoBlue

  return (
    <div className="flex min-w-0 items-center">
      <img
        src={logo}
        alt="Utilidex"
        className={[
          'block h-8 w-auto object-contain',
          collapsed ? 'max-w-10' : 'max-w-[150px]',
        ].join(' ')}
      />
    </div>
  )
}
