import {
  getProjectElectrical,
  getProjectElectricalPanels,
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findSupplyTapAnchorDevice } from '@/lib/supplyTaps/tapAnchorDevice'
import { resolveLabelScheme, resolveTerminalStripScheme } from '@/lib/eendraad/labelScheme'
import type { TerminalNumberFormat } from '@/types/junction'

type TerminalStripEntity = {
  symbol?: unknown
  label?: unknown
  junctionIdentity?: unknown
  terminalStripPin?: unknown
  terminalStripOutgoingPin?: unknown
  trunkPosition?: unknown
  id?: unknown
  terminalStripPanelId?: unknown
}

export interface TerminalStripOccurrence {
  id: string
  entityId: string
  side: 'incoming' | 'outgoing'
  stripId: string
  pin: number
  /** Electrical ownership; repeated numbers are legal only inside this circuit. */
  circuitId?: string
  /** Physical panel owning this occurrence, unless it is explicitly mounted elsewhere. */
  panelId?: string
}

export function terminalStripOccurrenceId(entityId: string, side: 'incoming' | 'outgoing'): string {
  return `${entityId}:${side}`
}

export function normalizeTerminalStripId(value: string | undefined): string {
  const editable = (value ?? '').trim().replace(/^X/i, '')
  return editable.split('-')[0]?.trim() ?? ''
}

export function getTerminalStripId(entity: TerminalStripEntity): string {
  const identity =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  return normalizeTerminalStripId(identity)
}

export function getTerminalStripPin(entity: TerminalStripEntity): number | undefined {
  if (
    typeof entity.terminalStripPin === 'number' &&
    Number.isInteger(entity.terminalStripPin) &&
    entity.terminalStripPin > 0
  ) {
    return entity.terminalStripPin
  }
  const legacy =
    typeof entity.junctionIdentity === 'string'
      ? entity.junctionIdentity
      : typeof entity.label === 'string'
        ? entity.label
        : ''
  const match = /^(?:X)?[^-]+-([1-9]\d*)$/i.exec(legacy.trim())
  return match ? Number(match[1]) : undefined
}

export function getTerminalStripOutgoingPin(entity: TerminalStripEntity): number | undefined {
  return typeof entity.terminalStripOutgoingPin === 'number' &&
    Number.isInteger(entity.terminalStripOutgoingPin) &&
    entity.terminalStripOutgoingPin > 0
    ? entity.terminalStripOutgoingPin
    : undefined
}

/** Writes strip `stripId` and terminal `pin` as X1-1, X1.1 or X1.01. */
export function formatTerminalNumber(
  stripId: string,
  pin: number | undefined,
  format: TerminalNumberFormat = 'X5-1'
): string {
  if (pin == null) return `X${stripId}`
  if (format === 'X5.1') return `X${stripId}.${pin}`
  if (format === 'X5.01') return `X${stripId}.${String(pin).padStart(2, '0')}`
  return `X${stripId}-${pin}`
}

/** The terminal number format of the project's automatic naming preset. */
export function getProjectTerminalNumberFormat(project: unknown): TerminalNumberFormat {
  return getProjectTerminalStripScheme(project).format
}

export function getProjectTerminalStripScheme(project: unknown) {
  const installation =
    project && typeof project === 'object'
      ? getProjectElectricalInstallation(project as ProjectWithOptionalV2Electrical)
      : undefined
  return resolveTerminalStripScheme(resolveLabelScheme(installation?.labelScheme))
}

export function getTerminalStripDisplayLabel(
  entityOrLabel: TerminalStripEntity | string | undefined,
  pinOverride?: number,
  format: TerminalNumberFormat = 'X5-1'
): string {
  const entity =
    typeof entityOrLabel === 'object' && entityOrLabel != null
      ? entityOrLabel
      : { junctionIdentity: entityOrLabel }
  const stripId = getTerminalStripId(entity)
  const pin = pinOverride ?? getTerminalStripPin(entity)
  return formatTerminalNumber(stripId, pin, format)
}

