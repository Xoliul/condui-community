import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import type { ProjectV2 } from '@/types/projectV2'
import { getForkPaletteActions } from './forkPaletteActions'
import type { Selection } from '@/types/ui'
import type { Panel, PanelGridModuleRef, PanelGridSlot, TrunkDevice } from '@/types/schema'
import type { CommandInvocation } from '../project'
import type { CommandInputField } from './types'
import { getFloorPaletteActions } from './floorPaletteActions'
import { getBuildingPaletteActions } from './buildingPaletteActions'
import { getPlacementPanelPaletteActions } from './placementPanelPaletteActions'
import { getPlanFinishingPaletteActions } from './planFinishingPaletteActions'
import { getElectricalTrunkDevicePaletteActions } from './electricalTrunkDevicePaletteActions'
import { getElectricalTopologyPaletteActions } from './electricalTopologyPaletteActions'
import { projectCommands } from '../project'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { getPanelGridModulesInProject } from '@/lib/panel/panelGridModules'
import { panelGridModuleRefKey, resolveModuleWidthCols } from '@/lib/panel/panelGridLayout'
import { getStandardCircuitBranches } from '@/lib/layout/endpointChains'
import { resolvePlanPlacement } from '@/lib/plan/placementMutations'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import {
  isModularSocket,
  socketCountForModularWidth,
  withModularSocketProps,
} from '@/lib/socket/modularSocket'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getJunctionPanelIdentity } from '@/lib/junctionPanel/grid'
import { getJunctionPanelModuleLayout } from '@/lib/junctionPanel/moduleLayout'
import { getProjectDocuments } from '@/lib/documents/projectDocuments'
import {
  canPlaceOnOneWire,
  getOneWireReferenceRemovalEdits,
  getOneWireReferenceShowValue,
} from '@/lib/documents/oneWireReferences'
/* @vision-scan-strip-start */
import { isElectricalVisionScanEnabled } from '@/lib/vision/availability'
/* @vision-scan-strip-end */

export interface ProjectPaletteAction {
  id: string
  labelKey: string
  fields: CommandInputField[]
  invocation: (values: Record<string, string>) => CommandInvocation
}

function valid(project: ProjectV2, invocation: CommandInvocation): boolean {
  try {
    const { command, input } = projectCommands.parseOne(invocation)
    return command.check(project, input).ok
  } catch {
    return false
  }
}
const numberField = (
  name: string,
  value: number,
  min: number,
  max: number,
  step: number | 'any' = 1
): CommandInputField => ({
  name,
  labelKey: `commandPalette.fields.${name}`,
  value: String(value),
  type: 'number',
  min,
  max,
  step,
})

