import { groupEndpointsIntoBranches, initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { resolvePanelSupplyLinkForPanel } from '@/lib/eendraad/panelSupplyLink'
import { hasCustomPlacement, isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  selectProjectElectricalInstallation,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSituationPlanPlacementIdsHiddenByPanel } from '@/lib/plan/panelPlanPlacementVisibility'
import { getPanelSupplyTrunkDevices } from '@/lib/feedTopology'
import type { Circuit, Endpoint, Panel, ProtectionDevice, Placement, TrunkDevice } from '@/types/schema'

export interface QuickPlacerItem {
  endpoint: Endpoint
  /** Set when this plan symbol belongs to a trunk device rather than a branch endpoint. */
  trunkDeviceId?: string
  placement: Placement
  isCustomPlacement: boolean
  /** Not on the plan yet (manual plan placement); placing it puts it on the plan. */
  isAwaitingPlacement: boolean
  floorName: string
}

export interface QuickPlacerBranch {
  id: string
  label: string
  items: QuickPlacerItem[]
}

export interface QuickPlacerCircuit {
  id: string
  identifier: string
  notes: string
  panelId: string
  panelName: string
  panelPathIds: string[]
  panelPathNames: string[]
  panelPathLabel: string
  panelDepth: number
  protectionId?: string
  branches: QuickPlacerBranch[]
  /** Items in this circuit that are not on the plan yet. */
  awaitingCount: number
  /** Supply side devices use their own row in the panel selector. */
  isSupply?: boolean
}

type QuickPlacerProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

function buildTrunkDeviceQuickPlacerItems(
  devices: TrunkDevice[] | undefined,
  floorNameById: Map<string, string>,
  hiddenPlacementIds?: Set<string>
): QuickPlacerItem[] {
  return (devices ?? []).flatMap((device) => {
    if (!canSymbolAppearOnSituationPlan(device.symbol)) return []
    return (device.placements ?? [])
      .filter((placement) => !hiddenPlacementIds?.has(placement.id))
      .map((placement) => ({
        endpoint: {
          id: device.id,
          type: device.type === 'switch' ? 'switch' : 'fixed_appliance',
          label: device.label,
          symbol: device.symbol,
          placements: [placement],
        },
        trunkDeviceId: device.id,
        placement,
        isCustomPlacement: hasCustomPlacement(placement),
        isAwaitingPlacement: isAwaitingPlanPlacement(placement),
        floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
      }))
  })
}

function appendQuickPlacerCircuits(
  panel: Panel,
  into: Array<{
    circuit: Circuit
    panel: Panel
    panelPath: Panel[]
    protection?: ProtectionDevice
  }>,
  panelPath: Panel[] = []
): void {
  const currentPanelPath = [...panelPath, panel]
  const seenCircuitIds = new Set<string>()
  const expandedCircuitIds = new Set<string>()

  const addCircuit = (circuit: Circuit, protection?: ProtectionDevice) => {
    if (seenCircuitIds.has(circuit.id)) return
    seenCircuitIds.add(circuit.id)
    into.push({ circuit, panel, panelPath: currentPanelPath, protection })
  }

  const directCircuitById = new Map(panel.circuits.map((circuit) => [circuit.id, circuit]))
  const protectionById = new Map(
    (panel.protections ?? []).map((protection) => [protection.id, protection])
  )

  const findProtectionOwningCircuit = (circuitId: string): ProtectionDevice | undefined =>
    panel.protections.find((protection) =>
      protection.circuits?.some((circuit) => circuit.id === circuitId)
    )

  const appendSubCircuitRows = (subCircuitIds: string[] | undefined) => {
    for (const subCircuitId of subCircuitIds ?? []) {
      const protection = findProtectionOwningCircuit(subCircuitId)
      if (protection) {
        appendProtectionSubtree(protection)
        continue
      }

      const circuit = directCircuitById.get(subCircuitId)
      if (circuit) appendDirectCircuitSubtree(circuit)
    }
  }

  function appendProtectionSubtree(protection: ProtectionDevice) {
    for (const circuit of protection.circuits ?? []) {
      if (expandedCircuitIds.has(circuit.id)) continue
      expandedCircuitIds.add(circuit.id)
      addCircuit(circuit, protection)
      appendSubCircuitRows(circuit.subCircuitIds)
    }
  }

  function appendDirectCircuitSubtree(circuit: Circuit) {
    if (expandedCircuitIds.has(circuit.id)) return
    expandedCircuitIds.add(circuit.id)
    addCircuit(circuit)
    appendSubCircuitRows(circuit.subCircuitIds)
  }

  for (const item of getMainBusOrder(panel)) {
    if (item.type === 'circuit') {
      const circuit = directCircuitById.get(item.id)
      if (circuit) appendDirectCircuitSubtree(circuit)
    } else {
      const protection = protectionById.get(item.id)
      if (protection) appendProtectionSubtree(protection)
    }
  }

  // Preserve placeable circuits from legacy or partially repaired states that are not on the main bus.
  for (const circuit of panel.circuits) addCircuit(circuit)
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      addCircuit(circuit, protection)
    }
  }
  for (const subPanel of panel.subPanels ?? []) {
    appendQuickPlacerCircuits(subPanel, into, currentPanelPath)
  }
}

