import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure'
import { createDefaultSupplyCable } from '@/lib/electrical/supplyCable'
import {
  applyElectricalImportInstallation,
  getElectricalImportInstallation,
} from '@/lib/import/electricalImportTarget'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { addBuildingFloorView, mutateBuildingFloorView } from '@/lib/projectV2/buildingFloors'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import type {
  CableSpec,
  Circuit,
  CircuitKind,
  Endpoint,
  PolesConfig,
  ProtectionDevice,
  SymbolKey,
  TrunkDevice,
} from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { createEmptyProjectV2, generateId, validateProjectStructure } from '@/utils/project'
import { getElectricalImportPlans } from './types'
import { isVirtualOneWireOnlySymbol } from '@/lib/plan/situationPlanSymbolEligibility'
import { compileElectricalImportSupply } from './compileSupply'
import { validateElectricalImport } from './validate'
import type {
  ElectricalImportCircuit,
  ElectricalImportDocument,
  ElectricalImportEndpoint,
  ElectricalImportPlan,
  ElectricalImportProtection,
} from './types'

const DEFAULT_CABLE: CableSpec = { kind: 'XVB', conductors: 3, sectionMm2: 2.5, hasPE: true }

/** Compile only NEW semantic branches through the same native compiler used by scans.
 * Existing circuit data is deliberately never serialized into an import document.
 */
export function compileElectricalImportBranches(
  branches: ElectricalImportCircuit['branches'],
  circuitCode: string
): Pick<Circuit, 'branches' | 'endpoints'> {
  const source: ElectricalImportCircuit = {
    ref: 'new-circuit',
    code: circuitCode,
    branches,
    endpoints: [],
  }
  const validated = validateElectricalImport({
    format: 'condui-electrical-import',
    version: 1,
    project: { name: 'New branches' },
    installation: { voltageSystem: null },
    panel: { ref: 'new-panel', name: 'New branches', groups: [], circuits: [source] },
  })
  if (!validated.success)
    throw new Error(validated.diagnostics.map(({ message }) => message).join('\n'))
  if (branches.some((branch) => branch.endpoints.some((endpoint) => endpoint.quantity != null)))
    throw new Error('Endpoint quantity is unsupported for branch additions; use repeated branches.')
  const circuit = compileCircuit(validated.document.panel.circuits[0]!, circuitCode, new Map())
  return { branches: circuit.branches, endpoints: circuit.endpoints }
}

function poleCount(config: PolesConfig | null | undefined): number | undefined {
  return config ? Number.parseInt(config, 10) : undefined
}

function compileProtection(
  source: ElectricalImportProtection,
  fallbackLabel: string
): ProtectionDevice {
  return {
    id: generateId(),
    type: source.type,
    label: source.label ?? fallbackLabel,
    ratingA: source.ratingA ?? undefined,
    curve: source.curve ?? undefined,
    sensitivityMa: source.sensitivityMa ?? undefined,
    residualCurrentType: source.residualCurrentType ?? undefined,
    polesConfig: source.poles ?? undefined,
    poles: poleCount(source.poles),
    breakingCapacityKa: source.breakingCapacityKa ?? undefined,
    circuits: [],
  }
}

function defaultSymbol(type: ElectricalImportEndpoint['type']): SymbolKey {
  if (type === 'socket') return 'socket'
  if (type === 'switch') return 'switch'
  if (type === 'light_point') return 'light_point'
  if (type === 'domotica') return 'domotica'
  return 'fixed_appliance_generic'
}

function compileEndpoint(
  source: ElectricalImportEndpoint,
  circuitCode: string,
  _index: number
): Endpoint {
  return {
    id: generateId(),
    type: source.type,
    symbol: source.symbol ?? defaultSymbol(source.type),
    label: circuitCode,
    notes: source.notes ?? undefined,
    placements: [],
    ...(source.type === 'socket' && source.socketCount != null
      ? { socketProps: { socketCount: source.socketCount } }
      : {}),
    ...(source.type === 'socket' && source.waterproof === true
      ? { socketProps: { socketCount: source.socketCount ?? undefined, waterproof: true } }
      : {}),
    ...(source.type === 'light_point' && source.waterproof === true
      ? { lightPointProps: { waterproof: true } }
      : {}),
  }
}

