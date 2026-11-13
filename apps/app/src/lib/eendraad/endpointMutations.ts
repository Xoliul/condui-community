import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Endpoint, Panel, Placement, ProtectionDevice } from '@/types/schema'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import {
  EENDRAAD_NAMING_DEBUG,
  findCircuitById,
  findCircuitOwner,
  findEndpointById,
  collectDomoticaEndpointIdsForDeletion,
  getOwningProtectionForCircuit,
  maybeApplyAutomaticEendraadNamingForPanel,
  normalizeDomoticaCircuit,
} from '@/lib/eendraad/projectElectricalDomain'
import { logger } from '@/lib/logger'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { findMutablePlacementOwner } from '@/lib/plan/placementMutations'
import { deletePlacementsFromProject } from '@/lib/plan/placementMutations'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  replacePlanWireRoutesForProject,
  selectProjectPlanWireRoutes,
} from '@/lib/projectV2/planWiring'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { generateId } from '@/utils/id'
import { getNextAvailableCircuitCode } from '@/utils/project'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  endpointMergeSettingsMatchEndpoints,
  endpointsShareMergeFamily,
} from '@/lib/eendraad/sameSymbolAddMore'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { connectEmptyProtectionWire } from '@/lib/wires/connectEmptyProtectionWire'

/**
 * Detach an ordinary AC point for immediate reinsertion by the shared drop engine. This is
 * deliberately not deletion: placements, controls, frames and wire identities still own this
 * endpoint. Call only inside the transaction that reinserts it before any reconciliation.
 * Specialized branch devices, DC connections and domotica keep their existing move paths.
 */
