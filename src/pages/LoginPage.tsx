import {
  BarChart3,
  Clock3,
  LogIn,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CompanyLogo } from '../components/Layout'
import { Button, PlaceholderNotice, TextInput } from '../components/ui'
import { useMockSession, type DemoUser } from '../session'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { login } = useMockSession()
  const navigate = useNavigate()
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        user?: DemoUser
      }

      if (!response.ok || !payload.user) {
        throw new Error(payload.error || 'Login could not be completed.')
      }

      login(payload.user)
      navigate('/dashboard')
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Login could not be completed.',
      )
    } finally {
      setIsSubmitting(false)
    }
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
                required
              />
              <TextInput
                label="Password"
                type="password"
                value={password}
                autoComplete="current-password"
                className="h-12"
                onChange={(event) => setPassword(event.target.value)}
                required
              />

              {error && <PlaceholderNotice>{error}</PlaceholderNotice>}

              <Button
                className="h-12 w-full"
                type="submit"
                icon={LogIn}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing in...' : 'Login'}
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