function buildQuickPlacerBranches(
  circuit: Circuit,
  itemsByEndpointId: Map<string, QuickPlacerItem[]>,
  circuitIdentifier: string
): QuickPlacerBranch[] {
  const branches: QuickPlacerBranch[] = []
  const assignedEndpointIds = new Set<string>()

  for (const branch of initializeBranchesIfNeeded(circuit)) {
    const items = branch.endpointIds.flatMap(
      (endpointId) => itemsByEndpointId.get(endpointId) ?? []
    )

    if (items.length === 0) continue

    for (const item of items) {
      assignedEndpointIds.add(item.endpoint.id)
    }

    branches.push({
      id: branch.id,
      label:
        items[0]?.endpoint.symbol === 'panel_distribution'
          ? circuitIdentifier
          : branch.label || items[0]?.endpoint.label || circuitIdentifier,
      items,
    })
  }

  const unassignedEndpoints = Array.from(itemsByEndpointId.entries())
    .filter(([endpointId]) => !assignedEndpointIds.has(endpointId))
    .map(([, items]) => items[0]?.endpoint)
    .filter((endpoint): endpoint is Endpoint => endpoint !== undefined)

  let fallbackBranchIndex = 0
  for (const fallbackEndpoints of groupEndpointsIntoBranches(unassignedEndpoints)) {
    const items = fallbackEndpoints.flatMap((endpoint) => itemsByEndpointId.get(endpoint.id) ?? [])

    if (items.length === 0) continue

    branches.push({
      id: `quick-placer-fallback-${circuit.id}-${fallbackBranchIndex++}`,
      label:
        items[0]?.endpoint.symbol === 'panel_distribution'
          ? circuitIdentifier
          : items[0]?.endpoint.label || circuitIdentifier,
      items,
    })
  }

  return branches.slice().reverse()
}

