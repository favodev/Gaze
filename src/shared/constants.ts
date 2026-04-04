import type { AppStorage, UserConfig } from './types'

export const DEFAULT_DISTRACTION_SITES = [
  'youtube.com',
  'reddit.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'twitch.tv',
  'netflix.com',
  '9gag.com',
  'buzzfeed.com',
]

export const DEFAULT_CONFIG: UserConfig = {
  distractionSites: DEFAULT_DISTRACTION_SITES,
  consciousModeDuration: 30,
  showBadge: true,
  theme: 'system',
}

export const DEFAULT_STORAGE: AppStorage = {
  records: [],
  config: DEFAULT_CONFIG,
  lastActiveTab: '',
  lastActiveTime: 0,
  consciousModeUntil: 0,
}

export const BADGE_COLOR = '#DC2626'
