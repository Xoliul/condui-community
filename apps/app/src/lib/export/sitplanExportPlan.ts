import {
  selectProjectBuildingFloors,
  selectProjectFloorPlan,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { orderPanelsByNumber } from '@/lib/panel/panelNumberOrder'
import { isBoardPanel, isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'
import { collectPlacementsOnFloor } from '@/utils/project'
import type { Endpoint, Floor, Panel } from '@/types/schema'
import type { FloorV2 } from '@/types/projectV2'
import { endpointSymbolVisibleOnSitplan } from '@/lib/plan/planSymbolVisibility'

type SitplanExportProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface SitplanExportTarget {
  id: string
  floorId: string
  panelId: string | null
  title: string | null
}

function hasFloorPlanContent(
  project: SitplanExportProject,
  floor: Floor | FloorV2,
): boolean {
  const hasBackground =
    ('planAssetId' in floor && Boolean(floor.planAssetId)) ||
    ('processedPlanAssetId' in floor && Boolean(floor.processedPlanAssetId)) ||
    ('planAsset' in floor && Boolean(floor.planAsset)) ||
    ('planAssetProcessed' in floor && Boolean(floor.planAssetProcessed)) ||
    ('planImportAsset' in floor && Boolean(floor.planImportAsset))
  if (hasBackground) return true
  const floorPlan = selectProjectFloorPlan(project, floor.id) ??
    ('floorPlan' in floor ? floor.floorPlan : undefined)
  if (!floorPlan) return false
  return Boolean(
    floorPlan.walls.length > 0 ||
      floorPlan.doors.length > 0 ||
      floorPlan.windows.length > 0 ||
      (floorPlan.stairs?.length ?? 0) > 0 ||
      (floorPlan.graphicElements?.length ?? 0) > 0
  )
}

function hasSitplanExportContent(
  project: SitplanExportProject,
  floor: Floor | FloorV2,
): boolean {
  return hasFloorPlanContent(project, floor) || collectPlacementsOnFloor(project, floor.id).length > 0
}

function getHiddenSitplanElementIds(floor: Floor | FloorV2): string[] {
  return 'hiddenSitplanElementIds' in floor
    ? floor.hiddenSitplanElementIds ?? []
    : 'hiddenSitplanPlacementIds' in floor
      ? floor.hiddenSitplanPlacementIds ?? []
      : []
}

interface SitplanPlacementRecord {
  floorId: string
  panelId: string
  label: string
  symbol: Endpoint['symbol']
}

function findPanelForEndpointInPanel(
  panel: Panel,
  endpointId: string,
  owner?: Panel,
): Panel | undefined {
  // A virtual board is not a board of its own: its circuits belong to the owner board here.
  const boardPanel = isVirtualPanel(panel) && owner ? owner : panel
  if (panel.circuits.some((circuit) => circuit.endpoints.some((endpoint) => endpoint.id === endpointId))) {
    return boardPanel
  }
  if (
    panel.protections.some((protection) =>
      (protection.circuits ?? []).some((circuit) =>
        circuit.endpoints.some((endpoint) => endpoint.id === endpointId),
      ),
    )
  ) {
    return boardPanel
  }
  for (const subPanel of panel.subPanels) {
    const found = findPanelForEndpointInPanel(subPanel, endpointId, boardPanel)
    if (found) return found
  }
  return undefined
}

function findPanelForEndpoint(project: SitplanExportProject, endpointId: string): Panel | undefined {
  for (const panel of selectProjectElectricalPanels(project)) {
    const found = findPanelForEndpointInPanel(panel, endpointId)
    if (found) return found
  }
  return undefined
}

function shouldCountEndpointForDuplicateLabels(endpoint: Endpoint): boolean {
  if (!endpoint.label?.trim()) return false
  if (endpoint.symbol === 'panel_distribution') {
    return false
  }
  return endpointSymbolVisibleOnSitplan(endpoint)
}

function shouldCountEndpointForPanelContent(endpoint: Endpoint): boolean {
  return endpointSymbolVisibleOnSitplan(endpoint)
}

function collectSitplanPlacements(project: SitplanExportProject): SitplanPlacementRecord[] {
  const placements: SitplanPlacementRecord[] = []
  const hiddenPlacementIdsByFloor = new Map(
    selectProjectBuildingFloors(project).map(
      (floor) => [floor.id, new Set(getHiddenSitplanElementIds(floor))] as const,
    ),
  )
  const addEndpointPlacements = (endpoint: Endpoint, panelId: string) => {
    if (!shouldCountEndpointForPanelContent(endpoint)) return
    for (const placement of endpoint.placements) {
      if (hiddenPlacementIdsByFloor.get(placement.floorId)?.has(placement.id)) continue
      placements.push({
        floorId: placement.floorId,
        panelId,
        label: endpoint.label,
        symbol: endpoint.symbol,
      })
    }
  }
  const visitPanel = (panel: Panel, ownerId?: string) => {
    const boardId = isVirtualPanel(panel) && ownerId ? ownerId : panel.id
    for (const circuit of panel.circuits) {
      for (const endpoint of circuit.endpoints) {
        addEndpointPlacements(endpoint, boardId)
      }
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        for (const endpoint of circuit.endpoints) {
          addEndpointPlacements(endpoint, boardId)
        }
      }
    }
    for (const subPanel of panel.subPanels) {
      visitPanel(subPanel, boardId)
    }
  }

  for (const panel of selectProjectElectricalPanels(project)) {
    visitPanel(panel)
  }
  return placements
}

/** True when the same circuit or endpoint label appears on different panels. */
export function hasDuplicateSitplanEndpointLabels(project: SitplanExportProject): boolean {
  const labelPanelIds = new Map<string, Set<string>>()

  const addLabel = (label: string, panelId: string): boolean => {
    const normalizedLabel = label.trim()
    if (!normalizedLabel || normalizedLabel.toUpperCase() === 'PANEL') return false
    let panelsForLabel = labelPanelIds.get(normalizedLabel)
    if (!panelsForLabel) {
      panelsForLabel = new Set<string>()
      labelPanelIds.set(normalizedLabel, panelsForLabel)
    }
    panelsForLabel.add(panelId)
    return panelsForLabel.size > 1
  }

  const visitPanel = (panel: Panel, ownerId?: string): boolean => {
    const boardId = isVirtualPanel(panel) && ownerId ? ownerId : panel.id
    for (const circuit of panel.circuits) {
      if (addLabel(circuit.code, boardId)) return true
      for (const endpoint of circuit.endpoints) {
        if (!shouldCountEndpointForDuplicateLabels(endpoint)) continue
        if (addLabel(endpoint.label, boardId)) return true
      }
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        if (addLabel(circuit.code, boardId)) return true
        for (const endpoint of circuit.endpoints) {
          if (!shouldCountEndpointForDuplicateLabels(endpoint)) continue
          if (addLabel(endpoint.label, boardId)) return true
        }
      }
    }
    return panel.subPanels.some((subPanel) => visitPanel(subPanel, boardId))
  }

  return selectProjectElectricalPanels(project).some((panel) => visitPanel(panel))
}

