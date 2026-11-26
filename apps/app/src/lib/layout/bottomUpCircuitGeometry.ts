/** Circuit lookup indexes, protection labels and reusable column/branch measurements. */
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'

import type { Circuit, ProtectionDevice, Panel } from '@/types/schema'

import type { TrunkLayout, BranchLayout } from './wireSegments'
import {
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'

import { calculateBranchLayoutPass, type BranchPassConstants } from './bottomUpBranchPass'

import {
  measureCircuitLayoutEnvelope,
  type CircuitEnvelopeConfig,
  type CircuitLayoutEnvelope,
} from './circuitLayoutEnvelope'

import type { BottomUpCircuitLayout } from './bottomUpLayout'

// Keep vertically rotated circuit notes just clear of the circuit multiplier.
export const CIRCUIT_NOTES_VERTICAL_OFFSET = 26

// Shared sizing for protection name labels rendered by CircuitLabel. This is an
// estimate (layout is not font-aware), but it keeps automatic spacing in sync
// with the canvas text box and the layout-tree hit zones derived from it.
export const PROTECTION_LABEL_FONT_SIZE = 11

export const PROTECTION_LABEL_CHAR_WIDTH = 6.4

export const PROTECTION_LABEL_MIN_WIDTH = 16

export const PROTECTION_LABEL_MAX_WIDTH = 220

export const PROTECTION_LABEL_DEFAULT_BOX_WIDTH = 80

export const PROTECTION_LABEL_X_OFFSET_FROM_MCB = -20

// Right-align the label just outside the SPD body, whose left edge sits about
// 29px left of the trunk at the standard 30px symbol size.
export const SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK = -32

export const SPD_PROTECTION_LABEL_Y_OFFSET = 2

export const PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL = 5

// CircuitLabel anchors its Konva Text at y - 7. Keep collision geometry aligned
// to the visible text box rather than treating the text baseline as the label's
// top edge. The small padding accounts for glyph overhang and anti-aliasing.
export const CIRCUIT_LABEL_TEXT_Y_OFFSET = -7

export const CIRCUIT_LABEL_TEXT_HEIGHT = PROTECTION_LABEL_FONT_SIZE

export const CIRCUIT_LABEL_COLLISION_PADDING = 3

export function estimateTextLineWidth(text: string, charWidth: number): number {
  return Math.ceil(text.length * charWidth)
}

export function estimateProtectionNameLabelWidth(label: string | undefined | null): number {
  const trimmed = (label ?? '').trim()
  if (!trimmed) return 0
  const raw = estimateTextLineWidth(trimmed, PROTECTION_LABEL_CHAR_WIDTH) + 4
  return Math.min(PROTECTION_LABEL_MAX_WIDTH, Math.max(PROTECTION_LABEL_MIN_WIDTH, raw))
}

export function getCircuitLabelVisualRect({
  x,
  y,
  label,
}: {
  x: number
  y: number
  label: string | undefined | null
}): { left: number; top: number; right: number; bottom: number } {
  const width = Math.max(24, estimateProtectionNameLabelWidth(label))
  const textTop = y + CIRCUIT_LABEL_TEXT_Y_OFFSET
  return {
    left: x - width / 2 - CIRCUIT_LABEL_COLLISION_PADDING,
    top: textTop - CIRCUIT_LABEL_COLLISION_PADDING,
    right: x + width / 2 + CIRCUIT_LABEL_COLLISION_PADDING,
    bottom: textTop + CIRCUIT_LABEL_TEXT_HEIGHT + CIRCUIT_LABEL_COLLISION_PADDING,
  }
}

export function getTopmostCircuitBranch(circuitBranches: BranchLayout[]): BranchLayout | null {
  if (circuitBranches.length === 0) return null
  return circuitBranches.reduce((top, branch) => (branch.branchY < top.branchY ? branch : top))
}

export function getCircuitLineTopY(
  circuitBranches: BranchLayout[],
  fallbackMcbY: number,
  hasSubPanelAtLineEnd: boolean
): number {
  const topmostBranch = getTopmostCircuitBranch(circuitBranches)
  const baseTopY = topmostBranch
    ? topmostBranch.branchY
    : fallbackMcbY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET

  if (!hasSubPanelAtLineEnd || !topmostBranch) {
    return baseTopY
  }

  // Sub-panel symbol is rendered at the very end of the vertical line. When
  // endpoint branches exist, that end sits one row above the topmost branch.
  const hasEndpointBranches = circuitBranches.some((b) => b.endpoints.length > 0)
  const subPanelLineEndY = hasEndpointBranches
    ? topmostBranch.branchY - LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING
    : topmostBranch.branchY

  return Math.min(baseTopY, subPanelLineEndY)
}

/**
 * Per-panel pre-built lookups used by the bottom-up layout pipeline.
 *
 * Built lazily via {@link getPanelLookups} and cached against the `Panel`
 * object via a module-level `WeakMap`. Because the project store creates a
 * new `Panel` object on every edit (immer immutable updates), object
 * identity is a reliable cache key: once a panel mutates, the cache entry
 * for the old object is unreachable and GC'd.
 *
 * Building these maps is O(circuits + protections); every subsequent call
 * on the same panel becomes O(1), eliminating the O(panels × circuits²)
 * tax the previous implementation paid every time `findParentCircuit` /
 * `findProtectionForCircuit` / `findParentRcd` was invoked.
 */
interface PanelLookups {
  /** All circuits in the panel keyed by id (panel-level + under-protection). */
  circuitMap: Map<string, Circuit>
  /** child circuit id → parent Circuit (via parent.subCircuitIds). */
  parentByCircuitId: Map<string, Circuit>
  /** circuit id → first protection (any type) that lists it. */
  protectionByCircuitId: Map<string, ProtectionDevice>
  /** circuit id → first RCD/RCBO that lists it, regardless of group size. */
  firstRcdByCircuitId: Map<string, ProtectionDevice>
}

const panelLookupsCache = new WeakMap<Panel, PanelLookups>()

export function getPanelLookups(panel: Panel): PanelLookups {
  const cached = panelLookupsCache.get(panel)
  if (cached) return cached

  const circuitMap = new Map<string, Circuit>()
  for (const c of panel.circuits) {
    circuitMap.set(c.id, c)
  }
  for (const protection of panel.protections) {
    if (protection.circuits) {
      for (const c of protection.circuits) {
        if (!circuitMap.has(c.id)) circuitMap.set(c.id, c)
      }
    }
  }

  const parentByCircuitId = new Map<string, Circuit>()
  for (const candidate of circuitMap.values()) {
    const subIds = candidate.subCircuitIds
    if (!subIds || subIds.length === 0) continue
    for (const childId of subIds) {
      // Match the legacy "first parent wins" semantics: the previous
      // findParentCircuit iterated panel.circuits then protection.circuits
      // and returned the first hit, never inspecting later candidates.
      if (!parentByCircuitId.has(childId)) {
        parentByCircuitId.set(childId, candidate)
      }
    }
  }

  const protectionByCircuitId = new Map<string, ProtectionDevice>()
  const firstRcdByCircuitId = new Map<string, ProtectionDevice>()
  for (const protection of panel.protections) {
    if (!protection.circuits) continue
    const isRcdLike = protection.type === 'RCD' || protection.type === 'RCBO'
    for (const c of protection.circuits) {
      if (!protectionByCircuitId.has(c.id)) {
        protectionByCircuitId.set(c.id, protection)
      }
      if (isRcdLike && !firstRcdByCircuitId.has(c.id)) {
        firstRcdByCircuitId.set(c.id, protection)
      }
    }
  }

  const lookups: PanelLookups = {
    circuitMap,
    parentByCircuitId,
    protectionByCircuitId,
    firstRcdByCircuitId,
  }
  panelLookupsCache.set(panel, lookups)
  return lookups
}

/**
 * Build a lookup map of circuit ID → Circuit for a panel.
 * Used to resolve subCircuitIds without storing duplicated objects.
 *
 * The map is memoized per Panel object via {@link getPanelLookups}, so
 * repeated calls during a single layout pass are O(1) instead of
 * re-walking `panel.circuits` and `panel.protections`.
 */
export function buildCircuitMap(panel: Panel): Map<string, Circuit> {
  return getPanelLookups(panel).circuitMap
}

/**
 * Resolve subCircuitIds to actual Circuit objects using a lookup map.
 */
/**
 * Find protection for a circuit
 */
export function findProtectionForCircuit(panel: Panel, circuit: Circuit): ProtectionDevice | null {
  return getPanelLookups(panel).protectionByCircuitId.get(circuit.id) ?? null
}

export function isPanelOnlySubPanelFeeder(
  protection: ProtectionDevice | null | undefined,
  circuit: Circuit
): boolean {
  if (!protection?.subPanelId) return false
  const hasConsumerEndpoints = circuit.endpoints.some(
    (endpoint) => endpoint.symbol !== 'panel_distribution'
  )
  const hasOnlyPanelAttachment =
    !hasConsumerEndpoints &&
    (circuit.branches?.length ?? 0) === 0 &&
    (circuit.subCircuitIds?.length ?? 0) === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0
  if (!hasOnlyPanelAttachment) return false

  if (protection.directPanelFeeder) return true

  // A normal one-circuit MCB feeding a new secondary panel is a real,
  // visible protection. Only suppress the extra structural circuit that is
  // carried by the same protection after a feeder protection was deleted.
  const protectionCircuits = protection.circuits ?? []
  return protectionCircuits.length > 1 && protectionCircuits[0]?.id !== circuit.id
}

export function hasPanelAttachmentOnSecondaryBus(
  protection: ProtectionDevice | null | undefined,
  circuit: Circuit
): boolean {
  // A panel symbol can be attached directly to a circuit that carries nested
  // protections even when its own protection has been removed. It still needs a
  // reserved column beside the secondary bus so the panel name clears the first
  // nested protection label. Without nested circuits there is no secondary bus
  // (a direct main-bus feeder, or a panel feeder nested next to siblings).
  if (
    (circuit.subCircuitIds?.length ?? 0) > 0 &&
    circuit.endpoints.some((endpoint) => endpoint.symbol === 'panel_distribution')
  ) {
    return true
  }

  if (!protection?.subPanelId || (circuit.subCircuitIds?.length ?? 0) <= 1) return false

  const protectionCircuits = protection.circuits ?? []
  const explicitPanelCircuit = protectionCircuits.find((candidate) =>
    candidate.endpoints.some((endpoint) => endpoint.symbol === 'panel_distribution')
  )
  if (explicitPanelCircuit) return explicitPanelCircuit.id === circuit.id

  return protectionCircuits.length === 1 && protectionCircuits[0]?.id === circuit.id
}

/**
 * Find parent RCD for a circuit.
 *
 * An RCD/RCBO is only a "parent RCD" (grouping device with trunk) when it
 * groups multiple circuits. When it directly protects a single circuit
 * (acting like an MCB), it is NOT a parent RCD — it is treated as the
 * circuit's direct protection instead.
 *
 * Note on semantics: the lookup returns the first RCD/RCBO that lists this
 * circuit, then the ≤1-circuit filter is applied. If a later RCD/RCBO with
 * >1 circuits also references the same circuit, we still return null —
 * matching the original implementation exactly.
 */
export function findParentRcd(panel: Panel, circuit: Circuit): ProtectionDevice | null {
  const first = getPanelLookups(panel).firstRcdByCircuitId.get(circuit.id)
  if (!first) return null
  const groupedCircuits = (first.circuits ?? []).filter(
    (candidate) => !isPanelOnlySubPanelFeeder(first, candidate)
  )
  if (groupedCircuits.length <= 1) return null
  return first
}

/**
 * Find parent circuit for a nested circuit (using subCircuitIds)
 */
export function findParentCircuit(panel: Panel, circuit: Circuit): Circuit | null {
  return getPanelLookups(panel).parentByCircuitId.get(circuit.id) ?? null
}

/**
 * Calculate trunk positions for RCDs
 * RCDs create: vertical line from main bus, RCD symbol on vertical part, then horizontal trunk above
 */
export function calculateTrunks(
  panel: Panel,
  circuitLayouts: BottomUpCircuitLayout[],
  mainBusY: number
): TrunkLayout[] {
  const trunks: TrunkLayout[] = []
  const rcdMap = new Map<string, ProtectionDevice>()

  // Find all RCDs that act as grouping devices (empty or 2+ real circuits).
  // A panel-only feeder transferred onto an RCD/RCBO after its own protection is
  // deleted is a visual attachment, not another protected circuit. It must not
  // turn the remaining direct protection into a grouping trunk.
  for (const protection of panel.protections) {
    const circuits = protection.circuits ?? []
    const groupedCircuits = circuits.filter(
      (circuit) => !isPanelOnlySubPanelFeeder(protection, circuit)
    )
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      (circuits.length === 0 || groupedCircuits.length > 1)
    ) {
      rcdMap.set(protection.id, protection)
    }
  }

  // Group circuits by RCD
  const rcdCircuits = new Map<string, Circuit[]>()
  for (const circuitLayout of circuitLayouts) {
    if (circuitLayout.parentRcd) {
      const rcdId = circuitLayout.parentRcd.id
      if (!rcdCircuits.has(rcdId)) {
        rcdCircuits.set(rcdId, [])
      }
      rcdCircuits.get(rcdId)!.push(circuitLayout.circuit)
    }
  }

  // Calculate trunk positions - RCD trunk is above the RCD symbol (lower Y)
  const rcdTrunkY = mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET

  for (const [rcdId, circuits] of rcdCircuits.entries()) {
    if (!rcdMap.has(rcdId)) continue

    // Find circuits under this RCD
    const rcdCircuitLayouts = circuitLayouts.filter((cl) => cl.parentRcd?.id === rcdId)
    if (rcdCircuitLayouts.length === 0) {
      // RCD with no circuits yet - still create trunk at a default position
      const minX =
        circuitLayouts.length > 0
          ? Math.min(...circuitLayouts.map((cl) => cl.x))
          : LAYOUT_CONSTANTS.LEFT_MARGIN
      const maxX =
        circuitLayouts.length > 0
          ? Math.max(...circuitLayouts.map((cl) => cl.x + cl.width))
          : LAYOUT_CONSTANTS.LEFT_MARGIN + 200
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: [],
      })
    } else {
      const minX = Math.min(...rcdCircuitLayouts.map((cl) => cl.x))
      const maxX = Math.max(...rcdCircuitLayouts.map((cl) => cl.x + cl.width))
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: circuits,
      })
    }
  }

  // Also create trunks for RCDs with 0 circuits
  for (const rcdId of rcdMap.keys()) {
    if (!rcdCircuits.has(rcdId)) {
      // RCD with no circuits - create trunk at default position
      const minX =
        circuitLayouts.length > 0
          ? Math.min(...circuitLayouts.map((cl) => cl.x))
          : LAYOUT_CONSTANTS.LEFT_MARGIN
      const maxX =
        circuitLayouts.length > 0
          ? Math.max(...circuitLayouts.map((cl) => cl.x + cl.width))
          : LAYOUT_CONSTANTS.LEFT_MARGIN + 200
      trunks.push({
        id: `trunk-${rcdId}`,
        protectionId: rcdId,
        x: minX - LAYOUT_CONSTANTS.TRUNK_PADDING,
        y: rcdTrunkY,
        width: maxX - minX + LAYOUT_CONSTANTS.TRUNK_PADDING * 2,
        circuits: [],
      })
    }
  }

  return trunks
}