export function collectTerminalStripOccurrences(project: unknown): TerminalStripOccurrence[] {
  const occurrences: TerminalStripOccurrence[] = []
  const seen = new Set<object>()
  const visit = (value: unknown, circuitId?: string, panelId?: string): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, circuitId, panelId))
      return
    }
    const entity = value as TerminalStripEntity & Record<string, unknown>
    if (
      typeof entity.id === 'string' &&
      Array.isArray(entity.circuits) &&
      Array.isArray(entity.protections)
    ) {
      panelId = entity.id
    }
    if (typeof entity.id === 'string' && Array.isArray(entity.endpoints)) circuitId = entity.id
    if (entity.symbol === 'terminal_strip') {
      const stripId = getTerminalStripId(entity)
      const pin = getTerminalStripPin(entity)
      if (stripId && pin != null) {
        const entityId =
          typeof entity.id === 'string' ? entity.id : `__terminal-${occurrences.length}`
        occurrences.push({
          id: terminalStripOccurrenceId(entityId, 'incoming'),
          entityId,
          side: 'incoming',
          ...(circuitId ? { circuitId } : {}),
          ...(typeof entity.terminalStripPanelId === 'string'
            ? { panelId: entity.terminalStripPanelId }
            : panelId ? { panelId } : {}),
          stripId,
          pin,
        })
        // One terminal, one number: a stored outgoing number that differs is ignored.
        if (
          getTerminalStripOutgoingPin(entity) != null ||
          typeof entity.trunkPosition === 'number'
        ) {
          occurrences.push({
            id: terminalStripOccurrenceId(entityId, 'outgoing'),
            entityId,
            side: 'outgoing',
            ...(circuitId ? { circuitId } : {}),
            ...(typeof entity.terminalStripPanelId === 'string'
              ? { panelId: entity.terminalStripPanelId }
              : panelId ? { panelId } : {}),
            stripId,
            pin,
          })
        }
      }
    }
    Object.values(entity).forEach((child) => visit(child, circuitId, panelId))
  }
  const document = project as ProjectWithOptionalV2Electrical | null | undefined
  if (document && getProjectElectrical(document)) {
    // Panel occurrences own their circuit context. Ignore flattened device projections and snapshots.
    visit(getProjectElectricalPanels(document))
    visit(getProjectElectricalInstallation(document))
    visit(selectProjectSupplyAssemblies(document))
  } else {
    visit(project)
  }
  const ids = new Set<string>()
  return occurrences.filter((occurrence) => {
    if (ids.has(occurrence.id)) return false
    ids.add(occurrence.id)
    return true
  })
}

export function getNextTerminalStripPin(project: unknown, stripId = '1'): number {
  const normalizedId = normalizeTerminalStripId(stripId).toUpperCase()
  const used = new Set(
    collectTerminalStripOccurrences(project)
      .filter((occurrence) => occurrence.stripId.toUpperCase() === normalizedId)
      .map((occurrence) => occurrence.pin)
  )
  let pin = 1
  while (used.has(pin)) pin += 1
  return pin
}

export function getNextTerminalStripId(project: unknown): string {
  const used = new Set(
    collectTerminalStripOccurrences(project).map((occurrence) => occurrence.stripId.toUpperCase())
  )
  let number = 1
  while (used.has(String(number))) number += 1
  return String(number)
}

/** Pins shown on one terminal-strip module; equal IDs on other panels are separate blocks. */
export function getTerminalStripOccurrencesForEntity(
  project: unknown,
  entity: TerminalStripEntity
): TerminalStripOccurrence[] {
  const stripId = getTerminalStripId(entity).toUpperCase()
  if (!stripId) return []
  const occurrences = collectTerminalStripOccurrences(project)
  const entityId = typeof entity.id === 'string' ? entity.id : undefined
  const entityOccurrence = entityId
    ? occurrences.find((occurrence) => occurrence.entityId === entityId)
    : undefined
  const panelId = typeof entity.terminalStripPanelId === 'string'
    ? entity.terminalStripPanelId
    : entityOccurrence?.panelId
  return occurrences.filter((occurrence) =>
    occurrence.stripId.toUpperCase() === stripId &&
    (panelId == null || occurrence.panelId === panelId)
  )
}

/**
 * Reuse this circuit's group on the strip; other circuits reserve their own number. A strip on a
 * supply tap that leaves the grid wire right after a terminal strip is another outgoing section
 * of that strip (X1-1 in, the tap strips X1-2, X1-3, ...); any other strip starts its own.
 */
export function getTerminalStripCreationProps(
  project: unknown,
  stripId?: string,
  circuitId?: string,
  panelId?: string
) {
  const occurrences = collectTerminalStripOccurrences(project)
  const circuitStrip = circuitId
    ? occurrences.find((occurrence) => occurrence.circuitId === circuitId)
    : undefined
  const tapAnchor =
    circuitId && project && typeof project === 'object'
      ? findSupplyTapAnchorDevice(project as ProjectWithOptionalV2Electrical, circuitId)
      : undefined
  const tapAnchorStripId =
    tapAnchor?.symbol === 'terminal_strip' ? getTerminalStripId(tapAnchor) || undefined : undefined
  const panelStrip = panelId && !tapAnchor
    ? occurrences.find((occurrence) => occurrence.panelId === panelId)
    : undefined
  const normalizedId = normalizeTerminalStripId(stripId) ||
    circuitStrip?.stripId ||
    tapAnchorStripId ||
    panelStrip?.stripId ||
    (panelId ? getNextTerminalStripId(project) : '1')
  const existing = circuitId
    ? occurrences.find(
        (occurrence) =>
          occurrence.circuitId === circuitId &&
          occurrence.stripId.toUpperCase() === normalizedId.toUpperCase()
      )
    : undefined
  // Per cable, every new occurrence takes the next free number; a supply tap keeps its rule.
  const reuse = getProjectTerminalStripScheme(project).numbering === 'circuit' || tapAnchor != null
  const pin = (reuse ? existing?.pin : undefined) ?? getNextTerminalStripPin(project, normalizedId)
  return {
    label: `${normalizedId}-${pin}`,
    junctionIdentity: normalizedId,
    terminalStripPin: pin,
  }
}

