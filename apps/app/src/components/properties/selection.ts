import type { TFunction } from 'i18next'
import type { ProjectState } from '@/stores/projectStore'
import type {
  Circuit,
  Door,
  Endpoint,
  Floor,
  Note,
  Panel,
  Placement,
  PlanGraphicElement,
  ProtectionDevice,
  Stair,
  TrunkDevice,
  Wall,
  Window,
} from '@/types/schema'
import type { Selection } from '@/types/ui'
import { getPlanGraphicElementAsset } from '@/lib/plan/graphicElements'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { getSymbolById } from '@/lib/symbols'
import { panelT } from './shared/propertiesSharedUtils'

type Project = NonNullable<ProjectState['currentProject']>
type ProjectPropertyItem =
  | Panel
  | ProtectionDevice
  | Circuit
  | Endpoint
  | Placement
  | null
  | undefined

export function checkIfAllSameProperties(selection: Selection, project: Project | null): boolean {
  if (!project || selection.ids.length <= 1) return true

  const firstId = selection.ids[0]!
  const firstItem = getItemById(selection.type!, firstId, project)

  if (!firstItem) return false

  for (let i = 1; i < selection.ids.length; i++) {
    const item = getItemById(selection.type!, selection.ids[i]!, project)
    if (!item || !areItemsEqual(firstItem, item)) {
      return false
    }
  }

  return true
}

export function getSameJunctionPanelTrunkDeviceId(
  selection: Selection,
  getTrunkDeviceById: ProjectState['getTrunkDeviceById']
): string | null {
  if (selection.type !== 'trunkDevice' || selection.ids.length <= 1) return null
  const devices = selection.ids
    .map((id) => getTrunkDeviceById(id))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => row.device)
  const allJunctionPanels =
    devices.length > 0 && devices.every((device) => device.symbol === 'junction_panel')
  const labels = new Set(devices.map((device) => device.label || ''))
  return allJunctionPanels && labels.size === 1 ? selection.ids[0]! : null
}

function getItemById(type: Selection['type'], id: string, project: Project): ProjectPropertyItem {
  const panels = getProjectElectricalPanels(project)
  switch (type) {
    case 'panel':
      return findPanelById(panels, id)
    case 'protection':
      return findProtectionById(panels, id)
    case 'circuit':
      return findCircuitById(panels, id)
    case 'endpoint':
      return findEndpointById(panels, id)
    case 'placement':
      return findPlacementById(panels, id)
    default:
      return null
  }
}

function findProtectionById(panels: Panel[], id: string): ProtectionDevice | undefined {
  for (const panel of panels) {
    const protection = panel.protections.find((entry) => entry.id === id)
    if (protection) return protection
    const found = findProtectionById(panel.subPanels, id)
    if (found) return found
  }
  return undefined
}

function findCircuitById(panels: Panel[], id: string): Circuit | undefined {
  for (const panel of panels) {
    const circuit = panel.circuits.find((entry) => entry.id === id)
    if (circuit) return circuit

    for (const protection of panel.protections) {
      const protectedCircuit = protection.circuits?.find((entry) => entry.id === id)
      if (protectedCircuit) return protectedCircuit
    }

    const found = findCircuitById(panel.subPanels, id)
    if (found) return found
  }
  return undefined
}

function findEndpointById(panels: Panel[], id: string): Endpoint | undefined {
  for (const panel of panels) {
    for (const circuit of panel.circuits) {
      const endpoint = circuit.endpoints.find((entry) => entry.id === id)
      if (endpoint) return endpoint
    }

    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        const endpoint = circuit.endpoints.find((entry) => entry.id === id)
        if (endpoint) return endpoint
      }
    }

    const found = findEndpointById(panel.subPanels, id)
    if (found) return found
  }
  return undefined
}

function findPlacementById(panels: Panel[], id: string): Placement | undefined {
  for (const panel of panels) {
    for (const circuit of panel.circuits) {
      for (const endpoint of circuit.endpoints) {
        const placement = endpoint.placements.find((entry) => entry.id === id)
        if (placement) return placement
      }
    }

    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        for (const endpoint of circuit.endpoints) {
          const placement = endpoint.placements.find((entry) => entry.id === id)
          if (placement) return placement
        }
      }
    }

    const found = findPlacementById(panel.subPanels, id)
    if (found) return found
  }
  return undefined
}

function areItemsEqual(item1: ProjectPropertyItem, item2: ProjectPropertyItem): boolean {
  if (!item1 || !item2) return false

  return JSON.stringify(item1) === JSON.stringify(item2)
}

