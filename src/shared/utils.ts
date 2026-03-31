export function getTodayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function isDomainTracked(domain: string, trackedDomains: string[]): boolean {
  return trackedDomains.some(
    (trackedDomain) =>
      domain === trackedDomain || domain.endsWith(`.${trackedDomain}`),
  )
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m`
  }

  return `${safeSeconds}s`
}

export function formatShortDate(
  date = new Date(),
  locale = 'en-US',
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function sumSiteSeconds(sites: Record<string, number>): number {
  return Object.values(sites).reduce((acc, seconds) => acc + seconds, 0)
}

export function elapsedSeconds(fromTimestamp: number, toTimestamp = Date.now()): number {
  const elapsedMs = Math.max(0, toTimestamp - fromTimestamp)
  return Math.floor(elapsedMs / 1000)
}
