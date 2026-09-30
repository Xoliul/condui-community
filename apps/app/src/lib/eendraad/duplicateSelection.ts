/**
 * Resolve eendraad selection into a duplicate action and run it.
 */

import { getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  duplicateBranchAboveOnCircuit,
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import {
  ensureSitplanPlacementsForEndpoints,
  sitplanPlacementsForDuplicateClone,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import type { Branch, Circuit, Endpoint, Panel, TrunkDevice } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { generateId } from '@/utils'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import { findSupplyDeviceContainer } from '@/lib/eendraad/projectElectricalDomain'
import { clonePlacementsForDuplicate } from '@/lib/eendraad/duplicateSitplanHelpers'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  getSupplyDeviceMultiplier,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
import type {
  ProjectStoreActions,
  ProjectStoreGetters,
} from '@/lib/eendraad/contextMenuActions'

export type EendraadDuplicateResult = {
  selection: Selection
} | null

function protectionIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  return selection.ids.find((id) => get.getProtectionById?.(id))
}

function circuitIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  if (selection.type === 'circuit' && selection.ids.length === 1) {
    return selection.ids[0]
  }
  for (const id of selection.ids) {
    if (get.getCircuitById(id)) return id
  }
  return undefined
}

function endpointIdsShareCircuit(
  endpointIds: string[],
  get: ProjectStoreGetters,
): { circuitId: string } | null {
  if (endpointIds.length === 0) return null
  let circuitId: string | undefined
  for (const eid of endpointIds) {
    const ep = get.getEndpointById(eid)
    if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
    const info = get.findCircuitForEndpoint(eid)
    if (!info) return null
    if (circuitId == null) {
      circuitId = info.circuit.id
    } else if (circuitId !== info.circuit.id) {
      return null
    }
  }
  return circuitId ? { circuitId } : null
}

function protectionForCircuitId(get: ProjectStoreGetters, circuitId: string): string | undefined {
  const project = get.getCurrentProject?.()
  if (!project) return undefined
  const walk = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      for (const prot of panel.protections) {
        if (prot.circuits?.some((c) => c.id === circuitId)) return prot.id
      }
      for (const sub of panel.subPanels ?? []) {
        const found = walk([sub])
        if (found) return found
      }
    }
    return undefined
  }
  return walk(getProjectElectricalPanels(project))
}

function expandSupplyBranchDevices(
  devices: Array<{ device: TrunkDevice; circuit: null }>,
  get: ProjectStoreGetters,
): Array<{ device: TrunkDevice; circuit: null }> {
  const project = get.getCurrentProject?.()
  if (!project) return devices

  const expanded = new Map(devices.map((entry) => [entry.device.id, entry]))
  for (const { device } of devices) {
    if (!device.supplyDcBusId || !device.supplyDcBusBranchId) continue
    const container = findSupplyDeviceContainer(project, device.id)
    for (const candidate of container?.devices ?? []) {
      if (
        candidate.supplyDcBusId === device.supplyDcBusId &&
        candidate.supplyDcBusBranchId === device.supplyDcBusBranchId
      ) {
        expanded.set(candidate.id, { device: candidate, circuit: null })
      }
    }
  }

  return [...expanded.values()].sort(
    (left, right) => (left.device.trunkPosition ?? 0) - (right.device.trunkPosition ?? 0),
  )
}

function expandCircuitBranchDevices(
  devices: Array<{ device: TrunkDevice; circuit: Circuit | null }>,
): Array<{ device: TrunkDevice; circuit: Circuit | null }> {
  const circuit = devices.find((entry) => entry.circuit)?.circuit
  if (!circuit?.trunkDevices) return devices

  const expanded = new Map(devices.map((entry) => [entry.device.id, entry]))
  for (const { device } of devices) {
    if (!device.supplyDcBusId || !device.supplyDcBusBranchId) continue
    for (const candidate of circuit.trunkDevices) {
      if (
        candidate.supplyDcBusId === device.supplyDcBusId &&
        candidate.supplyDcBusBranchId === device.supplyDcBusBranchId
      ) {
        expanded.set(candidate.id, { device: candidate, circuit })
      }
    }
  }

  return [...expanded.values()].sort(
    (left, right) => (left.device.trunkPosition ?? 0) - (right.device.trunkPosition ?? 0),
  )
}

