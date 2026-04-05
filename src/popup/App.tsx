import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CONFIG } from '../shared/constants'
import type { DayRecord, UserConfig } from '../shared/types'
import {
  elapsedSeconds,
  extractTrackingKey,
  formatDuration,
  formatShortDate,
  getTodayDateString,
  isDomainTracked,
  sumSiteSeconds,
} from '../shared/utils'

interface PopupState {
  activeTrackingKey: string
  trackingEnabled: boolean
  todayTotalSeconds: number
  averageDailySeconds: number
  topSites: Array<{ domain: string; seconds: number }>
  consciousModeActivations: number
  consciousModeDuration: number
  consciousModeUntil: number
}

type LoadStatus = 'loading' | 'ready' | 'error'

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function getTrackingHost(trackingKey: string): string {
  return trackingKey.split('/')[0] ?? trackingKey
}

function getSiteDisplayName(trackingKey: string): string {
  const [host, section] = trackingKey.split('/')
  const root = host?.split('.')[0] ?? trackingKey
  const siteName = toTitleCase(root)

  if (!section) {
    return siteName
  }

  return `${siteName} / ${toTitleCase(section)}`
}

function getFaviconUrl(trackingKey: string): string {
  const host = getTrackingHost(trackingKey)
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`
}

function formatDurationCompactWithSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60

  return `${String(hours).padStart(2, '0')}h:${String(minutes).padStart(2, '0')}m:${String(remainingSeconds).padStart(2, '0')}s`
}

function formatDurationCompactMinutes(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  return `${String(hours).padStart(2, '0')}h:${String(minutes).padStart(2, '0')}m`
}

function SiteIcon({
  trackingKey,
  label,
}: {
  trackingKey: string
  label: string
}) {
  const [hasError, setHasError] = useState(false)
  const fallbackLetter = label.charAt(0).toUpperCase() || 'G'

  if (hasError) {
    return (
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-[var(--surface-border)] bg-[var(--surface-bg)] text-[10px] font-semibold"
        aria-hidden="true"
      >
        {fallbackLetter}
      </span>
    )
  }

  return (
    <img
      src={getFaviconUrl(trackingKey)}
      alt={`${label} icon`}
      referrerPolicy="no-referrer"
      className="h-4 w-4 rounded-sm border border-[var(--surface-border)]"
      onError={() => setHasError(true)}
    />
  )
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
    activeTrackingKey: '',
    trackingEnabled: DEFAULT_CONFIG.enabled,
    todayTotalSeconds,
    averageDailySeconds,
    topSites,
    consciousModeActivations: todayRecord?.consciousModeActivations ?? 0,
    consciousModeDuration: DEFAULT_CONFIG.consciousModeDuration,
    consciousModeUntil: 0,
  }
}

async function loadPopupState(): Promise<PopupState> {
  const result = await chrome.storage.local.get([
    'records',
    'config',
    'consciousModeUntil',
    'lastActiveTab',
    'lastActiveTime',
  ])
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
  const trackedDomains = Array.isArray(storedConfig.distractionSites)
    ? storedConfig.distractionSites
    : DEFAULT_CONFIG.distractionSites

  const lastActiveTab =
    typeof result.lastActiveTab === 'string' ? result.lastActiveTab : ''
  const lastActiveTime =
    typeof result.lastActiveTime === 'number' ? result.lastActiveTime : 0

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  const activeTrackingKey = activeTab?.url ? extractTrackingKey(activeTab.url) : null
  const hasLiveActiveSite =
    (typeof storedConfig.enabled === 'boolean'
      ? storedConfig.enabled
      : DEFAULT_CONFIG.enabled) &&
    consciousModeUntil <= Date.now() &&
    lastActiveTab &&
    lastActiveTime > 0 &&
    activeTrackingKey === lastActiveTab &&
    isDomainTracked(lastActiveTab, trackedDomains)

  let nextRecords = records

  if (hasLiveActiveSite) {
    const pendingSeconds = elapsedSeconds(lastActiveTime)

    if (pendingSeconds > 0) {
      const today = getTodayDateString()
      const dayIndex = records.findIndex((record) => record.date === today)

      if (dayIndex >= 0) {
        const todayRecord = records[dayIndex]
        const nextSites = {
          ...todayRecord.sites,
          [lastActiveTab]: (todayRecord.sites[lastActiveTab] ?? 0) + pendingSeconds,
        }
        nextRecords = [...records]
        nextRecords[dayIndex] = {
          ...todayRecord,
          sites: nextSites,
        }
      } else {
        nextRecords = [
          ...records,
          {
            date: today,
            sites: {
              [lastActiveTab]: pendingSeconds,
            },
            consciousModeActivations: 0,
          },
        ]
      }
    }
  }

  return {
    ...toPopupState(nextRecords),
    activeTrackingKey: hasLiveActiveSite ? lastActiveTab : '',
    trackingEnabled:
      typeof storedConfig.enabled === 'boolean'
        ? storedConfig.enabled
        : DEFAULT_CONFIG.enabled,
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
    activeTrackingKey: '',
    trackingEnabled: DEFAULT_CONFIG.enabled,
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
  const [isTotalPulsing, setIsTotalPulsing] = useState(false)
  const previousTotalRef = useRef(0)

  const sync = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoadStatus('loading')
        setErrorMessage(null)
      }

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
    void sync(true)

    const onChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] =
      (changes, areaName) => {
        if (
          areaName !== 'local' ||
          (!changes.records && !changes.config && !changes.consciousModeUntil)
        ) {
          return
        }

        void sync(false)
      }

    chrome.storage.onChanged.addListener(onChanged)

    return () => {
      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [sync])

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    const interval = window.setInterval(() => {
      void sync(false)
    }, 1000)

    return () => {
      window.clearInterval(interval)
    }
  }, [loadStatus, sync])

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

  useEffect(() => {
    if (loadStatus !== 'ready') {
      return
    }

    if (previousTotalRef.current === 0) {
      previousTotalRef.current = state.todayTotalSeconds
      return
    }

    if (previousTotalRef.current === state.todayTotalSeconds) {
      return
    }

    previousTotalRef.current = state.todayTotalSeconds
    setIsTotalPulsing(true)

    const timeoutId = window.setTimeout(() => {
      setIsTotalPulsing(false)
    }, 420)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadStatus, state.todayTotalSeconds])

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
  const dominantSite = state.topSites[0]
  const dominantShare =
    dominantSite && state.todayTotalSeconds > 0
      ? Math.round((dominantSite.seconds / state.todayTotalSeconds) * 100)
      : 0

  const openDashboard = () => {
    const url = chrome.runtime.getURL('src/settings/index.html?view=dashboard')
    void chrome.tabs.create({ url })
  }

  const openSettings = () => {
    void chrome.runtime.openOptionsPage()
  }

  const toggleConsciousMode = async () => {
    if (!state.trackingEnabled) {
      return
    }

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

  const toggleTrackingEnabled = async () => {
    setActionStatus('working')
    setErrorMessage(null)

    try {
      const response = await sendRuntimeMessage<{
        ok: boolean
        enabled?: boolean
        error?: string
      }>({
        type: 'TRACKING_SET_ENABLED',
        enabled: !state.trackingEnabled,
      })

      if (!response.ok) {
        throw new Error(response.error ?? 'Could not update tracking state.')
      }

      await sync(false)
    } catch (error: unknown) {
      console.error('Failed to toggle tracking state', error)
      setErrorMessage('Could not update tracking state right now.')
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleTrackingEnabled()}
            disabled={actionStatus === 'working'}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-70 ${
              state.trackingEnabled
                ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                : 'border-slate-400 bg-slate-200 text-slate-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state.trackingEnabled ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            />
            {state.trackingEnabled ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={openSettings}
            className="rounded-md px-2 py-1 text-xs font-medium text-[var(--muted-text)] hover:bg-[var(--surface-border)]"
          >
            Settings
          </button>
        </div>
      </header>

      <section className="mt-3 rounded-md border border-[var(--surface-border)] bg-[var(--surface-bg)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--muted-text)]">
          {state.trackingEnabled ? 'Tracking active' : 'Tracking paused'}
        </p>
      </section>

      {!state.trackingEnabled && (
        <section className="mt-4 rounded-lg border border-slate-300 bg-slate-100/70 p-3">
          <p className="text-sm font-medium text-slate-800">Tracking is currently off</p>
          <p className="mt-1 text-xs text-slate-600">
            Turn it on to resume real-time tracking.
          </p>
        </section>
      )}

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
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                isTotalPulsing ? 'motion-highlight' : ''
              }`}
            >
              {formatDurationCompactMinutes(state.todayTotalSeconds)}
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
                disabled={actionStatus === 'working' || !state.trackingEnabled}
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

            {dominantSite && (
              <div className="mt-2 rounded-md border border-[var(--surface-border)] bg-[rgba(220,38,38,0.07)] px-2 py-1.5 text-xs text-[var(--muted-text)]">
                <span className="font-medium text-[var(--app-text)]">
                  {getSiteDisplayName(dominantSite.domain)}
                </span>{' '}
                is leading today with {dominantShare}% of your distraction time.
              </div>
            )}

            {state.topSites.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted-text)]">
                No tracked time yet for today.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {state.topSites.map((site, index) => (
                  <li
                    key={site.domain}
                    className={`motion-fade-up flex items-center justify-between rounded-md border px-2 py-1.5 text-sm ${
                      index === 0
                        ? 'border-[rgba(220,38,38,0.22)] bg-[rgba(220,38,38,0.07)]'
                        : 'border-[var(--surface-border)] bg-transparent'
                    }`}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <div className="flex min-w-0 items-center gap-2 pr-3">
                      <SiteIcon
                        trackingKey={site.domain}
                        label={getSiteDisplayName(site.domain)}
                      />
                      <span className="truncate">{getSiteDisplayName(site.domain)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {index === 0 && (
                        <span className="rounded-full border border-[rgba(220,38,38,0.26)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-text)]">
                          Top
                        </span>
                      )}
                      <span className="font-medium tabular-nums text-[var(--muted-text)]">
                        {site.domain === state.activeTrackingKey
                          ? formatDurationCompactWithSeconds(site.seconds)
                          : formatDurationCompactMinutes(site.seconds)}
                      </span>
                    </div>
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
