import { getNextTerminalStripLabel, getTerminalStripTrunkConnectionProps, getTerminalStripTrunkCreationProps } from '@/lib/terminalStrip/labels'
import { getNextJunctionIdentity, isSharedJunctionSymbol } from '@/lib/junctionIdentity'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { generateId } from '@/utils'
import { getVoltagePolesConfig, getDefaultTrunkDeviceProtectionProps, getProtectionCreationProps, withDcSideProtectionDefaults } from '@/lib/protectionDefaults'
import { PROTECTION_SYMBOL_ID_TO_TYPE, PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { createDefaultAcCircuitCable, DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS } from '@/lib/wires/circuitWireDefaults'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  ProtectionDevice,
  Circuit,
  Panel,
  TrunkDevice,
  TrunkDeviceType,
  ProtectionType,
} from '@/types/schema'
import type { TFunction } from 'i18next'
import { clamp } from '@/lib/geometry'
import { findPanelById } from '@/lib/panel/panelTree'
import { attachDirectConverterBackupCircuit, findAssemblyForDirectConverter } from '@/lib/supplyAssembly/editorIntegration'
import { getDefaultSupplyConverterAcPhaseAssignment, getSupplyConverterAcPhaseAssignment } from '@/lib/supplyAssembly/supplyConverterPhases'
import { findDirectConverterBackupProtection } from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import {
  type DropBehaviorProject,
  type DropBehaviorCallbacks,
  viewportCenterOn,
  projectPanels,
  projectInstallation,
  findPanelForTarget,
  panelIdForGroundDevice,
} from './dropBehaviorModel'
import { getSupplyDevicesForDropTarget } from './dropWireDomain'

export const SUPPLY_DC_SWITCH_SYMBOL_IDS = new Set([
  'switch',
  'switch_1p_twoway',
  'switch_2p_twoway',
  'switch_dimmer',
  'switch_1p_changeover',
  'switch_shutter',
  'switch_1p_pull',
  'contact',
  'switch_impulse',
  'switch_cross',
  'switch_single',
  'switch_double',
])

export function isSupplyDcSwitchSymbol(symbolId: string): boolean {
  return SUPPLY_DC_SWITCH_SYMBOL_IDS.has(symbolId)
}

export function addBackupLaneTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyBackupWire' && target.type !== 'supplyBackupOutputWire') {
    return null
  }
  return addSupplyTrunkDevice(symbol, target, project, callbacks, {
    supplyPath: 'backup-output',
  })
}

export function addChangeoverGridLaneDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyChangeoverGridWire') return null
  return addSupplyTrunkDevice(symbol, target, project, callbacks, {
    supplyPath: 'changeover-grid',
    changeoverGridPlacement: target.changeoverGridPlacement,
  })
}

export function addDirectConverterBackupCircuit(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks,
  protectionType: ProtectionType
): boolean {
  if (target.type !== 'supplyConverterBackupWire' || !target.panelId) return false
  const panel = findPanelById(projectPanels(project), target.panelId)
  if (!panel) return false
  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const converter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
  if (!converter) return false
  const existingBackup = findDirectConverterBackupProtection(project, panel.id, converter.id)
  if (existingBackup) {
    const symbol =
      Object.entries(PROTECTION_SYMBOL_ID_TO_TYPE).find(
        ([, candidate]) => candidate === protectionType
      )?.[0] ?? 'mcb'
    const trunkDevice: TrunkDevice = {
      id: callbacks.newId?.() ?? generateId(),
      type: 'protection',
      symbol: symbol as TrunkDevice['symbol'],
      label: '',
      trunkPosition: existingBackup.circuit.trunkDevices?.length ?? 0,
      protectionType,
      ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
    }
    callbacks.addTrunkDevice(existingBackup.circuit.id, trunkDevice)
    const updatedCircuit = callbacks.getCircuitById(existingBackup.circuit.id)
    const assembly = findAssemblyForDirectConverter(project, converter.id)
    if (updatedCircuit && assembly) {
      callbacks.replaceSupplyAssembly(
        assembly.id,
        attachDirectConverterBackupCircuit(
          assembly,
          converter,
          existingBackup.protection,
          updatedCircuit,
          panel.id
        )
      )
    }
    callbacks.setSelection({ type: 'trunkDevice', ids: [trunkDevice.id] })
    return true
  }

  const circuitId = callbacks.newId?.() ?? generateId()
  const protectionId = callbacks.newId?.() ?? generateId()
  // This branch lives on the inverter supply lane, not on the main bus. Its
  // protection and any downstream endpoints stay explicitly user-labelled.
  const code = ''
  const protection: ProtectionDevice = {
    id: protectionId,
    type: protectionType,
    label: code,
    circuits: [],
    ...getProtectionCreationProps(project, protectionType),
  }
  const system = project.disciplines?.electrical?.installation?.nominalVoltage.system ?? '1N~'
  const circuit: Circuit = {
    id: circuitId,
    code,
    kind: 'other',
    cable: createDefaultAcCircuitCable(),
    phaseAssignment: getSupplyConverterAcPhaseAssignment(converter, system),
    supplySource: { kind: 'converter-backup', converterId: converter.id },
    endpoints: [],
    ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  }
  callbacks.addProtection(panel.id, protection)
  callbacks.addCircuit(panel.id, circuit, protection.id)

  const assembly = findAssemblyForDirectConverter(project, converter.id)
  if (assembly) {
    callbacks.replaceSupplyAssembly(
      assembly.id,
      attachDirectConverterBackupCircuit(assembly, converter, protection, circuit, panel.id)
    )
  }
  callbacks.setSelection({ type: 'protection', ids: [protection.id] })
  return true
}

