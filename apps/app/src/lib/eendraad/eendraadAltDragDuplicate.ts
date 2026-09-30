/**
 * Alt-drag duplicate on the 1-wire canvas: drop-target placement with source properties,
 * sitplan auto-place, and no delete of the source (unlike move-drag).
 */

import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import {
  getMainBusItemsWithIndices,
  getMainBusOrder,
  pickRepresentativeCircuitIdForMainBusMove,
} from '@/lib/eendraad/mainBusOrder'
import { findDomoticaOutputDropTarget } from '@/lib/layout/findDropTarget'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import { executeDropBehavior } from '@/handlers/eendraad/dropBehaviors'
import type { DropBehaviorProject } from '@/handlers/eendraad/dropBehaviors'
import { getSymbolById } from '@/lib/symbols'
import type {
  Circuit,
  Endpoint,
  Panel,
  Placement,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { TFunction } from 'i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useDialogStore } from '@/stores/dialogStore'
import { clamp } from '@/lib/geometry'
import { clonePlacementsForDuplicate } from '@/lib/eendraad/duplicateSitplanHelpers'
import { cloneDomoticaEndpointGroup } from '@/lib/eendraad/duplicateDomoticaEndpointGroup'
import { generateId } from '@/utils'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  endpointMergeSettingsMatchEndpoints,
  endpointsShareMergeFamily,
  incrementSameSymbolAddMoreTarget,
  canIncrementSameSymbolAddMoreTarget,
  findSameSymbolAddMoreLayoutTargets,
} from '@/lib/eendraad/sameSymbolAddMore'

export type WireSegmentForDrop = {
  panelId?: string
  circuitId?: string
  type?: string
  startPoint: Point
  endPoint: Point
  domain?: string
}

export interface EendraadAltDragDuplicateDeps {
  project: DropBehaviorProject
  layoutTree: LayoutTree
  wireSegments: WireSegmentForDrop[]
  findDropTarget: (tree: LayoutTree, position: Point) => { target: DropTarget }
  t: TFunction
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null
  ) => void
  addPlacement: (endpointId: string, placement: Placement) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  setSelection: (sel: Selection) => void
  getFloorById: (floorId: string) => { id: string; layers?: string[] } | null
  getProtectionById: (protectionId: string) => ProtectionDevice | null
  syncEndpointMultiplierCount: (endpointId: string, count: number) => boolean
}

/** Copy a circuit trunk symbol to a wire slot, keeping its physical junction identity. */
export function duplicateCircuitTrunkDeviceAtDropTarget(
  project: ProjectWithOptionalV2Electrical,
  sourceCircuitId: string,
  sourceDeviceId: string,
  target: DropTarget,
): string | null {
  if (target.type !== 'circuit' || !target.circuitId || target.branchEndpoints?.length) return null
  const circuits = [...walkPanels(getProjectElectricalPanels(project))]
    .flatMap((panel) => [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ])
  const sourceCircuit = circuits.find((circuit) => circuit.id === sourceCircuitId)
  const sourceDevice = sourceCircuit?.trunkDevices?.find((device) => device.id === sourceDeviceId)
  const symbol = sourceDevice ? getSymbolById(sourceDevice.symbol) : undefined
  if (!sourceCircuit || !sourceDevice || !symbol) return null
  if (sourceDevice.symbol === 'junction_panel') {
    const targetCircuit = circuits.find((circuit) => circuit.id === target.circuitId)
    if (
      !targetCircuit ||
      targetCircuit.id === sourceCircuitId ||
      circuitContainsJunctionPanelIdentity(targetCircuit, getJunctionIdentity(sourceDevice))
    ) return null
  }
  const lastTrunkPosition = Math.max(
    -1,
    ...(sourceCircuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0),
  )

  const clone: TrunkDevice = {
    ...JSON.parse(JSON.stringify(sourceDevice)),
    id: generateId(),
    // Keep the temporary source insertion after every existing trunk device so
    // the drop slot retains its original index on same-circuit duplicates.
    trunkPosition: lastTrunkPosition + 1,
    placements: sourceDevice.placements?.length
      ? clonePlacementsForDuplicate(sourceDevice.placements, { symbolType: sourceDevice.symbol })
      : [],
  }
  // A junction panel's displayed ID identifies the shared physical panel;
  // each symbol occurrence and its terminal still need unique internal IDs.
  if (clone.junctionPanelTerminal) {
    clone.junctionPanelTerminal.id = generateId()
  }
  const originalDevices = sourceCircuit.trunkDevices
  sourceCircuit.trunkDevices = [...(originalDevices ?? []), clone]
  if (!mutateTrunkDeviceRelocation(project, { id: clone.id, sourceCircuitId }, target, symbol)) {
    sourceCircuit.trunkDevices = originalDevices
    return null
  }
  return clone.id
}

