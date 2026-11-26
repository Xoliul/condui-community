import type { TrunkDevice } from '@/types/schema'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from './findDropTarget'
import { generateId } from '@/utils'
import { clamp } from '@/lib/geometry'
import {
  createCircuitTrunkSwitchDevice,
  getCircuitTrunkSwitchPositionForDrop,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import { getNextTerminalStripLabel, getTerminalStripTrunkConnectionProps } from '@/lib/terminalStrip/labels'
import { isSharedJunctionSymbol, getNextJunctionIdentity } from '@/lib/junctionIdentity'
import { promoteOrdinaryCircuitBranchesToDcBus } from './circuitConverterGeometry'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { findPanelById } from '@/lib/panel/panelTree'
import { ensureRootFeedForBusSection, getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import {
  getDefaultTrunkDeviceProtectionProps,
  getVoltagePolesConfig,
  withDcSideProtectionDefaults,
} from '@/lib/protectionDefaults'
import { PROTECTION_SYMBOL_ID_TO_TYPE, PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import {
  directConverterBackupInlineDevicesToTrunkDevices,
  findDirectConverterBackupProtection,
  getDirectConverterOutputChainForChangeover,
  resolveDirectConverterChangeoverInsertIndex,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import { isSupplyBranchDevice } from '@/lib/supplyAssembly/electricalTopology'
import { applySecondaryPanelEarthingStem } from '@/lib/eendraad/panelGround'
import {
  circuitIsTerminalPanelFeederSim,
  findCircuitInProject,
  findPanelForCircuit,
  mutableProjectInstallation,
  projectPanels,
  type EendraadPreviewChangeSet,
  type PreviewProject,
} from './eendraadPreviewModel'
import { getCircuitTrunkPositionForDropSim } from './eendraadPreviewWireDomain'

/**
 * Simulate dropping an energy meter or other trunk device on a circuit trunk.
 */
export function simulateTrunkDeviceOnCircuit(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  type: TrunkDevice['type'],
  changeSet: EendraadPreviewChangeSet
): void {
  if (!target.circuitId) return
  const circuit = findCircuitInProject(project, target.circuitId)
  if (!circuit) return

  // Dedicated board feeders do not accept additional trunk devices.
  if (circuitIsTerminalPanelFeederSim(project, circuit.id)) {
    return
  }

  const segmentPosition = getCircuitTrunkPositionForDropSim(target, circuit)
  const trunkPosition = isCircuitTrunkSwitchSymbol(symbol.id)
    ? getCircuitTrunkSwitchPositionForDrop(target, segmentPosition, circuit)
    : segmentPosition
  const deviceId = generateId()
  const trunkDevice: TrunkDevice = isCircuitTrunkSwitchSymbol(symbol.id)
    ? createCircuitTrunkSwitchDevice(symbol.id, deviceId, trunkPosition)
    : {
        id: deviceId,
        type,
        symbol: symbol.id as TrunkDevice['symbol'],
        label:
          symbol.id === 'terminal_strip'
            ? getNextTerminalStripLabel(project, undefined, target.circuitId)
            : type === 'conversion' || type === 'switch' || type === 'relay'
              ? ''
              : (symbol.name ?? ''),
        trunkPosition,
        ...(type === 'switch' ? { poles: 1, polesConfig: '1P' as const } : {}),
        ...(target.converterDcConnection
          ? { converterDcConnection: { ...target.converterDcConnection } }
          : {}),
        ...(type === 'dc_bus' ? { dcBusProps: {} } : {}),
        ...(symbol.id === 'terminal_strip'
          ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId)
          : isSharedJunctionSymbol(symbol.id)
            ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
            : {}),
      }

  const list = [...(circuit.trunkDevices ?? []), trunkDevice]
  // Order according to segment index if available
  if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
    const segIndex = target.circuitTrunkSegmentIndex
    list.sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    const currentIdx = list.findIndex((d) => d.id === deviceId)
    if (currentIdx !== -1) {
      list.splice(currentIdx, 1)
      const insertIdx = clamp(segIndex, 0, list.length)
      list.splice(insertIdx, 0, trunkDevice)
    }
  }

  circuit.trunkDevices = list
  if (isCircuitTrunkSwitchSymbol(symbol.id)) {
    syncSequentialEndpointBranchLabelsToCircuit(
      circuit,
      findPanelForCircuit(project, circuit.id) ?? undefined
    )
  }
  if (type === 'dc_bus') {
    circuit.branches = promoteOrdinaryCircuitBranchesToDcBus(
      circuit,
      deviceId,
      target.converterDcConnection
    )
  }

  changeSet.affectedCircuitIds.push(circuit.id)
  const owningPanel = findPanelForCircuit(project, circuit.id)
  if (owningPanel && !changeSet.affectedPanelIds.includes(owningPanel.id)) {
    changeSet.affectedPanelIds.push(owningPanel.id)
  }
  changeSet.createdTrunkDeviceIds.push(deviceId)
}

/**
 * Simulate adding a device to the supply trunk wire (installation.mainSupply.supplyTrunkDevices).
 * Mirrors addSupplyTrunkDevice in dropBehaviors for preview.
 */
export function simulateSupplyTrunkDevice(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  if (symbol.id === 'energy_meter') {
    return
  }

  const targetPanel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
  if (targetPanel && !targetPanel.isMain && panelSupplyCircuit) {
    const list = [...(panelSupplyCircuit.trunkDevices ?? [])]
    const deviceId = generateId()
    const insertIndex = target.supplyDeviceInsertIndex ?? list.length
    let deviceType: TrunkDevice['type'] = 'energy_meter'
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
      label = getNextTerminalStripLabel(project, undefined, target.circuitId)
    } else if (symbol.id === 'junction_panel') {
      deviceType = 'junction_panel'
      label = 'JP1'
    } else if (symbol.id === 'source_changeover') {
      deviceType = 'changeover'
      label = ''
    } else if (symbol.id === 'domotica') {
      deviceType = 'domotica'
      label = ''
    } else if (['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)) {
      deviceType = 'conversion'
      label = symbol.name ?? ''
    } else if (
      ['mcb', 'rcd', 'rcbo', 'fuse', 'main_switch', 'spd', 'rotating_switch'].includes(symbol.id)
    ) {
      deviceType = 'protection'
      const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
      label = protectionType === 'ROTATING_SWITCH' ? '' : symbol.id.toUpperCase()
    }
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: deviceType,
      symbol: symbol.id as TrunkDevice['symbol'],
      label,
      ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId) : {}),
      trunkPosition: 0,
      ...(symbol.id === 'domotica'
        ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
        : {}),
    }
    const idx = clamp(insertIndex, 0, list.length)
    list.splice(idx, 0, trunkDevice)
    list.forEach((d, i) => {
      d.trunkPosition = i
    })
    panelSupplyCircuit.trunkDevices = list
    changeSet.createdTrunkDeviceIds.push(deviceId)
    if (!changeSet.affectedPanelIds.includes(targetPanel.id)) {
      changeSet.affectedPanelIds.push(targetPanel.id)
    }
    changeSet.affectedCircuitIds.push(panelSupplyCircuit.id)
    return
  }

  const installation = mutableProjectInstallation(project)
  if (!installation) return
  if (!installation.mainSupply) {
    installation.mainSupply = {
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      origin: 'grid',
    }
  }
  const mainTargetPanel = target.panelId
    ? findPanelById(projectPanels(project), target.panelId)
    : null
  const supplyDevices: TrunkDevice[] =
    mainTargetPanel?.isMain && target.panelId
      ? [
          ...getSupplyFeedDevicesForPanel(
            installation,
            projectPanels(project),
            target.panelId,
            target.supplyFeedScope ?? 'shared',
            target.busSectionId,
          ),
        ]
      : installation.mainSupply.supplyTrunkDevices
        ? [...installation.mainSupply.supplyTrunkDevices]
        : []

  const deviceId = generateId()
  let insertIndex = target.supplyDeviceInsertIndex ?? supplyDevices.length

  if (symbol.id === 'source_changeover') {
    const directConverter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
    if (directConverter) {
      const normalizedInsertIndex = resolveDirectConverterChangeoverInsertIndex(
        supplyDevices,
        insertIndex,
        Boolean(
          mainTargetPanel && getPanelFeedOrganization(project, mainTargetPanel) === 'split-backup'
        )
      )
      const converterOutputChain = getDirectConverterOutputChainForChangeover(
        supplyDevices,
        normalizedInsertIndex ?? undefined
      )
      if (!converterOutputChain) return
      insertIndex = normalizedInsertIndex!
      const directBackup = target.panelId
        ? findDirectConverterBackupProtection(project, target.panelId, directConverter.id)
        : null
      directConverter.supplyPath = 'backup'
      converterOutputChain.forEach((device) => {
        device.supplyPath =
          mainTargetPanel && getPanelFeedOrganization(project, mainTargetPanel) === 'split-backup'
            ? 'changeover-grid'
            : 'backup-output'
      })
      if (directBackup) {
        const owningPanel = findPanelById(projectPanels(project), target.panelId!)
        if (owningPanel) {
          owningPanel.protections = owningPanel.protections.filter(
            (protection) => protection.id !== directBackup.protection.id
          )
        }
        supplyDevices.push(...directConverterBackupInlineDevicesToTrunkDevices(directBackup))
      }
    }
  }

  let deviceType: TrunkDevice['type'] = 'energy_meter'
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
    label = getNextTerminalStripLabel(project, undefined, target.circuitId)
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = 'JP1'
  } else if (symbol.id === 'source_changeover') {
    deviceType = 'changeover'
    label = ''
  } else if (
    symbol.id === 'transformer' ||
    symbol.id === 'rectifier' ||
    symbol.id === 'inverter' ||
    symbol.id === 'dc_dc_converter'
  ) {
    deviceType = 'conversion'
    label = symbol.name ?? ''
  } else if (symbol.id === 'battery') {
    deviceType = 'storage'
  } else if (symbol.id === 'solar_panel') {
    deviceType = 'generation'
  } else if (symbol.id === 'dc_bus') {
    deviceType = 'dc_bus'
    label = 'DC'
  } else if (symbol.id === 'domotica') {
    deviceType = 'domotica'
    label = ''
  } else if (
    PROTECTION_SYMBOL_IDS.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]) ||
    symbol.category === 'switches'
  ) {
    deviceType = 'protection'
    const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
    label = protectionType && protectionType !== 'ROTATING_SWITCH' ? symbol.id.toUpperCase() : ''
  }

  const voltagePoles = getVoltagePolesConfig(project)
  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  const protectionDefaults =
    deviceType === 'protection'
      ? getDefaultTrunkDeviceProtectionProps(protectionType ?? 'OTHER', voltagePoles)
      : {}

  const trunkDevice: TrunkDevice = withDcSideProtectionDefaults({
    id: deviceId,
    type: deviceType,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId) : {}),
    trunkPosition: insertIndex,
    ...(target.type === 'supplyWire' &&
    target.supplyFeedScope === 'root' &&
    ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)
      ? { supplyPath: 'converter-branch' as const }
      : target.type === 'supplyBackupWire'
        ? {
            supplyPath: ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(
              symbol.id
            )
              ? ('backup' as const)
              : ('backup-output' as const),
          }
        : target.type === 'supplyBackupOutputWire'
          ? { supplyPath: 'backup-output' as const }
          : target.type === 'supplyChangeoverGridWire'
            ? {
                supplyPath: 'changeover-grid' as const,
                ...(target.changeoverGridPlacement
                  ? { changeoverGridPlacement: target.changeoverGridPlacement }
                  : {}),
              }
            : target.type === 'supplyConverterGridWire'
              ? {
                  supplyPath: 'converter-grid' as const,
                  ...(target.converterGridPlacement
                    ? { converterGridPlacement: target.converterGridPlacement }
                    : {}),
                }
              : target.type === 'supplyConverterDcWire'
                ? {
                    supplyPath:
                      target.supplyConverterDcBranch === 'top'
                        ? ('converter-dc-top' as const)
                        : ('converter-dc' as const),
                    supplyConverterDcConnectionIndex:
                      target.supplyConverterDcConnectionIndex ??
                      (target.supplyConverterDcBranch === 'top' ? 1 : 0),
                    ...(target.supplyDcBusId
                      ? {
                          supplyDcBusId: target.supplyDcBusId,
                          supplyDcBusBranchId: target.supplyDcBusBranchId ?? generateId(),
                        }
                      : {}),
                    ...(target.converterDcConnection
                      ? { converterDcConnection: { ...target.converterDcConnection } }
                      : {}),
                  }
                : {}),
    ...(symbol.id === 'battery' ? { batteryProps: { voltageV: 48, capacityKWh: 5 } } : {}),
    ...(symbol.id === 'solar_panel' ? { solarPanelProps: { wattageW: 1000 } } : {}),
    ...(symbol.id === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(symbol.id === 'domotica'
      ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
      : {}),
    ...(symbol.id === 'source_changeover'
      ? { changeoverProps: { port1Label: '1', port2Label: '2' } }
      : {}),
    ...(deviceType === 'protection' && protectionType
      ? { protectionType, ...protectionDefaults }
      : deviceType === 'protection'
        ? protectionDefaults
        : {}),
  })

  if (target.supplyPanelInput && !isSupplyBranchDevice(trunkDevice)) trunkDevice.supplyPanelInput = true
  if (insertIndex >= 0 && insertIndex <= supplyDevices.length) {
    supplyDevices.splice(insertIndex, 0, trunkDevice)
  } else {
    supplyDevices.push(trunkDevice)
  }
  supplyDevices.forEach((device, index) => {
    device.trunkPosition = index
  })

  if (mainTargetPanel?.isMain && target.panelId) {
    const topology = installation.feedTopology
    if (target.supplyFeedScope === 'root') {
      const rootFeed = target.busSectionId
        ? ensureRootFeedForBusSection(
            installation, projectPanels(project), target.panelId, target.busSectionId
          )
        : topology?.rootFeeds.find((feed) => feed.panelId === target.panelId)
      if (rootFeed) rootFeed.trunkDevices = supplyDevices
    } else {
      // Shared feed topology is derived from mainSupply by ensureInstallationFeedTopology().
      // Store the preview ghost in the same source of truth so relayout can render it.
      installation.mainSupply.supplyTrunkDevices = supplyDevices
    }
  } else {
    installation.mainSupply.supplyTrunkDevices = supplyDevices
  }
  changeSet.createdSupplyTrunkDeviceIds.push(deviceId)
  changeSet.createdTrunkDeviceIds.push(deviceId)

  // Mark main panel as affected so preview overlay runs for its wires.
  const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
  if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
    changeSet.affectedPanelIds.push(mainPanel.id)
  }
}