function branchForDevice(circuit: Circuit, deviceId: string) {
  return circuit.branches?.find((branch) =>
    branch.branchDevices?.some((device) => device.id === deviceId),
  )
}

function cloneBranchEndpointForDuplicate(
  source: Endpoint,
): Endpoint {
  const clone = JSON.parse(JSON.stringify(source)) as Endpoint
  clone.id = generateId()
  clone.label = ''
  clone.placements = sitplanPlacementsForDuplicateClone(source)
  // A copied branch owns a new endpoint chain. Do not leave control/domotica
  // references pointing into the source branch.
  clone.controlledEndpointIds = undefined
  if (clone.domoticaProps) {
    clone.domoticaProps = {
      ...clone.domoticaProps,
      endpointChildEndpointIds: undefined,
      controlChildEndpointIds: undefined,
    }
  }
  clone.domoticaChildProps = undefined
  return clone
}

function duplicateDcBusBranchSuffix(
  circuit: Circuit,
  sourceBranch: Branch,
  selectedDeviceIndex: number,
): {
  branch: Branch
  devices: TrunkDevice[]
  endpoints: Endpoint[]
} {
  const sourceDevices = sourceBranch.branchDevices ?? []
  const devices = sourceDevices.slice(selectedDeviceIndex).map((sourceDevice, index) => ({
    ...JSON.parse(JSON.stringify(sourceDevice)),
    id: generateId(),
    trunkPosition: index,
    placements: sourceDevice.placements?.length
      ? clonePlacementsForDuplicate(sourceDevice.placements, {
          symbolType: sourceDevice.symbol,
        })
      : [],
  })) as TrunkDevice[]

  const endpoints = sourceBranch.endpointIds.flatMap((endpointId) => {
    const source = circuit.endpoints.find((endpoint) => endpoint.id === endpointId)
    return source ? [cloneBranchEndpointForDuplicate(source)] : []
  })

  return {
    branch: {
      id: generateId(),
      label: '',
      endpointIds: endpoints.map((endpoint) => endpoint.id),
      ...(sourceBranch.dcBusId ? { dcBusId: sourceBranch.dcBusId } : {}),
      branchDevices: devices,
    },
    devices,
    endpoints,
  }
}

function isOrdinaryDcBusSourceDevice(device: TrunkDevice, circuit: Circuit): boolean {
  if (
    device.converterDcConnection ||
    device.supplyDcBusId ||
    !['conversion', 'storage', 'generation'].includes(device.type)
  ) {
    return false
  }
  const busIndex = circuit.trunkDevices?.findIndex((candidate) => candidate.type === 'dc_bus') ?? -1
  const deviceIndex = circuit.trunkDevices?.findIndex((candidate) => candidate.id === device.id) ?? -1
  if (busIndex < 0 || deviceIndex < 0 || deviceIndex >= busIndex) return false
  const bus = circuit.trunkDevices?.[busIndex]
  return bus?.trunkPosition === device.trunkPosition
}

function cloneTrunkDeviceAsDcBusEndpoint(source: TrunkDevice): Endpoint {
  const clone: Endpoint = {
    id: generateId(),
    type: 'fixed_appliance',
    symbol: source.symbol,
    label: '',
    placements: source.placements?.length
      ? clonePlacementsForDuplicate(source.placements, { symbolType: source.symbol })
      : [],
    ...(source.notes !== undefined ? { notes: source.notes } : {}),
    ...(source.labelNotes !== undefined ? { labelNotes: source.labelNotes } : {}),
    ...(source.panelLabel !== undefined ? { panelLabel: source.panelLabel } : {}),
    ...(source.installationDate !== undefined ? { installationDate: source.installationDate } : {}),
    ...(source.installationDateSuppressed !== undefined
      ? { installationDateSuppressed: source.installationDateSuppressed }
      : {}),
    ...(source.rulesetDateOverride !== undefined
      ? { rulesetDateOverride: source.rulesetDateOverride }
      : {}),
    ...(source.symbolLabelDisplay !== undefined
      ? { symbolLabelDisplay: source.symbolLabelDisplay }
      : {}),
    ...(source.conversionProps !== undefined
      ? { energyConversionProps: source.conversionProps }
      : {}),
    ...(source.batteryProps !== undefined ? { batteryProps: source.batteryProps } : {}),
    ...(source.solarPanelProps !== undefined ? { solarPanelProps: source.solarPanelProps } : {}),
  }
  return clone
}