/** Read-only palette inputs, resolved from explicit selection IDs rather than canvas objects. */
export function getProjectPaletteActions(
  project: ProjectV2,
  selection: Selection,
  activePanelId: string | null,
  activeFloorId: string | null
): ProjectPaletteAction[] {
  const actions: ProjectPaletteAction[] = []
  const panels = [...walkPanels(getProjectElectricalPanels(project))]
  const transformerPanels = panels.filter((panel) => panel.isMain !== false)
  if (transformerPanels.length) {
    const invocation: ProjectPaletteAction['invocation'] = (values) => ({
      id: 'electrical.placeSymbol',
      input: {
        symbolId: 'transformer',
        target: {
          type: 'supplyWire',
          panelId: values.panel,
          supplyFeedScope: 'shared',
          supplyDeviceInsertIndex: 0,
        },
      },
    })
    const options = transformerPanels
      .filter((panel) => valid(project, invocation({ panel: panel.id })))
      .map((panel) => ({ value: panel.id, label: panel.name }))
    if (options.length)
      actions.push({
        id: 'electrical.addSupplyTransformer',
        labelKey: 'commandPalette.addSupplyTransformer',
        fields: [
          {
            name: 'panel',
            labelKey: 'commandPalette.fields.panel',
            value:
              options.find((option) => option.value === activePanelId)?.value ?? options[0]!.value,
            options,
          },
        ],
        invocation,
      })
  }
  const circuits = panels.flatMap((panel) =>
    collectCircuits(panel).map((circuit) => ({ panel, circuit }))
  )
  const endpointIds =
    selection.type === 'endpoint'
      ? [...new Set(selection.ids)]
      : selection.type === 'placement'
        ? [
            ...new Set(
              selection.ids.flatMap((id) => {
                const owner = resolvePlanPlacement(project, id)
                return owner?.kind === 'standard' && owner.endpointId ? [owner.endpointId] : []
              })
            ),
          ]
        : []
  if (endpointIds.length === 1) {
    const owner = circuits.find(({ circuit }) => circuit.endpoints.some((endpoint) => endpoint.id === endpointIds[0]))
    const module = owner?.circuit.endpoints.find((endpoint) => endpoint.id === endpointIds[0])
    if (owner && module?.symbol === 'domotica') {
      const invocation: ProjectPaletteAction['invocation'] = (values) => ({
        id: 'electrical.placeSymbol',
        input: {
          symbolId: 'panel_distribution',
          target: {
            type: 'endpoint', panelId: owner.panel.id, circuitId: owner.circuit.id,
            endpointId: module.id,
            domoticaOutput: { group: 'endpoint', index: Number(values.output) },
          },
        },
      })
      const options = Array.from({ length: module.domoticaProps?.endpointCount ?? 1 }, (_, index) => ({
        value: String(index), label: String(index + 1),
      })).filter((option) => valid(project, invocation({ output: option.value })))
      if (options.length) actions.push({
        id: 'electrical.addPanelAtDomoticaOutput',
        labelKey: 'commandPalette.addPanelAtDomoticaOutput',
        fields: [{ name: 'output', labelKey: 'commandPalette.fields.output', value: options[0]!.value, options }],
        invocation,
      })
    }
  }
  const addChoices = (
    id: string,
    labelKey: string,
    field: CommandInputField,
    invocation: ProjectPaletteAction['invocation']
  ) => {
    field.options = field.options?.filter((option) =>
      valid(project, invocation({ [field.name]: option.value }))
    )
    if (!field.options?.length) return
    field.value = field.options[0]!.value
    actions.push({ id, labelKey, fields: [field], invocation })
  }
  if (endpointIds.length) {
    const sourceIds = circuits
      .filter((owner) =>
        owner.circuit.endpoints.some((endpoint) => endpointIds.includes(endpoint.id))
      )
      .map((owner) => owner.circuit.id)
    addChoices(
      'electrical.assignEndpoints',
      'commandPalette.moveToCircuit',
      {
        name: 'circuit',
        labelKey: 'commandPalette.fields.circuit',
        value: '',
        options: circuits
          .filter((owner) => !(sourceIds.length === 1 && owner.circuit.id === sourceIds[0]))
          .map((owner) => ({
            value: owner.circuit.id,
            label: `${owner.panel.name} · ${owner.circuit.code}${owner.circuit.notes ? ` — ${owner.circuit.notes}` : ''}`,
          })),
      },
      (values) => ({
        id: 'electrical.assignEndpoints',
        input: { endpointIds, targetCircuitId: values.circuit },
      })
    )
    const owner =
      sourceIds.length === 1
        ? circuits.find((owner) => owner.circuit.id === sourceIds[0])
        : undefined
    const branches = owner ? getStandardCircuitBranches(owner.circuit) : []
    const selectedBranches = branches.filter((branch) =>
      branch.some((endpoint) => endpointIds.includes(endpoint.id))
    )
    if (
      owner &&
      selectedBranches.length === 1 &&
      branches.length > 1 &&
      !owner.circuit.branches?.some((branch) => branch.dcBusId)
    ) {
      const moving = selectedBranches[0]!
      const before = branches.indexOf(moving)
      // Move the whole branch; never split a switch/load chain by moving only its selected symbol.
      addChoices(
        'electrical.reorderBranch',
        'commandPalette.reorderBranch',
        {
          name: 'position',
          labelKey: 'commandPalette.fields.position',
          value: '',
          options: Array.from({ length: branches.length }, (_, index) => ({
            value: String(index < before ? index : index + 1),
            label: String(index + 1),
          })).filter((_, index) => index !== before),
        },
        (values) => ({
          id: 'electrical.moveEndpoints',
          input: {
            draggedEndpointId: moving[0]!.id,
            selectedEndpointIds: moving.map((endpoint) => endpoint.id),
            target: {
              type: 'circuit',
              circuitId: owner.circuit.id,
              branchInsertIndex: Number(values.position),
            },
          },
        })
      )
    }
  }
  if (selection.type === 'protection' && selection.ids.length) {
    const owner = panels.find((panel) =>
      selection.ids.every((id) => panel.protections.some((protection) => protection.id === id))
    )
    if (owner)
      addChoices(
        'electrical.moveProtectionOnBus',
        'commandPalette.moveOnBus',
        {
          name: 'position',
          labelKey: 'commandPalette.fields.position',
          value: '',
          options: Array.from(
            { length: getMainBusItemsWithIndices(owner).length + 1 },
            (_, index) => ({ value: String(index), label: String(index + 1) })
          ),
        },
        (values) => ({
          id: 'electrical.moveProtectionOnBus',
          input: {
            kind: 'protectionSelectionDrop',
            protectionIds: selection.ids,
            target: {
              type: 'mainBus',
              panelId: owner.id,
              mainBusInsertIndex: Number(values.position),
            },
          },
        })
      )
  }
  if (selection.type === 'circuit' && selection.ids.length === 1) {
    const owner = circuits.find((owner) => owner.circuit.id === selection.ids[0])
    if (owner) {
      const parent = circuits.find(
        (candidate) =>
          candidate.panel.id === owner.panel.id &&
          candidate.circuit.subCircuitIds?.includes(owner.circuit.id)
      )
      const mainItems = getMainBusItemsWithIndices(owner.panel)
      const protection = owner.panel.protections.find((item) =>
        item.circuits?.some((circuit) => circuit.id === owner.circuit.id)
      )
      const index = parent
        ? parent.circuit.subCircuitIds!.indexOf(owner.circuit.id)
        : mainItems.findIndex((item) => item.id === owner.circuit.id || item.id === protection?.id)
      const count = parent ? parent.circuit.subCircuitIds!.length : mainItems.length
      for (const [direction, enabled] of [
        ['left', index > 0],
        ['right', index >= 0 && index < count - 1],
      ] as const) {
        const invocation: CommandInvocation = {
          id: 'electrical.moveProtectionOnBus',
          input: parent
            ? {
                kind: 'secondaryBus',
                panelId: owner.panel.id,
                parentCircuitId: parent.circuit.id,
                circuitId: owner.circuit.id,
                insertIndex: index + (direction === 'left' ? -1 : 2),
              }
            : {
                kind: 'mainBusDirection',
                panelId: owner.panel.id,
                circuitId: owner.circuit.id,
                direction,
              },
        }
        if (enabled && valid(project, invocation))
          actions.push({
            id: `electrical.moveBus.${direction}`,
            labelKey: `commandPalette.moveBus${direction === 'left' ? 'Left' : 'Right'}`,
            fields: [],
            invocation: () => invocation,
          })
      }
    }
  }
  const matches = (ref: PanelGridModuleRef, id: string) =>
    selection.type === 'endpoint'
      ? ref.kind === 'domotica' && ref.endpointId === id
      : selection.type === 'protection'
        ? ref.kind === 'protection' && ref.id === id
        : selection.type === 'trunkDevice'
          ? ref.kind === 'trunkDevice' && ref.id === id
          : false
  type Surface = {
    id: string
    kind: 'main' | 'supply' | 'auxiliary' | 'junction'
    panelId: string
    rows: number
    columns: number
    slots: PanelGridSlot[]
    moduleKeys?: Set<string>
  }
  const mainKeys = new Map(
    panels.map((panel) => [
      panel.id,
      new Set(
        getPanelGridModulesInProject(project, panel.id)
          .filter((module) => !module.inSupplyPanel)
          .map((module) => panelGridModuleRefKey(module.ref))
      ),
    ])
  )
  const surfaces: Surface[] = panels.flatMap((panel) =>
    panel.gridView
      ? [
          {
            id: panel.id,
            kind: 'main' as const,
            panelId: panel.id,
            rows: panel.gridView.rows,
            columns: getPanelGridTotalColumns(panel.gridView),
            slots: panel.gridView.slots,
            moduleKeys: mainKeys.get(panel.id),
          },
          {
            id: panel.id,
            kind: 'supply' as const,
            panelId: panel.id,
            rows: panel.gridView.supplyPanelRows ?? 1,
            columns: panel.gridView.supplyPanelColumns ?? panel.gridView.columns,
            slots: panel.gridView.supplyPanelSlots ?? [],
          },
        ]
      : []
  )
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project))
    surfaces.push({
      id: enclosure.id,
      kind: 'auxiliary',
      panelId: enclosure.ownerPanelId ?? '',
      ...enclosure.gridView,
    })
  const junctions = new Map<string, { device: TrunkDevice; panelId: string }>()
  for (const owner of circuits)
    for (const device of owner.circuit.trunkDevices ?? []) {
      const identity = getJunctionPanelIdentity(device)
      if (!identity) continue
      if (junctions.get(identity)?.device.junctionPanelGridView) continue
      junctions.set(identity, { device, panelId: owner.panel.id })
    }
  for (const { device, panelId } of junctions.values()) {
    const layout = getJunctionPanelModuleLayout(project, device)
    surfaces.push({
      id: device.id,
      kind: 'junction',
      panelId,
      rows: Math.max(1, layout.grid.rows - layout.moduleRowOffset),
      columns: layout.grid.columns,
      slots: layout.slots,
    })
  }
  surfaces.sort((a, b) => Number(b.panelId === activePanelId) - Number(a.panelId === activePanelId))
  const surface = surfaces.find(
    (surface) =>
      selection.ids.length &&
      selection.ids.every((id) =>
        surface.slots.some(
          (slot) =>
            matches(slot.module, id) &&
            (!surface.moduleKeys || surface.moduleKeys.has(panelGridModuleRefKey(slot.module)))
        )
      )
  )
  const selectedSlots =
    surface?.slots.filter((slot) => selection.ids.some((id) => matches(slot.module, id))) ?? []
  if (surface && selectedSlots.length) {
    const keys = new Set(selectedSlots.map((slot) => panelGridModuleRefKey(slot.module)))
    const replaceSlots = (slots: PanelGridSlot[]): CommandInvocation => ({
      id: 'panel.editLayout',
      input:
        surface.kind === 'auxiliary'
          ? { enclosures: [{ enclosureId: surface.id, slots }] }
          : surface.kind === 'junction'
            ? { junctionGrids: [{ deviceId: surface.id, slots }] }
            : {
                panels: [
                  {
                    panelId: surface.panelId,
                    [surface.kind === 'main' ? 'mainSlots' : 'supplySlots']: slots,
                  },
                ],
              },
    })
    const top = Math.min(...selectedSlots.map((slot) => slot.row)),
      left = Math.min(...selectedSlots.map((slot) => slot.col))
    actions.push({
      id: 'panel.moveModules',
      labelKey: 'commandPalette.moveModules',
      fields: [
        numberField('row', top + 1, 1, surface.rows),
        numberField('column', left + 1, 1, surface.columns, 'any'),
      ],
      invocation: (values) =>
        replaceSlots(
          surface.slots.map((slot) =>
            keys.has(panelGridModuleRefKey(slot.module))
              ? {
                  ...slot,
                  row: slot.row + Number(values.row) - 1 - top,
                  col: slot.col + Number(values.column) - 1 - left,
                }
              : slot
          )
        ),
    })
    if (selectedSlots.length === 1) {
      const slot = selectedSlots[0]!,
        ref = slot.module
      const endpoint =
        ref.kind === 'domotica'
          ? circuits
              .flatMap((owner) => owner.circuit.endpoints)
              .find((endpoint) => endpoint.id === ref.endpointId)
          : undefined
      const modular = isModularSocket(endpoint)
      actions.push({
        id: 'panel.resizeModule',
        labelKey: 'commandPalette.resizeModule',
        fields: [
          modular
            ? {
                name: 'width',
                labelKey: 'commandPalette.fields.width',
                value: String(resolveModuleWidthCols(ref, project, slot)),
                options: [2, 4]
                  .filter((width) => slot.col + width <= surface.columns)
                  .map((width) => ({ value: String(width), label: String(width) })),
              }
            : numberField(
                'width',
                resolveModuleWidthCols(ref, project, slot),
                0.1,
                Math.max(0.1, surface.columns - slot.col),
                'any'
              ),
        ],
        invocation: (values) =>
          modular && endpoint
            ? {
                id: 'properties.edit',
                input: {
                  edits: [
                    {
                      kind: 'endpoint',
                      ids: [endpoint.id],
                      set: {
                        socketProps: {
                          ...withModularSocketProps(
                            endpoint.socketProps,
                            socketCountForModularWidth(Number(values.width))
                          ),
                          // A nested patch must explicitly replace a previous double socket count.
                          socketCount: socketCountForModularWidth(Number(values.width)),
                        },
                      },
                    },
                  ],
                },
              }
            : replaceSlots(
                surface.slots.map((item) =>
                  keys.has(panelGridModuleRefKey(item.module))
                    ? { ...item, moduleWidth: Number(values.width), moduleWidthManual: true }
                    : item
                )
              ),
      })
      const candidates = getPanelGridModulesInProject(project, surface.panelId).filter(
        (module) => panelGridModuleRefKey(module.ref) !== panelGridModuleRefKey(ref)
      )
      const options = candidates.map((module) => ({
        value: panelGridModuleRefKey(module.ref),
        label: moduleLabel(module.ref, panels, project),
      }))
      options.push({ value: 'bus', label: '' })
      const field: CommandInputField = {
        name: 'target',
        labelKey: 'commandPalette.fields.target',
        value: '',
        options: options.map((option) =>
          option.value === 'bus' ? { value: 'bus', labelKey: 'commandPalette.fields.bus' } : option
        ),
      }
      addChoices('panel.rewire', 'commandPalette.connectTo', field, (values) => ({
        id: 'panel.rewire',
        input: {
          panelId: surface.panelId,
          origin: ref,
          target:
            candidates.find((module) => panelGridModuleRefKey(module.ref) === values.target)?.ref ??
            null,
        },
      }))
    }
  }
  if (
    selection.type === 'panel' ||
    selection.type === 'supplyPanel' ||
    selection.type === 'auxiliaryEnclosure'
  ) {
    const panel = panels.find((panel) => panel.id === (selection.supplyPanelId ?? selection.ids[0]))
    const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
      (item) => item.id === selection.ids[0]
    )
    const grid = selection.type === 'auxiliaryEnclosure' ? enclosure?.gridView : panel?.gridView
    if (grid && (panel || enclosure)) {
      const supply = selection.type === 'supplyPanel'
      actions.push({
        id: 'panel.resizeEnclosure',
        labelKey: 'commandPalette.resizePanel',
        fields: [
          numberField('rows', supply ? (grid.supplyPanelRows ?? 1) : grid.rows, 1, 100),
          numberField(
            'columns',
            supply ? (grid.supplyPanelColumns ?? grid.columns) : grid.columns,
            1,
            1000
          ),
        ],
        invocation: (values) => ({
          id: 'panel.editLayout',
          input:
            enclosure && selection.type === 'auxiliaryEnclosure'
              ? {
                  enclosures: [
                    {
                      enclosureId: enclosure.id,
                      grid: { rows: Number(values.rows), columns: Number(values.columns) },
                    },
                  ],
                }
              : {
                  panels: [
                    {
                      panelId: panel!.id,
                      grid: supply
                        ? {
                            supplyPanelRows: Number(values.rows),
                            supplyPanelColumns: Number(values.columns),
                          }
                        : { rows: Number(values.rows), columns: Number(values.columns) },
                    },
                  ],
                },
        }),
      })
    }
  }
  if (selection.type === 'panel' && selection.ids.length)
    actions.push({
      id: 'panel.autoArrange',
      labelKey: 'commandPalette.autoArrange',
      fields: [
        {
          name: 'direction',
          labelKey: 'commandPalette.fields.direction',
          value: 'left',
          options: ['left', 'right'].map((direction) => ({
            value: direction,
            labelKey: `commandPalette.fields.${direction}`,
          })),
        },
      ],
      invocation: (values) => ({
        id: 'panel.editLayout',
        input: { autoArrange: { panelIds: selection.ids, feedSideDirection: values.direction } },
      }),
    })
  /* @vision-scan-strip-start */
  if (isElectricalVisionScanEnabled()) {
    const documents = getProjectDocuments(project.assets)
    const removalEdits =
      selection.type === 'oneWireReference'
        ? getOneWireReferenceRemovalEdits(documents, selection.ids)
        : []
    if (removalEdits.length)
      actions.push({
        id: 'document.removeFromOneWire',
        labelKey: 'commandPalette.removeFromOneWire',
        fields: [],
        invocation: () => ({ id: 'properties.edit', input: { edits: removalEdits } }),
      })
    const hidden =
      selection.type === 'document'
        ? documents.filter(
            (doc) => selection.ids.includes(doc.id) && canPlaceOnOneWire(doc) && !doc.oneWire
          )
        : []
    if (hidden.length)
      actions.push({
        id: 'document.showOnOneWire',
        labelKey: 'commandPalette.showOnOneWire',
        fields: [],
        invocation: () => ({
          id: 'properties.edit',
          input: {
            edits: hidden.map((doc) => ({
              kind: 'document',
              ids: [doc.id],
              set: { category: 'schematic', oneWire: getOneWireReferenceShowValue(doc) },
            })),
          },
        }),
      })
  }
  /* @vision-scan-strip-end */
  const floor = selectProjectBuildingFloors(project).find((floor) => floor.id === activeFloorId)
  if (floor)
    actions.push({
      id: 'floor.rename',
      labelKey: 'commandPalette.renameFloor',
      fields: [{ name: 'name', labelKey: 'commandPalette.fields.name', value: floor.name }],
      invocation: (values) => ({
        id: 'floor.rename',
        input: { floorId: floor.id, name: values.name },
      }),
    })
  if (panels.length)
    actions.push({
      id: 'circuit.createEmpty',
      labelKey: 'commandPalette.addCircuit',
      fields: [
        {
          name: 'panel',
          labelKey: 'commandPalette.fields.panel',
          value: panels.find((panel) => panel.id === activePanelId)?.id ?? panels[0]!.id,
          options: panels.map((panel) => ({ value: panel.id, label: panel.name })),
        },
        {
          name: 'kind',
          labelKey: 'commandPalette.fields.kind',
          value: 'sockets',
          options: ['lighting', 'sockets', 'fixed_appliance', 'other'].map((kind) => ({
            value: kind,
            labelKey: `commandPalette.kinds.${kind}`,
          })),
        },
      ],
      invocation: (values) => ({
        id: 'circuit.createEmpty',
        input: { panelId: values.panel, kind: values.kind },
      }),
    })
  return [
    ...actions,
    ...getForkPaletteActions(project, selection),
    ...getFloorPaletteActions(project, activeFloorId),
    ...getBuildingPaletteActions(project, selection, activeFloorId),
    ...getPlacementPanelPaletteActions(project, selection, activeFloorId, activePanelId),
    ...getPlanFinishingPaletteActions(project, selection, activePanelId, activeFloorId),
    ...getElectricalTrunkDevicePaletteActions(project, selection),
    ...getElectricalTopologyPaletteActions(project, selection, activePanelId, activeFloorId),
  ].filter((action) => action.fields.every((field) => !field.options || field.options.length > 0))
}

function moduleLabel(ref: PanelGridModuleRef, panels: Panel[], project: ProjectV2): string {
  if (ref.kind === 'protection') {
    const protection = panels
      .flatMap((panel) => panel.protections)
      .find((item) => item.id === ref.id)
    return (
      [
        protection?.label || protection?.type,
        ...(protection?.circuits ?? []).map((circuit) => circuit.code),
      ]
        .filter(Boolean)
        .join(' · ') || ref.id
    )
  }
  const id = ref.kind === 'domotica' ? ref.endpointId : ref.id
  const circuits = panels.flatMap(collectCircuits)
  const endpoint = circuits.flatMap((circuit) => circuit.endpoints).find((item) => item.id === id)
  const device = [
    ...circuits.flatMap((circuit) => circuit.trunkDevices ?? []),
    ...queryAllSupplyTrunkDevices(project),
  ].find((item) => item.id === id)
  return endpoint?.label || device?.label || id
}
