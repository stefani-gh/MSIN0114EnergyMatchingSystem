import { Plus, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  DataTable,
  PageContainer,
  PlaceholderNotice,
  TextInput,
} from '../components/ui'
import {
  customerRegistryStorageKey,
  generatorRegistryStorageKey,
} from '../registryStorage'

type RegistryRecord = {
  id: string
  name: string
  contractId?: string
  contractName?: string
  siteId: string
  mpan: string
  contractedSharePercentage?: number
}

type RegistryForm = {
  name: string
  contractId: string
  contractName: string
  siteId: string
  mpan: string
  contractedSharePercentage: string
}

type RegistryErrors = Partial<Record<keyof RegistryForm, string>>

const emptyRegistryForm: RegistryForm = {
  name: '',
  contractId: '',
  contractName: '',
  siteId: '',
  mpan: '',
  contractedSharePercentage: '',
}

export function CustomerPage({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <RegistryPage
      title="Customer Creation"
      description="Create customers used for matching."
      modalTitle="Add Customer"
      storageKey={customerRegistryStorageKey}
      emptyMessage="No customers have been created yet."
      readOnly={readOnly}
      includeContractedShare
    />
  )
}

export function GeneratorPage({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <RegistryPage
      title="Generator Creation"
      description="Create generators used for matching."
      modalTitle="Add Generator"
      storageKey={generatorRegistryStorageKey}
      emptyMessage="No generators have been created yet."
      readOnly={readOnly}
    />
  )
}