/**
 * Split sitplan export per panel when a floor has symbols for more than one panel
 * (for example main house + distant garden shed). Repeated placements of the same
 * endpoint on one panel do not trigger this.
 */
export function hasMultipleSitplanPanelsOnSameFloor(project: SitplanExportProject): boolean {
  const panelsByFloor = new Map<string, Set<string>>()

  for (const placement of collectSitplanPlacements(project)) {
    if (!placement.floorId) continue
    let panelsForFloor = panelsByFloor.get(placement.floorId)
    if (!panelsForFloor) {
      panelsForFloor = new Set<string>()
      panelsByFloor.set(placement.floorId, panelsForFloor)
    }
    panelsForFloor.add(placement.panelId)
    if (panelsForFloor.size > 1) return true
  }

  return false
}

export function buildSitplanExportTargets(
  project: SitplanExportProject,
  mergePlanPages = false,
): SitplanExportTarget[] {
  const floors = selectProjectBuildingFloors(project).filter((floor) =>
    hasSitplanExportContent(project, floor),
  )

  if (mergePlanPages || !hasMultipleSitplanPanelsOnSameFloor(project)) {
    return floors.map((floor) => ({
      id: `sitplan-${floor.id}`,
      floorId: floor.id,
      panelId: null,
      // Print the floor name on its page so floors are recognisable on paper.
      title: floor.name?.trim() || null,
    }))
  }

  const placements = collectSitplanPlacements(project)
  const panels = orderPanelsByNumber(
    selectProjectElectricalPanels(project),
    selectProjectElectricalInstallation(project),
  ).filter(isBoardPanel)
  const targets: SitplanExportTarget[] = []

  for (const floor of floors) {
    const floorPlacements = placements.filter((placement) => placement.floorId === floor.id)
    if (floorPlacements.length === 0) {
      if (!hasFloorPlanContent(project, floor)) continue
      targets.push({
        id: `sitplan-${floor.id}`,
        floorId: floor.id,
        panelId: null,
        title: floor.name?.trim() || null,
      })
      continue
    }

    for (const panel of panels) {
      const hasContent = floorPlacements.some((placement) => placement.panelId === panel.id)
      if (!hasContent) continue
      targets.push({
        id: `sitplan-${floor.id}-${panel.id}`,
        floorId: floor.id,
        panelId: panel.id,
        title: `${floor.name} - ${panel.name}`,
      })
    }
  }

  return targets
}

export function getSitplanPlacementPanelId(project: SitplanExportProject, endpointId: string): string | null {
  return findPanelForEndpoint(project, endpointId)?.id ?? null
}
