import type { BottomUpLayoutResult } from './bottomUpLayout'
import { getPanelDiagramId } from './bottomUpLayout'
import type { LayoutTree } from './layoutTree'
import { findDropTarget, type DropTarget } from './findDropTarget'
import { createCircuitTrunkBranchSlotFinder, findCircuitTrunkBranchSlot, circuitTrunkBranchSlotDropTarget } from './circuitTrunkBranchSlots'
import { computeEndpointInsertAfter, isEnergyConversionEndpointSymbol, isDcOnlyEndpointSymbol } from '@/lib/eendraad/endpointInsertAfter'
import { findSameSymbolAddMoreLayoutTargets, type SameSymbolAddMoreLayoutTarget } from '@/lib/eendraad/sameSymbolAddMore'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point } from '@/types/ui'
import { collectSavedForkDropTargets } from './savedForkDropTargets'
import { canEditOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { isChangeoverSwitchEndpoint } from '@/lib/eendraad/circuitPointNumbering'
import type { Circuit } from '@/types/schema'
import { circuitAcceptsTrunkSwitch, isCircuitTrunkSwitchSymbol, isCircuitTrunkSwitchDropTarget } from '@/lib/eendraad/circuitTrunkSwitch'
import { isTerminalPanelFeederCircuit } from '@/lib/eendraad/panelSupplyLink'

/** Keep marks readable at working zooms without dwarfing or disappearing beside the diagram. */
export function getBranchDropPreviewUnit(zoom: number): number {
  return 1 / Math.max(0.75, Math.min(1.5, zoom))
}

export interface BranchDropIntent {
  id: string
  kind: 'insert' | 'branch' | 'multiply' | 'trunk' | 'fork'
  target: DropTarget
  /** Acquisition handle, independent of selection and final layout geometry. */
  point: Point
  /** The existing wire connection that this edit affects. */
  wirePoint: Point
  wireOrigin?: Point
  direction: number
  radiusPx: number
  sameSymbolTarget?: SameSymbolAddMoreLayoutTarget
}

export interface BranchDropTargets {
  intents: BranchDropIntent[]
  regions: Array<{ left: number; right: number; top: number; bottom: number }>
  endpointNodeIds: Set<string>
  circuitIds: Set<string>
}

/** Keep the whole current trunk gap on the same local presentation as its handle. */
export function resolveBranchStemFallback(
  targets: BranchDropTargets, tree: LayoutTree, position: Point,
): BranchDropIntent | null {
  const slot = findCircuitTrunkBranchSlot(tree, position, { includeBranchRows: false })
  if (!slot || !targets.circuitIds.has(slot.circuitId)) return null
  const id = `${slot.diagramId}/${slot.circuitId}/stem/${slot.insertIndex}`
  return targets.intents.find((intent) => intent.id === `${id}/trunk`)
    ?? targets.intents.find((intent) => intent.id === id) ?? null
}

/** Equivalent padded endpoint hits must not switch back to a different preview renderer. */
export function resolveBranchDropFallback(
  targets: BranchDropTargets, target: DropTarget, circuit: Circuit, symbol: SymbolMetadata,
): BranchDropIntent | null {
  if (target.type !== 'endpoint' || target.circuitId !== circuit.id ||
      target.domoticaOutput || target.domoticaChildDropIntent || target.converterDcConnection || target.dcBusId) return null
  const branchIds = target.branchEndpoints ?? (target.endpointId ? [target.endpointId] : [])
  if (!branchIds.some((id) => targets.endpointNodeIds.has(`endpoint-${id}`))) return null
  if (targets.intents.some((intent) => intent.kind === 'multiply' &&
    intent.sameSymbolTarget?.target.endpoint?.id === target.endpointId)) return null
  const computed = computeEndpointInsertAfter(target, circuit, symbol)
  // After a changeover switch with a fork slot, a padded hit means that fork (see savedForkDropTargets).
  const fork = isChangeoverSwitchEndpoint(circuit, target.endpointId) ? targets.intents.find((intent) =>
    intent.kind === 'fork' && intent.target.circuitId === target.circuitId &&
    intent.target.forkAfterEndpointId === target.endpointId) : undefined
  if (fork) return fork
  // A same-symbol drop on the symbol right after a changeover switch became that switch's fork.
  const branchInstead = targets.intents.find((intent) => intent.kind === 'fork' && intent.id.endsWith(`/multiply/${target.endpointId}`))
  if (branchInstead) return branchInstead
  return targets.intents.find((intent) => intent.kind === (computed.createNewBranch ? 'branch' : 'insert') &&
    intent.target.circuitId === target.circuitId &&
    (!target.diagramId || intent.target.diagramId === target.diagramId) &&
    intent.target.branchEndpoints?.some((id) => branchIds.includes(id)) &&
    intent.target.insertAfterEndpointId === computed.insertAfterEndpointId) ?? null
}

/** Only ordinary horizontal AC branches participate; specialized paths retain their own contracts. */
export function collectBranchDropTargets(
  layout: BottomUpLayoutResult,
  tree: LayoutTree,
  symbol: SymbolMetadata,
  zoom: number,
  movingEndpointIds: readonly string[] = [],
  allowForks = false,
): BranchDropTargets {
  const result: BranchDropTargets = { intents: [], regions: [], endpointNodeIds: new Set(), circuitIds: new Set() }
  const type = getEndpointTypeFromSymbol(symbol)
  if (!type || !['socket', 'switch', 'light_point', 'fixed_appliance'].includes(type) ||
      isEnergyConversionEndpointSymbol(symbol.id) || isDcOnlyEndpointSymbol(symbol) || !Number.isFinite(zoom) || zoom <= 0) return result
  const moving = new Set(movingEndpointIds)
  const multipliers = moving.size ? [] : findSameSymbolAddMoreLayoutTargets(symbol.searchPreset ? '' : symbol.id, tree)
  const findBranchSlot = createCircuitTrunkBranchSlotFinder(tree)
  const trunkHitOptions = { trunkBranchSlotAt: (point: Point) => findBranchSlot(point, { includeBranchRows: false }) }
  for (const panel of layout.panels) {
    if (panel.frameRole === 'supply') continue
    const diagramId = getPanelDiagramId(panel)
    const positions = new Map(panel.elements.flatMap((element) =>
      element.type === 'endpoint' && element.endpointId ? [[element.endpointId, element.position] as const] : []))
    for (const branch of panel.branches) {
      const column = panel.circuits.find((candidate) => candidate.circuit.id === branch.circuitId)
      const circuit = column?.circuit
      if (branch.forkFrom || branch.storedBranchId && circuit?.branches?.find((entry) => entry.id === branch.storedBranchId)?.keepEmpty) continue
      // An empty circuit has no branch for a trunk switch to control, so its stem offers
      // only the first branch; the explicit target keeps the drop from becoming a trunk device.
      if (circuit && column && !branch.endpoints.length && !circuit.endpoints.length &&
          !circuit.trunkDevices?.length && circuitAcceptsTrunkSwitch(circuit) &&
          !moving.size && isCircuitTrunkSwitchSymbol(symbol.id) &&
          !panel.panel.protections.some((protection) => isTerminalPanelFeederCircuit(protection, circuit) &&
            protection.circuits?.some((entry) => entry.id === circuit.id))) {
        const protection = panel.elements.find((element) =>
          element.type === 'protection' && element.protectionId === column.protection?.id)
        if (!protection) continue
        const wirePoint = { x: branch.trunkX, y: (branch.branchY + protection.position.y) / 2 }
        const direction = branch.branchX < branch.trunkX ? -1 : 1
        const id = `${diagramId}/${circuit.id}/stem/0`
        const target: DropTarget = {
          type: 'circuit', panelId: panel.ownerPanelId ?? panel.panel.id, diagramId,
          circuitId: circuit.id, wireDomain: 'AC', circuitTrunkSegmentIndex: 0,
        }
        result.intents.push({ id, kind: 'branch',
          target: { ...target, branchEndpoints: [], branchInsertIndex: 0 },
          point: wirePoint, wirePoint, direction, radiusPx: 10 })
        result.circuitIds.add(circuit.id)
        result.regions.push({ left: wirePoint.x - 12 / zoom, right: wirePoint.x + 12 / zoom,
          top: wirePoint.y - 11 / zoom, bottom: wirePoint.y + 11 / zoom })
        continue
      }
      if (!circuit || circuit.code === 'PANEL' || !branch.endpoints.length ||
          panel.panel.protections.some((protection) => isTerminalPanelFeederCircuit(protection, circuit) &&
            protection.circuits?.some((entry) => entry.id === circuit.id)) ||
          circuit.trunkDevices?.some((device) => device.type === 'conversion' || device.type === 'dc_bus') ||
          branch.endpoints.some((endpoint) => endpoint.domoticaChildProps || endpoint.symbol === 'domotica' ||
            endpoint.converterDcConnection || isEnergyConversionEndpointSymbol(endpoint.symbol) ||
            endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery')) continue
      const stored = circuit.branches?.find((candidate) =>
        candidate.endpointIds.length === branch.endpoints.length &&
        candidate.endpointIds.every((id, index) => id === branch.endpoints[index]?.id))
      if (stored?.dcBusId || stored?.branchDevices?.length) continue
      const points = branch.endpoints.map((endpoint) => positions.get(endpoint.id))
      if (points.some((point) => !point || Math.abs(point.y - branch.branchY) > 0.001)) continue
      const first = points[0]!
      const last = points.at(-1)!
      const direction = Math.sign(first.x - branch.trunkX)
      if (!direction || points.some((point, index) => index > 0 &&
        (point!.x - points[index - 1]!.x) * direction <= 0)) continue
      const ids = branch.endpoints.map((endpoint) => endpoint.id)
      const key = `${diagramId}/${circuit.id}/${branch.id}`
      const targetBase: DropTarget = {
        type: 'endpoint', panelId: panel.ownerPanelId ?? panel.panel.id, diagramId,
        circuitId: circuit.id, branchId: branch.id, branchEndpoints: ids, wireDomain: 'AC',
      }
      const regionPadding = 32 / zoom
      result.regions.push({
        left: Math.min(branch.trunkX, last.x) - regionPadding,
        right: Math.max(branch.trunkX, last.x) + regionPadding,
        top: branch.branchY - 11 / zoom, bottom: branch.branchY + 11 / zoom,
      })
      ids.forEach((id) => result.endpointNodeIds.add(`endpoint-${id}`))
      result.endpointNodeIds.add(`branch-visual-${branch.id}`)
      result.circuitIds.add(circuit.id)

      const wirePointFor = (index: number): Point => ({
        x: index < points.length
          ? ((index ? points[index - 1]!.x : branch.trunkX) + points[index]!.x) / 2
          : last.x + direction * 24 / zoom,
        y: branch.branchY,
      })
      // Fork rows place their own slots either side of a tap (`savedForkDropTargets.ts`).
      const taps = allowForks && canEditOneWireForks(circuit)
        ? new Set((circuit.branches ?? []).flatMap((entry) => entry.forkFrom ? [entry.forkFrom.afterEndpointId] : [])) : null
      const add = (index: number, bodyIndex?: number) => {
        const after = ids[index - 1] ?? null
        if (bodyIndex == null && after && taps?.has(after)) return
        const target = { ...targetBase, endpointId: after ?? ids[0], insertAfterEndpointId: after }
        const computed = computeEndpointInsertAfter(target, circuit, symbol)
        const actualIndex = computed.insertAfterEndpointId == null ? 0 : ids.indexOf(computed.insertAfterEndpointId) + 1
        // A slot must promise the insertion that the existing command actually performs.
        if (bodyIndex == null && actualIndex !== index) return
        const branchSlot = computed.createNewBranch ? findBranchSlot(
          { x: branch.trunkX, y: branch.branchY + (after == null ? 25 : -25) },
          { includeBranchRows: false }) : null
        const wirePoint = computed.createNewBranch
          ? { x: branch.trunkX, y: branchSlot?.slotY ?? branch.branchY + (after == null ? 25 : -25) }
          : wirePointFor(actualIndex)
        let point = bodyIndex == null ? { ...wirePoint } : { ...points[bodyIndex]! }
        if (bodyIndex == null && !computed.createNewBranch && points.some((p) =>
          Math.abs(p!.x - point.x) * zoom < 20)) point = { x: point.x, y: point.y + 18 / zoom }
        result.intents.push({
          id: `${key}/${bodyIndex == null ? 'slot' : 'body'}/${index}`,
          kind: computed.createNewBranch ? 'branch' : 'insert',
          target: { ...target, insertAfterEndpointId: computed.insertAfterEndpointId },
          point, wirePoint, direction, radiusPx: bodyIndex == null ? 9 : 8,
          ...(computed.createNewBranch ? { wireOrigin: { x: branch.trunkX, y: branch.branchY } } : {}),
        })
      }
      if (moving.size) {
        // Partial moves cannot target their own source branch. Group moves use stem slots.
        if (moving.size === 1 && !ids.some((id) => moving.has(id))) {
          for (let index = 0; index <= ids.length; index++) add(index)
          ids.forEach((_, index) => add(index + 1, index))
        }
      } else {
        for (let index = 0; index <= ids.length; index++) add(index)
        ids.forEach((id, index) => {
          const same = multipliers.find((candidate) => candidate.target.endpoint?.id === id)
          if (same) result.intents.push({ id: `${key}/multiply/${id}`, kind: 'multiply',
            target: { ...targetBase, endpointId: id }, point: same.center,
            wirePoint: same.center, direction, radiusPx: 8, sameSymbolTarget: same })
          else add(index + 1, index)
        })
      }
      for (const delta of [-25, 25]) {
        const point = { x: branch.trunkX, y: branch.branchY + delta }
        const slot = findBranchSlot(point, { includeBranchRows: false })
        if (!slot) continue
        const selectedBranches = (circuit.branches ?? []).flatMap((entry, index) =>
          entry.endpointIds.length && entry.endpointIds.every((id) => moving.has(id)) ? [index] : [])
        const allSelected = selectedBranches.flatMap((index) => circuit.branches![index]!.endpointIds)
        const start = selectedBranches[0]
        if (start != null && moving.size === allSelected.length &&
            selectedBranches.every((index, offset) => index === start + offset) &&
            slot.insertIndex >= start && slot.insertIndex <= start + selectedBranches.length) continue
        const id = `${diagramId}/${circuit.id}/stem/${slot.insertIndex}`
        if (result.intents.some((intent) => intent.id === id)) continue
        // A trunk switch controls the branches after it; past the last branch it controls nothing.
        const trunkTarget = !moving.size && isCircuitTrunkSwitchSymbol(symbol.id) && slot.insertIndex < slot.branchCount
          ? findDropTarget(tree, { x: slot.trunkX, y: slot.slotY }, trunkHitOptions) : null
        const hasTrunkInsert = !!trunkTarget && isCircuitTrunkSwitchDropTarget(trunkTarget)
        if (hasTrunkInsert) result.intents.push({
          id: `${id}/trunk`, kind: 'trunk', point: { x: slot.trunkX, y: slot.slotY },
          wirePoint: { x: slot.trunkX, y: slot.slotY }, direction, radiusPx: 8,
          target: trunkTarget,
        })
        result.intents.push({ id, kind: 'branch', point: {
          x: slot.trunkX + (hasTrunkInsert ? direction * 20 / zoom : 0), y: slot.slotY,
        },
          wirePoint: { x: slot.trunkX, y: slot.slotY }, direction, radiusPx: 10,
          wireOrigin: { x: branch.trunkX, y: branch.branchY },
          target: { ...circuitTrunkBranchSlotDropTarget(slot), ...(moving.size ? {} : { branchEndpoints: [] }) } })
      }
    }
  }
  if (allowForks) collectSavedForkDropTargets(layout, symbol, zoom, movingEndpointIds, result)
  return result
}

/** A small spatial margin stabilizes overlaps without delaying an intentional target change. */
export function resolveBranchDropIntent(
  targets: BranchDropTargets, position: Point, zoom: number, previousId?: string | null,
): { handled: boolean; intent: BranchDropIntent | null } {
  let nearest: BranchDropIntent | null = null
  let nearestDistance = Infinity
  let previous: BranchDropIntent | null = null
  let previousDistance = Infinity
  for (const intent of targets.intents) {
    const distance = Math.hypot(intent.point.x - position.x, intent.point.y - position.y) * zoom
    if (intent.id === previousId && distance <= intent.radiusPx + 3) {
      previous = intent; previousDistance = distance
    }
    if (distance <= intent.radiusPx && (distance < nearestDistance ||
      (distance === nearestDistance && intent.id < (nearest?.id ?? '')))) {
      nearest = intent; nearestDistance = distance
    }
  }
  const intent = previous && (!nearest || nearest.id === previous.id || nearestDistance + 2 > previousDistance)
    ? previous : nearest
  return { intent, handled: !!intent || targets.regions.some((region) =>
    position.x >= region.left && position.x <= region.right && position.y >= region.top && position.y <= region.bottom) }
}