/**
 * Helper: add an earthing separator to the ground trunk wire (ground symbol → main bus).
 */
export function addGroundTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): void {
  const deviceId = callbacks.newId?.() ?? generateId()
  const insertIndex = target.groundDeviceInsertIndex ?? 0

  if (symbol.id === 'junction_box' || symbol.id === 'terminal_strip') {
    const isTerminalStrip = symbol.id === 'terminal_strip'
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: isTerminalStrip ? 'terminal_strip' : 'junction_box',
      symbol: isTerminalStrip ? 'terminal_strip' : 'junction_box',
      ...(isTerminalStrip
        ? getTerminalStripTrunkCreationProps(
            project,
            undefined,
            undefined,
            findPanelForTarget(project, target)?.id
          )
        : { label: '', junctionIdentity: getNextJunctionIdentity(project, symbol.id) }),
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(
      trunkDevice,
      insertIndex,
      panelIdForGroundDevice(project, target)
    )
    return
  }
  if (symbol.id === 'junction_panel') {
    const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: 'junction_panel',
      symbol: 'junction_panel',
      label,
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(
      trunkDevice,
      insertIndex,
      panelIdForGroundDevice(project, target)
    )
    return
  }

  const pairId = callbacks.newId?.() ?? generateId()
  ;[0, 1].forEach((offset) => {
    callbacks.addGroundTrunkDevice(
      {
        id: offset === 0 ? deviceId : callbacks.newId?.() ?? generateId(),
        type: 'earthing_separator',
        symbol: 'earthing_separator',
        label: t('symbols.names.earthing_separator', { defaultValue: 'PE' }),
        trunkPosition: insertIndex + offset,
        earthingSeparatorPairId: pairId,
      },
      insertIndex + offset,
      panelIdForGroundDevice(project, target)
    )
  })
}

/** First junction_panel label in the project (supply, ground, or any circuit), for prefilling a second panel. */
export function getFirstJunctionPanelLabel(project: DropBehaviorProject): string | undefined {
  const installation = projectInstallation(project)
  const supply = installation?.mainSupply?.supplyTrunkDevices ?? []
  const firstSupply = supply.find((d) => d.type === 'junction_panel')
  if (firstSupply?.label) return firstSupply.label
  const firstGround = collectAllGroundTrunkDevices(projectPanels(project), installation).find(
    (d) => d.type === 'junction_panel'
  )
  if (firstGround?.label) return firstGround.label
  const collectFromPanel = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      const circuits = [
        ...(panel.circuits ?? []),
        ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
      ]
      for (const circuit of circuits) {
        const first = circuit.trunkDevices?.find((d) => d.type === 'junction_panel')
        if (first?.label) return first.label
      }
      const fromSub = collectFromPanel(panel.subPanels ?? [])
      if (fromSub) return fromSub
    }
    return undefined
  }
  return collectFromPanel(projectPanels(project))
}

/**
 * Helper: add a device to the supply trunk wire (main panel supply → main bus).
 * Works for junction boxes/panels and protection devices (MCB, RCD, RCBO, FUSE, MAIN_SWITCH, SPD).
 */
