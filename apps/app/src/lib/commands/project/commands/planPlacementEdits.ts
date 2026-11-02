import { z } from 'zod'
import { mergeHiddenSituationPlanPlacementIds } from '@/lib/plan/hideSituationPlanPlacements'
import {
  ensureEarthingSitplanPlacementInProject,
  resolvePlanPlacement,
  updateEarthingPlacementInProject,
  updateJunctionPanelPlacementInProject,
  updatePlacementInProject,
} from '@/lib/plan/placementMutations'
import { explicitClockwiseRotationPatch } from '@/lib/plan/situationPlanRotation'
import {
  addEarthingPlacementInProject,
  updateFloorInProject,
  updateInstallationInProject,
} from '@/lib/projectMutations/storeActions'
import {
  readLegacyCompatibilityFloors,
  selectProjectBuildingFloors,
} from '@/lib/projectV2/buildingFloors'
import { getEditableProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand, type CommandCheck, type EntityRef } from '../types'

const id = z.string().min(1)
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() })

function checkFloorExists(project: ProjectV2, floorId: string): CommandCheck {
  return selectProjectBuildingFloors(project).some((floor) => floor.id === floorId)
    ? { ok: true }
    : { ok: false, code: 'floor_not_found', message: 'Floor not found' }
}

function checkPlacementsExist(project: ProjectV2, placementIds: readonly string[]): CommandCheck {
  for (const placementId of placementIds) {
    if (!resolvePlanPlacement(project, placementId)) {
      return {
        ok: false,
        code: 'placement_not_found',
        message: 'Placement not found',
        details: { placementId },
      }
    }
  }
  return { ok: true }
}

const placementRefs = (ids: Iterable<string>): EntityRef[] =>
  [...new Set(ids)].map((placementId) => ({ kind: 'placement', id: placementId }))

/**
 * Hides placements in a floor's situation-plan view, or shows them there again. Hiding a
 * placement that follows panel visibility also keeps the panel in step (the active panel of
 * the editor shows it first).
 */
export const planSetPlacementsHidden = defineProjectCommand({
  id: 'plan.setPlacementsHidden',
  version: 1,
  input: z.strictObject({
    floorId: id,
    placementIds: z.array(id).min(1),
    hidden: z.boolean(),
    activePanelId: id.nullable().optional(),
  }),
  check: (project, input) => checkFloorExists(project as ProjectV2, input.floorId),
  apply(draft, input) {
    const project = draft as ProjectV2
    const floor = readLegacyCompatibilityFloors(project).find(
      (candidate) => candidate.id === input.floorId
    )
    const existing = floor?.hiddenSitplanPlacementIds ?? []
    const requested = new Set(input.placementIds)
    const next = input.hidden
      ? mergeHiddenSituationPlanPlacementIds(existing, input.placementIds)
      : existing.filter((placementId) => !requested.has(placementId))
    if (next.length === existing.length) return { created: [], changed: [], removed: [] }
    const result = updateFloorInProject(
      project,
      input.floorId,
      { hiddenSitplanPlacementIds: next.length > 0 ? next : undefined },
      input.activePanelId ?? null
    )
    return {
      created: [],
      changed: result.changed ? [{ kind: 'floor', id: input.floorId }] : [],
      removed: [],
    }
  },
})

/** Turns situation-plan symbols a quarter turn clockwise and pins their rotation (R key). */
export const planRotatePlacements = defineProjectCommand({
  id: 'plan.rotatePlacements',
  version: 1,
  input: z.strictObject({ placementIds: z.array(id).min(1) }),
  check: (project, input) => checkPlacementsExist(project as ProjectV2, input.placementIds),
  apply(draft, input) {
    const project = draft as ProjectV2
    const related: EntityRef[] = []
    const rotated: string[] = []
    for (const placementId of new Set(input.placementIds)) {
      const target = resolvePlanPlacement(project, placementId)!
      const patch = explicitClockwiseRotationPatch({
        rotationDeg: target.placement.rotationDeg ?? 0,
      })
      if (target.kind === 'junctionPanel') {
        if (!updateJunctionPanelPlacementInProject(project, placementId, patch)) continue
      } else if (target.kind === 'earthing') {
        if (!updateEarthingPlacementInProject(project, placementId, patch)) continue
      } else {
        const updated = updatePlacementInProject(project, placementId, patch)
        if (!updated) continue
        if (updated.circuitId) related.push({ kind: 'circuit', id: updated.circuitId })
      }
      rotated.push(placementId)
    }
    return { created: [], changed: placementRefs(rotated), removed: [], related }
  },
})

/** Locks a symbol position on the situation plan, or unlocks it. */
export const planSetPlacementLocked = defineProjectCommand({
  id: 'plan.setPlacementLocked',
  version: 1,
  input: z.strictObject({ placementId: id, locked: z.boolean() }),
  check: (project, input) => checkPlacementsExist(project as ProjectV2, [input.placementId]),
  apply(draft, input) {
    const updated = updatePlacementInProject(draft as ProjectV2, input.placementId, {
      locked: input.locked,
    })
    if (!updated) return { created: [], changed: [], removed: [] }
    return {
      created: [],
      changed: placementRefs([input.placementId]),
      removed: [],
      related: updated.circuitId ? [{ kind: 'circuit', id: updated.circuitId }] : [],
    }
  },
})

