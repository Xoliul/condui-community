/**
 * Utility functions for working with project data
 */

import { generateId } from './id'
export { generateId } from './id'
import i18n from '@/lib/i18n/domainI18n'
import type {
  Panel,
  ProtectionDevice,
  Circuit,
  Endpoint,
  Placement,
  Installation,
  TrunkDevice,
  PanelGridSlot,
} from '@/types/schema'
import { ensurePanelPlacement } from './panelPlacement'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { duplicateJunctionOccurrenceIds } from '@/lib/plan/sharedJunctionPlacements'
import { healPlanWiring } from '@/lib/plan/planWiring'
import type { ProjectWithOptionalV2PlanWiring } from '@/lib/projectV2/planWiring'
import { migrateProjectV1ToV2 } from '@/lib/projectV2/migration'
import { polesConfigFromVoltageSystem } from '@/constants/poleConfig'
import { normalizeInstallationNominalVoltage } from '@/constants/nominalVoltage'
import {
  ensureInstallationFeedTopology,
  getAllSupplyTrunkDevices,
  getPanelSupplyTrunkDevices,
} from '@/lib/feedTopology'
import { getDefaultTrunkDeviceProtectionProps } from '@/lib/protectionDefaults'
import type { ProjectV2 } from '@/types/projectV2'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { DEFAULT_INSTALLATION_PROFILE } from '@/lib/installationProfile'
import { applyNonHouseholdPanelDefaults } from '@/lib/panel/panelEarthingSync'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { validatePanelBusSectionTopology } from '@/lib/panel/panelBusSectionValidation'

type ValidatableProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2PlanWiring & {
    project: {
      id?: string
      name?: string
    }
  }

/** Privacy-preserving label suffix for diagnostics exports and import fallbacks (first 8 chars without hyphens). */
export function shortProjectIdLabel(projectId: string): string {
  const compact = projectId.replace(/-/g, '')
  const base = (compact.length > 0 ? compact : projectId).trim()
  return base.slice(0, 8) || 'unknown'
}

/** One-wire defaults applied to every new project installation. */
export const DEFAULT_EENDRAAD_INSTALLATION_OPTIONS = {
  eendraadAutomaticNaming: true,
  circuitNotesOrientation: 'vertical',
} as const satisfies Pick<Installation, 'eendraadAutomaticNaming' | 'circuitNotesOrientation'>

/** Keep the standard pair of earthing separators available for every main-panel ground path. */
export function ensureDefaultEarthingSeparators(installation: Installation): boolean {
  const devices = installation.groundTrunkDevices ?? []
  const existingCount = devices.filter((device) => device.type === 'earthing_separator').length
  const earthingLabel = i18n.t('symbols.earthing_separator', { defaultValue: 'PE' })
  let nextPosition =
    devices.reduce((max, device) => Math.max(max, device.trunkPosition ?? -1), -1) + 1
  let changed = false

  for (let index = existingCount; index < 2; index += 1) {
    devices.push({
      id: generateId(),
      type: 'earthing_separator',
      symbol: 'earthing_separator',
      label: earthingLabel,
      trunkPosition: nextPosition,
    })
    nextPosition += 1
    changed = true
  }
  const separators = devices.filter((device) => device.type === 'earthing_separator')
  if (
    separators.length >= 2 &&
    !separators.slice(0, 2).some((device) => device.earthingSeparatorPairId)
  ) {
    const pairId = generateId()
    separators.slice(0, 2).forEach((device) => {
      device.earthingSeparatorPairId = pairId
    })
    changed = true
  }
  installation.groundTrunkDevices = devices
  return changed
}

/** Default installation used when none is provided to createEmptyProjectV2. */
function getDefaultInstallation(): Installation {
  const installation: Installation = {
    ...DEFAULT_EENDRAAD_INSTALLATION_OPTIONS,
    installationProfile: DEFAULT_INSTALLATION_PROFILE,
    address: { street: '', postalCode: '', city: '', country: 'BE' },
    nominalVoltage: { system: '2~', uLineToNeutral: 230, uLineToLine: 230 },
    mainSupply: {
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      origin: 'grid',
    },
    hasGround: true,
  }
  return installation
}

