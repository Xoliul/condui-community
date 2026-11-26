import type { ProjectV2 } from '@/types/projectV2'
import type { z } from 'zod'
import type { Selection } from '@/types/ui'
import { getProjectElectricalInstallation, getProjectElectricalPanels, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { findPanelById, walkPanels, collectCircuits } from '@/lib/panel/panelTree'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import {
  getPanelFeedOrganization,
  panelHasBackupOutput,
  panelHasModularChangeover,
  panelRequiresSplitFeed,
  type PanelFeedOrganization,
} from '@/lib/panel/panelFeedOrganization'
import { propertiesEdit } from '@/lib/commands/project/commands/propertiesEdit'
import type { ProjectPaletteAction } from './projectPaletteActions'
import type { ExtraElectricalAction } from '@/lib/properties/electricalPropertySchemas'
import { panelMoveSupply } from '@/lib/commands/project/commands/panelMoveSupply'
import { supplyDisconnectInverterGridInput } from '@/lib/commands/project/commands/supplyDisconnectInverterGridInput'
import { panelEjectSecondaryBusProtections } from '@/lib/commands/project/commands/panelEjectSecondaryBusProtections'
import { panelEnsureEarthingStem } from '@/lib/commands/project/commands/panelEnsureEarthingStem'
import { findCircuitOwner } from '@/lib/eendraad/projectElectricalDomain'
import { resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getSupplyTapToggleState } from '@/lib/supplyTaps/convertSupplyTap'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import type { ProjectCommandDefinition } from '@/lib/commands/project/types'

const organizations: Array<{ value: PanelFeedOrganization; labelKey: string }> = [
  { value: 'single', labelKey: 'commandPalette.values.singleFeed' },
  { value: 'split-backup', labelKey: 'commandPalette.values.splitBackupFeed' },
  { value: 'split-switchable', labelKey: 'commandPalette.values.splitSwitchableFeed' },
]

function checkAction(project: ProjectV2, action: ExtraElectricalAction): boolean {
  try {
    return propertiesEdit.check(project, { edits: [], actions: [action] }).ok
  } catch {
    return false
  }
}

function panelChoices(project: ProjectV2, selection: Selection, activePanelId: string | null) {
  const selected =
    selection.type === 'panel' && selection.ids.length === 1
      ? selection.ids[0]
      : selection.supplyPanelId ?? activePanelId
  const panels = [...walkPanels(getProjectElectricalPanels(project))]
  const panel = selected ? findPanelById(panels, selected) : undefined
  return panel ? [panel] : []
}

function commandCheck<TSchema extends z.ZodType>(
  command: ProjectCommandDefinition<TSchema>,
  project: ProjectV2,
  input: unknown
): boolean {
  try {
    const parsed = command.input.safeParse(input)
    return parsed.success && command.check(project, parsed.data).ok
  } catch {
    return false
  }
}

/** Palette choices for explicit panel feed edits; every value is rechecked at execution. */
export function getElectricalTopologyPaletteActions(
  project: ProjectV2,
  selection: Selection,
  activePanelId: string | null = null,
  activeFloorId: string | null = null
): ProjectPaletteAction[] {
  const actions: ProjectPaletteAction[] = []
  const selectedPanels = panelChoices(project, selection, activePanelId)
  const allPanels = [...walkPanels(getProjectElectricalPanels(project))]

  for (const panel of selectedPanels) {
    const destinations: Array<{ value: string; label?: string; labelKey?: string; target: { type: 'supply' } | { type: 'circuit'; circuitId: string } }> = []
    if (panel.isMain !== true) {
      const target = { type: 'supply' as const }
      if (commandCheck(panelMoveSupply, project, { panelId: panel.id, target }))
        destinations.push({ value: JSON.stringify(target), labelKey: 'commandPalette.values.installationSupply', target })
    }
    const currentLink = resolvePanelSupplyLinkForPanelInPanels(getProjectElectricalPanels(project), panel.id)
    for (const ownerPanel of allPanels) {
      for (const circuit of collectCircuits(ownerPanel)) {
        const owner = findCircuitOwner(getProjectElectricalPanels(project), circuit.id)
        if (!owner?.protection || owner.protection.id === currentLink?.protection.id) continue
        const target = { type: 'circuit' as const, circuitId: circuit.id }
        if (commandCheck(panelMoveSupply, project, { panelId: panel.id, target })) {
          destinations.push({
            value: JSON.stringify(target),
            label: `${ownerPanel.name} · ${owner.protection.label} · ${circuit.code}`,
            target,
          })
        }
      }
    }
    if (destinations.length) {
      const invocation: ProjectPaletteAction['invocation'] = (values) => ({
        id: 'panel.moveSupply',
        input: { panelId: panel.id, target: JSON.parse(values.destination!) },
      })
      actions.push({
        id: 'panel.moveSupply',
        labelKey: 'commandPalette.movePanelSupply',
        fields: [{
          name: 'destination',
          labelKey: 'commandPalette.fields.destination',
          value: destinations[0]!.value,
          options: destinations.map(({ value, label, labelKey }) => ({ value, ...(label ? { label } : {}), ...(labelKey ? { labelKey } : {}) })),
        }],
        invocation,
      })
    }

    if (panel.isMain === false && commandCheck(panelEnsureEarthingStem, project, { panelId: panel.id })) {
      const separators = panel.groundTrunkDevices?.filter((device) => device.type === 'earthing_separator') ?? []
      if (panel.hasGround !== true || separators.length < 2 || !separators.slice(0, 2).some((device) => device.earthingSeparatorPairId)) {
        actions.push({
          id: 'panel.ensureEarthingStem',
          labelKey: 'commandPalette.ensureSecondaryPanelEarthingStem',
          fields: [],
          invocation: () => ({ id: 'panel.ensureEarthingStem', input: { panelId: panel.id } }),
        })
      }
    }
  }

  if (selection.type === 'protection') {
    const selectedIds = [...new Set(selection.ids)]
    const eject = resolveSecondaryBusEjectSelection(project, selectedIds)
    if (eject && commandCheck(panelEjectSecondaryBusProtections, project, { protectionIds: eject.protectionIds })) {
      const floor = selectProjectBuildingFloors(project).find((candidate) => candidate.id === activeFloorId)
      const planPlacement = floor
        ? {
            floorId: floor.id,
            layer: 'layers' in floor && Array.isArray(floor.layers) ? floor.layers[0] ?? 'electrical' : 'electrical',
            pos: { x: 400, y: 300 },
          }
        : undefined
      actions.push({
        id: 'panel.ejectSecondaryBusProtections',
        labelKey: 'commandPalette.ejectSecondaryBusProtections',
        fields: floor ? ['x', 'y'].map((axis) => ({
          name: axis, labelKey: `commandPalette.fields.${axis}`, type: 'number' as const,
          value: axis === 'x' ? '400' : '300', min: -1_000_000, max: 1_000_000, step: 'any' as const,
        })) : [],
        invocation: (values) => ({
          id: 'panel.ejectSecondaryBusProtections',
          input: {
            protectionIds: eject.protectionIds,
            ...(planPlacement ? { planPlacement: {
              ...planPlacement, pos: { x: Number(values.x), y: Number(values.y) },
            } } : {}),
          },
        }),
      })
    }
  }

  const installation = getProjectElectricalInstallation(project)
  const assemblies = selectProjectSupplyAssemblies(project)
  const allSupplyDeviceIds = new Set(queryAllSupplyTrunkDevices(project).map((device) => device.id))
  const disconnectOptions: Array<{ value: string; label: string }> = []
  for (const assembly of assemblies) {
    for (const node of assembly.nodes) {
      if (node.kind !== 'inverter-unit' || node.symbol !== 'inverter' || node.properties.gridInputConnected === false) continue
      const deviceId = node.deviceId ?? node.id
      if (!allSupplyDeviceIds.has(deviceId)) continue
      const feed = installation?.feedTopology?.rootFeeds.find((candidate) =>
        candidate.trunkDevices?.some((device) => device.id === deviceId)
      )
      if (!feed) continue
      const panel = findPanelById(allPanels, feed.panelId)
      const input = { assemblyId: assembly.id, panelId: feed.panelId }
      if (panel && commandCheck(supplyDisconnectInverterGridInput, project, input)) {
        disconnectOptions.push({
          value: JSON.stringify(input),
          label: `${panel.name} · ${node.label ?? 'Inverter'}`,
        })
      }
    }
  }
  if (disconnectOptions.length) {
    actions.push({
      id: 'supply.disconnectInverterGridInput',
      labelKey: 'commandPalette.disconnectInverterGridInput',
      fields: [{
        name: 'connection',
        labelKey: 'commandPalette.fields.connection',
        value: disconnectOptions[0]!.value,
        options: disconnectOptions,
      }],
      invocation: (values) => ({
        id: 'supply.disconnectInverterGridInput',
        input: JSON.parse(values.connection!),
      }),
    })
  }

  for (const panel of selectedPanels) {
    const current = getPanelFeedOrganization(project, panel)
    const hasBackup = panelHasBackupOutput(project, panel.id)
    const hasChangeover = panelHasModularChangeover(project, panel.id)
    const organizationOptions = organizations
      .filter(({ value }) => {
        if (value === current) return false
        if (value === 'single') return !panelRequiresSplitFeed(project, panel.id)
        if (value === 'split-switchable') return hasChangeover && hasBackup
        return !hasChangeover && hasBackup
      })
      .filter(({ value }) =>
        checkAction(project, {
          kind: 'panelFeedOrganization',
          panelId: panel.id,
          organization: value,
        })
      )

    if (organizationOptions.length) {
      actions.push({
        id: 'panel.setFeedOrganization',
        labelKey: 'commandPalette.setPanelFeedOrganization',
        fields: [
          {
            name: 'organization',
            labelKey: 'commandPalette.fields.organization',
            value: organizationOptions[0]!.value,
            options: organizationOptions.map((option) => ({
              value: option.value,
              labelKey: option.labelKey,
            })),
          },
        ],
        invocation: (values) => ({
          id: 'properties.edit',
          input: {
            edits: [],
            actions: [
              {
                kind: 'panelFeedOrganization' as const,
                panelId: panel.id,
                organization: values.organization,
              },
            ],
          },
        }),
      })
    }

    const busItems = getMainBusOrder(panel)
    if (!busItems.length) continue
    for (const feed of ['grid', 'backup'] as const) {
      const positions = busItems.flatMap((item, index) => {
        const action: ExtraElectricalAction = {
          kind: 'panelBusFeedBoundary',
          panelId: panel.id,
          feed,
          mainBusInsertIndex: index,
        }
        return checkAction(project, action)
          ? [{
              value: String(index),
              label: `${index + 1} · ${item.type === 'protection'
                ? panel.protections.find((candidate) => candidate.id === item.id)?.label ?? item.id
                : panel.circuits.find((candidate) => candidate.id === item.id)?.code ?? item.id}`,
            }]
          : []
      })
      if (!positions.length) continue
      actions.push({
        id: `panel.setBusFeedBoundary.${feed}`,
        labelKey:
          feed === 'grid'
            ? 'commandPalette.setGridFeedBoundary'
            : 'commandPalette.setBackupFeedBoundary',
        fields: [
          {
            name: 'position',
            labelKey: 'commandPalette.fields.position',
            value: positions[0]!.value,
            options: positions.map((position) => ({
              value: position.value,
              label: position.label,
            })),
          },
        ],
        invocation: (values) => ({
          id: 'properties.edit',
          input: {
            edits: [],
            actions: [
              {
                kind: 'panelBusFeedBoundary' as const,
                panelId: panel.id,
                feed,
                mainBusInsertIndex: Number(values.position),
              },
            ],
          },
        }),
      })
    }
  }
  if (
    (selection.type === 'trunkDevice' || selection.type === 'protection' || selection.type === 'circuit') &&
    selection.ids.length === 1
  ) {
    const entityId = selection.ids[0]!
    const toggle = getSupplyTapToggleState(project, entityId)
    if (toggle) {
      const mode = toggle.mode === 'inline' ? ('tap' as const) : ('inline' as const)
      actions.push({
        id: mode === 'tap' ? 'supply.convertToTap' : 'supply.convertToInline',
        labelKey:
          mode === 'tap'
            ? 'commandPalette.convertSupplyDeviceToTap'
            : 'commandPalette.convertSupplyTapToInline',
        fields: [],
        invocation: () => ({
          id: 'properties.edit',
          input: { edits: [], actions: [{ kind: 'supplyTapMode' as const, entityId, mode }] },
        }),
      })
    }
  }
  return actions
}
