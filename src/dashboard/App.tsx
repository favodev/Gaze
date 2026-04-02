import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DayRecord } from '../shared/types'
import {
  formatDuration,
  formatShortDate,
  getTodayDateString,
  sumSiteSeconds,
} from '../shared/utils'

type LoadStatus = 'loading' | 'ready' | 'error'

interface TrendPoint {
  dateKey: string
  label: string
  totalSeconds: number
  totalMinutes: number
}

interface TopSite {
  domain: string
  totalSeconds: number
}

interface HeatCell {
  dateKey: string
  label: string
  totalSeconds: number
  intensity: number
  isFuture: boolean
}

function buildDayTotals(records: DayRecord[]): Record<string, number> {
  return records.reduce<Record<string, number>>((acc, record) => {
    acc[record.date] = sumSiteSeconds(record.sites)
    return acc
  }, {})
}

function buildTrend(records: DayRecord[], days: number): TrendPoint[] {
  const totals = buildDayTotals(records)
  const today = new Date()
  const result: TrendPoint[] = []

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    const dateKey = getTodayDateString(date)
    const totalSeconds = totals[dateKey] ?? 0

    result.push({
      dateKey,
      label: formatShortDate(date),
      totalSeconds,
      totalMinutes: Math.round((totalSeconds / 60) * 10) / 10,
    })
  }

  return result
}

function aggregateTopSites(records: DayRecord[], limit = 6): TopSite[] {
  const accumulator = records.reduce<Record<string, number>>((acc, record) => {
    for (const [domain, seconds] of Object.entries(record.sites)) {
      acc[domain] = (acc[domain] ?? 0) + seconds
    }

    return acc
  }, {})

  return Object.entries(accumulator)
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit)
    .map(([domain, totalSeconds]) => ({ domain, totalSeconds }))
}

function startOfWeekMonday(date: Date): Date {
  const result = new Date(date)
  const day = result.getDay()
  const mondayOffset = (day + 6) % 7
  result.setDate(result.getDate() - mondayOffset)
  result.setHours(0, 0, 0, 0)
  return result
}

function buildHeatmap(records: DayRecord[], weeks: number): HeatCell[][] {
  const totals = buildDayTotals(records)
  const today = new Date()
  const currentWeekStart = startOfWeekMonday(today)
  const firstWeekStart = new Date(currentWeekStart)
  firstWeekStart.setDate(firstWeekStart.getDate() - (weeks - 1) * 7)

  const rows: HeatCell[][] = []
  const allValues: number[] = []

  for (let weekIndex = 0; weekIndex < weeks; weekIndex += 1) {
    const row: HeatCell[] = []

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = new Date(firstWeekStart)
      date.setDate(firstWeekStart.getDate() + weekIndex * 7 + dayIndex)
      const dateKey = getTodayDateString(date)
      const totalSeconds = totals[dateKey] ?? 0
      allValues.push(totalSeconds)

      row.push({
        dateKey,
        label: formatShortDate(date),
        totalSeconds,
        intensity: 0,
        isFuture: date.getTime() > Date.now(),
      })
    }

    rows.push(row)
  }

  const maxValue = Math.max(0, ...allValues)

  return rows.map((row) =>
    row.map((cell) => ({
      ...cell,
      intensity: maxValue > 0 ? cell.totalSeconds / maxValue : 0,
    })),
  )
}

async function loadRecords(): Promise<DayRecord[]> {
  const result = await chrome.storage.local.get(['records'])
  return Array.isArray(result.records) ? (result.records as DayRecord[]) : []
}

