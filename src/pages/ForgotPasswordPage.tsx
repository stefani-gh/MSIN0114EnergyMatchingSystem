import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import utilidexLogoWhite from '../assets/Utilidex White Logo - No background - No margin.png'
import { Button, PlaceholderNotice, TextInput } from '../components/ui'

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#3A61F4] px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <img
            src={utilidexLogoWhite}
            alt="Utilidex"
            className="h-10 w-auto object-contain"
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-2xl font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
            Account Recovery
          </p>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <TextInput label="Username"/>
            <TextInput
              label="Email"
              type="email"
            />
            <Button className="w-full" type="submit">
              Confirm
            </Button>
          </form>

          {submitted && (
            <div className="mt-5">
              <PlaceholderNotice>
                Mock confirmation: password reset instructions have been queued
                for this demo session.
              </PlaceholderNotice>
            </div>
          )}

          <div className="mt-5 text-center">
            <Link
              to="/login"
              className="text-sm font-semibold text-[#3A61F4] hover:text-[#2949c7]"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
