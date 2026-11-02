import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import type { ElectricalDuplicateElementsInput } from '@/lib/commands/project/commands/electricalDuplicateElements'
import type { CommandEnv } from '@/lib/commands/project/types'
import { CommandError } from '@/lib/commands/project/types'
import { getEditableProjectElectricalPanels, getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { findCircuitById, findEndpointById, normalizeDomoticaCircuit, panelGridModuleRefKey } from '@/lib/eendraad/projectElectricalDomain'
import { walkPanels, findPanelById } from '@/lib/panel/panelTree'
import { updatePanelGridSlotsInProject } from '@/lib/panel/panelGridMutations'
import { duplicateEndpointOnCircuit, duplicateBranchAboveOnCircuit } from '@/lib/eendraad/duplicateEndpoint'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { addTrunkDeviceToProject } from '@/lib/eendraad/circuitMutations'
import { addGroundTrunkDeviceInProject, addSupplyTrunkDeviceInProject } from '@/lib/projectMutations/storeActions'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { clonePlacementsForDuplicate, ensureSitplanPlacementsAt } from '@/lib/eendraad/duplicateSitplanHelpers'
import { remapClonedEndpointDependencies } from '@/lib/eendraad/cloneCircuitContent'
import { duplicateEndpointAtDropTargetInProject } from '@/lib/eendraad/duplicateEndpointAtDropTarget'
import { moveSupplyTrunkDeviceAtDropTarget } from '@/lib/eendraad/supplyTrunkDeviceMove'
import { reconcileDirectConverterDcDevices, reconcileSupplyAssemblyBranchProtections } from '@/lib/supplyAssembly/editorIntegration'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { queryAllSupplyTrunkDevices as querySupply } from '@/lib/feedTopology'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import { getSymbolById } from '@/lib/symbols'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { getEndpointMultiplierPlacementChanges } from '@/lib/properties/propertyActions'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { findSupplyDeviceContainer } from '@/lib/eendraad/projectElectricalDomain'
import { getSupplyDeviceMaxMultiplier, getSupplyDeviceSerialNumbers, supportsSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { getDefaultSupplyConverterAcPhaseAssignment, getSupplyInverterUnitPhaseAssignments } from '@/lib/supplyAssembly/supplyConverterPhases'
import { getCircuitBranches } from '@/lib/layout/endpointChains'

function circuitFor(project: ProjectV2, id: string): Circuit | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, id)
    if (found) return found.circuit
  }
  return undefined
}

function endpointFor(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, id)
    if (found) return found
  }
  return undefined
}

function deviceFor(project: ProjectV2, id: string) {
  for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
    const circuits = [...(panel.circuits ?? []), ...(panel.protections ?? []).flatMap((p) => p.circuits ?? [])]
    for (const circuit of circuits) {
      const device = [...(circuit.trunkDevices ?? []), ...(circuit.branches ?? []).flatMap((b) => b.branchDevices ?? [])].find((d) => d.id === id)
      if (device) return { device, circuit }
    }
  }
  const supply = querySupply(project).find((device) => device.id === id)
  if (supply) {
    const installation = getProjectElectricalInstallation(project)
    const root = installation?.feedTopology?.rootFeeds.find((feed) => feed.trunkDevices?.some((device) => device.id === id))
    const shared = installation?.feedTopology?.sharedFeed.trunkDevices?.some((device) => device.id === id) || installation?.mainSupply?.supplyTrunkDevices?.some((device) => device.id === id)
    return { device: supply, circuit: null, isSupplyDevice: true as const, supplyPanelId: root?.panelId, supplyFeedScope: root ? 'root' as const : shared ? 'shared' as const : undefined }
  }
  const ground = walkPanels(getEditableProjectElectricalPanels(project))
    .flatMap((panel) => panel.groundTrunkDevices ?? [])
    .find((device) => device.id === id)
  const installationGround = getProjectElectricalInstallation(project)?.groundTrunkDevices?.find((device) => device.id === id)
  return ground || installationGround ? { device: (ground ?? installationGround)!, circuit: null, isGroundDevice: true as const } : undefined
}

function cloneEndpoint(source: Endpoint, newId: () => string): Endpoint {
  const clone = JSON.parse(JSON.stringify(source)) as Endpoint
  clone.id = newId()
  clone.placements = (source.placements ?? []).map((placement) => ({ ...placement, id: newId() }))
  return clone
}

