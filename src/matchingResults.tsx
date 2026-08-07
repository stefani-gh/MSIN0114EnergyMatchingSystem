import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MatchingEngineResult } from './matchingTypes'
import {
  MatchingResultsContext,
  type DatabaseRecord,
  type MatchingSourceFiles,
  type StoredUploadFile,
} from './matchingResultsContext'

const matchingResultsStorageKey = 'energy-matching-results'
const matchingServerInstanceStorageKey = 'energy-matching-server-instance'

type StoredMatchingResults = {
  results: MatchingEngineResult[]
  selectedResultId: string | null
  databaseRecords: DatabaseRecord[]
}

type SeededMatchingResults = {
  results: MatchingEngineResult[]
  databaseRecords: DatabaseRecord[]
  serverInstanceId: string
}

const emptyStoredMatchingResults: StoredMatchingResults = {
  results: [],
  selectedResultId: null,
  databaseRecords: [],
}

function readStoredResults(): StoredMatchingResults {
  try {
    const storedValue = window.sessionStorage.getItem(matchingResultsStorageKey)

    if (!storedValue) {
      return emptyStoredMatchingResults
    }

    const parsedValue: unknown = JSON.parse(storedValue)

    if (Array.isArray(parsedValue)) {
      const results = parsedValue
        .filter(isMatchingEngineResult)
        .map(ensureMatchingResultId)

      return {
        results,
        selectedResultId: results[0]?.id ?? null,
        databaseRecords: createDatabaseRecordsFromResults(results),
      }
    }

    if (isStoredMatchingResults(parsedValue)) {
      const results = parsedValue.results
        .filter(isMatchingEngineResult)
        .map(ensureMatchingResultId)
      const selectedResult = results.find(
        (result) => result.id === parsedValue.selectedResultId,
      )
      const databaseRecords = mergeDatabaseRecordsWithResults(
        getStoredDatabaseRecords(parsedValue),
        results,
      )

      return {
        results,
        selectedResultId: selectedResult?.id ?? results[0]?.id ?? null,
        databaseRecords,
      }
    }

    if (isMatchingEngineResult(parsedValue)) {
      const result = ensureMatchingResultId(parsedValue)

      return {
        results: [result],
        selectedResultId: result.id,
        databaseRecords: createDatabaseRecordsFromResults([result]),
      }
    }
  } catch {
    return emptyStoredMatchingResults
  }

  return emptyStoredMatchingResults
}

function persistResults(
  results: MatchingEngineResult[],
  selectedResultId: string | null,
  databaseRecords: DatabaseRecord[],
) {
  try {
    window.sessionStorage.setItem(
      matchingResultsStorageKey,
      JSON.stringify({ results, selectedResultId, databaseRecords }),
    )
    window.localStorage.removeItem(matchingResultsStorageKey)
  } catch {
    // Large local histories may exceed browser storage. The in-memory history still works.
  }
}

