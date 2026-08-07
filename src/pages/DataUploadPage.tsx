import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { UploadCard } from '../components/UploadCard'
import {
  Button,
  PageContainer,
  PlaceholderNotice,
  SelectInput,
  TextInput,
} from '../components/ui'
import {
  runMatchingEngine,
  validateEnergyFileTemplate,
  type EnergyUploadType,
} from '../matchingClient'
import { useMatchingResults } from '../matchingResultsContext'
import {
  generatorCommodityOptions,
  matchingApproachOptions,
  type GenerationSource,
  type GeneratorCommodityMapping,
  type MatchingApproach,
} from '../matchingTypes'
import { readCustomerAllocationsFromStorage } from '../registryStorage'
import { useMockSession } from '../session'

type UploadState = {
  fileName: string
  error: string
  file: File | null
}

type EmptyCellWarning = {
  uploadType: EnergyUploadType
  file: File
  emptyCells: string[]
  generationSources: GenerationSource[]
}

type GeneratorCommodityPrompt = {
  file: File
  sources: GenerationSource[]
  commodityValues: Record<string, string>
}

const emptyUploadState: Record<EnergyUploadType, UploadState> = {
  consumption: {
    fileName: '',
    error: '',
    file: null,
  },
  generation: {
    fileName: '',
    error: '',
    file: null,
  },
}