const WALL_POINT_ID_PREFIX = 'v|'
const STAIR_POINT_ID_PREFIX = 's|'

function parseEncodedPointIds(ids: string[], prefix: string): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const parts = id.split('|')
    if (parts.length < 3) continue
    const entityId = parts[1]!
    const pointIndex = parseInt(parts[2]!, 10)
    if (Number.isNaN(pointIndex)) continue
    const existing = map.get(entityId) ?? []
    if (!existing.includes(pointIndex)) {
      existing.push(pointIndex)
      existing.sort((a, b) => a - b)
      map.set(entityId, existing)
    }
  }
  return map
}

export function getStairOnlyPointSelection(selection: Selection): {
  stairId: string
  pointIndices: number[]
} | null {
  if (selection.type !== 'wallPoint') return null
  const wallPoints = parseEncodedPointIds(selection.ids, WALL_POINT_ID_PREFIX)
  const stairPoints = parseEncodedPointIds(selection.ids, STAIR_POINT_ID_PREFIX)
  if (wallPoints.size !== 0 || stairPoints.size !== 1) return null
  const [stairId, pointIndices] = Array.from(stairPoints.entries())[0]!
  return { stairId, pointIndices }
}

export function getSelectedPlacementTarget(
  placementId: string,
  {
    getEndpointById,
    getPlacementById,
    getTrunkDeviceById,
  }: Pick<ProjectState, 'getEndpointById' | 'getPlacementById' | 'getTrunkDeviceById'>
):
  | { type: 'ground' }
  | { type: 'endpoint'; endpointId: string; endpoint: Endpoint }
  | { type: 'trunkDevice'; deviceId: string; device: TrunkDevice }
  | { type: 'auxiliaryEnclosure'; enclosureId: string }
  | { type: 'unresolved' } {
  const placement = getPlacementById(placementId)
  if (placement?.isEarthing) return { type: 'ground' }
  if (placement?.enclosureId) return { type: 'auxiliaryEnclosure', enclosureId: placement.enclosureId }
  const endpointId = placement?.endpointId
  const endpoint = endpointId ? getEndpointById(endpointId) : undefined
  if (endpointId && endpoint) return { type: 'endpoint', endpointId, endpoint }
  const deviceId = placement?.trunkDeviceId
  const device = deviceId ? getTrunkDeviceById(deviceId)?.device : undefined
  if (deviceId && device) return { type: 'trunkDevice', deviceId, device }
  return { type: 'unresolved' }
}

export function getSelectedNote(
  noteId: string,
  {
    getEendraadNoteById,
    getSitplanNoteById,
  }: Pick<ProjectState, 'getEendraadNoteById' | 'getSitplanNoteById'>
): { note: Note | undefined; isEendraad: boolean } {
  const eendraadNote = getEendraadNoteById(noteId)
  return {
    note: eendraadNote || getSitplanNoteById(noteId),
    isEendraad: !!eendraadNote,
  }
}

export function getSelectedWall(
  project: Project | null,
  wallId: string
): {
  wall: Wall
  masterWallThickness: number
} | null {
  if (!project) return null
  for (const floor of readLegacyCompatibilityFloors(project)) {
    if (!floor.floorPlan) continue
    const wall = floor.floorPlan.walls.find((entry: Wall) => entry.id === wallId)
    if (wall) {
      return { wall, masterWallThickness: floor.floorPlan.masterWallThickness }
    }
  }
  return null
}

export function getSelectedOpening(
  project: Project | null,
  openingId: string,
  kind: 'door' | 'window'
): { opening: Door | Window; floor: Floor } | null {
  if (!project) return null
  for (const floor of readLegacyCompatibilityFloors(project)) {
    const opening =
      kind === 'door'
        ? floor.floorPlan?.doors.find((entry: Door) => entry.id === openingId)
        : floor.floorPlan?.windows.find((entry: Window) => entry.id === openingId)
    if (opening) return { opening, floor }
  }
  return null
}