/**
 * Per cable, a copy of a terminal strip occurrence takes the next free number on its strip rather
 * than the original's. Call it with the fresh clones (inserted into `project` or not); the clones
 * are numbered one after another and never collide with each other. Per circuit it does nothing.
 */
export function assignNextTerminalStripPins(
  project: unknown,
  clones: Array<TerminalStripEntity & { terminalStripPin?: number; terminalStripOutgoingPin?: number }>
): void {
  if (getProjectTerminalStripScheme(project).numbering !== 'cable') return
  const strips = clones.filter((clone) => clone.symbol === 'terminal_strip' && getTerminalStripId(clone))
  if (!strips.length) return
  const cloneIds = new Set(strips.flatMap((clone) => (typeof clone.id === 'string' ? [clone.id] : [])))
  const used = new Map<string, Set<number>>()
  for (const occurrence of collectTerminalStripOccurrences(project)) {
    if (cloneIds.has(occurrence.entityId)) continue
    const key = occurrence.stripId.toUpperCase()
    used.set(key, (used.get(key) ?? new Set()).add(occurrence.pin))
  }
  for (const clone of strips) {
    const stripId = getTerminalStripId(clone)
    const taken = used.get(stripId.toUpperCase()) ?? new Set<number>()
    let pin = 1
    while (taken.has(pin)) pin += 1
    taken.add(pin)
    used.set(stripId.toUpperCase(), taken)
    clone.terminalStripPin = pin
    if (getTerminalStripOutgoingPin(clone) != null) clone.terminalStripOutgoingPin = pin
    if (typeof clone.label === 'string' && /^(?:X)?[^-]+-[1-9]\d*$/i.test(clone.label.trim())) {
      clone.label = `${stripId}-${pin}`
    }
  }
}

/** Returns the legacy combined designation used by automatic endpoint labels. */
export function getNextTerminalStripLabel(
  project: unknown,
  stripId?: string,
  circuitId?: string,
  panelId?: string
): string {
  return getTerminalStripCreationProps(project, stripId, circuitId, panelId).label
}

export function getTerminalStripTrunkCreationProps(
  project: unknown,
  stripId?: string,
  circuitId?: string,
  panelId?: string
) {
  const incoming = getTerminalStripCreationProps(project, stripId, circuitId, panelId)
  return { ...incoming, terminalStripOutgoingPin: incoming.terminalStripPin }
}

export function getTerminalStripTrunkConnectionProps(
  project: unknown,
  stripId?: string,
  circuitId?: string,
  panelId?: string
) {
  const { label: _label, ...connectionProps } = getTerminalStripTrunkCreationProps(
    project,
    stripId,
    circuitId,
    panelId
  )
  return connectionProps
}

/** A terminal has one number; a stored outgoing number is only kept for compatibility. */
export function getEffectiveTerminalStripOutgoingPin(
  _project: unknown,
  entity: TerminalStripEntity
): number {
  return getTerminalStripPin(entity) ?? 1
}

/**
 * The fields to write when a terminal gets `pin` on strip `stripId`. In and out of a through
 * terminal are one terminal, so either side sets the same number; a stored outgoing number is
 * kept equal. A legacy combined label ("2-1") follows the designation.
 */
export function getTerminalStripPinPatch(
  entity: TerminalStripEntity,
  side: 'incoming' | 'outgoing',
  stripId: string,
  pin: number
): { junctionIdentity: string; terminalStripPin?: number; terminalStripOutgoingPin?: number; label?: string } {
  void side
  const follows = getTerminalStripOutgoingPin(entity) != null
  const legacyLabel =
    typeof entity.label === 'string' && /^(?:X)?[^-]+-[1-9]\d*$/i.test(entity.label.trim())
  return {
    junctionIdentity: stripId,
    terminalStripPin: pin,
    ...(follows ? { terminalStripOutgoingPin: pin } : {}),
    ...(legacyLabel ? { label: `${stripId}-${pin}` } : {}),
  }
}

export function planTerminalStripPinAssignment(
  _project: unknown,
  occurrenceId: string,
  stripId: string,
  requestedPin: number,
  _vacatedPin?: number
): Array<{ id: string; stripId: string; pin: number }> {
  // Preserve manual sharing. Validation reports cross-circuit conflicts without renumbering peers.
  return [
    {
      id: occurrenceId,
      stripId: normalizeTerminalStripId(stripId) || '1',
      pin: Math.max(1, Math.round(requestedPin)),
    },
  ]
}

export function planTerminalStripPairAssignment(
  _project: unknown,
  entityId: string,
  stripId: string,
  incomingPin: number,
  _outgoingPin?: number
): Array<{ id: string; stripId: string; pin: number }> {
  // The outgoing number is accepted for older callers but equals the incoming one.
  return [
    ...planTerminalStripPinAssignment(
      _project,
      terminalStripOccurrenceId(entityId, 'incoming'),
      stripId,
      incomingPin
    ),
    ...planTerminalStripPinAssignment(
      _project,
      terminalStripOccurrenceId(entityId, 'outgoing'),
      stripId,
      incomingPin
    ),
  ]
}
