import {
  BarChart3,
  Clock3,
  LockKeyhole,
  LogIn,
  UserRound,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CompanyLogo } from '../components/Layout'
import { Button, TextInput } from '../components/ui'
import { demoUsers, useMockSession, type UserRole } from '../session'

const demoPassword = 'demo-password'

export function LoginPage() {
  const [role, setRole] = useState<UserRole>('standard')
  const [username, setUsername] = useState(demoUsers.standard.username)
  const [password, setPassword] = useState(demoPassword)
  const { login } = useMockSession()
  const navigate = useNavigate()
  const roleOptions: Array<{
    value: UserRole
    label: string
    icon: typeof UserRound
  }> = [
    {
      value: 'standard',
      label: 'Standard user',
      icon: UserRound,
    },
    {
      value: 'admin',
      label: 'Admin user',
      icon: LockKeyhole,
    },
  ]

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    login(role)
    navigate('/dashboard')
  }

  function selectRole(nextRole: UserRole) {
    setRole(nextRole)
    setUsername(demoUsers[nextRole].username)
    setPassword(demoPassword)
  }

  return (
    <main className="grid min-h-screen bg-[#F7F8FF] lg:grid-cols-[minmax(420px,0.95fr)_minmax(480px,1.05fr)]">
      <section className="hidden min-h-screen border-r border-[#C2C9FF]/50 bg-[#3A61F4] px-10 py-10 text-white lg:flex lg:flex-col xl:px-14">
        <div className="flex items-center justify-between">
          <CompanyLogo light />
        </div>

        <div className="my-auto max-w-xl py-12">
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-normal xl:text-5xl">
            Half-hourly Energy Matching Platform
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/80">
            Match renewable generation to consumption every half hour with
            clear, auditable results.
          </p>

          <div className="mt-10 grid gap-3">
            {[
              {
                icon: Clock3,
                label: 'Fast Model Runs',
                detail: 'Matching results generated quickly after upload',
              },
              {
                icon: BarChart3,
                label: 'Transparent Reporting',
                detail: 'Visualise energy matching performance clearly',
              },

            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 border-l border-white/25 py-2 pl-4"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10 text-[#FEFEDF]">
                  <item.icon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-white/70">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </section>

      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-10 xl:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <CompanyLogo />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div>
              <p className="text-2xl font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
                Sign in
              </p>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <TextInput
                label="Username"
                value={username}
                autoComplete="username"
                className="h-12"
                onChange={(event) => setUsername(event.target.value)}
              />
              <TextInput
                label="Password"
                type="password"
                value={password}
                autoComplete="current-password"
                className="h-12"
                onChange={(event) => setPassword(event.target.value)}
              />

              <div>
                <p className="text-sm font-medium text-slate-700">
                  Simulate login as
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                  {roleOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => selectRole(item.value)}
                      className={[
                        'flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#3A61F4]/25',
                        role === item.value
                          ? 'bg-white text-[#3A61F4] shadow-sm'
                          : 'text-slate-600 hover:text-slate-950',
                      ].join(' ')}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Button className="h-12 w-full" type="submit" icon={LogIn}>
                Login
              </Button>
            </form>

            <div className="mt-5 text-center">
              <Link
                to="/forgot-password"
                className="text-sm font-semibold text-[#3A61F4] hover:text-[#2949c7]"
              >
                Forgot Password?
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