export function addSupplyTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks,
  options?: {
    supplyPath?: TrunkDevice['supplyPath']
    changeoverGridPlacement?: TrunkDevice['changeoverGridPlacement']
    supplyConverterDcConnectionIndex?: number
    supplyDcBusId?: string
    supplyDcBusBranchId?: string
    converterDcConnection?: TrunkDevice['converterDcConnection']
  }
): TrunkDevice | null {
  const deviceId = callbacks.newId?.() ?? generateId()

  const supplyPanel = findPanelForTarget(project, target)
  const terminalCircuitId = target.circuitId ?? (
    supplyPanel?.isMain === false
      ? supplyPanel.circuits?.find((circuit) => circuit.code === 'PANEL')?.id
      : undefined
  )

  // Determine trunk device type and properties based on symbol
  let deviceType: TrunkDeviceType = 'junction_box'
  let protectionType: ProtectionType | undefined
  let label = ''

  if (symbol.id === 'energy_meter') {
    deviceType = 'energy_meter'
    label = 'kWh'
  } else if (symbol.id === 'relay') {
    deviceType = 'relay'
  } else if (symbol.id === 'junction_box') {
    deviceType = 'junction_box'
    label = ''
  } else if (symbol.id === 'terminal_strip') {
    deviceType = 'terminal_strip'
    label = getNextTerminalStripLabel(project, undefined, terminalCircuitId, supplyPanel?.id)
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
  } else if (symbol.id === 'source_changeover') {
    deviceType = 'changeover'
    label = ''
  } else if (['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)) {
    deviceType = 'conversion'
    label = ''
  } else if (symbol.id === 'battery') {
    deviceType = 'storage'
    label = ''
  } else if (symbol.id === 'solar_panel') {
    deviceType = 'generation'
    label = ''
  } else if (symbol.id === 'dc_bus') {
    deviceType = 'dc_bus'
    label = 'DC'
  } else if (symbol.id === 'domotica') {
    deviceType = 'domotica'
    label = ''
  } else if (PROTECTION_SYMBOL_IDS.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])) {
    deviceType = 'protection'
    protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'OTHER'
    label = ''
  } else if (isSupplyDcSwitchSymbol(symbol.id)) {
    deviceType = 'protection'
    label = ''
  }

  const insertIndex = target.supplyDeviceInsertIndex
  const voltagePoles = getVoltagePolesConfig(project)
  const converterAcPhaseAssignment =
    deviceType === 'conversion'
      ? getDefaultSupplyConverterAcPhaseAssignment(
          project.disciplines?.electrical?.installation?.nominalVoltage.system ?? '1N~'
        )
      : undefined
  const trunkDevice: TrunkDevice = withDcSideProtectionDefaults({
    id: deviceId,
    type: deviceType,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(
          project,
          undefined,
          terminalCircuitId,
          supplyPanel?.id
        )
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
    trunkPosition: insertIndex ?? 0,
    ...(options?.supplyPath
      ? {
          supplyPath: options.supplyPath,
          ...(options.supplyPath === 'changeover-grid' && options.changeoverGridPlacement
            ? { changeoverGridPlacement: options.changeoverGridPlacement }
            : {}),
        }
      : target.type === 'supplyBackupWire'
        ? { supplyPath: 'backup' as const }
        : target.type === 'supplyBackupOutputWire'
          ? { supplyPath: 'backup-output' as const }
          : target.type === 'supplyConverterGridWire'
            ? {
                supplyPath: 'converter-grid' as const,
                ...(target.converterGridPlacement
                  ? { converterGridPlacement: target.converterGridPlacement }
                  : {}),
              }
            : target.type === 'supplyChangeoverGridWire'
              ? {
                  supplyPath: 'changeover-grid' as const,
                  ...(target.changeoverGridPlacement
                    ? { changeoverGridPlacement: target.changeoverGridPlacement }
                    : {}),
                }
              : {}),
    ...(typeof options?.supplyConverterDcConnectionIndex === 'number'
      ? { supplyConverterDcConnectionIndex: options.supplyConverterDcConnectionIndex }
      : {}),
    ...(options?.supplyDcBusId ? { supplyDcBusId: options.supplyDcBusId } : {}),
    ...(options?.supplyDcBusBranchId ? { supplyDcBusBranchId: options.supplyDcBusBranchId } : {}),
    ...(options?.converterDcConnection
      ? { converterDcConnection: options.converterDcConnection }
      : {}),
    ...(symbol.id === 'battery' ? { batteryProps: { voltageV: 48, capacityKWh: 5 } } : {}),
    ...(symbol.id === 'solar_panel' ? { solarPanelProps: { wattageW: 1000 } } : {}),
    ...(symbol.id === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(symbol.id === 'domotica'
      ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
      : {}),
    ...(converterAcPhaseAssignment
      ? { conversionProps: { acPhaseAssignment: converterAcPhaseAssignment } }
      : {}),
    ...(symbol.id === 'source_changeover'
      ? { changeoverProps: { port1Label: '1', port2Label: '2' } }
      : {}),
    ...(protectionType ? { protectionType } : {}),
    ...(protectionType ? getDefaultTrunkDeviceProtectionProps(protectionType, voltagePoles) : {}),
    ...(!protectionType && isSupplyDcSwitchSymbol(symbol.id)
      ? getDefaultTrunkDeviceProtectionProps('OTHER', voltagePoles)
      : {}),
  })
  const targetPanel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')

  const needsPhysicalPlanPlacement =
    deviceType === 'relay' ||
    protectionType === 'ROTATING_SWITCH' ||
    isSupplyDcSwitchSymbol(symbol.id) ||
    deviceType === 'conversion' ||
    deviceType === 'storage' ||
    deviceType === 'generation' ||
    deviceType === 'energy_meter'
  if (needsPhysicalPlanPlacement) {
    const activeFloorId = resolveSitplanTargetFloorId(
      project,
      callbacks.getSitplanTarget().activeFloorId
    )
    if (activeFloorId) {
      const preferredPlanPos =
        viewportCenterOn(callbacks.getSitplanTarget(), activeFloorId) ?? undefined
      const placement = buildAutoSitplanPlacement(project, {
        circuitId: panelSupplyCircuit?.id ?? `panel-supply:${target.panelId ?? 'main'}`,
        floorId: activeFloorId,
        placementId: callbacks.newId?.() ?? generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) {
        trunkDevice.placements = [placement]
        if (deviceType === 'energy_meter') {
          const floor = callbacks.getFloorById(activeFloorId)
          const hiddenPlacementIds = floor?.hiddenSitplanPlacementIds ?? []
          callbacks.updateFloor(activeFloorId, {
            hiddenSitplanPlacementIds: hiddenPlacementIds.includes(placement.id)
              ? hiddenPlacementIds
              : [...hiddenPlacementIds, placement.id],
          })
        }
      }
    }
  }

  if (targetPanel && !targetPanel.isMain && panelSupplyCircuit) {
    // Sub-panel incoming wire allows only one local protection device.
    if (deviceType === 'protection') {
      const hasProtectionAlready = (panelSupplyCircuit.trunkDevices ?? []).some(
        (d) => d.type === 'protection'
      )
      if (hasProtectionAlready) return null
    }
    callbacks.addTrunkDevice(panelSupplyCircuit.id, trunkDevice)
    const updatedPanelCircuit = callbacks.getCircuitById(panelSupplyCircuit.id)
    if (updatedPanelCircuit?.trunkDevices) {
      const list = updatedPanelCircuit.trunkDevices.map((d: TrunkDevice) => ({ ...d }))
      const currentIdx = list.findIndex((d: TrunkDevice) => d.id === trunkDevice.id)
      if (currentIdx !== -1) {
        list.splice(currentIdx, 1)
        const idx = clamp(insertIndex ?? list.length, 0, list.length)
        // Important: do NOT re-insert the original `trunkDevice` object reference,
        // because after `addTrunkDevice` it may be frozen by store immutability.
        list.splice(idx, 0, { ...trunkDevice })
        const reindexed = list.map((d: TrunkDevice, i: number) => ({ ...d, trunkPosition: i }))
        callbacks.updateCircuit(panelSupplyCircuit.id, { trunkDevices: reindexed })
      }
    }
    return trunkDevice
  }

  callbacks.addSupplyTrunkDevice(trunkDevice, insertIndex, {
    panelId: target.panelId,
    feedScope: target.supplyFeedScope,
    diagramId: target.diagramId,
    supplyPanelInput: target.supplyPanelInput,
    busSectionId: target.busSectionId,
  })
  return trunkDevice
}