/**
 * Calculate branch layouts for endpoint chains.
 *
 * The behavior-bearing sub-passes live in pure layout modules; this wrapper
 * applies the returned secondary-bus assignments to the mutable panel layout
 * objects used by the rest of this legacy layout pipeline.
 */
export function calculateBranches(
  circuitLayouts: BottomUpCircuitLayout[],
  trunks: TrunkLayout[],
  mainBusY: number,
  panel?: Panel
): BranchLayout[] {
  const branchPassConstants: BranchPassConstants = {
    BRANCH_LEAD_IN: LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
    BRANCH_START_OFFSET: LAYOUT_CONSTANTS.BRANCH_START_OFFSET,
    ENDPOINT_BRANCH_SPACING: LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
    ENDPOINT_HORIZONTAL_SPACING: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    APPLIANCE_AFTER_SOCKET_GAP: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
    MCB_Y_OFFSET: LAYOUT_CONSTANTS.MCB_Y_OFFSET,
    RCD_TRUNK_OFFSET: LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET,
    SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: LAYOUT_CONSTANTS.SECONDARY_BUS_ABOVE_ENDPOINTS_GAP,
    TRUNK_DEVICE_MCB_GAP: LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP,
    TRUNK_DEVICE_SPACING: LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING,
    SYMBOL_SIZE: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    PROTECTION_WIDTH: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    DOMOTICA_MAX_ENDPOINT_OUTPUTS,
    DOMOTICA_OUTPUT_SPACING,
  }
  const result = calculateBranchLayoutPass(
    circuitLayouts,
    trunks,
    mainBusY,
    panel,
    branchPassConstants
  )
  applySecondaryBusAssignmentsToCircuitLayouts(circuitLayouts, result.secondaryBusYByCircuitId)
  return result.branches
}

