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

const describeDevice = (device: { symbol?: string; type?: string; label?: string }) =>
  `${device.symbol ?? device.type ?? 'device'}${device.label ? ` "${device.label}"` : ''}`

/**
 * Why a supply system cannot be added to this panel, or null when it can. Conservative: never
 * absorb or reinterpret an existing supply path. The message names the failed condition (and the
 * devices on a supply path that is not empty) so the caller can act on it.
 */
export function getAddSupplySystemBlocker(project: ProjectV2, panelId: string): string | null {
  const installation = getProjectElectricalInstallation(project)
  const roots = collectRootPanels(getProjectElectricalPanels(project))
  const panel = roots.find(({ id }) => id === panelId)
  if (!installation) return 'The project has no electrical installation.'
  if (!panel) return `Panel ${panelId} is not a main panel of this project.`
  const reasons: string[] = []
  if (roots.length !== 1) reasons.push(`The project has ${roots.length} main panels; a supply system can only be added to a project with exactly one.`)
  if (selectProjectSupplyAssemblies(project).length) reasons.push('The project already has a supply system; existing supplies are never replaced.')
  if (!project.building.floors[0]) reasons.push('The project has no floor; create one first.')
  if (!['1N~', '3N~'].includes(installation.nominalVoltage.system))
    reasons.push(`The installation voltage system is ${installation.nominalVoltage.system}; set 1N~ or 3N~ explicitly (properties_edit_project installation.nominalVoltage.system) first.`)
  if ((panel.busSections?.length ?? 0) > 1) reasons.push('The panel has several bus sections; a supply system can only be added to a single-section panel.')
  const topology = installation.feedTopology
  const held = [
    ...(installation.mainSupply.supplyTrunkDevices ?? []).map((device) => `${describeDevice(device)} (supply)`),
    ...(topology?.sharedFeed.trunkDevices ?? []).map((device) => `${describeDevice(device)} (shared feed)`),
    ...(topology?.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []) ?? []).map((device) => `${describeDevice(device)} (panel feed)`),
  ]
  if (held.length)
    reasons.push(`A supply system needs an empty supply path, but panel "${panel.name}" holds ${held.join(', ')}. A new project starts with a default supply (breaker, kWh meter, main switch); delete the devices that are not wanted (entities_delete, kind trunkDevice) and retry.`)
  else if (topology) {
    if (topology.sharedFeed.segmentCables?.length || topology.rootFeeds.some((feed) => feed.segmentCables?.length))
      reasons.push('The supply path has stored segment cables; a supply system can only be added to a supply path without them.')
    if (topology.rootFeeds.length !== 1 || topology.rootFeeds[0]?.panelId !== panelId)
      reasons.push('The supply feed topology does not have exactly one root feed for this panel.')
    if (topology.rootFeeds.some((feed) => feed.wireSections || feed.busSectionId))
      reasons.push('The panel feed has wire sections or a bus section; a supply system can only be added to a plain panel feed.')
  }
  // The full model invariant below also rejects any native helper healing of custom loads.
  return reasons.length ? reasons.join(' ') : null
}

/** Conservative eligibility: never absorb or reinterpret an existing supply path. */
export function canAddSupplySystem(project: ProjectV2, panelId: string): boolean {
  return getAddSupplySystemBlocker(project, panelId) === null
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
  const blocker = getAddSupplySystemBlocker(project, panelId)
  if (blocker) throw new AddSupplySystemError('unsupported_topology', blocker)
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
