import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_CONFIG } from '../shared/constants'
import DashboardApp from '../dashboard/App'
import type { UserConfig } from '../shared/types'
import { extractDomain } from '../shared/utils'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function cloneDefaultConfig(): UserConfig {
  return {
    ...DEFAULT_CONFIG,
    distractionSites: [...DEFAULT_CONFIG.distractionSites],
  }
}

function normalizeDomain(rawValue: string): string | null {
  const trimmed = rawValue.trim().toLowerCase()

  if (!trimmed) {
    return null
  }

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`

  return extractDomain(withProtocol)
}

async function loadConfigFromStorage(): Promise<UserConfig> {
  const result = await chrome.storage.local.get(['config'])
  const storedConfig = (result.config ?? {}) as Partial<UserConfig>

  return {
    ...cloneDefaultConfig(),
    ...storedConfig,
    distractionSites: Array.isArray(storedConfig.distractionSites)
      ? [...storedConfig.distractionSites]
      : [...DEFAULT_CONFIG.distractionSites],
  }
}

async function saveConfigToStorage(config: UserConfig): Promise<void> {
  await chrome.storage.local.set({ config })
}

function App() {
  const isDashboardView = useMemo(() => {
    const url = new URL(window.location.href)
    return url.searchParams.get('view') === 'dashboard'
  }, [])

  const [config, setConfig] = useState<UserConfig>(cloneDefaultConfig)
  const [draftDomain, setDraftDomain] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const sync = async () => {
      try {
        const nextConfig = await loadConfigFromStorage()
        setConfig(nextConfig)
      } catch (error: unknown) {
        console.error('Failed to load settings', error)
        setSaveStatus('error')
        setErrorMessage('Could not load settings from local storage.')
      }
    }

    void sync()
  }, [])

  const siteCount = useMemo(
    () => config.distractionSites.length,
    [config.distractionSites.length],
  )

  const persistConfig = async (nextConfig: UserConfig) => {
    setConfig(nextConfig)
    setSaveStatus('saving')
    setErrorMessage(null)

    try {
      await saveConfigToStorage(nextConfig)
      setSaveStatus('saved')
    } catch (error: unknown) {
      console.error('Failed to save settings', error)
      setSaveStatus('error')
      setErrorMessage('Could not save settings. Please retry.')
    }
  }

  const onAddDomain = async (event: FormEvent) => {
    event.preventDefault()

    const normalized = normalizeDomain(draftDomain)

    if (!normalized) {
      setSaveStatus('error')
      setErrorMessage('Enter a valid domain (for example youtube.com).')
      return
    }

    if (config.distractionSites.includes(normalized)) {
      setSaveStatus('error')
      setErrorMessage('This domain is already in your list.')
      return
    }

    const nextConfig: UserConfig = {
      ...config,
      distractionSites: [...config.distractionSites, normalized],
    }

    setDraftDomain('')
    await persistConfig(nextConfig)
  }

  const removeDomain = async (domainToRemove: string) => {
    const nextConfig: UserConfig = {
      ...config,
      distractionSites: config.distractionSites.filter(
        (domain) => domain !== domainToRemove,
      ),
    }

    await persistConfig(nextConfig)
  }

  const clearDomains = async () => {
    const nextConfig: UserConfig = {
      ...config,
      distractionSites: [],
    }

    await persistConfig(nextConfig)
  }

  const resetDefaults = async () => {
    const nextConfig: UserConfig = {
      ...config,
      distractionSites: [...DEFAULT_CONFIG.distractionSites],
    }

    await persistConfig(nextConfig)
  }

  const updateTheme = async (theme: UserConfig['theme']) => {
    const nextConfig: UserConfig = {
      ...config,
      theme,
    }

    await persistConfig(nextConfig)
  }

  const updateConsciousModeDuration = async (minutes: number) => {
    const normalized = Number.isFinite(minutes)
      ? Math.min(180, Math.max(5, Math.floor(minutes)))
      : DEFAULT_CONFIG.consciousModeDuration

    const nextConfig: UserConfig = {
      ...config,
      consciousModeDuration: normalized,
    }

    await persistConfig(nextConfig)
  }

  const statusText =
    saveStatus === 'saving'
      ? 'Saving...'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? errorMessage ?? 'Storage error'
          : 'Changes are saved automatically'

  if (isDashboardView) {
    const goToSettings = () => {
      window.location.href = chrome.runtime.getURL('src/settings/index.html')
    }

    return (
      <>
        <div className="px-6 pt-6 md:px-8 md:pt-8">
          <button
            type="button"
            onClick={goToSettings}
            className="rounded-md border border-[var(--surface-border)] px-3 py-2 text-xs font-medium text-[var(--muted-text)]"
          >
            Back to settings
          </button>
        </div>
        <DashboardApp />
      </>
    )
  }

  return (
    <main className="min-h-screen p-8 text-[var(--app-text)]">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-2 text-sm text-[var(--muted-text)]">
          Manage what counts as distraction for you.
        </p>
      </header>

      <section className="mt-6 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
        <h2 className="text-base font-semibold">Theme</h2>
        <p className="mt-1 text-sm text-[var(--muted-text)]">
          Choose how Gaze looks in popup, settings and dashboard.
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--muted-text)]">
          Color mode
        </label>
        <select
          value={config.theme}
          onChange={(event) =>
            void updateTheme(event.target.value as UserConfig['theme'])
          }
          className="mt-2 w-full rounded-md border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--muted-text)]"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>

        <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-[var(--muted-text)]">
          Conscious mode duration
        </label>
        <p className="mt-1 text-sm text-[var(--muted-text)]">
          How long tracking is paused when you activate conscious mode.
        </p>

        <select
          value={String(config.consciousModeDuration)}
          onChange={(event) =>
            void updateConsciousModeDuration(Number(event.target.value))
          }
          className="mt-3 w-full rounded-md border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--muted-text)]"
        >
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="20">20 minutes</option>
          <option value="30">30 minutes</option>
          <option value="45">45 minutes</option>
          <option value="60">60 minutes</option>
          <option value="90">90 minutes</option>
          <option value="120">120 minutes</option>
        </select>
      </section>

      <section className="mt-6 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-bg)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Distraction sites</h2>
          <span className="text-xs text-[var(--muted-text)]">{siteCount} configured</span>
        </div>

        <form onSubmit={onAddDomain} className="mt-4 flex gap-2">
          <input
            value={draftDomain}
            onChange={(event) => setDraftDomain(event.target.value)}
            placeholder="youtube.com"
            className="flex-1 rounded-md border border-[var(--surface-border)] bg-transparent px-3 py-2 text-sm outline-none ring-0 focus:border-[var(--muted-text)]"
          />
          <button
            type="submit"
            className="rounded-md bg-[var(--button-bg)] px-3 py-2 text-sm font-medium text-[var(--button-fg)]"
          >
            Add
          </button>
        </form>

        <ul className="mt-4 space-y-2">
          {config.distractionSites.map((domain) => (
            <li
              key={domain}
              className="flex items-center justify-between rounded-md border border-[var(--surface-border)] px-3 py-2 text-sm"
            >
              <span>{domain}</span>
              <button
                type="button"
                onClick={() => void removeDomain(domain)}
                className="text-xs font-medium text-[var(--muted-text)] hover:opacity-80"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {config.distractionSites.length === 0 && (
          <p className="mt-3 text-sm text-[var(--muted-text)]">
            No domains configured. Add at least one to start tracking.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void resetDefaults()}
            className="rounded-md border border-[var(--surface-border)] px-3 py-2 text-xs font-medium text-[var(--muted-text)]"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={() => void clearDomains()}
            className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700"
          >
            Clear all
          </button>
        </div>

        <p
          className={`mt-4 text-xs ${saveStatus === 'error' ? 'text-red-600' : 'text-slate-500'}`}
        >
          {statusText}
        </p>
      </section>
    </main>
  )
}

export default App