function cloneDevice(source: TrunkDevice, newId: () => string): TrunkDevice {
  const clone = JSON.parse(JSON.stringify(source)) as TrunkDevice
  clone.id = newId()
  clone.placements = source.placements?.length
    ? clonePlacementsForDuplicate(source.placements, { symbolType: source.symbol }, newId)
    : source.placements
  if (clone.junctionPanelTerminal) clone.junctionPanelTerminal.id = newId()
  return clone
}

function cloneTrunkDeviceAsDcBusEndpoint(source: TrunkDevice, newId: () => string): Endpoint {
  return {
    id: newId(),
    type: 'fixed_appliance',
    symbol: source.symbol,
    label: '',
    placements: source.placements?.length
      ? clonePlacementsForDuplicate(source.placements, { symbolType: source.symbol }, newId)
      : [],
    ...(source.notes !== undefined ? { notes: source.notes } : {}),
    ...(source.labelNotes !== undefined ? { labelNotes: source.labelNotes } : {}),
    ...(source.panelLabel !== undefined ? { panelLabel: source.panelLabel } : {}),
    ...(source.installationDate !== undefined ? { installationDate: source.installationDate } : {}),
    ...(source.installationDateSuppressed !== undefined ? { installationDateSuppressed: source.installationDateSuppressed } : {}),
    ...(source.rulesetDateOverride !== undefined ? { rulesetDateOverride: source.rulesetDateOverride } : {}),
    ...(source.symbolLabelDisplay !== undefined ? { symbolLabelDisplay: source.symbolLabelDisplay } : {}),
    ...(source.conversionProps !== undefined ? { energyConversionProps: source.conversionProps } : {}),
    ...(source.batteryProps !== undefined ? { batteryProps: source.batteryProps } : {}),
    ...(source.solarPanelProps !== undefined ? { solarPanelProps: source.solarPanelProps } : {}),
  }
}

