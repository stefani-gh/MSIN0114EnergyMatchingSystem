import { CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react'
import type { ChangeEvent } from 'react'

export function UploadCard({
  title,
  description,
  buttonLabel,
  fileName,
  error,
  disabled = false,
  onFileSelect,
}: {
  title: string
  description: string
  buttonLabel: string
  fileName: string
  error?: string
  disabled?: boolean
  onFileSelect: (file: File) => void
}) {
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]

    if (selectedFile) {
      onFileSelect(selectedFile)
    }

    event.target.value = ''
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#C2C9FF] bg-[#C2C9FF]/30 text-[#3A61F4]">
          <FileSpreadsheet className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5 flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-[#C2C9FF] bg-[#F7F8FF] px-5 py-8 text-center">
        <UploadCloud className="size-8 text-[#3A61F4]" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-slate-950">
          Select a file to upload
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Supported file types: .xlsx, .csv
        </p>
        <label
          className={[
            'mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#3A61F4] px-4 text-sm font-semibold text-white shadow-sm transition focus-within:ring-2 focus-within:ring-[#3A61F4]/25',
            disabled
              ? 'cursor-not-allowed opacity-55'
              : 'cursor-pointer hover:bg-[#2949c7]',
          ].join(' ')}
          aria-disabled={disabled}
        >
          <UploadCloud className="size-4" aria-hidden="true" />
          {buttonLabel}
          <input
            type="file"
            accept=".xlsx,.csv"
            className="sr-only"
            disabled={disabled}
            onChange={handleFileChange}
          />
        </label>
      </div>

      {fileName && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#4EBE9E]/30 bg-[#4EBE9E]/10 px-4 py-3 text-sm text-[#4EBE9E]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Uploaded file: <span className="font-semibold">{fileName}</span>
          </span>
        </div>
      )}

      {error && (
        <div className="mt-4 whitespace-pre-line rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
    </section>
  )
}