/**
 * Duplicate one ordinary DC-rail branch device at the exact branch insertion slot
 * under the pointer. Alt-drag intentionally copies only the selected device; Ctrl-D
 * is the operation that copies the downstream branch suffix.
 */
export function duplicateCircuitDcBranchDeviceAtDropTarget(
  sourceDevice: TrunkDevice,
  circuit: Circuit,
  target: DropTarget,
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void,
): string | null {
  if (!target.circuitId || target.circuitId !== circuit.id || !target.dcBusId) return null

  const branch = (circuit.branches ?? []).find(
    (candidate) =>
      candidate.dcBusId === target.dcBusId &&
      (candidate.id === target.branchId ||
        candidate.endpointIds.some((id) => target.branchEndpoints?.includes(id))),
  )
  if (!branch) return null

  const clone: TrunkDevice = {
    ...JSON.parse(JSON.stringify(sourceDevice)),
    id: generateId(),
    trunkPosition: target.branchDeviceInsertIndex ?? branch.branchDevices?.length ?? 0,
    placements: sourceDevice.placements?.length
      ? clonePlacementsForDuplicate(sourceDevice.placements, {
          symbolType: sourceDevice.symbol,
        })
      : [],
  }
  const branchDevices = [...(branch.branchDevices ?? [])]
  const insertIndex = clamp(
    target.branchDeviceInsertIndex ?? branchDevices.length,
    0,
    branchDevices.length,
  )
  clone.trunkPosition = insertIndex
  branchDevices.splice(insertIndex, 0, clone)

  updateCircuit(circuit.id, {
    branches: (circuit.branches ?? []).map((candidate) =>
      candidate.id === branch.id ? { ...candidate, branchDevices } : candidate,
    ),
  })
  return clone.id
}

/**
 * Apply the same-symbol multiplier behavior for an Alt-drag released on its source.
 * Returns null when the drop is not an eligible self-target, so the caller can continue
 * with ordinary endpoint duplication.
 */
export function incrementAltDragSameSymbolEndpoint(
  sourceEndpoint: Endpoint,
  targetEndpoint: Endpoint | null,
  deps: Pick<EendraadAltDragDuplicateDeps, 'syncEndpointMultiplierCount'>,
): boolean | null {
  if (
    targetEndpoint?.id !== sourceEndpoint.id ||
    !sourceEndpoint.symbol ||
    !canIncrementSameSymbolAddMoreTarget(sourceEndpoint.symbol, { endpoint: targetEndpoint })
  ) {
    return null
  }

  const result = incrementSameSymbolAddMoreTarget(
    sourceEndpoint.symbol,
    { endpoint: targetEndpoint },
    {
      syncEndpointCount: deps.syncEndpointMultiplierCount,
      syncSupplyDeviceCount: () => false,
    },
  )
  return result === 'incremented'
}

