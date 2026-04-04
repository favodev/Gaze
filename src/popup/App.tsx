import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_CONFIG } from '../shared/constants'
import type { DayRecord, UserConfig } from '../shared/types'
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
  consciousModeActivations: number
  consciousModeDuration: number
  consciousModeUntil: number
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
    consciousModeActivations: todayRecord?.consciousModeActivations ?? 0,
    consciousModeDuration: DEFAULT_CONFIG.consciousModeDuration,
    consciousModeUntil: 0,
  }
}

async function loadPopupState(): Promise<PopupState> {
  const result = await chrome.storage.local.get(['records', 'config', 'consciousModeUntil'])
  const records = Array.isArray(result.records)
    ? (result.records as DayRecord[])
    : []
  const storedConfig = (result.config ?? {}) as Partial<UserConfig>
  const consciousModeDuration =
    typeof storedConfig.consciousModeDuration === 'number' &&
    Number.isFinite(storedConfig.consciousModeDuration)
      ? Math.max(5, Math.floor(storedConfig.consciousModeDuration))
      : DEFAULT_CONFIG.consciousModeDuration
  const consciousModeUntil =
    typeof result.consciousModeUntil === 'number' ? result.consciousModeUntil : 0

  return {
    ...toPopupState(records),
    consciousModeDuration,
    consciousModeUntil,
  }
}

async function sendRuntimeMessage<TResponse>(
  message: Record<string, unknown>,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      resolve(response as TResponse)
    })
  })
}

function App() {
  const [state, setState] = useState<PopupState>({
    todayTotalSeconds: 0,
    averageDailySeconds: 0,
    topSites: [],
    consciousModeActivations: 0,
    consciousModeDuration: DEFAULT_CONFIG.consciousModeDuration,
    consciousModeUntil: 0,
  })
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<'idle' | 'working'>('idle')
  const [now, setNow] = useState(() => Date.now())

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
        if (
          areaName !== 'local' ||
          (!changes.records && !changes.config && !changes.consciousModeUntil)
        ) {
          return
        }

        void sync()
      }

    chrome.storage.onChanged.addListener(onChanged)

    return () => {
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [sync])

  useEffect(() => {
    if (state.consciousModeUntil <= Date.now()) {
      return
    }

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [state.consciousModeUntil])

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

  const consciousModeActive = state.consciousModeUntil > now
  const consciousModeRemainingMs = Math.max(0, state.consciousModeUntil - now)
  const consciousModeRemainingMinutes = Math.ceil(consciousModeRemainingMs / 60_000)

  const openDashboard = () => {
    const url = chrome.runtime.getURL('src/dashboard/index.html')
    void chrome.tabs.create({ url })
  }

  const openSettings = () => {
    void chrome.runtime.openOptionsPage()
  }

  const toggleConsciousMode = async () => {
    setActionStatus('working')
    setErrorMessage(null)

    try {
      if (consciousModeActive) {
        const response = await sendRuntimeMessage<{ ok: boolean; error?: string }>({
          type: 'CONSCIOUS_MODE_CLEAR',
        })

        if (!response.ok) {
          throw new Error(response.error ?? 'Could not clear conscious mode.')
        }
      } else {
        const response = await sendRuntimeMessage<{ ok: boolean; error?: string }>({
          type: 'CONSCIOUS_MODE_ACTIVATE',
          durationMinutes: state.consciousModeDuration,
        })

        if (!response.ok) {
          throw new Error(response.error ?? 'Could not activate conscious mode.')
        }
      }

      await sync()
    } catch (error: unknown) {
      console.error('Failed to toggle conscious mode', error)
      setErrorMessage('Could not update conscious mode right now.')
    } finally {
      setActionStatus('idle')
    }
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
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--muted-text)]">
                  Conscious mode
                </p>
                <p className="mt-1 text-sm">
                  {consciousModeActive
                    ? `Active · ${consciousModeRemainingMinutes}m left`
                    : 'Off'}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-text)]">
                  Activated {state.consciousModeActivations} times today
                </p>
              </div>

              <button
                type="button"
                disabled={actionStatus === 'working'}
                onClick={() => void toggleConsciousMode()}
                className="rounded-md bg-[var(--button-bg)] px-3 py-2 text-xs font-medium text-[var(--button-fg)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {actionStatus === 'working'
                  ? 'Updating...'
                  : consciousModeActive
                    ? 'Resume tracking'
                    : `Pause ${state.consciousModeDuration}m`}
              </button>
            </div>
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
