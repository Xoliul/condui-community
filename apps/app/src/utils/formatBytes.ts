const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** Human-readable byte size in decimal units, e.g. `1.4 MB`, localized number formatting. */
export function formatBytes(bytes: number, locale?: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`
}