export function MatchingResultsProvider({ children }: { children: ReactNode }) {
  const [storedResults] = useState(readStoredResults)
  const [results, setResults] = useState<MatchingEngineResult[]>(
    storedResults.results,
  )
  const [selectedResultId, setSelectedResultId] = useState<string | null>(
    storedResults.selectedResultId,
  )
  const [databaseRecords, setDatabaseRecords] = useState<DatabaseRecord[]>(
    storedResults.databaseRecords,
  )
  const result = useMemo(
    () =>
      results.find((currentResult) => currentResult.id === selectedResultId) ??
      results[0] ??
      null,
    [results, selectedResultId],
  )

  useEffect(() => {
    persistResults(results, result?.id ?? null, databaseRecords)
  }, [databaseRecords, result?.id, results])

  useEffect(() => {
    let isCancelled = false

    async function loadSeededResults() {
      try {
        const response = await fetch('/api/matching/test-results')

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as SeededMatchingResults

        if (isCancelled || !Array.isArray(payload.results)) {
          return
        }

        const previousServerInstanceId = window.sessionStorage.getItem(
          matchingServerInstanceStorageKey,
        )
        const serverRestarted =
          Boolean(previousServerInstanceId) &&
          previousServerInstanceId !== payload.serverInstanceId
        window.sessionStorage.setItem(
          matchingServerInstanceStorageKey,
          payload.serverInstanceId,
        )

        if (serverRestarted) {
          setResults(payload.results)
          setDatabaseRecords(
            Array.isArray(payload.databaseRecords) ? payload.databaseRecords : [],
          )
          setSelectedResultId(payload.results[0]?.id ?? null)
          return
        }

        setResults((currentResults) => [
          ...payload.results,
          ...currentResults.filter(
            (currentResult) =>
              !payload.results.some(
                (seededResult) => seededResult.id === currentResult.id,
              ),
          ),
        ])
        setDatabaseRecords((currentRecords) => [
          ...(Array.isArray(payload.databaseRecords)
            ? payload.databaseRecords
            : []),
          ...currentRecords.filter(
            (currentRecord) =>
              !payload.databaseRecords?.some(
                (seededRecord) => seededRecord.id === currentRecord.id,
              ),
          ),
        ])
        setSelectedResultId((currentId) =>
          currentId ?? payload.results[0]?.id ?? null,
        )
      } catch {
        // The app remains usable with browser-local results if the API is offline.
      }
    }

    void loadSeededResults()

    return () => {
      isCancelled = true
    }
  }, [])

  const setResult = useCallback(
    async (
      nextResult: MatchingEngineResult,
      sourceFiles?: MatchingSourceFiles,
    ) => {
      const resultWithId = ensureMatchingResultId(nextResult)
      const serializedSourceFiles = sourceFiles
        ? await serializeMatchingSourceFiles(sourceFiles)
        : null
      setResults((currentResults) => [
        resultWithId,
        ...currentResults.filter(
          (currentResult) => currentResult.id !== resultWithId.id,
        ),
      ])
      setDatabaseRecords((currentRecords) => {
        const existingRecord = currentRecords.find(
          (record) => record.resultId === resultWithId.id,
        )

        if (serializedSourceFiles) {
          const nextRecord = createDatabaseRecord(
            resultWithId,
            serializedSourceFiles,
            existingRecord?.id,
          )

          return [
            nextRecord,
            ...currentRecords.filter(
              (record) => record.resultId !== resultWithId.id,
            ),
          ]
        }

        if (!existingRecord) {
          return currentRecords
        }

        return currentRecords.map((record) =>
          record.resultId === resultWithId.id
            ? {
                ...record,
                title: resultWithId.title,
                createdBy: resultWithId.createdBy,
                createdAt: resultWithId.createdAt,
                consumptionFileName: resultWithId.consumptionFileName,
                generationFileName: resultWithId.generationFileName,
                deletedFromResults: false,
                deletedAt: undefined,
              }
            : record,
        )
      })
      setSelectedResultId(resultWithId.id)
    },
    [],
  )

  const selectResult = useCallback(
    (resultId: string) => {
      if (results.some((currentResult) => currentResult.id === resultId)) {
        setSelectedResultId(resultId)
      }
    },
    [results],
  )

  const deleteResult = useCallback((resultId: string) => {
    const deletedAt = new Date().toISOString()

    setResults((currentResults) =>
      currentResults.filter((currentResult) => currentResult.id !== resultId),
    )
    setSelectedResultId((currentSelectedResultId) =>
      currentSelectedResultId === resultId ? null : currentSelectedResultId,
    )
    setDatabaseRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.resultId === resultId
          ? {
              ...record,
              deletedFromResults: true,
              deletedAt,
            }
          : record,
      ),
    )
  }, [])

  const clearResult = useCallback(() => {
    setResults([])
    setSelectedResultId(null)
    setDatabaseRecords([])
    window.localStorage.removeItem(matchingResultsStorageKey)
    window.sessionStorage.removeItem(matchingResultsStorageKey)
  }, [])

  const value = useMemo(
    () => ({
      result,
      results,
      databaseRecords,
      setResult,
      selectResult,
      deleteResult,
      clearResult,
    }),
    [
      clearResult,
      databaseRecords,
      deleteResult,
      result,
      results,
      selectResult,
      setResult,
    ],
  )

  return (
    <MatchingResultsContext.Provider value={value}>
      {children}
    </MatchingResultsContext.Provider>
  )
}

function isStoredMatchingResults(value: unknown): value is StoredMatchingResults {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as StoredMatchingResults).results)
  )
}

