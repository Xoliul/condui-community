import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getModularSocketModuleWidth, isModularSocket } from '@/lib/socket/modularSocket'
import type { Endpoint, Panel, PanelGridModuleRef, ProtectionDevice } from '@/types/schema'

function polesFromPolesConfig(config: string | undefined): number {
  if (!config) return 1
  if (config === '4P' || config === '3P+N') return 4
  if (config === '3P') return 3
  if (config === '2P' || config === '1P+N') return 2
  return 1
}

function findProtectionRecursive(panels: Panel[], id: string): ProtectionDevice | null {
  for (const panel of panels) {
    const protection = panel.protections.find((candidate) => candidate.id === id)
    if (protection) return protection
    const nested = findProtectionRecursive(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return null
}

function findEndpointRecursive(panels: Panel[], id: string): Endpoint | null {
  for (const panel of panels) {
    for (const circuit of panel.circuits) {
      const endpoint = circuit.endpoints.find((candidate) => candidate.id === id)
      if (endpoint) return endpoint
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        const endpoint = circuit.endpoints.find((candidate) => candidate.id === id)
        if (endpoint) return endpoint
      }
    }
    const nested = findEndpointRecursive(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return null
}

/** Return a panel module's natural physical width without importing canvas code. */
export function getModuleWidthInCols(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): number {
  if (!project) return 1
  if (ref.kind === 'protection') {
    const protection = findProtectionRecursive(getProjectElectricalPanels(project), ref.id)
    if (protection) {
      return Math.max(1, protection.poles ?? polesFromPolesConfig(protection.polesConfig))
    }
  }
  if (ref.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, ref.id)
    if (device) {
      if (device.symbol === 'terminal_strip' || device.type === 'terminal_strip') return 1 / 3
      if (device.poles != null) return Math.max(1, device.poles)
      if (device.polesConfig) return Math.max(1, polesFromPolesConfig(device.polesConfig))
      if (device.energyMeterProps?.poles != null) return Math.max(1, device.energyMeterProps.poles)
      if (device.energyMeterProps?.polesConfig) {
        return Math.max(1, polesFromPolesConfig(device.energyMeterProps.polesConfig))
      }
    }
  }
  if (ref.kind === 'domotica') {
    const endpoint = findEndpointRecursive(getProjectElectricalPanels(project), ref.endpointId)
    if (endpoint && isModularSocket(endpoint)) return getModularSocketModuleWidth(endpoint)
    if (endpoint?.symbol === 'terminal_strip') return 1 / 3
    return 2
  }
  return 1
}

/** Modular sockets keep a derived 2/4-module width; slot resize cannot override it. */
export function moduleWidthFollowsDevice(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): boolean {
  if (!project || ref.kind !== 'domotica') return false
  return isModularSocket(findEndpointRecursive(getProjectElectricalPanels(project), ref.endpointId))
}

/** True for trunk-device and endpoint-form terminal strips shown as panel modules. */
export function isTerminalStripModuleRef(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): boolean {
  if (!project) return false
  if (ref.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, ref.id)
    return device?.symbol === 'terminal_strip' || device?.type === 'terminal_strip'
  }
  if (ref.kind === 'domotica') {
    return (
      findEndpointRecursive(getProjectElectricalPanels(project), ref.endpointId)?.symbol ===
      'terminal_strip'
    )
  }
  return false
}
