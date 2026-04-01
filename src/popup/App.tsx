import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DayRecord } from '../shared/types'
import {
  formatDuration,
  formatShortDate,
  getTodayDateString,
  sumSiteSeconds,
} from '../shared/utils'

interface PopupState {
  todayTotalSeconds: number
  averageDailySeconds: number
  topSites: Array<{ domain: string; seconds: number }>
}

type LoadStatus = 'loading' | 'ready' | 'error'

function getTodayRecord(records: DayRecord[]): DayRecord | undefined {
  const today = getTodayDateString()
  return records.find((record) => record.date === today)
}

function toPopupState(records: DayRecord[]): PopupState {
  const todayRecord = getTodayRecord(records)
  const todayTotalSeconds = sumSiteSeconds(todayRecord?.sites ?? {})
  const topSites = Object.entries(todayRecord?.sites ?? {})
    .sort(([, leftSeconds], [, rightSeconds]) => rightSeconds - leftSeconds)
    .slice(0, 3)
    .map(([domain, seconds]) => ({ domain, seconds }))

  const averageDailySeconds =
    records.length > 0
      ? Math.floor(
          records.reduce((acc, record) => acc + sumSiteSeconds(record.sites), 0) /
            records.length,
        )
      : 0

  return {
    todayTotalSeconds,
    averageDailySeconds,
    topSites,
  }
}

async function loadPopupState(): Promise<PopupState> {
  const result = await chrome.storage.local.get(['records'])
  const records = Array.isArray(result.records)
    ? (result.records as DayRecord[])
    : []

  return toPopupState(records)
}

function App() {
  const [state, setState] = useState<PopupState>({
    todayTotalSeconds: 0,
    averageDailySeconds: 0,
    topSites: [],
  })
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const sync = useCallback(async () => {
    try {
      setLoadStatus('loading')
      setErrorMessage(null)
      const nextState = await loadPopupState()
      setState(nextState)
      setLoadStatus('ready')
    } catch (error: unknown) {
      console.error('Failed to load popup state', error)
      setLoadStatus('error')
      setErrorMessage('Could not load your local stats right now.')
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

  const averageDiff = useMemo(
    () => state.todayTotalSeconds - state.averageDailySeconds,
    [state.averageDailySeconds, state.todayTotalSeconds],
  )
  const todayLabel = useMemo(() => formatShortDate(), [])

  const averageLabel =
    averageDiff === 0
      ? 'Equal to your average'
      : averageDiff > 0
        ? `${formatDuration(averageDiff)} above average`
        : `${formatDuration(Math.abs(averageDiff))} below average`

  const openDashboard = () => {
    const url = chrome.runtime.getURL('src/dashboard/index.html')
    void chrome.tabs.create({ url })
  }

  const openSettings = () => {
    void chrome.runtime.openOptionsPage()
  }

  return (
    <main className="w-[360px] p-4 text-[var(--app-text)]">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Gaze</h1>
          <p className="mt-1 text-sm text-[var(--muted-text)]">
            Today summary · {todayLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={openSettings}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--muted-text)] hover:bg-[var(--surface-border)]"
        >
          Settings
        </button>
      </header>

      {loadStatus === 'error' && (
        <section className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">Storage error</p>
          <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void sync()}
            className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Retry
          </button>
        </section>
      )}

      {loadStatus === 'loading' && (
        <section className="mt-4 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3">
          <p className="text-sm text-[var(--muted-text)]">Loading stats...</p>
        </section>
      )}

      {loadStatus === 'ready' && (
        <>
          <section className="mt-4 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">
              Total distraction
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatDuration(state.todayTotalSeconds)}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-text)]">{averageLabel}</p>
          </section>

          <section className="mt-4 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">
              Top sites
            </p>

            {state.topSites.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-text)]">
                No tracked time yet for today.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {state.topSites.map((site) => (
                  <li
                    key={site.domain}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate pr-3">{site.domain}</span>
                    <span className="font-medium text-[var(--muted-text)]">
                      {formatDuration(site.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <button
        type="button"
        onClick={openDashboard}
        className="mt-4 w-full rounded-md bg-[var(--button-bg)] px-3 py-2 text-sm font-medium text-[var(--button-fg)]"
      >
        Open dashboard
      </button>
    </main>
  )
}

export default App
