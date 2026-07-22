import type { LucideIcon } from 'lucide-react'
import { PageContainer, SectionCard } from '../components/ui'
import { userInterfaceSteps, userJourneySteps } from '../data/mockData'

export function HowToUsePage() {
  return (
    <PageContainer
      title="How to Use"
      description="A guide for the you to find out how to use the half-hourly matching platform."
    >
      <SectionCard
        title="User Interface"
        description="Navigation on how to use the system."
      >
        <StepList steps={userInterfaceSteps} />
      </SectionCard>

      <SectionCard
        title="User Journey"
        description="Navigation on how to match the energy."
      >
        <StepList steps={userJourneySteps} />
      </SectionCard>
    </PageContainer>
  )
}

function StepList({
  steps,
}: {
  steps: Array<{
    title: string
    copy: string
    inlineIcon?: LucideIcon
  }>
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-1">
      {steps.map((step, index) => {
        const InlineIcon = step.inlineIcon

        return (
          <div
            key={step.title}
            className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#3A61F4] text-sm font-semibold text-white">
              {index + 1}
            </div>
            <div>
              <h2 className="font-semibold text-slate-950">{step.title}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
                {renderStepCopy(step.copy, InlineIcon)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function renderStepCopy(copy: string, InlineIcon?: LucideIcon) {
  if (!InlineIcon || !copy.includes('*IMAGE')) {
    return copy
  }

  const copyParts = copy.split('*IMAGE')

  return copyParts.map((part, index) => (
    <span key={`${part}-${index}`}>
      {part}
      {index < copyParts.length - 1 && (
        <span className="mx-1 inline-flex size-6 translate-y-1 items-center justify-center rounded bg-[#3A61F4] text-white">
          <InlineIcon className="size-4" aria-hidden="true" />
        </span>
      )}
    </span>
  ))
}
