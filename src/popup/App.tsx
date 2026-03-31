import { useEffect, useMemo, useState } from 'react'
import type { DayRecord } from '../shared/types'
import { formatDuration, getTodayDateString, sumSiteSeconds } from '../shared/utils'

interface PopupState {
  todayTotalSeconds: number
  averageDailySeconds: number
  topSites: Array<{ domain: string; seconds: number }>
}

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

  useEffect(() => {
    const sync = async () => {
      const nextState = await loadPopupState()
      setState(nextState)
    }

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
  }, [])

  const averageDiff = useMemo(
    () => state.todayTotalSeconds - state.averageDailySeconds,
    [state.averageDailySeconds, state.todayTotalSeconds],
  )

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

  return (
    <main className="w-[360px] p-4 text-slate-900">
      <header>
        <h1 className="text-lg font-semibold">Gaze</h1>
        <p className="mt-1 text-sm text-slate-600">Today summary</p>
      </header>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Total distraction
        </p>
        <p className="mt-1 text-2xl font-semibold">
          {formatDuration(state.todayTotalSeconds)}
        </p>
        <p className="mt-1 text-xs text-slate-600">{averageLabel}</p>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Top sites</p>

        {state.topSites.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
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
                <span className="font-medium text-slate-700">
                  {formatDuration(site.seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={openDashboard}
        className="mt-4 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
      >
        Open dashboard
      </button>
    </main>
  )
}

export default App
