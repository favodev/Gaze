export interface DayRecord {
  date: string
  sites: Record<string, number>
  consciousModeActivations: number
}

export interface UserConfig {
  distractionSites: string[]
  consciousModeDuration: number
  showBadge: boolean
  theme: 'light' | 'dark' | 'system'
}

export interface AppStorage {
  records: DayRecord[]
  config: UserConfig
  lastActiveTab: string
  lastActiveTime: number
  consciousModeUntil: number
}

export interface ActiveSession {
  domain: string
  startedAt: number
  tabId: number | null
}
