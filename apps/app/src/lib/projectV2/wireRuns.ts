import type { DisciplineModelsV2, RelationshipModelV2, WireRun } from '@/types/projectV2'

export type ProjectWithOptionalV2WireRuns = {
  disciplines?: Partial<DisciplineModelsV2>
}

/**
 * Relationship-property key that points an electrical path relationship at its owning
 * {@link WireRun}. The forward pointer (`relationship.properties[WIRE_RUN_REF_PROPERTY]`) and the
 * inverse index ({@link WireRun.members}) must stay consistent.
 */
export const WIRE_RUN_REF_PROPERTY = 'wireRef'

/** Canonical wire-run collection query. Legacy inputs must normalize before calling this API. */
export function selectProjectWireRuns(document: ProjectWithOptionalV2WireRuns): WireRun[] {
  return document.disciplines?.electrical?.wireRuns ?? []
}

/** Canonical mutable wire-run boundary for store/domain mutations. */
export function editProjectWireRuns(document: ProjectWithOptionalV2WireRuns): WireRun[] {
  const electrical = document.disciplines?.electrical
  if (!electrical) throw new Error('Electrical discipline is required to edit wire runs.')
  if (!Array.isArray(electrical.wireRuns)) electrical.wireRuns = []
  return electrical.wireRuns
}

/** Resolve a wire run by its stable id. */
export function getWireRunById(
  document: ProjectWithOptionalV2WireRuns,
  runId: string
): WireRun | undefined {
  return selectProjectWireRuns(document).find((run) => run.id === runId)
}

/** Read the wire-run id a relationship points at, if any. */
export function readWireRunRef(
  relationship: Pick<RelationshipModelV2, 'properties'>
): string | undefined {
  const ref = relationship.properties?.[WIRE_RUN_REF_PROPERTY]
  return typeof ref === 'string' ? ref : undefined
}

/**
 * A canonical wire anchor: the stable identity of one wire-bearing edge, independent of the
 * volatile snapshot relationship id. The same anchor is produced by the `2.2.0` migration (from the
 * legacy owners) and by `builder.ts` (per emitted edge), so a persisted run resolves to the live
 * edge by construction and survives graph re-derivation.
 */
export type WireAnchor =
  | {
      kind: 'circuit-section'
      circuitId: string
      /**
       * The downstream node the wire flows *into* (e.g. `protection:<id>`, `trunk-device:<id>`,
       * `endpoint:<id>`). In a radial one-wire tree every node has exactly one incoming wire, so
       * this uniquely names that wire — and because trunk devices are included, the wire before and
       * after a device (AC→DC across an inverter, phase reduction across a 4P device) are distinct.
       */
      nodeRef: string
      domain?: string
    }
  | { kind: 'protection-input'; panelId: string; protectionId: string; domain?: string }
  | { kind: 'ground-input'; nodeRef: string }
  | { kind: 'panel-input'; panelId: string; deviceId?: string }
  | { kind: 'feed-run'; feedPathId: string; runKey: string }
  | { kind: 'supply-connection'; assemblyId: string; connectionId: string }

/** Single source of truth for the anchor-key string. Shared by migration and builder. */
export function deriveWireAnchorKey(anchor: WireAnchor): string {
  switch (anchor.kind) {
    case 'circuit-section':
      return `circuit:${anchor.circuitId}:into:${anchor.nodeRef}:${anchor.domain ?? 'AC'}`
    case 'protection-input':
      return `panel:${anchor.panelId}:into:protection:${anchor.protectionId}:${anchor.domain ?? 'AC'}`
    case 'ground-input':
      return `ground:into:${anchor.nodeRef}`
    case 'panel-input':
      return `panel-feed:${anchor.panelId}:into:${anchor.deviceId ? `device:${anchor.deviceId}` : 'bus'}`
    case 'feed-run':
      return `feed:${anchor.feedPathId}:${anchor.runKey}`
    case 'supply-connection':
      return `supply:${anchor.assemblyId}:${anchor.connectionId}`
  }
}

/**
 * Resolve the wire run that owns an edge via the inverse membership index. Scans
 * {@link WireRun.members} for the edge's anchor key; returns undefined when no run claims it (the
 * edge then falls back to a default wire rather than orphaning).
 */
export function findWireRunForAnchor(
  runs: readonly WireRun[],
  anchorKey: string
): WireRun | undefined {
  return runs.find((run) => run.members.includes(anchorKey))
}