function augmentDropTargetWithWireDomain(
  rawTarget: DropTarget,
  position: Point,
  wireSegments: WireSegmentForDrop[]
): DropTarget {
  let dropTarget = rawTarget
  if (
    rawTarget.type === 'circuit' &&
    rawTarget.circuitId &&
    rawTarget.panelId &&
    typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
  ) {
    const panelWires = wireSegments.filter(
      (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
    )
    const verticalCandidates = panelWires.filter(
      (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
    )
    const hitVertical = verticalCandidates.find((ws) => {
      const x = ws.startPoint.x
      const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
      const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
      const withinX = Math.abs(position.x - x) <= 15
      const withinY = position.y >= minY - 10 && position.y <= maxY + 10
      return withinX && withinY
    })
    if (hitVertical) {
      dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
    }
  }
  return dropTarget
}

/**
 * Duplicate an endpoint at the drop target (properties from source, new id/label/placements via drop rules).
 */
export function runEendraadEndpointAltDragDuplicate(
  sourceEndpointId: string,
  position: Point,
  deps: EendraadAltDragDuplicateDeps
): boolean {
  const store = useProjectStore.getState()
  const sourceEndpoint = store.getEndpointById(sourceEndpointId)
  // Domotica output children are still ordinary endpoint symbols for Alt-drag.
  // The drop target supplies the new row/slot relationship; the callback below
  // supplies the source endpoint's user-facing properties. Keep the stricter
  // default for Ctrl-D and context-menu duplication, where a child is not a
  // standalone branch to duplicate.
  if (
    !sourceEndpoint?.symbol ||
    !endpointSymbolCanBeDuplicated(sourceEndpoint, { allowDomoticaChild: true })
  ) {
    return false
  }

  const symbolMeta = getSymbolById(sourceEndpoint.symbol)
  if (!symbolMeta) return false

  // Resolve the symbol under the pointer before asking the generic drop-target
  // hit tester. The latter may report the surrounding wire (or no target at
  // all), while the library drop path deliberately gives the symbol body
  // priority for same-symbol multiplier drops.
  const sameSymbolLayoutTarget = findSameSymbolAddMoreLayoutTargets(
    sourceEndpoint.symbol,
    deps.layoutTree,
    position,
  )[0]
  const directSameSymbolTargetId = sameSymbolLayoutTarget?.target.endpoint?.id
  const directSameSymbolTarget = directSameSymbolTargetId
    ? store.getEndpointById(directSameSymbolTargetId) ?? null
    : null
  const directSameSymbolMultiplierResult = incrementAltDragSameSymbolEndpoint(
    sourceEndpoint,
    directSameSymbolTarget,
    deps,
  )
  if (directSameSymbolMultiplierResult !== null) {
    return directSameSymbolMultiplierResult
  }

  const { target: rawTarget } = deps.findDropTarget(deps.layoutTree, position)
  if (!rawTarget || rawTarget.type === null) return false

  let dropTarget = augmentDropTargetWithWireDomain(rawTarget, position, deps.wireSegments)

  const targetEndpoint = dropTarget.endpointId
    ? store.getEndpointById(dropTarget.endpointId) ?? null
    : null

  if (
    sourceEndpoint.domoticaChildProps &&
    targetEndpoint?.domoticaChildProps &&
    dropTarget.domoticaChildDropIntent === 'replace' &&
    endpointsShareMergeFamily(sourceEndpoint, targetEndpoint)
  ) {
    if (!endpointMergeSettingsMatchEndpoints(sourceEndpoint, targetEndpoint)) return false
    if (
      sourceEndpoint.symbol === targetEndpoint.symbol &&
      endpointSupportsMultiplier(targetEndpoint)
    ) {
      return deps.syncEndpointMultiplierCount(
        targetEndpoint.id,
        getEndpointMultiplier(targetEndpoint) + 1
      )
    }
  }

  const sourceDomoticaCircuit =
    sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps
      ? store.findCircuitForEndpoint(sourceEndpointId)?.circuit
      : undefined
  const domoticaGroupClone = sourceDomoticaCircuit
    ? cloneDomoticaEndpointGroup(sourceEndpoint, sourceDomoticaCircuit)
    : undefined

  // A domotica parent is a complete diagram module. Dropping its duplicate on
  // another domotica row must insert a sibling module, never turn the copied
  // parent itself into another output child.
  if (domoticaGroupClone && (targetEndpoint?.domoticaChildProps || dropTarget.domoticaOutput)) {
    dropTarget = {
      ...dropTarget,
      domoticaOutput: undefined,
      domoticaChildDropIntent: undefined,
      insertAfterEndpointId: targetEndpoint?.id ?? dropTarget.insertAfterEndpointId,
    }
  }

  // Match the library drop behavior when Alt-dragging a multiplier-capable
  // endpoint back onto its own symbol. A drop elsewhere remains a real copy;
  // a self-drop grows the existing endpoint instead of creating a duplicate.
  const sameSymbolMultiplierResult = incrementAltDragSameSymbolEndpoint(
    sourceEndpoint,
    targetEndpoint,
    deps,
  )
  if (sameSymbolMultiplierResult !== null) return sameSymbolMultiplierResult

  if (
    sourceEndpoint.domoticaChildProps &&
    !dropTarget.domoticaOutput &&
    !targetEndpoint?.domoticaChildProps
  ) {
    const domoticaSlotTarget = findDomoticaOutputDropTarget(deps.layoutTree, position)
    if (domoticaSlotTarget?.domoticaOutput) {
      dropTarget = domoticaSlotTarget
    }
  }

  if (sourceEndpoint.symbol === 'junction_panel') {
    const sourceCircuitId = store.findCircuitForEndpoint(sourceEndpointId)?.circuit.id
    const targetCircuitId = dropTarget.circuitId ??
      (dropTarget.protectionId
        ? deps.getProtectionById(dropTarget.protectionId)?.circuits?.[0]?.id
        : undefined)
    const targetCircuit = targetCircuitId ? store.getCircuitById(targetCircuitId) : undefined
    if (
      !targetCircuit ||
      targetCircuitId === sourceCircuitId ||
      circuitContainsJunctionPanelIdentity(targetCircuit, getJunctionIdentity(sourceEndpoint))
    ) return false
  }

  const createdEndpointIds: string[] = []
  let dropRejected = false
  let createdDomoticaParentId: string | undefined
  let createdDomoticaCircuitId: string | undefined

  executeDropBehavior(
    symbolMeta as Parameters<typeof executeDropBehavior>[0],
    dropTarget,
    deps.project,
    deps.t,
    {
      addPanel: store.addPanel,
      addProtection: store.addProtection,
      addCircuit: deps.addCircuit,
      addCircuitToProtection: store.addCircuitToProtection,
      updateEndpoint: store.updateEndpoint,
      addPlacement: deps.addPlacement,
      setSelection: deps.setSelection,
      getFloorById: deps.getFloorById,
      updateFloor: store.updateFloor,
      getCircuitById: (circuitId) => store.getCircuitById(circuitId) || null,
      getProtectionById: deps.getProtectionById,
      addTrunkDevice: store.addTrunkDevice,
      addSupplyTrunkDevice: store.addSupplyTrunkDevice,
      addGroundTrunkDevice: store.addGroundTrunkDevice,
      ensureJunctionPanelPlacementForLabel: store.ensureJunctionPanelPlacementForLabel,
      updateCircuit: deps.updateCircuit,
      updateProtection: store.updateProtection,
      updateInstallation: store.updateInstallation,
      addSupplyAssembly: store.addSupplyAssembly,
      replaceSupplyAssembly: store.replaceSupplyAssembly,
      moveCircuitOnMainBus: store.moveCircuitOnMainBus,
      moveCircuitToSecondaryBus: store.moveCircuitToSecondaryBus,
      deleteEndpoint: store.deleteEndpoint,
      addEendraadNote: store.addEendraadNote,
      addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) => {
        const latestSource = store.getEndpointById(sourceEndpointId) ?? sourceEndpoint
        const clonedSource = JSON.parse(JSON.stringify(latestSource)) as Endpoint
        const isDomoticaChildDrop = !!endpoint.domoticaChildProps
        const merged: Endpoint = domoticaGroupClone
          ? {
              ...domoticaGroupClone.parent,
              ...endpoint,
              id: endpoint.id,
              placements: domoticaGroupClone.parent.placements,
              // The parent is normalized immediately by addEndpoint. Keep its
              // slots empty until the copied children have been inserted, or
              // normalization would discard references to children not added yet.
              domoticaProps: domoticaGroupClone.parent.domoticaProps
                ? {
                    ...domoticaGroupClone.parent.domoticaProps,
                    endpointChildEndpointIds: [],
                    controlChildEndpointIds: [],
                  }
                : undefined,
              controlledEndpointIds: domoticaGroupClone.parent.controlledEndpointIds,
            }
          : {
              ...clonedSource,
              ...endpoint,
              placements: [],
              domoticaChildProps: endpoint.domoticaChildProps,
              converterDcConnection: endpoint.converterDcConnection,
              id: endpoint.id,
            }
        if (domoticaGroupClone) {
          delete merged.domoticaChildProps
          createdDomoticaParentId = merged.id
          createdDomoticaCircuitId = circuitId
        }
        if (!isDomoticaChildDrop) {
          delete (merged as { label?: string }).label
        }
        store.addEndpoint(circuitId, merged, insertAfterEndpointId, branchOpts)
        createdEndpointIds.push(merged.id)
        deps.setSelection({ type: 'endpoint', ids: [merged.id] })
      },
      onDropRejected: (message) => {
        dropRejected = true
        useDialogStore.getState().openDialog({
          type: 'info',
          title: deps.t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
          message,
          confirmLabel: deps.t('common.ok', { defaultValue: 'OK' }),
          variant: 'warning',
        })
      },
    },
    {
      canvas: 'eendraad',
      placementMethod: 'alt_drag_duplicate',
    }
  )

  if (dropRejected || createdEndpointIds.length === 0) return false

  if (domoticaGroupClone && createdDomoticaParentId && createdDomoticaCircuitId) {
    let insertAfterEndpointId: string = createdDomoticaParentId
    for (const sourceChild of domoticaGroupClone.children) {
      const childClone: Endpoint = JSON.parse(JSON.stringify(sourceChild))
      if (childClone.domoticaChildProps) {
        childClone.domoticaChildProps = {
          ...childClone.domoticaChildProps,
          parentEndpointId: createdDomoticaParentId,
        }
      }
      store.addEndpoint(createdDomoticaCircuitId, childClone, insertAfterEndpointId)
      createdEndpointIds.push(childClone.id)
      insertAfterEndpointId = childClone.id
    }

    if (store.getCircuitById(createdDomoticaCircuitId)) {
      // updateEndpoint normalizes inside Immer, after every copied child exists.
      // Calling normalizeDomoticaCircuit on the frozen store snapshot here would
      // throw and leave the new parent with its temporary empty slot list.
      store.updateEndpoint(createdDomoticaParentId, {
        domoticaProps: domoticaGroupClone.parent.domoticaProps,
      })
      const circuitWithSlots = store.getCircuitById(createdDomoticaCircuitId)
      if (!circuitWithSlots) return false
      deps.updateCircuit(createdDomoticaCircuitId, {
        endpoints: circuitWithSlots.endpoints,
        branches: circuitWithSlots.branches,
      })
    }
    deps.setSelection({ type: 'endpoint', ids: [createdDomoticaParentId] })
  }

  const project = store.currentProject
  if (project) {
    const ui = useUIStore.getState()
    ensureSitplanPlacementsForEndpoints(
      project,
      createdEndpointIds,
      (id) => store.getEndpointById(id),
      (endpointId, placement) => store.addPlacement(endpointId, placement),
      {
        activeFloorId: ui.activeFloorId,
        viewportLayout: ui.viewportLayout,
        planCanvasViewportPx: ui.planCanvasViewportPx,
        planView: ui.planView,
      }
    )
  }

  return true
}

/** True when a protection drag would drop on / preview over its own row (invalid). */
export function protectionDropTargetHitsSource(
  sourceProtectionId: string,
  target: DropTarget | null | undefined,
  getProtectionById: (id: string) => ProtectionDevice | null | undefined
): boolean {
  if (!target || !sourceProtectionId) return false
  if (target.protectionId === sourceProtectionId) return true

  // Main / secondary bus insertion targets carry a parent `circuitId` for the host
  // row — that must not be treated as "dropping on yourself".
  const isBusInsertionTarget =
    target.type === 'mainBus' ||
    (target.type === 'circuit' &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0)
  if (isBusInsertionTarget) return false

  const source = getProtectionById(sourceProtectionId)
  if (!source) return false
  if (
    target.circuitId &&
    (source.circuits ?? []).some((circuit) => circuit.id === target.circuitId)
  ) {
    // The upper self-target is a supported topology rotation: local endpoint
    // content moves above this protection while the circuit remains nested.
    if (target.type === 'circuit' && target.insertAfterCircuitContent === true) return false
    return true
  }
  return false
}

/** Normalize protection hit / main-bus segment into a mainBus drop target (same as move-drag). */
export function resolveProtectionDropTargetForPosition(
  layoutTree: LayoutTree,
  position: Point,
  findDropTarget: (tree: LayoutTree, pos: Point) => { target: DropTarget },
  getPanelById: (panelId: string) => Panel | undefined,
  sourceProtectionId?: string,
  getProtectionById?: (id: string) => ProtectionDevice | null | undefined,
  options?: { nestOnRcd?: boolean }
): DropTarget | null {
  let { target } = findDropTarget(layoutTree, position)
  if (!target?.panelId) return null

  const protectionId =
    target.type === 'protection' ? target.protectionId : (target as DropTarget).protectionId
  const panel = target.panelId ? getPanelById(target.panelId) : undefined
  const explicitTargetProtection = panel?.protections.find(
    (protection) => protection.id === protectionId
  )
  const targetProtection =
    explicitTargetProtection ??
    (target.type === 'circuit' &&
    target.circuitId &&
    (typeof target.circuitTrunkSegmentIndex === 'number' ||
      target.insertAfterCircuitContent === true)
      ? panel?.protections.find(
          (protection) =>
            (protection.type === 'RCD' || protection.type === 'RCBO') &&
            protection.circuits?.some((circuit) => circuit.id === target.circuitId)
        )
      : undefined)
  const isRcdTarget = targetProtection?.type === 'RCD' || targetProtection?.type === 'RCBO'
  if (options?.nestOnRcd && isRcdTarget) {
    const anchorCircuit = targetProtection.circuits?.[0]
    if (!anchorCircuit) return null
    target = {
      ...target,
      type: 'circuit',
      circuitId: anchorCircuit.id,
      protectionId: targetProtection.id,
      secondaryBusInsertIndex:
        target.secondaryBusInsertIndex ?? anchorCircuit.subCircuitIds?.length ?? 0,
      secondaryBusItemCount:
        target.secondaryBusItemCount ?? anchorCircuit.subCircuitIds?.length ?? 0,
    }
  }
  if (protectionId && target.panelId && !(options?.nestOnRcd && isRcdTarget)) {
    if (panel) {
      const mainBusItemsNorm = getMainBusItemsWithIndices(panel)
      const idx = mainBusItemsNorm.findIndex(
        (item) => item.type === 'protection' && item.id === protectionId
      )
      if (idx >= 0) {
        target = {
          ...target,
          type: 'mainBus',
          panelId: target.panelId,
          mainBusInsertIndex: idx + 1,
        }
      }
    }
  }

  if (
    sourceProtectionId &&
    getProtectionById &&
    protectionDropTargetHitsSource(sourceProtectionId, target, getProtectionById)
  ) {
    return null
  }

  return target
}

/**
 * After duplicateProtectionLeft the new row starts at the end of the bus; move it to the
 * segment the user dropped on (same algorithm as library protection drops).
 */
export function repositionDuplicatedProtectionToDropTarget(
  newProtectionId: string,
  dropTarget: DropTarget,
  getPanelById: (panelId: string) => Panel | undefined,
  getProtectionById: (id: string) => ProtectionDevice | undefined,
  moveCircuitOnMainBus: (panelId: string, circuitId: string, direction: 'left' | 'right') => void,
  moveCircuitToSecondaryBus?: (
    panelId: string,
    parentCircuitId: string,
    circuitId: string,
    insertIndex: number
  ) => void,
  options?: { skipMainBus?: boolean }
): void {
  if (
    !options?.skipMainBus &&
    dropTarget.type === 'mainBus' &&
    dropTarget.panelId &&
    typeof dropTarget.mainBusInsertIndex === 'number'
  ) {
    const panel = getPanelById(dropTarget.panelId)
    const protection = getProtectionById(newProtectionId)
    if (!panel || !protection) return

    const circuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
    if (!circuitId) return

    const order = getMainBusOrder(panel)
    const currentIndex = order.findIndex(
      (item) =>
        (item.type === 'protection' && item.id === newProtectionId) ||
        (item.type === 'circuit' && item.id === circuitId)
    )
    if (currentIndex < 0) return

    const beforeCount = dropTarget.mainBusItemCount ?? Math.max(0, order.length - 1)
    const totalAfter = beforeCount + 1
    const desiredIndex = clamp(dropTarget.mainBusInsertIndex, 0, totalAfter - 1)
    const movesLeft = Math.max(0, currentIndex - desiredIndex)
    for (let i = 0; i < movesLeft; i++) {
      moveCircuitOnMainBus(dropTarget.panelId, circuitId, 'left')
    }
    return
  }

  if (
    moveCircuitToSecondaryBus &&
    dropTarget.type === 'circuit' &&
    dropTarget.panelId &&
    dropTarget.circuitId &&
    typeof dropTarget.secondaryBusInsertIndex === 'number' &&
    dropTarget.secondaryBusInsertIndex >= 0
  ) {
    const panel = getPanelById(dropTarget.panelId)
    const protection = getProtectionById(newProtectionId)
    const newCircuitId =
      panel && protection ? pickRepresentativeCircuitIdForMainBusMove(panel, protection) : undefined
    if (newCircuitId) {
      moveCircuitToSecondaryBus(
        dropTarget.panelId,
        dropTarget.circuitId,
        newCircuitId,
        dropTarget.secondaryBusInsertIndex
      )
    }
  }
}