/** Pole count from voltage system for supply device width in panel grid. */
function supplyPoleCount(system: '1~' | '2~' | '1N~' | '3~' | '3N~' | 'DC'): number {
  switch (system) {
    case '1~':
    case '2~':
    case '1N~':
    case 'DC':
      return 2
    case '3~':
      return 3
    case '3N~':
      return 4
    default:
      return 2
  }
}

/**
 * Add default supply/ground trunk devices and main-panel grid layout.
 * Two earthing separators on ground wire; on supply wire (in flow order from supply
 * origin to bus): 40A MCB, energy meter, 300mA RCD.
 *
 * Feed scope split (controls the dashed supply separator on the eendraadsschema):
 *   - Shared feed (utility / supply panel side): first MCB + energy meter.
 *   - Root feed (main panel side): the RCD closest to the bus.
 * Panel grid mirrors this: shared devices in `supplyPanelSlots`, root device in
 * `slots` (main panel area).
 */
function addDefaultTrunkDevicesAndPanelGrid(installation: Installation, mainPanel: Panel): void {
  const system = installation.nominalVoltage?.system ?? '2~'
  const polesConfig = polesConfigFromVoltageSystem(system)
  const poleCols = supplyPoleCount(system)

  const supplyMcb1Id = generateId()
  const supplyMeterId = generateId()
  const supplyRcdId = generateId()

  const supplyProtectionLabel = i18n.t('panels.supply', { defaultValue: 'Supply' })
  const mainProtectionLabel = i18n.t('supply.mainProtectionLabel', { defaultValue: 'Main' })
  const mcbDefaults = {
    ...getDefaultTrunkDeviceProtectionProps('MCB', polesConfig),
    breakingCapacityKa: installation.installationProfile === 'non_household' ? 10 : 6,
    breakingCapacityOption:
      installation.installationProfile === 'non_household' ? '10000' : '6000',
  }
  const rcdDefaults = getDefaultTrunkDeviceProtectionProps('RCD', polesConfig)
  delete rcdDefaults.ratingA
  const hiddenSupplyProtectionNameLabel = {
    symbolLabelDisplay: { visibility: { supplyProtectionNameLabel: false } },
  } as const

  // Shared (utility-side) supply trunk devices: ordered from supply origin toward the bus.
  const sharedSupplyTrunkDevices: TrunkDevice[] = [
    {
      id: supplyMcb1Id,
      type: 'protection',
      symbol: 'mcb',
      label: supplyProtectionLabel,
      protectionType: 'MCB',
      ...mcbDefaults,
      ...hiddenSupplyProtectionNameLabel,
      ratingA: 40,
      trunkPosition: 0,
    },
    {
      id: supplyMeterId,
      type: 'energy_meter',
      symbol: 'energy_meter',
      label: 'kWh',
      energyMeterProps: { polesConfig },
      trunkPosition: 1,
    },
  ]

  // Root (main-panel-side) supply trunk devices: the RCD just before the bus.
  const rootSupplyTrunkDevices: TrunkDevice[] = [
    {
      id: supplyRcdId,
      type: 'protection',
      symbol: 'rcd',
      label: mainProtectionLabel,
      protectionType: 'RCD',
      ...rcdDefaults,
      ...hiddenSupplyProtectionNameLabel,
      sensitivityMa: 300,
      trunkPosition: 0,
    },
  ]

  ensureDefaultEarthingSeparators(installation)
  if (!installation.mainSupply)
    installation.mainSupply = {
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      origin: 'grid',
    }
  installation.mainSupply.supplyTrunkDevices = sharedSupplyTrunkDevices

  const supplyPanelSlots: PanelGridSlot[] = [
    {
      row: 0,
      col: 0,
      moduleWidth: poleCols,
      module: { kind: 'trunkDevice', id: supplyMcb1Id, scope: 'supply' },
    },
    {
      row: 0,
      col: poleCols,
      moduleWidth: poleCols,
      module: { kind: 'trunkDevice', id: supplyMeterId, scope: 'supply' },
    },
  ]
  const mainPanelSlots: PanelGridSlot[] = [
    {
      row: 0,
      col: 0,
      moduleWidth: poleCols,
      module: { kind: 'trunkDevice', id: supplyRcdId, scope: 'supply' },
    },
  ]

  mainPanel.gridView = {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: mainPanelSlots,
    supplyPanelSlots,
    supplyPanelVisible: true,
  }

  // Build the topology (shared feed mirrors mainSupply.supplyTrunkDevices), then attach
  // the root-feed device list so the supply separator sits between the meter and the
  // bus-side RCBO rather than to the left of every device.
  const topology = ensureInstallationFeedTopology(installation, [mainPanel])
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === mainPanel.id)
  if (rootFeed) {
    rootFeed.trunkDevices = rootSupplyTrunkDevices
  }
}

