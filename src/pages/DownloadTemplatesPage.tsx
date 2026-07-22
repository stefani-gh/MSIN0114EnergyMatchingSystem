import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button, PageContainer, PlaceholderNotice } from '../components/ui'

const templateDownloads = {
  generation: {
    endpoint: '/api/templates/generation/download',
    fallbackFileName: 'Generation Template.xlsx',
    label: 'generation template',
  },
  consumption: {
    endpoint: '/api/templates/consumption/download',
    fallbackFileName: 'Consumption Template.xlsx',
    label: 'consumption template',
  },
} as const

type TemplateDownloadType = keyof typeof templateDownloads

export function DownloadTemplatesPage({
  readOnly = false,
}: {
  readOnly?: boolean
}) {
  const [message, setMessage] = useState('')
  const [downloadingTemplate, setDownloadingTemplate] =
    useState<TemplateDownloadType | null>(null)

  async function downloadTemplate(templateType: TemplateDownloadType) {
    if (readOnly) {
      return
    }

    const template = templateDownloads[templateType]

    setDownloadingTemplate(templateType)
    setMessage('')

    try {
      const response = await fetch(template.endpoint)

      if (!response.ok) {
        throw new Error(`The ${template.label} could not be downloaded.`)
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = downloadUrl
      link.download = getDownloadFileName(response) ?? template.fallbackFileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 60_000)
      setMessage(
        `${template.label.charAt(0).toUpperCase()}${template.label.slice(1)} downloaded.`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `The ${template.label} could not be downloaded.`,
      )
    } finally {
      setDownloadingTemplate(null)
    }
  }

  return (
    <PageContainer
      title="Download Templates"
      description="Download spreadsheet templates for matching energy."
    >
      <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            Consumption Data Template
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Spreadsheet template for customer consumption readings
          </p>
          <Button
            className="mt-5"
            icon={Download}
            onClick={() => downloadTemplate('consumption')}
            disabled={readOnly || downloadingTemplate !== null}
          >
            {downloadingTemplate === 'consumption'
              ? 'Downloading consumption template'
              : 'Download consumption template'}
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            Generation Data Template
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Spreadsheet template for renewable generation readings
          </p>
          <Button
            className="mt-5"
            icon={Download}
            onClick={() => downloadTemplate('generation')}
            disabled={readOnly || downloadingTemplate !== null}
          >
            {downloadingTemplate === 'generation'
              ? 'Downloading generation template'
              : 'Download generation template'}
          </Button>
        </div>

      </section>

      {message && <PlaceholderNotice>{message}</PlaceholderNotice>}
    </PageContainer>
  )
}

function getDownloadFileName(response: Response) {
  const contentDisposition = response.headers.get('Content-Disposition')
  const match = contentDisposition?.match(/filename="(.+)"/)

  return match?.[1]
}
