import type { SymbolPlaceAnalyticsOptions as SymbolPlaceEvent } from '@/lib/analytics/editorEventAnalytics'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  Endpoint,
  Floor,
  ProtectionDevice,
  Circuit,
  Panel,
  TrunkDevice,
  Placement,
} from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { TFunction } from 'i18next'
import { type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { type ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import { findPanelById } from '@/lib/panel/panelTree'
import { getSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'

export type DropBehaviorProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface DropBehavior {
  validTargets: Array<DropTarget['type']>
  execute: (
    target: DropTarget,
    project: DropBehaviorProject,
    symbol: SymbolMetadata,
    t: TFunction,
    callbacks: DropBehaviorCallbacks
  ) => void
}

export interface DropBehaviorCallbacks {
  /** Optional deterministic id source for command-driven drops. */
  newId?: () => string
  /** Reinsert an ordinary endpoint that was detached within the same transaction. */
  existingEndpointId?: string
  addPanel: (panel: Panel, parentPanelId?: string) => void
  addProtection: (panelId: string, protection: ProtectionDevice) => void
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addCircuitToProtection: (panelId: string, protectionId: string, circuit: Circuit) => void
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null,
    branchOpts?: {
      branchId?: string | null
      branchInsertIndex?: number
      forceNewBranch?: boolean
    }
  ) => void
  addPlacement: (endpointId: string, placement: Placement) => void
  updateEndpoint: (endpointId: string, updates: Partial<Endpoint>) => void
  setSelection: (selection: Selection) => void
  /** Wire-canvas world position where the library symbol was dropped (e.g. for free-floating notes). */
  dropCanvasPosition?: Point
  getFloorById: (floorId: string) => {
    id: string
    layers?: string[]
    hiddenSitplanPlacementIds?: string[]
  } | null
  updateFloor: (floorId: string, updates: Partial<Floor>) => void
  getCircuitById: (circuitId: string) => Circuit | null
  getProtectionById: (protectionId: string) => ProtectionDevice | null
  addTrunkDevice: (circuitId: string, device: TrunkDevice) => void
  addSupplyTrunkDevice: (
    device: TrunkDevice,
    insertIndex?: number,
    target?: {
      panelId?: string
      feedScope?: DropTarget['supplyFeedScope']
      diagramId?: string
      supplyPanelInput?: boolean
      busSectionId?: string
    }
  ) => void
  updateSupplyTrunkDevice?: (deviceId: string, updates: Partial<TrunkDevice>) => void
  addGroundTrunkDevice: (device: TrunkDevice, insertIndex?: number, panelId?: string) => void
  ensureJunctionPanelPlacementForLabel: (label: string, floorId?: string) => void
  ensureSecondaryPanelEarthingStem: (panelId: string) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  updateProtection: (protectionId: string, updates: Partial<ProtectionDevice>) => void
  updateInstallation: (
    updates: Partial<NonNullable<ReturnType<typeof projectInstallation>>>
  ) => void
  addSupplyAssembly: (assembly: OffGridSupplyAssembly) => void
  replaceSupplyAssembly: (id: string, assembly: OffGridSupplyAssembly) => void
  moveCircuitOnMainBus: (panelId: string, circuitId: string, direction: 'left' | 'right') => void
  moveCircuitToSecondaryBus: (
    panelId: string,
    parentCircuitId: string,
    circuitId: string,
    insertIndex: number
  ) => void
  deleteEndpoint: (endpointId: string) => void
  deleteProtection?: (protectionId: string) => void
  addEendraadNote: (note: {
    id: string
    text: string
    fontSize: number
    pos: Point
    panelId?: string
  }) => void
  /** Called when a drop is rejected (e.g. domain mismatch for conversion components) */
  onDropRejected?: (message: string) => void
  /** Active floor and visible plan centre for automatic situation-plan placements. */
  getSitplanTarget: () => SitplanPlacementTarget
  /** Puts the earthing symbol on the floor when the installation has earthing. */
  ensureEarthingSitplanPlacement: (floorId: string, pos?: Point) => void
  /** Analytics hooks; called after the drop has executed. */
  onSymbolPlaced?: (event: SymbolPlaceEvent) => void
  onNotePlaced?: () => void
}

/** Editor-side parts of the callbacks: plan target, live follow-ups and analytics hooks. */
export type DropBehaviorEditorHooks = Pick<
  DropBehaviorCallbacks,
  | 'getSitplanTarget'
  | 'ensureEarthingSitplanPlacement'
  | 'ensureSecondaryPanelEarthingStem'
  | 'onSymbolPlaced'
  | 'onNotePlaced'
>

/** The visible plan centre, when the plan shows the floor that receives the placement. */
export function viewportCenterOn(target: SitplanPlacementTarget, floorId: string): Point | null {
  return target.viewportCenter && target.activeFloorId === floorId ? target.viewportCenter : null
}

export function projectPanels(project: DropBehaviorProject): Panel[] {
  return project.disciplines?.electrical?.panels ?? []
}

export function projectInstallation(project: DropBehaviorProject) {
  return project.disciplines?.electrical?.installation
}

/** Find protection by id in project (searches all panels and subPanels) */
export function findProtectionInProject(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections?.find((pr) => pr.id === id)
    if (pr) return pr
    const found = findProtectionInProject(p.subPanels || [], id)
    if (found) return found
  }
  return null
}

/**
 * The board a drop lands in. A supply-frame drop names the owner main panel; when its circuit is
 * a supply tap, the circuit lives in the owner's supply-taps board, so new protections and
 * circuits for it belong there too (else the tap would reference a circuit in another board).
 */
export function findPanelForTarget(project: DropBehaviorProject, target: DropTarget): Panel | null {
  const panels = projectPanels(project)
  if (target.panelId) {
    const panel = findPanelById(panels, target.panelId) ?? null
    const taps = panel && target.circuitId ? getSupplyTapsPanel(panel) : undefined
    const ownsCircuit = taps && [
      ...(taps.circuits ?? []),
      ...(taps.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ].some((circuit) => circuit.id === target.circuitId)
    return ownsCircuit ? taps : panel
  }
  return panels.find((p) => p.isMain) || panels[0] || null
}

export function panelIdForGroundDevice(
  project: DropBehaviorProject,
  target: DropTarget
): string | undefined {
  const panel = findPanelForTarget(project, target)
  return panel?.isMain === false ? panel.id : undefined
}

export function findProtectionByCircuitIdInProject(
  panels: Panel[],
  circuitId: string
): ProtectionDevice | null {
  for (const panel of panels) {
    for (const protection of panel.protections ?? []) {
      if (protection.circuits?.some((c) => c.id === circuitId)) {
        return protection
      }
    }
    const inSubPanels = findProtectionByCircuitIdInProject(panel.subPanels ?? [], circuitId)
    if (inSubPanels) return inSubPanels
  }
  return null
}
