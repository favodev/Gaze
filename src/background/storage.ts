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
  }
}

export async function writeStorage(nextStorage: AppStorage): Promise<void> {
  await chrome.storage.local.set(nextStorage)
}

export function upsertDayRecord(records: DayRecord[], day: string): DayRecord[] {
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

    if (!isDomainTracked(domain, storage.config.distractionSites)) {
      return
    }

    const today = getTodayDateString()
    const records = upsertDayRecord(storage.records, today)
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

export async function getTodayTotals(): Promise<{
  totalSeconds: number
  trackedSites: Record<string, number>
}> {
  const storage = await readStorage()
  const today = getTodayDateString()
  const todayRecord = storage.records.find((record) => record.date === today)
  const trackedSites = todayRecord?.sites ?? {}

  return {
    totalSeconds: sumSiteSeconds(trackedSites),
    trackedSites,
  }
}
