import { reportCrash } from '@/lib/crashReporting/reportCrash'
import { logger } from '@/lib/logger'
import { CommandError } from '@/lib/commands/project/types'

/**
 * A command that throws while applying is a bug, not a rejected edit: the transaction rolls
 * back and the user sees nothing happen. Log the underlying exception and send it as a crash
 * ticket so it reaches support without anyone copying console output.
 * Returns the crash id when a report was sent.
 */
export function reportCommandCrash(error: unknown, label?: string): string | undefined {
  if (!(error instanceof CommandError) || error.code !== 'apply_failed') return undefined
  // Commands may raise apply_failed themselves; only an unexpected exception is a crash.
  const cause = error.details?.cause
  if (!(cause instanceof Error)) return undefined
  const commandId = String(error.details?.commandId ?? 'unknown')
  logger.error('[ProjectCommand] crashed while applying', { commandId, label, cause })
  return reportCrash({
    errorType: 'manual',
    message: `[ProjectCommand] ${commandId} crashed while applying${label ? ` (${label})` : ''}: ${cause.name}: ${cause.message}`,
    ...(cause.stack ? { stack: cause.stack } : {}),
  })
}