export function getSelectedStair({
  project,
  stairId,
  selection,
  stairOnlyPointSelection,
}: {
  project: Project | null
  stairId: string
  selection: Selection
  stairOnlyPointSelection: { stairId: string; pointIndices: number[] } | null
}): { stair: Stair; floor: Floor; selectedPointIndices: number[] } | null {
  if (!project) return null
  for (const floor of readLegacyCompatibilityFloors(project)) {
    const stair = floor.floorPlan?.stairs?.find((entry: Stair) => entry.id === stairId)
    if (!stair) continue
    const selectedPointIndices =
      stairOnlyPointSelection?.stairId === stairId
        ? stairOnlyPointSelection.pointIndices
        : selection.type === 'stairPoint' && selection.ids.length > 1
          ? (() => {
              const selectedPointIndex = Number(selection.ids[1] ?? '')
              return Number.isFinite(selectedPointIndex) ? [selectedPointIndex] : []
            })()
          : []
    return { stair, floor, selectedPointIndices }
  }
  return null
}

export function getSelectedGraphicElement(
  project: Project | null,
  elementId: string
): { element: PlanGraphicElement; floor: Floor } | null {
  if (!project) return null
  for (const floor of readLegacyCompatibilityFloors(project)) {
    const element = floor.floorPlan?.graphicElements?.find(
      (entry: PlanGraphicElement) => entry.id === elementId
    )
    if (element) return { element, floor }
  }
  return null
}

function panelTitleForEndpoint(endpoint: Endpoint | undefined, t: TFunction): string {
  if (!endpoint) return panelT(t, 'endpoints.title', 'Endpoint')
  const sym = endpoint.symbol
  const isSwitch = endpoint.type === 'switch' && sym !== 'relay'
  if (sym === 'relay') return panelT(t, 'symbols.relay', 'Relay')
  if (sym === 'energy_meter') return panelT(t, 'symbols.energy_meter', 'Energy meter')
  if (sym === 'domotica') return panelT(t, 'symbols.domotica', 'Domotica / Smart home device')
  if (sym === 'junction_box') return panelT(t, 'symbols.junction_box', 'Junction box')
  if (sym === 'junction_panel') return panelT(t, 'symbols.junction_panel', 'Junction panel')
  if (sym === 'terminal_strip') return panelT(t, 'symbols.terminal_strip', 'Terminal strip')
  if (sym === 'solar_panel') return panelT(t, 'symbols.solar_panel', 'Solar panel')
  if (sym === 'battery') return panelT(t, 'symbols.battery', 'Battery')
  if (isSwitch) return panelT(t, 'endpoints.switch', 'Switch')
  if (endpoint.type === 'light_point') return panelT(t, 'endpoints.light_point', 'Light')
  if (endpoint.type === 'socket') {
    return isModularSocket(endpoint)
      ? panelT(t, 'endpoints.modularSocket', 'Modular socket')
      : panelT(t, 'endpoints.socket', 'Socket')
  }
  if (endpoint.type === 'fixed_appliance')
    return panelT(t, 'endpoints.fixed_appliance', 'Fixed Appliance')
  return panelT(t, 'endpoints.title', 'Endpoint')
}

function panelTitleForTrunkDevice(device: TrunkDevice | undefined, t: TFunction): string {
  const pt = (key: string, defaultValue?: string) => panelT(t, key, defaultValue)
  if (!device) return pt('endpoints.notFound', 'Device not found')
  if (device.symbol === 'earthing_separator')
    return pt('symbols.earthing_separator', 'Earthing Separator')
  if (device.symbol === 'junction_panel')
    return pt('junctionPanel.propertiesTitle', 'Junction panel')
  if (device.symbol === 'terminal_strip') return pt('symbols.terminal_strip', 'Terminal strip')
  if (device.symbol === 'source_changeover')
    return pt('symbols.source_changeover', 'Source transfer switch')
  if (getSymbolById(device.symbol)?.category === 'switches') return pt('endpoints.switch', 'Switch')
  if (device.type === 'protection') {
    return pt(
      `protections.${device.protectionType || 'MCB'}`,
      device.protectionType || 'Protection'
    )
  }
  if (device.type === 'energy_meter') return pt('symbols.energy_meter', 'Energy meter')
  if (device.symbol === 'solar_panel') return pt('symbols.solar_panel', 'Solar panel')
  if (device.symbol === 'battery') return pt('symbols.battery', 'Battery')
  if (device.symbol === 'dc_bus') return pt('symbols.dc_bus', 'DC busbar')
  if (device.type === 'conversion') {
    if (device.symbol === 'transformer') return pt('symbols.transformer', 'Transformer')
    if (device.symbol === 'rectifier') return pt('symbols.rectifier', 'Rectifier')
    if (device.symbol === 'inverter') return pt('symbols.inverter', 'Inverter')
    if (device.symbol === 'dc_dc_converter') return pt('symbols.dc_dc_converter', 'DC-DC Converter')
  }
  return pt('supply.trunkDevice', 'Supply wire device')
}

