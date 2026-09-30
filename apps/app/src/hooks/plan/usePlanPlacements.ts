import { useMemo, useRef } from 'react'
import { isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { getSymbolCategory } from '@/components/plan/SitplanVisibilityPanel'
import type { SymbolKey, Placement } from '@/types/schema'
import type { PlanVisibility } from '@/stores/uiStore'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  installationHasAnyEarthing,
  panelRendersEarthingStem,
} from '@/lib/eendraad/panelGround'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { endpointSymbolVisibleOnSitplan } from '@/lib/plan/planSymbolVisibility'

type SitplanPlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  enclosureId?: string
  planLabel?: string
  isEarthing?: boolean
  junctionPanelLabel?: string
}

function shallowEqualPlacementRow(a: SitplanPlacementRow, b: SitplanPlacementRow): boolean {
  return (
    a.id === b.id &&
    a.floorId === b.floorId &&
    a.layer === b.layer &&
    a.pos.x === b.pos.x &&
    a.pos.y === b.pos.y &&
    a.rotationDeg === b.rotationDeg &&
    a.rotationMode === b.rotationMode &&
    a.scale === b.scale &&
    a.locked === b.locked &&
    a.endpointId === b.endpointId &&
    a.trunkDeviceId === b.trunkDeviceId &&
    a.enclosureId === b.enclosureId &&
    a.planLabel === b.planLabel &&
    a.junctionPanelLabel === b.junctionPanelLabel &&
    a.isEarthing === b.isEarthing &&
    (a.style === b.style || JSON.stringify(a.style) === JSON.stringify(b.style))
  )
}

function reusePlacementRows(
  previous: SitplanPlacementRow[],
  next: SitplanPlacementRow[]
): SitplanPlacementRow[] {
  if (previous.length === 0) return next
  const previousById = new Map(previous.map((placement) => [placement.id, placement]))
  const reused = next.map((placement) => {
    const prior = previousById.get(placement.id)
    return prior && shallowEqualPlacementRow(prior, placement) ? prior : placement
  })
  return reused.length === previous.length && reused.every((item, index) => item === previous[index])
    ? previous
    : reused
}

function reuseMembers<T>(previous: T[], next: T[]): T[] {
  return next.length === previous.length && next.every((item, index) => item === previous[index])
    ? previous
    : next
}

/**
 * Hook to get and filter placements for the plan canvas
 */