/** Whether Duplicate should appear for this eendraad selection. */
export function canDuplicateEendraadSelection(
  selection: Selection,
  get: ProjectStoreGetters,
): boolean {
  if (selection.ids.length === 0) return false
  if (selection.type === 'supply' || selection.type === 'ground') return false
  if (selection.ids.includes('supply') || selection.ids.includes('ground')) return false
  if (selection.ids.some((id) =>
    get.getEndpointById(id)?.symbol === 'junction_panel' ||
    get.getTrunkDeviceById(id)?.device.symbol === 'junction_panel'
  )) return false

  if (protectionIdInSelection(selection, get)) return true
  if (selection.type === 'circuit' && selection.ids.length === 1 && get.getCircuitById(selection.ids[0]!)) {
    return !!protectionForCircuitId(get, selection.ids[0]!)
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  if (endpointIds.length === selection.ids.length && endpointIds.length > 0) {
    return endpointIdsShareCircuit(endpointIds, get) != null
  }

  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))
  if (trunkIds.length === selection.ids.length && trunkIds.length > 0) {
    const first = get.getTrunkDeviceById(trunkIds[0]!)
    if (!first) return false
    if (trunkIds.length === 1 && first.device.type === 'dc_bus') return false
    const isSupply = first.isSupplyDevice
    const isGround = first.isGroundDevice
    const circuitId = first.circuit?.id
    for (let i = 1; i < trunkIds.length; i++) {
      const r = get.getTrunkDeviceById(trunkIds[i]!)
      if (!r) return false
      if (isSupply && !r.isSupplyDevice) return false
      if (isGround && !r.isGroundDevice) return false
      if (circuitId && r.circuit?.id !== circuitId) return false
    }
    return true
  }

  return false
}

function finishSitplanForNewEndpoints(endpointIds: string[], get: ProjectStoreGetters): void {
  const project = get.getCurrentProject?.()
  if (!project || endpointIds.length === 0) return
  const store = useProjectStore.getState()
  const ui = useUIStore.getState()
  ensureSitplanPlacementsForEndpoints(
    project,
    endpointIds,
    (id) => store.getEndpointById(id),
    (endpointId, placement) => store.addPlacement(endpointId, placement),
    {
      activeFloorId: ui.activeFloorId,
      viewportLayout: ui.viewportLayout,
      planCanvasViewportPx: ui.planCanvasViewportPx,
      planView: ui.planView,
    },
  )
}

