import type { Issue } from '@/lib/validation/core/types'
import {
  collectTerminalStripOccurrences,
  formatTerminalNumber,
  getProjectTerminalNumberFormat,
  type TerminalStripOccurrence,
} from './labels'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Shared by project validation and the junction editor's Mark as checked gate. */
export function collectTerminalStripGroupConflicts(
  project: unknown
): Array<{ label: string; members: TerminalStripOccurrence[] }> {
  const groups = new Map<string, TerminalStripOccurrence[]>()
  for (const occurrence of collectTerminalStripOccurrences(project)) {
    const key = `X${occurrence.stripId.toUpperCase()}-${occurrence.pin}`
    const members = groups.get(key) ?? []
    members.push(occurrence)
    groups.set(key, members)
  }
  return [...groups].flatMap(([label, members]) => {
    const owners = new Set(members.map((member) => member.circuitId ?? `device:${member.entityId}`))
    return owners.size > 1 ? [{ label, members }] : []
  })
}

/** Group labels never connect separate circuits, even before detailed rewiring is configured. */
export function collectTerminalStripValidationIssues(project: unknown, t: Translate): Issue[] {
  const issues: Issue[] = []
  const format = getProjectTerminalNumberFormat(project)
  for (const { label, members } of collectTerminalStripGroupConflicts(project)) {
    const shownLabel = formatTerminalNumber(members[0]!.stripId, members[0]!.pin, format)
    const ids = [...new Set(members.map((member) => member.entityId))].sort()
    issues.push({
      id: `terminal-strip.circuit-conflict:${label}:${ids.join(',')}`,
      ruleId: 'terminal-strip.circuit-conflict',
      severity: 'error',
      jurisdiction: '',
      rulesetVersion: '',
      scope: { type: 'device', id: ids[0]! },
      offenders: ids.map((id) => ({ kind: 'device', id, viewHint: 'eendraad' })),
      message: t('terminalStrip.circuitConflict', { label: shownLabel }),
      remediation: t('terminalStrip.circuitConflictRemediation'),
      citations: [],
      tags: ['terminal-strip'],
    })
  }
  return issues
}
