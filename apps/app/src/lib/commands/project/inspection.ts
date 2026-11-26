import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { Panel, Placement, TrunkDevice } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { collectTerminalStripOccurrences } from '@/lib/terminalStrip/labels'
import {
  selectProjectBuildingFloors,
  selectProjectFloorPlan,
  selectProjectPlanScale,
} from '@/lib/projectV2/buildingFloors'
import { selectProjectPlanWireRoutes } from '@/lib/projectV2/planWiring'
import {
  queryOneWireFrames,
  queryOneWireNotes,
  querySitplanNotes,
} from '@/lib/projectV2/annotations'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getPanelGridModulesInProject } from '@/lib/panel/panelGridModules'
import { symbols } from '@/lib/symbols'
import { getPanelModuleInventory } from '@/lib/panel/panelModuleInventory'
import type { ProjectCommandRegistry } from './registry'
export { describeProjectCommand } from './commandDiscovery'

export const inspectableEntityKind = z.enum([
  'project',
  'installation',
  'floor',
  'panel',
  'protection',
  'circuit',
  'endpoint',
  'trunkDevice',
  'placement',
  'wall',
  'door',
  'window',
  'stair',
  'graphicElement',
  'note',
  'frame',
  'asset',
  'auxiliaryEnclosure',
  'junctionAsset',
  'wireRoute',
  'wireRun',
])
export type InspectableEntityKind = z.infer<typeof inspectableEntityKind>
export interface ProjectEntitySummary {
  kind: InspectableEntityKind
  id: string
  label: string
  parentId?: string
}
export interface ProjectEntity extends ProjectEntitySummary {
  fields: Record<string, unknown>
}
const id = z.string().min(1).max(200)
export const projectEntityQuerySchema = z.strictObject({
  kind: inspectableEntityKind.optional(),
  parentId: id.optional(),
  floorId: id.optional(),
  query: z.string().max(200).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
})
export const projectEntityReadSchema = z.strictObject({
  refs: z
    .array(z.strictObject({ kind: inspectableEntityKind, id }))
    .min(1)
    .max(20),
})

/** No blobs, source URLs, credentials or arbitrary extension properties enter these projections. */
function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as Record<string, unknown>
  return Object.fromEntries(
    keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
  )
}
function boundedCopy(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 2000)
  if (value == null || typeof value !== 'object') return value
  if (depth > 8) return undefined
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => boundedCopy(entry, depth + 1))
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, entry]) => [key, boundedCopy(entry, depth + 1)])
  )
}
const deviceFields = [
  'type',
  'symbol',
  'label',
  'notes',
  'ratingA',
  'poles',
  'polesConfig',
  'curve',
  'sensitivityMa',
  'residualCurrentType',
  'selective',
  'superImmunized',
  'breakingCapacityKa',
  'breakingCapacityOption',
  'hasPE',
  'junctionIdentity',
  'junctionAssetId',
  'panelMounting',
  'controlLink',
  'socketProps',
  'switchProps',
  'relayProps',
  'domoticaProps',
  'domoticaChildProps',
  'conversionProps',
  'trunkPosition',
] as const

