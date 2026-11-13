import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit } from '@/types/schema'
import { electricalImportSchema } from '@/lib/electricalImport/types'
import { prepareElectricalCreation } from '@/lib/electricalImport/prepare'
import { markAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { getProjectElectricalPanels, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { withIdSource } from '@/utils/id'
import { CommandError, defineProjectCommand } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

export const electricalImportSchematicInputSchema = z.strictObject({
  /** A complete one-wire description in the Condui electrical import format. */
  document: electricalImportSchema,
})

function projectCircuits(project: ProjectV2): Circuit[] {
  return getProjectElectricalPanels(project).flatMap((panel) => [
    ...panel.circuits,
    ...panel.protections.flatMap((protection) => protection.circuits ?? []),
  ])
}

/** Replaces every string equal to `from` inside plain JSON data. */
function replaceId<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T
  if (Array.isArray(value)) return value.map((item) => replaceId(item, from, to)) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceId(item, from, to)])) as T
  return value
}

/** A project with one board and no circuits, endpoints or supply: what create_project starts with. */
export function isBlankElectricalProject(project: ProjectV2): boolean {
  const panels = getProjectElectricalPanels(project)
  return (
    panels.length === 1 &&
    panels[0]!.protections.length === 0 &&
    projectCircuits(project).every((circuit) => circuit.code === 'PANEL' && circuit.endpoints.length === 0) &&
    selectProjectSupplyAssemblies(project).length === 0
  )
}

const NOT_BLANK_MESSAGE =
  'A schematic can only be built into a project that has no circuits, endpoints or supply yet. Edit an existing schematic with the individual commands instead.'

/**
 * Builds the whole electrical installation (board, circuits, endpoints and optional supply) from one
 * description, using the same compiler as scan and JSON import. Only for a blank project; plan
 * geometry is not part of this command, and new symbols wait in the unplaced tray.
 */
export const electricalImportSchematic = defineProjectCommand({
  id: 'electrical.importSchematic',
  version: 1,
  input: electricalImportSchematicInputSchema,
  check(project, input) {
    if (!isBlankElectricalProject(project)) return { ok: false, code: 'not_blank', message: NOT_BLANK_MESSAGE }
    if (input.document.plan || input.document.plans)
      return { ok: false, code: 'unsupported_plan', message: 'Plans cannot be imported with this command; describe only the electrical installation.' }
    return { ok: true }
  },
  apply(draft, input, env) {
    let compiled: ProjectV2
    try {
      compiled = withIdSource(() => env.newId(), () => prepareElectricalCreation(input.document)).project
    } catch (error) {
      throw new CommandError('check_failed', error instanceof Error ? error.message : String(error))
    }
    const beforeRefs = collectTopologyRefs(draft)
    for (const circuit of projectCircuits(compiled))
      for (const endpoint of circuit.endpoints)
        endpoint.placements = endpoint.placements.map(markAwaitingPlanPlacement)
    // Keep the project's identity and building; replace only the electrical discipline.
    // The compiler scaffolds its own floor; point its placements at this project's first floor.
    const fromFloor = compiled.building.floors[0]?.id
    const toFloor = draft.building.floors[0]?.id
    draft.disciplines.electrical =
      fromFloor && toFloor && fromFloor !== toFloor
        ? replaceId(compiled.disciplines.electrical, fromFloor, toFloor)
        : compiled.disciplines.electrical
    if (compiled.project.locale) draft.project.locale = compiled.project.locale
    if (compiled.project.installerOverride) draft.project.installerOverride = compiled.project.installerOverride
    const diff = diffTopologyRefs(beforeRefs, collectTopologyRefs(draft))
    return { ...diff, related: [], select: [] }
  },
})
