import { DEFAULT_STORAGE } from '../shared/constants'
import type { AppStorage, DayRecord, UserConfig } from '../shared/types'
import { getTodayDateString, isDomainTracked, sumSiteSeconds } from '../shared/utils'

let writeQueue = Promise.resolve()

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(task).catch((error: unknown) => {
    console.error('Failed to update storage', error)
  })

  return writeQueue
}

export async function readStorage(): Promise<AppStorage> {
  const stored = (await chrome.storage.local.get([
    'records',
    'config',
    'lastActiveTab',
    'lastActiveTime',
    'consciousModeUntil',
  ])) as Partial<AppStorage> & { config?: Partial<UserConfig> }

  const rawConfig: Partial<UserConfig> = stored.config ?? {}

  return {
    records: Array.isArray(stored.records) ? stored.records : DEFAULT_STORAGE.records,
    config: {
      ...DEFAULT_STORAGE.config,
      ...rawConfig,
      distractionSites: Array.isArray(rawConfig.distractionSites)
        ? rawConfig.distractionSites
        : DEFAULT_STORAGE.config.distractionSites,
    },
    lastActiveTab:
      typeof stored.lastActiveTab === 'string' ? stored.lastActiveTab : '',
    lastActiveTime:
      typeof stored.lastActiveTime === 'number' ? stored.lastActiveTime : 0,
    consciousModeUntil:
      typeof stored.consciousModeUntil === 'number' ? stored.consciousModeUntil : 0,
  }
}

export async function writeStorage(nextStorage: AppStorage): Promise<void> {
  await chrome.storage.local.set(nextStorage)
}

export function ensureDayRecord(records: DayRecord[], day: string): DayRecord[] {
  const dayIndex = records.findIndex((record) => record.date === day)

  if (dayIndex >= 0) {
    return [...records]
  }

  return [...records, { date: day, sites: {}, consciousModeActivations: 0 }]
}

export async function addTrackedSeconds(
  domain: string,
  secondsToAdd: number,
): Promise<void> {
  if (secondsToAdd <= 0) {
    return
  }

  await enqueueWrite(async () => {
    const storage = await readStorage()

    if (!storage.config.enabled) {
      return
    }

    if (storage.consciousModeUntil > Date.now()) {
      return
    }

    if (!isDomainTracked(domain, storage.config.distractionSites)) {
      return
    }

    const today = getTodayDateString()
    const records = ensureDayRecord(storage.records, today)
    const dayIndex = records.findIndex((record) => record.date === today)

    if (dayIndex < 0) {
      return
    }

    const dayRecord = records[dayIndex]
    const nextSites = {
      ...dayRecord.sites,
      [domain]: (dayRecord.sites[domain] ?? 0) + secondsToAdd,
    }

    const nextRecords = [...records]
    nextRecords[dayIndex] = {
      ...dayRecord,
      sites: nextSites,
    }

    await writeStorage({
      ...storage,
      records: nextRecords,
    })
  })
}

export async function setLastActiveState(
  domain: string,
  timestamp: number,
): Promise<void> {
  await enqueueWrite(async () => {
    const storage = await readStorage()
    await writeStorage({
      ...storage,
      lastActiveTab: domain,
      lastActiveTime: timestamp,
    })
  })
}

export async function getTrackingEnabled(): Promise<boolean> {
  const storage = await readStorage()
  return storage.config.enabled
}

export async function setTrackingEnabled(enabled: boolean): Promise<void> {
  await enqueueWrite(async () => {
    const storage = await readStorage()
    await writeStorage({
      ...storage,
      config: {
        ...storage.config,
        enabled,
      },
      lastActiveTab: enabled ? storage.lastActiveTab : '',
      lastActiveTime: enabled ? storage.lastActiveTime : 0,
    })
  })
}

export async function getTodayTotals(): Promise<{
  totalSeconds: number
  trackedSites: Record<string, number>
  consciousModeActivations: number
}> {
  const storage = await readStorage()
  const today = getTodayDateString()
  const todayRecord = storage.records.find((record) => record.date === today)
  const trackedSites = todayRecord?.sites ?? {}

  return {
    totalSeconds: sumSiteSeconds(trackedSites),
    trackedSites,
    consciousModeActivations: todayRecord?.consciousModeActivations ?? 0,
  }
}

export async function getConsciousModeStatus(): Promise<{
  active: boolean
  until: number
  remainingMs: number
}> {
  const storage = await readStorage()
  const now = Date.now()
  const remainingMs = Math.max(0, storage.consciousModeUntil - now)

  return {
    active: remainingMs > 0,
    until: storage.consciousModeUntil,
    remainingMs,
  }
}

export async function activateConsciousMode(
  durationMinutes: number,
): Promise<{ until: number }> {
  const safeDurationMinutes = Math.max(1, Math.floor(durationMinutes))
  const until = Date.now() + safeDurationMinutes * 60_000

  await enqueueWrite(async () => {
    const storage = await readStorage()
    const today = getTodayDateString()
    const records = ensureDayRecord(storage.records, today)
    const dayIndex = records.findIndex((record) => record.date === today)

    if (dayIndex < 0) {
      return
    }

    const dayRecord = records[dayIndex]
    const nextRecords = [...records]
    nextRecords[dayIndex] = {
      ...dayRecord,
      consciousModeActivations: dayRecord.consciousModeActivations + 1,
    }

    await writeStorage({
      ...storage,
      records: nextRecords,
      consciousModeUntil: until,
    })
  })

  return { until }
}

export async function clearConsciousMode(): Promise<void> {
  await enqueueWrite(async () => {
    const storage = await readStorage()
    await writeStorage({
      ...storage,
      consciousModeUntil: 0,
    })
  })
}