function inferCircuitKind(source: ElectricalImportCircuit): CircuitKind {
  if (source.kind) return source.kind
  const endpointTypes = new Set(
    [...source.branches.flatMap(({ endpoints }) => endpoints), ...source.endpoints].map(
      ({ type }) => type
    )
  )
  if (endpointTypes.size === 1 && endpointTypes.has('socket')) return 'sockets'
  if (endpointTypes.size === 1 && endpointTypes.has('light_point')) return 'lighting'
  if (endpointTypes.size === 1 && endpointTypes.has('fixed_appliance')) return 'fixed_appliance'
  if (endpointTypes.size > 1) return 'mixed'
  return 'other'
}

function compileCircuit(
  source: ElectricalImportCircuit,
  fallbackCode: string,
  quantityByEndpointId: Map<string, number>
): Circuit {
  const code = source.code ?? fallbackCode
  const endpoints: Endpoint[] = []
  const endpointIdByRef = new Map<string, string>()
  const compiledBySource: Array<{ source: ElectricalImportEndpoint; endpoint: Endpoint }> = []
  const sourceBranches: Array<{
    repeat?: number
    endpoints: ElectricalImportEndpoint[]
  }> = source.branches.length
    ? source.branches
    : source.endpoints.map((endpoint) => ({ endpoints: [endpoint] }))
  const expandedSourceBranches = sourceBranches.flatMap((sourceBranch) =>
    Array.from({ length: sourceBranch.repeat ?? 1 }, () => sourceBranch)
  )
  const branches: NonNullable<Circuit['branches']> = expandedSourceBranches.map((sourceBranch) => {
    const endpointIds = sourceBranch.endpoints.map((sourceEndpoint) => {
      const endpoint = compileEndpoint(sourceEndpoint, code, endpoints.length)
      if (sourceEndpoint.quantity != null && endpointSupportsMultiplier(endpoint)) {
        quantityByEndpointId.set(endpoint.id, sourceEndpoint.quantity)
      }
      endpoints.push(endpoint)
      compiledBySource.push({ source: sourceEndpoint, endpoint })
      if (sourceEndpoint.ref) endpointIdByRef.set(sourceEndpoint.ref, endpoint.id)
      return endpoint.id
    })
    return { id: generateId(), label: '', endpointIds }
  })
  for (const item of compiledBySource) {
    const controlledEndpointIds = item.source.controls
      ?.map((ref) => endpointIdByRef.get(ref))
      .filter((id): id is string => id != null)
    if (controlledEndpointIds?.length) {
      item.endpoint.controlledEndpointIds = controlledEndpointIds
    }
  }
  branches.forEach((branch, index) => {
    branch.label = `${code}${index + 1}`
    const branchEndpointIds = new Set(branch.endpointIds)
    endpoints.forEach((endpoint) => {
      if (branchEndpointIds.has(endpoint.id)) endpoint.label = branch.label
    })
  })
  const cable: CableSpec = source.cable
    ? {
        kind: source.cable.kind ?? DEFAULT_CABLE.kind,
        conductors: source.cable.conductors ?? DEFAULT_CABLE.conductors,
        sectionMm2: source.cable.sectionMm2 ?? DEFAULT_CABLE.sectionMm2,
        hasPE: source.cable.hasPE ?? DEFAULT_CABLE.hasPE,
        fireClass: source.cable.fireClass ?? undefined,
        customKind: source.cable.customKind ?? undefined,
      }
    : { ...DEFAULT_CABLE }
  return {
    id: generateId(),
    code,
    kind: inferCircuitKind(source),
    cable,
    inTube: source.cable?.inTube ?? undefined,
    wireRoute: source.cable?.route ?? undefined,
    notes: source.notes ?? source.label ?? undefined,
    endpoints,
    branches: branches.length ? branches : undefined,
  }
}

const circuitCodeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareImportCircuits(a: ElectricalImportCircuit, b: ElectricalImportCircuit): number {
  if (a.order != null || b.order != null) {
    if (a.order == null) return 1
    if (b.order == null) return -1
    if (a.order !== b.order) return a.order - b.order
  }
  return circuitCodeCollator.compare(a.code ?? a.ref, b.code ?? b.ref)
}

function compileSupplyDevice(
  source: NonNullable<ElectricalImportDocument['installation']['supply']>['devices'][number],
  index: number
): TrunkDevice {
  if (source.type === 'energy_meter') {
    return {
      id: generateId(),
      type: 'energy_meter',
      symbol: 'energy_meter',
      label: source.label ?? 'kWh',
      energyMeterProps: {
        polesConfig: source.poles ?? undefined,
        poles: poleCount(source.poles),
      },
      trunkPosition: index,
    }
  }
  const protection = source.protection
  return {
    id: generateId(),
    type: 'protection',
    symbol: protection.type.toLowerCase() as Extract<
      SymbolKey,
      'mcb' | 'rcd' | 'rcbo' | 'fuse' | 'main_switch'
    >,
    label: protection.label ?? protection.type,
    protectionType: protection.type,
    ratingA: protection.ratingA ?? undefined,
    curve: protection.curve ?? undefined,
    sensitivityMa: protection.sensitivityMa ?? undefined,
    residualCurrentType: protection.residualCurrentType ?? undefined,
    polesConfig: protection.poles ?? undefined,
    poles: poleCount(protection.poles),
    breakingCapacityKa: protection.breakingCapacityKa ?? undefined,
    trunkPosition: index,
  }
}

