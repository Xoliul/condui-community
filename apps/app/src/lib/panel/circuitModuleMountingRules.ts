import { symbolCanAppearInPanelGrid } from '@/lib/panel/panelGridSymbolEligibility'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { getSupplyTapsPanel, isSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'
import type { Circuit, Endpoint, Panel, PanelGridModuleRef, ProtectionDevice, TrunkDevice } from '@/types/schema'

/**
 * Circuit modules that may hang in another panel or a virtual (auxiliary) enclosure than
 * the panel owning their circuit: relays, meters, converters and domotica modules, both as
 * circuit trunk devices and as endpoints, and supply tap breakers. Other protections stay in
 * their own panel; terminal strips keep their own placement model. Modules of a supply-taps
 * board belong to its owner board, which is their default enclosure. Mounting is physical only and never changes the
 * electrical circuit, order or connections.
 */
export type CircuitModuleMounting = NonNullable<Endpoint['panelMounting']>

export function isRemountableCircuitTrunkDevice(device: TrunkDevice | null | undefined): boolean {
  if (!device) return false
  if (device.type === 'terminal_strip' || device.symbol === 'terminal_strip') return false
  return (
    device.type === 'relay' ||
    device.symbol === 'relay' ||
    device.type === 'energy_meter' ||
    device.type === 'conversion' ||
    device.type === 'domotica'
  )
}

export function isRemountableCircuitEndpoint(endpoint: Endpoint | null | undefined): boolean {
  if (!endpoint || endpoint.symbol === 'terminal_strip') return false
  return isModularSocket(endpoint) || symbolCanAppearInPanelGrid(endpoint.symbol)
}

/** Explicit mounting outside the owning panel, if any. A supply-only `grid` value is ignored. */
export function getCircuitModuleMounting(entity: {
  panelMounting?: TrunkDevice['panelMounting'] | Endpoint['panelMounting']
}): CircuitModuleMounting | undefined {
  const mounting = entity.panelMounting
  return mounting && mounting.kind !== 'grid' ? mounting : undefined
}

/** Circuits held directly by a panel (not by its sub-panels). */
export function getOwnPanelCircuits(panel: Panel): Circuit[] {
  return [
    ...panel.circuits,
    ...panel.protections.flatMap((protection) => protection.circuits ?? []),
  ]
}

function visitPanels(panels: readonly Panel[], visit: (panel: Panel) => void): void {
  for (const panel of panels) {
    visit(panel)
    visitPanels(panel.subPanels ?? [], visit)
  }
}

interface CircuitModuleOccurrenceBase {
  circuit: Circuit
  ownerPanel: Panel
}

export type CircuitModuleOccurrence = CircuitModuleOccurrenceBase &
  (
    | { form: 'device'; entity: TrunkDevice }
    | { form: 'endpoint'; entity: Endpoint }
    | { form: 'protection'; entity: ProtectionDevice }
  )

/** Every remountable circuit module with the panel that electrically owns it. */
export function listRemountableCircuitModules(panels: readonly Panel[]): CircuitModuleOccurrence[] {
  const result: CircuitModuleOccurrence[] = []
  const seenCircuits = new Set<string>()
  visitPanels(panels, (ownerPanel) => {
    if (isSupplyTapsPanel(ownerPanel)) return
    const taps = getSupplyTapsPanel(ownerPanel)
    for (const protection of taps?.protections ?? []) {
      const circuit = protection.circuits?.[0]
      if (protection.supplyTap && circuit)
        result.push({ form: 'protection', entity: protection, circuit, ownerPanel })
    }
    for (const circuit of [...getOwnPanelCircuits(ownerPanel), ...(taps ? getOwnPanelCircuits(taps) : [])]) {
      if (seenCircuits.has(circuit.id)) continue
      seenCircuits.add(circuit.id)
      for (const device of circuit.trunkDevices ?? [])
        if (isRemountableCircuitTrunkDevice(device))
          result.push({ form: 'device', entity: device, circuit, ownerPanel })
      for (const endpoint of circuit.endpoints)
        if (isRemountableCircuitEndpoint(endpoint))
          result.push({ form: 'endpoint', entity: endpoint, circuit, ownerPanel })
    }
  })
  return result
}

export function circuitModuleRef(occurrence: CircuitModuleOccurrence): PanelGridModuleRef {
  if (occurrence.form === 'protection') return { kind: 'protection', id: occurrence.entity.id }
  return occurrence.form === 'device'
    ? { kind: 'trunkDevice', id: occurrence.entity.id, scope: 'circuit', circuitId: occurrence.circuit.id }
    : { kind: 'domotica', endpointId: occurrence.entity.id, circuitId: occurrence.circuit.id }
}

export function collectPanelIds(panels: readonly Panel[]): Set<string> {
  const ids = new Set<string>()
  visitPanels(panels, (panel) => ids.add(panel.id))
  return ids
}

/**
 * Where a circuit module physically hangs. An explicit mounting whose target no longer
 * exists falls back to the owning panel, so a module can never disappear.
 */
export function resolveCircuitModuleEnclosure(
  entity: { panelMounting?: TrunkDevice['panelMounting'] | Endpoint['panelMounting'] },
  ownerPanelId: string,
  exists: { panelIds: ReadonlySet<string>; enclosureIds?: ReadonlySet<string> }
): CircuitModuleMounting {
  const mounting = getCircuitModuleMounting(entity)
  if (mounting?.kind === 'panel' && exists.panelIds.has(mounting.panelId)) return mounting
  if (
    mounting?.kind === 'auxiliary' &&
    (exists.enclosureIds == null || exists.enclosureIds.has(mounting.enclosureId))
  )
    return mounting
  return { kind: 'panel', panelId: ownerPanelId }
}

const isJunctionPanelDevice = (device: TrunkDevice) =>
  device.type === 'junction_panel' || device.symbol === 'junction_panel'

/**
 * Whether the module sits behind a junction panel on its circuit (or an ancestor circuit).
 * Without an explicit mounting such a module hangs in that junction panel.
 */
export function isCircuitModuleBehindJunctionPanel(occurrence: CircuitModuleOccurrence): boolean {
  if (occurrence.form === 'protection') return false
  const devices = [...(occurrence.circuit.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )
  const boundary = devices.findIndex(isJunctionPanelDevice)
  if (boundary >= 0) {
    if (occurrence.form === 'endpoint') return true
    if (devices.findIndex((device) => device.id === occurrence.entity.id) > boundary) return true
  }
  const circuits = getOwnPanelCircuits(occurrence.ownerPanel)
  const visited = new Set<string>([occurrence.circuit.id])
  let current = occurrence.circuit.id
  for (;;) {
    const parent = circuits.find((circuit) => circuit.subCircuitIds?.includes(current))
    if (!parent || visited.has(parent.id)) return false
    if ((parent.trunkDevices ?? []).some(isJunctionPanelDevice)) return true
    visited.add(parent.id)
    current = parent.id
  }
}