export function applySecondaryBusAssignmentsToCircuitLayouts(
  circuitLayouts: BottomUpCircuitLayout[],
  secondaryBusYByCircuitId: Map<string, number>
): void {
  for (const circuitLayout of circuitLayouts) {
    const secondaryBusY = secondaryBusYByCircuitId.get(circuitLayout.circuit.id)
    if (secondaryBusY != null) {
      circuitLayout.secondaryBusY = secondaryBusY
    }
  }
}

/**
 * Calculate bottom-up layout for a single panel
 * All positions are calculated in LOCAL coordinates (relative to panel origin)
 * frameOffset is applied automatically at the end
 */
export function getProtectionLabelXOffset(protection: ProtectionDevice): number {
  return protection.type === 'SPD'
    ? SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK
    : PROTECTION_LABEL_X_OFFSET_FROM_MCB
}

export function getProtectionLabelYOffset(protection: ProtectionDevice): number {
  return protection.type === 'SPD' ? SPD_PROTECTION_LABEL_Y_OFFSET : 0
}

export function getCircuitColumnEnvelope(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  config: CircuitEnvelopeConfig,
  memo: Map<string, CircuitLayoutEnvelope>
): CircuitLayoutEnvelope {
  return measureCircuitLayoutEnvelope(
    circuit,
    circuitMap,
    protectionByCircuitId,
    config,
    hasPanelAttachmentOnSecondaryBus,
    memo
  )
}