/** Read native accessors only; never call a topology healer or return a native project reference. */
export function inspectProjectEntities(project: ProjectV2): ProjectEntity[] {
  const entries: ProjectEntity[] = []
  const seen = new Set<string>()
  const add = (
    kind: InspectableEntityKind,
    entityId: string,
    label: string,
    fields: Record<string, unknown>,
    parentId?: string
  ) => {
    const key = `${kind}:${entityId}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({
      kind,
      id: entityId,
      label: label.slice(0, 200),
      ...(parentId ? { parentId } : {}),
      fields,
    })
  }
  const placements = (
    items: readonly (Pick<Placement, 'id' | 'floorId' | 'pos'> & Partial<Placement>)[] | undefined,
    ownerId: string
  ) => {
    for (const item of items ?? [])
      add(
        'placement',
        item.id,
        item.id,
        {
          ...pick(item, [
            'floorId',
            'layer',
            'pos',
            'rotationDeg',
            'rotationMode',
            'scale',
            'locked',
            'mountingHeightM',
          ]),
          ownerId,
        },
        ownerId
      )
  }
  // Pin assignment targets these ids; they exist only once a strip has a pin, so agents cannot guess them.
  const stripOccurrences = collectTerminalStripOccurrences(project)
  const device = (item: TrunkDevice, ownerId: string, scope: string) => {
    const occurrences = stripOccurrences.filter(({ entityId }) => entityId === item.id)
    add(
      'trunkDevice',
      item.id,
      item.label || item.symbol || item.type,
      {
        ...pick(item, deviceFields),
        scope,
        placementIds: (item.placements ?? []).map(({ id: placementId }) => placementId),
        ...(occurrences.length
          ? {
              terminalStripOccurrences: occurrences.map(({ id: occurrenceId, stripId, side, pin }) => ({
                id: occurrenceId,
                stripId,
                side,
                pin,
              })),
            }
          : {}),
      },
      ownerId
    )
    placements(item.placements, item.id)
  }
  add(
    'project',
    project.project.id,
    project.project.name,
    pick(project.project, ['name', 'locale', 'yearOfConstruction'])
  )
  const installation = getProjectElectricalInstallation(project)
  if (installation) {
    add(
      'installation',
      project.project.id,
      'Installation',
      {
        ...pick(installation, ['nominalVoltage', 'connectionCurrentA', 'earthingSystem', 'installYear']),
        // Ids for properties_edit_supply (rootFeed) and supply_disconnect_inverter_grid_input (assembly).
        rootFeedIds: (installation.feedTopology?.rootFeeds ?? []).map(({ id: feedId }) => feedId),
        supplyAssemblies: selectProjectSupplyAssemblies(project).map((assembly) => ({
          id: assembly.id,
          connectionIds: assembly.connections.map(({ id: connectionId }) => connectionId),
        })),
      },
      project.project.id
    )
    placements(installation.earthingPlacements, project.project.id)
    placements(installation.junctionPanelPlacements, project.project.id)
  }
  const visit = (panel: Panel, parentId: string) => {
    add(
      'panel',
      panel.id,
      panel.name,
      {
        ...pick(panel, ['name', 'isMain', 'location', 'earthingSystem', 'gridView', 'busSections', 'virtual']),
        circuitIds: [
          ...panel.circuits,
          ...panel.protections.flatMap((protection) => protection.circuits ?? []),
        ].map(({ id: circuitId }) => circuitId),
        protectionIds: panel.protections.map(({ id: protectionId }) => protectionId),
        modules: getPanelGridModulesInProject(project, panel.id),
        moduleInventory: getPanelModuleInventory(project, panel.id),
        hiddenModuleKeys: panel.gridView?.hiddenModuleKeys ?? [],
      },
      parentId
    )
    for (const protection of panel.protections)
      add(
        'protection',
        protection.id,
        protection.label,
        {
          ...pick(protection, deviceFields),
          circuitIds: (protection.circuits ?? []).map(({ id: circuitId }) => circuitId),
        },
        panel.id
      )
    for (const circuit of [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]) {
      add(
        'circuit',
        circuit.id,
        circuit.code,
        {
          ...pick(circuit, ['code', 'kind', 'notes', 'cable', 'branches', 'subCircuitIds']),
          panelId: panel.id,
          protectionId: panel.protections.find((protection) =>
            protection.circuits?.some(({ id: circuitId }) => circuitId === circuit.id)
          )?.id,
          endpointIds: circuit.endpoints.map(({ id: endpointId }) => endpointId),
          trunkDeviceIds: (circuit.trunkDevices ?? []).map(({ id: deviceId }) => deviceId),
        },
        panel.id
      )
      for (const endpoint of circuit.endpoints) {
        add(
          'endpoint',
          endpoint.id,
          endpoint.label || endpoint.symbol || endpoint.type,
          {
            ...pick(endpoint, deviceFields),
            ...pick(endpoint, ['controlledEndpointIds']),
            panelId: panel.id,
            placementIds: endpoint.placements.map(({ id: placementId }) => placementId),
          },
          circuit.id
        )
        placements(endpoint.placements, endpoint.id)
      }
      for (const item of circuit.trunkDevices ?? []) device(item, circuit.id, 'circuit')
      for (const branch of circuit.branches ?? [])
        for (const item of branch.branchDevices ?? []) device(item, circuit.id, 'branch')
    }
    for (const item of panel.groundTrunkDevices ?? []) device(item, panel.id, 'ground')
    for (const child of panel.subPanels) visit(child, panel.id)
  }
  for (const panel of getProjectElectricalPanels(project)) visit(panel, project.project.id)
  for (const item of queryAllSupplyTrunkDevices(project)) device(item, project.project.id, 'supply')
  for (const item of installation?.groundTrunkDevices ?? []) device(item, project.project.id, 'ground')
  for (const floor of selectProjectBuildingFloors(project)) {
    add(
      'floor',
      floor.id,
      floor.name,
      {
        ...pick(floor, [
          'name',
          'elevationMm',
          'heightMm',
          'planAssetId',
          'processedPlanAssetId',
          'planImageOffset',
          'planImageRotationDeg',
          'planImageOpacity',
          'planScaleNeedsCalibration',
          'sitplanSymbolSizeCm',
          'hiddenSitplanElementIds',
        ]),
        scale: selectProjectPlanScale(project),
        assetIds: 'assetIds' in floor ? floor.assetIds : [],
      },
      project.project.id
    )
    const geometry = selectProjectFloorPlan(project, floor.id)
    if (!geometry) continue
    for (const kind of ['wall', 'door', 'window', 'stair', 'graphicElement'] as const) {
      const collection = {
        wall: geometry.walls,
        door: geometry.doors,
        window: geometry.windows,
        stair: geometry.stairs,
        graphicElement: geometry.graphicElements,
      }[kind]
      for (const item of collection ?? [])
        add(
          kind,
          item.id,
          `${kind} ${item.id}`,
          {
            ...pick(item, [
              'points',
              'thickness',
              'curve',
              'wallId',
              'position',
              'width',
              'height',
              'swing',
              'direction',
              'kind',
              'rotationDeg',
              'pos',
              'assetId',
              'stepDepth',
            ]),
            floorId: floor.id,
          },
          floor.id
        )
    }
  }
  for (const note of [...queryOneWireNotes(project), ...querySitplanNotes(project)])
    add(
      'note',
      note.id,
      note.text,
      pick(note, ['text', 'pos', 'fontSize', 'floorId']),
      note.floorId ?? project.project.id
    )
  for (const frame of queryOneWireFrames(project))
    add(
      'frame',
      frame.id,
      frame.title ?? frame.id,
      pick(frame, ['title', 'pos', 'width', 'height']),
      project.project.id
    )
  for (const asset of project.assets)
    add(
      'asset',
      asset.id,
      asset.sourceName ?? asset.id,
      pick(asset, ['kind', 'mimeType', 'width', 'height', 'pageIndex', 'pageCount', 'sizeBytes']),
      project.project.id
    )
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project))
    add(
      'auxiliaryEnclosure',
      enclosure.id,
      enclosure.name,
      pick(enclosure, ['kind', 'ownerPanelId', 'gridView', 'placements']),
      enclosure.ownerPanelId
    )
  for (const asset of project.disciplines.electrical?.junctionAssets ?? [])
    add(
      'junctionAsset',
      asset.id,
      asset.identity,
      pick(asset, [
        'kind',
        'identity',
        'status',
        'strip',
        'box',
        'panel',
        'terminations',
        'mountedIn',
        'inputsFingerprint',
        'title',
        'location',
        'notes',
      ]),
      project.project.id
    )
  for (const route of selectProjectPlanWireRoutes(project))
    add(
      'wireRoute',
      route.id,
      route.id,
      pick(route, [
        'kind',
        'source',
        'circuitId',
        'panelId',
        'floorId',
        'from',
        'to',
        'waypoints',
        'riser',
        'riserExit',
        'hidden',
        'style',
      ]),
      route.circuitId
    )
  for (const wire of project.disciplines.electrical?.wireRuns ?? [])
    add(
      'wireRun',
      wire.id,
      wire.id,
      pick(wire, [
        'members',
        'cable',
        'conductors',
        'lengths',
        'route',
        'medium',
        'inTube',
        'coreAliases',
        'anchors',
        'segmentLengths',
        'segmentLengthSources',
      ]),
      project.project.id
    )
  return entries
}

export function findProjectEntities(
  project: ProjectV2,
  input: z.input<typeof projectEntityQuerySchema> = {}
) {
  const query = projectEntityQuerySchema.parse(input)
  const needle = query.query?.toLocaleLowerCase()
  const matches = inspectProjectEntities(project).filter(
    (entity) =>
      (!query.kind || entity.kind === query.kind) &&
      (!query.parentId || entity.parentId === query.parentId) &&
      (!query.floorId ||
        entity.fields.floorId === query.floorId ||
        (entity.kind === 'floor' && entity.id === query.floorId)) &&
      (!needle || `${entity.label} ${entity.id}`.toLocaleLowerCase().includes(needle))
  )
  return {
    entities: matches
      .slice(query.offset, query.offset + query.limit)
      .map(({ fields: _fields, ...summary }) => summary),
    total: matches.length,
    nextOffset: query.offset + query.limit < matches.length ? query.offset + query.limit : null,
  }
}
export function readProjectEntities(
  project: ProjectV2,
  input: z.input<typeof projectEntityReadSchema>
) {
  const { refs } = projectEntityReadSchema.parse(input)
  const inventory = inspectProjectEntities(project)
  const entities = refs.flatMap((ref) =>
    inventory.filter((entity) => entity.kind === ref.kind && entity.id === ref.id)
  )
  const copy = boundedCopy(entities) as ProjectEntity[]
  return {
    entities: copy,
    truncated: JSON.stringify(copy) !== JSON.stringify(entities),
    missing: refs.filter(
      (ref) => !entities.some((entity) => entity.kind === ref.kind && entity.id === ref.id)
    ),
  }
}

/** Compact first; callers request one full schema at a time rather than sending every schema. */
export function listProjectCommands(registry: ProjectCommandRegistry) {
  return registry.list().map(({ id: commandId, version }) => ({ id: commandId, version }))
}
/** Steers agents to the symbols the editor library leads with, where the bare ID is the unusual variant. */
const AGENT_SYMBOL_HINTS: Readonly<Record<string, string>> = {
  socket_gnd_child: 'The ordinary socket: protective earth contact and child protection. Use this unless told otherwise.',
  socket: 'Socket without protective earth or child protection. Only for an explicitly ungrounded socket.',
  socket_gnd: 'Socket with protective earth but without child protection.',
  socket_child: 'Socket with child protection but without protective earth.',
  domotica_horizontal:
    'Library preset: a domotica module in the horizontal one-wire layout, stored as symbol domotica with oneWireLayout horizontal. One-wire only; never on the supply side or an output of another module, and nothing can follow it on its circuit.',
}

export function findProjectSymbols(
  input: {
    query?: string
    scope?: 'eendraad' | 'situatieplan'
    offset?: number
    limit?: number
  } = {}
) {
  const query = z
    .strictObject({
      query: z.string().max(200).optional(),
      scope: z.enum(['eendraad', 'situatieplan']).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .parse(input)
  const needle = query.query?.toLocaleLowerCase()
  const matches = symbols.filter(
    (symbol) =>
      !symbol.hiddenFromLibrary &&
      (!query.scope || symbol.scope === 'both' || symbol.scope === query.scope) &&
      (!needle ||
        [symbol.id, symbol.name, symbol.nameNL, symbol.nameFR, ...symbol.tags].some((text) =>
          text.toLocaleLowerCase().includes(needle)
        ))
  )
  return {
    symbols: matches
      .slice(query.offset, query.offset + query.limit)
      .map((symbol) => {
        const fields = pick(symbol, [
          'id',
          'name',
          'nameNL',
          'nameFR',
          'category',
          'scope',
          'inputDomain',
          'outputDomain',
          'portDomains',
          'inheritsWireDomain',
          'libraryPreset',
        ])
        const hint = AGENT_SYMBOL_HINTS[symbol.id]
        return hint ? { ...fields, hint } : fields
      }),
    total: matches.length,
    nextOffset: query.offset + query.limit < matches.length ? query.offset + query.limit : null,
  }
}