/**
 * Simulate adding a device to the ground trunk wire (installation.groundTrunkDevices).
 * Mirrors addGroundTrunkDevice in dropBehaviors for preview.
 */
export function simulateGroundTrunkDevice(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  const panel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : undefined
  const installation = mutableProjectInstallation(project)
  const usePanelStem = panel?.isMain === false
  if (!usePanelStem && !installation) return
  const groundDevices: TrunkDevice[] = usePanelStem
    ? [...(panel.groundTrunkDevices ?? [])]
    : [...(installation?.groundTrunkDevices ?? [])]
  const deviceId = generateId()
  const insertIndex = target.groundDeviceInsertIndex ?? groundDevices.length

  let deviceType: TrunkDevice['type'] = 'earthing_separator'
  let label = 'Aardingsonderbreker'

  if (symbol.id === 'junction_box') {
    deviceType = 'junction_box'
    label = ''
  } else if (symbol.id === 'terminal_strip') {
    deviceType = 'terminal_strip'
    label = getNextTerminalStripLabel(project, undefined, target.circuitId)
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = 'JP1'
  }

  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: deviceType,
    symbol:
      deviceType === 'earthing_separator'
        ? ('earthing_separator' as TrunkDevice['symbol'])
        : (symbol.id as TrunkDevice['symbol']),
    label,
    ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId) : {}),
    trunkPosition: insertIndex,
  }

  if (insertIndex >= 0 && insertIndex <= groundDevices.length) {
    groundDevices.splice(insertIndex, 0, trunkDevice)
  } else {
    groundDevices.push(trunkDevice)
  }

  if (usePanelStem && panel) {
    panel.groundTrunkDevices = groundDevices
    panel.hasGround = true
    if (!changeSet.affectedPanelIds.includes(panel.id)) changeSet.affectedPanelIds.push(panel.id)
  } else if (installation) {
    installation.groundTrunkDevices = groundDevices
    const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
    if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
      changeSet.affectedPanelIds.push(mainPanel.id)
    }
  }
  changeSet.createdGroundTrunkDeviceIds.push(deviceId)
  changeSet.createdTrunkDeviceIds.push(deviceId)
}

export function simulateEarthingStemDrop(
  project: PreviewProject,
  target: DropTarget,
  changeSet: EendraadPreviewChangeSet
): void {
  const panel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : undefined
  if (panel?.isMain === false) {
    applySecondaryPanelEarthingStem(panel)
    if (!changeSet.affectedPanelIds.includes(panel.id)) changeSet.affectedPanelIds.push(panel.id)
    return
  }
  const installation = mutableProjectInstallation(project)
  if (installation) installation.hasGround = true
  const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
  if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
    changeSet.affectedPanelIds.push(mainPanel.id)
  }
}