export function runEendraadDuplicate(
  selection: Selection,
  get: ProjectStoreGetters,
  actions: ProjectStoreActions,
  duplicateProtection: (protectionId: string) => string | null,
  withSingleUndoEntry?: (fn: () => boolean, options?: { sessionLabel?: string }) => boolean,
): EendraadDuplicateResult {
  if (selection.ids.length === 0) return null
  if (selection.ids.some((id) =>
    get.getEndpointById(id)?.symbol === 'junction_panel' ||
    get.getTrunkDeviceById(id)?.device.symbol === 'junction_panel'
  )) return null

  const protId =
    protectionIdInSelection(selection, get) ??
    (() => {
      const circuitId = circuitIdInSelection(selection, get)
      return circuitId ? protectionForCircuitId(get, circuitId) : undefined
    })()

  if (protId) {
    const newProtId = duplicateProtection(protId)
    if (!newProtId) return null
    return { selection: { type: 'protection', ids: [newProtId] } }
  }

  const runBatch = (fn: () => EendraadDuplicateResult): EendraadDuplicateResult => {
    if (!withSingleUndoEntry) return fn()
    let result: EendraadDuplicateResult = null
    withSingleUndoEntry(
      () => {
        result = fn()
        return result != null
      },
      { sessionLabel: 'duplicate selection' },
    )
    return result
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))

  // A DC bus is a structural carrier for its branches, not a duplicable device.
  // Keeping this guard in the executor as well as the capability check makes Ctrl-D
  // a no-op even when it is invoked directly rather than through the context menu.
  if (trunkIds.length === selection.ids.length && trunkIds.length === 1) {
    const selected = get.getTrunkDeviceById(trunkIds[0]!)
    if (selected?.device.type === 'dc_bus') return null
  }

  if (endpointIds.length === selection.ids.length && endpointIds.length > 0) {
    return runBatch(() => {
    const info = get.findCircuitForEndpoint(endpointIds[0]!)
    if (!info) return null
    const project = get.getCurrentProject?.() ?? null
    const deps = {
      getCircuitById: get.getCircuitById,
      getEndpointById: get.getEndpointById,
      addEndpoint: actions.addEndpoint,
      updateCircuit: actions.updateCircuit,
      setSelection: actions.setSelection,
    }

    if (endpointIds.length === 1) {
      const eid = endpointIds[0]!
      const ep = get.getEndpointById(eid)
      if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
      if (endpointSupportsMultiplier(ep) && actions.syncEndpointMultiplierCount) {
        // A legacy or freshly imported DC endpoint may not have a sitplan
        // instance yet. The library's add-more behavior still treats it as a
        // multiplier, so create its first placement before incrementing.
        if (ep.placements.length === 0) finishSitplanForNewEndpoints([ep.id], get)
        const latestEndpoint = get.getEndpointById(ep.id) ?? ep
        const incremented = actions.syncEndpointMultiplierCount(
          ep.id,
          getEndpointMultiplier(latestEndpoint) + 1,
        )
        if (incremented) {
          return { selection: { type: 'endpoint', ids: [ep.id] } }
        }
      }
      const r = duplicateEndpointOnCircuit(
        project,
        {
          circuitId: info.circuit.id,
          sourceEndpointId: eid,
          context: 'eendraad',
          placement: { mode: 'new_branch', order: 'before_source_branch' },
        },
        deps,
      )
      if (!r.ok || !r.newEndpointId) return null
      finishSitplanForNewEndpoints([r.newEndpointId], get)
      return { selection: { type: 'endpoint', ids: [r.newEndpointId] } }
    }

    const branches = getCircuitBranches(info.circuit)
    const branch = branches.find((b) => endpointIds.every((eid) => b.some((ep) => ep.id === eid)))
    if (branch) {
      const orderedIds = branch.map((ep) => ep.id).filter((id) => endpointIds.includes(id))
      const r = duplicateBranchAboveOnCircuit(
        project,
        { circuitId: info.circuit.id, sourceEndpointIds: orderedIds, selectNew: false },
        deps,
      )
      if (!r.ok || !r.newEndpointIds?.length) return null
      finishSitplanForNewEndpoints(r.newEndpointIds, get)
      return { selection: { type: 'endpoint', ids: r.newEndpointIds } }
    }

    const sortedSourceIds = [...endpointIds].sort((a, b) => {
      const idxA = branches.findIndex((br) => br.some((ep) => ep.id === a))
      const idxB = branches.findIndex((br) => br.some((ep) => ep.id === b))
      return idxA - idxB
    })
    const newEndpointIds: string[] = []
    for (const eid of sortedSourceIds) {
      const ep = get.getEndpointById(eid)
      if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
      const r = duplicateEndpointOnCircuit(
        project,
        {
          circuitId: info.circuit.id,
          sourceEndpointId: eid,
          context: 'eendraad',
          placement: { mode: 'new_branch', order: 'before_source_branch' },
          selectNew: false,
        },
        deps,
      )
      if (!r.ok || !r.newEndpointId) return null
      newEndpointIds.push(r.newEndpointId)
    }
    if (newEndpointIds.length === 0) return null
    finishSitplanForNewEndpoints(newEndpointIds, get)
    return { selection: { type: 'endpoint', ids: newEndpointIds } }
    })
  }

  if (trunkIds.length === selection.ids.length && trunkIds.length > 0) {
    return runBatch(() => {
    const first = get.getTrunkDeviceById(trunkIds[0]!)
    if (!first) return null
    const { circuit, isSupplyDevice, isGroundDevice } = first
    const selectedDevices = trunkIds
      .map((id) => get.getTrunkDeviceById(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0))

    // Branch-local devices have a different owner than circuit trunk devices. Ctrl-D
    // duplicates the selected device as a sibling DC-rail branch, including everything
    // downstream of it on the source branch. Inserting it back into branchDevices made
    // protections behave differently from inverters and created an inline duplicate.
    if (circuit && !isSupplyDevice && !isGroundDevice) {
      const selectedBranchEntries = selectedDevices.map((entry) => ({
        ...entry,
        branch: branchForDevice(circuit, entry.device.id),
      }))
      const branchIds = new Set(
        selectedBranchEntries
          .map((entry) => entry.branch?.id)
          .filter((id): id is string => typeof id === 'string'),
      )
      if (
        selectedBranchEntries.every((entry) => entry.branch != null) &&
        branchIds.size === 1
      ) {
        const sourceBranch = selectedBranchEntries[0]!.branch!
        const sourceBranchDevices = sourceBranch.branchDevices ?? []
        const selectedIds = new Set(selectedDevices.map((entry) => entry.device.id))
        const sourceIndices = sourceBranchDevices
          .map((device, index) => (selectedIds.has(device.id) ? index : -1))
          .filter((index) => index >= 0)
        if (sourceIndices.length === 0) return null
        const selectedDeviceIndex = Math.min(...sourceIndices)
        const duplicated = duplicateDcBusBranchSuffix(
          circuit,
          sourceBranch,
          selectedDeviceIndex,
        )
        const sourceBranchIndex = (circuit.branches ?? []).findIndex(
          (branch) => branch.id === sourceBranch.id,
        )
        const nextBranches = (circuit.branches ?? []).map((branch) => ({
          ...branch,
          endpointIds: [...branch.endpointIds],
        }))
        if (sourceBranchIndex < 0) return null
        nextBranches.splice(sourceBranchIndex + 1, 0, duplicated.branch)
        actions.updateCircuit(circuit.id, {
          endpoints: [...circuit.endpoints, ...duplicated.endpoints],
          branches: nextBranches,
        })
        finishSitplanForNewEndpoints(
          duplicated.endpoints.map((endpoint) => endpoint.id),
          get,
        )
        return {
          selection: {
            type: 'trunkDevice',
            ids: duplicated.devices.map((device) => device.id),
          },
        }
      }
    }

    const devices =
      isSupplyDevice && selectedDevices.every((entry) => entry.isSupplyDevice)
        ? expandSupplyBranchDevices(
            selectedDevices.map(({ device }) => ({ device, circuit: null })),
            get,
        ).map((entry) => ({ ...entry, isSupplyDevice: true }))
        : !isSupplyDevice && !isGroundDevice
          ? expandCircuitBranchDevices(selectedDevices)
          : selectedDevices

    // An ordinary circuit DC rail is represented by endpoint branches, while
    // its upstream converter is still a circuit trunk device. Duplicating that
    // converter must follow the same topology as dropping its library symbol on
    // the rail; inserting another trunk row would place it below the rail.
    if (
      circuit &&
      !isSupplyDevice &&
      !isGroundDevice &&
      selectedDevices.length === 1 &&
      isOrdinaryDcBusSourceDevice(selectedDevices[0]!.device, circuit)
    ) {
      const sourceDevice = selectedDevices[0]!.device
      // An inverter is a DC -> AC boundary. When it is the trunk source of an
      // ordinary DC rail, the protection below and the rail above already
      // occupy both valid sides of it; duplicating it would create a misleading
      // sibling branch rather than a meaningful serial device.
      if (sourceDevice.symbol === 'inverter') return null
      const dcBus = circuit.trunkDevices?.find((device) => device.type === 'dc_bus')
      if (dcBus) {
        const clone = cloneTrunkDeviceAsDcBusEndpoint(sourceDevice)
        const nextBranches = (circuit.branches ?? []).map((branch) => ({
          ...branch,
          endpointIds: [...branch.endpointIds],
        }))
        const lastDcBusBranchIndex = nextBranches.reduce(
          (last, branch, index) => (branch.dcBusId === dcBus.id ? index : last),
          -1,
        )
        nextBranches.splice(lastDcBusBranchIndex + 1, 0, {
          id: generateId(),
          label: '',
          dcBusId: dcBus.id,
          endpointIds: [clone.id],
        })
        actions.updateCircuit(circuit.id, {
          endpoints: [...circuit.endpoints, clone],
          branches: nextBranches,
        })
        finishSitplanForNewEndpoints([clone.id], get)
        return { selection: { type: 'endpoint', ids: [clone.id] } }
      }
    }

    // DC-bus solar panels and batteries represent physical multiples on one
    // branch. Ctrl-D follows the same meaning as the library's add-more drop:
    // grow that device's multiplier instead of creating another branch.
    if (
      isSupplyDevice &&
      selectedDevices.length === 1 &&
      selectedDevices[0]?.device.supplyDcBusId &&
      supportsSupplyDeviceMultiplier(selectedDevices[0].device) &&
      actions.syncSupplyDeviceMultiplierCount
    ) {
      const sourceDevice = selectedDevices[0].device
      const incremented = actions.syncSupplyDeviceMultiplierCount(
        sourceDevice.id,
        getSupplyDeviceMultiplier(sourceDevice) + 1,
      )
      if (incremented) {
        return { selection: { type: 'trunkDevice', ids: [sourceDevice.id] } }
      }
    }

    const minPos = Math.min(...devices.map((d) => d.device.trunkPosition ?? 0))
    const newIds: string[] = []

    if (isSupplyDevice && get.getSupplyTrunkDeviceIndex) {
      const project = get.getCurrentProject?.()
      const supplyIndexForDevice = (id: string): number => {
        const container = project ? findSupplyDeviceContainer(project, id) : null
        const containerIndex = container?.devices.findIndex((device) => device.id === id) ?? -1
        return containerIndex >= 0 ? containerIndex : get.getSupplyTrunkDeviceIndex!(id)
      }
      // The selected device can be a later member of its DC-bus branch. Once
      // the whole branch is expanded, insert before the branch's first member;
      // inserting at the selected member would interleave the clone with the
      // original branch and make the layout engine place it incorrectly.
      const indices = devices.map(({ device }) => supplyIndexForDevice(device.id)).filter((i) => i >= 0)
      const insertIndex = indices.length > 0 ? Math.min(...indices) : 0
      const duplicatedSupplyBranchIds = new Map<string, string>()
      const sourceSupplyTarget =
        first.supplyFeedScope || first.supplyPanelId
          ? { panelId: first.supplyPanelId, feedScope: first.supplyFeedScope }
          : undefined
      for (let i = 0; i < devices.length; i++) {
        const sourceDevice = devices[i]!.device
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(sourceDevice)),
          id: generateId(),
          trunkPosition: insertIndex + i,
          placements: sourceDevice.placements?.length
            ? clonePlacementsForDuplicate(sourceDevice.placements, {
                symbolType: sourceDevice.symbol,
              })
            : sourceDevice.placements,
        }
        // A DC-bus branch id groups devices into one serial branch. A duplicate
        // of a device already attached to a bus must start a new sibling branch,
        // rather than continuing the source device's branch.
        if (clone.supplyDcBusId) {
          const sourceBranchId = clone.supplyDcBusBranchId
          if (sourceBranchId) {
            const branchKey = `${clone.supplyDcBusId}:${sourceBranchId}`
            const duplicateBranchId =
              duplicatedSupplyBranchIds.get(branchKey) ?? generateId()
            duplicatedSupplyBranchIds.set(branchKey, duplicateBranchId)
            clone.supplyDcBusBranchId = duplicateBranchId
          } else {
            clone.supplyDcBusBranchId = generateId()
          }
        }
        actions.addSupplyTrunkDevice(clone, insertIndex + i, sourceSupplyTarget)
        newIds.push(clone.id)
      }
    } else if (isGroundDevice) {
      const project = get.getCurrentProject?.()
      const panels = project ? getProjectElectricalPanels(project) : []
      const installation = project ? getProjectElectricalInstallation(project) : undefined
      const firstOwner = trunkIds[0]
        ? findGroundTrunkDeviceOwner(panels, installation, trunkIds[0])
        : undefined
      const indices = trunkIds
        .map((id) => findGroundTrunkDeviceOwner(panels, installation, id)?.index ?? -1)
        .filter((i) => i >= 0)
      const insertIndex = indices.length > 0 ? Math.min(...indices) : 0
      for (let i = 0; i < devices.length; i++) {
        const sourceDevice = devices[i]!.device
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(sourceDevice)),
          id: generateId(),
          trunkPosition: insertIndex + i,
          placements: sourceDevice.placements?.length
            ? clonePlacementsForDuplicate(sourceDevice.placements, {
                symbolType: sourceDevice.symbol,
              })
            : sourceDevice.placements,
        }
        actions.addGroundTrunkDevice(clone, insertIndex + i, firstOwner?.panel?.id)
        newIds.push(clone.id)
      }
    } else if (circuit && actions.updateTrunkDevice) {
      const isCircuitDcBranch = devices.some(
        (entry) => entry.device.supplyDcBusId && entry.device.supplyDcBusBranchId,
      )
      const circuitInsertIndex = isCircuitDcBranch
        ? Math.min(...devices.map((entry) => entry.device.trunkPosition ?? 0))
        : minPos

      if (isCircuitDcBranch) {
        // Make room for the complete cloned DC branch before adding it. The
        // circuit action sorts by trunkPosition, so shifting first prevents
        // source and clone devices from sharing positions during insertion.
        for (const existing of circuit.trunkDevices ?? []) {
          if ((existing.trunkPosition ?? 0) < circuitInsertIndex) continue
          actions.updateTrunkDevice(circuit.id, existing.id, {
            trunkPosition: (existing.trunkPosition ?? 0) + devices.length,
          })
        }
      }

      const duplicatedCircuitBranchId = isCircuitDcBranch ? generateId() : undefined
      for (let i = 0; i < devices.length; i++) {
        const sourceDevice = devices[i]!.device
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(sourceDevice)),
          id: generateId(),
          trunkPosition: circuitInsertIndex + i,
          placements: sourceDevice.placements?.length
            ? clonePlacementsForDuplicate(sourceDevice.placements, {
                symbolType: sourceDevice.symbol,
              })
            : sourceDevice.placements,
        }
        if (duplicatedCircuitBranchId && clone.supplyDcBusId) {
          clone.supplyDcBusBranchId = duplicatedCircuitBranchId
        }
        actions.addTrunkDevice(circuit.id, clone)
        newIds.push(clone.id)
      }
      if (!isCircuitDcBranch) {
        for (const id of trunkIds) {
          const r = get.getTrunkDeviceById(id)
          if (r?.circuit?.id === circuit.id) {
            actions.updateTrunkDevice(circuit.id, id, {
              trunkPosition: (r.device.trunkPosition ?? 0) + devices.length,
            })
          }
        }
      }
    }

    if (newIds.length > 0) {
      return { selection: { type: 'trunkDevice', ids: newIds } }
    }
    return null
    })
  }

  return null
}