export function applyElectricalDuplicateElements(
  project: ProjectV2,
  input: ElectricalDuplicateElementsInput,
  env: CommandEnv,
) {
  const clonedEndpoints: string[] = []
  const clonedDevices: string[] = []
  const relatedCircuits = new Set<string>()
  const target = input.target

  if (target.type === 'sourceSelection') {
    if (input.items[0]!.kind === 'endpoint') {
      const sourceIds = input.items.map((item) => item.id)
      if (sourceIds.length === 1) {
        const sourceInfo = endpointFor(project, sourceIds[0]!)!
        let source = sourceInfo.endpoint
        if (endpointSupportsMultiplier(source)) {
          if (!source.placements.length) {
            const sitplan = input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null }
            ensureSitplanPlacementsAt(project, [source.id], (id) => endpointFor(project, id)?.endpoint, (id, placement) => {
              const endpoint = endpointFor(project, id)?.endpoint
              if (endpoint) endpoint.placements.push(placement)
            }, sitplan, env.newId)
            source = endpointFor(project, source.id)!.endpoint
          }
          const targetCount = getEndpointMultiplier(source) + 1
          const floorId = input.sitplan?.activeFloorId ?? source.placements[0]?.floorId ?? selectProjectBuildingFloors(project)[0]?.id
          if (!floorId) throw new CommandError('check_failed', 'A floor is required to add an endpoint instance', { reason: 'floor_not_found' })
          const changes = getEndpointMultiplierPlacementChanges(source.placements, targetCount, floorId, env.newId)
          if (!changes || changes.removeIds.length) throw new CommandError('check_failed', 'Endpoint instance could not be added', { reason: 'multiplier_update_failed' })
          source.placements.push(...changes.add)
          clonedEndpoints.push(source.id)
          relatedCircuits.add(endpointFor(project, source.id)!.circuit.id)
        } else {
          const source = endpointFor(project, sourceIds[0]!)!
          const result = duplicateEndpointOnCircuit(project, {
            circuitId: source.circuit.id, sourceEndpointId: source.endpoint.id, context: 'eendraad',
            placement: { mode: 'new_branch', order: 'before_source_branch' }, selectNew: false,
          }, {
            newId: env.newId,
            getCircuitById: (id) => circuitFor(project, id),
            getEndpointById: (id) => endpointFor(project, id)?.endpoint,
            addEndpoint: (circuitId, endpoint, after) => addEndpointToProject(project, circuitId, endpoint, after, undefined, env.newId),
            updateCircuit: (circuitId, updates) => updateCircuitInProject(project, circuitId, updates),
            setSelection: () => undefined,
          })
          if (!result.ok || !result.newEndpointId) throw new CommandError('check_failed', 'Endpoint could not be duplicated', { reason: result.reason ?? 'duplicate_failed' })
          clonedEndpoints.push(result.newEndpointId)
          relatedCircuits.add(source.circuit.id)
        }
      } else {
        const ids = sourceIds
        const circuitId = endpointFor(project, ids[0]!)!.circuit.id
        const sourceCircuit = circuitFor(project, circuitId)!
        const branches = getCircuitBranches(sourceCircuit).map((branch) => branch.map((endpoint) => endpoint.id))
        const sameBranch = branches.find((endpointIds) => ids.every((id) => endpointIds.includes(id)))
        const deps = {
          newId: env.newId,
          getCircuitById: (id: string) => circuitFor(project, id),
          getEndpointById: (id: string) => endpointFor(project, id)?.endpoint,
          addEndpoint: (targetCircuitId: string, endpoint: Endpoint, after?: string | null) => addEndpointToProject(project, targetCircuitId, endpoint, after, undefined, env.newId),
          updateCircuit: (targetCircuitId: string, updates: Partial<Circuit>) => updateCircuitInProject(project, targetCircuitId, updates),
          setSelection: () => undefined,
        }
        if (sameBranch) {
          const orderedIds = sameBranch.filter((id) => ids.includes(id))
          const result = duplicateBranchAboveOnCircuit(project, { circuitId, sourceEndpointIds: orderedIds, selectNew: false }, deps)
          if (!result.ok || !result.newEndpointIds?.length) throw new CommandError('check_failed', 'Endpoint branch could not be duplicated', { reason: result.reason ?? 'duplicate_failed' })
          clonedEndpoints.push(...result.newEndpointIds)
        } else {
          const orderedIds = [...ids].sort((a, b) => branches.findIndex((branch) => branch.includes(a)) - branches.findIndex((branch) => branch.includes(b)))
          for (const id of orderedIds) {
            const result = duplicateEndpointOnCircuit(project, { circuitId, sourceEndpointId: id, context: 'eendraad', placement: { mode: 'new_branch', order: 'before_source_branch' }, selectNew: false }, deps)
            if (!result.ok || !result.newEndpointId) throw new CommandError('check_failed', 'Endpoint could not be duplicated', { reason: result.reason ?? 'duplicate_failed' })
            clonedEndpoints.push(result.newEndpointId)
          }
        }
        relatedCircuits.add(circuitId)
      }
      ensureSitplanPlacementsAt(project, clonedEndpoints, (id) => endpointFor(project, id)?.endpoint, (id, placement) => {
        const clone = endpointFor(project, id)?.endpoint
        if (clone) clone.placements.push(placement)
      }, input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null }, env.newId)
    } else {
      const deviceEntries = input.items.map((item) => ({ item, source: deviceFor(project, item.id)! }))
      const first = deviceEntries[0]!.source
      const supplyMultiplierPlacement = first.isSupplyDevice ? first.device.placements?.[0] : undefined
      const supplyMultiplierFloor = supplyMultiplierPlacement?.floorId ?? input.sitplan?.activeFloorId ?? selectProjectBuildingFloors(project)[0]?.id
      const canAddSupplyMultiplier = !!first.isSupplyDevice && deviceEntries.length === 1 && !!first.device.supplyDcBusId &&
        supportsSupplyDeviceMultiplier(first.device) && !!supplyMultiplierPlacement && !!supplyMultiplierFloor &&
        (first.device.placements?.length ?? 0) + 1 <= getSupplyDeviceMaxMultiplier(first.device)
      if (canAddSupplyMultiplier) {
        const device = first.device
        const targetCount = (device.placements?.length ?? 0) + 1
        const sourcePlacement = supplyMultiplierPlacement!
        const floorId = supplyMultiplierFloor!
        const placements = [...(device.placements ?? [])]
        placements.push({ ...sourcePlacement, id: env.newId(), floorId, pos: { x: sourcePlacement.pos.x + 24, y: sourcePlacement.pos.y + 24 } })
        const serialNumbers = getSupplyDeviceSerialNumbers(device).slice(0, targetCount)
        while (serialNumbers.length < targetCount) serialNumbers.push('')
        const certificationPatch = { serialNumber: targetCount === 1 ? serialNumbers[0] || undefined : undefined, serialNumbers: targetCount > 1 ? serialNumbers : undefined }
        if (device.symbol === 'battery') device.batteryProps = { ...(device.batteryProps ?? {}), ...certificationPatch }
        else if (device.symbol === 'solar_panel') device.solarPanelProps = { ...(device.solarPanelProps ?? {}), ...certificationPatch }
        else {
          const system = getProjectElectricalInstallation(project)?.nominalVoltage.system ?? '1N~'
          const oldAssignments = getSupplyInverterUnitPhaseAssignments(device, system, targetCount)
          device.conversionProps = {
            ...(device.conversionProps ?? {}),
            ...certificationPatch,
            acPhaseAssignment: targetCount >= 3 ? getDefaultSupplyConverterAcPhaseAssignment(system) : targetCount === 1 ? oldAssignments[0] : undefined,
            acPhaseAssignments: targetCount === 2 ? oldAssignments : undefined,
          }
        }
        device.placements = placements
        clonedDevices.push(device.id)
      } else if (first.isGroundDevice) {
        const installation = getProjectElectricalInstallation(project)
        const panel = [...walkPanels(getEditableProjectElectricalPanels(project))].find((candidate) => candidate.groundTrunkDevices?.some((device) => device.id === deviceEntries[0]!.item.id))
        const ownerDevices = panel?.groundTrunkDevices ?? installation?.groundTrunkDevices ?? []
        const index = Math.min(...deviceEntries.map(({ item }) => ownerDevices.findIndex((device) => device.id === item.id)).filter((n) => n >= 0))
        for (const { source } of deviceEntries.sort((a, b) => (a.source.device.trunkPosition ?? 0) - (b.source.device.trunkPosition ?? 0))) {
          const clone = cloneDevice(source.device, env.newId)
          if (!addGroundTrunkDeviceInProject(project, clone, Math.max(0, index) + clonedDevices.length, panel?.id).changed) throw new CommandError('check_failed', 'Ground device could not be duplicated', { reason: 'ground_device_not_added' })
          clonedDevices.push(clone.id)
        }
      } else if (first.isSupplyDevice) {
        const expanded = new Map(deviceEntries.map(({ item, source }) => [item.id, source.device]))
        for (const { source } of deviceEntries) {
          const device = source.device
          if (!device.supplyDcBusId || !device.supplyDcBusBranchId) continue
          for (const candidate of findSupplyDeviceContainer(project, device.id)?.devices ?? []) {
            if (candidate.supplyDcBusId === device.supplyDcBusId && candidate.supplyDcBusBranchId === device.supplyDcBusBranchId) expanded.set(candidate.id, candidate)
          }
        }
        const ordered = [...expanded.values()].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
        const ownerDevices = findSupplyDeviceContainer(project, first.device.id)?.devices ?? []
        const lastIndex = Math.max(...ordered.map((device) => ownerDevices.findIndex((candidate) => candidate.id === device.id)).filter((n) => n >= 0))
        const branchMap = new Map<string, string>()
        for (const source of ordered) {
          const clone = cloneDevice(source, env.newId)
          if (clone.supplyDcBusId) {
            const sourceBranchId = clone.supplyDcBusBranchId ?? ''
            const key = `${clone.supplyDcBusId}:${sourceBranchId}`
            let branchId = branchMap.get(key)
            if (!branchId) { branchId = env.newId(); branchMap.set(key, branchId) }
            clone.supplyDcBusBranchId = branchId
          }
          if (!addSupplyTrunkDeviceInProject(project, clone, Math.max(0, lastIndex + 1) + clonedDevices.length, { panelId: first.supplyPanelId, feedScope: first.supplyFeedScope }).changed) throw new CommandError('check_failed', 'Supply device could not be duplicated', { reason: 'supply_device_not_added' })
          clonedDevices.push(clone.id)
        }
      } else if (first.circuit) {
        const circuit = first.circuit
        if (deviceEntries.length === 1) {
          const source = first.device
          const busIndex = circuit.trunkDevices?.findIndex((device) => device.type === 'dc_bus') ?? -1
          const sourceIndex = circuit.trunkDevices?.findIndex((device) => device.id === source.id) ?? -1
          const isDcBusSource = !source.converterDcConnection && !source.supplyDcBusId &&
            ['conversion', 'storage', 'generation'].includes(source.type) && busIndex >= 0 &&
            sourceIndex >= 0 && sourceIndex < busIndex && circuit.trunkDevices?.[busIndex]?.trunkPosition === source.trunkPosition
          if (isDcBusSource) {
            if (source.symbol === 'inverter') throw new CommandError('check_failed', 'An inverter cannot be duplicated onto its DC rail', { reason: 'unsupported_dc_source' })
            const clone = cloneTrunkDeviceAsDcBusEndpoint(source, env.newId)
            const branches = [...(circuit.branches ?? [])].map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] }))
            const lastBusBranch = branches.reduce((last, branch, index) => branch.dcBusId === circuit.trunkDevices?.[busIndex]?.id ? index : last, -1)
            branches.splice(lastBusBranch + 1, 0, { id: env.newId(), label: '', dcBusId: circuit.trunkDevices?.[busIndex]?.id, endpointIds: [clone.id] })
            updateCircuitInProject(project, circuit.id, { endpoints: [...circuit.endpoints, clone], branches })
            clonedEndpoints.push(clone.id)
            relatedCircuits.add(circuit.id)
          }
        }
        if (clonedEndpoints.length) {
          ensureSitplanPlacementsAt(project, clonedEndpoints, (id) => endpointFor(project, id)?.endpoint, (id, placement) => {
            const clone = endpointFor(project, id)?.endpoint
            if (clone) clone.placements.push(placement)
          }, input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null }, env.newId)
        } else {
        const selectedBranch = circuit.branches?.find((branch) => deviceEntries.every(({ item }) => branch.branchDevices?.some((device) => device.id === item.id)))
        if (selectedBranch) {
          const devices = selectedBranch.branchDevices ?? []
          const selectedIndex = Math.min(...deviceEntries.map(({ item }) => devices.findIndex((device) => device.id === item.id)))
          const newDevices = devices.slice(selectedIndex).map((source) => cloneDevice(source, env.newId))
          const endpointMap = new Map<string, string>()
          const endpointClones = selectedBranch.endpointIds.flatMap((id) => {
            const source = circuit.endpoints.find((endpoint) => endpoint.id === id)
            if (!source) return []
            const clone = cloneEndpoint(source, env.newId)
            endpointMap.set(source.id, clone.id)
            clone.label = ''
            clone.controlledEndpointIds = undefined
            if (clone.domoticaProps) clone.domoticaProps = { ...clone.domoticaProps, endpointChildEndpointIds: undefined, controlChildEndpointIds: undefined }
            clone.domoticaChildProps = undefined
            return [clone]
          })
          remapClonedEndpointDependencies(endpointClones, { endpoint: endpointMap, trunkDevice: new Map(), circuit: new Map() })
          const branch = { ...selectedBranch, id: env.newId(), label: '', endpointIds: endpointClones.map((endpoint) => endpoint.id), branchDevices: newDevices }
          const branches = [...(circuit.branches ?? [])]
          branches.splice(branches.findIndex((entry) => entry.id === selectedBranch.id) + 1, 0, branch)
          updateCircuitInProject(project, circuit.id, { endpoints: [...circuit.endpoints, ...endpointClones], branches })
          clonedDevices.push(...newDevices.map((device) => device.id))
          clonedEndpoints.push(...endpointClones.map((endpoint) => endpoint.id))
          relatedCircuits.add(circuit.id)
        } else {
          const expanded = new Map(deviceEntries.map(({ item, source }) => [item.id, source.device]))
          for (const { source } of deviceEntries) {
            const device = source.device
            if (!device.supplyDcBusId || !device.supplyDcBusBranchId) continue
            for (const candidate of circuit.trunkDevices ?? []) {
              if (candidate.supplyDcBusId === device.supplyDcBusId && candidate.supplyDcBusBranchId === device.supplyDcBusBranchId) expanded.set(candidate.id, candidate)
            }
          }
          const ordered = [...expanded.values()].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
          const index = Math.min(...ordered.map((device) => device.trunkPosition ?? 0))
          const branchId = ordered.some((device) => device.supplyDcBusId && device.supplyDcBusBranchId) ? env.newId() : undefined
          for (const source of ordered) {
            const clone = cloneDevice(source, env.newId)
            clone.trunkPosition = index + clonedDevices.length
            if (branchId && clone.supplyDcBusId) clone.supplyDcBusBranchId = branchId
            if (!addTrunkDeviceToProject(project, circuit.id, clone)) throw new CommandError('check_failed', 'Circuit device could not be duplicated', { reason: 'device_not_added' })
            clonedDevices.push(clone.id)
          }
          for (const source of ordered) {
            const current = circuit.trunkDevices?.find((device) => device.id === source.id)
            if (current) current.trunkPosition = (current.trunkPosition ?? 0) + ordered.length
          }
          relatedCircuits.add(circuit.id)
        }
        }
      }
    }
  } else if (target.type === 'panelGrid') {
    const source = endpointFor(project, input.items[0]!.id)!
    const result = duplicateEndpointOnCircuit(project, {
      circuitId: source.circuit.id, sourceEndpointId: source.endpoint.id, context: 'plan', selectNew: false,
    }, {
      newId: env.newId,
      getCircuitById: (id) => circuitFor(project, id),
      getEndpointById: (id) => endpointFor(project, id)?.endpoint,
      addEndpoint: (circuitId, endpoint, after) => addEndpointToProject(project, circuitId, endpoint, after, undefined, env.newId),
      updateCircuit: (circuitId, updates) => updateCircuitInProject(project, circuitId, updates),
      setSelection: () => undefined,
    })
    if (!result.ok || !result.newEndpointId) throw new CommandError('check_failed', 'Endpoint could not be duplicated', { reason: result.reason ?? 'duplicate_failed' })
    clonedEndpoints.push(result.newEndpointId)
    relatedCircuits.add(source.circuit.id)
    const panel = findPanelById(getEditableProjectElectricalPanels(project), target.panelId)
    const newKey = panelGridModuleRefKey({ kind: 'domotica', endpointId: result.newEndpointId, circuitId: source.circuit.id })
    const slots = (panel?.gridView?.slots ?? []).map((slot) => panelGridModuleRefKey(slot.module) === newKey ? { ...slot, row: target.row, col: target.col } : slot)
    if (!slots.some((slot) => panelGridModuleRefKey(slot.module) === newKey)) {
      slots.push({ row: target.row, col: target.col, module: { kind: 'domotica', endpointId: result.newEndpointId, circuitId: source.circuit.id } })
    }
    updatePanelGridSlotsInProject(project, target.panelId, slots)
  } else if (target.type === 'duplicateBranch') {
    const circuit = circuitFor(project, target.circuitId)!
    const deps = {
      newId: env.newId,
      getCircuitById: (id: string) => circuitFor(project, id),
      getEndpointById: (id: string) => endpointFor(project, id)?.endpoint,
      addEndpoint: (circuitId: string, endpoint: Endpoint, after?: string | null) => addEndpointToProject(project, circuitId, endpoint, after, undefined, env.newId),
      updateCircuit: (circuitId: string, updates: Partial<Circuit>) => updateCircuitInProject(project, circuitId, updates),
      setSelection: () => undefined,
    }
    const ids = input.items.map((item) => item.id)
    const result = ids.length > 1
      ? duplicateBranchAboveOnCircuit(project, { circuitId: circuit.id, sourceEndpointIds: ids, selectNew: false }, deps)
      : duplicateEndpointOnCircuit(project, {
        circuitId: circuit.id,
        sourceEndpointId: ids[0]!,
        context: 'eendraad',
        placement: { mode: 'new_branch', order: target.branchOrder === 'beforeSource' ? 'before_source_branch' : 'append' },
        selectNew: false,
      }, deps)
    if (!result.ok || (!result.newEndpointIds?.length && !result.newEndpointId)) throw new CommandError('check_failed', 'Endpoint could not be duplicated', { reason: result.reason ?? 'duplicate_failed' })
    clonedEndpoints.push(...(result.newEndpointIds ?? [result.newEndpointId!]))
    ensureSitplanPlacementsAt(project, clonedEndpoints, (id) => endpointFor(project, id)?.endpoint, (id, placement) => {
      const clone = endpointFor(project, id)?.endpoint
      if (clone) clone.placements.push(placement)
    }, input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null }, env.newId)
    relatedCircuits.add(circuit.id)
  } else if (target.type === 'pasteEndpoints') {
    const map = new Map<string, string>()
    const clones = input.items.map((item) => {
      const clone = cloneEndpoint(endpointFor(project, item.id)!.endpoint, env.newId)
      map.set(item.id, clone.id)
      return clone
    })
    remapClonedEndpointDependencies(clones, { endpoint: map, trunkDevice: new Map(), circuit: new Map() })
    const intendedDomoticaProps = new Map(clones.flatMap((clone) => clone.domoticaProps
      ? [[clone.id, JSON.parse(JSON.stringify(clone.domoticaProps)) as Endpoint['domoticaProps']] as const]
      : []))
    let after = target.insertAfterEndpointId
    for (const clone of clones) {
      if (!addEndpointToProject(project, target.circuitId, clone, after, undefined, env.newId)) throw new CommandError('check_failed', 'Endpoint could not be pasted', { reason: 'endpoint_not_added' })
      clonedEndpoints.push(clone.id)
      after = clone.id
    }
    const destination = circuitFor(project, target.circuitId)
    if (destination && intendedDomoticaProps.size) {
      for (const [id, props] of intendedDomoticaProps) {
        const parent = destination.endpoints.find((endpoint) => endpoint.id === id)
        if (parent) parent.domoticaProps = props
      }
      normalizeDomoticaCircuit(destination)
    }
    relatedCircuits.add(target.circuitId)
  } else if (target.type === 'circuitTrunk') {
    const circuit = circuitFor(project, target.circuitId)!
    const sorted = input.items.map((item) => deviceFor(project, item.id)!).sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0))
    if (input.purpose === 'duplicate') {
      for (const existing of circuit.trunkDevices ?? []) {
        if ((existing.trunkPosition ?? 0) >= target.insertIndex) existing.trunkPosition = (existing.trunkPosition ?? 0) + sorted.length
      }
    }
    sorted.forEach((entry, index) => {
      const clone = cloneDevice(entry.device, env.newId)
      clone.trunkPosition = target.insertIndex + index
      if (!addTrunkDeviceToProject(project, circuit.id, clone)) throw new CommandError('check_failed', 'Device could not be pasted', { reason: 'device_not_added' })
      clonedDevices.push(clone.id)
    })
    relatedCircuits.add(circuit.id)
  } else if (target.type === 'dcBranchDevice') {
    const circuit = circuitFor(project, target.circuitId)!
    const branch = (circuit.branches ?? []).find((candidate) => candidate.id === target.branchId)!
    const branchDevices = [...(branch.branchDevices ?? [])]
    let index = target.insertIndex
    for (const item of input.items) {
      const clone = cloneDevice(deviceFor(project, item.id)!.device, env.newId)
      clone.trunkPosition = index
      branchDevices.splice(index++, 0, clone)
      clonedDevices.push(clone.id)
    }
    branchDevices.forEach((device, position) => { device.trunkPosition = position })
    updateCircuitInProject(project, circuit.id, { branches: circuit.branches?.map((candidate) => candidate.id === branch.id ? { ...candidate, branchDevices } : candidate) })
    relatedCircuits.add(circuit.id)
  } else if (target.type === 'supply') {
    for (const item of input.items) {
      const clone = cloneDevice(deviceFor(project, item.id)!.device, env.newId)
      if (!addSupplyTrunkDeviceInProject(project, clone, target.insertIndex + clonedDevices.length, { panelId: target.panelId ?? undefined, feedScope: target.feedScope }).changed) throw new CommandError('check_failed', 'Supply device could not be pasted', { reason: 'supply_device_not_added' })
      clonedDevices.push(clone.id)
    }
  } else if (target.type === 'ground') {
    for (const item of input.items) {
      const clone = cloneDevice(deviceFor(project, item.id)!.device, env.newId)
      if (!addGroundTrunkDeviceInProject(project, clone, target.insertIndex + clonedDevices.length, target.panelId ?? undefined).changed) throw new CommandError('check_failed', 'Ground device could not be pasted', { reason: 'ground_device_not_added' })
      clonedDevices.push(clone.id)
    }
  } else {
    if (input.items[0]!.kind === 'endpoint') {
      for (const item of input.items) {
        const result = duplicateEndpointAtDropTargetInProject(project, item.id, target.target, input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null }, env.newId, env.language)
        clonedEndpoints.push(...result.endpointIds)
        result.circuitIds.forEach((id) => relatedCircuits.add(id))
      }
    } else {
      for (const item of input.items) {
        const source = deviceFor(project, item.id)
        if (!source) throw new CommandError('check_failed', 'Device not found', { reason: 'device_not_found' })
        if (source.isSupplyDevice) {
          const clone = cloneDevice(source.device, env.newId)
          delete clone.supplyDcBusId
          delete clone.supplyDcBusBranchId
          if (!addSupplyTrunkDeviceInProject(project, clone, (source.device.trunkPosition ?? 0) + 1, { panelId: source.supplyPanelId, feedScope: source.supplyFeedScope }).changed) throw new CommandError('check_failed', 'Supply device could not be cloned', { reason: 'supply_device_not_added' })
          const moved = moveSupplyTrunkDeviceAtDropTarget(project, clone.id, target.target, target.targetMounting as ElectricalEnclosureRef | undefined, env.newId)
          if (!moved) throw new CommandError('check_failed', 'Supply device cannot be dropped there', { reason: 'drop_rejected' })
          for (const panelId of new Set([moved.sourcePanelId, moved.targetPanelId].filter((id): id is string => !!id))) {
            reconcileDirectConverterDcDevices(project, panelId)
            reconcileSupplyAssemblyBranchProtections(project, panelId)
          }
          clonedDevices.push(clone.id)
        } else if (source.isGroundDevice) {
          throw new CommandError('check_failed', 'Ground-device Alt-drag is not supported at this destination', { reason: 'drop_rejected' })
        } else if (source.circuit) {
          const id = duplicateCircuitDeviceAtDropTargetInProject(project, source.circuit.id, item.id, target.target, env.newId)
          if (!id) throw new CommandError('check_failed', 'Device cannot be duplicated there', { reason: 'drop_rejected' })
          clonedDevices.push(id)
          relatedCircuits.add(target.target.circuitId ?? source.circuit.id)
        } else throw new CommandError('check_failed', 'Device cannot be duplicated there', { reason: 'unsupported_source' })
      }
    }
  }

  return {
    related: [...relatedCircuits].map((id) => ({ kind: 'circuit' as const, id })),
    select: [...clonedEndpoints.map((id) => ({ kind: 'endpoint' as const, id })), ...clonedDevices.map((id) => ({ kind: 'trunkDevice' as const, id }))],
  }
}