/**
 * Drops the earthing symbol on a floor: turns the earthing of the installation on, then moves
 * the symbol already on that floor to the drop position or adds one there.
 */
export const planDropEarthing = defineProjectCommand({
  id: 'plan.dropEarthing',
  version: 1,
  input: z.strictObject({ floorId: id, layer: id, pos: point }),
  check(project, input) {
    const floor = checkFloorExists(project as ProjectV2, input.floorId)
    if (!floor.ok) return floor
    return getEditableProjectElectricalInstallation(project as ProjectV2)
      ? { ok: true }
      : { ok: false, code: 'installation_missing', message: 'Electrical installation not found' }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const installation = getEditableProjectElectricalInstallation(project)!
    const changed: EntityRef[] = []
    const created: EntityRef[] = []
    if (installation.hasGround === false) {
      if (updateInstallationInProject(project, { hasGround: true }).changed)
        changed.push({ kind: 'installation', id: 'electrical' })
    }
    const existing = installation.earthingPlacements?.find(
      (placement) => placement.floorId === input.floorId
    )
    if (existing) {
      if (updateEarthingPlacementInProject(project, existing.id, { pos: input.pos }))
        changed.push(...placementRefs([existing.id]))
    } else {
      const placementId = env.newId()
      addEarthingPlacementInProject(project, {
        id: placementId,
        floorId: input.floorId,
        pos: input.pos,
        rotationDeg: 0,
        scale: 1,
        layer: input.layer,
      })
      created.push(...placementRefs([placementId]))
    }
    return { created, changed, removed: [], select: [{ kind: 'ground', id: 'ground' }] }
  },
})

/**
 * Makes sure the earthing symbol is on a floor of an installation that has earthing; an
 * optional position moves the symbol already on that floor.
 */
export const planEnsureEarthingPlacement = defineProjectCommand({
  id: 'plan.ensureEarthingPlacement',
  version: 1,
  input: z.strictObject({ floorId: id, pos: point.optional() }),
  check: (project, input) => checkFloorExists(project as ProjectV2, input.floorId),
  apply(draft, input) {
    const project = draft as ProjectV2
    const before = new Set(
      (getEditableProjectElectricalInstallation(project)?.earthingPlacements ?? []).map(
        (placement) => placement.id
      )
    )
    const result = ensureEarthingSitplanPlacementInProject(project, input.floorId, input.pos)
    if (!result?.changed) return { created: [], changed: [], removed: [] }
    const ref = placementRefs([result.placementId])
    return before.has(result.placementId)
      ? { created: [], changed: ref, removed: [] }
      : { created: ref, changed: [], removed: [] }
  },
})

/**
 * Shows hidden situation-plan symbols again: removes them from every floor's hidden list and
 * moves the listed ones into the target floor view at the given positions (the hidden-symbols
 * dialog, validation shortcut and fit-to-view prompt).
 */
export const planShowHiddenPlacements = defineProjectCommand({
  id: 'plan.showHiddenPlacements',
  version: 1,
  input: z.strictObject({
    floorId: id,
    layer: id,
    placementIds: z.array(id).min(1),
    moves: z.array(z.strictObject({ placementId: id, pos: point })).default([]),
  }),
  check(project, input) {
    const floor = checkFloorExists(project as ProjectV2, input.floorId)
    if (!floor.ok) return floor
    return checkPlacementsExist(
      project as ProjectV2,
      input.moves.map((move) => move.placementId)
    )
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const hiddenByFloor = readLegacyCompatibilityFloors(project).map((floor) => ({
      id: floor.id,
      hidden: [...(floor.hiddenSitplanPlacementIds ?? [])],
    }))
    const moved: string[] = []
    const related: EntityRef[] = []
    for (const { placementId, pos } of input.moves) {
      const target = resolvePlanPlacement(project, placementId)!
      const updates = { floorId: input.floorId, layer: input.layer, pos }
      if (target.kind === 'junctionPanel') {
        if (!updateJunctionPanelPlacementInProject(project, placementId, updates)) continue
      } else if (target.kind === 'earthing') {
        if (!updateEarthingPlacementInProject(project, placementId, updates)) continue
      } else {
        const updated = updatePlacementInProject(project, placementId, updates)
        if (!updated) continue
        if (updated.circuitId) related.push({ kind: 'circuit', id: updated.circuitId })
      }
      moved.push(placementId)
    }
    const shown = new Set(input.placementIds)
    const changedFloors: EntityRef[] = []
    for (const floor of hiddenByFloor) {
      const remaining = floor.hidden.filter((placementId) => !shown.has(placementId))
      if (remaining.length === floor.hidden.length) continue
      const result = updateFloorInProject(project, floor.id, {
        hiddenSitplanPlacementIds: remaining.length > 0 ? remaining : undefined,
      })
      if (result.changed) changedFloors.push({ kind: 'floor', id: floor.id })
    }
    return {
      created: [],
      changed: [...placementRefs(moved), ...changedFloors],
      removed: [],
      related,
    }
  },
})
