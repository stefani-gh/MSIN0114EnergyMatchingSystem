import { ArrowLeft, Download, FileDown, Mail, Zap } from 'lucide-react'
import {
  Fragment,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  type LegendPayload,
  ResponsiveContainer,
  Tooltip,
  type TooltipPayloadEntry,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Button,
  DataTable,
  PageContainer,
  PlaceholderNotice,
  SectionCard,
  SelectInput,
  TextInput,
} from '../components/ui'
import {
  halfHourlyIntervals,
  normalizeEnergyDateValue,
  type CommodityEnergyResult,
  type HalfHourlyMatchingResult,
  type MatchingApproach,
  type MatchingCustomerAllocation,
  type MatchingEngineResult,
  type MatchingSummary,
} from '../matchingTypes'
import { useMatchingResults } from '../matchingResultsContext'
import { readCustomerAllocationsFromStorage } from '../registryStorage'
import { useSystemSettings } from '../systemSettingsContext'

const numberFormat = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 2,
})

const percentageFormat = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 2,
})

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const chartColors = {
  consumption: '#3A61F4',
  generation: '#4EBE9E',
  matched: '#3A61F4',
  unmatched: '#F59E0B',
  excess: '#4EBE9E',
  score: '#4EBE9E',
  scoreFill: '#4EBE9E',
  heatmapEmpty: '#F1F5F9',
  heatmapLow: '#BE5A50',
  heatmapHigh: '#4EBE9E',
  granularity: ['#3A61F4', '#C2C9FF', '#4EBE9E'],
  commodityPalette: [
    '#0F766E',
    '#2F9A80',
    '#4EBE9E',
    '#75D7BE',
    '#0B6B57',
    '#5CBFA9',
    '#8BE0CB',
    '#1F8F72',
  ],
}

const chartSeriesLabels: Record<string, string> = {
  consumptionKwh: 'Consumption',
  generationKwh: 'Generation',
  averageConsumptionKwh: 'Average consumption',
  averageGenerationKwh: 'Average generation',
}

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function ResultsPage() {
  const { results, selectResult } = useMatchingResults()
  const navigate = useNavigate()

  return (
    <PageContainer
      title="Matching Results"
      description="Review all submitted matching results."
      actions={
        <Button icon={Zap} onClick={() => navigate('/data-upload')}>
          Match Energy
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {results.length ? (
          <DataTable
            columns={[
              'Title',
              'Consumption File',
              'Generation File',
              'Created by',
              'Created Date and Time',
            ]}
            rows={results.map((matchingResult) => [
                <Link
                  to="/results/view"
                  onClick={() => selectResult(matchingResult.id)}
                  className="font-medium text-[#3A61F4] underline-offset-4 transition hover:underline focus:outline-none focus:ring-2 focus:ring-[#3A61F4]/25"
                >
                  {getResultTitle(matchingResult)}
                </Link>,
                matchingResult.consumptionFileName,
                matchingResult.generationFileName,
                matchingResult.createdBy || 'Unknown user',
                formatDateTime(
                  matchingResult.createdAt || matchingResult.generatedAt,
                ),
              ])}
          />
        ) : (
          <PlaceholderNotice>
            No matching results are available yet. Upload and submit valid
            consumption and generation files to generate results.
          </PlaceholderNotice>
        )}
      </div>

    </PageContainer>
  )
}

export function ResultsDetailPage({ readOnly = false }: { readOnly?: boolean }) {
  const { result } = useMatchingResults()
  const navigate = useNavigate()
  const visualisationsRef = useRef<HTMLDivElement>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false)

  async function handleExportPdf() {
    if (readOnly || !result || !visualisationsRef.current) {
      return
    }

    setIsExportingPdf(true)

    try {
      await exportMatchingResultsPdf(result, visualisationsRef.current)
    } catch (error) {
      console.error(error)
      window.alert('The PDF could not be exported. Please try again.')
    } finally {
      setIsExportingPdf(false)
    }
  }

  const description = result
    ? `${getResultTitle(result)}: ${result.consumptionFileName} matched against ${result.generationFileName}.`
    : 'No matching result is available to view.'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="secondary"
          icon={ArrowLeft}
          onClick={() => navigate('/results')}
        >
          Back to results
        </Button>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            variant="secondary"
            icon={Download}
            disabled={readOnly || !result}
            onClick={() => {
              if (!readOnly && result) {
                downloadResultsCsv(result)
              }
            }}
          >
            Download Results
          </Button>
          <Button
            variant="secondary"
            icon={FileDown}
            disabled={readOnly || !result || isExportingPdf}
            onClick={() => void handleExportPdf()}
          >
            {isExportingPdf ? 'Exporting PDF' : 'Export PDF'}
          </Button>
          <Button
            variant="secondary"
            icon={Mail}
            disabled={readOnly || !result}
            onClick={() => setIsEmailModalOpen(true)}
          >
            Send Email
          </Button>
        </div>
      </div>

      <div className="w-full">
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
          Matching Results
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {description}
        </p>
        {result?.matchingTypeLabel && (
          <p className="mt-1 text-sm leading-6 text-slate-700">
            Matching Type: {result.matchingTypeLabel}.
          </p>
        )}
        {result?.matchingApproachLabel && (
          <p className="mt-1 text-sm leading-6 text-slate-700">
            Matching Approach: {result.matchingApproachLabel}.
          </p>
        )}
        {Boolean(result?.matchingWarnings?.length) && (
          <div className="mt-4 space-y-2">
            {result?.matchingWarnings?.map((warning) => (
              <PlaceholderNotice key={warning}>{warning}</PlaceholderNotice>
            ))}
          </div>
        )}
      </div>

      {!result ? (
        <SectionCard title="Matching visualisations">
          <PlaceholderNotice>
            No matching results are available yet. Upload and submit valid
            consumption and generation files to generate results.
          </PlaceholderNotice>
        </SectionCard>
      ) : (
        <MatchingResultVisualisations
          ref={visualisationsRef}
          result={result}
        />
      )}

      {isEmailModalOpen && (
        <SendEmailModal
          onCancel={() => setIsEmailModalOpen(false)}
          onSend={() => setIsEmailModalOpen(false)}
        />
      )}
    </div>
  )
}

type EmailDraft = {
  to: string
  cc: string
  businessGroup: string
}

type EmailErrors = Partial<Record<keyof Pick<EmailDraft, 'to' | 'cc'>, string>>

const emptyEmailDraft: EmailDraft = {
  to: '',
  cc: '',
  businessGroup: '',
}

function SendEmailModal({
  onCancel,
  onSend,
}: {
  onCancel: () => void
  onSend: () => void
}) {
  const { businessGroups } = useSystemSettings()
  const [draft, setDraft] = useState<EmailDraft>(emptyEmailDraft)
  const [errors, setErrors] = useState<EmailErrors>({})

  function updateDraft(field: keyof EmailDraft, value: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }))

    if (field === 'to' || field === 'cc' || field === 'businessGroup') {
      setErrors((currentErrors) => ({
        ...currentErrors,
        ...(field === 'cc' ? { cc: undefined } : { to: undefined }),
      }))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = validateEmailDraft(draft)

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    window.alert('Email sent')
    onSend()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <form
        aria-labelledby="send-email-title"
        className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2
            id="send-email-title"
            className="text-base font-semibold text-slate-950"
          >
            Send email
          </h2>
        </div>

        <div className="space-y-4 px-5 py-5">
          <TextInput
            autoFocus
            label="To:"
            placeholder="name@example.com; team@example.com"
            value={draft.to}
            error={errors.to}
            onChange={(event) => updateDraft('to', event.target.value)}
          />
          <TextInput
            label="cc:"
            placeholder="name@example.com; team@example.com"
            value={draft.cc}
            error={errors.cc}
            onChange={(event) => updateDraft('cc', event.target.value)}
          />
          <SelectInput
            label="Business Group"
            value={draft.businessGroup}
            disabled={!businessGroups.length}
            onChange={(event) =>
              updateDraft('businessGroup', event.target.value)
            }
          >
            <option value="">
              {businessGroups.length
                ? 'Select business group'
                : 'No business groups available'}
            </option>
            {businessGroups.map((businessGroup) => (
              <option key={businessGroup.id} value={businessGroup.id}>
                {businessGroup.name}
              </option>
            ))}
          </SelectInput>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit">Send</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function validateEmailDraft(draft: EmailDraft): EmailErrors {
  const errors: EmailErrors = {}
  const toAddresses = parseSemicolonSeparatedEmails(draft.to)
  const ccAddresses = parseSemicolonSeparatedEmails(draft.cc)
  const hasBusinessGroup = Boolean(draft.businessGroup)
  const invalidToAddresses = toAddresses.filter((email) => !isValidEmail(email))
  const invalidCcAddresses = ccAddresses.filter((email) => !isValidEmail(email))

  if (!toAddresses.length && !ccAddresses.length && !hasBusinessGroup) {
    errors.to = 'Enter at least one email address or select a business group.'
  } else if (invalidToAddresses.length) {
    errors.to = `Invalid email address: ${invalidToAddresses[0]}`
  }

  if (invalidCcAddresses.length) {
    errors.cc = `Invalid email address: ${invalidCcAddresses[0]}`
  }

  return errors
}

function parseSemicolonSeparatedEmails(value: string) {
  return value
    .split(';')
    .map((email) => email.trim())
    .filter(Boolean)
}

function isValidEmail(value: string) {
  return /^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/.test(value)
}

function MatchingResultVisualisations({
  ref,
  result,
}: {
  ref?: RefObject<HTMLDivElement | null>
  result: MatchingEngineResult
}) {
  const resultGroups = getMatchingResultGroups(result.results)
  const isPortfolioResult = resultGroups.length > 1
  const visualisationSummary = createSummaryFromResults(result.results)
  const commodityEnergyResults = result.commodityEnergyResults ?? []

  return (
    <div ref={ref} className="space-y-6" data-pdf-export-root>
      {isPortfolioResult && (
        <div data-pdf-section>
          <SectionCard title="Portfolio Summary Dashboard">
          <SummaryMetrics
            results={result.results}
            summary={visualisationSummary}
          />
          </SectionCard>
        </div>
      )}

      {isPortfolioResult ? (
        resultGroups.map((resultGroup) => (
          <div key={resultGroup.key} className="space-y-6">
            <div data-pdf-section>
              <MatchingResultGroupHeader group={resultGroup} />
            </div>
            <MatchingVisualisationSet
              results={resultGroup.results}
              summary={resultGroup.summary}
              summaryTitle={`Summary Dashboard`}
              generationLabel="Allocated generation"
              matchingApproach={result.matchingApproach}
            />
          </div>
        ))
      ) : (
        <MatchingVisualisationSet
          results={result.results}
          summary={visualisationSummary}
          summaryTitle="Summary Dashboard"
          generationLabel="Generation"
          matchingApproach={result.matchingApproach}
          commodityEnergyResults={commodityEnergyResults}
        />
      )}

      <CommodityEnergyVisualisations
        commodityEnergyResults={commodityEnergyResults}
      />
    </div>
  )
}

