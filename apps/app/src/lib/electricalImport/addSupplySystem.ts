import type { ProjectV2 } from '@/types/projectV2'
import { collectRootPanels } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import type { z } from 'zod'
import type { importSupplySystemSchema } from './supplyTypes'
import { validateElectricalImport } from './validate'
import { compileElectricalImportSupply } from './compileSupply'

export type ImportSupplySystem = z.infer<typeof importSupplySystemSchema>

export class AddSupplySystemError extends Error {
  constructor(
    readonly code: 'unsupported_topology' | 'missing_specification',
    message: string
  ) {
    super(message)
    this.name = 'AddSupplySystemError'
  }
}

/** Conservative eligibility: never absorb or reinterpret an existing supply path. */
export function canAddSupplySystem(project: ProjectV2, panelId: string): boolean {
  const installation = getProjectElectricalInstallation(project)
  const roots = collectRootPanels(getProjectElectricalPanels(project))
  const panel = roots.find(({ id }) => id === panelId)
  if (
    !installation ||
    !panel ||
    roots.length !== 1 ||
    selectProjectSupplyAssemblies(project).length ||
    !project.building.floors[0]
  )
    return false
  if (
    !['1N~', '3N~'].includes(installation.nominalVoltage.system) ||
    (panel.busSections?.length ?? 0) > 1
  )
    return false
  if (installation.mainSupply.supplyTrunkDevices?.length) return false
  const topology = installation.feedTopology
  if (
    topology &&
    (topology.sharedFeed.trunkDevices?.length ||
      topology.sharedFeed.segmentCables?.length ||
      topology.rootFeeds.length !== 1 ||
      topology.rootFeeds[0]?.panelId !== panelId ||
      topology.rootFeeds.some(
        (feed) =>
          feed.trunkDevices?.length ||
          feed.segmentCables?.length ||
          feed.wireSections ||
          feed.busSectionId
      ))
  )
    return false
  // The full model invariant below also rejects any native helper healing of custom loads.
  return true
}

export const ADD_SUPPLY_SYSTEM_UNSUPPORTED_MESSAGE =
  'Adding a supply system requires one main panel with an empty supply path, a floor and explicit 1N~ or 3N~ installation voltage. Existing supplies are never replaced.'

function unchangedProjectData(project: ProjectV2): string {
  const electrical = project.disciplines.electrical
  return JSON.stringify({
    ...project,
    disciplines: {
      ...project.disciplines,
      electrical: {
        ...electrical,
        installation: electrical?.installation
          ? {
              ...electrical.installation,
              feedTopology: undefined,
              // Supply compilation owns the topology; all other installation fields are protected.
            }
          : undefined,
        supplyAssemblies: undefined,
      },
    },
  })
}

/**
 * Adds a supply system (grid connection, inverters, batteries, sources) to the empty supply path
 * of the only main panel, through the shared import supply compiler. Mutates `project`, which must
 * be a disposable draft; throws `AddSupplySystemError` without a usable result otherwise.
 */
export function addSupplySystemInProject(project: ProjectV2, panelId: string, system: ImportSupplySystem) {
  if (!canAddSupplySystem(project, panelId))
    throw new AddSupplySystemError('unsupported_topology', ADD_SUPPLY_SYSTEM_UNSUPPORTED_MESSAGE)
  const installation = getProjectElectricalInstallation(project)!
  const panel = collectRootPanels(getProjectElectricalPanels(project)).find(({ id }) => id === panelId)!
  const validation = validateElectricalImport({
    format: 'condui-electrical-import',
    version: 1,
    project: { name: 'New supply' },
    installation: {
      voltageSystem: installation.nominalVoltage.system,
      supply: { devices: [], system },
    },
    panel: { ref: 'new-supply-panel', name: panel.name, groups: [], circuits: [] },
  })
  if (!validation.success)
    throw new AddSupplySystemError(
      'missing_specification',
      validation.diagnostics.map(({ message }) => message).join('\n')
    )
  const before = unchangedProjectData(project)
  const hadLegacyDeviceArray = installation.mainSupply.supplyTrunkDevices !== undefined
  const result = compileElectricalImportSupply(project, panelId, system)
  // The topology initializer materializes a legacy empty array. Keep the original
  // absence when no devices were added there; all new devices belong to rootFeeds.
  if (!hadLegacyDeviceArray && !installation.mainSupply.supplyTrunkDevices?.length)
    delete installation.mainSupply.supplyTrunkDevices
  if (unchangedProjectData(project) !== before)
    throw new AddSupplySystemError(
      'unsupported_topology',
      'The native supply builder would change existing project data outside the supply path; this draft was rejected.'
    )
  return {
    panelName: panel.name,
    summary: `${system.topology}: ${system.inverter.unitCount} inverter(s), ${system.branches.length} source branch(es)`,
    warnings: result.warnings,
  }
}