/**
 * Create a new empty project.
 * If installation is provided (e.g. from NewProjectDialog), it is used and default
 * supply/ground devices are added with poles matching the chosen voltage. Otherwise
 * the built-in default installation (1~) is used with default devices.
 */
export function createEmptyProjectV2(
  name: string,
  yearOfConstruction?: number,
  installation?: Installation,
  meterEanCode?: string
): ProjectV2 {
  const now = new Date().toISOString()
  const projectId = generateId()
  const mainPanelId = generateId()
  const floorId = generateId()

  const mainPanel: Panel = {
    id: mainPanelId,
    name: i18n.t('panels.mainPanel', { defaultValue: 'Main Panel' }),
    symbol: 'panel_distribution',
    isMain: true,
    protections: [],
    circuits: [],
    subPanels: [],
  }

  const inst = installation ?? getDefaultInstallation()
  const panels = [mainPanel]
  const floors = [{ id: floorId, name: 'Ground Floor', layers: ['electrical'] }]
  if (inst.installationProfile === 'non_household') {
    applyNonHouseholdPanelDefaults(inst, panels)
  }
  addDefaultTrunkDevicesAndPanelGrid(inst, mainPanel)
  ensureInstallationFeedTopology(inst, panels)

  const project = {
    schemaVersion: '0.2.0' as const,
    project: {
      id: projectId,
      name,
      createdAt: now,
      updatedAt: now,
      lastActiveFloorId: floorId,
      locale: 'nl-BE',
      ...(yearOfConstruction != null && { yearOfConstruction }),
      ...(meterEanCode != null &&
        meterEanCode.trim() !== '' && { meterEanCode: meterEanCode.trim() }),
    },
    installation: inst,
    panels,
    floors,
  }
  // Automatically create placement for the main panel on the ground floor
  const panelPlacement = ensurePanelPlacement(project, mainPanel)
  if (panelPlacement) {
    // Create a dummy circuit for the panel endpoint
    const dummyCircuit: Circuit = {
      id: generateId(),
      code: 'PANEL',
      kind: 'other',
      cable: {
        kind: 'XVB',
        conductors: 3,
        sectionMm2: 6,
        hasPE: true,
      },
      endpoints: [],
    }
    panelPlacement.endpoint.placements = [panelPlacement.placement]
    dummyCircuit.endpoints.push(panelPlacement.endpoint)
    mainPanel.circuits.push(dummyCircuit)
  }

  healEarthingSitplanPlacements(project)

  // Legacy construction is confined to creation/import boundaries. Expose the same object
  // references through canonical containers so boundary code can use the V2 APIs before the
  // one-shot migration without creating a divergent runtime copy.
  Object.assign(project, {
    building: { floors },
    disciplines: {
      electrical: {
        installation: inst,
        panels,
        devices: [],
        oneWire: {},
      },
    },
  })

  return migrateProjectV1ToV2(project)
}

