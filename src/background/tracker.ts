import { BADGE_COLOR } from '../shared/constants'
import type { ActiveSession } from '../shared/types'
import { elapsedSeconds, extractTrackingKey, formatDuration } from '../shared/utils'
import {
  activateConsciousMode,
  addTrackedSeconds,
  clearConsciousMode,
  getConsciousModeStatus,
  getTodayTotals,
  setLastActiveState,
} from './storage'

export class GazeTracker {
  private activeSession: ActiveSession | null = null
  private static readonly TICK_ALARM_NAME = 'gaze-tracking-tick'

  public init(): void {
    this.registerListeners()
    chrome.alarms.create(GazeTracker.TICK_ALARM_NAME, { periodInMinutes: 1 })
    void this.restoreFromCurrentTab()
    void this.refreshBadge()
  }

  private registerListeners(): void {
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      void this.handleTabActivated(tabId)
    })

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab.active || !changeInfo.url) {
        return
      }

      void this.handleTabUpdated(tabId)
    })

    chrome.windows.onFocusChanged.addListener((windowId) => {
      void this.handleWindowFocusChanged(windowId)
    })

    chrome.idle.onStateChanged.addListener((state) => {
      void this.handleIdleStateChanged(state)
    })

    chrome.runtime.onStartup.addListener(() => {
      void this.restoreFromCurrentTab()
      void this.refreshBadge()
    })

    chrome.runtime.onInstalled.addListener(() => {
      chrome.alarms.create(GazeTracker.TICK_ALARM_NAME, { periodInMinutes: 1 })
      void this.restoreFromCurrentTab()
      void this.refreshBadge()
    })

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== GazeTracker.TICK_ALARM_NAME) {
        return
      }

      void this.tickActiveSession()
    })

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CONSCIOUS_MODE_ACTIVATE') {
        void this.handleConsciousModeActivate(message.durationMinutes, sendResponse)
        return true
      }

      if (message?.type === 'CONSCIOUS_MODE_CLEAR') {
        void this.handleConsciousModeClear(sendResponse)
        return true
      }

      if (message?.type === 'CONSCIOUS_MODE_STATUS') {
        void this.handleConsciousModeStatus(sendResponse)
        return true
      }

      return false
    })
  }

  private async handleConsciousModeActivate(
    durationMinutes: number,
    sendResponse: (response: { ok: boolean; until?: number; error?: string }) => void,
  ): Promise<void> {
    try {
      await this.flushActiveSession()
      const result = await activateConsciousMode(durationMinutes)
      await this.refreshBadge()
      sendResponse({ ok: true, until: result.until })
    } catch (error: unknown) {
      console.error('Failed to activate conscious mode', error)
      sendResponse({ ok: false, error: 'Could not activate conscious mode.' })
    }
  }

  private async handleConsciousModeClear(
    sendResponse: (response: { ok: boolean; error?: string }) => void,
  ): Promise<void> {
    try {
      await clearConsciousMode()
      await this.refreshBadge()
      sendResponse({ ok: true })
    } catch (error: unknown) {
      console.error('Failed to clear conscious mode', error)
      sendResponse({ ok: false, error: 'Could not clear conscious mode.' })
    }
  }

  private async handleConsciousModeStatus(
    sendResponse: (response: {
      ok: boolean
      active?: boolean
      until?: number
      remainingMs?: number
      error?: string
    }) => void,
  ): Promise<void> {
    try {
      const status = await getConsciousModeStatus()
      sendResponse({ ok: true, ...status })
    } catch (error: unknown) {
      console.error('Failed to read conscious mode status', error)
      sendResponse({ ok: false, error: 'Could not read conscious mode status.' })
    }
  }

  private async handleTabActivated(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId)
    await this.switchToTab(tab)
  }

  private async handleTabUpdated(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId)
    await this.switchToTab(tab)
  }

  private async handleWindowFocusChanged(windowId: number): Promise<void> {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await this.flushActiveSession()
      return
    }

    await this.restoreFromCurrentTab()
  }

  private async handleIdleStateChanged(
    state: string,
  ): Promise<void> {
    if (state === 'active') {
      await this.restoreFromCurrentTab()
      return
    }

    await this.flushActiveSession()
  }

  private async restoreFromCurrentTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })

    await this.switchToTab(tab)
  }

  private async switchToTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
    const nextDomain = tab?.url ? extractTrackingKey(tab.url) : null
    const nextTabId = tab?.id ?? null

    if (!nextDomain) {
      await this.flushActiveSession()
      return
    }

    const now = Date.now()

    if (this.activeSession?.domain === nextDomain) {
      this.activeSession = {
        ...this.activeSession,
        tabId: nextTabId,
      }
      return
    }

    await this.flushActiveSession()

    this.activeSession = {
      domain: nextDomain,
      startedAt: now,
      tabId: nextTabId,
    }

    await setLastActiveState(nextDomain, now)
  }

  private async flushActiveSession(): Promise<void> {
    if (!this.activeSession) {
      return
    }

    const consciousMode = await getConsciousModeStatus()
    if (consciousMode.active) {
      this.activeSession = null
      await this.refreshBadge()
      return
    }

    const { domain, startedAt } = this.activeSession
    const seconds = elapsedSeconds(startedAt)

    if (seconds > 0) {
      await addTrackedSeconds(domain, seconds)
      await this.refreshBadge()
    }

    this.activeSession = null
  }

  private async tickActiveSession(): Promise<void> {
    if (!this.activeSession) {
      await this.refreshBadge()
      return
    }

    const consciousMode = await getConsciousModeStatus()
    if (consciousMode.active) {
      this.activeSession = {
        ...this.activeSession,
        startedAt: Date.now(),
      }
      await this.refreshBadge()
      return
    }

    const now = Date.now()
    const { domain, startedAt } = this.activeSession
    const seconds = elapsedSeconds(startedAt, now)

    if (seconds > 0) {
      await addTrackedSeconds(domain, seconds)
      this.activeSession = {
        ...this.activeSession,
        startedAt: now,
      }
      await setLastActiveState(domain, now)
      await this.refreshBadge()
    }
  }

  private async refreshBadge(): Promise<void> {
    const consciousMode = await getConsciousModeStatus()

    if (consciousMode.active) {
      const remainingMinutes = Math.ceil(consciousMode.remainingMs / 60_000)
      await chrome.action.setBadgeBackgroundColor({ color: '#2563EB' })
      await chrome.action.setBadgeText({ text: `P${remainingMinutes}` })
      await chrome.action.setTitle({
        title: `Gaze: conscious mode active (${remainingMinutes}m left)`,
      })
      return
    }

    const { totalSeconds } = await getTodayTotals()
    const badgeText = totalSeconds > 0 ? formatDuration(totalSeconds) : '0m'

    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
    await chrome.action.setBadgeText({ text: badgeText })
    await chrome.action.setTitle({
      title:
        totalSeconds > 0
          ? `Gaze: ${formatDuration(totalSeconds)} today`
          : 'Gaze: 0m today',
    })
  }
}