export function getPropertiesPanelTitle({
  selection,
  stairOnlyPointSelection,
  titleLookups,
  t,
}: {
  selection: Selection
  stairOnlyPointSelection: { stairId: string; pointIndices: number[] } | null
  titleLookups?: {
    endpoint?: Endpoint
    placementEndpoint?: Endpoint
    placementTrunkDevice?: TrunkDevice
    graphicElement?: PlanGraphicElement
    trunkDevice?: NonNullable<ReturnType<ProjectState['getTrunkDeviceById']>>['device']
    sameJunctionPanelId?: string | null
  }
  t: TFunction
}): string {
  const pt = (key: string, defaultValue?: string) => panelT(t, key, defaultValue)
  const fallback = pt('properties.title', 'Properties')
  const isSingleStairPointSelection = selection.type === 'stairPoint' && selection.ids.length >= 1
  const isStairOnlyPointSelection = stairOnlyPointSelection !== null
  if (!selection.type || selection.ids.length === 0)
    return pt('properties.projectProperties', 'Project Properties')
  if (selection.type === 'infoBlock') {
    const id = selection.ids[0]
    if (id === 'installer') return pt('infoBlock.installerPropertiesTitle', 'Installer info')
    if (id === 'address' || id === 'ean')
      return pt('properties.projectProperties', 'Project Properties')
  }

  if (selection.ids.length > 1 && !isSingleStairPointSelection && !isStairOnlyPointSelection) {
    if (titleLookups?.sameJunctionPanelId) {
      return pt('junctionPanel.propertiesTitle', 'Junction panel')
    }
    if (selection.type === 'protection') return pt('protections.title', 'Protection Devices')
    if (selection.type === 'wire') return pt('wires.title', 'Wire Properties')
    if (selection.type === 'endpoint') return panelTitleForEndpoint(titleLookups?.endpoint, t)
    if (selection.type === 'placement' && titleLookups?.placementEndpoint)
      return panelTitleForEndpoint(titleLookups.placementEndpoint, t)
    return fallback
  }

  switch (selection.type) {
    case 'panel':
      return pt('panels.propertiesTitle', 'Panel')
    case 'supplyPanel':
      return pt('panelCanvas.supplyPanel', 'Supply panel')
    case 'auxiliaryEnclosure':
      return pt('panelCanvas.virtualEnclosure', 'Supply enclosure')
    case 'protection':
      return pt('protections.title', 'Protection Device')
    case 'circuit':
      return pt('circuits.title', 'Circuit')
    case 'placement': {
      if (titleLookups?.placementEndpoint) {
        return panelTitleForEndpoint(titleLookups.placementEndpoint, t)
      }
      if (titleLookups?.placementTrunkDevice) {
        return panelTitleForTrunkDevice(titleLookups.placementTrunkDevice, t)
      }
      return fallback
    }
    case 'note':
      return pt('notes.title', 'Note / Label')
    case 'document':
      return pt('projectDocuments.propertiesTitle', 'Document')
    case 'frame':
      return pt('frames.title', 'Frame')
    case 'stair':
    case 'stairPoint':
      return pt('floorPlanTools.drawStair', 'Stairs')
    case 'graphicElement': {
      const asset = titleLookups?.graphicElement
        ? getPlanGraphicElementAsset(titleLookups.graphicElement.assetId)
        : null
      return asset
        ? pt(asset.labelKey, asset.label)
        : pt('floorPlanTools.graphicElements', 'Graphic elements')
    }
    case 'wallPoint':
      return isStairOnlyPointSelection ? pt('floorPlanTools.drawStair', 'Stairs') : fallback
    case 'ground':
      return pt('symbols.earthing', 'Earthing')
    case 'supply':
    case 'busSection':
      return pt('feedOrganization.title', 'Feed organization')
    case 'endpoint':
      return panelTitleForEndpoint(titleLookups?.endpoint, t)
    case 'trunkDevice': {
      return panelTitleForTrunkDevice(titleLookups?.trunkDevice, t)
    }
    case 'wire':
      return pt('wires.title', 'Wire Properties')
    case 'structuralNode':
    case 'structuralConnection':
      return selection.structuralMetadata?.label ?? pt('views.structure', 'Structure')
    case 'door':
      return pt('plan.doorProperties', 'Door')
    case 'window':
      return pt('plan.windowProperties', 'Window')
    default:
      return fallback
  }
}