function MatchingVisualisationSet({
  results,
  summary,
  summaryTitle,
  generationLabel,
  matchingApproach,
  commodityEnergyResults = [],
}: {
  results: HalfHourlyMatchingResult[]
  summary: MatchingSummary
  summaryTitle: string
  generationLabel: string
  matchingApproach?: MatchingApproach
  commodityEnergyResults?: CommodityEnergyResult[]
}) {
  const hasCommodityEnergyResults = commodityEnergyResults.length > 0

  return (
    <>
      <div data-pdf-section>
        <SectionCard title={summaryTitle}>
          <SummaryMetrics
            results={results}
            summary={summary}
          />
        </SectionCard>
      </div>

      <div data-pdf-section>
        <SectionCard
          title="Daily Energy Totals"
          description={
            hasCommodityEnergyResults
              ? 'Daily consumption, allocated generation, and mapped commodity generation totals are aggregated from the uploaded half-hourly intervals.'
              : 'Daily consumption and allocated generation totals are aggregated from the uploaded half-hourly intervals.'
          }
        >
          <DailyEnergyLineChart
            results={results}
            generationLabel={generationLabel}
            commodityEnergyResults={commodityEnergyResults}
          />
        </SectionCard>
      </div>

      <div data-pdf-section>
        {matchingApproach === 'carry-forward' ? (
          <SectionCard
            title="Daily Matching Balance"
            description="Daily matched energy, unmatched consumption, and excess allocated generation calculated directly at daily granularity."
          >
            <DailyMatchingBalanceChart results={results} />
          </SectionCard>
        ) : (
          <SectionCard
            title="Average Matching-Period Profile"
            description="Average consumption and allocated generation at the selected matching granularity."
          >
            <AverageDailyProfileChart
              results={results}
              generationLabel={`Average ${generationLabel.toLowerCase()}`}
            />
          </SectionCard>
        )}
      </div>

      {hasCommodityEnergyResults && (
        <div data-pdf-section>
          <SectionCard
            title="Average Commodity Profile"
            description="Average matched energy by commodity across settlement periods."
          >
            <CommodityAverageProfileLineChart
              commodityEnergyResults={commodityEnergyResults}
            />
          </SectionCard>
        </div>
      )}

      <div data-pdf-section>
        <SectionCard
          title="Monthly Energy Breakdown"
          description="Matched energy, unmatched consumption, and excess allocated generation by month."
        >
          <MonthlyEnergyBreakdownChart results={results} />
        </SectionCard>
      </div>

      <div data-pdf-section>
        <SectionCard
          title="Monthly Matching Performance"
          description="Monthly matching percentage shows seasonal performance across the uploaded period."
        >
          <MonthlyMatchingPerformance results={results} />
        </SectionCard>
      </div>

      <div data-pdf-section>
        <SectionCard
          title="Matching Score by Granularity"
          description="Annual and monthly netting compared with the selected matching approach."
        >
          <MatchingScoreComparisonChart results={results} />
        </SectionCard>
      </div>

      <div data-pdf-section>
        <SectionCard
          title={
            matchingApproach === 'carry-forward'
              ? 'Daily Matching Score'
              : 'Matching Score by Matching Period'
          }
          description={
            matchingApproach === 'carry-forward'
              ? 'Consumption-weighted matching score for each date at daily aggregation granularity.'
              : 'Weighted matching score across each period in the selected approach.'
          }
        >
          <MatchingScoreLineChart
            results={results}
            matchingApproach={matchingApproach}
          />
        </SectionCard>
      </div>

      <div data-pdf-section data-pdf-heatmap-section="true">
        <SectionCard
          title="Matching Score Heatmap"
          description="Daily matching score by period at the selected matching granularity."
        >
          <MatchingScoreHeatmap results={results} />
        </SectionCard>
      </div>
    </>
  )
}

function CommodityEnergyVisualisations({
  commodityEnergyResults,
}: {
  commodityEnergyResults: CommodityEnergyResult[]
}) {
  if (!commodityEnergyResults.length) {
    return null
  }

  return (
    <>
      <div data-pdf-section>
        <SectionCard
          title="Daily Matched Energy by Commodity"
          description="Matched energy split by mapped generator commodity."
        >
          <CommodityDailyLineChart
            commodityEnergyResults={commodityEnergyResults}
            valueKey="matchedEnergyKwh"
          />
        </SectionCard>
      </div>
    </>
  )
}

type DailyEnergyPoint = {
  label: string
  consumptionKwh: number
  generationKwh: number
}

type DailyMatchingBalancePoint = {
  label: string
  matchedEnergyKwh: number
  unmatchedConsumptionKwh: number
  excessGenerationKwh: number
}

type DailyEnergyCommodityPoint = DailyEnergyPoint & CommodityChartPoint

type CommodityEnergyValueKey = 'generationKwh' | 'matchedEnergyKwh'

type CommodityChartSeries = {
  commodity: string
  dataKey: string
  color: string
}

type CommodityChartPoint = {
  label: string
  sortOrder: number
} & Record<string, string | number>

type MatchingResultGroup = {
  key: string
  label: string
  siteId: string
  mpan: string
  customerName?: string
  contractId?: string
  sharePercentage: number
  allocationSource: HalfHourlyMatchingResult['allocationSource']
  results: HalfHourlyMatchingResult[]
  summary: MatchingSummary
}

function MatchingResultGroupHeader({ group }: { group: MatchingResultGroup }) {
  const allocationDescription = getGroupAllocationDescription(group)

  return (
    <div className="rounded-lg border border-[#C2C9FF] bg-[#F7F8FF] px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
        Portfolio allocation
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-950">
        {group.label}
      </h2>
      {allocationDescription && (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {allocationDescription}
        </p>
      )}
    </div>
  )
}

