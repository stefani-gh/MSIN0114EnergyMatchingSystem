export type EnergyUploadType = 'consumption' | 'generation'

export type MatchingApproach =
  | 'carry-forward'
  | 'carry-forward-hourly'
  | 'non-carry-forward'

export const matchingApproachOptions = [
  {
    value: 'non-carry-forward',
    label: 'Half-hourly matching',
  },
  {
    value: 'carry-forward-hourly',
    label: 'Hourly aggregation matching',
  },
  {
    value: 'carry-forward',
    label: 'Daily aggregation matching',
  },
] as const satisfies ReadonlyArray<{
  value: MatchingApproach
  label: string
}>

export const generatorCommodityOptions = [
  'Wind power',
  'Solar power',
  'Hydropower',
  'Biomass energy',
] as const

export type GeneratorCommodity = (typeof generatorCommodityOptions)[number]

export type GenerationSource = {
  siteId: string
  mpan: string
}

export type GeneratorCommodityMapping = GenerationSource & {
  commodity: string
}

export type CommodityEnergyResult = {
  commodity: string
  date: string
  interval: string
  generationKwh: number
  matchedEnergyKwh: number
}

export type HalfHourlyMatchingResult = {
  id: string
  recordNumber: number
  siteId: string
  mpan: string
  date: string
  interval: string
  consumptionKwh: number
  generationKwh: number
  allocatedGenerationKwh?: number
  matchedEnergyKwh: number
  unmatchedConsumptionKwh: number
  excessGenerationKwh: number
  consumptionMatchingPercentage: number
  customerName?: string
  contractId?: string
  customerSharePercentage?: number
  allocationSource?: 'registered-customer' | 'default-100-percent'
}

export type MatchingSummary = {
  totalConsumptionKwh: number
  totalGenerationKwh: number
  totalMatchedEnergyKwh: number
  totalUnmatchedConsumptionKwh: number
  totalExcessGenerationKwh: number
  overallConsumptionMatchingPercentage: number
}

export type MatchingEngineResult = {
  id: string
  title: string
  createdBy: string
  createdAt: string
  consumptionFileName: string
  generationFileName: string
  generatedAt: string
  matchingTypeLabel?: string
  matchingApproach?: MatchingApproach
  matchingApproachLabel?: string
  matchingWarnings?: string[]
  generatorCommodityMappings?: GeneratorCommodityMapping[]
  commodityEnergyResults?: CommodityEnergyResult[]
  results: HalfHourlyMatchingResult[]
  summary: MatchingSummary
}

export type MatchingCustomerAllocation = {
  siteId: string
  mpan: string
  customerName: string
  contractId?: string
  sharePercentage: number
}

const millisecondsPerDay = 24 * 60 * 60 * 1000
const excelDateEpoch = Date.UTC(1899, 11, 30)

export const halfHourlyIntervals = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = ((index + 1) * 30) % (24 * 60)
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')

  return `${hours}:${minutes}`
})

export function normalizeEnergyDateValue(value: string) {
  const normalizedValue = value.trim()
  const numericValue = Number(normalizedValue)

  if (
    normalizedValue &&
    Number.isFinite(numericValue) &&
    numericValue >= 20_000 &&
    numericValue <= 80_000
  ) {
    return formatExcelDate(numericValue)
  }

  return normalizedValue
}

function formatExcelDate(value: number) {
  const date = new Date(excelDateEpoch + Math.floor(value) * millisecondsPerDay)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()

  return `${day}/${month}/${year}`
}
