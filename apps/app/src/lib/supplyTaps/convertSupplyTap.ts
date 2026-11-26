import { cleanupPanelGridSlotsForDevice } from '@/lib/eendraad/projectElectricalDomain'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { PROTECTION_TYPE_TO_SYMBOL_ID } from '@/lib/protectionKind'
import {
  reconcileDirectConverterCommonLoadPath,
  reconcileDirectConverterGridProtections,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { cloneValue } from '@/utils/cloneValue'
import type { SupplyTapRef, SupplyTapResult } from './createSupplyTap'
import { retargetSupplyTapAnchors } from './healSupplyTaps'
import { getGridSideTapDevices, getSupplyTapLegOfDevice, type SupplyTapLeg } from './legs'
import { removeEmptySupplyTapsPanels } from './pruneSupplyTaps'
import { getOrCreateSupplyTapsPanel, getSupplyTapsPanel } from './virtualPanel'

/** What the in-line / tap switch shows for one entity: the mode it is in. */
export interface SupplyTapToggleState {
  mode: 'inline' | 'tap'
  ownerPanelId: string
}

const TAP_PROTECTION_SYMBOLS: readonly string[] = [
  'mcb',
  'fuse',
  'rcd',
  'rcbo',
  'main_switch',
  'rotating_switch',
]

/** Properties a protection keeps when it changes between a supply trunk device and a tap. */
const SHARED_PROTECTION_KEYS = [
  'ratingA',
  'curve',
  'sensitivityMa',
  'residualCurrentType',
  'selective',
  'superImmunized',
  'breakingCapacityKa',
  'breakingCapacityOption',
  'surgeProtectionKind',
  'polesConfig',
  'poles',
  'notes',
  'labelNotes',
  'panelLabel',
  'installationDate',
  'installationDateSuppressed',
  'rulesetDateOverride',
  'symbolLabelDisplay',
  'tripSettings',
  'fuseClass',
] as const

function copySharedProtectionProps(from: object, to: object): void {
  for (const key of SHARED_PROTECTION_KEYS) {
    const value = (from as Record<string, unknown>)[key]
    if (value !== undefined) (to as Record<string, unknown>)[key] = cloneValue(value)
  }
}

interface SupplyDeviceLocation {
  owner: Panel
  devices: TrunkDevice[]
  device: TrunkDevice
  leg: SupplyTapLeg
}

/** A grid-side supply device a tap can replace, with its owner panel. */
export function findTapEligibleSupplyDevice(
  project: ProjectV2,
  deviceId: string
): SupplyDeviceLocation | null {
  const feeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  for (const feed of feeds) {
    const devices = feed.trunkDevices ?? []
    const device = devices.find((entry) => entry.id === deviceId)
    if (!device) continue
    const leg = getSupplyTapLegOfDevice(device)
    if (!leg || !getGridSideTapDevices(devices, leg).some((entry) => entry.id === deviceId))
      return null
    const eligible =
      device.symbol === 'energy_meter' ||
      (device.type === 'protection' &&
        TAP_PROTECTION_SYMBOLS.includes(device.symbol) &&
        !device.placements?.length)
    const owner = findPanelById(getProjectElectricalPanels(project), feed.panelId)
    return eligible && owner && !owner.virtual ? { owner, devices, device, leg } : null
  }
  return null
}

interface TapItemLocation {
  owner: Panel
  board: Panel
  kind: 'protection' | 'circuit'
  item: ProtectionDevice | Circuit
  anchor: SupplyTapAnchor
  devices: TrunkDevice[]
}

function isBlankCircuit(circuit: Circuit): boolean {
  return (
    circuit.endpoints.length === 0 &&
    !circuit.trunkDevices?.length &&
    !circuit.branches?.length &&
    !circuit.subCircuitIds?.length
  )
}

/** A top-level tap item that holds only one bare device, so it can become an in-line device. */
export function findConvertibleSupplyTap(project: ProjectV2, itemId: string): TapItemLocation | null {
  const feeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  for (const owner of walkPanels(getProjectElectricalPanels(project))) {
    const board = getSupplyTapsPanel(owner)
    const devices = feeds.find((feed) => feed.panelId === owner.id)?.trunkDevices
    if (!board || !devices) continue
    const protection = board.protections.find((entry) => entry.id === itemId)
    if (protection) {
      const symbol = PROTECTION_TYPE_TO_SYMBOL_ID[protection.type]
      const circuits = protection.circuits ?? []
      return protection.supplyTap &&
        symbol &&
        TAP_PROTECTION_SYMBOLS.includes(symbol) &&
        circuits.length <= 1 &&
        circuits.every(isBlankCircuit) &&
        !protection.subPanelId &&
        !protection.directPanelFeeder &&
        !protection.directDcBusFeeder &&
        !protection.dcBusId
        ? { owner, board, kind: 'protection', item: protection, anchor: protection.supplyTap, devices }
        : null
    }
    const circuit = board.circuits.find((entry) => entry.id === itemId)
    if (circuit) {
      return circuit.supplyTap &&
        circuit.trunkDevices?.length === 1 &&
        circuit.trunkDevices[0]!.symbol === 'energy_meter' &&
        circuit.endpoints.length === 0 &&
        !circuit.branches?.length &&
        !circuit.subCircuitIds?.length
        ? { owner, board, kind: 'circuit', item: circuit, anchor: circuit.supplyTap, devices }
        : null
    }
  }
  return null
}

/** The mode the switch shows for a supply device or tap item, or null when it is not switchable. */
export function getSupplyTapToggleState(
  project: ProjectV2,
  entityId: string
): SupplyTapToggleState | null {
  const device = findTapEligibleSupplyDevice(project, entityId)
  if (device) return { mode: 'inline', ownerPanelId: device.owner.id }
  const tap = findConvertibleSupplyTap(project, entityId)
  return tap ? { mode: 'tap', ownerPanelId: tap.owner.id } : null
}

function reconcileSupplyAfterEdit(
  project: ProjectV2,
  ownerId: string,
  supplyPath: TrunkDevice['supplyPath']
): void {
  reconcileSupplyAssemblyBranchProtections(project, ownerId)
  if (supplyPath === 'changeover-grid' || supplyPath === 'converter-grid')
    reconcileDirectConverterGridProtections(project, ownerId)
  reconcileDirectConverterCommonLoadPath(project, ownerId)
  syncPanelAndSituationPlanDeviceVisibility(project)
}

function renumber(devices: TrunkDevice[]): void {
  devices.forEach((device, index) => {
    device.trunkPosition = index
  })
}

/** Moves an eligible grid-side supply device out of the supply wire into a tap at its position. */
export function convertSupplyDeviceToTapInProject(
  project: ProjectV2,
  deviceId: string,
  env: { newId: () => string; language?: string }
): SupplyTapResult {
  const found = findTapEligibleSupplyDevice(project, deviceId)
  if (!found)
    return { ok: false, code: 'not_convertible', message: 'This device cannot become a tap' }
  const { owner, devices, device, leg } = found
  const legDevices = getGridSideTapDevices(devices, leg)
  const previous = legDevices[legDevices.findIndex((entry) => entry.id === deviceId) - 1]
  const anchor: SupplyTapAnchor = { leg, ...(previous ? { afterTrunkDeviceId: previous.id } : {}) }
  const existing = getSupplyTapsPanel(owner)
  // Taps that left the wire after this device were downstream of it, so the new tap goes first.
  const downstreamIds = new Set(
    [...(existing?.protections ?? []), ...(existing?.circuits ?? [])]
      .filter((item) => item.supplyTap?.afterTrunkDeviceId === deviceId)
      .map((item) => item.id)
  )
  retargetSupplyTapAnchors(owner, devices, deviceId)

  const board = getOrCreateSupplyTapsPanel(
    owner,
    getDomainTranslator(env.language)('panels.supplyTapsName', { defaultValue: 'Supply taps' })
  )
  if (!existing) board.id = env.newId()
  const circuit: Circuit = {
    id: env.newId(),
    code: '',
    kind: 'other',
    cable: createDefaultAcCircuitCable(),
    endpoints: [],
    ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  }
  const insertBeforeDownstream = <T extends { id: string }>(list: T[], item: T): void => {
    const index = list.findIndex((entry) => downstreamIds.has(entry.id))
    if (index < 0) list.push(item)
    else list.splice(index, 0, item)
  }
  const created: SupplyTapRef[] = []
  let selected: SupplyTapRef
  if (device.symbol === 'energy_meter') {
    const moved = cloneValue(device)
    delete moved.supplyPath
    delete moved.converterGridPlacement
    delete moved.changeoverGridPlacement
    delete moved.panelMounting
    moved.trunkPosition = 0
    circuit.trunkDevices = [moved]
    circuit.supplyTap = anchor
    insertBeforeDownstream(board.circuits, circuit)
    created.push({ kind: 'circuit', id: circuit.id })
    selected = { kind: 'trunkDevice', id: moved.id }
  } else {
    const type = device.protectionType ?? 'MCB'
    // Tap circuits stay out of automatic labelling.
    circuit.code = ''
    const protection: ProtectionDevice = {
      id: env.newId(),
      type,
      label: circuit.code,
      circuits: [circuit],
      supplyTap: anchor,
    }
    copySharedProtectionProps(device, protection)
    insertBeforeDownstream(board.protections, protection)
    created.push({ kind: 'protection', id: protection.id }, { kind: 'circuit', id: circuit.id })
    selected = { kind: 'protection', id: protection.id }
  }
  if (!existing) created.push({ kind: 'panel', id: board.id })

  // Resolving the code may have rebuilt the feed lists, so take the live list again.
  const liveDevices = findTapEligibleSupplyDevice(project, deviceId)!.devices
  liveDevices.splice(
    liveDevices.findIndex((entry) => entry.id === deviceId),
    1
  )
  renumber(liveDevices)
  cleanupPanelGridSlotsForDevice(getEditableProjectElectricalPanels(project), {
    kind: 'trunkDevice',
    id: deviceId,
    scope: 'supply',
  })
  pruneEendraadFrames(project, { removedMemberIds: [deviceId] })
  reconcileSupplyAfterEdit(project, owner.id, device.supplyPath)
  return { ok: true, created, select: [selected] }
}

/** Moves a bare tap back onto the supply wire, at the position the tap leaves from. */
export function convertSupplyTapToInlineInProject(
  project: ProjectV2,
  itemId: string,
  env: { newId: () => string }
): SupplyTapResult {
  const found = findConvertibleSupplyTap(project, itemId)
  if (!found)
    return { ok: false, code: 'not_convertible', message: 'This tap cannot become an in-line device' }
  const { owner, board, kind, item, anchor, devices } = found
  const legDevices = getGridSideTapDevices(devices, anchor.leg)
  const anchorIndex = anchor.afterTrunkDeviceId
    ? devices.findIndex((entry) => entry.id === anchor.afterTrunkDeviceId)
    : -1
  if (anchor.afterTrunkDeviceId && anchorIndex < 0)
    return { ok: false, code: 'anchor_not_found', message: 'The tap anchor no longer exists' }
  const firstOnLeg = legDevices[0] ? devices.indexOf(legDevices[0]) : -1
  const insertIndex = anchor.afterTrunkDeviceId
    ? anchorIndex + 1
    : firstOnLeg >= 0
      ? firstOnLeg
      : anchor.leg === 'grid-run'
        ? 0
        : devices.length
  const neighbour = anchorIndex >= 0 ? devices[anchorIndex] : legDevices[0]
  // Taps stored after this one at the same anchor left the wire downstream of it.
  const list: Array<{ id: string; supplyTap?: SupplyTapAnchor }> =
    kind === 'protection' ? board.protections : board.circuits
  const downstream = list
    .slice(list.findIndex((entry) => entry.id === item.id) + 1)
    .filter(
      (entry) =>
        entry.supplyTap?.leg === anchor.leg &&
        entry.supplyTap.afterTrunkDeviceId === anchor.afterTrunkDeviceId
    )

  let device: TrunkDevice
  if (kind === 'protection') {
    const protection = item as ProtectionDevice
    device = {
      id: env.newId(),
      type: 'protection',
      protectionType: protection.type,
      symbol: PROTECTION_TYPE_TO_SYMBOL_ID[protection.type]!,
      label: '',
      trunkPosition: insertIndex,
    }
    copySharedProtectionProps(protection, device)
    board.protections = board.protections.filter((entry) => entry.id !== protection.id)
  } else {
    const circuit = item as Circuit
    device = cloneValue(circuit.trunkDevices![0]!)
    cleanupPanelGridSlotsForDevice(getEditableProjectElectricalPanels(project), {
      kind: 'trunkDevice',
      id: device.id,
      scope: 'circuit',
      circuitId: circuit.id,
    })
    board.circuits = board.circuits.filter((entry) => entry.id !== circuit.id)
  }
  if (anchor.leg === 'changeover-grid') {
    device.supplyPath = 'changeover-grid'
    if (neighbour?.changeoverGridPlacement)
      device.changeoverGridPlacement = neighbour.changeoverGridPlacement
  } else if (anchor.leg === 'converter-input') {
    device.supplyPath = 'converter-grid'
    device.converterGridPlacement = neighbour?.converterGridPlacement ?? 'input-leg'
  }
  devices.splice(insertIndex, 0, device)
  renumber(devices)
  for (const entry of downstream) if (entry.supplyTap) entry.supplyTap.afterTrunkDeviceId = device.id
  removeEmptySupplyTapsPanels(project)
  reconcileSupplyAfterEdit(project, owner.id, device.supplyPath)
  return {
    ok: true,
    created: [{ kind: 'trunkDevice', id: device.id }],
    select: [{ kind: 'trunkDevice', id: device.id }],
  }
}
