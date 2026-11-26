import { logger } from '@/lib/logger'
import { findDuplicatedBoardSymbols, type DuplicatedBoardSymbol } from '@/lib/panel/duplicatedBoardSymbols'
import { collectDuplicateIdentities, type DuplicateIdentity, type IdentityProject } from '@/lib/projectV2/entityIdentity'
import type { Issue } from './core/types'
import type { DetectedOrphan } from './orphanDetection'

/** Project-wide ID findings, reported once from the first main board. */
export interface IdentityOrphanReport {
  /** One board symbol ID held by several boards (an older board-creation path matched names). */
  duplicatedBoardSymbol: DuplicatedBoardSymbol[]
  /** Any other stored entity ID held by several entities (board symbols are reported above). */
  duplicateEntityId: DuplicateIdentity[]
}

export function detectIdentityOrphans(project: IdentityProject): IdentityOrphanReport {
  const duplicatedBoardSymbol = findDuplicatedBoardSymbols(project)
  const boardSymbolIds = new Set(duplicatedBoardSymbol.map(({ endpointId }) => endpointId))
  return {
    duplicatedBoardSymbol,
    duplicateEntityId: collectDuplicateIdentities(project).filter(
      ({ kind, id }) => !(kind === 'endpoint' && boardSymbolIds.has(id))
    ),
  }
}

export function identityOrphansToDetected(report: IdentityOrphanReport, panelId: string): DetectedOrphan[] {
  return [
    ...report.duplicateEntityId.map((item): DetectedOrphan => ({
      id: `duplicate-entity-id-${item.kind}-${item.id}`,
      kind: item.kind === 'circuit' ? 'circuit' : 'endpoint',
      reason: 'duplicateEntityId',
      summary: `${item.count} ${item.kind} entities share the ID "${item.id}"`,
      panelId,
      focusSelection:
        item.kind === 'endpoint' || item.kind === 'circuit' || item.kind === 'protection' || item.kind === 'trunkDevice'
          ? { type: item.kind, ids: [item.id] }
          : { type: 'endpoint', ids: [] },
    })),
    ...report.duplicatedBoardSymbol.map((item): DetectedOrphan => ({
      id: `duplicated-board-symbol-${item.endpointId}`,
      kind: 'endpoint',
      reason: 'duplicatedBoardSymbol',
      summary: `Board symbol "${item.label}" (${item.endpointId}) is shared by ${item.copyPanelIds.length + 1} boards`,
      panelId,
      focusSelection: { type: 'endpoint', ids: [item.endpointId] },
      resolutionPayload: { kind: 'repairDuplicatedBoardSymbols', endpointId: item.endpointId },
    })),
  ]
}

export function logIdentityOrphans(report: IdentityOrphanReport, panelId: string, prefix: string): void {
  for (const item of report.duplicateEntityId) {
    logger.error(`${prefix} Duplicate ${item.kind} ID "${item.id}" is stored ${item.count} times; lookups by this ID are ambiguous.`, {
      type: 'duplicateEntityId', kind: item.kind, id: item.id, count: item.count, panelId,
    })
  }
  for (const item of report.duplicatedBoardSymbol) {
    logger.error(
      `${prefix} Duplicated board symbol: "${item.label}" (${item.endpointId}) is held by board ${item.ownerPanelId ?? '(none)'} and copied into ${item.copyPanelIds.join(', ')}. The editor and agents cannot tell the boards' symbols apart.`,
      { type: 'duplicatedBoardSymbol', endpointId: item.endpointId, ownerPanelId: item.ownerPanelId, copyPanelIds: item.copyPanelIds, panelId }
    )
  }
}

export function identityOrphansToIssues(
  report: IdentityOrphanReport,
  panelId: string,
  ruleId: string,
  jurisdiction: string,
  rulesetVersion: string,
  msg: {
    duplicatedBoardSymbol: (opts: Record<string, string>) => string
    duplicateEntityId: (opts: Record<string, string>) => string
  }
): Issue[] {
  const base = { ruleId, severity: 'error' as const, jurisdiction, rulesetVersion, scope: { type: 'board' as const, id: panelId }, details: undefined, citations: [] }
  return [
    ...report.duplicateEntityId.map((item): Issue => ({
      ...base,
      id: `${ruleId}:board:${panelId}:duplicate-entity-id:${item.kind}:${item.id}`,
      offenders: [],
      message: msg.duplicateEntityId({ kind: item.kind, id: item.id, count: String(item.count) }),
      tags: ['orphan', 'consistency'],
    })),
    ...report.duplicatedBoardSymbol.map((item): Issue => ({
      ...base,
      id: `${ruleId}:board:${panelId}:duplicated-board-symbol:${item.endpointId}`,
      offenders: [{ kind: 'endpoint', id: item.endpointId, viewHint: 'both' }],
      message: msg.duplicatedBoardSymbol({ label: item.label, boardCount: String(item.copyPanelIds.length + 1) }),
      tags: ['orphan', 'sitplan', 'consistency'],
    })),
  ]
}
