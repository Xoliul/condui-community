import type { Placement, Point2 } from '@/types/schema'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import { generateId } from '@/utils/project'
import {
  mutateBuildingFloorView,
  readLegacyCompatibilityFloors,
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findMainPanel, findPanelById } from '@/lib/panel/panelTree'
import type { Endpoint, Panel } from '@/types/schema'

type EnclosurePlanProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

/** Supply enclosures hang beside their board: this far below it, in plan units. */
const OFFSET_FROM_PANEL_Y = 120
const DEFAULT_POS: Point2 = { x: 400, y: 420 }

function panelPlacement(panels: readonly Panel[], panel: Panel): Placement | undefined {
  const visit = (current: Panel): Endpoint | undefined => {
    const circuits = [
      ...current.circuits,
      ...current.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const endpoint = circuit.endpoints.find(
        (candidate) =>
          candidate.symbol === 'panel_distribution' &&
          (candidate.panelId === panel.id || (!candidate.panelId && candidate.label === panel.name))
      )
      if (endpoint) return endpoint
    }
    for (const subPanel of current.subPanels) {
      const found = visit(subPanel)
      if (found) return found
    }
    return undefined
  }
  for (const root of panels) {
    const endpoint = visit(root)
    if (endpoint?.placements[0]) return endpoint.placements[0]
  }
  return undefined
}

/** A plan placement for an enclosure: beside its owner board, else on the first floor. */
export function defaultAuxiliaryEnclosurePlacement(
  project: EnclosurePlanProject,
  enclosure: AuxiliaryElectricalEnclosure,
  index = 0
): Placement | undefined {
  const panels = selectProjectElectricalPanels(project)
  const owner =
    (enclosure.ownerPanelId ? findPanelById(panels, enclosure.ownerPanelId) : undefined) ??
    findMainPanel(panels)
  const anchor = owner ? panelPlacement(panels, owner) : undefined
  const floors = selectProjectBuildingFloors(project)
  const floorId = anchor?.floorId ?? floors[0]?.id
  if (!floorId) return undefined
  const floor = floors.find((candidate) => candidate.id === floorId)
  const base = anchor?.pos ?? DEFAULT_POS
  return {
    id: generateId(),
    floorId,
    layer: floor && 'layers' in floor ? (floor.layers?.[0] ?? 'electrical') : 'electrical',
    pos: { x: base.x + index * OFFSET_FROM_PANEL_Y, y: base.y + OFFSET_FROM_PANEL_Y },
    rotationDeg: 0,
    scale: 1,
  }
}

/**
 * Gives every supply enclosure a plan placement, so it shows on the plan with the cables that
 * run through it. Mutates the project; returns true when a placement was added.
 */
export function healAuxiliaryEnclosurePlanPlacements(project: EnclosurePlanProject): boolean {
  let added = false
  selectProjectAuxiliaryElectricalEnclosures(project).forEach((enclosure, index) => {
    if ((enclosure.placements?.length ?? 0) > 0) return
    const placement = defaultAuxiliaryEnclosurePlacement(project, enclosure, index)
    if (!placement) return
    enclosure.placements = [placement]
    added = true
  })
  return added
}

/** Whether an enclosure has a placement on the plan that is not hidden. */
export function isAuxiliaryEnclosureShownOnPlan(
  project: EnclosurePlanProject,
  enclosure: AuxiliaryElectricalEnclosure
): boolean {
  const hidden = new Set(
    readLegacyCompatibilityFloors(project).flatMap((floor) => floor.hiddenSitplanPlacementIds ?? [])
  )
  return (enclosure.placements ?? []).some((placement) => !hidden.has(placement.id))
}

/**
 * Shows or hides an enclosure on the plan. Hidden, the cables that end at it are hidden too.
 * Showing an enclosure that was never placed puts it beside its board. Mutates the project.
 */
export function setAuxiliaryEnclosureShownOnPlan(
  project: EnclosurePlanProject,
  enclosureId: string,
  shown: boolean
): boolean {
  const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
    (candidate) => candidate.id === enclosureId
  )
  if (!enclosure) return false
  if (shown && (enclosure.placements?.length ?? 0) === 0) {
    const placement = defaultAuxiliaryEnclosurePlacement(project, enclosure)
    if (!placement) return false
    enclosure.placements = [placement]
  }
  const placementIds = new Set((enclosure.placements ?? []).map((placement) => placement.id))
  let changed = false
  for (const floor of selectProjectBuildingFloors(project)) {
    mutateBuildingFloorView(project, floor.id, (view) => {
      const current = view.hiddenSitplanPlacementIds ?? []
      const next = shown
        ? current.filter((id) => !placementIds.has(id))
        : [
            ...current,
            ...[...placementIds].filter(
              (id) =>
                !current.includes(id) &&
                enclosure.placements?.some(
                  (placement) => placement.id === id && placement.floorId === floor.id
                )
            ),
          ]
      if (next.length !== current.length) {
        view.hiddenSitplanPlacementIds = next
        changed = true
      }
    })
  }
  return changed
}
