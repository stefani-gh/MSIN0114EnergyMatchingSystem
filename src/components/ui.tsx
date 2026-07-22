import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'
import type { LucideIcon } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-[#3A61F4] text-white hover:bg-[#2949c7] shadow-sm',
  secondary:
    'border border-slate-200 bg-white text-slate-700 hover:border-[#3A61F4]/40 hover:bg-[#C2C9FF]/20',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
  danger:
    'border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100',
}

const toneClasses = {
  blue: 'border-[#C2C9FF] bg-[#C2C9FF]/35 text-[#2541b2]',
  green: 'border-[#4EBE9E]/30 bg-[#4EBE9E]/10 text-[#4EBE9E]',
  lavender: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  cream: 'border-amber-200 bg-[#FEFEDF] text-amber-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
} as const

export type Tone = keyof typeof toneClasses

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  icon?: LucideIcon
}

export function Button({
  children,
  className = '',
  variant = 'primary',
  icon: Icon,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#3A61F4]/25',
        buttonVariants[variant],
        disabled ? 'cursor-not-allowed opacity-55' : '',
        className,
      ].join(' ')}
      disabled={disabled}
      {...props}
    >
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      {children}
    </button>
  )
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
}

export function IconButton({
  icon: Icon,
  label,
  className = '',
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        'inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-[#3A61F4]/40 hover:bg-[#C2C9FF]/20 focus:outline-none focus:ring-2 focus:ring-[#3A61F4]/25',
        className,
      ].join(' ')}
      {...props}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  )
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  helper?: string
}

export function TextInput({
  label,
  error,
  helper,
  className = '',
  ...props
}: TextInputProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className={[
          'mt-2 h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#3A61F4] focus:ring-2 focus:ring-[#3A61F4]/15',
          error ? 'border-rose-300' : 'border-slate-200',
          className,
        ].join(' ')}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
      {!error && helper && (
        <span className="mt-1 block text-xs text-slate-500">{helper}</span>
      )}
    </label>
  )
}

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
}

export function SelectInput({
  label,
  children,
  className = '',
  ...props
}: SelectInputProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        className={[
          'mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[#3A61F4] focus:ring-2 focus:ring-[#3A61F4]/15',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </select>
    </label>
  )
}

export function StatusBadge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span
      className={[
        'inline-flex min-h-7 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold',
        toneClasses[tone],
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function PageContainer({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-16 flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {description && (
            <p className="mt-1 text-sm leading-5 text-slate-500">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  tone: 'blue' | 'green' | 'lavender' | 'cream'
}) {
  const iconTone = {
    blue: 'border-[#C2C9FF] bg-[#C2C9FF]/35 text-[#3A61F4]',
    green: 'border-[#4EBE9E]/30 bg-[#4EBE9E]/10 text-[#4EBE9E]',
    lavender: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    cream: 'border-amber-200 bg-[#FEFEDF] text-amber-700',
  }[tone]

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">
            {value}
          </p>
        </div>
        <div
          className={[
            'flex size-11 shrink-0 items-center justify-center rounded-lg border',
            iconTone,
          ].join(' ')}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-500">{helper}</p>
    </article>
  )
}

export function DataTable({
  columns,
  rows,
}: {
  columns: string[]
  rows: ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-600 first:rounded-l-lg last:rounded-r-lg"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="group">
              {row.map((cell, cellIndex) => (
                <td
                  key={`${rowIndex}-${cellIndex}`}
                  className="border-b border-slate-100 px-4 py-3 align-middle text-slate-700 group-last:border-b-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlaceholderNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#C2C9FF] bg-[#C2C9FF]/20 px-4 py-3 text-sm text-slate-700">
      {children}
    </div>
  )
}