function duplicateCircuitDeviceAtDropTargetInProject(project: ProjectV2, sourceCircuitId: string, sourceDeviceId: string, target: DropTarget, newId: () => string): string | null {
  const circuits = [...walkPanels(getEditableProjectElectricalPanels(project))].flatMap((panel) => [
    ...(panel.circuits ?? []), ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
  ])
  const sourceCircuit = circuits.find((circuit) => circuit.id === sourceCircuitId)
  const sourceBranch = sourceCircuit?.branches?.find((branch) => branch.branchDevices?.some((device) => device.id === sourceDeviceId))
  const sourceDevice = sourceCircuit?.trunkDevices?.find((device) => device.id === sourceDeviceId) ?? sourceBranch?.branchDevices?.find((device) => device.id === sourceDeviceId)
  if (!sourceCircuit || !sourceDevice) return null
  if (sourceBranch) {
    if (target.type !== 'circuit' || target.circuitId !== sourceCircuitId || !target.dcBusId) return null
    const destinationBranch = sourceCircuit.branches?.find((branch) =>
      branch.dcBusId === target.dcBusId &&
      (branch.id === target.branchId || branch.endpointIds.some((id) => target.branchEndpoints?.includes(id))),
    )
    if (!destinationBranch) return null
    const devices = [...(destinationBranch.branchDevices ?? [])]
    const index = Math.max(0, Math.min(target.branchDeviceInsertIndex ?? devices.length, devices.length))
    const clone = cloneDevice(sourceDevice, newId)
    clone.trunkPosition = index
    devices.splice(index, 0, clone)
    devices.forEach((device, position) => { device.trunkPosition = position })
    updateCircuitInProject(project, sourceCircuit.id, { branches: sourceCircuit.branches?.map((branch) => branch.id === destinationBranch.id ? { ...branch, branchDevices: devices } : branch) })
    return clone.id
  }
  if (target.type !== 'circuit' || !target.circuitId || target.branchEndpoints?.length) return null
  if (sourceDevice.symbol === 'junction_panel') {
    const destination = circuits.find((circuit) => circuit.id === target.circuitId)
    if (!destination || destination.id === sourceCircuitId || circuitContainsJunctionPanelIdentity(destination, getJunctionIdentity(sourceDevice))) return null
  }
  const clone = cloneDevice(sourceDevice, newId)
  clone.trunkPosition = Math.max(-1, ...(sourceCircuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0)) + 1
  sourceCircuit.trunkDevices = [...(sourceCircuit.trunkDevices ?? []), clone]
  const symbol = getSymbolById(sourceDevice.symbol)
  if (!symbol || !mutateTrunkDeviceRelocation(project, { id: clone.id, sourceCircuitId }, target, symbol, newId)) return null
  return clone.id
}