export function usePlanPlacements(
  activeFloorId: string | null,
  sitplanPanelFilterId: string | null,
  planVisibility: PlanVisibility
) {
  const previousPlacementsRef = useRef<SitplanPlacementRow[]>([])
  const previousVisiblePlacementsRef = useRef<SitplanPlacementRow[]>([])
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const getPlacementsByFloor = useProjectStore(
    (state: ProjectState) => state.getPlacementsByFloor
  )
  const getEndpointById = useProjectStore((state: ProjectState) => state.getEndpointById)
  const getTrunkDeviceById = useProjectStore(
    (state: ProjectState) => state.getTrunkDeviceById
  )
  const findCircuitForEndpoint = useProjectStore(
    (state: ProjectState) => state.findCircuitForEndpoint
  )
  const getFloorById = useProjectStore((state: ProjectState) => state.getFloorById)

  // Keep visibility filtering reactive even when placement rows are structurally unchanged.
  // The row-reuse optimization intentionally preserves the placements array identity, so a
  // hidden-placement-only edit needs its own dependency to invalidate visiblePlacements.
  const hiddenPlacementIds = useMemo(() => {
    if (!currentProject) return new Set<string>()
    const floor = activeFloorId ? getFloorById(activeFloorId) : null
    return new Set<string>(floor?.hiddenSitplanPlacementIds ?? [])
  }, [activeFloorId, currentProject, getFloorById])

  // Get placements for the active floor, filtered by scope and optional panel filter.
  // Defer this graph walk so a one-wire-only edit cannot extend its input event.
  const placements = useMemo(() => {
    if (!activeFloorId || !currentProject) return []
    const floorPlacements = getPlacementsByFloor(activeFloorId)
    const hasGround = installationHasAnyEarthing(
      selectProjectElectricalPanels(currentProject),
      selectProjectElectricalInstallation(currentProject)
    )
    let filtered = floorPlacements.filter((placement: SitplanPlacementRow) => {
      if (placement.isEarthing) return hasGround
      if (placement.junctionPanelLabel != null || placement.enclosureId != null) return true
      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
      const trunkInfo = placement.trunkDeviceId
        ? getTrunkDeviceById(placement.trunkDeviceId)
        : undefined
      const trunkDevice = trunkInfo?.device
      if (endpoint) return endpointSymbolVisibleOnSitplan(endpoint)
      return (
        (trunkDevice?.type === 'energy_meter' &&
          (trunkInfo?.isSupplyDevice === true || trunkInfo?.circuit?.code === 'PANEL')) ||
        canSymbolAppearOnSituationPlan(trunkDevice?.symbol)
      )
    })
    if (sitplanPanelFilterId) {
      const selectedPanel = findPanelById(
        selectProjectElectricalPanels(currentProject),
        sitplanPanelFilterId
      )
      filtered = filtered.filter((placement: SitplanPlacementRow) => {
        if (placement.isEarthing) {
          return selectedPanel
            ? panelRendersEarthingStem(
                selectedPanel,
                selectProjectElectricalInstallation(currentProject)
              )
            : false
        }
        if (placement.junctionPanelLabel != null) return true
        if (placement.enclosureId != null) {
          const enclosure = currentProject.disciplines?.electrical?.auxiliaryEnclosures?.find(
            (candidate) => candidate.id === placement.enclosureId
          )
          return enclosure?.ownerPanelId === sitplanPanelFilterId
        }
        if (placement.endpointId) {
          return findCircuitForEndpoint(placement.endpointId)?.panel.id === sitplanPanelFilterId
        }
        if (placement.trunkDeviceId) {
          const trunkInfo = getTrunkDeviceById(placement.trunkDeviceId)
          if (
            trunkInfo?.isSupplyDevice &&
            trunkInfo.device.type === 'energy_meter' &&
            !trunkInfo.circuit
          ) {
            return trunkInfo.supplyPanelId
              ? trunkInfo.supplyPanelId === sitplanPanelFilterId
              : selectedPanel?.isMain === true
          }
          const circuitId = trunkInfo?.circuit?.id
          return circuitId
            ? useProjectStore.getState().findPanelForCircuit(circuitId)?.id === sitplanPanelFilterId
            : false
        }
        return false
      })
    }
    const stablePlacements = reusePlacementRows(previousPlacementsRef.current, filtered)
    previousPlacementsRef.current = stablePlacements
    return stablePlacements
  }, [
    activeFloorId,
    currentProject,
    getPlacementsByFloor,
    getEndpointById,
    getTrunkDeviceById,
    findCircuitForEndpoint,
    sitplanPanelFilterId,
  ])

  // Filter placements by visibility (symbols master + per-category)
  const visiblePlacements = useMemo(() => {
    if (!planVisibility.symbolsVisible) return []
    const filtered = placements.filter((placement: SitplanPlacementRow) => {
      if (hiddenPlacementIds.has(placement.id)) return false
      // Waiting for the user to place it (manual plan placement): stays in the Quick Placer only.
      if (isAwaitingPlanPlacement(placement)) return false
      if (placement.isEarthing) return planVisibility.panelsVisible
      if (placement.junctionPanelLabel != null) return planVisibility.panelsVisible
      if (placement.enclosureId != null) return planVisibility.panelsVisible
      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
      const trunkDevice = placement.trunkDeviceId
        ? getTrunkDeviceById(placement.trunkDeviceId)?.device
        : undefined
      const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
      if (!symbolKey) return false
      const cat = getSymbolCategory(symbolKey as SymbolKey)
      if (cat === null) return true
      const flag =
        cat === 'sockets'
          ? planVisibility.socketsVisible
          : cat === 'lights'
            ? planVisibility.lightsVisible
            : cat === 'switches'
              ? planVisibility.switchesVisible
              : cat === 'panels'
                ? planVisibility.panelsVisible
                : planVisibility.fixedAppliancesVisible
      return flag
    })
    const stableVisiblePlacements = reuseMembers(previousVisiblePlacementsRef.current, filtered)
    previousVisiblePlacementsRef.current = stableVisiblePlacements
    return stableVisiblePlacements
  }, [
    placements,
    planVisibility,
    getEndpointById,
    getTrunkDeviceById,
    hiddenPlacementIds,
  ])

  return {
    placements,
    visiblePlacements,
  }
}
