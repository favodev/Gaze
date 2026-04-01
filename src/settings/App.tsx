import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_CONFIG } from '../shared/constants'
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

  const statusText =
    saveStatus === 'saving'
      ? 'Saving...'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? errorMessage ?? 'Storage error'
          : 'Changes are saved automatically'

  return (
    <main className="min-h-screen p-8 text-slate-900">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage what counts as distraction for you.
        </p>
      </header>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Distraction sites</h2>
          <span className="text-xs text-slate-500">{siteCount} configured</span>
        </div>

        <form onSubmit={onAddDomain} className="mt-4 flex gap-2">
          <input
            value={draftDomain}
            onChange={(event) => setDraftDomain(event.target.value)}
            placeholder="youtube.com"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Add
          </button>
        </form>

        <ul className="mt-4 space-y-2">
          {config.distractionSites.map((domain) => (
            <li
              key={domain}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <span>{domain}</span>
              <button
                type="button"
                onClick={() => void removeDomain(domain)}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        {config.distractionSites.length === 0 && (
          <p className="mt-3 text-sm text-slate-600">
            No domains configured. Add at least one to start tracking.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void resetDefaults()}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
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