function compileRecognizedPlan(
  project: ProjectV2,
  plan: ElectricalImportPlan,
  floorId: string,
  circuits: Circuit[],
  warnings: string[]
): void {
  const floor = project.building.floors.find(({ id }) => id === floorId)
  if (!floor) throw new Error('The project scaffold has no floor for the recognized plan.')

  const background = plan.source.background
  const backgroundScale = background ? 1200 / Math.max(background.width, background.height) : null
  const displayWidth = background
    ? background.width * backgroundScale!
    : plan.source.width * (1200 / Math.max(plan.source.width, plan.source.height))
  const displayHeight = background
    ? background.height * backgroundScale!
    : plan.source.height * (1200 / Math.max(plan.source.width, plan.source.height))
  const scaleX = displayWidth / plan.source.width
  const scaleY = displayHeight / plan.source.height
  const scalarScale = Math.sqrt(scaleX * scaleY)
  const point = ({ x, y }: { x: number; y: number }) => ({ x: x * scaleX, y: y * scaleY })
  const wallIdByRef = new Map<string, string>()
  const walls = plan.floor.walls.map((source) => {
    const id = generateId()
    wallIdByRef.set(source.ref, id)
    if (source.confidence < 0.5) warnings.push(`Low-confidence wall: ${source.ref}.`)
    return {
      id,
      floorId: floor.id,
      points: source.points.map(point),
      thickness: source.thickness == null ? undefined : source.thickness * scalarScale,
    }
  })
  const wallLengthById = new Map(
    walls.map((wall) => {
      const [a, b] = wall.points
      return [wall.id, a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0]
    })
  )
  const compileOpening = <T extends ElectricalImportPlan['floor']['doors'][number]>(
    source: T,
    kind: 'door' | 'window'
  ) => {
    const wallId = wallIdByRef.get(source.wallRef)
    if (!wallId) {
      warnings.push(`${kind} references unknown wall ${source.wallRef}; skipped.`)
      return null
    }
    if (source.confidence < 0.5) warnings.push(`Low-confidence ${kind} on ${source.wallRef}.`)
    return {
      id: generateId(),
      floorId: floor.id,
      wallId,
      position: source.position,
      segmentIndex: 0,
      centerAlongSegment: (wallLengthById.get(wallId) ?? 0) * source.position,
      width: source.width * scalarScale,
    }
  }
  const doors = plan.floor.doors.flatMap((source) => {
    const opening = compileOpening(source, 'door')
    return opening ? [{ ...opening, swing: source.swing, direction: source.direction }] : []
  })
  const windows = plan.floor.windows.flatMap((source) => {
    const opening = compileOpening(source, 'window')
    return opening ? [opening] : []
  })
  const stairs = plan.floor.stairs.map((source) => {
    if (source.confidence < 0.5) warnings.push('Low-confidence stair.')
    return {
      id: generateId(),
      floorId: floor.id,
      points: source.points.map(point),
      width: source.width * scalarScale,
      stepDepth: (source.stepDepth ?? 25) * scalarScale,
      ...(source.kind === 'spiral'
        ? { spiralPoleDiameter: Math.max(10, source.width * scalarScale * 0.15) }
        : {}),
      cornerStyle: 'sharp' as const,
      cornerMode: 'turn' as const,
      showUpArrow: source.direction !== 'unknown',
      invertUpArrow: source.direction === 'down',
    }
  })
  const committedFloor = mutateBuildingFloorView(project, floor.id, (floorView) => {
    if (plan.floor.name) floorView.name = plan.floor.name
    if (background) {
      const assetId = generateId()
      floorView.planAsset = background.dataUrl
      floorView.planImageOffset = { x: 0, y: 0 }
      floorView.planImageOpacity = background.opacity
      floorView.planImportAsset = {
        id: assetId,
        kind: 'raster',
        sourceName: background.sourceName,
        width: displayWidth,
        height: displayHeight,
        dataUrl: background.dataUrl,
        hasWhiteBackground: true,
        darkModeAware: true,
      }
    }
    floorView.floorPlan = {
      walls,
      doors,
      windows,
      stairs,
      masterWallThickness: (plan.floor.wallThickness ?? 20) * scalarScale,
    }
  })
  if (!committedFloor) throw new Error('Could not commit recognized plan geometry.')

  const circuitsByCode = new Map<string, Circuit[]>()
  circuits.forEach((circuit) => {
    const entries = circuitsByCode.get(circuit.code) ?? []
    entries.push(circuit)
    circuitsByCode.set(circuit.code, entries)
  })
  for (const source of plan.floor.placements) {
    const matches = circuitsByCode.get(source.target.circuitCode) ?? []
    if (matches.length !== 1) {
      warnings.push(
        `Plan placement target circuit ${source.target.circuitCode} is not unique; skipped.`
      )
      continue
    }
    const circuit = matches[0]!
    const branch = circuit.branches?.[source.target.branch - 1]
    const endpointId = branch?.endpointIds[source.target.endpoint - 1]
    const endpoint = endpointId ? circuit.endpoints.find(({ id }) => id === endpointId) : undefined
    if (!endpoint) {
      warnings.push(
        `Unknown plan target ${source.target.circuitCode}/${source.target.branch}/${source.target.endpoint}; skipped.`
      )
      continue
    }
    const instanceIndex = (source.target.instance ?? 1) - 1
    while (endpoint.placements.length <= instanceIndex && endpointSupportsMultiplier(endpoint)) {
      endpoint.placements.push({
        ...endpoint.placements[0]!,
        id: generateId(),
        pos: { ...endpoint.placements[0]!.pos },
      })
    }
    const placement = endpoint.placements[instanceIndex]
    if (!placement) {
      warnings.push(`Plan target instance ${source.target.instance ?? 1} is unsupported; skipped.`)
      continue
    }
    placement.floorId = floor.id
    placement.pos = point(source.position)
    placement.rotationDeg = source.rotationDeg ?? 0
    if (source.rotationDeg != null) placement.rotationMode = 'explicit'
    if (source.confidence < 0.5) {
      warnings.push(
        `Low-confidence placement ${source.target.circuitCode}/${source.target.branch}/${source.target.endpoint}.`
      )
    }
  }
}

