const INVALID_FILENAME_CHARACTERS = /[\\/:*?"<>|]+/g

function sanitizeFilenamePart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(INVALID_FILENAME_CHARACTERS, '-')
    .replace(/[. ]+$/g, '')

  return sanitized || fallback
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0')
}

/** Build a sortable, cross-platform filename for a generated project artifact. */
export function buildTimestampedExportFilename(
  projectName: string,
  extension: string,
  exportedAt: Date = new Date(),
): string {
  const safeName = sanitizeFilenamePart(projectName, 'export')
  const safeExtension = extension.replace(/^\.+/, '') || 'file'
  const timestamp = [
    exportedAt.getFullYear(),
    padNumber(exportedAt.getMonth() + 1),
    padNumber(exportedAt.getDate()),
  ].join('-') + `_${padNumber(exportedAt.getHours())}-${padNumber(exportedAt.getMinutes())}`

  return `${safeName}_${timestamp}.${safeExtension}`
}
