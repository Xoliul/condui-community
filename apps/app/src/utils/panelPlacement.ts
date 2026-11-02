/**
 * Utilities for managing panel placements on the plan
 * 
 * Panels need to appear on the plan as panel_distribution symbols.
 * We create a special endpoint for each panel that represents it on the plan.
 */

import { generateId } from './project'
import type { Panel, Endpoint, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'
import { createPanelDistributionEndpoint } from '@/lib/plan/panelPlacementMutations'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

const DEFAULT_CENTER_X = 400
const DEFAULT_CENTER_Y = 300
const COLLISION_BASE_HALF = 42

type EnsurePanelPlacementOptions = {
  preferredPlanPos?: Point
  /** Prefer the currently active plan floor when a drop explicitly supplies one. */
  preferredFloorId?: string
  /** Id source for the generated endpoint and placement; defaults to random ids. */
  newId?: () => string
}

type PanelPlacementProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

/**
 * Find panel in hierarchy
 */
function findPanel(panels: Panel[], panelId: string): Panel | undefined {
  for (const panel of panels) {
    if (panel.id === panelId) return panel
    const found = findPanel(panel.subPanels, panelId)
    if (found) return found
  }
  return undefined
}

/**
 * Get or create the endpoint that represents a panel on the plan
 */
export function getPanelEndpoint(project: PanelPlacementProject, panelId: string): Endpoint | null {
  // Find endpoint with symbol 'panel_distribution' that represents this panel
  // We'll use a naming convention: endpoint label matches panel name
  const rootPanels = getProjectElectricalPanels(project)
  const panel = findPanel(rootPanels, panelId)
  if (!panel) return null
  
  // Search all circuits for panel endpoint
  const searchCircuits = (panels: Panel[]): Endpoint | null => {
    for (const p of panels) {
      for (const circuit of p.circuits) {
        const endpoint = circuit.endpoints.find(
          e =>
            e.symbol === 'panel_distribution' &&
            (e.panelId === panel.id || e.label === panel.name)
        )
        if (endpoint) return endpoint
      }
      for (const protection of p.protections) {
        if (protection.circuits) {
          for (const circuit of protection.circuits) {
            const endpoint = circuit.endpoints.find(
              e =>
                e.symbol === 'panel_distribution' &&
                (e.panelId === panel.id || e.label === panel.name)
            )
            if (endpoint) return endpoint
          }
        }
      }
      const found = searchCircuits(p.subPanels)
      if (found) return found
    }
    return null
  }
  
  return searchCircuits(rootPanels)
}

/**
 * Create an endpoint that represents a panel on the plan
 */
export function createPanelEndpoint(panel: Panel, newId?: () => string): Endpoint {
  return createPanelDistributionEndpoint(panel, newId)
}

/**
 * Get or create placement for a panel on a floor
 */
export function getPanelPlacement(
  project: PanelPlacementProject,
  panelId: string,
  floorId: string
): Placement | null {
  const panelEndpoint = getPanelEndpoint(project, panelId)
  if (!panelEndpoint) return null
  
  return panelEndpoint.placements.find(
    p => p.floorId === floorId
  ) || null
}

/**
 * Create a default placement for a panel on a floor (centered)
 */
export function createPanelPlacement(
  floorId: string,
  centerX: number = DEFAULT_CENTER_X,
  centerY: number = DEFAULT_CENTER_Y,
  layer: string = 'electrical',
  newId: () => string = generateId
): Placement {
  return {
    id: newId(),
    floorId,
    layer,
    pos: { x: centerX, y: centerY },
    rotationDeg: 0,
    scale: 1,
  }
}

function squaresOverlap(
  ax: number,
  ay: number,
  aHalf: number,
  bx: number,
  by: number,
  bHalf: number,
): boolean {
  return Math.abs(ax - bx) < aHalf + bHalf && Math.abs(ay - by) < aHalf + bHalf
}

function halfExtentForPlacement(scale: number | undefined): number {
  return COLLISION_BASE_HALF * Math.max(scale ?? 1, 0.25)
}

function collectPlacementsOnFloor(project: PanelPlacementProject, floorId: string): Placement[] {
  const placements: Placement[] = []
  const visitPanel = (panel: Panel) => {
    for (const circuit of panel.circuits ?? []) {
      for (const endpoint of circuit.endpoints ?? []) {
        for (const placement of endpoint.placements ?? []) {
          if (placement.floorId === floorId) placements.push(placement)
        }
      }
    }
    for (const protection of panel.protections ?? []) {
      for (const circuit of protection.circuits ?? []) {
        for (const endpoint of circuit.endpoints ?? []) {
          for (const placement of endpoint.placements ?? []) {
            if (placement.floorId === floorId) placements.push(placement)
          }
        }
      }
    }
    for (const child of panel.subPanels ?? []) {
      visitPanel(child)
    }
  }

  for (const panel of getProjectElectricalPanels(project)) {
    visitPanel(panel)
  }
  return placements
}

function separatePlanPositionFromPlacements(
  start: Point,
  newHalf: number,
  obstacles: Array<{ x: number; y: number; half: number }>,
  maxRadius = 720,
): Point {
  const overlapsAny = (x: number, y: number) =>
    obstacles.some((o) => squaresOverlap(x, y, newHalf, o.x, o.y, o.half))

  if (!overlapsAny(start.x, start.y)) return start

  const ringStep = 16
  const anglesPerRing = 20
  const maxRing = Math.ceil(maxRadius / ringStep)
  for (let ring = 1; ring <= maxRing; ring++) {
    const r = ring * ringStep
    for (let i = 0; i < anglesPerRing; i++) {
      const a = (i * 2 * Math.PI) / anglesPerRing
      const x = start.x + Math.cos(a) * r
      const y = start.y + Math.sin(a) * r
      if (!overlapsAny(x, y)) return { x, y }
    }
  }
  return start
}

/**
 * Ensure a panel has an endpoint and placement on the ground floor
 */
export function ensurePanelPlacement(
  project: PanelPlacementProject,
  panel: Panel,
  options?: EnsurePanelPlacementOptions
): { endpoint: Endpoint; placement: Placement } | null {
  // Get ground floor (first floor)
  const floors = selectProjectBuildingFloors(project)
  const preferredFloor = options?.preferredFloorId
    ? floors.find((floor) => floor.id === options.preferredFloorId)
    : undefined
  const groundFloor =
    preferredFloor ??
    (floors.find(
      (f) => f.name.toLowerCase().includes('ground') || f.name.toLowerCase().includes('grond')
    ) || floors[0])
  if (!groundFloor) return null
  
  // Get or create the panel endpoint
  let panelEndpoint = getPanelEndpoint(project, panel.id)
  
  if (!panelEndpoint) {
    panelEndpoint = createPanelEndpoint(panel, options?.newId)
  }
  
  // Get or create placement
  let placement = getPanelPlacement(project, panel.id, groundFloor.id)
  
  if (!placement) {
    const layer =
      'layers' in groundFloor && Array.isArray(groundFloor.layers)
        ? groundFloor.layers[0] ?? 'electrical'
        : 'electrical'
    const allPlacements = collectPlacementsOnFloor(project, groundFloor.id)
    const obstacles = allPlacements
      .filter((p) => p.layer === layer)
      .map((p) => ({
        x: p.pos.x,
        y: p.pos.y,
        half: halfExtentForPlacement(p.scale),
      }))
    const start = options?.preferredPlanPos ?? { x: DEFAULT_CENTER_X, y: DEFAULT_CENTER_Y }
    const separated = separatePlanPositionFromPlacements(
      start,
      halfExtentForPlacement(1),
      obstacles,
    )
    placement = createPanelPlacement(groundFloor.id, separated.x, separated.y, layer, options?.newId)
  }
  
  return { endpoint: panelEndpoint, placement }
}