/**
 * Helper to collect all panel IDs recursively
 */
function collectPanelIds(panels: Panel[]): Set<string> {
  const ids = new Set<string>()
  const collect = (panelList: Panel[]) => {
    for (const panel of panelList) {
      ids.add(panel.id)
      collect(panel.subPanels)
    }
  }
  collect(panels)
  return ids
}

/**
 * Helper to collect all circuits from hierarchy
 */
function collectAllCircuits(panels: Panel[]): Circuit[] {
  const circuits: Circuit[] = []
  const collect = (panelList: Panel[]) => {
    for (const panel of panelList) {
      circuits.push(...panel.circuits)
      for (const protection of panel.protections) {
        if (protection.circuits) {
          circuits.push(...protection.circuits)
        }
      }
      collect(panel.subPanels)
    }
  }
  collect(panels)
  return circuits
}

/**
 * Helper to collect all endpoints from hierarchy
 */
function collectAllEndpoints(panels: Panel[]): Endpoint[] {
  const endpoints: Endpoint[] = []
  const circuits = collectAllCircuits(panels)
  for (const circuit of circuits) {
    endpoints.push(...circuit.endpoints)
  }
  return endpoints
}

/**
 * Helper to collect all placements from hierarchy
 */
function collectAllPlacements(panels: Panel[]): Placement[] {
  const placements: Placement[] = []
  const endpoints = collectAllEndpoints(panels)
  for (const endpoint of endpoints) {
    placements.push(...endpoint.placements)
  }
  return placements
}

/**
 * Validate project structure
 */
export function validateProjectStructure(project: ValidatableProject): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  const floors = selectProjectBuildingFloors(project)

  if (installation) {
    ensureInstallationFeedTopology(installation, panels)
    normalizeInstallationNominalVoltage(installation)
  }
  healPlanWiring(project)

  // Check required fields
  if (!project.project?.id) errors.push('Missing project ID')
  if (!project.project?.name) errors.push('Missing project name')
  if (panels.length === 0) errors.push('At least one panel required')
  if (floors.length === 0) errors.push('At least one floor required')

  // Collect IDs for validation
  const panelIds = collectPanelIds(panels)
  const floorIds = new Set(floors.map((f) => f.id))
  const placements = collectAllPlacements(panels)

  // Validate placement floor references
  for (const placement of placements) {
    if (!floorIds.has(placement.floorId)) {
      errors.push(`Placement ${placement.id} references non-existent floor ${placement.floorId}`)
    }
  }

  // Validate sub-panel references
  const validateSubPanels = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const protection of panel.protections) {
        if (protection.subPanelId && !panelIds.has(protection.subPanelId)) {
          errors.push(
            `Protection ${protection.id} references non-existent sub-panel ${protection.subPanelId}`
          )
        }
      }
      validateSubPanels(panel.subPanels)
    }
  }
  validateSubPanels(panels)

  errors.push(
    ...validatePanelBusSectionTopology(
      panels,
      installation,
      selectProjectSupplyAssemblies(project)
    ).map((issue) => issue.message)
  )

  return { valid: errors.length === 0, errors }
}

/**
 * Clone a project with a new ID and name
 */
export function cloneProject<
  T extends { project: { id: string; name: string; createdAt: string; updatedAt: string } },
>(project: T, newName: string): T {
  const now = new Date().toISOString()
  const cloned = JSON.parse(JSON.stringify(project)) as T

  cloned.project.id = generateId()
  cloned.project.name = newName
  cloned.project.createdAt = now
  cloned.project.updatedAt = now

  return cloned
}

/**
 * Helper to count panels recursively
 */
export function countPanels(panels: Panel[]): number {
  let count = panels.length
  for (const panel of panels) {
    count += countPanels(panel.subPanels)
  }
  return count
}

/**
 * Helper to count protections recursively
 */
function countProtections(panels: Panel[]): number {
  let count = 0
  for (const panel of panels) {
    count += panel.protections.length
    count += countProtections(panel.subPanels)
  }
  return count
}