function getStoredDatabaseRecords(value: StoredMatchingResults) {
  const databaseRecords = (value as { databaseRecords?: unknown })
    .databaseRecords

  return Array.isArray(databaseRecords)
    ? databaseRecords
        .filter(isDatabaseRecord)
        .map((record) => ({
          ...record,
          deletedFromResults: Boolean(record.deletedFromResults),
        }))
    : []
}

function mergeDatabaseRecordsWithResults(
  databaseRecords: DatabaseRecord[],
  results: MatchingEngineResult[],
) {
  const existingResultIds = new Set(
    databaseRecords.map((record) => record.resultId),
  )
  const missingRecords = results
    .filter((result) => !existingResultIds.has(result.id))
    .map(createDatabaseRecordFromResult)

  return [...databaseRecords, ...missingRecords]
}

function createDatabaseRecordsFromResults(results: MatchingEngineResult[]) {
  return results.map(createDatabaseRecordFromResult)
}

function createDatabaseRecordFromResult(
  result: MatchingEngineResult,
): DatabaseRecord {
  return {
    id: result.id,
    resultId: result.id,
    title: result.title,
    createdBy: result.createdBy,
    createdAt: result.createdAt,
    consumptionFileName: result.consumptionFileName,
    generationFileName: result.generationFileName,
    deletedFromResults: false,
  }
}

function isDatabaseRecord(value: unknown): value is DatabaseRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as DatabaseRecord

  return (
    typeof record.id === 'string' &&
    typeof record.resultId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.createdBy === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.consumptionFileName === 'string' &&
    typeof record.generationFileName === 'string' &&
    (!record.consumptionFile || isStoredUploadFile(record.consumptionFile)) &&
    (!record.generationFile || isStoredUploadFile(record.generationFile))
  )
}

function isStoredUploadFile(value: unknown): value is StoredUploadFile {
  if (!value || typeof value !== 'object') {
    return false
  }

  const storedFile = value as StoredUploadFile

  return (
    typeof storedFile.fileName === 'string' &&
    typeof storedFile.mimeType === 'string' &&
    typeof storedFile.dataUrl === 'string' &&
    typeof storedFile.lastModified === 'number'
  )
}

function isMatchingEngineResult(value: unknown): value is MatchingEngineResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as MatchingEngineResult).results) &&
    typeof (value as MatchingEngineResult).consumptionFileName === 'string' &&
    typeof (value as MatchingEngineResult).generationFileName === 'string'
  )
}

function ensureMatchingResultId(result: MatchingEngineResult) {
  if (result.id) {
    return result
  }

  return {
    ...result,
    id: createFallbackResultId(result),
  }
}

function createFallbackResultId(result: MatchingEngineResult) {
  const source = [
    result.createdAt,
    result.generatedAt,
    result.consumptionFileName,
    result.generationFileName,
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return source || `run-${Date.now()}`
}

async function serializeMatchingSourceFiles(sourceFiles: MatchingSourceFiles) {
  const [consumptionFile, generationFile] = await Promise.all([
    serializeUploadFile(sourceFiles.consumptionFile),
    serializeUploadFile(sourceFiles.generationFile),
  ])

  return {
    consumptionFile,
    generationFile,
  }
}

function serializeUploadFile(file: File): Promise<StoredUploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The uploaded file could not be stored.'))
        return
      }

      resolve({
        fileName: file.name,
        mimeType: file.type,
        dataUrl: reader.result,
        lastModified: file.lastModified,
      })
    })
    reader.addEventListener('error', () => {
      reject(new Error('The uploaded file could not be stored.'))
    })
    reader.readAsDataURL(file)
  })
}

function createDatabaseRecord(
  result: MatchingEngineResult,
  sourceFiles: {
    consumptionFile: StoredUploadFile
    generationFile: StoredUploadFile
  },
  existingRecordId?: string,
): DatabaseRecord {
  return {
    id: existingRecordId ?? result.id,
    resultId: result.id,
    title: result.title,
    createdBy: result.createdBy,
    createdAt: result.createdAt,
    consumptionFileName: result.consumptionFileName,
    generationFileName: result.generationFileName,
    consumptionFile: sourceFiles.consumptionFile,
    generationFile: sourceFiles.generationFile,
    deletedFromResults: false,
    deletedAt: undefined,
  }
}