export function DataUploadPage({ readOnly = false }: { readOnly?: boolean }) {
  const [uploads, setUploads] = useState(emptyUploadState)
  const [title, setTitle] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [approachPromptOpen, setApproachPromptOpen] = useState(false)
  const [selectedMatchingApproach, setSelectedMatchingApproach] =
    useState<MatchingApproach>('carry-forward')
  const [emptyCellWarning, setEmptyCellWarning] =
    useState<EmptyCellWarning | null>(null)
  const [generatorCommodityPrompt, setGeneratorCommodityPrompt] =
    useState<GeneratorCommodityPrompt | null>(null)
  const [generatorCommodityMappings, setGeneratorCommodityMappings] = useState<
    GeneratorCommodityMapping[]
  >([])
  const { setResult } = useMatchingResults()
  const { session } = useMockSession()
  const navigate = useNavigate()
  const canSubmit =
    Boolean(uploads.consumption.file) &&
    Boolean(uploads.generation.file) &&
    !uploads.consumption.error &&
    !uploads.generation.error &&
    !isSubmitting &&
    !approachPromptOpen &&
    !readOnly

  async function handleFileSelect(uploadType: EnergyUploadType, file: File) {
    if (readOnly) {
      return
    }

    setSubmitError('')
    setGeneratorCommodityPrompt(null)

    const validationResult = await validateEnergyFileTemplate(file, uploadType)

    if (validationResult.error) {
      if (uploadType === 'generation') {
        setGeneratorCommodityMappings([])
      }

      setUploads((currentUploads) => ({
        ...currentUploads,
        [uploadType]: {
          fileName: '',
          error: validationResult.error,
          file: null,
        },
      }))
      return
    }

    if (validationResult.emptyCells.length) {
      setEmptyCellWarning({
        uploadType,
        file,
        emptyCells: validationResult.emptyCells,
        generationSources: validationResult.generationSources,
      })
      return
    }

    continueValidatedUpload(
      uploadType,
      file,
      validationResult.generationSources,
    )
  }

  function continueValidatedUpload(
    uploadType: EnergyUploadType,
    file: File,
    generationSources: GenerationSource[],
  ) {
    if (uploadType === 'generation' && generationSources.length > 1) {
      setGeneratorCommodityPrompt({
        file,
        sources: generationSources,
        commodityValues: createEmptyCommodityValues(generationSources),
      })
      return
    }

    acceptUpload(uploadType, file)
  }

  function acceptUpload(
    uploadType: EnergyUploadType,
    file: File,
    nextGeneratorCommodityMappings: GeneratorCommodityMapping[] = [],
  ) {
    setUploads((currentUploads) => ({
      ...currentUploads,
      [uploadType]: {
        fileName: file.name,
        error: '',
        file,
      },
    }))

    if (uploadType === 'generation') {
      setGeneratorCommodityMappings(nextGeneratorCommodityMappings)
    }
  }

  function handleAcceptEmptyCells() {
    if (!emptyCellWarning) {
      return
    }

    continueValidatedUpload(
      emptyCellWarning.uploadType,
      emptyCellWarning.file,
      emptyCellWarning.generationSources,
    )
    setEmptyCellWarning(null)
  }

  function handleRejectEmptyCells() {
    if (!emptyCellWarning) {
      return
    }

    const { uploadType, file } = emptyCellWarning

    if (uploadType === 'generation') {
      setGeneratorCommodityMappings([])
      setGeneratorCommodityPrompt(null)
    }

    setUploads((currentUploads) => ({
      ...currentUploads,
      [uploadType]: {
        fileName: '',
        error: `${getUploadTypeLabel(uploadType)} file "${file.name}" was rejected because it contains empty values.`,
        file: null,
      },
    }))
    setEmptyCellWarning(null)
  }

  function handleGeneratorCommodityChange(
    source: GenerationSource,
    commodity: string,
  ) {
    setGeneratorCommodityPrompt((currentPrompt) =>
      currentPrompt
        ? {
            ...currentPrompt,
            commodityValues: {
              ...currentPrompt.commodityValues,
              [getGenerationSourceKey(source)]: commodity,
            },
          }
        : currentPrompt,
    )
  }

  function handleAcceptGeneratorCommodityMapping() {
    if (!generatorCommodityPrompt) {
      return
    }

    const nextGeneratorCommodityMappings = generatorCommodityPrompt.sources.map(
      (source) => ({
        ...source,
        commodity:
          generatorCommodityPrompt.commodityValues[
            getGenerationSourceKey(source)
          ] ?? '',
      }),
    )

    acceptUpload(
      'generation',
      generatorCommodityPrompt.file,
      nextGeneratorCommodityMappings,
    )
    setGeneratorCommodityPrompt(null)
  }

  function handleSubmit() {
    if (readOnly) {
      return
    }

    const consumptionFile = uploads.consumption.file
    const generationFile = uploads.generation.file

    if (!canSubmit || !consumptionFile || !generationFile) {
      return
    }

    setSubmitError('')
    setApproachPromptOpen(true)
  }

  async function handleConfirmMatchingApproach() {
    await submitMatchingRun(selectedMatchingApproach)
  }

  function handleCancelMatchingApproach() {
    setApproachPromptOpen(false)
  }

  async function submitMatchingRun(matchingApproach: MatchingApproach) {
    const consumptionFile = uploads.consumption.file
    const generationFile = uploads.generation.file

    if (!consumptionFile || !generationFile) {
      setApproachPromptOpen(false)
      return
    }

    setIsSubmitting(true)
    setApproachPromptOpen(false)
    setSubmitError('')

    try {
      const result = await runMatchingEngine(consumptionFile, generationFile, {
        customerAllocations: readCustomerAllocationsFromStorage(),
        generatorCommodityMappings,
        matchingApproach,
      })
      const resolvedTitle =
        title.trim() || `${consumptionFile.name} vs ${generationFile.name}`

      await setResult(
        {
          ...result,
          title: resolvedTitle,
          createdBy: session.user.displayName?.trim() || session.user.username,
          createdAt: result.generatedAt,
          generatorCommodityMappings,
          matchingApproach: result.matchingApproach ?? matchingApproach,
        },
        {
          consumptionFile,
          generationFile,
        },
      )
      navigate('/results')
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'The matching engine could not process these files.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageContainer
      title="Data Upload"
      description="Upload customer consumption and renewable generation files for matching."
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-6">
          <div className="max-w-9xl">
            <TextInput
              label="Title (Optional)"
              value={title}
              placeholder={`${
                uploads.consumption.fileName || 'Consumption File'
              } vs ${uploads.generation.fileName || 'Generation File'}`}
              disabled={readOnly}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <UploadCard
              title="Customer Consumption Data"
              description="Upload half-hourly electricity consumption readings using the consumption template format."
              buttonLabel="Upload Consumption File"
              fileName={uploads.consumption.fileName}
              error={uploads.consumption.error}
              disabled={readOnly}
              onFileSelect={(file) => handleFileSelect('consumption', file)}
            />
            <UploadCard
              title="Renewable Generation Data"
              description="Upload half-hourly renewable generation readings using the generation template format."
              buttonLabel="Upload Generation File"
              fileName={uploads.generation.fileName}
              error={uploads.generation.error}
              disabled={readOnly}
              onFileSelect={(file) => handleFileSelect('generation', file)}
            />
          </div>

          {submitError && <PlaceholderNotice>{submitError}</PlaceholderNotice>}

          <div className="flex justify-end pt-5">
            <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {isSubmitting ? 'Running matching engine' : 'Submit'}
            </Button>
          </div>
        </div>
      </div>

      {emptyCellWarning && (
        <EmptyCellWarningModal
          warning={emptyCellWarning}
          onAccept={handleAcceptEmptyCells}
          onReject={handleRejectEmptyCells}
        />
      )}

      {generatorCommodityPrompt && (
        <GeneratorCommodityModal
          prompt={generatorCommodityPrompt}
          onCommodityChange={handleGeneratorCommodityChange}
          onContinue={handleAcceptGeneratorCommodityMapping}
        />
      )}

      {approachPromptOpen && (
        <MatchingApproachModal
          selectedApproach={selectedMatchingApproach}
          onApproachChange={setSelectedMatchingApproach}
          onConfirm={() => void handleConfirmMatchingApproach()}
          onCancel={handleCancelMatchingApproach}
        />
      )}
    </PageContainer>
  )
}

function MatchingApproachModal({
  selectedApproach,
  onApproachChange,
  onConfirm,
  onCancel,
}: {
  selectedApproach: MatchingApproach
  onApproachChange: (approach: MatchingApproach) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="matching-approach-title"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2
            id="matching-approach-title"
            className="text-base font-semibold text-slate-950"
          >
            Please select the approach you would like to match the energy.
          </h2>
        </div>

        <div className="px-5 py-5">
          <SelectInput
            label="Matching approach"
            value={selectedApproach}
            onChange={(event) =>
              onApproachChange(event.target.value as MatchingApproach)
            }
          >
            {matchingApproachOptions.map((approach) => (
              <option key={approach.value} value={approach.value}>
                {approach.label}
              </option>
            ))}
          </SelectInput>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="button" onClick={onConfirm}>
            Confirm
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

function GeneratorCommodityModal({
  prompt,
  onCommodityChange,
  onContinue,
}: {
  prompt: GeneratorCommodityPrompt
  onCommodityChange: (source: GenerationSource, commodity: string) => void
  onContinue: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generator-commodity-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2
            id="generator-commodity-title"
            className="text-base font-semibold text-slate-950"
          >
            More than 1 generator is found.
          </h2>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-600">
          <p>
            More than 1 generator is found, please map the sources of green
            energy based on the Site ID and MPAN.
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr>
                  {['Site ID', 'MPAN', 'Sources of Green Energy'].map((column) => (
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
                {prompt.sources.map((source) => {
                  const sourceKey = getGenerationSourceKey(source)

                  return (
                    <tr key={sourceKey} className="group">
                      <td className="border-b border-slate-100 px-4 py-3 align-middle text-slate-700 group-last:border-b-0">
                        {source.siteId}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 align-middle text-slate-700 group-last:border-b-0">
                        {source.mpan}
                      </td>
                      <td className="min-w-56 border-b border-slate-100 px-4 py-3 align-middle text-slate-700 group-last:border-b-0">
                        <select
                          aria-label={`Source of green energy for Site ID ${source.siteId} and MPAN ${source.mpan}`}
                          value={prompt.commodityValues[sourceKey] ?? ''}
                          onChange={(event) =>
                            onCommodityChange(source, event.target.value)
                          }
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-[#3A61F4] focus:ring-2 focus:ring-[#3A61F4]/15"
                        >
                          <option value="">Select source of green energy</option>
                          {generatorCommodityOptions.map((commodity) => (
                            <option key={commodity} value={commodity}>
                              {commodity}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

function EmptyCellWarningModal({
  warning,
  onAccept,
  onReject,
}: {
  warning: EmptyCellWarning
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="empty-cell-warning-title"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2
            id="empty-cell-warning-title"
            className="text-base font-semibold text-slate-950"
          >
            Empty values found
          </h2>
        </div>

        <div className="space-y-3 px-5 py-5 text-sm leading-6 text-slate-600">
          <p>
            {getUploadTypeLabel(warning.uploadType)} file "{warning.file.name}"
            contains empty value in {formatCellList(warning.emptyCells)}.
          </p>
          <p>
            Continue to proceed? Missing half-hourly readings will be estimated
            from the same period in the preceding four weeks. If all four
            readings are not available, the previous week&apos;s actual reading
            will be used. The file will be rejected if neither method can be
            applied.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="button" onClick={onAccept}>
            Continue
          </Button>
          <Button type="button" variant="secondary" onClick={onReject}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
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

function createEmptyCommodityValues(sources: GenerationSource[]) {
  return sources.reduce<Record<string, string>>((commodityValues, source) => {
    commodityValues[getGenerationSourceKey(source)] = ''
    return commodityValues
  }, {})
}

function getGenerationSourceKey(source: GenerationSource) {
  return JSON.stringify([source.siteId, source.mpan])
}
