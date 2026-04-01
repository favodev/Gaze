import { DEFAULT_CONFIG } from './constants'
import type { UserConfig } from './types'

type ResolvedTheme = 'light' | 'dark'

function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function getThemePreferenceFromConfig(config: Partial<UserConfig> | undefined): UserConfig['theme'] {
  const theme = config?.theme
  return theme === 'light' || theme === 'dark' || theme === 'system'
    ? theme
    : DEFAULT_CONFIG.theme
}

function resolveTheme(themePreference: UserConfig['theme'], prefersDark: boolean): ResolvedTheme {
  if (themePreference === 'system') {
    return prefersDark ? 'dark' : 'light'
  }

  return themePreference
}

export async function initializeThemeSync(): Promise<() => void> {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let currentPreference: UserConfig['theme'] = DEFAULT_CONFIG.theme

  const applyCurrentTheme = () => {
    applyResolvedTheme(resolveTheme(currentPreference, media.matches))
  }

  try {
    const result = await chrome.storage.local.get(['config'])
    currentPreference = getThemePreferenceFromConfig(
      (result.config ?? {}) as Partial<UserConfig>,
    )
  } catch (error: unknown) {
    console.error('Failed to read theme preference', error)
  }

  applyCurrentTheme()

  const onStorageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] =
    (changes, areaName) => {
      if (areaName !== 'local' || !changes.config) {
        return
      }

      const nextConfig = (changes.config.newValue ?? {}) as Partial<UserConfig>
      currentPreference = getThemePreferenceFromConfig(nextConfig)
      applyCurrentTheme()
    }

  const onMediaChanged = () => {
    if (currentPreference !== 'system') {
      return
    }

    applyCurrentTheme()
  }

  chrome.storage.onChanged.addListener(onStorageChanged)

  media.addEventListener('change', onMediaChanged)

  return () => {
    chrome.storage.onChanged.removeListener(onStorageChanged)

    media.removeEventListener('change', onMediaChanged)
  }
}
