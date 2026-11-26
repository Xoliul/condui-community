import { useMemo, useState } from 'react'
import { isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { getSymbolCategory, SITPLAN_CATEGORY_VISIBILITY_KEYS } from '@/lib/plan/symbolCategories'
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
import { usePlanSymbolElectricalProject } from './usePlanSymbolElectricalProject'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import { findProjectTrunkDevice } from '@/lib/projectV2/trunkDeviceLookup'
import { findCircuitForEndpointInPanel } from '@/lib/eendraad/findCircuitForEndpointInPanel'
import { findPanelContainingCircuit } from '@/lib/eendraad/projectElectricalDomain'
import { getJunctionBoxPlanLabel } from '@/lib/plan/junctionBoxPlanLabel'

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
  const electricalProject = usePlanSymbolElectricalProject(true)
  const projectId = useProjectStore((state: ProjectState) => state.currentProject?.project.id)
  const hiddenPlacementIdsInput = useProjectStore((state: ProjectState) =>
    activeFloorId ? state.getFloorById(activeFloorId)?.hiddenSitplanPlacementIds : undefined
  )
  const getPlacementsByFloor = useProjectStore(
    (state: ProjectState) => state.getPlacementsByFloor
  )
  const lookups = useMemo(() => {
    if (!electricalProject) return null
    const panels = selectProjectElectricalPanels(electricalProject)
    const index = getElectricalLookupIndex(panels)
    return {
      endpoint: (id: string) => index.endpointsById.get(id)?.endpoint,
      trunk: (id: string) => findProjectTrunkDevice(electricalProject, id),
      endpointPanel: (id: string) => {
        for (const panel of panels) {
          const result = findCircuitForEndpointInPanel(panel, id)
          if (result) return result.panel
        }
        return undefined
      },
      circuitPanel: (id: string) => {
        for (const panel of panels) {
          const result = findPanelContainingCircuit(panel, id)
          if (result) return result
        }
        return undefined
      },
    }
  }, [electricalProject])

  // Keep visibility filtering reactive even when placement rows are structurally unchanged.
  // The row-reuse optimization intentionally preserves the placements array identity, so a
  // hidden-placement-only edit needs its own dependency to invalidate visiblePlacements.
  const hiddenPlacementIds = useMemo(
    () => new Set<string>(hiddenPlacementIdsInput ?? []),
    [hiddenPlacementIdsInput]
  )

  // Get placements for the active floor, filtered by scope and optional panel filter.
  // Defer this graph walk so a one-wire-only edit cannot extend its input event.
  const nextPlacements = useMemo(() => {
    const currentProject = electricalProject
    if (!activeFloorId || !currentProject || !projectId || !lookups) return []
    const floorPlacements = getPlacementsByFloor(activeFloorId)
    const trunkInfoById = new Map<string, ReturnType<typeof lookups.trunk>>()
    const getTrunkInfo = (id: string) => {
      if (!trunkInfoById.has(id)) trunkInfoById.set(id, lookups.trunk(id))
      return trunkInfoById.get(id)
    }
    const hasGround = installationHasAnyEarthing(
      selectProjectElectricalPanels(currentProject),
      selectProjectElectricalInstallation(currentProject)
    )
    let filtered = floorPlacements.filter((placement: SitplanPlacementRow) => {
      if (placement.isEarthing) return hasGround
      if (placement.junctionPanelLabel != null || placement.enclosureId != null) return true
      const endpoint = placement.endpointId ? lookups.endpoint(placement.endpointId) : undefined
      const trunkInfo = placement.trunkDeviceId
        ? getTrunkInfo(placement.trunkDeviceId)
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
          return lookups.endpointPanel(placement.endpointId)?.id === sitplanPanelFilterId
        }
        if (placement.trunkDeviceId) {
          const trunkInfo = getTrunkInfo(placement.trunkDeviceId)
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
            ? lookups.circuitPanel(circuitId)?.id === sitplanPanelFilterId
            : false
        }
        return false
      })
    }
    return filtered.map((placement) => {
      if (!placement.trunkDeviceId) return placement
      const trunkInfo = getTrunkInfo(placement.trunkDeviceId)
      if (!trunkInfo?.circuit || trunkInfo.device.symbol !== 'junction_box') return placement
      const planLabel = getJunctionBoxPlanLabel(trunkInfo.circuit, trunkInfo.device)
      return planLabel && planLabel !== placement.planLabel
        ? { ...placement, planLabel }
        : placement
    })
  }, [
    activeFloorId,
    electricalProject,
    projectId,
    getPlacementsByFloor,
    lookups,
    sitplanPanelFilterId,
  ])
  const [placementRows, setPlacementRows] = useState({ source: nextPlacements, rows: nextPlacements })
  if (placementRows.source !== nextPlacements) {
    setPlacementRows({ source: nextPlacements, rows: reusePlacementRows(placementRows.rows, nextPlacements) })
  }
  const placements = placementRows.rows

  // Wire anchors remain eligible when symbol artwork or a symbol group is hidden.
  // Explicitly hidden and not-yet-placed items still cannot anchor visible wires.
  const wirePlacements = useMemo(
    () =>
      placements.filter((placement) =>
        !hiddenPlacementIds.has(placement.id) && !isAwaitingPlanPlacement(placement)
      ),
    [placements, hiddenPlacementIds]
  )

  // Filter placements by visibility (symbols master + per-category)
  const nextVisiblePlacements = useMemo(() => {
    if (!planVisibility.symbolsVisible) return []
    const filtered = wirePlacements.filter((placement: SitplanPlacementRow) => {
      if (placement.isEarthing) return planVisibility.earthingVisible !== false
      if (placement.junctionPanelLabel != null) return planVisibility.panelsVisible
      if (placement.enclosureId != null) return planVisibility.panelsVisible
      const endpoint = placement.endpointId ? lookups?.endpoint(placement.endpointId) : undefined
      const trunkDevice = placement.trunkDeviceId
        ? lookups?.trunk(placement.trunkDeviceId)?.device
        : undefined
      const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
      if (!symbolKey) return false
      const cat = getSymbolCategory(symbolKey as SymbolKey)
      if (cat === null) return true
      return planVisibility[SITPLAN_CATEGORY_VISIBILITY_KEYS[cat]] !== false
    })
    return filtered
  }, [
    wirePlacements,
    planVisibility,
    lookups,
  ])
  const [visibleRows, setVisibleRows] = useState({ source: nextVisiblePlacements, rows: nextVisiblePlacements })
  if (visibleRows.source !== nextVisiblePlacements) {
    setVisibleRows({ source: nextVisiblePlacements,
      rows: planVisibility.symbolsVisible ? reuseMembers(visibleRows.rows, nextVisiblePlacements) : visibleRows.rows })
  }
  const visiblePlacements = planVisibility.symbolsVisible ? visibleRows.rows : nextVisiblePlacements

  return {
    placements,
    wirePlacements,
    visiblePlacements,
  }
}