export function takeOrdinaryEndpointForMove(
  project: ProjectV2,
  endpointId: string,
  target: DropTarget
): Endpoint | null {
  if (!target.circuitId || !['circuit', 'endpoint'].includes(target.type ?? '') ||
      target.domoticaOutput || target.domoticaChildDropIntent || target.dcBusId ||
      target.converterDcConnection || target.wireDomain === 'DC') return null
  const panels = getEditableProjectElectricalPanels(project)
  const source = panels.flatMap((panel) => findEndpointById(panel, endpointId) ?? []).at(0)
  const destination = findCircuitOwner(panels, target.circuitId)?.circuit
  if (!source || !destination || source.circuit.supplySource || destination.supplySource) return null
  const endpoint = source.endpoint
  if (!['switch', 'light_point', 'socket'].includes(endpoint.type) ||
      endpoint.domoticaChildProps || endpoint.converterDcConnection || endpoint.socketProps?.modular) return null
  if (['domotica', 'panel_distribution', 'junction_panel', 'junction_box', 'solar_panel', 'battery',
      'transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(endpoint.symbol ?? '')) return null
  if ([source.circuit, destination].some((circuit) => circuit.trunkDevices?.some((device) =>
    device.type === 'dc_bus' || ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(device.symbol ?? '')))) return null
  const sourceBranch = source.circuit.branches?.find((branch) => branch.endpointIds.includes(endpointId))
  if (sourceBranch?.dcBusId || sourceBranch?.branchDevices?.length) return null
  const destinationEndpoints = destination.endpoints.filter((entry) =>
    entry.id === target.endpointId || target.branchEndpoints?.includes(entry.id))
  if (destinationEndpoints.some((entry) => entry.domoticaChildProps || entry.symbol === 'domotica' ||
      entry.converterDcConnection)) return null
  if (destination.branches?.some((branch) =>
    (branch.dcBusId || branch.branchDevices?.length) &&
    branch.endpointIds.some((id) => id === target.endpointId || target.branchEndpoints?.includes(id)))) return null
  if (source.circuit.id !== destination.id) {
    // Explicit control overrides are circuit-local. Retain identities, but do not leave
    // an old circuit claiming control of a point that has moved to another circuit.
    for (const peer of source.circuit.endpoints) {
      if (peer.id !== endpointId && peer.controlledEndpointIds?.includes(endpointId))
        peer.controlledEndpointIds = peer.controlledEndpointIds.filter((id) => id !== endpointId)
    }
    if (endpoint.controlledEndpointIds) {
      const destinationIds = new Set(destination.endpoints.map((entry) => entry.id))
      endpoint.controlledEndpointIds = endpoint.controlledEndpointIds.filter((id) => destinationIds.has(id))
    }
  }
  source.circuit.endpoints = source.circuit.endpoints.filter((entry) => entry.id !== endpointId)
  source.circuit.branches = source.circuit.branches?.map((branch) => ({
    ...branch,
    endpointIds: branch.endpointIds.filter((id) => id !== endpointId),
  })).filter((branch) => branch.endpointIds.length > 0 || branch.keepEmpty)
  return endpoint
}

export interface AssignEndpointsToCircuitResult {
  movedEndpointIds: string[]
  changedCircuitIds: string[]
  targetCircuitId: string
}

export type MergeEndpointIntoMultiplierResult =
  | { status: 'merged'; sourceCircuitId: string; targetCircuitId: string; targetEndpointId: string }
  | { status: 'blocked' }

export interface EndpointCircuitResult {
  circuitId: string
  endpoints: Endpoint[]
  branches: Circuit['branches']
}

function rebindManualRoutesToFinalCircuits(project: ProjectV2, circuitIds: readonly string[]): void {
  const changedCircuitIds = new Set(circuitIds)
  const routes = selectProjectPlanWireRoutes(project)
  const panels = getEditableProjectElectricalPanels(project)
  const endpointOwners = new Map<string, { endpoint: Endpoint; circuit: Circuit; panel: Panel }>()
  for (const panel of panels) {
    for (const circuitId of changedCircuitIds) {
      const circuitOwner = findCircuitOwner([panel], circuitId)
      if (!circuitOwner) continue
      for (const endpoint of circuitOwner.circuit.endpoints) {
        endpointOwners.set(endpoint.id, {
          endpoint,
          circuit: circuitOwner.circuit,
          panel: circuitOwner.panel,
        })
      }
    }
  }
  let routesRebound = false
  const reboundRoutes = routes.map((route) => {
    if (!changedCircuitIds.has(route.circuitId)) return route
    const fromId = route.from.endpointId
    const toId = route.to.endpointId
    if (!fromId || !toId) return route
    const from = endpointOwners.get(fromId)
    const to = endpointOwners.get(toId)
    if (!from || !to || from.circuit.id !== to.circuit.id) return route
    const branch = from.circuit.branches?.find(
      (candidate) => candidate.endpointIds.includes(fromId) && candidate.endpointIds.includes(toId)
    )
    const next = {
      ...route,
      circuitId: from.circuit.id,
      panelId: from.panel.id,
      ...(branch ? { branchId: branch.id } : { branchId: undefined }),
    }
    if (JSON.stringify(next) !== JSON.stringify(route)) routesRebound = true
    return next
  })
  if (routesRebound) replacePlanWireRoutesForProject(project, reboundRoutes)
}

/** Apply all endpoint topology updates before healing cross-circuit plan wiring once. */
export function applyEndpointCircuitResultsInProject(
  project: ProjectV2,
  updates: readonly EndpointCircuitResult[]
): string[] {
  const panels = getEditableProjectElectricalPanels(project)
  const changed = updates.flatMap((update) => {
    const owner = findCircuitOwner(panels, update.circuitId)
    if (!owner) return []
    owner.circuit.endpoints = update.endpoints.map((endpoint) => ({
      ...endpoint,
      placements: (endpoint.placements ?? []).map((placement) => ({ ...placement })),
    }))
    owner.circuit.branches = update.branches?.map((branch) => ({
      ...branch,
      endpointIds: [...branch.endpointIds],
      ...(branch.branchDevices
        ? { branchDevices: branch.branchDevices.map((device) => ({ ...device })) }
        : {}),
    }))
    return [owner.circuit]
  })
  if (!changed.length) return []
  for (const circuit of changed) {
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
    normalizeDomoticaCircuit(circuit)
    syncDerivedEndpointFlags(circuit)
  }
  rebindManualRoutesToFinalCircuits(project, updates.map((update) => update.circuitId))
  // Every moved endpoint is present in its final circuit before wiring reconciliation runs.
  healPlanWiring(project)
  if (changed.some((circuit) => circuit.endpoints.some((endpoint) => endpoint.placements?.length))) {
    syncPanelAndSituationPlanDeviceVisibility(project)
  }
  const panelIds = new Set(
    updates.flatMap((update) => {
      const owner = findCircuitOwner(panels, update.circuitId)
      return owner ? [owner.panel.id] : []
    })
  )
  for (const panelId of panelIds) maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  return [...new Set(updates.map((update) => update.circuitId))]
}

/** Expand selected domotica modules to include their existing output descendants. */
export function expandDomoticaEndpointAssignment(
  project: ProjectV2,
  endpointIds: readonly string[]
): string[] {
  const panels = getEditableProjectElectricalPanels(project)
  const expanded = new Set(endpointIds)
  for (const endpointId of endpointIds) {
    for (const panel of panels) {
      const owner = findEndpointById(panel, endpointId)
      if (!owner) continue
      for (const childId of collectDomoticaEndpointIdsForDeletion(owner.circuit, [endpointId])) {
        expanded.add(childId)
      }
      break
    }
  }
  return [...expanded]
}

/** Preserve the old child-replace gesture that combines matching multiplier endpoints. */
export function mergeEndpointIntoMultiplierInProject(
  project: ProjectV2,
  sourceEndpointId: string,
  targetEndpointId: string,
  activeFloorId: string | null,
  newId: () => string
): MergeEndpointIntoMultiplierResult | null {
  const panels = getEditableProjectElectricalPanels(project)
  let source: ReturnType<typeof findEndpointById> | null = null
  let target: ReturnType<typeof findEndpointById> | null = null
  for (const panel of panels) {
    source ??= findEndpointById(panel, sourceEndpointId) ?? null
    target ??= findEndpointById(panel, targetEndpointId) ?? null
  }
  if (!source || !target || !source.endpoint.domoticaChildProps || !target.endpoint.domoticaChildProps) {
    return null
  }
  if (!endpointsShareMergeFamily(source.endpoint, target.endpoint)) return null
  if (!endpointMergeSettingsMatchEndpoints(source.endpoint, target.endpoint)) {
    return { status: 'blocked' }
  }
  if (
    source.endpoint.symbol !== target.endpoint.symbol ||
    !endpointSupportsMultiplier(target.endpoint)
  ) {
    return null
  }

  const placements = target.endpoint.placements ?? []
  const desiredCount = getEndpointMultiplier(target.endpoint) + 1
  const floorId =
    activeFloorId ?? placements[0]?.floorId ?? selectProjectBuildingFloors(project)[0]?.id
  const basePlacement =
    placements.find((placement) => placement.floorId === floorId) ?? placements[0]
  if (desiredCount > placements.length && (!floorId || !basePlacement)) return { status: 'blocked' }
  if (desiredCount < placements.length) {
    deletePlacementsFromProject(
      project,
      placements.slice(desiredCount).map((placement) => placement.id)
    )
  } else if (desiredCount > placements.length) {
    const nextPlacements = [...placements]
    const start = placements.length
    for (let index = start; index < desiredCount; index += 1) {
      const step = index - start + 1
      nextPlacements.push({
        ...basePlacement!,
        id: newId(),
        floorId: floorId!,
        pos: {
          x: basePlacement!.pos.x + 24 * step,
          y: basePlacement!.pos.y + 24 * step,
        },
      })
    }
    target.endpoint.placements = nextPlacements
  }
  if (!deleteEndpointsFromProject(project, [sourceEndpointId])) return { status: 'blocked' }
  syncPanelAndSituationPlanDeviceVisibility(project)
  return {
    status: 'merged',
    sourceCircuitId: source.circuit.id,
    targetCircuitId: target.circuit.id,
    targetEndpointId,
  }
}

/**
 * Assigns existing endpoints to another circuit while retaining endpoint identity and linked
 * plan/wire data. The optional id factory is used only for newly-created branch identities.
 */
export function assignEndpointsToCircuitInProject(
  project: ProjectV2,
  endpointIds: readonly string[],
  targetCircuitId: string,
  newId: () => string = generateId
): AssignEndpointsToCircuitResult | null {
  if (new Set(endpointIds).size !== endpointIds.length) return null
  const uniqueIds = expandDomoticaEndpointAssignment(project, endpointIds)
  if (uniqueIds.length === 0) return null

  const panels = getEditableProjectElectricalPanels(project)
  const targetOwner = panels
    .map((panel) => findCircuitById(panel, targetCircuitId))
    .find((found) => found != null)
  if (!targetOwner || targetOwner.circuit.code === 'PANEL') return null

  const sources = uniqueIds.map((id) => {
    for (const panel of panels) {
      const found = findEndpointById(panel, id)
      if (found) return found
    }
    return null
  })
  if (sources.some((source) => !source)) return null
  if (sources.some((source) => source && isDomoticaPanelFeedEndpoint(source.endpoint) &&
    source.circuit.id !== targetCircuitId)) return null

  const movableIds = uniqueIds.filter((_, index) => sources[index]!.circuit.id !== targetCircuitId)
  if (movableIds.length === 0) return null
  const circuitsById = new Map<string, Circuit>()
  circuitsById.set(targetCircuitId, targetOwner.circuit)
  for (const source of sources) if (source) circuitsById.set(source.circuit.id, source.circuit)

  const moved = new Map<string, Endpoint>()
  for (const id of movableIds) {
    const source = sources[uniqueIds.indexOf(id)]!
    const endpoint = source.circuit.endpoints.find((candidate) => candidate.id === id)
    if (!endpoint) return null
    moved.set(id, endpoint)
  }

  const firstEndpointOnTarget = targetOwner.circuit.endpoints.length === 0
  const existingTargetEndpointIds = targetOwner.circuit.endpoints.map((endpoint) => endpoint.id)
  const targetHadAlphabeticCode =
    !!targetOwner.circuit.code && /^[A-Z]+$/.test(targetOwner.circuit.code.trim())
  if (firstEndpointOnTarget && !targetHadAlphabeticCode) {
    const owner = findCircuitOwner(panels, targetCircuitId)
    targetOwner.circuit.code = getNextAvailableCircuitCode(project, owner?.panel.id)
  }

  // Resolve all source members before mutation, then apply one atomic multi-circuit edit.
  for (const source of sources) {
    if (!source || source.circuit.id === targetCircuitId) continue
    const removing = new Set(
      movableIds.filter((id) => sources[uniqueIds.indexOf(id)]!.circuit.id === source.circuit.id)
    )
    if (!removing.size) continue
    source.circuit.endpoints = source.circuit.endpoints.filter(
      (endpoint) => !removing.has(endpoint.id)
    )
    if (source.circuit.branches) {
      source.circuit.branches = source.circuit.branches
        .map((branch) => ({
          ...branch,
          endpointIds: branch.endpointIds.filter((id) => !removing.has(id)),
        }))
        .filter((branch) => branch.endpointIds.length > 0 || branch.keepEmpty)
    }
  }
  for (const id of movableIds) {
    const endpoint = moved.get(id)!
    endpoint.label = ''
    targetOwner.circuit.endpoints.push(endpoint)
  }

  const targetBranches = targetOwner.circuit.branches
  if (!targetBranches?.length) {
    const [firstId, ...remainingIds] = movableIds
    if (!firstId) return null
    const newBranches = [
      { id: newId(), label: '', endpointIds: [...existingTargetEndpointIds, firstId] },
    ]
    for (const id of remainingIds) {
      newBranches.push({ id: newId(), label: '', endpointIds: [id] })
    }
    targetOwner.circuit.branches = newBranches
  } else {
    for (const endpointId of movableIds) {
      targetBranches.push({ id: newId(), label: '', endpointIds: [endpointId] })
    }
  }

  syncSequentialEndpointBranchLabelsToCircuit(targetOwner.circuit)
  for (const [circuitId, circuit] of circuitsById) {
    if (circuitId === targetCircuitId) continue
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
  }
  const parentProtection = getOwningProtectionForCircuit(targetOwner, targetCircuitId)
  if (parentProtection && !parentProtection.label?.trim())
    parentProtection.label = targetOwner.circuit.code
  for (const circuit of circuitsById.values()) {
    normalizeDomoticaCircuit(circuit)
    syncDerivedEndpointFlags(circuit)
  }
  rebindManualRoutesToFinalCircuits(project, [...circuitsById.keys()])
  healPlanWiring(project)
  if (movableIds.some((id) => moved.get(id)?.placements?.length)) {
    syncPanelAndSituationPlanDeviceVisibility(project)
  }
  return {
    movedEndpointIds: movableIds,
    changedCircuitIds: [...circuitsById.keys()],
    targetCircuitId,
  }
}

/**
 * Adds an endpoint to a circuit: assigns the circuit code on the first endpoint, keeps branches,
 * domotica rows, labels, plan wiring and automatic naming in sync. `insertAfterEndpointId`:
 * null inserts first, an id inserts after it, undefined appends. Returns the circuit id, or null
 * when the circuit does not exist. Shared by the store action and project commands.
 */
export function addEndpointToProject(
  project: ProjectV2,
  circuitId: string,
  endpoint: Endpoint,
  insertAfterEndpointId?: string | null,
  branchOpts?: { forceNewBranch?: boolean },
  newId: () => string = generateId,
): string | null {
  const panels = getEditableProjectElectricalPanels(project)
  for (const panel of panels) {
    const result = findCircuitById(panel, circuitId)
    if (result) {
      if (!endpoint.placements) {
        endpoint.placements = []
      }
      const circuitCodeBefore = result.circuit.code
      // If this is the first real endpoint on this circuit and the circuit
      // doesn't have a proper alphabetic code yet, assign one now. This is
      // the canonical moment when circuits/protections start to "consume"
      // labels in the global sequence.
      const isFirstEndpoint = result.circuit.endpoints.length === 0
      const hasAlphabeticCode = !!result.circuit.code && /^[A-Z]+$/.test(result.circuit.code.trim())
      let assignedCircuitCode: string | null = null

      const usesMainBusAutomaticNaming = result.circuit.supplySource?.kind !== 'converter-backup'

      if (isFirstEndpoint && !hasAlphabeticCode && usesMainBusAutomaticNaming) {
        const circuitOwner = project
          ? findCircuitOwner(getProjectElectricalPanels(project), circuitId)
          : null
        if (project) {
          const newCode = getNextAvailableCircuitCode(project, circuitOwner?.panel.id)
          assignedCircuitCode = newCode
          result.circuit.code = newCode
        }
      }

      // Branch point labels (A1, A2, …) are assigned after branch topology settles below.

      // If this circuit lives under a protection that currently has no label,
      // assign the protection label to match the circuit code once it gains endpoints.
      const parentProtection = getOwningProtectionForCircuit(result, circuitId)
      const protectionHadLabel =
        !!parentProtection?.label && parentProtection.label.trim().length > 0
      const syncedProtectionFromCode =
        !!parentProtection &&
        !protectionHadLabel &&
        !!result.circuit.code &&
        result.circuit.code.trim().length > 0
      if (parentProtection && (!parentProtection.label || parentProtection.label.trim() === '')) {
        parentProtection.label = result.circuit.code
      }

      if (EENDRAAD_NAMING_DEBUG) {
        const p = result.parent
        const parentKind =
          'symbol' in p && (p as Panel).symbol === 'panel_distribution' ? 'panel' : 'protection'
        const parentId = parentKind === 'panel' ? (p as Panel).id : (p as ProtectionDevice).id

        logger.info('[eendraad naming] addEndpoint', {
          circuitId,
          endpointId: endpoint.id,
          loopRootPanelId: panel.id,
          circuitParentKind: parentKind,
          circuitParentId: parentId,
          isFirstEndpoint,
          hadAlphabeticCircuitCode: hasAlphabeticCode,
          circuitCodeBefore,
          circuitCodeAfter: result.circuit.code,
          assignedNewCircuitCode: assignedCircuitCode,
          skipNewCodeReason: !isFirstEndpoint
            ? 'not_first_endpoint_on_circuit'
            : hasAlphabeticCode
              ? 'circuit_already_has_A_Z_code'
              : !project
                ? 'no_project'
                : null,
          endpointBranchLabel: endpoint.label,
          parentProtectionResolved: !!parentProtection,
          parentProtectionId: parentProtection?.id ?? null,
          protectionHadLabelBefore: protectionHadLabel,
          protectionLabelAfter: parentProtection?.label ?? null,
          syncedProtectionLabelFromCircuitCode: syncedProtectionFromCode,
          hintIfStillBlank:
            !parentProtection && parentKind === 'panel'
              ? 'circuit lives on panel.circuits (not under a protection); MCB letter only syncs for circuits under protection.circuits'
              : !result.circuit.code?.trim()
                ? 'circuit.code still empty — no alphabetic code was assigned (see skipNewCodeReason / hadAlphabeticCircuitCode)'
                : parentProtection && !protectionHadLabel && !(parentProtection.label ?? '').trim()
                  ? 'protection resolved but label still empty after sync (check circuit.code above)'
                  : protectionHadLabel
                    ? 'protection already had a label; not overwritten'
                    : null,
        })
      }
      if (parentProtection) {
        connectEmptyProtectionWire(project, result.circuit, parentProtection.id, endpoint.id)
      }
      // Insert at position or append (all mutation inside set() so state is writable)
      // null = insert at very start, string = insert after that endpoint, undefined = append
      if (insertAfterEndpointId === null) {
        result.circuit.endpoints.unshift(endpoint)
      } else if (insertAfterEndpointId) {
        const insertIndex = result.circuit.endpoints.findIndex(
          (e) => e.id === insertAfterEndpointId
        )
        if (insertIndex >= 0) {
          result.circuit.endpoints.splice(insertIndex + 1, 0, endpoint)
        } else {
          result.circuit.endpoints.push(endpoint)
        }
      } else {
        result.circuit.endpoints.push(endpoint)
      }

      // Keep branches in sync so the new endpoint appears on the one-line diagram.
      // Callers (e.g. PropertiesPanel enabling domotica control wire) only call addEndpoint;
      // the drop handler additionally calls updateCircuit for branches, but addEndpoint must
      // maintain branch consistency when used alone.
      const endpointId = endpoint.id
      let branches = result.circuit.branches ?? []
      if (branches.length === 0) {
        branches = [
          {
            id: newId(),
            label: result.circuit.endpoints[0]?.label ?? '',
            endpointIds: result.circuit.endpoints.map((e) => e.id),
          },
        ]
        result.circuit.branches = branches
      } else {
        if (
          branchOpts?.forceNewBranch ||
          (insertAfterEndpointId === undefined && !endpoint.domoticaChildProps)
        ) {
          const newBranch = {
            id: newId(),
            label: '',
            endpointIds: [endpointId],
          }
          branches.push(newBranch)
          result.circuit.branches = branches
        } else if (insertAfterEndpointId === null) {
          const first = branches[0]
          if (first) {
            first.endpointIds.unshift(endpointId)
          }
        } else if (insertAfterEndpointId) {
          const branch = branches.find((b) => b.endpointIds.includes(insertAfterEndpointId))
          if (branch) {
            const idx = branch.endpointIds.indexOf(insertAfterEndpointId)
            branch.endpointIds.splice(idx + 1, 0, endpointId)
          } else {
            const last = branches[branches.length - 1]
            if (last) {
              last.endpointIds.push(endpointId)
            }
          }
        } else {
          const last = branches[branches.length - 1]
          if (last) {
            last.endpointIds.push(endpointId)
          }
        }
      }

      // Skip normalization when adding a domotica child: the drop handler will update the
      // parent's child list at the correct index and then call normalizeDomoticaForCircuit.
      if (!endpoint.domoticaChildProps) {
        normalizeDomoticaCircuit(result.circuit)
      }
      syncDerivedEndpointFlags(result.circuit)
      syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
      healPlanWiring(project)
      if (endpoint.placements.length > 0) {
        syncPanelAndSituationPlanDeviceVisibility(project)
      }
      const ownerPanel = findCircuitOwner(panels, circuitId)?.panel
      if (ownerPanel) {
        maybeApplyAutomaticEendraadNamingForPanel(project, ownerPanel.id)
      }
      return result.circuit.id
    }
  }
  return null
}

/**
 * Adds an endpoint together with its first plan placement. A placement id that already exists
 * is replaced, so a re-entered drop never creates a second placement with the same identity.
 * Returns the placement id used, or null when the circuit does not exist.
 */
export function addEndpointWithPlacementToProject(
  project: ProjectV2,
  circuitId: string,
  endpoint: Endpoint,
  placement: Placement,
  insertAfterEndpointId?: string | null,
  branchOpts?: { forceNewBranch?: boolean }
): string | null {
  const placementToAdd = findMutablePlacementOwner(project, placement.id)
    ? { ...placement, id: generateId() }
    : { ...placement }
  const added = addEndpointToProject(
    project,
    circuitId,
    { ...endpoint, placements: [...(endpoint.placements ?? []), placementToAdd] },
    insertAfterEndpointId,
    branchOpts
  )
  return added ? placementToAdd.id : null
}