export function buildQuickPlacerCircuits(
  project: QuickPlacerProject | null,
  getCircuitIdentifier: (circuitId: string) => string
): QuickPlacerCircuit[] {
  if (!project) return []

  const floorNameById = new Map(
    selectProjectBuildingFloors(project).map((floor) => [floor.id, floor.name])
  )

  const orderedCircuits: Array<{
    circuit: Circuit
    panel: Panel
    panelPath: Panel[]
    protection?: ProtectionDevice
  }> = []
  for (const rootPanel of selectProjectElectricalPanels(project)) {
    appendQuickPlacerCircuits(rootPanel, orderedCircuits)
  }

  const itemsByCircuitId = new Map<string, Map<string, QuickPlacerItem[]>>()
  for (const { circuit, panel } of orderedCircuits) {
    for (const endpoint of circuit.endpoints) {
      let ownerCircuitId = circuit.id
      if (circuit.code === 'PANEL' && endpoint.symbol === 'panel_distribution') {
        const representedPanelId = endpoint.panelId ?? panel.id
        const supplyLink = resolvePanelSupplyLinkForPanel(project, representedPanelId)
        if (!supplyLink?.feederCircuit) continue
        ownerCircuitId = supplyLink.feederCircuit.id
      }

      const items = endpoint.placements.map((placement) => ({
        endpoint,
        placement,
        isCustomPlacement: hasCustomPlacement(placement),
        isAwaitingPlacement: isAwaitingPlanPlacement(placement),
        floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
      }))
      if (items.length === 0) continue

      let itemsByEndpointId = itemsByCircuitId.get(ownerCircuitId)
      if (!itemsByEndpointId) {
        itemsByEndpointId = new Map<string, QuickPlacerItem[]>()
        itemsByCircuitId.set(ownerCircuitId, itemsByEndpointId)
      }
      itemsByEndpointId.set(endpoint.id, items)
    }
  }

  const circuits: QuickPlacerCircuit[] = []

  for (const { circuit, panel, panelPath, protection } of orderedCircuits) {
    const itemsByEndpointId =
      itemsByCircuitId.get(circuit.id) ?? new Map<string, QuickPlacerItem[]>()
    const circuitIdentifier = getCircuitIdentifier(circuit.id) || circuit.code

    const trunkItems = buildTrunkDeviceQuickPlacerItems(circuit.trunkDevices, floorNameById)
    const branches = [
      ...(trunkItems.length > 0
        ? [
            {
              id: `quick-placer-trunk-${circuit.id}`,
              label: circuitIdentifier,
              items: trunkItems,
            },
          ]
        : []),
      ...buildQuickPlacerBranches(circuit, itemsByEndpointId, circuitIdentifier),
    ]

    if (branches.length === 0) continue

    const panelPathIds = panelPath.map((entry) => entry.id)
    const panelPathNames = panelPath.map((entry) => entry.name)

    circuits.push({
      id: circuit.id,
      identifier: circuitIdentifier,
      notes: protection?.notes?.trim() || circuit.notes?.trim() || '',
      panelId: panel.id,
      panelName: panel.name,
      panelPathIds,
      panelPathNames,
      panelPathLabel: panelPathNames.join(' / '),
      panelDepth: Math.max(0, panelPath.length - 1),
      protectionId: protection?.id,
      branches,
      awaitingCount: branches.reduce(
        (sum, branch) => sum + branch.items.filter((item) => item.isAwaitingPlacement).length,
        0
      ),
    })
  }

  const installation = selectProjectElectricalInstallation(project)
  if (installation) {
    const hiddenSupplyPlacementIds = getSituationPlanPlacementIdsHiddenByPanel(project)
    const visitedPanelIds = new Set<string>()
    const appendSupplyRows = (panel: Panel, panelPath: Panel[]) => {
      if (visitedPanelIds.has(panel.id)) return
      visitedPanelIds.add(panel.id)
      const path = [...panelPath, panel]
      const devices = getPanelSupplyTrunkDevices(
        installation,
        selectProjectElectricalPanels(project),
        panel
      )
      const items = buildTrunkDeviceQuickPlacerItems(
        devices,
        floorNameById,
        hiddenSupplyPlacementIds
      )
      if (items.length > 0) {
        const pathNames = path.map((entry) => entry.name)
        circuits.push({
          id: `quick-placer-supply-${panel.id}`,
          identifier: '',
          notes: '',
          panelId: panel.id,
          panelName: panel.name,
          panelPathIds: path.map((entry) => entry.id),
          panelPathNames: pathNames,
          panelPathLabel: pathNames.join(' / '),
          panelDepth: Math.max(0, path.length - 1),
          branches: [{ id: `quick-placer-supply-items-${panel.id}`, label: '', items }],
          awaitingCount: items.filter((item) => item.isAwaitingPlacement).length,
          isSupply: true,
        })
      }
      for (const child of panel.subPanels ?? []) appendSupplyRows(child, path)
    }
    for (const rootPanel of selectProjectElectricalPanels(project)) {
      appendSupplyRows(rootPanel, [])
    }
  }

  return circuits
}

export function flattenQuickPlacerCircuit(
  circuit: QuickPlacerCircuit | null | undefined,
  options?: { autoSkipCustom?: boolean }
): QuickPlacerItem[] {
  if (!circuit) return []
  const autoSkipCustom = options?.autoSkipCustom ?? false
  return circuit.branches.flatMap((branch) =>
    branch.items.filter((item) => !autoSkipCustom || !item.isCustomPlacement)
  )
}

export function findNextQuickPlacerCircuit(
  circuits: QuickPlacerCircuit[],
  currentCircuitId: string,
  options?: { autoSkipCustom?: boolean }
): QuickPlacerCircuit | null {
  if (circuits.length === 0) return null

  const currentCircuitIndex = circuits.findIndex((circuit) => circuit.id === currentCircuitId)
  if (currentCircuitIndex === -1) return null

  for (let offset = 1; offset <= circuits.length; offset += 1) {
    const nextCircuit = circuits[(currentCircuitIndex + offset) % circuits.length]
    if (nextCircuit && flattenQuickPlacerCircuit(nextCircuit, options).length > 0) {
      return nextCircuit
    }
  }

  return null
}

/** First item still waiting to be put on the plan, in Quick Placer order. */
export function findFirstAwaitingQuickPlacerItem(
  circuits: QuickPlacerCircuit[]
): { circuit: QuickPlacerCircuit; item: QuickPlacerItem } | null {
  for (const circuit of circuits) {
    if (circuit.awaitingCount === 0) continue
    for (const branch of circuit.branches) {
      const item = branch.items.find((candidate) => candidate.isAwaitingPlacement)
      if (item) return { circuit, item }
    }
  }
  return null
}
