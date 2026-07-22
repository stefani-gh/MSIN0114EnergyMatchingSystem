import { createContext, useContext } from 'react'
import type { MatchingEngineResult } from './matchingTypes'

export type StoredUploadFile = {
  fileName: string
  mimeType: string
  dataUrl: string
  lastModified: number
}

export type MatchingSourceFiles = {
  consumptionFile: File
  generationFile: File
}

export type DatabaseRecord = {
  id: string
  resultId: string
  title: string
  createdBy: string
  createdAt: string
  consumptionFileName: string
  generationFileName: string
  consumptionFile?: StoredUploadFile
  generationFile?: StoredUploadFile
  deletedFromResults: boolean
  deletedAt?: string
}

export type MatchingResultsContextValue = {
  result: MatchingEngineResult | null
  results: MatchingEngineResult[]
  databaseRecords: DatabaseRecord[]
  setResult: (
    result: MatchingEngineResult,
    sourceFiles?: MatchingSourceFiles,
  ) => Promise<void>
  selectResult: (resultId: string) => void
  deleteResult: (resultId: string) => void
  clearResult: () => void
}

export const MatchingResultsContext =
  createContext<MatchingResultsContextValue | null>(null)

export function useMatchingResults() {
  const context = useContext(MatchingResultsContext)

  if (!context) {
    throw new Error(
      'useMatchingResults must be used inside MatchingResultsProvider',
    )
  }

  return context
}
