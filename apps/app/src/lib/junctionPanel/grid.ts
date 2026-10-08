import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import type {
  Circuit,
  JunctionPanelTerminalComponent,
  Panel,
  PanelGridConfig,
  PanelGridModuleRef,
  TrunkDevice,
} from '@/types/schema'
import { findTrunkDeviceInProject } from '@/utils/project'

export const DEFAULT_JUNCTION_PANEL_GRID: PanelGridConfig = {
  rows: 1,
  columns: 18,
  feedFromTop: true,
  slots: [],
}

export function getJunctionPanelGridView(device: TrunkDevice): PanelGridConfig {
  return {
    ...DEFAULT_JUNCTION_PANEL_GRID,
    ...(device.junctionPanelGridView ?? {}),
    slots: device.junctionPanelGridView?.slots ?? [],
  }
}

export function getJunctionPanelTerminal(
  device: TrunkDevice,
  fallbackIndex = 0
): JunctionPanelTerminalComponent {
  return (
    device.junctionPanelTerminal ?? {
      id: `junction-terminal:${device.id}`,
      label: `X${fallbackIndex + 1}`,
      pinCount: 2,
    }
  )
}

export interface JunctionPanelOccurrence {
  device: TrunkDevice
  ref: PanelGridModuleRef
  ownerPanelId?: string
}

export function getJunctionPanelIdentity(device: TrunkDevice): string | null {
  if (device.type !== 'junction_panel' && device.symbol !== 'junction_panel') return null
  const identity = (device.junctionIdentity ?? device.label ?? '').trim().toUpperCase()
  return identity || null
}

/**
 * Junction panel occurrences per (upper-case) identity, in the order the panel canvas lays out
 * their terminals. The order decides the fallback terminal labels (X1, X2 ...), so the panel
 * canvas and the junction strip assets read it from here.
 */
export function collectJunctionPanelOccurrences(
  project: ProjectWithOptionalV2Electrical
): Map<string, JunctionPanelOccurrence[]> {
  const groups = new Map<string, JunctionPanelOccurrence[]>()
  const add = (device: TrunkDevice, ref: PanelGridModuleRef, ownerPanelId?: string) => {
    const identity = getJunctionPanelIdentity(device)
    if (!identity) return
    const entries = groups.get(identity) ?? []
    entries.push({ device, ref, ownerPanelId })
    groups.set(identity, entries)
  }
  const visitCircuit = (circuit: Circuit, ownerPanelId: string) => {
    for (const device of circuit.trunkDevices ?? []) {
      add(
        device,
        { kind: 'trunkDevice', id: device.id, scope: 'circuit', circuitId: circuit.id },
        ownerPanelId
      )
    }
  }
  for (const panel of getProjectElectricalPanels(project)) {
    const visitPanel = (candidate: Panel) => {
      for (const circuit of candidate.circuits ?? []) visitCircuit(circuit, candidate.id)
      for (const protection of candidate.protections ?? []) {
        for (const circuit of protection.circuits ?? []) visitCircuit(circuit, candidate.id)
      }
      for (const child of candidate.subPanels ?? []) visitPanel(child)
      for (const device of candidate.groundTrunkDevices ?? []) {
        add(device, { kind: 'trunkDevice', id: device.id, scope: 'ground' }, candidate.id)
      }
    }
    visitPanel(panel)
  }
  const installation = getProjectElectricalInstallation(project)
  for (const device of getAllSupplyTrunkDevices(project)) {
    add(device, { kind: 'trunkDevice', id: device.id, scope: 'supply' })
  }
  for (const device of installation?.groundTrunkDevices ?? []) {
    add(device, { kind: 'trunkDevice', id: device.id, scope: 'ground' })
  }
  return groups
}

export interface JunctionPanelTerminalEntry {
  /** Upper-case junction panel identity. */
  identity: string
  device: TrunkDevice
  terminal: JunctionPanelTerminalComponent
}

/** Every junction panel terminal with the label the panel canvas shows. */
export function collectJunctionPanelTerminals(
  project: ProjectWithOptionalV2Electrical
): JunctionPanelTerminalEntry[] {
  return [...collectJunctionPanelOccurrences(project)].flatMap(([identity, occurrences]) =>
    occurrences.map((occurrence, index) => ({
      identity,
      device: occurrence.device,
      terminal: getJunctionPanelTerminal(occurrence.device, index),
    }))
  )
}

export function updateJunctionPanelTerminal(
  project: ProjectWithOptionalV2Electrical,
  ownerDeviceId: string,
  updates: Partial<JunctionPanelTerminalComponent>
): boolean {
  const owner = findTrunkDeviceInProject(project, ownerDeviceId)
  if (!owner || (owner.type !== 'junction_panel' && owner.symbol !== 'junction_panel')) return false
  const current = getJunctionPanelTerminal(owner)
  owner.junctionPanelTerminal = {
    ...current,
    ...updates,
    pinCount: Math.max(2, Math.round(updates.pinCount ?? current.pinCount)),
  }
  return true
}

export function updateSharedJunctionPanelGrid(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  updates: Partial<PanelGridConfig>
): boolean {
  const target = findTrunkDeviceInProject(project, deviceId)
  if (!target || (target.type !== 'junction_panel' && target.symbol !== 'junction_panel')) {
    return false
  }
  const identity = (target.junctionIdentity ?? target.label ?? '').trim().toUpperCase()
  const devices: TrunkDevice[] = [
    ...getAllSupplyTrunkDevices(project),
    ...collectAllGroundTrunkDevices(
      getProjectElectricalPanels(project),
      getProjectElectricalInstallation(project)
    ),
  ]
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) devices.push(...(circuit.trunkDevices ?? []))
  }
  let changed = false
  for (const device of devices) {
    if (device.type !== 'junction_panel' && device.symbol !== 'junction_panel') continue
    const candidateIdentity = (device.junctionIdentity ?? device.label ?? '').trim().toUpperCase()
    if (device.id !== deviceId && (!identity || candidateIdentity !== identity)) continue
    device.junctionPanelGridView = {
      ...getJunctionPanelGridView(device),
      ...updates,
      slots: updates.slots ?? device.junctionPanelGridView?.slots ?? [],
    }
    changed = true
  }
  return changed
}
