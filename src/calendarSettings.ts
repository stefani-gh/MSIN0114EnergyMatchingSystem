export type CalendarDayType = '46-period' | '50-period'
export type CalendarStatus = 'Active' | 'Inactive'

export type SettlementCalendarEntry = {
  id: string
  date: string
  dayType: CalendarDayType
  status: CalendarStatus
}

export const settlementCalendarStorageKey = 'energy-matching-settlement-calendar'

export function readSettlementCalendar() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(settlementCalendarStorageKey) ?? '[]',
    )
    return Array.isArray(value) ? (value as SettlementCalendarEntry[]) : []
  } catch {
    return []
  }
}

export function writeSettlementCalendar(entries: SettlementCalendarEntry[]) {
  window.localStorage.setItem(
    settlementCalendarStorageKey,
    JSON.stringify(entries),
  )
}

export async function loadAndMergeSettlementCalendar(
  localEntries: SettlementCalendarEntry[],
) {
  const response = await fetch('/api/settings/calendar')
  if (!response.ok) throw new Error('Calendar settings could not be loaded.')
  const payload = (await response.json()) as { entries?: unknown }
  const databaseEntries = Array.isArray(payload.entries)
    ? (payload.entries as SettlementCalendarEntry[])
    : []
  const entriesByDate = new Map(
    databaseEntries.map((entry) => [entry.date, entry]),
  )
  localEntries.forEach((entry) => entriesByDate.set(entry.date, entry))
  const mergedEntries = Array.from(entriesByDate.values())
  await saveSettlementCalendar(mergedEntries)
  writeSettlementCalendar(mergedEntries)
  return mergedEntries
}

export async function saveSettlementCalendar(
  entries: SettlementCalendarEntry[],
) {
  const response = await fetch('/api/settings/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  })
  if (!response.ok) throw new Error('Calendar settings could not be saved.')
}
