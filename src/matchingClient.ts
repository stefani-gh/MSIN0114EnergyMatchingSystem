import type {
  GeneratorCommodityMapping,
  EnergyUploadType,
  GenerationSource,
  MatchingApproach,
  MatchingCustomerAllocation,
  MatchingEngineResult,
} from './matchingTypes'
import { readSettlementCalendar } from './calendarSettings'

export type { EnergyUploadType } from './matchingTypes'

export type MatchingEngineOptions = {
  customerAllocations?: MatchingCustomerAllocation[]
  generatorCommodityMappings?: GeneratorCommodityMapping[]
  matchingApproach?: MatchingApproach
}

type ApiErrorPayload = {
  error?: unknown
}

export type TemplateValidationResult = {
  error: string
  emptyCells: string[]
  generationSources: GenerationSource[]
}

export async function validateEnergyFileTemplate(
  file: File,
  uploadType: EnergyUploadType,
): Promise<TemplateValidationResult> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('uploadType', uploadType)
  formData.append('settlementCalendar', JSON.stringify(readSettlementCalendar()))

  try {
    const response = await fetch('/api/matching/validate', {
      method: 'POST',
      body: formData,
    })
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload

    if (!response.ok) {
      return {
        error: getApiErrorMessage(
          payload,
          'The file could not be validated. Please try again.',
        ),
        emptyCells: [],
        generationSources: [],
      }
    }

    return {
      error: '',
      emptyCells: getApiEmptyCells(payload),
      generationSources: getApiGenerationSources(payload),
    }
  } catch {
    return {
      error:
        'The Python matching service is not available. Please start the backend and try again.',
      emptyCells: [],
      generationSources: [],
    }
  }
}

export async function runMatchingEngine(
  consumptionFile: File,
  generationFile: File,
  options: MatchingEngineOptions = {},
): Promise<MatchingEngineResult> {
  const formData = new FormData()
  formData.append('consumptionFile', consumptionFile)
  formData.append('generationFile', generationFile)
  formData.append(
    'customerAllocations',
    JSON.stringify(options.customerAllocations ?? []),
  )
  formData.append(
    'generatorCommodityMappings',
    JSON.stringify(options.generatorCommodityMappings ?? []),
  )
  formData.append(
    'matchingApproach',
    options.matchingApproach ?? 'non-carry-forward',
  )
  formData.append('settlementCalendar', JSON.stringify(readSettlementCalendar()))

  const response = await fetch('/api/matching/run', {
    method: 'POST',
    body: formData,
  })
  const payload = (await response.json().catch(() => ({}))) as
    | MatchingEngineResult
    | ApiErrorPayload

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(
        payload as ApiErrorPayload,
        'The matching engine could not process these files.',
      ),
    )
  }

  return payload as MatchingEngineResult
}

function getApiErrorMessage(payload: ApiErrorPayload, fallback: string) {
  return typeof payload.error === 'string' && payload.error.trim()
    ? payload.error
    : fallback
}

function getApiEmptyCells(payload: ApiErrorPayload) {
  const emptyCells = (payload as { emptyCells?: unknown }).emptyCells

  return Array.isArray(emptyCells)
    ? emptyCells.filter((cell): cell is string => typeof cell === 'string')
    : []
}

function getApiGenerationSources(payload: ApiErrorPayload) {
  const generationSources = (payload as { generationSources?: unknown })
    .generationSources

  return Array.isArray(generationSources)
    ? generationSources.filter(isGenerationSource)
    : []
}

function isGenerationSource(value: unknown): value is GenerationSource {
  if (!value || typeof value !== 'object') {
    return false
  }

  const generationSource = value as GenerationSource

  return (
    typeof generationSource.siteId === 'string' &&
    typeof generationSource.mpan === 'string'
  )
}