/**
 * Get project summary statistics
 */
export function getProjectStats(
  project: ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building
) {
  const panels = getProjectElectricalPanels(project)
  const circuits = collectAllCircuits(panels)
  const endpoints = collectAllEndpoints(panels)
  const placements = collectAllPlacements(panels)

  return {
    panels: countPanels(panels),
    protections: countProtections(panels),
    circuits: circuits.length,
    endpoints: endpoints.length,
    floors: selectProjectBuildingFloors(project).length,
    placements: placements.length,
  }
}

/** Excel-style column label from a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function excelColumnLabelFromZeroBasedIndex(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/**
 * Find the next available circuit code.
 *
 * Behaviour:
 * - Uses Excel-style column sequences: A..Z, AA, AB, ..., AZ, BA, ...
 * - Treats every existing alphabetic circuit code as "used", independent of
 *   endpoint/subcircuit content, to guarantee global uniqueness.
 * - Also reserves alphabetic labels used by supply-wire protections
 *   (`installation.mainSupply.supplyTrunkDevices` where `type === 'protection'`)
 *   so main-bus auto-labeling does not reuse those names.
 * - Always fills gaps: if A, B, D are used, the next code will be C.
 */
export function getNextAvailableCircuitCode(
  project: ProjectWithOptionalV2Electrical,
  _panelId?: string
): string {
  const usedCodes = new Set<string>()
  const projectPanels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project) ?? getDefaultInstallation()

  const addAlphabeticCode = (value: string | undefined | null) => {
    const code = String(value ?? '')
      .trim()
      .toUpperCase()
    if (code && /^[A-Z]+$/.test(code)) {
      usedCodes.add(code)
    }
  }

  const panelId = _panelId ? String(_panelId) : ''
  const targetPanel = panelId ? findPanelById(projectPanels, panelId) : undefined

  if (targetPanel) {
    // Panel-local numbering: only codes already used on this panel count.
    for (const circuit of targetPanel.circuits) {
      addAlphabeticCode(circuit.code)
    }
    for (const protection of targetPanel.protections) {
      addAlphabeticCode(protection.label)
      for (const circuit of protection.circuits ?? []) {
        addAlphabeticCode(circuit.code)
      }
    }

    // Root/main panels can also have incoming supply protections rendered as part
    // of that panel's feed path; keep those in the same local namespace.
    for (const device of getPanelSupplyTrunkDevices(installation, projectPanels, targetPanel)) {
      if (device.type !== 'protection') continue
      addAlphabeticCode(device.label)
    }
  } else {
    // Collect all used circuit codes across the entire project (all panels + subpanels).
    // IMPORTANT: We treat every existing alphabetic code as "taken", regardless of
    // whether the circuit currently has endpoints or subcircuits. This guarantees
    // global uniqueness of circuit codes, even when master/feeder circuits don't
    // have endpoints themselves.
    const collectCodes = (panels: Panel[]) => {
      for (const panel of panels) {
        for (const circuit of panel.circuits) {
          addAlphabeticCode(circuit.code)
        }
        for (const protection of panel.protections) {
          addAlphabeticCode(protection.label)
          if (protection.circuits) {
            for (const circuit of protection.circuits) {
              addAlphabeticCode(circuit.code)
            }
          }
        }
        collectCodes(panel.subPanels)
      }
    }
    collectCodes(projectPanels)

    // Supply-wire protections (main supply trunk) can carry explicit labels like A/B.
    // Reserve these as well to avoid collisions when auto-naming new protections/circuits.
    const topology = ensureInstallationFeedTopology(installation, projectPanels)
    const supplyTrunkDevices = [
      ...(topology.sharedFeed.trunkDevices ?? []),
      ...topology.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []),
    ]
    for (const device of supplyTrunkDevices) {
      if (device.type !== 'protection') continue
      addAlphabeticCode(device.label)
    }
  }

  // Scan forward from A, returning the first label that is not in use.
  // In normal projects this will exit quickly because usedCodes is small.
  let index = 0
  // Hard upper bound as a safety net; far beyond any realistic number of circuits.
  const maxIterations = usedCodes.size + 1000
  while (index < maxIterations) {
    const label = excelColumnLabelFromZeroBasedIndex(index)
    if (!usedCodes.has(label)) {
      return label
    }
    index++
  }

  // Last resort
  return 'A'
}