function DailyEnergyLineChart({
  results,
  generationLabel,
  commodityEnergyResults = [],
}: {
  results: HalfHourlyMatchingResult[]
  generationLabel: string
  commodityEnergyResults?: CommodityEnergyResult[]
}) {
  const commoditySeries = getCommodityChartSeries(commodityEnergyResults)
  const dailyData = getDailyEnergyDataWithCommodityGeneration(
    getDailyEnergyData(results),
    commodityEnergyResults,
    commoditySeries,
  )

  if (!dailyData.length) {
    return (
      <PlaceholderNotice>
        No daily energy values are available for visualisation.
      </PlaceholderNotice>
    )
  }

  return (
    <div className="min-w-0">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={dailyData}
          margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
        >
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 'auto']}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
            tickFormatter={(value) => formatNumber(Number(value))}
          />
          <Tooltip
            itemSorter={(item) =>
              getDailyEnergySeriesOrder(
                item.dataKey,
                item.name,
                commoditySeries,
              )
            }
            formatter={(value, name) => [
              `${formatNumber(Number(value))} kWh`,
              getDailyEnergySeriesLabel(
                String(name),
                generationLabel,
                commoditySeries,
              ),
            ]}
            labelFormatter={(label) => `Date: ${String(label)}`}
          />
          <Legend
            itemSorter={(item) =>
              getDailyEnergySeriesOrder(
                item.dataKey,
                item.value,
                commoditySeries,
              )
            }
          />
          <Line
            type="linear"
            dataKey="consumptionKwh"
            name="Consumption"
            stroke={chartColors.consumption}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            type="linear"
            dataKey="generationKwh"
            name={generationLabel}
            stroke={chartColors.generation}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
          {commoditySeries.map((commoditySeriesItem) => (
            <Line
              key={commoditySeriesItem.dataKey}
              type="linear"
              dataKey={commoditySeriesItem.dataKey}
              name={`${commoditySeriesItem.commodity} generation`}
              stroke={commoditySeriesItem.color}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function CommodityDailyLineChart({
  commodityEnergyResults,
  valueKey,
}: {
  commodityEnergyResults: CommodityEnergyResult[]
  valueKey: CommodityEnergyValueKey
}) {
  const series = getCommodityChartSeries(commodityEnergyResults)
  const dailyData = getDailyCommodityEnergyData(
    commodityEnergyResults,
    series,
    valueKey,
  )

  return (
    <CommodityEnergyLineChart
      data={dailyData}
      series={series}
      labelFormatter={(label) => `Date: ${String(label)}`}
    />
  )
}

function CommodityAverageProfileLineChart({
  commodityEnergyResults,
}: {
  commodityEnergyResults: CommodityEnergyResult[]
}) {
  const series = getCommodityChartSeries(commodityEnergyResults)
  const profileData = getAverageCommodityProfileData(
    commodityEnergyResults,
    series,
  )

  return (
    <CommodityEnergyLineChart
      data={profileData}
      series={series}
      xAxisInterval={3}
      labelFormatter={(label) => `Matching period: ${String(label)}`}
    />
  )
}

function CommodityEnergyLineChart({
  data,
  series,
  xAxisInterval,
  labelFormatter,
}: {
  data: CommodityChartPoint[]
  series: CommodityChartSeries[]
  xAxisInterval?: number
  labelFormatter: (label: unknown) => string
}) {
  if (!data.length || !series.length) {
    return <ChartEmptyState />
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <LineChart
        data={data}
        margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          interval={xAxisInterval}
          minTickGap={24}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
        />
        <YAxis
          domain={[0, 'auto']}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickFormatter={(value) => formatNumber(Number(value))}
        />
        <Tooltip
          formatter={(value, name) => [
            `${formatNumber(Number(value))} kWh`,
            getCommoditySeriesLabel(series, String(name)),
          ]}
          labelFormatter={labelFormatter}
        />
        <Legend />
        {series.map((commoditySeries) => (
          <Line
            key={commoditySeries.dataKey}
            type="linear"
            dataKey={commoditySeries.dataKey}
            name={commoditySeries.commodity}
            stroke={commoditySeries.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function getDailyEnergyData(results: HalfHourlyMatchingResult[]) {
  const dailyTotals = new Map<number, DailyEnergyPoint>()

  results.forEach((row) => {
    const currentPoint = dailyTotals.get(row.recordNumber) ?? {
      label: normalizeEnergyDateValue(row.date) || `Record ${row.recordNumber}`,
      consumptionKwh: 0,
      generationKwh: 0,
    }

    currentPoint.consumptionKwh += row.consumptionKwh
    currentPoint.generationKwh += getResultGenerationKwh(row)
    dailyTotals.set(row.recordNumber, currentPoint)
  })

  return Array.from(dailyTotals.values())
}

function getDailyEnergyDataWithCommodityGeneration(
  dailyData: DailyEnergyPoint[],
  commodityEnergyResults: CommodityEnergyResult[],
  series: CommodityChartSeries[],
) {
  if (!series.length) {
    return dailyData
  }

  const pointsByLabel = new Map<string, DailyEnergyCommodityPoint>()

  dailyData.forEach((point, index) => {
    pointsByLabel.set(
      point.label,
      createDailyEnergyCommodityPoint(point, index, series),
    )
  })

  getDailyCommodityEnergyData(
    commodityEnergyResults,
    series,
    'generationKwh',
  ).forEach((point) => {
    const label = String(point.label)
    const existingPoint =
      pointsByLabel.get(label) ??
      createDailyEnergyCommodityPoint(
        {
          label,
          consumptionKwh: 0,
          generationKwh: 0,
        },
        Number(point.sortOrder),
        series,
      )

    series.forEach((commoditySeries) => {
      existingPoint[commoditySeries.dataKey] = Number(
        point[commoditySeries.dataKey] ?? 0,
      )
    })
    pointsByLabel.set(label, existingPoint)
  })

  return Array.from(pointsByLabel.values()).sort(
    (firstPoint, secondPoint) => firstPoint.sortOrder - secondPoint.sortOrder,
  )
}

function createDailyEnergyCommodityPoint(
  point: DailyEnergyPoint,
  sortOrder: number,
  series: CommodityChartSeries[],
): DailyEnergyCommodityPoint {
  return series.reduce<DailyEnergyCommodityPoint>(
    (nextPoint, commoditySeries) => ({
      ...nextPoint,
      [commoditySeries.dataKey]: 0,
    }),
    {
      ...point,
      sortOrder,
    },
  )
}

function getDailyEnergySeriesLabel(
  name: string,
  generationLabel: string,
  series: CommodityChartSeries[],
) {
  const commoditySeries = series.find(
    (currentSeries) =>
      currentSeries.dataKey === name ||
      currentSeries.commodity === name ||
      `${currentSeries.commodity} generation` === name,
  )

  if (commoditySeries) {
    return `${commoditySeries.commodity} generation`
  }

  if (name === 'generationKwh') {
    return generationLabel
  }

  return getChartSeriesLabel(name)
}

function getDailyEnergySeriesOrder(
  dataKey: TooltipPayloadEntry['dataKey'] | LegendPayload['dataKey'],
  name: TooltipPayloadEntry['name'] | LegendPayload['value'],
  series: CommodityChartSeries[],
) {
  const key = dataKey === undefined ? '' : String(dataKey)

  if (key === 'consumptionKwh') {
    return 0
  }

  if (key === 'generationKwh') {
    return 1
  }

  const label = name === undefined ? '' : String(name)
  const commodityIndex = series.findIndex(
    (commoditySeries) =>
      commoditySeries.dataKey === key ||
      commoditySeries.commodity === label ||
      `${commoditySeries.commodity} generation` === label,
  )

  return commodityIndex >= 0 ? commodityIndex + 2 : series.length + 2
}

function getCommodityChartSeries(
  commodityEnergyResults: CommodityEnergyResult[],
) {
  const commodities = Array.from(
    new Set(
      commodityEnergyResults.map((record) =>
        getCommodityLabel(record.commodity),
      ),
    ),
  ).sort((firstCommodity, secondCommodity) =>
    firstCommodity.localeCompare(secondCommodity),
  )

  return commodities.map<CommodityChartSeries>((commodity, index) => ({
    commodity,
    dataKey: `commodity_${index}`,
    color:
      chartColors.commodityPalette[
        index % chartColors.commodityPalette.length
      ],
  }))
}

function getDailyCommodityEnergyData(
  commodityEnergyResults: CommodityEnergyResult[],
  series: CommodityChartSeries[],
  valueKey: CommodityEnergyValueKey,
) {
  const seriesByCommodity = getCommoditySeriesMap(series)
  const dailyTotals = new Map<string, CommodityChartPoint>()

  commodityEnergyResults.forEach((record, index) => {
    const day = getHeatmapDayInfo(record.date, index + 1)
    const commoditySeries = seriesByCommodity.get(
      getCommodityLabel(record.commodity),
    )

    if (!commoditySeries) {
      return
    }

    const currentPoint =
      dailyTotals.get(day.key) ??
      createCommodityChartPoint(
        normalizeEnergyDateValue(record.date) || day.label,
        day.sortOrder,
        series,
      )
    currentPoint[commoditySeries.dataKey] =
      Number(currentPoint[commoditySeries.dataKey] ?? 0) + record[valueKey]
    dailyTotals.set(day.key, currentPoint)
  })

  return Array.from(dailyTotals.values()).sort(
    (firstPoint, secondPoint) => firstPoint.sortOrder - secondPoint.sortOrder,
  )
}

function getAverageCommodityProfileData(
  commodityEnergyResults: CommodityEnergyResult[],
  series: CommodityChartSeries[],
) {
  const seriesByCommodity = getCommoditySeriesMap(series)
  const dayKeys = new Set(
    commodityEnergyResults.map(
      (record, index) => getHeatmapDayInfo(record.date, index + 1).key,
    ),
  )
  const divisor = Math.max(dayKeys.size, 1)
  const intervalTotals = new Map<string, CommodityChartPoint>()

  commodityEnergyResults.forEach((record) => {
    const commoditySeries = seriesByCommodity.get(
      getCommodityLabel(record.commodity),
    )

    if (!commoditySeries) {
      return
    }

    const currentPoint =
      intervalTotals.get(record.interval) ??
      createCommodityChartPoint(
        record.interval,
        getIntervalMinutes(record.interval),
        series,
      )
    currentPoint[commoditySeries.dataKey] =
      Number(currentPoint[commoditySeries.dataKey] ?? 0) +
      record.matchedEnergyKwh
    intervalTotals.set(record.interval, currentPoint)
  })

  return Array.from(intervalTotals.values())
    .map((point) => {
      const nextPoint = { ...point }

      series.forEach((commoditySeries) => {
        nextPoint[commoditySeries.dataKey] =
          Number(nextPoint[commoditySeries.dataKey] ?? 0) / divisor
      })

      return nextPoint
    })
    .sort((firstPoint, secondPoint) => firstPoint.sortOrder - secondPoint.sortOrder)
}

function createCommodityChartPoint(
  label: string,
  sortOrder: number,
  series: CommodityChartSeries[],
): CommodityChartPoint {
  return series.reduce<CommodityChartPoint>(
    (point, commoditySeries) => ({
      ...point,
      [commoditySeries.dataKey]: 0,
    }),
    {
      label,
      sortOrder,
    },
  )
}

function getCommoditySeriesMap(series: CommodityChartSeries[]) {
  return new Map(
    series.map((commoditySeries) => [
      commoditySeries.commodity,
      commoditySeries,
    ]),
  )
}

function getCommoditySeriesLabel(
  series: CommodityChartSeries[],
  dataKey: string,
) {
  return (
    series.find((commoditySeries) => commoditySeries.dataKey === dataKey)
      ?.commodity ?? dataKey
  )
}

function getCommodityLabel(value: string) {
  return value.trim() || 'Unmapped commodity'
}

type MonthlyEnergyPoint = {
  month: string
  monthOrder: number
  totalConsumptionKwh: number
  totalGenerationKwh: number
  totalMatchedEnergyKwh: number
  totalUnmatchedConsumptionKwh: number
  totalExcessGenerationKwh: number
  matchingPercentage: number
}

type AverageDailyProfilePoint = {
  interval: string
  intervalOrder: number
  averageConsumptionKwh: number
  averageGenerationKwh: number
}

type MatchingScoreGranularityPoint = {
  granularity: string
  totalConsumptionKwh: number
  totalGenerationKwh: number
  totalMatchedEnergyKwh: number
  matchingScore: number
  fill: string
}

type MatchingScoreSettlementPoint = {
  interval: string
  intervalOrder: number
  totalConsumptionKwh: number
  totalGenerationKwh: number
  totalMatchedEnergyKwh: number
  matchingScore: number
}

type MatchingScoreHeatmapDay = {
  key: string
  label: string
  fullLabel: string
  sortOrder: number
  year?: number
  month?: number
}

type MatchingScoreHeatmapRow = {
  interval: string
  intervalOrder: number
  cells: Array<{
    dayKey: string
    matchingScore: number
    hasData: boolean
    fullLabel: string
  }>
}

type PdfMatchingScoreHeatmapColumn = {
  key: string
  label: string
  order: number
}

type PdfMatchingScoreHeatmapRow = {
  interval: string
  intervalOrder: number
  cells: Array<{
    columnKey: string
    matchingScore: number
    hasData: boolean
    fullLabel: string
  }>
}

type ParsedEnergyDate = {
  year: number
  month: number
  day: number
  timestamp: number
}

function MonthlyMatchingPerformance({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const monthlyData = getMonthlyEnergyData(results)

  if (!monthlyData.length) {
    return <ChartEmptyState />
  }

  return (
    <div className="space-y-5">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={monthlyData}
          margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
        >
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
          <XAxis
            dataKey="month"
            interval={0}
            minTickGap={0}
            angle={-35}
            textAnchor="end"
            height={70}
            tickMargin={12}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
            tickFormatter={(value) => `${formatPercentage(Number(value))}%`}
          />
          <Tooltip
            formatter={(value) => [
              `${formatPercentage(Number(value))}%`,
              'Matching %',
            ]}
          />
          <Bar
            dataKey="matchingPercentage"
            name="Matching %"
            fill={chartColors.consumption}
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

    </div>
  )
}

function DailyMatchingBalanceChart({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const dailyData = getDailyMatchingBalanceData(results)

  if (!dailyData.length) {
    return <ChartEmptyState />
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={dailyData}
        margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          minTickGap={24}
        />
        <YAxis
          domain={[0, 'auto']}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickFormatter={(value) => formatNumber(Number(value))}
        />
        <Tooltip
          formatter={(value, name) => [
            `${formatNumber(Number(value))} kWh`,
            getBreakdownLabel(String(name)),
          ]}
          labelFormatter={(label) => `Date: ${String(label)}`}
        />
        <Legend />
        <Line
          type="linear"
          dataKey="matchedEnergyKwh"
          name="Matched energy"
          stroke={chartColors.matched}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="linear"
          dataKey="unmatchedConsumptionKwh"
          name="Unmatched consumption"
          stroke={chartColors.unmatched}
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="linear"
          dataKey="excessGenerationKwh"
          name="Excess allocated generation"
          stroke={chartColors.excess}
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function AverageDailyProfileChart({
  results,
  generationLabel,
}: {
  results: HalfHourlyMatchingResult[]
  generationLabel: string
}) {
  const profileData = getAverageDailyProfileData(results)

  if (!profileData.length) {
    return <ChartEmptyState />
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={profileData}
        margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis
          dataKey="interval"
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          interval={3}
        />
        <YAxis
          domain={[0, 'auto']}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickFormatter={(value) => formatNumber(Number(value))}
        />
        <Tooltip
          formatter={(value, name) => [
            `${formatNumber(Number(value))} kWh`,
            getChartSeriesLabel(String(name)),
          ]}
          labelFormatter={(label) => `Interval: ${String(label)}`}
        />
        <Legend />
        <Line
          type="linear"
          dataKey="averageConsumptionKwh"
          name="Average consumption"
          stroke={chartColors.consumption}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="linear"
          dataKey="averageGenerationKwh"
          name={generationLabel}
          stroke={chartColors.generation}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function MonthlyEnergyBreakdownChart({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const monthlyData = getMonthlyEnergyData(results)

  if (!monthlyData.length) {
    return <ChartEmptyState />
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart
        data={monthlyData}
        margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
      >
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis
          dataKey="month"
          interval={0}
          minTickGap={0}
          angle={-35}
          textAnchor="end"
          height={70}
          tickMargin={12}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
        />
        <YAxis
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickFormatter={(value) => formatNumber(Number(value))}
        />
        <Tooltip
          formatter={(value, name) => [
            `${formatNumber(Number(value))} kWh`,
            getBreakdownLabel(String(name)),
          ]}
        />
        <Legend />
        <Bar
          stackId="energy"
          dataKey="totalMatchedEnergyKwh"
          name="Matched energy"
          fill={chartColors.matched}
        />
        <Bar
          stackId="energy"
          dataKey="totalUnmatchedConsumptionKwh"
          name="Unmatched consumption"
          fill={chartColors.unmatched}
        />
        <Bar
          stackId="energy"
          dataKey="totalExcessGenerationKwh"
          name="Excess generation"
          fill={chartColors.excess}
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MatchingScoreComparisonChart({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const comparisonData = getMatchingScoreGranularityData(results)

  if (!comparisonData.length) {
    return <ChartEmptyState />
  }

  return (
    <div className="space-y-5">
      <ResponsiveContainer width="100%" height={380}>
        <BarChart
          data={comparisonData}
          margin={{ top: 16, right: 24, bottom: 28, left: 12 }}
        >
          <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
          <XAxis
            dataKey="granularity"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
            tickMargin={12}
            label={{
              position: 'insideBottom',
              offset: -18,
              fill: '#475569',
              fontSize: 12,
              fontWeight: 600,
            }}
          />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={{ stroke: '#CBD5E1' }}
            tickFormatter={(value) => `${formatPercentage(Number(value))}%`}
            label={{
              value: 'Matching Score (%)',
              angle: -90,
              position: 'insideLeft',
              fill: '#475569',
              fontSize: 12,
              fontWeight: 600,
              textAnchor: 'middle',
            }}
          />
          <Tooltip
            formatter={(value) => [
              `${formatPercentage(Number(value))}%`,
              'Matching score',
            ]}
            labelFormatter={(label, payload) => {
              const point = payload[0]?.payload as
                | MatchingScoreGranularityPoint
                | undefined

              return point
                ? `${String(label)}: ${formatKwh(
                    point.totalMatchedEnergyKwh,
                  )} matched from ${formatKwh(point.totalConsumptionKwh)}`
                : String(label)
            }}
          />
          <Bar
            dataKey="matchingScore"
            name="Matching score"
            radius={[7, 7, 0, 0]}
            maxBarSize={96}
          >
            {comparisonData.map((point) => (
              <Cell key={point.granularity} fill={point.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function MatchingScoreLineChart({
  results,
  matchingApproach,
}: {
  results: HalfHourlyMatchingResult[]
  matchingApproach?: MatchingApproach
}) {
  const gradientId = useId().replaceAll(':', '')
  const settlementData =
    matchingApproach === 'carry-forward'
      ? getDailyMatchingScoreData(results)
      : getSettlementPeriodMatchingScoreData(results)
  const isDailyAggregation = matchingApproach === 'carry-forward'

  if (!settlementData.length) {
    return <ChartEmptyState />
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <AreaChart
        data={settlementData}
        margin={{ top: 12, right: 24, bottom: 16, left: 8 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartColors.score} stopOpacity={0.26} />
            <stop offset="100%" stopColor={chartColors.score} stopOpacity={0.08} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" />
        <XAxis
          dataKey="interval"
          interval={isDailyAggregation ? 'preserveStartEnd' : 5}
          minTickGap={isDailyAggregation ? 24 : undefined}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickMargin={12}
        />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={{ stroke: '#CBD5E1' }}
          tickFormatter={(value) => `${formatPercentage(Number(value))}%`}
        />
        <Tooltip
          formatter={(value) => [
            `${formatPercentage(Number(value))}%`,
            'Matching score',
          ]}
          labelFormatter={(label) =>
            `${isDailyAggregation ? 'Date' : 'Matching period'}: ${String(label)}`
          }
        />
        <Area
          type="linear"
          dataKey="matchingScore"
          name="Matching score"
          stroke={chartColors.score}
          strokeWidth={3}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function MatchingScoreHeatmap({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const heatmapData = getMatchingScoreHeatmapData(results)

  if (!heatmapData.days.length || !heatmapData.rows.length) {
    return <ChartEmptyState />
  }

  const dayColumnWidth = getHeatmapDayColumnWidth(heatmapData.days.length)
  const monthAxisSegments = getHeatmapMonthAxisSegments(heatmapData.days)
  const yAxisLabelWidth = 52
  const timeColumnWidth = 68
  const gridMinWidth =
    yAxisLabelWidth +
    timeColumnWidth +
    heatmapData.days.length * dayColumnWidth

  return (
    <div className="space-y-3">
      <div data-pdf-screen-only className="space-y-3">
        <div
          className="max-h-[760px] overflow-auto rounded-lg border border-slate-200"
          data-pdf-expand-scroll
        >
          <div className="min-w-max">
            <div
              className="grid gap-px text-xs"
              style={{
                gridTemplateColumns: `${yAxisLabelWidth}px ${timeColumnWidth}px repeat(${heatmapData.days.length}, ${dayColumnWidth}px)`,
                minWidth: `${gridMinWidth}px`,
              }}
            >
              <div
                className="sticky left-0 z-30 flex items-center justify-center border-r border-slate-200 bg-white text-sm font-semibold text-slate-700"
                style={{
                  gridRow: `1 / span ${heatmapData.rows.length}`,
                  minHeight: `${heatmapData.rows.length * 20}px`,
                }}
              >
                Time
              </div>

              {heatmapData.rows.map((row, rowIndex) => (
                <Fragment key={row.interval}>
                  <div
                    className="sticky z-20 flex h-5 items-center justify-end border-r border-slate-200 bg-white pr-2 text-xs font-medium text-slate-600"
                    style={{ left: `${yAxisLabelWidth}px` }}
                    title={row.interval}
                  >
                    {rowIndex % 2 === 0 ? row.interval : ''}
                  </div>
                  {row.cells.map((cell) => (
                    <div
                      key={`${row.interval}-${cell.dayKey}`}
                      className="h-5"
                      style={{
                        backgroundColor: getMatchingScoreHeatmapColor(
                          cell.matchingScore,
                          cell.hasData,
                        ),
                      }}
                      title={`${cell.fullLabel} ${row.interval}: ${
                        cell.hasData
                          ? `${formatPercentage(cell.matchingScore)}% matching score`
                          : 'No data'
                      }`}
                    />
                  ))}
                </Fragment>
              ))}

              <div
                className="sticky bottom-[28px] left-0 z-30 h-7 border-r border-t border-slate-200 bg-white"
                style={{ gridColumn: '1 / span 2' }}
              />
              {monthAxisSegments.map((segment) => (
                <div
                  key={segment.key}
                  className="sticky bottom-[28px] z-10 flex h-7 items-center justify-center whitespace-nowrap border-t border-slate-200 bg-white text-xs font-semibold text-slate-600"
                  style={{
                    gridColumn: `${segment.startColumn} / span ${segment.columnSpan}`,
                  }}
                  title={segment.label}
                >
                  {segment.label}
                </div>
              ))}
              <div
                className="sticky bottom-0 left-0 z-30 h-7 border-r border-slate-200 bg-white"
                style={{ gridColumn: '1 / span 2' }}
              />
              <div
                className="sticky bottom-0 z-10 flex h-7 items-center justify-center bg-white text-sm font-semibold text-slate-700"
                style={{ gridColumn: `3 / span ${heatmapData.days.length}` }}
              >
                Matching Period
              </div>
            </div>
          </div>
        </div>
        <HeatmapLegend />
      </div>

      <div className="hidden" data-pdf-only>
        <PdfMatchingScoreHeatmap results={results} />
      </div>
    </div>
  )
}

function PdfMatchingScoreHeatmap({
  results,
}: {
  results: HalfHourlyMatchingResult[]
}) {
  const heatmapData = getPdfMatchingScoreHeatmapData(results)

  if (!heatmapData.columns.length || !heatmapData.rows.length) {
    return <ChartEmptyState />
  }

  const intervalColumnWidth = 96
  const monthColumnWidth = heatmapData.columns.length > 12 ? 48 : 64
  const gridMinWidth =
    intervalColumnWidth + heatmapData.columns.length * monthColumnWidth

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-950">
            Monthly matching score summary
          </p>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Average by matching period
          </p>
        </div>
        <div
          className="grid gap-px text-xs"
          style={{
            gridTemplateColumns: `${intervalColumnWidth}px repeat(${heatmapData.columns.length}, ${monthColumnWidth}px)`,
            minWidth: `${gridMinWidth}px`,
          }}
        >
          <div className="flex h-8 items-center justify-end border-b border-r border-slate-200 bg-slate-50 pr-2 text-[11px] font-semibold text-slate-700">
            Matching period
          </div>
          {heatmapData.columns.map((column) => (
            <div
              key={column.key}
              className="flex h-8 items-center justify-center border-b border-slate-200 bg-slate-50 px-1 text-center text-[10px] font-semibold leading-3 text-slate-700"
              title={column.label}
            >
              {column.label}
            </div>
          ))}

          {heatmapData.rows.map((row, rowIndex) => (
            <Fragment key={row.interval}>
              <div
                className="flex h-4 items-center justify-end border-r border-slate-100 bg-white pr-2 text-[10px] font-medium text-slate-600"
                title={row.interval}
              >
                {rowIndex % 2 === 0 ? row.interval : ''}
              </div>
              {row.cells.map((cell) => (
                <div
                  key={`${row.interval}-${cell.columnKey}`}
                  className="h-4"
                  style={{
                    backgroundColor: getMatchingScoreHeatmapColor(
                      cell.matchingScore,
                      cell.hasData,
                    ),
                  }}
                  title={`${cell.fullLabel} ${row.interval}: ${
                    cell.hasData
                      ? `${formatPercentage(cell.matchingScore)}% matching score`
                      : 'No data'
                  }`}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      <HeatmapLegend />
    </div>
  )
}

function HeatmapLegend() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div
        className="h-4 rounded"
        style={{
          background:
            'linear-gradient(to right, #BE5A50 0%, #d6c51f 50%, #4EBE9E 100%)',
        }}
      />
      <div className="mt-1 flex justify-between text-xs font-medium text-slate-500">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
      <p className="mt-1 text-center text-xs font-semibold text-slate-600">
        Matching score
      </p>
    </div>
  )
}

function ChartEmptyState() {
  return (
    <PlaceholderNotice>
      No matching result values are available for this visualisation.
    </PlaceholderNotice>
  )
}

function getMatchingResultGroups(results: HalfHourlyMatchingResult[]) {
  const customerAllocationMap = getCustomerAllocationMap()
  const groupMap = new Map<
    string,
    Omit<MatchingResultGroup, 'summary'>
  >()

  results.forEach((row) => {
    const key = getMatchingResultGroupKey(row)
    const customerAllocation = customerAllocationMap.get(key)
    const existingGroup =
      groupMap.get(key) ??
      {
        key,
        label: getMatchingResultGroupLabel(row, customerAllocation),
        siteId: row.siteId,
        mpan: row.mpan,
        customerName: row.customerName ?? customerAllocation?.customerName,
        contractId: row.contractId ?? customerAllocation?.contractId,
        sharePercentage:
          row.customerSharePercentage ?? customerAllocation?.sharePercentage ?? 100,
        allocationSource:
          row.allocationSource ??
          (customerAllocation ? 'registered-customer' : 'default-100-percent'),
        results: [],
      }

    existingGroup.results.push(row)
    groupMap.set(key, existingGroup)
  })

  return Array.from(groupMap.values()).map<MatchingResultGroup>((group) => ({
    ...group,
    summary: createSummaryFromResults(group.results),
  }))
}

function getMatchingResultGroupKey(row: HalfHourlyMatchingResult) {
  return getMatchingResultGroupKeyFromValues(row.siteId, row.mpan)
}

function getMatchingResultGroupKeyFromValues(siteId: string, mpan: string) {
  return `${normalizeGroupKey(siteId)}|${normalizeGroupKey(mpan)}`
}

function getMatchingResultGroupLabel(
  row: HalfHourlyMatchingResult,
  customerAllocation?: MatchingCustomerAllocation,
) {
  const customerName =
    row.customerName?.trim() || customerAllocation?.customerName?.trim()
  const contractId = row.contractId?.trim() || customerAllocation?.contractId?.trim()
  const sharePercentage =
    row.customerSharePercentage ?? customerAllocation?.sharePercentage ?? 100
  const allocationSource =
    row.allocationSource ??
    (customerAllocation ? 'registered-customer' : 'default-100-percent')
  const labelParts = [
    customerName,
    row.siteId ? `Site ID: ${row.siteId}` : '',
    row.mpan ? `MPAN: ${row.mpan}` : '',
    getAllocationLabel(allocationSource, sharePercentage, contractId),
  ].filter(Boolean)

  return labelParts.join(' | ') || `Record ${row.recordNumber}`
}

function getAllocationLabel(
  allocationSource: HalfHourlyMatchingResult['allocationSource'],
  sharePercentage: number,
  contractId?: string,
) {
  if (allocationSource !== 'registered-customer') {
    return ''
  }

  const shareLabel = `${formatPercentage(sharePercentage)}%`
  const normalizedContractId = contractId?.trim()

  return normalizedContractId
    ? `${shareLabel} is allocated from Contract ID ${normalizedContractId}`
    : `${shareLabel} is allocated from Contract ID`
}

function getCustomerAllocationMap() {
  const allocationMap = new Map<string, MatchingCustomerAllocation>()

  readCustomerAllocationsFromStorage().forEach((allocation) => {
    allocationMap.set(
      getMatchingResultGroupKeyFromValues(allocation.siteId, allocation.mpan),
      allocation,
    )
  })

  return allocationMap
}

function getGroupAllocationDescription(group: MatchingResultGroup) {
  if (group.allocationSource === 'registered-customer') {
    return ''
  }

  return 'No registered contracted share was found, so these visualisations use the default 100% allocation.'
}

function createSummaryFromResults(results: HalfHourlyMatchingResult[]) {
  const summary: MatchingSummary = {
    totalConsumptionKwh: 0,
    totalGenerationKwh: 0,
    totalMatchedEnergyKwh: 0,
    totalUnmatchedConsumptionKwh: 0,
    totalExcessGenerationKwh: 0,
    overallConsumptionMatchingPercentage: 0,
  }

  results.forEach((row) => {
    summary.totalConsumptionKwh += row.consumptionKwh
    summary.totalGenerationKwh += getResultGenerationKwh(row)
    summary.totalMatchedEnergyKwh += row.matchedEnergyKwh
    summary.totalUnmatchedConsumptionKwh += row.unmatchedConsumptionKwh
    summary.totalExcessGenerationKwh += row.excessGenerationKwh
  })

  summary.overallConsumptionMatchingPercentage =
    summary.totalConsumptionKwh === 0
      ? 0
      : (summary.totalMatchedEnergyKwh / summary.totalConsumptionKwh) * 100

  return summary
}

function getResultGenerationKwh(row: HalfHourlyMatchingResult) {
  return row.allocatedGenerationKwh ?? row.generationKwh
}

function normalizeGroupKey(value: string) {
  return value.trim().toLowerCase()
}

function getMonthlyEnergyData(results: HalfHourlyMatchingResult[]) {
  const monthlyTotals = new Map<string, MonthlyEnergyPoint>()

  results.forEach((row) => {
    const monthInfo = getMonthInfo(row.date, row.recordNumber)
    const currentPoint = monthlyTotals.get(monthInfo.key) ?? {
      month: monthInfo.label,
      monthOrder: monthInfo.order,
      totalConsumptionKwh: 0,
      totalGenerationKwh: 0,
      totalMatchedEnergyKwh: 0,
      totalUnmatchedConsumptionKwh: 0,
      totalExcessGenerationKwh: 0,
      matchingPercentage: 0,
    }

    currentPoint.totalConsumptionKwh += row.consumptionKwh
    currentPoint.totalGenerationKwh += getResultGenerationKwh(row)
    currentPoint.totalMatchedEnergyKwh += row.matchedEnergyKwh
    currentPoint.totalUnmatchedConsumptionKwh += row.unmatchedConsumptionKwh
    currentPoint.totalExcessGenerationKwh += row.excessGenerationKwh
    monthlyTotals.set(monthInfo.key, currentPoint)
  })

  return Array.from(monthlyTotals.values())
    .map((point) => ({
      ...point,
      matchingPercentage:
        point.totalConsumptionKwh === 0
          ? 0
          : (point.totalMatchedEnergyKwh / point.totalConsumptionKwh) * 100,
    }))
    .sort((firstPoint, secondPoint) => firstPoint.monthOrder - secondPoint.monthOrder)
}

function getAverageDailyProfileData(results: HalfHourlyMatchingResult[]) {
  const intervalOrder = new Map(
    halfHourlyIntervals.map((interval, index) => [interval, index]),
  )
  const profileTotals = new Map<
    string,
    AverageDailyProfilePoint & {
      consumptionTotal: number
      generationTotal: number
      count: number
    }
  >()

  results.forEach((row) => {
    const currentPoint = profileTotals.get(row.interval) ?? {
      interval: row.interval,
      intervalOrder: intervalOrder.get(row.interval) ?? profileTotals.size,
      averageConsumptionKwh: 0,
      averageGenerationKwh: 0,
      consumptionTotal: 0,
      generationTotal: 0,
      count: 0,
    }

    currentPoint.consumptionTotal += row.consumptionKwh
    currentPoint.generationTotal += getResultGenerationKwh(row)
    currentPoint.count += 1
    profileTotals.set(row.interval, currentPoint)
  })

  return Array.from(profileTotals.values())
    .map((point) => ({
      interval: point.interval,
      intervalOrder: point.intervalOrder,
      averageConsumptionKwh:
        point.count === 0 ? 0 : point.consumptionTotal / point.count,
      averageGenerationKwh:
        point.count === 0 ? 0 : point.generationTotal / point.count,
    }))
    .sort((firstPoint, secondPoint) => firstPoint.intervalOrder - secondPoint.intervalOrder)
}

function getDailyMatchingBalanceData(
  results: HalfHourlyMatchingResult[],
): DailyMatchingBalancePoint[] {
  const dailyTotals = new Map<number, DailyMatchingBalancePoint>()

  results.forEach((row) => {
    const currentPoint = dailyTotals.get(row.recordNumber) ?? {
      label: normalizeEnergyDateValue(row.date) || `Record ${row.recordNumber}`,
      matchedEnergyKwh: 0,
      unmatchedConsumptionKwh: 0,
      excessGenerationKwh: 0,
    }

    currentPoint.matchedEnergyKwh += row.matchedEnergyKwh
    currentPoint.unmatchedConsumptionKwh += row.unmatchedConsumptionKwh
    currentPoint.excessGenerationKwh += row.excessGenerationKwh
    dailyTotals.set(row.recordNumber, currentPoint)
  })

  return Array.from(dailyTotals.values())
}

function getMatchingScoreGranularityData(results: HalfHourlyMatchingResult[]) {
  const totalConsumptionKwh = results.reduce(
    (total, row) => total + row.consumptionKwh,
    0,
  )
  const totalGenerationKwh = results.reduce(
    (total, row) => total + getResultGenerationKwh(row),
    0,
  )
  const annualMatchedEnergyKwh = getNettedMatchedEnergy(
    totalConsumptionKwh,
    totalGenerationKwh,
  )
  const monthlyMatchedEnergyKwh = getMonthlyEnergyData(results).reduce(
    (total, month) =>
      total +
      getNettedMatchedEnergy(
        month.totalConsumptionKwh,
        month.totalGenerationKwh,
      ),
    0,
  )
  const intervalMatchedEnergyKwh = results.reduce(
    (total, row) => total + row.matchedEnergyKwh,
    0,
  )
  const points = [
    {
      granularity: 'Annual',
      totalMatchedEnergyKwh: annualMatchedEnergyKwh,
    },
    {
      granularity: 'Monthly',
      totalMatchedEnergyKwh: monthlyMatchedEnergyKwh,
    },
    {
      granularity: getResultPeriodLabel(results),
      totalMatchedEnergyKwh: intervalMatchedEnergyKwh,
    },
  ]

  if (totalConsumptionKwh <= 0) {
    return []
  }

  return points.map<MatchingScoreGranularityPoint>((point, index) => ({
    ...point,
    totalConsumptionKwh,
    totalGenerationKwh,
    matchingScore: calculateMatchingScore(
      point.totalMatchedEnergyKwh,
      totalConsumptionKwh,
    ),
    fill: chartColors.granularity[index % chartColors.granularity.length],
  }))
}

function getSettlementPeriodMatchingScoreData(
  results: HalfHourlyMatchingResult[],
) {
  const intervalOrder = new Map(
    getSettlementIntervalsInUse(results).map((interval, index) => [
      interval,
      index,
    ]),
  )
  const intervalTotals = new Map<string, MatchingScoreSettlementPoint>()

  results.forEach((row) => {
    const currentPoint = intervalTotals.get(row.interval) ?? {
      interval: row.interval,
      intervalOrder: intervalOrder.get(row.interval) ?? intervalTotals.size,
      totalConsumptionKwh: 0,
      totalGenerationKwh: 0,
      totalMatchedEnergyKwh: 0,
      matchingScore: 0,
    }

    addMatchingScoreTotals(currentPoint, row)
    intervalTotals.set(row.interval, currentPoint)
  })

  return Array.from(intervalTotals.values())
    .map((point) => ({
      ...point,
      matchingScore: calculateMatchingScore(
        point.totalMatchedEnergyKwh,
        point.totalConsumptionKwh,
      ),
    }))
    .sort((firstPoint, secondPoint) => firstPoint.intervalOrder - secondPoint.intervalOrder)
}

function getDailyMatchingScoreData(
  results: HalfHourlyMatchingResult[],
): MatchingScoreSettlementPoint[] {
  const dailyTotals = new Map<number, MatchingScoreSettlementPoint>()

  results.forEach((row) => {
    const currentPoint = dailyTotals.get(row.recordNumber) ?? {
      interval: normalizeEnergyDateValue(row.date) || `Record ${row.recordNumber}`,
      intervalOrder: dailyTotals.size,
      totalConsumptionKwh: 0,
      totalGenerationKwh: 0,
      totalMatchedEnergyKwh: 0,
      matchingScore: 0,
    }

    addMatchingScoreTotals(currentPoint, row)
    dailyTotals.set(row.recordNumber, currentPoint)
  })

  return Array.from(dailyTotals.values()).map((point) => ({
    ...point,
    matchingScore: calculateMatchingScore(
      point.totalMatchedEnergyKwh,
      point.totalConsumptionKwh,
    ),
  }))
}

function getMatchingScoreHeatmapData(results: HalfHourlyMatchingResult[]) {
  const dayMap = new Map<string, MatchingScoreHeatmapDay>()
  const cellTotals = new Map<
    string,
    {
      totalConsumptionKwh: number
      totalMatchedEnergyKwh: number
      count: number
    }
  >()
  const intervals = getSettlementIntervalsInUse(results)
  const intervalOrder = new Map(
    intervals.map((interval, index) => [interval, index]),
  )

  results.forEach((row) => {
    const day = getHeatmapDayInfo(row.date, row.recordNumber)
    const cellKey = `${day.key}|${row.interval}`
    const currentCell = cellTotals.get(cellKey) ?? {
      totalConsumptionKwh: 0,
      totalMatchedEnergyKwh: 0,
      count: 0,
    }

    dayMap.set(day.key, day)
    currentCell.totalConsumptionKwh += row.consumptionKwh
    currentCell.totalMatchedEnergyKwh += row.matchedEnergyKwh
    currentCell.count += 1
    cellTotals.set(cellKey, currentCell)
  })

  const days = Array.from(dayMap.values()).sort(
    (firstDay, secondDay) => firstDay.sortOrder - secondDay.sortOrder,
  )
  const rows = intervals
    .map<MatchingScoreHeatmapRow>((interval) => ({
      interval,
      intervalOrder: intervalOrder.get(interval) ?? 0,
      cells: days.map((day) => {
        const cell = cellTotals.get(`${day.key}|${interval}`)

        return {
          dayKey: day.key,
          matchingScore: cell
            ? calculateMatchingScore(
                cell.totalMatchedEnergyKwh,
                cell.totalConsumptionKwh,
              )
            : 0,
          hasData: Boolean(cell?.count),
          fullLabel: day.fullLabel,
        }
      }),
    }))
    .sort((firstRow, secondRow) => firstRow.intervalOrder - secondRow.intervalOrder)

  return { days, rows }
}

function getPdfMatchingScoreHeatmapData(results: HalfHourlyMatchingResult[]) {
  const columnMap = new Map<string, PdfMatchingScoreHeatmapColumn>()
  const cellTotals = new Map<
    string,
    {
      totalConsumptionKwh: number
      totalMatchedEnergyKwh: number
      count: number
    }
  >()
  const intervals = getSettlementIntervalsInUse(results)
  const intervalOrder = new Map(
    intervals.map((interval, index) => [interval, index]),
  )

  results.forEach((row) => {
    const column = getMonthInfo(row.date, row.recordNumber)
    const cellKey = `${column.key}|${row.interval}`
    const currentCell = cellTotals.get(cellKey) ?? {
      totalConsumptionKwh: 0,
      totalMatchedEnergyKwh: 0,
      count: 0,
    }

    columnMap.set(column.key, column)
    currentCell.totalConsumptionKwh += row.consumptionKwh
    currentCell.totalMatchedEnergyKwh += row.matchedEnergyKwh
    currentCell.count += 1
    cellTotals.set(cellKey, currentCell)
  })

  const columns = Array.from(columnMap.values()).sort(
    (firstColumn, secondColumn) => firstColumn.order - secondColumn.order,
  )
  const rows = intervals
    .map<PdfMatchingScoreHeatmapRow>((interval) => ({
      interval,
      intervalOrder: intervalOrder.get(interval) ?? 0,
      cells: columns.map((column) => {
        const cell = cellTotals.get(`${column.key}|${interval}`)

        return {
          columnKey: column.key,
          matchingScore: cell
            ? calculateMatchingScore(
                cell.totalMatchedEnergyKwh,
                cell.totalConsumptionKwh,
              )
            : 0,
          hasData: Boolean(cell?.count),
          fullLabel: column.label,
        }
      }),
    }))
    .sort((firstRow, secondRow) => firstRow.intervalOrder - secondRow.intervalOrder)

  return { columns, rows }
}

function addMatchingScoreTotals(
  target: {
    totalConsumptionKwh: number
    totalGenerationKwh: number
    totalMatchedEnergyKwh: number
  },
  row: HalfHourlyMatchingResult,
) {
  target.totalConsumptionKwh += row.consumptionKwh
  target.totalGenerationKwh += getResultGenerationKwh(row)
  target.totalMatchedEnergyKwh += row.matchedEnergyKwh
}

function calculateMatchingScore(matchedEnergyKwh: number, consumptionKwh: number) {
  if (consumptionKwh <= 0) {
    return 0
  }

  return Math.max(0, Math.min((matchedEnergyKwh / consumptionKwh) * 100, 100))
}

function getNettedMatchedEnergy(consumptionKwh: number, generationKwh: number) {
  return Math.min(consumptionKwh, generationKwh)
}

function getSettlementIntervalsInUse(results: HalfHourlyMatchingResult[]) {
  const intervalLabels = new Set<string>()

  results.forEach((row) => {
    if (row.interval.trim()) {
      intervalLabels.add(row.interval)
    }
  })

  return Array.from(intervalLabels).sort(
    (firstInterval, secondInterval) =>
      getIntervalMinutes(firstInterval) - getIntervalMinutes(secondInterval),
  )
}

function getResultPeriodLabel(results: HalfHourlyMatchingResult[]) {
  if (results.some((row) => row.interval === 'Daily')) {
    return 'Daily'
  }

  if (
    results.length > 0 &&
    results.every((row) => /^\d{2}:00$/.test(row.interval))
  ) {
    return 'Hourly'
  }

  return '30-Minute'
}

function getIntervalMinutes(interval: string) {
  const timeMatch = interval.match(/^(\d{1,2}):(\d{2})$/)

  if (!timeMatch) {
    return Number.MAX_SAFE_INTEGER
  }

  return Number(timeMatch[1]) * 60 + Number(timeMatch[2])
}

function getHeatmapDayInfo(dateValue: string, fallbackOrder: number) {
  const parsedDate = getParsedEnergyDate(dateValue)

  if (parsedDate) {
    const dayLabel = `${String(parsedDate.day).padStart(2, '0')} ${
      monthNames[parsedDate.month - 1]
    }`

    return {
      key: `${parsedDate.year}-${String(parsedDate.month).padStart(
        2,
        '0',
      )}-${String(parsedDate.day).padStart(2, '0')}`,
      label: dayLabel,
      fullLabel: `${dayLabel} ${parsedDate.year}`,
      sortOrder: parsedDate.timestamp,
      year: parsedDate.year,
      month: parsedDate.month,
    }
  }

  return {
    key: `record-${fallbackOrder}`,
    label: `Record ${fallbackOrder}`,
    fullLabel: `Record ${fallbackOrder}`,
    sortOrder: Number.MAX_SAFE_INTEGER - fallbackOrder,
  }
}

function getMonthInfo(dateValue: string, fallbackOrder: number) {
  const parsedDate = getParsedEnergyDate(dateValue)

  if (parsedDate) {
    return {
      key: `${parsedDate.year}-${String(parsedDate.month).padStart(2, '0')}`,
      label: `${monthNames[parsedDate.month - 1]} ${parsedDate.year}`,
      order: parsedDate.year * 12 + parsedDate.month,
    }
  }

  return {
    key: 'unknown',
    label: 'Unknown',
    order: Number.MAX_SAFE_INTEGER - fallbackOrder,
  }
}

function getParsedEnergyDate(dateValue: string): ParsedEnergyDate | null {
  const normalizedDate = normalizeEnergyDateValue(dateValue)
  const isoMatch = normalizedDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const ukMatch = normalizedDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/)
  const parsedDate = isoMatch
    ? {
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3]),
      }
    : ukMatch
      ? {
          year: normalizeYear(Number(ukMatch[3])),
          month: Number(ukMatch[2]),
          day: Number(ukMatch[1]),
        }
      : null

  if (
    !parsedDate ||
    parsedDate.month < 1 ||
    parsedDate.month > 12 ||
    parsedDate.day < 1 ||
    parsedDate.day > 31 ||
    parsedDate.year < 1900
  ) {
    return null
  }

  const timestamp = Date.UTC(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
  )
  const date = new Date(timestamp)

  if (
    date.getUTCFullYear() !== parsedDate.year ||
    date.getUTCMonth() !== parsedDate.month - 1 ||
    date.getUTCDate() !== parsedDate.day
  ) {
    return null
  }

  return {
    ...parsedDate,
    timestamp,
  }
}

function getHeatmapDayColumnWidth(dayCount: number) {
  if (dayCount > 300) {
    return 8
  }

  if (dayCount > 180) {
    return 10
  }

  if (dayCount > 90) {
    return 12
  }

  if (dayCount > 45) {
    return 16
  }

  return 24
}

function getHeatmapMonthAxisSegments(days: MatchingScoreHeatmapDay[]) {
  const segments: Array<{
    key: string
    label: string
    startColumn: number
    columnSpan: number
  }> = []

  days.forEach((day, index) => {
    const key = day.month && day.year
      ? `${day.year}-${String(day.month).padStart(2, '0')}`
      : day.key
    const previousSegment = segments[segments.length - 1]

    if (previousSegment?.key === key) {
      previousSegment.columnSpan += 1
      return
    }

    segments.push({
      key,
      label:
        day.month && day.year
          ? `${monthNames[day.month - 1]} ${day.year}`
          : day.label,
      startColumn: index + 3,
      columnSpan: 1,
    })
  })

  return segments
}

function getMatchingScoreHeatmapColor(matchingScore: number, hasData: boolean) {
  if (!hasData) {
    return chartColors.heatmapEmpty
  }

  const boundedScore = Math.max(0, Math.min(matchingScore, 100))

  return interpolateHexColor(
    chartColors.heatmapLow,
    chartColors.heatmapHigh,
    boundedScore / 100,
  )
}

function interpolateHexColor(startColor: string, endColor: string, ratio: number) {
  const start = hexToRgb(startColor)
  const end = hexToRgb(endColor)
  const boundedRatio = Math.max(0, Math.min(ratio, 1))
  const red = Math.round(start.red + (end.red - start.red) * boundedRatio)
  const green = Math.round(
    start.green + (end.green - start.green) * boundedRatio,
  )
  const blue = Math.round(start.blue + (end.blue - start.blue) * boundedRatio)

  return `rgb(${red}, ${green}, ${blue})`
}

function hexToRgb(color: string) {
  const normalizedColor = color.replace('#', '')

  return {
    red: Number.parseInt(normalizedColor.slice(0, 2), 16),
    green: Number.parseInt(normalizedColor.slice(2, 4), 16),
    blue: Number.parseInt(normalizedColor.slice(4, 6), 16),
  }
}

function normalizeYear(year: number) {
  if (year < 100) {
    return year >= 70 ? 1900 + year : 2000 + year
  }

  return year
}

function getChartSeriesLabel(name: string) {
  return chartSeriesLabels[name] ?? name
}

function getBreakdownLabel(dataKey: string) {
  const labels: Record<string, string> = {
    matchedEnergyKwh: 'Matched energy',
    unmatchedConsumptionKwh: 'Unmatched consumption',
    excessGenerationKwh: 'Excess allocated generation',
    totalMatchedEnergyKwh: 'Matched energy',
    totalUnmatchedConsumptionKwh: 'Unmatched consumption',
    totalExcessGenerationKwh: 'Excess generation',
  }

  return labels[dataKey] ?? dataKey
}

function SummaryMetrics({
  results,
  summary,
}: {
  results: HalfHourlyMatchingResult[]
  summary: MatchingSummary
}) {
  const dailyExtremes = getDailyEnergyExtremes(results)
  const dailyAverages = getDailyEnergyAverages(results)
  const matchingTone = getOverallMatchingTone(
    summary.overallConsumptionMatchingPercentage,
  )
  const kpiMetrics = [
    {
      label: 'Total Consumption',
      value: formatKwh(summary.totalConsumptionKwh),
    },
    {
      label: 'Total Matched Energy',
      value: formatKwh(summary.totalMatchedEnergyKwh),
    },
    {
      label: 'Average Consumption',
      value: getKwhDisplayValue(dailyAverages.averageConsumption),
    },
    {
      label: 'Maximum Consumption',
      value: getKwhDateDisplayValue(dailyExtremes.maximumConsumption),
    },
    {
      label: 'Minimum Consumption',
      value: getKwhDateDisplayValue(dailyExtremes.minimumConsumption),
    },
    {
      label: 'Total Generation',
      value: formatKwh(summary.totalGenerationKwh),
    },
    {
      label: 'Total Excess Generation',
      value: formatKwh(summary.totalExcessGenerationKwh),
    },
    {
      label: 'Average Generation',
      value: getKwhDisplayValue(dailyAverages.averageGeneration),
    },
    {
      label: 'Maximum Generation',
      value: getKwhDateDisplayValue(dailyExtremes.maximumGeneration),
    },
    {
      label: 'Minimum Generation',
      value: getKwhDateDisplayValue(dailyExtremes.minimumGeneration),
    },
  ]

  return (
    <div className="space-y-4">
      <div
        className={[
          'flex flex-col gap-4 rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between',
          matchingTone.className,
        ].join(' ')}
      >
        <div>
          <p className="text-sm font-semibold">Overall Matching</p>
          <p className="mt-1 text-sm leading-5">{matchingTone.description}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-semibold leading-9 tracking-normal">
            {formatPercentage(summary.overallConsumptionMatchingPercentage)}%
          </p>
          <p className="mt-1 text-sm font-semibold">{matchingTone.label}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpiMetrics.map((metric) => (
          <div
            key={metric.label}
            className="min-h-28 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-xs font-medium leading-5 text-slate-500">
              {metric.label}
            </p>
            <p className="mt-2 text-lg font-semibold leading-7 text-slate-950">
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

type DailyEnergyExtreme = {
  value: number
  date: string
}

function getDailyEnergyExtremes(results: HalfHourlyMatchingResult[]) {
  const dailyData = getDailyEnergyData(results)

  return {
    maximumConsumption: getEnergyExtreme(dailyData, 'consumptionKwh', 'max'),
    minimumConsumption: getEnergyExtreme(dailyData, 'consumptionKwh', 'min'),
    maximumGeneration: getEnergyExtreme(dailyData, 'generationKwh', 'max'),
    minimumGeneration: getEnergyExtreme(dailyData, 'generationKwh', 'min'),
  }
}

function getDailyEnergyAverages(results: HalfHourlyMatchingResult[]) {
  const dailyData = getDailyEnergyData(results)

  if (!dailyData.length) {
    return {
      averageConsumption: null,
      averageGeneration: null,
    }
  }

  const totals = dailyData.reduce(
    (currentTotals, currentPoint) => ({
      consumptionKwh:
        currentTotals.consumptionKwh + currentPoint.consumptionKwh,
      generationKwh: currentTotals.generationKwh + currentPoint.generationKwh,
    }),
    {
      consumptionKwh: 0,
      generationKwh: 0,
    },
  )

  return {
    averageConsumption: totals.consumptionKwh / dailyData.length,
    averageGeneration: totals.generationKwh / dailyData.length,
  }
}

function getEnergyExtreme(
  dailyData: DailyEnergyPoint[],
  key: 'consumptionKwh' | 'generationKwh',
  mode: 'max' | 'min',
): DailyEnergyExtreme | null {
  if (!dailyData.length) {
    return null
  }

  const extremePoint = dailyData.reduce((currentExtreme, currentPoint) => {
    if (mode === 'max') {
      return currentPoint[key] > currentExtreme[key]
        ? currentPoint
        : currentExtreme
    }

    return currentPoint[key] < currentExtreme[key]
      ? currentPoint
      : currentExtreme
  }, dailyData[0])

  return {
    value: extremePoint[key],
    date: extremePoint.label,
  }
}

function getOverallMatchingTone(percentage: number) {
  if (percentage >= 80) {
    return {
      label: 'High match',
      description: 'Matched energy covers most consumption.',
      className: 'border-[#4EBE9E]/30 bg-[#4EBE9E]/10 text-[#4EBE9E]',
    }
  }

  if (percentage >= 50) {
    return {
      label: 'Moderate match',
      description: 'Matched energy covers part of consumption.',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    }
  }

  return {
    label: 'Low match',
    description: 'Matched energy covers a smaller share of consumption.',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
  }
}

function downloadResultsCsv(result: MatchingEngineResult) {
  const headers = [
    'Record',
    'Site ID',
    'MPAN',
    'Date',
    'Interval',
    'Consumption kWh',
    'Generation kWh',
    'Allocated generation kWh',
    'Matched energy kWh',
    'Unmatched consumption kWh',
    'Excess generation kWh',
    'Consumption matching percentage',
    'Customer',
    'Customer share percentage',
    'Allocation source',
  ]
  const rows = result.results.map((row) => [
    row.recordNumber,
    row.siteId,
    row.mpan,
    row.date,
    row.interval,
    row.consumptionKwh,
    row.generationKwh,
    row.allocatedGenerationKwh ?? row.generationKwh,
    row.matchedEnergyKwh,
    row.unmatchedConsumptionKwh,
    row.excessGenerationKwh,
    row.consumptionMatchingPercentage,
    row.customerName ?? '',
    row.customerSharePercentage ?? 100,
    getAllocationSourceLabel(row.allocationSource),
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map(formatCsvCell).join(','))
    .join('\n')
  const url = window.URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')

  link.href = url
  link.download = 'matching-results.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
}

function getAllocationSourceLabel(
  allocationSource: HalfHourlyMatchingResult['allocationSource'],
) {
  if (allocationSource === 'registered-customer') {
    return 'Registered customer'
  }

  return 'Default 100%'
}

async function exportMatchingResultsPdf(
  result: MatchingEngineResult,
  exportRoot: HTMLElement,
) {
  const { jsPDF } = await import('jspdf')
  const toPng = await import('html-to-image')
    .then((module) => module.toPng)
    .catch((error) => {
      console.error('PDF image exporter could not be loaded.', error)
      return null
    })
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const pageMargin = 36
  const pageContentWidth = pageWidth - pageMargin * 2
  const pageContentHeight = pageHeight - pageMargin * 2
  const sectionGap = 18
  const cleanup = preparePdfExportLayout(exportRoot)
  const sections = Array.from(
    exportRoot.querySelectorAll<HTMLElement>('[data-pdf-section]'),
  )
  const heatmapResultSets = getPdfExportHeatmapResultSets(result.results)
  let heatmapIndex = 0
  let cursorY = addPdfTitle(pdf, result, pageMargin, pageContentWidth)

  pdf.setProperties({
    title: `${getResultTitle(result)} visualisations`,
    subject: 'Matching result visualisations',
  })

  try {
    await waitForNextFrame()

    for (const section of sections) {
      if (section.dataset.pdfHeatmapSection === 'true') {
        const heatmapResults =
          heatmapResultSets[heatmapIndex] ?? result.results

        cursorY = addPdfHeatmapSection({
          pdf,
          title: getPdfSectionTitle(section),
          results: heatmapResults,
          cursorY,
          pageWidth,
          pageHeight,
          pageMargin,
          pageContentWidth,
          pageContentHeight,
          sectionGap,
        })
        heatmapIndex += 1
        continue
      }

      try {
        if (!toPng) {
          throw new Error('PDF image exporter is not available.')
        }

        cursorY = await addPdfVisualisationSection({
          pdf,
          section,
          toPng,
          cursorY,
          pageWidth,
          pageHeight,
          pageMargin,
          pageContentWidth,
          pageContentHeight,
          sectionGap,
        })
      } catch (error) {
        console.error('PDF section could not be exported.', error)
        cursorY = addPdfSectionFallback({
          pdf,
          title: getPdfSectionTitle(section),
          cursorY,
          pageHeight,
          pageMargin,
          pageContentWidth,
          sectionGap,
        })
      }
    }
  } finally {
    try {
      cleanup()
    } catch (error) {
      console.error('PDF export layout cleanup failed.', error)
    }
  }

  addPdfPageNumbers(pdf, pageWidth, pageHeight, pageMargin)
  pdf.save(`${sanitizeFileName(getResultTitle(result))}-visualisations.pdf`)
}

async function addPdfVisualisationSection({
  pdf,
  section,
  toPng,
  cursorY,
  pageWidth,
  pageHeight,
  pageMargin,
  pageContentWidth,
  pageContentHeight,
  sectionGap,
}: {
  pdf: import('jspdf').jsPDF
  section: HTMLElement
  toPng: typeof import('html-to-image').toPng
  cursorY: number
  pageWidth: number
  pageHeight: number
  pageMargin: number
  pageContentWidth: number
  pageContentHeight: number
  sectionGap: number
}) {
  const sectionWidth = Math.ceil(
    Math.max(section.scrollWidth, section.getBoundingClientRect().width),
  )
  const sectionHeight = Math.ceil(
    Math.max(section.scrollHeight, section.getBoundingClientRect().height),
  )
  const imageDataUrl = await renderSectionForPdf(
    section,
    toPng,
    sectionWidth,
    sectionHeight,
  )
  const imageSize = await getImageSize(imageDataUrl)
  const scale = Math.min(
    pageContentWidth / imageSize.width,
    pageContentHeight / imageSize.height,
  )
  const imageWidth = imageSize.width * scale
  const imageHeight = imageSize.height * scale
  let nextCursorY = cursorY

  if (nextCursorY + imageHeight > pageHeight - pageMargin && nextCursorY > pageMargin) {
    pdf.addPage()
    nextCursorY = pageMargin
  }

  pdf.addImage(
    imageDataUrl,
    'PNG',
    (pageWidth - imageWidth) / 2,
    nextCursorY,
    imageWidth,
    imageHeight,
    undefined,
    'FAST',
  )

  return nextCursorY + imageHeight + sectionGap
}

function addPdfHeatmapSection({
  pdf,
  title,
  results,
  cursorY,
  pageWidth,
  pageHeight,
  pageMargin,
  pageContentWidth,
  pageContentHeight,
  sectionGap,
}: {
  pdf: import('jspdf').jsPDF
  title: string
  results: HalfHourlyMatchingResult[]
  cursorY: number
  pageWidth: number
  pageHeight: number
  pageMargin: number
  pageContentWidth: number
  pageContentHeight: number
  sectionGap: number
}) {
  const heatmapData = getMatchingScoreHeatmapData(results)

  if (!heatmapData.days.length || !heatmapData.rows.length) {
    return addPdfSectionFallback({
      pdf,
      title,
      cursorY,
      pageHeight,
      pageMargin,
      pageContentWidth,
      sectionGap,
    })
  }

  const padding = 12
  const yAxisLabelWidth = 22
  const axisFooterHeight = 38
  const legendHeight = 42
  const gridWidth = pageContentWidth - padding * 2 - yAxisLabelWidth
  const intervalColumnWidth = 30
  const dayColumnWidth =
    (gridWidth - intervalColumnWidth) / heatmapData.days.length
  const monthAxisSegments = getHeatmapMonthAxisSegments(heatmapData.days)
  const rowChunks = getPdfHeatmapRowChunks(heatmapData.rows, 48)
  let nextCursorY = cursorY

  rowChunks.forEach((rows, chunkIndex) => {
    const periodRange =
      rows.length > 1
        ? `${rows[0].interval} to ${rows[rows.length - 1].interval}`
        : rows[0].interval
    const titleText =
      rowChunks.length > 1
        ? `${title} (${periodRange})`
        : title
    const titleLines = pdf.splitTextToSize(
      titleText,
      pageContentWidth - padding * 2,
    )
    const descriptionLines = pdf.splitTextToSize(
      'Daily matching score by period at the selected matching granularity.',
      pageContentWidth - padding * 2,
    )
    const titleHeight =
      30 + titleLines.length * 11 + descriptionLines.length * 9
    const rowHeight = Math.max(
      10,
      Math.min(
        12,
        (pageContentHeight -
          titleHeight -
          axisFooterHeight -
          legendHeight -
          16) /
          rows.length,
      ),
    )
    const gridHeight = rows.length * rowHeight
    const blockHeight =
      titleHeight + gridHeight + axisFooterHeight + legendHeight + padding

    if (
      nextCursorY + blockHeight > pageHeight - pageMargin &&
      nextCursorY > pageMargin
    ) {
      pdf.addPage()
      nextCursorY = pageMargin
    }

    const blockX = pageMargin
    const blockY = nextCursorY
    const gridX = blockX + padding + yAxisLabelWidth
    const gridY = blockY + titleHeight

    pdf.setDrawColor(226, 232, 240)
    pdf.setFillColor(255, 255, 255)
    pdf.rect(blockX, blockY, pageContentWidth, blockHeight, 'FD')

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor('#0f172a')
    pdf.text(titleLines, blockX + padding, blockY + 20)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#64748b')
    pdf.text(
      descriptionLines,
      blockX + padding,
      blockY + 22 + titleLines.length * 11,
    )

    monthAxisSegments.forEach((segment) => {
      const segmentX =
        gridX +
        intervalColumnWidth +
        (segment.startColumn - 3) * dayColumnWidth
      const segmentWidth = segment.columnSpan * dayColumnWidth

      if (segmentWidth < 22) {
        return
      }

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(5.5)
      pdf.setTextColor('#334155')
      pdf.text(segment.label, segmentX + segmentWidth / 2, gridY + gridHeight + 12, {
        align: 'center',
      })
    })

    rows.forEach((row, rowIndex) => {
      const rowY = gridY + rowIndex * rowHeight

      pdf.setFillColor(255, 255, 255)
      pdf.rect(gridX, rowY, intervalColumnWidth, rowHeight, 'F')
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.5)
      pdf.setTextColor('#475569')
      pdf.text(
        row.interval,
        gridX + intervalColumnWidth - 4,
        rowY + rowHeight / 2 + 2,
        { align: 'right' },
      )

      row.cells.forEach((cell, columnIndex) => {
        const cellX =
          gridX + intervalColumnWidth + columnIndex * dayColumnWidth

        setPdfFillColor(
          pdf,
          getMatchingScoreHeatmapColor(cell.matchingScore, cell.hasData),
        )
        pdf.rect(cellX, rowY, dayColumnWidth, rowHeight, 'F')
      })
    })

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor('#475569')
    pdf.text('Time', blockX + padding, gridY + gridHeight / 2, {
      align: 'left',
    })

    pdf.setDrawColor(203, 213, 225)
    pdf.rect(gridX, gridY, gridWidth, gridHeight)

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6)
    pdf.setTextColor('#475569')
    pdf.text(
      'Matching Period',
      gridX + intervalColumnWidth + (gridWidth - intervalColumnWidth) / 2,
      gridY + gridHeight + 28,
      { align: 'center' },
    )

    addPdfHeatmapLegend({
      pdf,
      x: (pageWidth - Math.min(220, gridWidth * 0.52)) / 2,
      y: gridY + gridHeight + axisFooterHeight + 10,
      width: Math.min(220, gridWidth * 0.52),
    })

    nextCursorY += blockHeight + (chunkIndex === rowChunks.length - 1 ? 0 : 12)
  })

  return nextCursorY + sectionGap
}

function addPdfHeatmapLegend({
  pdf,
  x,
  y,
  width,
}: {
  pdf: import('jspdf').jsPDF
  x: number
  y: number
  width: number
}) {
  const height = 8
  const segmentCount = 80
  const segmentWidth = width / segmentCount

  for (let index = 0; index < segmentCount; index += 1) {
    const score = (index / (segmentCount - 1)) * 100

    setPdfFillColor(pdf, getMatchingScoreHeatmapColor(score, true))
    pdf.rect(x + index * segmentWidth, y, segmentWidth + 0.3, height, 'F')
  }

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor('#64748b')
  ;[0, 25, 50, 75, 100].forEach((score) => {
    pdf.text(`${score}%`, x + (score / 100) * width, y + 18, {
      align: score === 0 ? 'left' : score === 100 ? 'right' : 'center',
    })
  })
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor('#475569')
  pdf.text('Matching score', x + width / 2, y + 30, { align: 'center' })
}

function setPdfFillColor(pdf: import('jspdf').jsPDF, color: string) {
  const { red, green, blue } = parsePdfColor(color)

  pdf.setFillColor(red, green, blue)
}

function parsePdfColor(color: string) {
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)

  if (rgbMatch) {
    return {
      red: Number(rgbMatch[1]),
      green: Number(rgbMatch[2]),
      blue: Number(rgbMatch[3]),
    }
  }

  return hexToRgb(color)
}

function getPdfExportHeatmapResultSets(results: HalfHourlyMatchingResult[]) {
  const resultGroups = getMatchingResultGroups(results)

  return resultGroups.length > 1
    ? resultGroups.map((group) => group.results)
    : [results]
}

function getPdfHeatmapRowChunks(
  rows: MatchingScoreHeatmapRow[],
  chunkSize: number,
) {
  const chunks: MatchingScoreHeatmapRow[][] = []

  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize))
  }

  return chunks
}

async function renderSectionForPdf(
  section: HTMLElement,
  toPng: typeof import('html-to-image').toPng,
  width: number,
  height: number,
) {
  const baseOptions = {
    backgroundColor: '#ffffff',
    cacheBust: true,
    height,
    style: {
      height: `${height}px`,
      maxHeight: 'none',
      overflow: 'visible',
      width: `${width}px`,
    },
    width,
  }
  const pixelRatio = getPdfSectionPixelRatio(width, height)

  try {
    return await toPng(section, {
      ...baseOptions,
      pixelRatio,
    })
  } catch (error) {
    console.error('PDF section export failed. Retrying at lower resolution.', error)

    return toPng(section, {
      ...baseOptions,
      pixelRatio: 1,
      skipFonts: true,
    })
  }
}

function getPdfSectionPixelRatio(width: number, height: number) {
  if (width > 2400 || height > 2400 || width * height > 2_500_000) {
    return 1
  }

  return 2
}

function addPdfSectionFallback({
  pdf,
  title,
  cursorY,
  pageHeight,
  pageMargin,
  pageContentWidth,
  sectionGap,
}: {
  pdf: import('jspdf').jsPDF
  title: string
  cursorY: number
  pageHeight: number
  pageMargin: number
  pageContentWidth: number
  sectionGap: number
}) {
  const blockHeight = 86
  let nextCursorY = cursorY

  if (nextCursorY + blockHeight > pageHeight - pageMargin && nextCursorY > pageMargin) {
    pdf.addPage()
    nextCursorY = pageMargin
  }

  pdf.setDrawColor(203, 213, 225)
  pdf.setFillColor(248, 250, 252)
  pdf.rect(pageMargin, nextCursorY, pageContentWidth, blockHeight, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#0f172a')
  pdf.text(title, pageMargin + 12, nextCursorY + 22)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor('#64748b')
  pdf.text(
    pdf.splitTextToSize(
      'This visualisation could not be rendered as an image in the browser. The rest of the PDF export has been generated.',
      pageContentWidth - 24,
    ),
    pageMargin + 12,
    nextCursorY + 42,
  )

  return nextCursorY + blockHeight + sectionGap
}

function getPdfSectionTitle(section: HTMLElement) {
  const heading = section.querySelector('h1, h2, h3')
  const title = heading?.textContent?.trim()

  return title || 'Visualisation'
}

function addPdfTitle(
  pdf: import('jspdf').jsPDF,
  result: MatchingEngineResult,
  pageMargin: number,
  pageContentWidth: number,
) {
  const titleLines = pdf.splitTextToSize(
    getResultTitle(result),
    pageContentWidth,
  )

  pdf.setTextColor('#0f172a')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.text('Matching Result Visualisations', pageMargin, pageMargin)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor('#475569')
  pdf.text(titleLines, pageMargin, pageMargin + 18)
  pdf.text(
    `Generated ${formatDateTime(new Date().toISOString())}`,
    pageMargin,
    pageMargin + 18 + titleLines.length * 12,
  )

  return pageMargin + 44 + titleLines.length * 12
}

function addPdfPageNumbers(
  pdf: import('jspdf').jsPDF,
  pageWidth: number,
  pageHeight: number,
  pageMargin: number,
) {
  const pageCount = pdf.getNumberOfPages()

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor('#64748b')

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.setPage(pageNumber)
    pdf.text(
      `Page ${pageNumber} of ${pageCount}`,
      pageWidth - pageMargin,
      pageHeight - 18,
      { align: 'right' },
    )
  }
}

function preparePdfExportLayout(exportRoot: HTMLElement) {
  const restoreCallbacks: Array<() => void> = []

  exportRoot
    .querySelectorAll<HTMLElement>('[data-pdf-screen-only]')
    .forEach((element) => {
      const previousDisplay = element.style.display

      element.style.display = 'none'

      restoreCallbacks.push(() => {
        element.style.display = previousDisplay
      })
    })

  exportRoot
    .querySelectorAll<HTMLElement>('[data-pdf-only]')
    .forEach((element) => {
      const previousDisplay = element.style.display

      element.style.display = 'block'

      restoreCallbacks.push(() => {
        element.style.display = previousDisplay
      })
    })

  exportRoot
    .querySelectorAll<HTMLElement>('[data-pdf-expand-scroll]')
    .forEach((element) => {
      if (element.closest('[data-pdf-screen-only]')) {
        return
      }

      const previousOverflowX = element.style.overflowX
      const previousOverflowY = element.style.overflowY
      const previousWidth = element.style.width
      const previousMaxHeight = element.style.maxHeight
      const previousScrollLeft = element.scrollLeft
      const previousScrollTop = element.scrollTop

      element.style.overflowX = 'visible'
      element.style.overflowY = 'visible'
      element.style.width = 'max-content'
      element.style.maxHeight = 'none'
      element.scrollLeft = 0
      element.scrollTop = 0

      restoreCallbacks.push(() => {
        element.style.overflowX = previousOverflowX
        element.style.overflowY = previousOverflowY
        element.style.width = previousWidth
        element.style.maxHeight = previousMaxHeight
        element.scrollLeft = previousScrollLeft
        element.scrollTop = previousScrollTop
      })
    })

  return () => {
    restoreCallbacks.forEach((restore) => restore())
  }
}

function getImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      reject(new Error('Could not read exported image size.'))
    }
    image.src = src
  })
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

function sanitizeFileName(value: string) {
  const fileName = value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return fileName || 'matching-results'
}

function formatCsvCell(value: string | number) {
  const stringValue = String(value)

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function getResultTitle(result: MatchingEngineResult) {
  return (
    result.title?.trim() ||
    `${result.consumptionFileName} vs ${result.generationFileName}`
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return dateTimeFormat.format(date)
}

function formatNumber(value: number) {
  return numberFormat.format(value)
}

function formatKwh(value: number) {
  return `${formatNumber(value)} kWh`
}

function getKwhDisplayValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatKwh(value)
    : 'No data'
}

function getKwhDateDisplayValue(extreme: DailyEnergyExtreme | null) {
  return extreme ? `${formatKwh(extreme.value)} on ${extreme.date}` : 'No data'
}

function formatPercentage(value: number) {
  return percentageFormat.format(value)
}