function RegistryPage({
  title,
  description,
  modalTitle,
  storageKey,
  emptyMessage,
  readOnly,
  includeContractedShare = false,
}: {
  title: string
  description: string
  modalTitle: string
  storageKey: string
  emptyMessage: string
  readOnly: boolean
  includeContractedShare?: boolean
}) {
  const [records, setRecords] = useState<RegistryRecord[]>(() =>
    readStoredRecords(storageKey),
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [form, setForm] = useState<RegistryForm>(emptyRegistryForm)
  const [errors, setErrors] = useState<RegistryErrors>({})

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(records))
    } catch {
      // Local demo state remains available in memory if browser storage is full.
    }
  }, [records, storageKey])

  useEffect(() => {
    if (storageKey !== customerRegistryStorageKey) {
      return
    }

    let cancelled = false
    void fetch('/api/registry/customers')
      .then(async (response) => {
        if (!response.ok) {
          return []
        }
        const payload = (await response.json()) as { records?: unknown }
        return Array.isArray(payload.records)
          ? payload.records.filter(isRegistryRecord)
          : []
      })
      .then((backendRecords) => {
        if (cancelled) {
          return
        }
        setRecords((currentRecords) => [
          ...backendRecords,
          ...currentRecords.filter(
            (currentRecord) =>
              !backendRecords.some(
                (backendRecord) => backendRecord.id === currentRecord.id,
              ),
          ),
        ])
      })
      .catch(() => {
        // Browser-local customer creation remains usable while the API is offline.
      })

    return () => {
      cancelled = true
    }
  }, [storageKey])

  function openCreateModal() {
    if (readOnly) {
      return
    }

    setEditingRecordId(null)
    setForm(emptyRegistryForm)
    setErrors({})
    setModalOpen(true)
  }

  function openEditModal(record: RegistryRecord) {
    if (readOnly) {
      return
    }

    setEditingRecordId(record.id)
    setForm(createFormFromRecord(record))
    setErrors({})
    setModalOpen(true)
  }

  function closeModal() {
    setEditingRecordId(null)
    setModalOpen(false)
    setForm(emptyRegistryForm)
    setErrors({})
  }

  function updateForm(field: keyof RegistryForm, value: string) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }))
    setErrors((currentErrors) => ({
      ...currentErrors,
      [field]: undefined,
    }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (readOnly) {
      return
    }

    const submittedForm = normalizeRegistryForm(form, includeContractedShare)
    const nextErrors = validateRegistryForm(
      submittedForm,
      includeContractedShare,
      records,
      editingRecordId,
    )

    if (Object.keys(nextErrors).length) {
      setForm(submittedForm)
      setErrors(nextErrors)
      return
    }

    setRecords((currentRecords) => {
      if (editingRecordId) {
        return currentRecords.map((record) =>
          record.id === editingRecordId
            ? createRecordFromForm(
                submittedForm,
                includeContractedShare,
                record.id,
              )
            : record,
        )
      }

      return [
        ...currentRecords,
        createRecordFromForm(
          submittedForm,
          includeContractedShare,
          `registry-${Date.now()}`,
        ),
      ]
    })
    closeModal()
  }

  const tableColumns = includeContractedShare
    ? [
        'Name',
        'Contract ID',
        'Contract Name',
        'Site ID',
        'MPAN ID',
        'Contract Share %',
        'Action',
      ]
    : ['Name', 'Site ID', 'MPAN ID', 'Action']
  const tableRows = records.map((record) => {
    const row: ReactNode[] = [
      <span className="font-medium text-slate-950">{record.name}</span>,
    ]

    if (includeContractedShare) {
      row.push(
        record.contractId ?? '',
        record.contractName?.trim() || (
          <span className="text-slate-400">Not provided</span>
        ),
      )
    }

    row.push(record.siteId, record.mpan)

    if (includeContractedShare) {
      row.push(formatContractedShare(record.contractedSharePercentage))
    }

    row.push(
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-9 px-3"
          disabled={readOnly}
          onClick={() => openEditModal(record)}
        >
          Edit
        </Button>
        <Button
          type="button"
          variant="danger"
          className="h-9 px-3"
          disabled={readOnly}
          onClick={() => deleteRecord(record)}
        >
          Delete
        </Button>
      </div>,
    )

    return row
  })

  function deleteRecord(record: RegistryRecord) {
    if (readOnly) {
      return
    }

    const shouldDelete = window.confirm(`Delete ${record.name}?`)

    if (!shouldDelete) {
      return
    }

    setRecords((currentRecords) =>
      currentRecords.filter((currentRecord) => currentRecord.id !== record.id),
    )

    if (editingRecordId === record.id) {
      closeModal()
    }
  }

  return (
    <PageContainer
      title={title}
      description={description}
      actions={
        <Button icon={Plus} disabled={readOnly} onClick={openCreateModal}>
          Add
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {records.length ? (
          <DataTable
            columns={tableColumns}
            rows={tableRows}
          />
        ) : (
          <PlaceholderNotice>{emptyMessage}</PlaceholderNotice>
        )}
      </div>

      {modalOpen && (
        <RegistryModal
          title={editingRecordId ? getEditModalTitle(modalTitle) : modalTitle}
          submitButtonLabel="Save"
          form={form}
          errors={errors}
          includeContractedShare={includeContractedShare}
          onChange={updateForm}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}
    </PageContainer>
  )
}

function RegistryModal({
  title,
  submitButtonLabel,
  form,
  errors,
  includeContractedShare,
  onChange,
  onClose,
  onSubmit,
}: {
  title: string
  submitButtonLabel: string
  form: RegistryForm
  errors: RegistryErrors
  includeContractedShare: boolean
  onChange: (field: keyof RegistryForm, value: string) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <form
        onSubmit={onSubmit}
        noValidate
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A61F4]">
              Record
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <TextInput
            autoFocus
            label="Name"
            value={form.name}
            error={errors.name}
            onChange={(event) => onChange('name', event.target.value)}
          />
          {includeContractedShare && (
            <>
              <TextInput
                label="Contract ID"
                value={form.contractId}
                error={errors.contractId}
                onChange={(event) =>
                  onChange('contractId', event.target.value)
                }
              />
              <TextInput
                label="Contract Name (Optional)"
                value={form.contractName}
                error={errors.contractName}
                onChange={(event) =>
                  onChange('contractName', event.target.value)
                }
              />
            </>
          )}
          <TextInput
            label="Site ID"
            value={form.siteId}
            error={errors.siteId}
            onChange={(event) => onChange('siteId', event.target.value)}
          />
          <TextInput
            label="MPAN ID"
            value={form.mpan}
            error={errors.mpan}
            inputMode="numeric"
            onChange={(event) => onChange('mpan', event.target.value)}
          />
          {includeContractedShare && (
            <TextInput
              label="Contract Share % (Please enter 2 d.p. maximum.)"
              type="number"
              min="0"
              max="100"
              step="any"
              inputMode="decimal"
              value={form.contractedSharePercentage}
              error={errors.contractedSharePercentage}
              onChange={(event) =>
                onChange('contractedSharePercentage', event.target.value)
              }
              onBlur={() =>
                onChange(
                  'contractedSharePercentage',
                  roundContractedShareInput(form.contractedSharePercentage),
                )
              }
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button type="submit">{submitButtonLabel}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function createFormFromRecord(record: RegistryRecord): RegistryForm {
  return {
    name: record.name,
    contractId: record.contractId ?? '',
    contractName: record.contractName ?? '',
    siteId: record.siteId,
    mpan: record.mpan,
    contractedSharePercentage:
      typeof record.contractedSharePercentage === 'number' &&
      Number.isFinite(record.contractedSharePercentage)
        ? String(roundContractedShareNumber(record.contractedSharePercentage))
        : '',
  }
}

function normalizeRegistryForm(
  form: RegistryForm,
  includeContractedShare: boolean,
) {
  if (!includeContractedShare) {
    return form
  }

  return {
    ...form,
    contractedSharePercentage: roundContractedShareInput(
      form.contractedSharePercentage,
    ),
  }
}

function createRecordFromForm(
  form: RegistryForm,
  includeContractedShare: boolean,
  id: string,
): RegistryRecord {
  return {
    id,
    name: form.name.trim(),
    ...(includeContractedShare
      ? {
          contractId: form.contractId.trim(),
          contractName: form.contractName.trim(),
        }
      : {}),
    siteId: form.siteId.trim(),
    mpan: form.mpan.trim(),
    ...(includeContractedShare
      ? {
          contractedSharePercentage: roundContractedShareNumber(
            Number(form.contractedSharePercentage),
          ),
        }
      : {}),
  }
}

function getEditModalTitle(modalTitle: string) {
  return modalTitle.replace(/^Add/, 'Edit')
}

function validateRegistryForm(
  form: RegistryForm,
  includeContractedShare: boolean,
  records: RegistryRecord[],
  editingRecordId: string | null,
) {
  const errors: RegistryErrors = {}
  const mpan = form.mpan.trim()

  if (!form.name.trim()) {
    errors.name = 'Name is required.'
  }

  if (!form.siteId.trim()) {
    errors.siteId = 'Site ID is required.'
  }

  if (!mpan) {
    errors.mpan = 'MPAN ID is required.'
  }

  if (includeContractedShare) {
    const contractId = form.contractId.trim()
    const contractedSharePercentage = roundContractedShareNumber(
      Number(form.contractedSharePercentage),
    )

    if (!contractId) {
      errors.contractId = 'Contract ID is required.'
    }

    if (!form.contractedSharePercentage.trim()) {
      errors.contractedSharePercentage = 'Contract share is required.'
    } else if (
      !Number.isFinite(contractedSharePercentage) ||
      contractedSharePercentage < 0
    ) {
      errors.contractedSharePercentage =
        'Contract share must be a non-negative number.'
    } else if (
      contractId &&
      getContractShareTotal(records, contractId, editingRecordId) +
        contractedSharePercentage >
        100 + 0.000001
    ) {
      const currentContractShare = getContractShareTotal(
        records,
        contractId,
        editingRecordId,
      )
      const nextContractShare =
        currentContractShare + contractedSharePercentage

      errors.contractedSharePercentage = `Contract ID ${contractId} would total ${formatContractedShareNumber(nextContractShare)}%, which is over 100%.`
    }
  }

  return errors
}

function roundContractedShareInput(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return ''
  }

  const numericValue = Number(trimmedValue)

  if (!Number.isFinite(numericValue)) {
    return value
  }

  return String(roundContractedShareNumber(numericValue))
}

function roundContractedShareNumber(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getContractShareTotal(
  records: RegistryRecord[],
  contractId: string,
  ignoredRecordId: string | null,
) {
  const normalizedContractId = normalizeContractId(contractId)

  return records.reduce((total, record) => {
    if (
      record.id === ignoredRecordId ||
      normalizeContractId(record.contractId ?? '') !== normalizedContractId ||
      typeof record.contractedSharePercentage !== 'number' ||
      !Number.isFinite(record.contractedSharePercentage)
    ) {
      return total
    }

    return total + record.contractedSharePercentage
  }, 0)
}

function normalizeContractId(value: string) {
  return normalizeRegistryValue(value)
}

function normalizeRegistryValue(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function formatContractedShare(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <span className="text-slate-400">Not allocated</span>
  }

  return `${formatContractedShareNumber(value)}%`
}

function formatContractedShareNumber(value: number) {
  return roundContractedShareNumber(value).toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })
}

function readStoredRecords(storageKey: string) {
  try {
    const storedRecords = window.localStorage.getItem(storageKey)

    if (!storedRecords) {
      return []
    }

    const parsedRecords = JSON.parse(storedRecords) as RegistryRecord[]

    if (!Array.isArray(parsedRecords)) {
      return []
    }

    return parsedRecords.filter(
      (record) =>
        typeof record.name === 'string' &&
        typeof record.siteId === 'string' &&
        typeof record.mpan === 'string',
    )
  } catch {
    return []
  }
}

function isRegistryRecord(value: unknown): value is RegistryRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as RegistryRecord
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.siteId === 'string' &&
    typeof record.mpan === 'string'
  )
}