/**
 * Find circuit in hierarchy by ID
 */
function findCircuitInHierarchy(panels: Panel[], circuitId: string): Circuit | undefined {
  for (const panel of panels) {
    // Check direct circuits
    const circuit = panel.circuits.find((c) => c.id === circuitId)
    if (circuit) return circuit

    // Check circuits under protections
    for (const protection of panel.protections) {
      if (protection.circuits) {
        const circuit = protection.circuits.find((c) => c.id === circuitId)
        if (circuit) return circuit
      }
    }

    // Check sub-panels
    const found = findCircuitInHierarchy(panel.subPanels, circuitId)
    if (found) return found
  }
  return undefined
}

/**
 * Generate automatic branch-based label for an endpoint.
 * All endpoints on the same branch share one label: {circuitCode}{branchNumber}.
 * This returns the next available branch number for a new branch.
 * Format: CircuitCode + BranchNumber (e.g., A1, A2, B1, B2)
 */
export function generateEndpointName(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string,
  excludeEndpointId?: string
): string {
  return generateEndpointNameFromPanels(
    getProjectElectricalPanels(project),
    circuitId,
    excludeEndpointId
  )
}

export function generateEndpointNameFromPanels(
  panels: Panel[],
  circuitId: string,
  excludeEndpointId?: string
): string {
  const circuit = findCircuitInHierarchy(panels, circuitId)
  if (!circuit) {
    // Fallback if circuit not found
    return 'Device 1'
  }

  const circuitCode = circuit.code.trim()

  // Get all endpoints for this circuit (excluding the one being renamed if provided)
  const circuitEndpoints = circuit.endpoints.filter((e) => e.id !== excludeEndpointId)

  // Extract distinct branch numbers from existing endpoint labels.
  // Multiple endpoints can share the same branch number (same branch),
  // so we use a Set to find unique branch numbers.
  const numberPattern = new RegExp(`^${circuitCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  const existingBranchNumbers = new Set(
    circuitEndpoints
      .map((e) => {
        const match = e.label.match(numberPattern)
        return typeof match?.[1] === 'string' ? parseInt(match[1], 10) : 0
      })
      .filter((n) => n > 0)
  )

  // Find the next available branch number
  let nextNumber = 1
  while (existingBranchNumbers.has(nextNumber)) {
    nextNumber++
  }

  return `${circuitCode}${nextNumber}`
}

/** Trunk device anywhere in the project: main supply, ground bus, and all panel/sub-panel circuits. */
export { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'

/** Find circuit, panel and optional protection for an endpoint (recursive sub-panels). */
export function findCircuitForEndpointInPanel(
  panel: Panel,
  endpointId: string
): { circuit: Circuit; panel: Panel; protection?: ProtectionDevice } | undefined {
  for (const circuit of panel.circuits) {
    if (circuit.endpoints.some((e) => e.id === endpointId)) {
      return { circuit, panel }
    }
  }
  for (const protection of panel.protections) {
    if (protection.circuits) {
      for (const circuit of protection.circuits) {
        if (circuit.endpoints.some((e) => e.id === endpointId)) {
          return { circuit, panel, protection }
        }
      }
    }
  }
  for (const subPanel of panel.subPanels) {
    const found = findCircuitForEndpointInPanel(subPanel, endpointId)
    if (found) return found
  }
  return undefined
}

export function findCircuitForEndpointInProject(
  project: ProjectWithOptionalV2Electrical,
  endpointId: string
): { circuit: Circuit; panel: Panel; protection?: ProtectionDevice } | undefined {
  for (const panel of getProjectElectricalPanels(project)) {
    const found = findCircuitForEndpointInPanel(panel, endpointId)
    if (found) return found
  }
  return undefined
}

/** Endpoint + junction panel placements on a floor (mirrors projectStore.getPlacementsByFloor). */
export function collectPlacementsOnFloor(
  project: ProjectWithOptionalV2Electrical,
  floorId: string
): Array<
  Placement & {
    endpointId?: string
    trunkDeviceId?: string
    enclosureId?: string
    junctionPanelLabel?: string
    isEarthing?: boolean
  }
> {
  const result: Array<
    Placement & {
      endpointId?: string
      trunkDeviceId?: string
      enclosureId?: string
      junctionPanelLabel?: string
      isEarthing?: boolean
    }
  > = []
  // A junction box drawn several times on the one-wire is one box on the plan.
  const duplicateJunctions = duplicateJunctionOccurrenceIds(project)
  for (const rootPanel of getProjectElectricalPanels(project)) {
    const circuits = collectAllCircuits([rootPanel])
    for (const circuit of circuits) {
      for (const endpoint of circuit.endpoints) {
        if (duplicateJunctions.has(endpoint.id)) continue
        for (const placement of endpoint.placements) {
          if (placement.floorId === floorId) {
            result.push({ ...placement, endpointId: endpoint.id })
          }
        }
      }
      for (const device of circuit.trunkDevices ?? []) {
        if (duplicateJunctions.has(device.id)) continue
        for (const placement of device.placements ?? []) {
          if (placement.floorId === floorId) {
            result.push({ ...placement, trunkDeviceId: device.id })
          }
        }
      }
    }
  }
  const installation = getProjectElectricalInstallation(project)
  for (const device of getAllSupplyTrunkDevices(project)) {
    if (duplicateJunctions.has(device.id)) continue
    for (const placement of device.placements ?? []) {
      if (placement.floorId === floorId) {
        result.push({ ...placement, trunkDeviceId: device.id })
      }
    }
  }
  for (const device of installation?.groundTrunkDevices ?? []) {
    if (duplicateJunctions.has(device.id)) continue
    for (const placement of device.placements ?? []) {
      if (placement.floorId === floorId) {
        result.push({ ...placement, trunkDeviceId: device.id })
      }
    }
  }
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const device of panel.groundTrunkDevices ?? []) {
      if (duplicateJunctions.has(device.id)) continue
      for (const placement of device.placements ?? []) {
        if (placement.floorId === floorId) {
          result.push({ ...placement, trunkDeviceId: device.id })
        }
      }
    }
  }
  for (const enclosure of project.disciplines?.electrical?.auxiliaryEnclosures ?? []) {
    for (const placement of enclosure.placements ?? []) {
      if (placement.floorId === floorId) result.push({ ...placement, enclosureId: enclosure.id })
    }
  }
  const jpPlacements = installation?.junctionPanelPlacements ?? []
  for (const jp of jpPlacements) {
    if (jp.floorId === floorId) {
      result.push({
        id: jp.id,
        floorId: jp.floorId,
        layer: jp.layer ?? 'default',
        pos: jp.pos,
        rotationDeg: (jp.rotationDeg ?? 0) as Placement['rotationDeg'],
        rotationMode: jp.rotationMode,
        scale: jp.scale ?? 1,
        junctionPanelLabel: jp.label,
      })
    }
  }
  for (const ep of installation?.earthingPlacements ?? []) {
    if (ep.floorId === floorId) {
      result.push({
        id: ep.id,
        floorId: ep.floorId,
        layer: ep.layer ?? 'default',
        pos: ep.pos,
        rotationDeg: (ep.rotationDeg ?? 0) as Placement['rotationDeg'],
        rotationMode: ep.rotationMode,
        scale: ep.scale ?? 1,
        locked: ep.locked,
        isEarthing: true,
      })
    }
  }
  return result
}
