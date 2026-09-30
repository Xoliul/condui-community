/**
 * Collect visual drop-zone hint positions for the active library symbol.
 * Uses layout-tree hit zones filtered by per-symbol validTargets from dropBehaviors.
 */

import {
  canDropSymbolOnSupplyConverterDcWire,
  dropBehaviors,
  isEmptyProtectionCircuitForDcDrop,
} from '@/handlers/eendraad/dropBehaviors'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import { getEndpointTypeFromSymbol } from '@/utils'
import {
  resolveSymbolPortsForWire,
  symbolSupportsWireDomain,
  type SymbolMetadata,
} from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getHitZoneBounds } from '@/lib/layout/findDropTarget'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import type { Circuit, Endpoint, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getDirectConverterChangeoverInsertIndex,
  panelHasPopulatedDirectConverterBackup,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import { findSameSymbolAddMoreLayoutTargets } from '@/lib/eendraad/sameSymbolAddMore'
import { isPanelAttachmentDropTargetTerminal } from '@/lib/eendraad/panelAttachmentMove'
import {
  circuitAcceptsTrunkSwitch,
  circuitHasBranchContent,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import {
  findOrdinaryCircuitDcBusForOutput,
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'

export interface DropZoneHintMatch {
  panelId?: string
  busSectionId?: string
  endpointId?: string
  supplyFeedScope?: 'shared' | 'root'
  supplyPanelInput?: boolean
  supplyDeviceInsertIndex?: number
  supplyConverterDcBranch?: 'right' | 'top'
  supplyConverterDcConnectionIndex?: number
  converterGridPlacement?: 'inline' | 'input-leg'
  changeoverGridPlacement?: 'inline' | 'input-leg'
  circuitId?: string
  protectionId?: string
  /** Marks the terminal continuation above an empty circuit nest. */
  insertAfterCircuitContent?: boolean
  mainBusInsertIndex?: number
  secondaryBusInsertIndex?: number
  /** Vertical trunk insertion slot (aligns with DropTarget.circuitTrunkSegmentIndex). */
  circuitTrunkSegmentIndex?: number
  converterDcConnection?: { converterId: string; connectionIndex: number }
  dcBusId?: string
  branchDeviceInsertIndex?: number
  supplyDcBusId?: string
  supplyDcBusBranchId?: string
}

export interface DropZoneHint {
  nodeId: string
  x: number
  y: number
  targetType: NonNullable<DropTarget['type']>
  match?: DropZoneHintMatch
  /** Domain element represented by a same-symbol multiplier target. */
  sameSymbolTargetId?: string
  /** Exact Y coordinate where a secondary bus would be created by this drop. */
  secondaryBusPreviewY?: number
  outline?: {
    x: number
    y: number
    width: number
    height: number
    cornerRadius: number
  }
}

export interface DropZoneHintRelocation {
  elementId: string
  supply?: {
    panelId?: string
    feedScope: 'shared' | 'root'
    index: number
    supplyPath?: TrunkDevice['supplyPath']
    supplyConverterDcConnectionIndex?: number
    converterGridPlacement?: TrunkDevice['converterGridPlacement']
    changeoverGridPlacement?: TrunkDevice['changeoverGridPlacement']
    /** The dragged device owns a DC distribution subtree, rather than belonging to one. */
    dcBusRoot?: boolean
  }
  circuitTrunk?: {
    circuitId: string
    index: number
    converterDcConnection?: TrunkDevice['converterDcConnection']
    dcBusRoot?: boolean
  }
  protectionBus?:
    | { kind: 'main'; panelId: string; index: number }
    | { kind: 'secondary'; panelId: string; parentCircuitId: string; index: number }
}

/** Keep relocation markers within the topology the dragged object can actually preserve. */
export function isRelocationDropZoneHintCompatible(
  hint: DropZoneHint,
  relocation: DropZoneHintRelocation | null | undefined
): boolean {
  if (!relocation) return true

  if (relocation.supply?.dcBusRoot) {
    return (
      hint.targetType === 'supplyConverterDcWire' &&
      !hint.match?.supplyDcBusId &&
      (hint.match?.supplyConverterDcConnectionIndex ??
        (hint.match?.supplyConverterDcBranch === 'top' ? 1 : 0)) === 0 &&
      (!relocation.supply.panelId || hint.match?.panelId === relocation.supply.panelId)
    )
  }

  if (relocation.circuitTrunk?.dcBusRoot) {
    return (
      hint.targetType === 'circuit' &&
      hint.match?.circuitId === relocation.circuitTrunk.circuitId &&
      !!hint.match.converterDcConnection
    )
  }

  return true
}

function supplyHintMatchesSourceLane(
  hint: DropZoneHint,
  supply: NonNullable<DropZoneHintRelocation['supply']>
): boolean {
  const path = supply.supplyPath
  if (path === 'converter-dc' || path === 'converter-dc-top') {
    return (
      hint.targetType === 'supplyConverterDcWire' &&
      hint.match?.supplyConverterDcBranch === (path === 'converter-dc-top' ? 'top' : 'right') &&
      (hint.match?.supplyConverterDcConnectionIndex ?? (path === 'converter-dc-top' ? 1 : 0)) ===
        (supply.supplyConverterDcConnectionIndex ?? (path === 'converter-dc-top' ? 1 : 0))
    )
  }
  if (path === 'converter-grid') {
    return (
      hint.targetType === 'supplyConverterGridWire' &&
      (hint.match?.converterGridPlacement ?? 'inline') ===
        (supply.converterGridPlacement ?? 'inline')
    )
  }
  if (path === 'backup-output') {
    return hint.targetType === 'supplyBackupWire' || hint.targetType === 'supplyBackupOutputWire'
  }
  if (path === 'changeover-grid') {
    return (
      hint.targetType === 'supplyChangeoverGridWire' &&
      (hint.match?.changeoverGridPlacement ?? 'inline') ===
        (supply.changeoverGridPlacement ?? 'inline')
    )
  }
  return hint.targetType === 'supplyWire'
}

/** Hide relocation targets that cannot change the existing topology. */
export function isRelocationNoOpDropZoneHint(
  hint: DropZoneHint,
  relocation: DropZoneHintRelocation | null | undefined
): boolean {
  if (!relocation) return false
  if (hint.sameSymbolTargetId === relocation.elementId) return true

  const supply = relocation.supply
  if (supply && supplyHintMatchesSourceLane(hint, supply)) {
    const samePanel = !supply.panelId || hint.match?.panelId === supply.panelId
    const sameScope = (hint.match?.supplyFeedScope ?? 'shared') === supply.feedScope
    const insertIndex = hint.match?.supplyDeviceInsertIndex
    if (
      samePanel &&
      sameScope &&
      typeof insertIndex === 'number' &&
      (insertIndex === supply.index || insertIndex === supply.index + 1)
    ) {
      return true
    }
  }

  const circuitTrunk = relocation.circuitTrunk
  if (
    circuitTrunk &&
    hint.targetType === 'circuit' &&
    hint.match?.circuitId === circuitTrunk.circuitId &&
    typeof hint.match.circuitTrunkSegmentIndex === 'number' &&
    (hint.match.circuitTrunkSegmentIndex === circuitTrunk.index ||
      hint.match.circuitTrunkSegmentIndex === circuitTrunk.index + 1)
  ) {
    return true
  }

  const protectionBus = relocation.protectionBus
  if (!protectionBus) return false
  if (protectionBus.kind === 'main') {
    return Boolean(
      hint.targetType === 'mainBus' &&
      hint.match?.panelId === protectionBus.panelId &&
      typeof hint.match.mainBusInsertIndex === 'number' &&
      (hint.match.mainBusInsertIndex === protectionBus.index ||
        hint.match.mainBusInsertIndex === protectionBus.index + 1)
    )
  }
  return Boolean(
    hint.targetType === 'circuit' &&
    hint.match?.panelId === protectionBus.panelId &&
    hint.match.circuitId === protectionBus.parentCircuitId &&
    typeof hint.match.secondaryBusInsertIndex === 'number' &&
    (hint.match.secondaryBusInsertIndex === protectionBus.index ||
      hint.match.secondaryBusInsertIndex === protectionBus.index + 1)
  )
}

interface HintWalkContext {
  panelId: string
  circuitId?: string
  panelIsMain?: boolean
}

const PROTECTION_DRAG_SYMBOL_IDS = new Set<string>(PROTECTION_SYMBOL_IDS)

// These symbols can be inserted into a circuit trunk. Conversion symbols are
// also valid endpoint drops: on a branch they are static devices, so do not
// classify them as trunk-only.
const CIRCUIT_TRUNK_INSERTABLE_SYMBOLS = new Set([
  'energy_meter',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])
const ENERGY_CONVERSION_SYMBOLS = new Set([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

// Energy meters remain in-between branch devices. Conversion devices have a
// branch-local domain boundary and therefore need the static endpoint path.
const TRUNK_ONLY_ON_CIRCUIT_SYMBOLS = new Set(['energy_meter'])

const TRUNK_CAPABLE_ENDPOINT_SYMBOLS = new Set(['junction_box', 'junction_panel', 'terminal_strip'])

function isProtectionDragSymbol(symbol: SymbolMetadata): boolean {
  return PROTECTION_DRAG_SYMBOL_IDS.has(symbol.id)
}

function isEndpointDragSymbol(symbol: SymbolMetadata): boolean {
  return !!getEndpointTypeFromSymbol(symbol)
}

function isDcBusEndpointSymbol(symbol: SymbolMetadata): boolean {
  return symbol.id === 'solar_panel' || symbol.id === 'battery' || symbol.id === 'domotica'
}

function findCircuitInProject(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): Circuit | undefined {
  const stack: Panel[] = [...getProjectElectricalPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    const direct = panel.circuits?.find((c) => c.id === circuitId)
    if (direct) return direct
    for (const protection of panel.protections ?? []) {
      const underProtection = protection.circuits?.find((c) => c.id === circuitId)
      if (underProtection) return underProtection
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return undefined
}

function circuitWouldGainSecondaryBus(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): boolean {
  return findCircuitInProject(project, circuitId)?.subCircuitIds?.length === 1
}

function circuitFeedsSubPanel(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): boolean {
  const stack: Panel[] = [...getProjectElectricalPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.subPanelId && protection.circuits?.some((c) => c.id === circuitId)) {
        return true
      }
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

function isDcOnlyEndpointDragSymbol(symbol: SymbolMetadata): boolean {
  return symbol.id === 'solar_panel' || symbol.id === 'battery'
}

function findProtectionForCircuit(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): ProtectionDevice | undefined {
  const stack = [...getProjectElectricalPanels(project)]
  while (stack.length > 0) {
    const panel = stack.pop()!
    const protection = panel.protections?.find((candidate) =>
      candidate.circuits?.some((circuit) => circuit.id === circuitId)
    )
    if (protection) return protection
    stack.push(...(panel.subPanels ?? []))
  }
  return undefined
}

function isEmptyProtectionCircuitHintForDcDrop(
  node: LayoutNode,
  ctx: HintWalkContext,
  hitType: NonNullable<DropTarget['type']>,
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical
): boolean {
  if (!isDcOnlyEndpointDragSymbol(symbol) || hitType !== 'circuit' || !ctx.circuitId) {
    return false
  }
  const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
  const isFirstTrunkSegment = parsed?.circuitId === ctx.circuitId && parsed.segmentIndex === 0
  const isEmptyCircuitNest = node.id === `circuit-nest-${ctx.circuitId}`
  if (!isFirstTrunkSegment && !isEmptyCircuitNest) return false

  const protection = findProtectionForCircuit(project, ctx.circuitId)
  return protection != null && isEmptyProtectionCircuitForDcDrop(protection)
}

/** Resolve the domain represented by a visual endpoint/branch drop zone. */
function getHintWireDomain(
  node: LayoutNode,
  ctx: HintWalkContext,
  project: ProjectWithOptionalV2Electrical
): 'AC' | 'DC' {
  if (node.hitZone?.wireDomain) return node.hitZone.wireDomain
  if (
    node.hitZone?.converterDcConnection ||
    node.hitZone?.dcBusId ||
    node.hitZone?.supplyDcBusId ||
    node.hitZone?.type === 'supplyConverterDcWire'
  ) {
    return 'DC'
  }
  if (!ctx.circuitId) return 'AC'

  const circuit = findCircuitInProject(project, ctx.circuitId)
  if (!circuit) return 'AC'

  let domain: 'AC' | 'DC' = circuit.dcBusSource ? 'DC' : 'AC'
  const branchIndex = getCircuitBranches(circuit).findIndex((branch) =>
    branch.some((endpoint) => endpoint.id === node.domainId ||
      (node.type === 'branch' && node.children.some((child) => child.domainId === endpoint.id))))
  const trunkDevices = (circuit.trunkDevices ?? []).filter((device) =>
    branchIndex < 0 || (device.trunkPosition ?? 0) <= branchIndex).sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )
  for (const device of trunkDevices) {
    // Multi-port converters expose dedicated DC lanes; the ordinary trunk remains
    // the converter's AC input side and must not be treated as DC.
    if (
      supportsCircuitConverterDcConnections(device) &&
      getCircuitConverterDcConnectionCount(device) > 1
    ) {
      continue
    }
    const resolved = resolveSymbolPortsForWire(device.symbol, domain)
    if (resolved.matched && resolved.oppositePortDomain) {
      domain = resolved.oppositePortDomain
    }
  }

  // Endpoint hit zones are placed on the branch itself, so include the endpoint
  // symbols upstream of the hovered endpoint (for an inline rectifier/converter).
  // A branch-level hit zone represents the end of that branch; include all of
  // its endpoint symbols so a DC-only drop remains available after an inline
  // inverter/rectifier instead of being hidden as an AC target.
  const domoticaEndpoint = circuit.endpoints.find((endpoint) => endpoint.id === node.domainId)
  if (domoticaEndpoint && (domoticaEndpoint.domoticaChildProps || node.hitZone?.outputGroup)) {
    const input = getDomoticaEndpointInputDomain(circuit, domoticaEndpoint.id, domain)
    if (node.hitZone?.outputGroup || node.hitZone?.domoticaChildDropIntent === 'insertBefore') return input
    if (!domoticaEndpoint.symbol) return input
    const resolved = resolveSymbolPortsForWire(domoticaEndpoint.symbol, input)
    return resolved.matched ? (resolved.oppositePortDomain ?? input) : input
  }
  const branchEndpointIds =
    node.type === 'branch'
      ? new Set(
          node.children
            .filter((child) => child.type === 'endpoint' && child.domainId)
            .map((child) => child.domainId as string)
        )
      : null
  const targetEndpointId = node.type === 'endpoint' ? node.domainId : undefined
  if (targetEndpointId || branchEndpointIds?.size) {
    const branch = getCircuitBranches(circuit).find((candidate) =>
      targetEndpointId
        ? candidate.some((endpoint) => endpoint.id === targetEndpointId)
        : candidate.some((endpoint) => branchEndpointIds?.has(endpoint.id))
    )
    for (const endpoint of branch ?? []) {
      if (!endpoint.symbol) {
        if (endpoint.id === targetEndpointId) break
        continue
      }
      const resolved = resolveSymbolPortsForWire(endpoint.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
      if (endpoint.id === targetEndpointId) break
    }
  }

  return domain
}

function hintCenter(node: LayoutNode): { x: number; y: number } {
  const bounds = getHitZoneBounds(node, 'core')
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  }
}

function parseCircuitTrunkSegmentId(
  nodeId: string
): { circuitId: string; segmentIndex: number } | null {
  const match = nodeId.match(/^circuit-trunk-(.+)-segment-(\d+)$/)
  if (!match) return null
  return {
    circuitId: match[1]!,
    segmentIndex: Number.parseInt(match[2]!, 10),
  }
}

/** Highest segment index + 1 per circuit (from layout-tree trunk wire nodes). */
function buildTrunkSegmentCountByCircuit(layoutTree: LayoutTree): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (node: LayoutNode) => {
    const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
    if (parsed) {
      counts.set(
        parsed.circuitId,
        Math.max(counts.get(parsed.circuitId) ?? 0, parsed.segmentIndex + 1)
      )
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const panel of layoutTree.panels) {
    visit(panel)
  }
  return counts
}

function isLastCircuitTrunkSegment(
  nodeId: string,
  trunkSegmentCounts: Map<string, number>
): boolean {
  const parsed = parseCircuitTrunkSegmentId(nodeId)
  if (!parsed) return false
  const count = trunkSegmentCounts.get(parsed.circuitId) ?? 0
  return count > 0 && parsed.segmentIndex === count - 1
}

function circuitHasTrunkBranchContent(circuit: Circuit | undefined): boolean {
  if (!circuit) return false
  return getCircuitBranches(circuit).some((branch) => branch.length > 0)
}

/**
 * Legal trunk insertion indices for energy conversion / meters.
 * Matches drop reordering: one slot per trunk device gap, plus an extra top slot when
 * branches already occupy the trunk so the open wire above them is still droppable.
 */
function trunkInsertionSlotCount(circuit: Circuit | undefined): number {
  const deviceCount = circuit?.trunkDevices?.length ?? 0
  const extraTopSlot = circuitHasTrunkBranchContent(circuit) ? 1 : 0
  return deviceCount + 1 + extraTopSlot
}

type LastTrunkSegmentInfo = {
  nodeId: string
  bounds: LayoutNode['bounds']
  segmentIndex: number
}

function collectLastTrunkSegmentByCircuit(
  layoutTree: LayoutTree
): Map<string, LastTrunkSegmentInfo> {
  const map = new Map<string, LastTrunkSegmentInfo>()
  const visit = (node: LayoutNode) => {
    const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
    if (parsed && node.type === 'wire' && node.hitZone?.type === 'circuit') {
      const existing = map.get(parsed.circuitId)
      if (!existing || parsed.segmentIndex > existing.segmentIndex) {
        map.set(parsed.circuitId, {
          nodeId: node.id,
          bounds: node.bounds,
          segmentIndex: parsed.segmentIndex,
        })
      }
    }
    for (const child of node.children) visit(child)
  }
  for (const panel of layoutTree.panels) visit(panel)
  return map
}

function appendTrunkTopSlotHints(
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  layoutTree: LayoutTree,
  trunkSegmentCounts: Map<string, number>,
  hints: HintWithSpan[]
): void {
  if (
    !CIRCUIT_TRUNK_INSERTABLE_SYMBOLS.has(symbol.id) &&
    !TRUNK_CAPABLE_ENDPOINT_SYMBOLS.has(symbol.id)
  )
    return

  const lastSegmentByCircuit = collectLastTrunkSegmentByCircuit(layoutTree)
  const existingSlots = new Set<string>()
  for (const hint of hints) {
    const circuitId = hint.match?.circuitId
    const seg = hint.match?.circuitTrunkSegmentIndex
    if (circuitId != null && typeof seg === 'number') {
      existingSlots.add(`${circuitId}|${seg}`)
    }
  }

  for (const [circuitId, segmentCount] of trunkSegmentCounts) {
    if (segmentCount <= 0) continue
    const circuit = findCircuitInProject(project, circuitId)
    if (circuitFeedsSubPanel(project, circuitId)) continue
    if (hints.some((hint) => hint.match?.circuitId === circuitId && hint.match.insertAfterCircuitContent)) continue

    const slotCount = trunkInsertionSlotCount(circuit)
    const last = lastSegmentByCircuit.get(circuitId)
    if (!last) continue

    for (let slot = segmentCount; slot < slotCount; slot++) {
      const key = `${circuitId}|${slot}`
      if (existingSlots.has(key)) continue

      const bounds = last.bounds
      hints.push({
        nodeId: `circuit-trunk-${circuitId}-slot-${slot}`,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + 8,
        targetType: 'circuit',
        match: {
          circuitId,
          circuitTrunkSegmentIndex: slot,
        },
        span: Math.max(bounds.width, bounds.height),
      })
      existingSlots.add(key)
    }
  }
}

/** Horizontal offset of the chain-slot hint from the HVAC source's right edge. */
const VENTILATION_AFTER_HVAC_GAP = 22

/**
 * Ventilation units can be chained immediately after an HVAC source (furnace/heat pump).
 * Surface a dedicated dashed-circle hint just to the right of each furnace endpoint so the
 * chain slot is discoverable while dragging a ventilation symbol from the library.
 */
function appendVentilationAfterHvacSourceHints(
  symbol: SymbolMetadata,
  layoutTree: LayoutTree,
  hints: DropZoneHint[]
): void {
  if (symbol.id !== 'ventilation') return
  const visit = (node: LayoutNode) => {
    if (node.type === 'endpoint') {
      const endpoint = node.domainRef as Endpoint | undefined
      if (endpoint?.symbol === 'furnace') {
        const bounds = getHitZoneBounds(node, 'core')
        hints.push({
          nodeId: `ventilation-after-hvac-${endpoint.id}`,
          x: bounds.right + VENTILATION_AFTER_HVAC_GAP,
          y: (bounds.top + bounds.bottom) / 2,
          targetType: 'endpoint',
        })
      }
    }
    node.children.forEach(visit)
  }
  layoutTree.panels.forEach(visit)
}

function hintAnchor(node: LayoutNode): { x: number; y: number } {
  if (node.hitZone?.dropHintAnchor) return node.hitZone.dropHintAnchor
  const bounds = getHitZoneBounds(node, 'core')
  if (node.id?.startsWith('circuit-nest-') || node.id?.startsWith('circuit-trunk-')) {
    // For the topmost trunk segment (index 0) used as an endpoint "add branch" hint,
    // float the dot above the trunk wire so it's visually distinct.
    const isTopSegment = node.id?.match(/circuit-trunk-.+-segment-0$/)
    return {
      x: (bounds.left + bounds.right) / 2,
      y: isTopSegment ? bounds.top - 20 : bounds.top + 8,
    }
  }
  if (node.type === 'branch') {
    return {
      x: bounds.left + 14,
      y: (bounds.top + bounds.bottom) / 2,
    }
  }
  return hintCenter(node)
}

function hintSpan(node: LayoutNode): number {
  const bounds = getHitZoneBounds(node, 'core')
  return Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top)
}

function hasChildMatching(node: LayoutNode, predicate: (child: LayoutNode) => boolean): boolean {
  return node.children.some(predicate)
}

function shouldSkipContainerNode(node: LayoutNode): boolean {
  if (node.type === 'busBar' && node.hitZone?.type === 'mainBus') {
    return hasChildMatching(node, (c) => c.id?.startsWith('main-bus-segment-') === true)
  }
  if (node.type === 'secondaryBus') {
    return hasChildMatching(node, (c) => c.id?.startsWith('secondary-bus-segment-') === true)
  }
  if (node.type === 'trunkDevice' && node.hitZone?.dcBusId) {
    return hasChildMatching(node, (c) => c.id?.startsWith('secondary-bus-segment-') === true)
  }
  return false
}

function supplySegmentSuffix(nodeId: string, panelKey: string): string | null {
  const prefix = `supply-wire-segment-${panelKey}-`
  if (!nodeId.startsWith(prefix)) return null
  return nodeId.slice(prefix.length)
}

function isSupplyWireSlotSegment(node: LayoutNode, panelNode: LayoutNode): boolean {
  if (node.type !== 'wire' || node.hitZone?.type !== 'supplyWire') return false

  const id = node.id ?? ''
  if (id.startsWith('supply-wire-feed-stub-')) return true
  if (id.startsWith('supply-changeover-load-slot-')) return true
  // Every segment of the grid source run after a modular changeover remains an ordinary
  // serial supply insertion slot. This includes the span before an existing protection;
  // when the inverter grid leg is absent, that span is the otherwise-empty visible slot.
  if (id.startsWith('supply-changeover-grid-slot-')) return true
  const panelKey = panelNode.diagramId ?? panelNode.domainId ?? panelNode.id
  if (id.includes('supply-wire-vertical')) return false

  const hasHorizontalSegments = panelNode.children.some((c) =>
    c.id?.startsWith(`supply-wire-segment-${panelKey}-`)
  )

  const suffix = supplySegmentSuffix(id, panelKey)
  if (suffix != null) {
    if (suffix === 'stub-root' || suffix === 'stub-shared' || suffix === 'handoff') return true
    if (suffix === 'entry-root' || suffix === 'entry-shared') return false
    if (suffix.endsWith('-root') || suffix.endsWith('-shared')) return false
    return suffix === 'entry' || /^\d+$/.test(suffix) || suffix === 'supply' || suffix === 'stub'
  }

  if (!hasHorizontalSegments && id === `supply-wire-${panelKey}`) {
    return true
  }

  return false
}

function buildHintMatch(
  node: LayoutNode,
  hitType: NonNullable<DropTarget['type']>,
  ctx: HintWalkContext
): DropZoneHintMatch | undefined {
  if (
    hitType === 'supplyWire' ||
    hitType === 'supplyBackupWire' ||
    hitType === 'supplyBackupOutputWire' ||
    hitType === 'supplyChangeoverGridWire' ||
    hitType === 'supplyConverterGridWire' ||
    hitType === 'supplyConverterBackupWire' ||
    hitType === 'supplyConverterDcWire'
  ) {
    return {
      panelId: node.hitZone?.supplyPanelId ?? ctx.panelId,
      busSectionId: node.hitZone?.busSectionId,
      supplyFeedScope: node.hitZone?.supplyFeedScope ?? 'shared',
      supplyPanelInput: node.hitZone?.supplyPanelInput,
      supplyDeviceInsertIndex: node.hitZone?.supplyInsertIndex,
      supplyConverterDcBranch: node.hitZone?.supplyConverterDcBranch,
      supplyConverterDcConnectionIndex: node.hitZone?.supplyConverterDcConnectionIndex,
      converterDcConnection: node.hitZone?.converterDcConnection,
      converterGridPlacement: node.hitZone?.converterGridPlacement,
      changeoverGridPlacement: node.hitZone?.changeoverGridPlacement,
      supplyDcBusId: node.hitZone?.supplyDcBusId,
      supplyDcBusBranchId: node.hitZone?.supplyDcBusBranchId,
    }
  }
  if (hitType === 'endpoint') {
    return {
      panelId: ctx.panelId,
      circuitId: ctx.circuitId,
      endpointId: node.domainId,
    }
  }
  if (hitType === 'mainBus' || hitType === 'circuit' || hitType === 'rcd') {
    const mainBusMatch = node.id?.match(/^main-bus-segment-.+-(\d+)$/)
    const secondaryBusMatch = node.id?.match(/^secondary-bus-segment-.+-(\d+)$/)
    return {
      panelId: ctx.panelId,
      circuitId: ctx.circuitId,
      ...(hitType === 'rcd' && node.domainId ? { protectionId: node.domainId } : {}),
      converterDcConnection: node.hitZone?.converterDcConnection,
      dcBusId: node.hitZone?.dcBusId,
      ...(typeof node.hitZone?.branchDeviceInsertIndex === 'number'
        ? { branchDeviceInsertIndex: node.hitZone.branchDeviceInsertIndex }
        : {}),
      ...(typeof node.hitZone?.mainBusInsertIndex === 'number'
        ? { mainBusInsertIndex: node.hitZone.mainBusInsertIndex }
        : mainBusMatch
          ? { mainBusInsertIndex: Number.parseInt(mainBusMatch[1]!, 10) }
          : {}),
      ...(secondaryBusMatch
        ? { secondaryBusInsertIndex: Number.parseInt(secondaryBusMatch[1]!, 10) }
        : {}),
    }
  }
  return ctx.panelId ? { panelId: ctx.panelId, circuitId: ctx.circuitId } : undefined
}

type HintWithSpan = DropZoneHint & { span: number }

/**
 * The centered split-feed geometry can expose two visual halves for one
 * insertion slot: the right half after one protection and the left half before
 * the next. Keep both hit zones for precise drop resolution, but show one
 * invitation marker for that shared main-bus slot.
 *
 * Empty split-feed rails are deliberately excluded. Both rails use index 0,
 * but their bus sections are different and each remains its own invitation.
 */
function dedupeMainBusHints(hints: DropZoneHint[]): DropZoneHint[] {
  const result: DropZoneHint[] = []
  const bySlot = new Map<string, { hint: DropZoneHint; count: number; resultIndex: number }>()

  for (const hint of hints) {
    const insertIndex = hint.match?.mainBusInsertIndex
    const canMerge =
      hint.targetType === 'mainBus' &&
      typeof insertIndex === 'number' &&
      !hint.nodeId.endsWith('-empty')

    if (!canMerge) {
      result.push(hint)
      continue
    }

    const key = `${hint.match?.panelId ?? ''}|${insertIndex}`
    const existing = bySlot.get(key)
    if (!existing) {
      bySlot.set(key, { hint, count: 1, resultIndex: result.length })
      result.push(hint)
      continue
    }

    existing.hint = {
      ...existing.hint,
      x: (existing.hint.x * existing.count + hint.x) / (existing.count + 1),
      y: (existing.hint.y * existing.count + hint.y) / (existing.count + 1),
    }
    existing.count += 1
    result[existing.resultIndex] = existing.hint
  }

  return result
}

function dedupeSupplyWireHints(hints: HintWithSpan[]): DropZoneHint[] {
  const supplyHints: HintWithSpan[] = []
  const otherHints: DropZoneHint[] = []

  for (const hint of hints) {
    if (hint.targetType === 'supplyWire') {
      supplyHints.push(hint)
    } else {
      otherHints.push(hint)
    }
  }

  const bestBySlot = new Map<string, HintWithSpan>()
  for (const hint of supplyHints) {
    const panelId = hint.match?.panelId ?? ''
    const scope = hint.match?.supplyFeedScope ?? 'shared'
    const index = hint.match?.supplyDeviceInsertIndex ?? 0
    const nestedConnection = hint.match?.converterDcConnection
    const stubInstance = hint.nodeId.startsWith('supply-wire-feed-stub-')
      ? hint.nodeId
      : ''
    const key = `${panelId}|${scope}|${index}|${hint.match?.supplyDcBusBranchId ?? ''}|${nestedConnection?.converterId ?? ''}|${nestedConnection?.connectionIndex ?? ''}|${stubInstance}`
    const existing = bestBySlot.get(key)
    if (!existing || hint.span > existing.span) {
      bestBySlot.set(key, hint)
    }
  }

  return [
    ...otherHints,
    ...[...bestBySlot.values()].map(({ nodeId, x, y, targetType, match }) => ({
      nodeId,
      x,
      y,
      targetType,
      match,
    })),
  ]
}

function shouldIncludeHintNode(
  node: LayoutNode,
  hitType: NonNullable<DropTarget['type']>,
  ctx: HintWalkContext,
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  panelNode: LayoutNode,
  trunkSegmentCounts: Map<string, number>
): boolean {
  if (shouldSkipContainerNode(node)) return false
  if (node.hitZone?.type !== hitType) return false
  if (symbol.id === 'panel_distribution') {
    if (hitType === 'mainBus' || hitType === 'rcd') return true
    if (hitType !== 'circuit') return false
    if (node.id?.startsWith('secondary-bus-segment-')) return true
    if (node.id !== `circuit-nest-${ctx.circuitId}` || !ctx.circuitId) return false
    return (findCircuitInProject(project, ctx.circuitId)?.subCircuitIds?.length ?? 0) === 0
  }
  const isEmptyProtectionDrop = isEmptyProtectionCircuitHintForDcDrop(
    node,
    ctx,
    hitType,
    symbol,
    project
  )
  if (
    node.hitZone.converterDcConnection &&
    !node.hitZone.dcBusId &&
    !symbolSupportsWireDomain(symbol.id, 'DC')
  ) {
    return false
  }
  if (
    isDcOnlyEndpointDragSymbol(symbol) &&
    hitType !== 'supplyConverterDcWire' &&
    !isEmptyProtectionDrop &&
    !node.hitZone?.dcBusId &&
    getHintWireDomain(node, ctx, project) !== 'DC'
  ) {
    return false
  }
  if (
    ENERGY_CONVERSION_SYMBOLS.has(symbol.id) &&
    !resolveSymbolPortsForWire(symbol.id, getHintWireDomain(node, ctx, project)).matched
  ) {
    return false
  }
  const isDcBusBranchSlot =
    !!node.hitZone?.dcBusId && typeof node.hitZone.branchDeviceInsertIndex === 'number'
  const isDcBusBranchProtection = isProtectionDragSymbol(symbol) && isDcBusBranchSlot
  if (node.hitZone.dcBusId) {
    const isDcBusConversionEndpoint = symbol.id === 'dc_dc_converter' || symbol.id === 'inverter'
    if (
      (!getEndpointTypeFromSymbol(symbol) &&
        !isDcBusConversionEndpoint &&
        !isDcBusBranchProtection) ||
      (!symbolSupportsWireDomain(symbol.id, 'DC') &&
        !isDcBusConversionEndpoint &&
        !isDcBusBranchProtection)
    ) {
      return false
    }
    if (isDcBusConversionEndpoint) {
      // Conversion devices are valid outgoing devices once a real supply DC
      // bus branch exists. They are still restricted to the ordinary circuit
      // trunk when the target is an inverter's unoccupied circuit output.
      return (
        hitType === 'circuit' ||
        (hitType === 'supplyConverterDcWire' && !!node.hitZone.supplyDcBusId)
      )
    }
    if (isDcBusBranchProtection) return hitType === 'circuit'
  }
  if (
    !node.hitZone.dcBusId &&
    (isDcBusEndpointSymbol(symbol) ||
      symbol.id === 'dc_dc_converter' ||
      symbol.id === 'inverter') &&
    ctx.circuitId
  ) {
    const circuit = findCircuitInProject(project, ctx.circuitId)
    if (circuit && findOrdinaryCircuitDcBusForOutput(circuit, node.hitZone.converterDcConnection)) {
      return false
    }
  }

  if (symbol.id === 'dc_bus') {
    if (hitType === 'supplyWire') {
      // A rail dropped on an ordinary root supply wire creates the first direct
      // inverter assembly. Once any supply assembly exists, the only valid rail
      // target is an unoccupied DC connection on that assembly.
      return (
        node.hitZone?.supplyFeedScope === 'root' &&
        selectProjectSupplyAssemblies(project).length === 0 &&
        !hasSupplyDcBusOnHintFeed(node, ctx, project)
      )
    }
    if (hitType === 'supplyConverterDcWire') {
      return (
        node.hitZone?.supplyFeedScope === 'root' &&
        (node.hitZone?.supplyConverterDcConnectionIndex ??
          (node.hitZone?.supplyConverterDcBranch === 'top' ? 1 : 0)) === 0 &&
        !node.hitZone.supplyDcBusId &&
        !hasSupplyDcBusOnHintFeed(node, ctx, project)
      )
    }
    if (hitType === 'circuit') {
      return isBareInverterCircuitDcConnection(node, ctx, project)
    }
    return false
  }

  if (hitType === 'supplyWire') {
    if (symbol.id === 'source_changeover' && node.hitZone?.supplyFeedScope !== 'root') {
      return false
    }
    if (
      symbol.id === 'source_changeover' &&
      panelHasPopulatedDirectConverterBackup(project, node.hitZone?.supplyPanelId ?? ctx.panelId)
    ) {
      return false
    }
    if (symbol.id === 'source_changeover') {
      const panelId = node.hitZone?.supplyPanelId ?? ctx.panelId
      const installation = getProjectElectricalInstallation(project)
      const panel = findPanelById(getProjectElectricalPanels(project), panelId)
      const acceptsAnyGridFeedSegment = Boolean(
        panel && getPanelFeedOrganization(project, panel) === 'split-backup'
      )
      const preferredInsertIndex = installation
        ? getDirectConverterChangeoverInsertIndex(
            getSupplyFeedDevicesForPanel(
              installation,
              getProjectElectricalPanels(project),
              panelId,
              'root'
            )
          )
        : null
      if (
        !acceptsAnyGridFeedSegment &&
        preferredInsertIndex !== null &&
        node.hitZone?.supplyInsertIndex !== preferredInsertIndex
      ) {
        return false
      }
    }
    if (node.type === 'trunkDevice' || node.type === 'supply') return false
    if (!isSupplyWireSlotSegment(node, panelNode)) return false
  }

  if (CIRCUIT_TRUNK_INSERTABLE_SYMBOLS.has(symbol.id)) {
    if (hitType === 'supplyWire') {
      return (
        (symbol.id === 'inverter' || symbol.id === 'rectifier') &&
        node.hitZone?.supplyFeedScope === 'root'
      )
    }
    if (node.id?.startsWith('circuit-nest-')) {
      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      return !!circuit && !(circuit.subCircuitIds?.length) && !circuitFeedsSubPanel(project, circuit.id)
    }
    if (node.id?.startsWith('circuit-trunk-') && hitType === 'circuit') return true
  }

  if (isProtectionDragSymbol(symbol)) {
    // A protection may be inserted inline on the converter-to-bus lead. Circuit
    // converter connection targets still require a real bus branch below.
    if (
      (hitType === 'supplyConverterDcWire' &&
        !canDropSymbolOnSupplyConverterDcWire(symbol.id, !!node.hitZone?.supplyDcBusId)) ||
      (hitType !== 'supplyConverterDcWire' &&
        node.hitZone?.converterDcConnection &&
        !node.hitZone?.dcBusId)
    ) {
      return false
    }
    if (hitType === 'protection') return false
    if (node.type === 'mcb' || node.type === 'rcd') return false
    if (hitType === 'circuit') {
      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      if (node.hitZone.dcBusId && typeof node.hitZone.branchDeviceInsertIndex === 'number') {
        return true
      }
      if (circuit?.supplySource?.kind === 'converter-backup') return false
      if (ctx.circuitId && circuitFeedsSubPanel(project, ctx.circuitId)) return false
      const hasJunctionPanelBoundary = (circuit?.trunkDevices ?? []).some(
        (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
      )
      if (hasJunctionPanelBoundary && symbol.id === 'rotating_switch' && node.type === 'branch') {
        return true
      }
      if (hasJunctionPanelBoundary && !node.id?.startsWith('circuit-trunk-')) return false
      if (node.type === 'branch' || node.type === 'trunkDevice') return false
      if (node.id?.startsWith('circuit-trunk-')) {
        const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
        const orderedDevices = [...(circuit?.trunkDevices ?? [])].sort(
          (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
        )
        if (
          parsed &&
          orderedDevices
            .slice(0, parsed.segmentIndex)
            .some(
              (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
            )
        ) {
          return false
        }
        return (circuit?.endpoints.length ?? 0) > 0 && parsed?.segmentIndex === 0
      }
      if (node.id?.startsWith('circuit-nest-')) return true
      if (node.id?.startsWith('secondary-bus-segment-')) {
        if (node.hitZone?.dcBusId) return true
        return (circuit?.subCircuitIds?.length ?? 0) >= 2
      }
      return false
    }
  }

  if (
    isCircuitTrunkSwitchSymbol(symbol.id) &&
    hitType === 'circuit' &&
    ctx.circuitId &&
    !node.hitZone.dcBusId &&
    !node.hitZone.converterDcConnection &&
    (node.id?.startsWith('circuit-trunk-') || node.id === `circuit-nest-${ctx.circuitId}`) &&
    circuitAcceptsTrunkSwitch(findCircuitInProject(project, ctx.circuitId)) &&
    !circuitFeedsSubPanel(project, ctx.circuitId)
  ) {
    // Low on the trunk wire: series trunk device. Nest zone above the
    // branches: a new branch, as for every other endpoint. An empty circuit
    // already shows its empty-branch marker for that, so skip the duplicate.
    return (
      node.id?.startsWith('circuit-trunk-') === true ||
      circuitHasBranchContent(findCircuitInProject(project, ctx.circuitId))
    )
  }

  if (isEndpointDragSymbol(symbol)) {
    if (hitType === 'protection') return false
    if (node.type === 'mcb' || node.type === 'rcd') return false
    if (node.id?.startsWith('secondary-bus-segment-') && !node.hitZone?.dcBusId) return false
    if (node.id?.startsWith('circuit-nest-')) return isEmptyProtectionDrop
    if (node.type === 'trunkDevice') return false

    if (node.id?.startsWith('circuit-trunk-')) {
      if (isEmptyProtectionDrop) return true
      if (TRUNK_CAPABLE_ENDPOINT_SYMBOLS.has(symbol.id)) return true
      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      if (
        isDcBusEndpointSymbol(symbol) &&
        node.hitZone?.wireDomain === 'AC' &&
        circuit?.trunkDevices?.some((device) => device.type === 'conversion')
      ) {
        // An explicit converter already owns the DC transition. Do not offer
        // the opposite-side AC trunk as a second auto-conversion drop lane.
        return false
      }
      if (isDcBusEndpointSymbol(symbol) && node.hitZone?.wireDomain === 'DC') {
        return isLastCircuitTrunkSegment(node.id, trunkSegmentCounts)
      }
      // Show the topmost trunk segment (index 0, just below the MCB) as an
      // "add new branch here" hint for endpoints on circuits that already have branches.
      if ((circuit?.subCircuitIds?.length ?? 0) === 0) {
        if ((circuit?.endpoints?.length ?? 0) > 0) {
          const parsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
          return parsed !== null && parsed.segmentIndex === 0
        }
        return false
      }
      return isLastCircuitTrunkSegment(node.id, trunkSegmentCounts)
    }
    if (hitType === 'circuit' && node.type !== 'branch' && !node.hitZone?.dcBusId) return false
    if (hitType === 'circuit' && node.type === 'branch') {
      // Domotica output wires have their own hints; skip the horizontal lead-in branch wire.
      const hasDomoticaParent = node.children.some(
        (child) =>
          child.type === 'endpoint' &&
          (child.domainRef as Endpoint | undefined)?.symbol === 'domotica' &&
          !(child.domainRef as Endpoint | undefined)?.domoticaChildProps
      )
      if (hasDomoticaParent) return false

      const circuit = ctx.circuitId ? findCircuitInProject(project, ctx.circuitId) : undefined
      const hasNested = (circuit?.subCircuitIds?.length ?? 0) > 0
      const hasOwnEndpoints = (circuit?.endpoints?.length ?? 0) > 0
      if (hasNested && !hasOwnEndpoints) return false
    }
  }

  if (ctx.circuitId && circuitFeedsSubPanel(project, ctx.circuitId)) {
    const isEndpointSymbol = !!getEndpointTypeFromSymbol(symbol)
    const isTrunkInsertableSymbol = CIRCUIT_TRUNK_INSERTABLE_SYMBOLS.has(symbol.id)
    if (
      isEndpointSymbol ||
      isTrunkInsertableSymbol ||
      (hitType === 'circuit' && node.type === 'branch')
    ) {
      return false
    }
  }

  if (hitType === 'groundWire' && !ctx.panelIsMain) {
    const panel = ctx.panelId
      ? findPanelById(getProjectElectricalPanels(project), ctx.panelId)
      : undefined
    if (panel?.hasGround !== true) return false
  }

  if ((symbol.id === 'earthing' || symbol.id === 'earthing_separator') && hitType === 'mainBus') {
    if (!ctx.panelIsMain) return false
    if (symbol.id === 'earthing_separator') return false
  }

  if (TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id) && node.type === 'branch') {
    return false
  }

  if (
    TRUNK_ONLY_ON_CIRCUIT_SYMBOLS.has(symbol.id) &&
    hitType === 'circuit' &&
    node.type === 'wire' &&
    !node.id?.includes('circuit-trunk-') &&
    !node.id?.startsWith('supply-wire-')
  ) {
    return false
  }

  if (node.type === 'trunkDevice') {
    if (
      node.id?.startsWith('supplyTrunkDevice-') ||
      node.id?.startsWith('subpanelSupplyTrunkDevice-')
    ) {
      return false
    }
    if (node.id?.startsWith('groundTrunkDevice-')) {
      return hitType === 'groundWire'
    }
    return hitType === 'circuit'
  }

  return true
}

function isBareInverterCircuitDcConnection(
  node: LayoutNode,
  ctx: HintWalkContext,
  project: ProjectWithOptionalV2Electrical
): boolean {
  const connection = node.hitZone?.converterDcConnection
  if (node.hitZone?.dcBusId || !ctx.circuitId) return false

  const circuit = findCircuitInProject(project, ctx.circuitId)
  if (!circuit) return false
  const segment = node.id ? parseCircuitTrunkSegmentId(node.id) : null
  const inverter = connection
    ? circuit.trunkDevices?.find((device) => device.id === connection.converterId)
    : [...(circuit.trunkDevices ?? [])]
        .sort((left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0))
        .at((segment?.segmentIndex ?? 0) - 1)
  if (!inverter || inverter.symbol !== 'inverter') return false

  if (!connection) {
    return (
      node.hitZone?.wireDomain === 'DC' &&
      getCircuitConverterDcConnectionCount(inverter) <= 1 &&
      !(circuit.trunkDevices ?? []).some((device) => device.type === 'dc_bus')
    )
  }

  if (connection.connectionIndex !== getCircuitConverterDcConnectionCount(inverter) - 1) {
    return false
  }

  return !(circuit.trunkDevices ?? []).some(
    (device) =>
      device.type === 'dc_bus' &&
      device.converterDcConnection?.converterId === connection.converterId
  )
}

function hasSupplyDcBusOnHintFeed(
  node: LayoutNode,
  ctx: HintWalkContext,
  project: ProjectWithOptionalV2Electrical
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const panels = getProjectElectricalPanels(project)
  const panelId = node.hitZone?.supplyPanelId ?? ctx.panelId
  const panel = findPanelById(panels, panelId)
  const panelSupplyCircuit = panel?.circuits?.find((circuit) => circuit.code === 'PANEL')
  const panelDevices = panelSupplyCircuit?.trunkDevices ?? []
  const devices =
    panelDevices.length > 0 || panel?.isMain === false
      ? panelDevices
      : getSupplyFeedDevicesForPanel(
          installation,
          panels,
          panelId,
          node.hitZone?.supplyFeedScope ?? 'shared'
        )
  return devices.some((device) => device.type === 'dc_bus' || device.symbol === 'dc_bus')
}

function accumulateHintContext(node: LayoutNode, ctx: HintWalkContext): HintWalkContext {
  if (node.type === 'mcb' && node.domainRef) {
    const protection = node.domainRef as ProtectionDevice
    const circuitId = node.circuitIdForWires ?? protection.circuits?.[0]?.id
    if (circuitId) {
      return { ...ctx, circuitId }
    }
  }
  if (node.type === 'panel' && node.domainRef) {
    const panel = node.domainRef as Panel
    return { ...ctx, panelId: panel.id, panelIsMain: panel.isMain }
  }
  return ctx
}

function visitForHints(
  node: LayoutNode,
  ctx: HintWalkContext,
  panelNode: LayoutNode,
  validTargets: Set<NonNullable<DropTarget['type']>>,
  symbol: SymbolMetadata,
  project: ProjectWithOptionalV2Electrical,
  trunkSegmentCounts: Map<string, number>,
  hints: HintWithSpan[]
): void {
  const nextCtx = accumulateHintContext(node, ctx)

  if (node.hitZone?.type && !node.hitZone.suppressDropHint && validTargets.has(node.hitZone.type)) {
    const isDcBusRotatingSwitchSlot =
      symbol.id === 'rotating_switch' && node.type === 'wire' && node.hitZone.dcBusId != null
    if (
      isDcBusRotatingSwitchSlot ||
      shouldIncludeHintNode(
        node,
        node.hitZone.type,
        nextCtx,
        symbol,
        project,
        panelNode,
        trunkSegmentCounts
      )
    ) {
      let { x, y } = hintAnchor(node)
      if (CIRCUIT_TRUNK_INSERTABLE_SYMBOLS.has(symbol.id) && node.id?.startsWith('circuit-nest-')) {
        // Put the continuation marker above the branch tap, away from its
        // incoming/output markers. It stays inside the nest's padded hit zone.
        y = node.bounds.y - 8
      }
      const trunkParsed = node.id ? parseCircuitTrunkSegmentId(node.id) : null
      if (
        (((isProtectionDragSymbol(symbol) || symbol.id === 'terminal_strip' || ENERGY_CONVERSION_SYMBOLS.has(symbol.id)) &&
          trunkParsed?.segmentIndex === 0) ||
          (isCircuitTrunkSwitchSymbol(symbol.id) && trunkParsed != null)) &&
        nextCtx.circuitId
      ) {
        // The lower protection ball sits just above the owning protection, well
        // below the endpoint branches. The upper circuit-nest ball remains above
        // the branches, making the two insertion directions explicit.
        const bounds = getHitZoneBounds(node, 'core')
        const height = Math.max(0, bounds.bottom - bounds.top)
        x = (bounds.left + bounds.right) / 2
        y = bounds.bottom - Math.min(28, height / 2)
      }
      const baseMatch = buildHintMatch(node, node.hitZone.type, nextCtx)
      const isTerminalCircuitNestHint =
        node.hitZone.type === 'circuit' &&
        node.id === `circuit-nest-${nextCtx.circuitId}` &&
        !!nextCtx.circuitId &&
        (findCircuitInProject(project, nextCtx.circuitId)?.subCircuitIds?.length ?? 0) === 0
      const hintMatch =
        isTerminalCircuitNestHint && baseMatch
          ? { ...baseMatch, insertAfterCircuitContent: true }
          : baseMatch
      const previewsSecondaryBus =
        isProtectionDragSymbol(symbol) &&
        node.id?.startsWith('circuit-nest-') === true &&
        !!nextCtx.circuitId &&
        circuitWouldGainSecondaryBus(project, nextCtx.circuitId)
      const nodeCoreBounds = previewsSecondaryBus ? getHitZoneBounds(node, 'core') : null
      hints.push({
        nodeId: node.id,
        x,
        y,
        targetType: node.hitZone.type,
        ...(nodeCoreBounds
          ? { secondaryBusPreviewY: (nodeCoreBounds.top + nodeCoreBounds.bottom) / 2 }
          : {}),
        match:
          trunkParsed != null
            ? { ...hintMatch, circuitTrunkSegmentIndex: trunkParsed.segmentIndex }
            : hintMatch,
        span: hintSpan(node),
      })
    }
  }

  for (const child of node.children) {
    visitForHints(
      child,
      nextCtx,
      panelNode,
      validTargets,
      symbol,
      project,
      trunkSegmentCounts,
      hints
    )
  }
}

/**
 * The modular changeover has one electrical insertion point.  Its direct-converter
 * AC wires are nevertheless all forgiving ways to reach that point: each marker
 * shares the canonical slot's target data, so a drop can never choose a different
 * topology merely because it landed on a different part of the drawing.
 */
function appendDirectChangeoverAreaHints(
  layoutTree: LayoutTree,
  hints: DropZoneHint[]
): DropZoneHint[] {
  const canonicalByPanel = new Map<string, DropZoneHint>()
  for (const hint of hints) {
    if (hint.targetType !== 'supplyWire' || !hint.match?.panelId) continue
    canonicalByPanel.set(hint.match.panelId, hint)
  }

  const expanded: DropZoneHint[] = []
  const visit = (node: LayoutNode, panelId: string) => {
    const canonical = canonicalByPanel.get(panelId)
    if (
      canonical &&
      (node.hitZone?.type === 'supplyConverterGridWire' ||
        node.hitZone?.type === 'supplyConverterBackupWire')
    ) {
      const bounds = getHitZoneBounds(node, 'core')
      expanded.push({
        nodeId: `direct-changeover-area-${node.id}`,
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
        targetType: 'supplyWire',
        match: canonical.match,
      })
    }
    node.children.forEach((child) => visit(child, panelId))
  }
  for (const panel of layoutTree.panels) {
    visit(panel, panel.domainId ?? panel.id)
  }
  return [...hints, ...expanded]
}

/**
 * True when the cursor is already targeting this hint (hide it while hovering).
 */
export function isDropZoneHintActive(
  hint: DropZoneHint,
  dropTarget: DropTarget | null,
  matchedNodeId: string | null
): boolean {
  if (!dropTarget || dropTarget.type !== hint.targetType) return false
  if (dropTarget.type === 'circuit' &&
      !!hint.match?.insertAfterCircuitContent !== !!dropTarget.insertAfterCircuitContent) return false
  if (matchedNodeId && matchedNodeId === hint.nodeId) return true

  if (dropTarget.type === 'supplyWire' && hint.match) {
    const scope = dropTarget.supplyFeedScope ?? 'shared'
    const hintScope = hint.match.supplyFeedScope ?? 'shared'
    return (
      dropTarget.panelId === hint.match.panelId &&
      dropTarget.busSectionId === hint.match.busSectionId &&
      scope === hintScope &&
      dropTarget.supplyDeviceInsertIndex === hint.match.supplyDeviceInsertIndex
    )
  }

  if (dropTarget.type === 'supplyConverterDcWire' && hint.match) {
    return (
      dropTarget.panelId === hint.match.panelId &&
      dropTarget.supplyDcBusId === hint.match.supplyDcBusId &&
      dropTarget.supplyDcBusBranchId === hint.match.supplyDcBusBranchId &&
      (dropTarget.supplyConverterDcConnectionIndex ?? 0) ===
        (hint.match.supplyConverterDcConnectionIndex ?? 0)
    )
  }

  if (
    dropTarget.type === 'circuit' &&
    hint.match?.circuitId &&
    dropTarget.circuitId === hint.match.circuitId &&
    hint.nodeId.startsWith('circuit-nest-') &&
    typeof dropTarget.secondaryBusInsertIndex !== 'number'
  ) {
    return true
  }

  if (
    dropTarget.type === 'circuit' &&
    hint.match?.circuitId &&
    dropTarget.circuitId === hint.match.circuitId &&
    typeof hint.match.circuitTrunkSegmentIndex === 'number' &&
    typeof dropTarget.circuitTrunkSegmentIndex === 'number'
  ) {
    return dropTarget.circuitTrunkSegmentIndex === hint.match.circuitTrunkSegmentIndex
  }

  if (
    dropTarget.type === 'circuit' &&
    hint.match?.dcBusId &&
    dropTarget.dcBusId === hint.match.dcBusId &&
    typeof hint.match.secondaryBusInsertIndex === 'number' &&
    typeof dropTarget.secondaryBusInsertIndex === 'number'
  ) {
    return dropTarget.secondaryBusInsertIndex === hint.match.secondaryBusInsertIndex
  }

  return false
}

function isHintCompatibleWithDropTarget(hint: DropZoneHint, dropTarget: DropTarget): boolean {
  if (!dropTarget.type || hint.targetType !== dropTarget.type) return false

  const match = hint.match
  if (!match) return true
  if (dropTarget.type === 'circuit' &&
      !!match.insertAfterCircuitContent !== !!dropTarget.insertAfterCircuitContent) return false
  if (match.panelId && dropTarget.panelId && match.panelId !== dropTarget.panelId) return false
  if (match.circuitId && dropTarget.circuitId && match.circuitId !== dropTarget.circuitId) {
    return false
  }
  if (
    typeof match.circuitTrunkSegmentIndex === 'number' &&
    typeof dropTarget.circuitTrunkSegmentIndex === 'number' &&
    match.circuitTrunkSegmentIndex !== dropTarget.circuitTrunkSegmentIndex
  ) {
    return false
  }
  if (
    match.converterDcConnection &&
    dropTarget.converterDcConnection &&
    (match.converterDcConnection.converterId !== dropTarget.converterDcConnection.converterId ||
      match.converterDcConnection.connectionIndex !==
        dropTarget.converterDcConnection.connectionIndex)
  ) {
    return false
  }
  if (
    typeof match.supplyDeviceInsertIndex === 'number' &&
    typeof dropTarget.supplyDeviceInsertIndex === 'number' &&
    match.supplyDeviceInsertIndex !== dropTarget.supplyDeviceInsertIndex
  ) {
    return false
  }
  if (match.busSectionId && dropTarget.busSectionId &&
    match.busSectionId !== dropTarget.busSectionId) return false
  if (
    match.supplyFeedScope &&
    dropTarget.supplyFeedScope &&
    match.supplyFeedScope !== dropTarget.supplyFeedScope
  ) {
    return false
  }
  if (
    typeof match.supplyConverterDcConnectionIndex === 'number' &&
    typeof dropTarget.supplyConverterDcConnectionIndex === 'number' &&
    match.supplyConverterDcConnectionIndex !== dropTarget.supplyConverterDcConnectionIndex
  ) {
    return false
  }
  if (match.dcBusId && dropTarget.dcBusId && match.dcBusId !== dropTarget.dcBusId) return false
  if (
    match.supplyDcBusId &&
    dropTarget.supplyDcBusId &&
    match.supplyDcBusId !== dropTarget.supplyDcBusId
  ) {
    return false
  }
  if (
    typeof match.secondaryBusInsertIndex === 'number' &&
    typeof dropTarget.secondaryBusInsertIndex === 'number' &&
    match.secondaryBusInsertIndex !== dropTarget.secondaryBusInsertIndex
  ) {
    return false
  }
  return true
}

/** Resolve the single hint represented by the current concrete drop preview. */
export function resolveActiveDropZoneHintNodeId(
  hints: DropZoneHint[],
  dropTarget: DropTarget | null,
  matchedNodeId: string | null,
  position: Point | null
): string | null {
  if (!dropTarget?.type) return null

  const exactMatch = matchedNodeId
    ? hints.find((hint) => hint.nodeId === matchedNodeId && hint.targetType === dropTarget.type)
    : undefined
  if (exactMatch) return exactMatch.nodeId

  const semanticMatches = hints.filter((hint) =>
    isDropZoneHintActive(hint, dropTarget, matchedNodeId)
  )
  const candidates =
    semanticMatches.length > 0
      ? semanticMatches
      : hints.filter((hint) => isHintCompatibleWithDropTarget(hint, dropTarget))

  if (candidates.length === 0) return null
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return candidates.length === 1 ? candidates[0]!.nodeId : null
  }

  return candidates.reduce((closest, hint) => {
    const closestDistance = (closest.x - position.x) ** 2 + (closest.y - position.y) ** 2
    const hintDistance = (hint.x - position.x) ** 2 + (hint.y - position.y) ** 2
    return hintDistance < closestDistance ? hint : closest
  }).nodeId
}

function collectSecondaryPanelEarthingBusHints(layoutTree: LayoutTree): DropZoneHint[] {
  return layoutTree.panels.flatMap((panelNode) => {
    const panel = panelNode.domainRef as Panel | undefined
    if (!panel || panel.isMain !== false || panel.hasGround === true) return []
    const bus = panelNode.children.find((node) => node.type === 'busBar')
    if (!bus) return []
    const horizontalPadding = 12
    const verticalPadding = 14
    return [
      {
        nodeId: `secondary-panel-earthing-bus-${panelNode.id}`,
        x: bus.bounds.x + bus.bounds.width / 2,
        y: bus.bounds.y + bus.bounds.height / 2,
        targetType: 'mainBus' as const,
        match: { panelId: panel.id },
        outline: {
          x: bus.bounds.x - horizontalPadding,
          y: bus.bounds.y - verticalPadding,
          width: bus.bounds.width + horizontalPadding * 2,
          height: bus.bounds.height + verticalPadding * 2,
          cornerRadius: 8,
        },
      },
    ]
  })
}

/**
 * Returns hint markers for every legal drop target of the given symbol on the current layout.
 */
export function collectDropZoneHints(
  symbol: SymbolMetadata,
  layoutTree: LayoutTree,
  project: ProjectWithOptionalV2Electrical,
  options?: { movingPanelAttachmentId?: string | null }
): DropZoneHint[] {
  const sameSymbolHints = findSameSymbolAddMoreLayoutTargets(symbol.id, layoutTree).map(
    (target) => ({
      nodeId: `same-symbol-add-more-${target.nodeId}`,
      sameSymbolTargetId: target.target.endpoint?.id ?? target.target.trunkDevice?.id,
      x: target.center.x,
      y: target.center.y,
      targetType: 'endpoint' as const,
      outline: target.outline,
    })
  )
  if (symbol.busFeedKind) {
    if (!canCreateSupplyTopologyFromDrop(symbol, 'mainBus')) return []
    return [
      ...sameSymbolHints,
      ...layoutTree.panels.flatMap((panelNode) => {
        const panel = panelNode.domainRef as Panel | undefined
        if (!panel || panel.isMain === false) return []
        const bus = panelNode.children.find((node) => node.type === 'busBar')
        if (!bus) return []
        const horizontalPadding = 12
        const verticalPadding = 14
        return [
          {
            nodeId: `panel-bus-feed-invitation-${panelNode.id}`,
            x: bus.bounds.x + bus.bounds.width / 2,
            y: bus.bounds.y + bus.bounds.height / 2,
            targetType: 'mainBus' as const,
            match: { panelId: panel.id },
            outline: {
              x: bus.bounds.x - horizontalPadding,
              y: bus.bounds.y - verticalPadding,
              width: bus.bounds.width + horizontalPadding * 2,
              height: bus.bounds.height + verticalPadding * 2,
              cornerRadius: 8,
            },
          },
        ]
      }),
    ]
  }
  const behavior = dropBehaviors[symbol.id]
  if (!behavior) return sameSymbolHints

  const validTargets = new Set(
    behavior.validTargets.filter((t): t is NonNullable<DropTarget['type']> => t !== null)
  )
  if (validTargets.size === 0) return sameSymbolHints

  const rawHints: HintWithSpan[] = []
  const trunkSegmentCounts = buildTrunkSegmentCountByCircuit(layoutTree)

  for (const panelNode of layoutTree.panels) {
    const panelId = panelNode.domainId ?? panelNode.id
    visitForHints(
      panelNode,
      { panelId, panelIsMain: (panelNode.domainRef as Panel | undefined)?.isMain },
      panelNode,
      validTargets,
      symbol,
      project,
      trunkSegmentCounts,
      rawHints
    )
  }

  appendTrunkTopSlotHints(symbol, project, layoutTree, trunkSegmentCounts, rawHints)

  const hints = [
    ...sameSymbolHints,
    ...((symbol.id === 'earthing' || symbol.id === 'earthing_separator')
      ? collectSecondaryPanelEarthingBusHints(layoutTree)
      : []),
    ...dedupeMainBusHints(dedupeSupplyWireHints(rawHints)).filter((hint) =>
      canCreateSupplyTopologyFromDrop(symbol, hint.targetType)
    ),
  ]
  appendVentilationAfterHvacSourceHints(symbol, layoutTree, hints)

  const completedHints: DropZoneHint[] =
    symbol.id === 'source_changeover' ? appendDirectChangeoverAreaHints(layoutTree, hints) : hints
  const movingPanelId = options?.movingPanelAttachmentId
  if (symbol.id !== 'panel_distribution' || !movingPanelId) return completedHints

  const panels = getProjectElectricalPanels(project)
  return completedHints.filter((hint) =>
    isPanelAttachmentDropTargetTerminal(panels, movingPanelId, {
      type: hint.targetType,
      ...(hint.match ?? {}),
    })
  )
}