function App() {
  const [records, setRecords] = useState<DayRecord[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const sync = useCallback(async () => {
    try {
      setLoadStatus('loading')
      setErrorMessage(null)
      const nextRecords = await loadRecords()
      setRecords(nextRecords)
      setLoadStatus('ready')
    } catch (error: unknown) {
      console.error('Failed to load dashboard data', error)
      setLoadStatus('error')
      setErrorMessage('Could not load your history from local storage.')
    }
  }, [])

  useEffect(() => {
    void sync()

    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] =
      (changes, areaName) => {
        if (areaName !== 'local' || !changes.records) {
          return
        }

        void sync()
      }

    chrome.storage.onChanged.addListener(onChanged)

    return () => {
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [sync])

  const trend = useMemo(() => buildTrend(records, 14), [records])
  const topSites = useMemo(() => aggregateTopSites(records, 6), [records])
  const heatmapRows = useMemo(() => buildHeatmap(records, 6), [records])

  const metrics = useMemo(() => {
    const totalAllTimeSeconds = records.reduce(
      (acc, record) => acc + sumSiteSeconds(record.sites),
      0,
    )
    const todayTotalSeconds =
      buildDayTotals(records)[getTodayDateString()] ?? 0
    const averageDailySeconds =
      records.length > 0 ? Math.floor(totalAllTimeSeconds / records.length) : 0

    const mostDistractingSite = topSites[0]?.domain ?? 'No data yet'

    return {
      totalAllTimeSeconds,
      todayTotalSeconds,
      averageDailySeconds,
      mostDistractingSite,
    }
  }, [records, topSites])

  return (
    <main className="min-h-screen p-6 md:p-8 text-[var(--app-text)]">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Gaze Dashboard</h1>
        <p className="mt-2 text-sm md:text-base text-[var(--muted-text)]">
          Your distraction patterns over time.
        </p>
      </header>

      {loadStatus === 'error' && (
        <section className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-700">Storage error</p>
          <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void sync()}
            className="mt-3 rounded-md bg-red-700 px-3 py-2 text-xs font-medium text-white"
          >
            Retry
          </button>
        </section>
      )}

      {loadStatus === 'loading' && (
        <section className="mb-6 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
          <p className="text-sm text-[var(--muted-text)]">Loading dashboard data...</p>
        </section>
      )}

      {loadStatus === 'ready' && (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">Today</p>
              <p className="mt-2 text-xl font-semibold">{formatDuration(metrics.todayTotalSeconds)}</p>
            </article>
            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">Daily average</p>
              <p className="mt-2 text-xl font-semibold">{formatDuration(metrics.averageDailySeconds)}</p>
            </article>
            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">All time</p>
              <p className="mt-2 text-xl font-semibold">{formatDuration(metrics.totalAllTimeSeconds)}</p>
            </article>
            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">Top site</p>
              <p className="mt-2 truncate text-xl font-semibold">{metrics.mostDistractingSite}</p>
            </article>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <h2 className="text-base font-semibold">14-day trend</h2>
              <p className="mt-1 text-xs text-[var(--muted-text)]">
                Minutes per day across the last two weeks.
              </p>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" />
                    <XAxis dataKey="label" stroke="var(--muted-text)" fontSize={12} />
                    <YAxis stroke="var(--muted-text)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-bg)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: '8px',
                        color: 'var(--app-text)',
                      }}
                      formatter={(value) => {
                        const minutes = Number(value ?? 0)
                        return [formatDuration(Math.floor(minutes * 60)), 'Distraction']
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalMinutes"
                      stroke="#DC2626"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
              <h2 className="text-base font-semibold">Top sites (all time)</h2>
              <ul className="mt-3 space-y-2">
                {topSites.length === 0 ? (
                  <li className="text-sm text-[var(--muted-text)]">No tracked sites yet.</li>
                ) : (
                  topSites.map((site) => (
                    <li
                      key={site.domain}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate">{site.domain}</span>
                      <span className="text-[var(--muted-text)] font-medium">
                        {formatDuration(site.totalSeconds)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </article>
          </section>

          <section className="mt-6 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
            <h2 className="text-base font-semibold">Weekly heatmap</h2>
            <p className="mt-1 text-xs text-[var(--muted-text)]">
              Last six weeks, Monday to Sunday.
            </p>

            <div className="mt-4 overflow-x-auto">
              <div className="inline-block min-w-full">
                <div className="mb-2 grid grid-cols-8 gap-2 text-xs text-[var(--muted-text)]">
                  <span>Week</span>
                  <span>Mon</span>
                  <span>Tue</span>
                  <span>Wed</span>
                  <span>Thu</span>
                  <span>Fri</span>
                  <span>Sat</span>
                  <span>Sun</span>
                </div>

                <div className="space-y-2">
                  {heatmapRows.map((row, rowIndex) => (
                    <div key={`row-${rowIndex}`} className="grid grid-cols-8 gap-2">
                      <span className="text-xs text-[var(--muted-text)]">
                        W{rowIndex + 1}
                      </span>
                      {row.map((cell) => (
                        <div
                          key={cell.dateKey}
                          title={`${cell.label}: ${formatDuration(cell.totalSeconds)}`}
                          className="h-8 rounded border border-[var(--surface-border)]"
                          style={{
                            backgroundColor: cell.isFuture
                              ? 'transparent'
                              : cell.totalSeconds === 0
                                ? 'var(--surface-bg)'
                                : `rgba(220, 38, 38, ${0.15 + cell.intensity * 0.75})`,
                            opacity: cell.isFuture ? 0.35 : 1,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export default App