export function getCircuitLeftReserve(envelope: CircuitLayoutEnvelope): number {
  const baseHalfWidth =
    Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE) / 2
  return Math.max(0, -envelope.left - baseHalfWidth)
}

/**
 * Insert a layout row for `nested` under `parentCircuit` when the parent already has one.
 * Returns false when the child is already laid out or the parent layout is missing.
 */
export function pushNestedCircuitLayout(
  panel: Panel,
  panelCircuits: Circuit[],
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  envelopeConfig: CircuitEnvelopeConfig,
  envelopeMemo: Map<string, CircuitLayoutEnvelope>,
  circuitLayouts: BottomUpCircuitLayout[],
  nested: Circuit,
  parentCircuit: Circuit
): boolean {
  if (circuitLayouts.some((cl) => cl.circuit.id === nested.id)) {
    return false
  }

  const parentLayout = circuitLayouts.find((cl) => cl.circuit.id === parentCircuit.id)
  if (!parentLayout) {
    return false
  }

  const nestedProtection = findProtectionForCircuit(panel, nested)
  const nestedParentRcd = findParentRcd(panel, nested)
  const nestedEnvelope = getCircuitColumnEnvelope(
    nested,
    circuitMap,
    protectionByCircuitId,
    envelopeConfig,
    envelopeMemo
  )
  const nestedLeftReserve = getCircuitLeftReserve(nestedEnvelope)
  const nestedCircuitWidth = nestedEnvelope.right - nestedEnvelope.left
  const allNestedCircuits = (parentCircuit.subCircuitIds || [])
    .map((id) => panelCircuits.find((c) => c.id === id))
    .filter((c): c is Circuit => c !== undefined)
  const hasSingleNested = allNestedCircuits.length === 1
  let nestedX: number
  if (hasSingleNested) {
    nestedX =
      parentLayout.x +
      getProtectionAnchorOffset(parentLayout.leftReserve) -
      getProtectionAnchorOffset(nestedLeftReserve)
  } else {
    const parentEnvelope = getCircuitColumnEnvelope(
      parentCircuit,
      circuitMap,
      protectionByCircuitId,
      envelopeConfig,
      envelopeMemo
    )
    const parentAnchorX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
    const nestedAnchorOffset = parentEnvelope.nestedAnchorOffsets.get(nested.id) ?? 0
    nestedX = parentAnchorX + nestedAnchorOffset - getProtectionAnchorOffset(nestedLeftReserve)
  }

  circuitLayouts.push({
    circuit: nested,
    protection: nestedProtection,
    parentRcd: nestedParentRcd,
    parentCircuit,
    x: nestedX,
    width: nestedCircuitWidth,
    leftReserve: nestedLeftReserve,
    ...(nestedEnvelope.columnAnchorOffsets ? { columnAnchorOffsets: nestedEnvelope.columnAnchorOffsets } : {}),
    protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
    trunkY: undefined,
    branch: null,
    secondaryBusY: undefined,
  })
  return true
}

/**
 * Recovery pass for nested circuits whose parent layout was created later in the walk
 * (e.g. main-bus row demoted onto another circuit's secondary bus, then a grandchild on
 * that row's trunk). Without this, deep nesting can exist in data but not render.
 */
export function ensureDescendantNestedCircuitLayouts(
  panel: Panel,
  panelCircuits: Circuit[],
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  envelopeConfig: CircuitEnvelopeConfig,
  envelopeMemo: Map<string, CircuitLayoutEnvelope>,
  circuitLayouts: BottomUpCircuitLayout[]
): void {
  let changed = true
  while (changed) {
    changed = false
    for (const nested of panelCircuits) {
      const parentCircuit = findParentCircuit(panel, nested)
      if (!parentCircuit) continue
      if (
        pushNestedCircuitLayout(
          panel,
          panelCircuits,
          circuitMap,
          protectionByCircuitId,
          envelopeConfig,
          envelopeMemo,
          circuitLayouts,
          nested,
          parentCircuit
        )
      ) {
        changed = true
      }
    }
  }
}