export type ElectricalImportCompilation = {
  project: ProjectV2
  warnings: string[]
}

export function compileElectricalImport(
  document: ElectricalImportDocument
): ElectricalImportCompilation {
  // Supply is an observed/requested topology, never a best-effort reconstruction.
  // Enforce cross-field constraints even for typed callers bypassing the import UI.
  if (getElectricalImportInstallation(document).supply?.system) {
    const validated = validateElectricalImport(document)
    if (!validated.success)
      throw new Error(
        validated.diagnostics.map(({ path, message }) => `${path}: ${message}`).join('\n')
      )
    document = validated.document
  }
  const project = createEmptyProjectV2(document.project.name)
  project.project.locale = document.project.locale ?? 'nl-BE'
  if (document.project.installer) {
    project.project.installerOverride = {
      name: document.project.installer.name,
      address: document.project.installer.address ?? {
        street: '',
        postalCode: '',
        city: '',
        country: 'BE',
      },
      companyNumber: document.project.installer.companyNumber ?? undefined,
      signatureDataUrl: null,
      logoDataUrl: null,
    }
  }
  const installation = getProjectElectricalInstallation(project)
  const panel = getProjectElectricalPanels(project)[0]
  if (!installation || !panel)
    throw new Error('The project scaffold has no electrical installation.')

  installation.eendraadAutomaticNaming = false
  panel.name = document.panel.name
  panel.protections = []
  panel.circuits = panel.circuits.filter(({ code }) => code === 'PANEL')
  const importWarnings: string[] = []

  const importedInstallation = getElectricalImportInstallation(document)
  if (importedInstallation.address) {
    installation.address = { ...importedInstallation.address }
  }
  const importedSupply = importedInstallation.supply
  const defaultSupplyCable = createDefaultSupplyCable(importedInstallation.voltageSystem ?? installation.nominalVoltage.system)
  const importedSupplyCable: CableSpec | undefined = importedSupply?.cable
    ? {
        kind: importedSupply.cable.kind ?? defaultSupplyCable.kind,
        conductors: importedSupply.cable.conductors ??
          defaultSupplyCable.conductors + (importedSupply.cable.hasPE === true ? 1 : 0),
        sectionMm2: importedSupply.cable.sectionMm2 ?? defaultSupplyCable.sectionMm2,
        hasPE: importedSupply.cable.hasPE ?? defaultSupplyCable.hasPE,
        fireClass: importedSupply.cable.fireClass ?? undefined,
        customKind: importedSupply.cable.customKind ?? undefined,
      }
    : undefined
  applyElectricalImportInstallation({
    installation,
    panel,
    voltageSystem: importedInstallation.voltageSystem,
    origin: importedInstallation.origin ?? 'grid',
    supplyCable: importedSupplyCable,
    supplyDevices: (importedSupply?.devices ?? []).map(compileSupplyDevice),
  })

  let circuitNumber = 0
  const compiledCircuits: Circuit[] = []
  const quantityByEndpointId = new Map<string, number>()
  const orderedUnits: Array<
    | { kind: 'group'; group: ElectricalImportDocument['panel']['groups'][number] }
    | { kind: 'circuit'; circuit: ElectricalImportCircuit }
  > = [
    ...document.panel.groups.map((group) => ({ kind: 'group' as const, group })),
    ...document.panel.circuits.map((circuit) => ({ kind: 'circuit' as const, circuit })),
  ].sort((a, b) => {
    const aCircuit =
      a.kind === 'group' ? [...a.group.circuits].sort(compareImportCircuits)[0] : a.circuit
    const bCircuit =
      b.kind === 'group' ? [...b.group.circuits].sort(compareImportCircuits)[0] : b.circuit
    if (!aCircuit) return 1
    if (!bCircuit) return -1
    return compareImportCircuits(aCircuit, bCircuit)
  })

  const compileStandaloneCircuit = (sourceCircuit: ElectricalImportCircuit) => {
    circuitNumber += 1
    const circuit = compileCircuit(
      sourceCircuit,
      String.fromCharCode(64 + circuitNumber),
      quantityByEndpointId
    )
    compiledCircuits.push(circuit)
    if (sourceCircuit.protection) {
      const protection = compileProtection(sourceCircuit.protection, circuit.code)
      protection.circuits = [circuit]
      panel.protections.push(protection)
    } else {
      panel.circuits.push(circuit)
    }
  }

  for (const unit of orderedUnits) {
    if (unit.kind === 'circuit') {
      compileStandaloneCircuit(unit.circuit)
      continue
    }
    const group = unit.group
    const groupProtection = compileProtection(group.protection, group.ref)
    const groupCircuit = compileCircuit(
      {
        ref: `${group.ref}-carrier`,
        code: group.ref,
        kind: 'other',
        branches: [],
        endpoints: [],
      },
      group.ref,
      quantityByEndpointId
    )
    groupProtection.circuits = [groupCircuit]
    panel.protections.push(groupProtection)

    const childCircuitIds: string[] = []
    for (const sourceCircuit of [...group.circuits].sort(compareImportCircuits)) {
      circuitNumber += 1
      const circuit = compileCircuit(
        sourceCircuit,
        String.fromCharCode(64 + circuitNumber),
        quantityByEndpointId
      )
      compiledCircuits.push(circuit)
      childCircuitIds.push(circuit.id)
      if (sourceCircuit.protection) {
        const protection = compileProtection(sourceCircuit.protection, circuit.code)
        protection.circuits = [circuit]
        panel.protections.push(protection)
      } else {
        panel.circuits.push(circuit)
      }
    }
    groupCircuit.subCircuitIds = childCircuitIds
  }

  const defaultFloorId = project.building.floors[0]?.id
  if (!defaultFloorId) throw new Error('The project scaffold has no floor for imported endpoints.')
  for (const circuit of compiledCircuits) {
    for (const endpoint of circuit.endpoints) {
      if (isVirtualOneWireOnlySymbol(endpoint.symbol)) continue
      const placementCount = quantityByEndpointId.get(endpoint.id) ?? 1
      for (let placementIndex = 0; placementIndex < placementCount; placementIndex += 1) {
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: circuit.id,
          floorId: defaultFloorId,
          placementId: generateId(),
        })
        if (!placement) throw new Error(`Could not place imported endpoint ${endpoint.id}.`)
        endpoint.placements.push(placement)
      }
    }
  }

  const plans = getElectricalImportPlans(document)
  for (const [planIndex, plan] of plans.entries()) {
    let floorId = project.building.floors[planIndex]?.id
    if (!floorId) {
      floorId = generateId()
      addBuildingFloorView(project, {
        id: floorId,
        name: plan.floor.name ?? `Floor ${planIndex + 1}`,
        layers: [],
        floorPlan: { walls: [], doors: [], windows: [], stairs: [], masterWallThickness: 20 },
      })
    }
    compileRecognizedPlan(project, plan, floorId, compiledCircuits, importWarnings)
  }

  if (importedSupply?.system) {
    const supply = compileElectricalImportSupply(project, panel.id, importedSupply.system)
    importWarnings.push(...supply.warnings)
  }

  const structural = validateProjectStructure(project)
  if (!structural.valid) throw new Error(structural.errors.join('\n'))
  const snapshot = buildElectricalStructureSnapshot(project)
  const errors = snapshot.diagnostics.filter(({ severity }) => severity === 'error')
  if (errors.length) throw new Error(errors.map(({ message }) => message).join('\n'))

  return {
    project,
    warnings: [
      ...(importedSupply == null
        ? ['Incoming supply was not recognized; no supply devices were imported.']
        : []),
      ...importWarnings,
      ...snapshot.diagnostics
        .filter(({ severity }) => severity !== 'error')
        .map(({ message }) => message),
    ],
  }
}
