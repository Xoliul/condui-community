import {
  collectPanelIds,
  isRemountableCircuitEndpoint,
  isRemountableCircuitTrunkDevice,
  resolveCircuitModuleEnclosure,
  type CircuitModuleMounting,
} from '@/lib/panel/circuitModuleMountingRules'
import { isSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'
import { trunkDeviceCanAppearInPanelGrid } from '@/lib/eendraad/projectElectricalDomain'
import { getJunctionPanelIdentity } from '@/lib/junctionPanel/grid'
import type { Circuit, Endpoint, Panel, TrunkDevice, WireSegment } from '@/types/schema'

/** Physical enclosure keys, matching the supply-assembly separators. */
export function enclosureTransitionKey(mounting: CircuitModuleMounting): string {
  return mounting.kind === 'panel' ? `panel:${mounting.panelId}` : `auxiliary:${mounting.enclosureId}`
}

/** Key of the junction panel a circuit runs through; its modules hang in it by default. */
export function junctionPanelTransitionKey(identity: string): string {
  return `junction:${identity}`
}

const FIELD = 'field'

const isJunctionPanelDevice = (device: TrunkDevice) =>
  device.type === 'junction_panel' || device.symbol === 'junction_panel'

interface CircuitElements {
  circuit: Circuit
  ownerPanelId: string
  protectionIds: Set<string>
  devices: Map<string, TrunkDevice>
  endpoints: Map<string, Endpoint>
  junctionPanelIds: Set<string>
  /** Junction panel identity per element behind one (inherited by downstream circuits). */
  behindJunction: Map<string, string>
}

/** Visits every panel with the board it physically hangs in: a supply-taps board is its owner's. */
function visitPanels(panels: readonly Panel[], visit: (panel: Panel, physicalPanelId: string) => void, ownerId?: string): void {
  for (const panel of panels) {
    const physicalPanelId = isSupplyTapsPanel(panel) && ownerId ? ownerId : panel.id
    visit(panel, physicalPanelId)
    visitPanels(panel.subPanels ?? [], visit, physicalPanelId)
  }
}

function indexCircuits(panels: readonly Panel[]): Map<string, CircuitElements> {
  const index = new Map<string, CircuitElements>()
  visitPanels(panels, (panel, physicalPanelId) => {
    const register = (circuit: Circuit, protectionId?: string) => {
      const entry = index.get(circuit.id) ?? {
        circuit,
        ownerPanelId: physicalPanelId,
        protectionIds: new Set<string>(),
        devices: new Map(),
        endpoints: new Map(),
        junctionPanelIds: new Set<string>(),
        behindJunction: new Map(),
      }
      if (protectionId) entry.protectionIds.add(protectionId)
      for (const device of circuit.trunkDevices ?? []) {
        entry.devices.set(device.id, device)
        if (isJunctionPanelDevice(device)) entry.junctionPanelIds.add(device.id)
      }
      for (const endpoint of circuit.endpoints) entry.endpoints.set(endpoint.id, endpoint)
      index.set(circuit.id, entry)
    }
    for (const protection of panel.protections)
      for (const circuit of protection.circuits ?? []) register(circuit, protection.id)
    for (const circuit of panel.circuits) register(circuit)
  })

  const markBehind = (entry: CircuitElements, identity: string, fromIndex: number) => {
    const devices = [...entry.devices.values()]
    devices.forEach((device, index) => {
      if (index > fromIndex && !entry.behindJunction.has(device.id))
        entry.behindJunction.set(device.id, identity)
    })
    for (const endpointId of entry.endpoints.keys())
      if (!entry.behindJunction.has(endpointId)) entry.behindJunction.set(endpointId, identity)
  }
  const inherit = (circuitId: string, identity: string, seen: Set<string>) => {
    const entry = index.get(circuitId)
    if (!entry || seen.has(circuitId)) return
    seen.add(circuitId)
    markBehind(entry, identity, -1)
    for (const childId of entry.circuit.subCircuitIds ?? []) inherit(childId, identity, seen)
  }
  for (const entry of index.values()) {
    const devices = [...(entry.circuit.trunkDevices ?? [])]
      .map((device, order) => ({ device, order }))
      .sort(
        (left, right) =>
          (left.device.trunkPosition ?? 0) - (right.device.trunkPosition ?? 0) ||
          left.order - right.order
      )
      .map(({ device }) => device)
    entry.devices = new Map(devices.map((device) => [device.id, device]))
    const boundary = devices.findIndex(isJunctionPanelDevice)
    if (boundary < 0) continue
    const identity = getJunctionPanelIdentity(devices[boundary]!) ?? devices[boundary]!.id
    markBehind(entry, identity, boundary)
    const seen = new Set<string>([entry.circuit.id])
    for (const childId of entry.circuit.subCircuitIds ?? []) inherit(childId, identity, seen)
  }
  return index
}

/**
 * Physical enclosure of every circuit element, keyed by element id: protections hang in their
 * panel, relays, meters, converters and domotica modules in their mounting (else their panel,
 * or the junction panel the circuit runs through), terminal strips in their panel, and a
 * junction panel symbol is its own junction panel. Field elements (lights, switches, junction
 * boxes) are `field`. The one-wire enclosure dashes, the structure view and the cable list
 * share this rule.
 */
export function indexCircuitElementEnclosures(panels: readonly Panel[]): Map<string, string> {
  const circuits = indexCircuits(panels)
  const panelIds = collectPanelIds(panels)
  const result = new Map<string, string>()

  const elementKey = (circuit: CircuitElements, elementId: string): string | undefined => {
    if (circuit.protectionIds.has(elementId)) return `panel:${circuit.ownerPanelId}`
    const behind = circuit.behindJunction.get(elementId)
    const defaultKey = behind
      ? junctionPanelTransitionKey(behind)
      : `panel:${circuit.ownerPanelId}`
    const device = circuit.devices.get(elementId)
    if (device) {
      if (isJunctionPanelDevice(device))
        return junctionPanelTransitionKey(getJunctionPanelIdentity(device) ?? device.id)
      if (isRemountableCircuitTrunkDevice(device)) {
        return device.panelMounting
          ? enclosureTransitionKey(
              resolveCircuitModuleEnclosure(device, circuit.ownerPanelId, { panelIds })
            )
          : defaultKey
      }
      if (device.type === 'terminal_strip' || device.symbol === 'terminal_strip') {
        if (device.panelMounting?.kind === 'auxiliary')
          return `auxiliary:${device.panelMounting.enclosureId}`
        return device.terminalStripPanelId && panelIds.has(device.terminalStripPanelId)
          ? `panel:${device.terminalStripPanelId}`
          : defaultKey
      }
      return trunkDeviceCanAppearInPanelGrid(device) ? defaultKey : FIELD
    }
    const endpoint = circuit.endpoints.get(elementId)
    if (endpoint) {
      if (isRemountableCircuitEndpoint(endpoint)) {
        return endpoint.panelMounting
          ? enclosureTransitionKey(
              resolveCircuitModuleEnclosure(endpoint, circuit.ownerPanelId, { panelIds })
            )
          : defaultKey
      }
      if (endpoint.symbol === 'terminal_strip')
        return endpoint.terminalStripPanelId && panelIds.has(endpoint.terminalStripPanelId)
          ? `panel:${endpoint.terminalStripPanelId}`
          : defaultKey
      return FIELD
    }
    return undefined
  }

  for (const circuit of circuits.values()) {
    for (const elementId of [
      ...circuit.protectionIds,
      ...circuit.devices.keys(),
      ...circuit.endpoints.keys(),
    ]) {
      const key = elementKey(circuit, elementId)
      if (key && !result.has(elementId)) result.set(elementId, key)
    }
  }
  return result
}

/** Whether an enclosure key from `indexCircuitElementEnclosures` names a field element. */
export function isFieldEnclosureKey(key: string | undefined): boolean {
  return key === FIELD
}

/**
 * Marks circuit wires that cross from one physical enclosure into another: a protection
 * feeding a meter hung in a virtual enclosure, a relay in another panel, and so on.
 *
 * Field elements (lights, switches, junction boxes) are not enclosures: the wire keeps the
 * enclosure it last left, so returning into another enclosure after field wiring is still a
 * transition, while leaving for the field never is. A junction panel symbol is itself the
 * transition into the junction panel; whatever follows it hangs in it unless mounted elsewhere.
 */
export function markCircuitEnclosureTransitions(segments: WireSegment[], panels: Panel[]): void {
  const circuits = indexCircuits(panels)
  const enclosures = indexCircuitElementEnclosures(panels)
  const elementKey = (elementId: string | undefined) =>
    elementId ? enclosures.get(elementId) : undefined

  // The drawn wire chain gives every element its upstream neighbour.
  const upstream = new Map<string, string>()
  for (const segment of segments) {
    if (!segment.circuitId || !segment.toElementId || !segment.fromElementId) continue
    const key = `${segment.circuitId}|${segment.toElementId}`
    if (!upstream.has(key)) upstream.set(key, segment.fromElementId)
  }
  /** Enclosure the wire is in when it leaves this element (field elements pass it through). */
  const enclosureLeaving = (circuit: CircuitElements, elementId: string | undefined): string | undefined => {
    const seen = new Set<string>()
    let current = elementId
    while (current && !seen.has(current)) {
      seen.add(current)
      const key = elementKey(current)
      if (key && key !== FIELD) return key
      current = upstream.get(`${circuit.circuit.id}|${current}`)
    }
    return undefined
  }

  for (const segment of segments) {
    if (!segment.circuitId || segment.isSupplyTrunk || segment.supplyEnclosureBoundary) continue
    const circuit = circuits.get(segment.circuitId)
    if (!circuit) continue
    // Entering a junction panel is shown by its own symbol.
    if (segment.toElementId && circuit.junctionPanelIds.has(segment.toElementId)) continue
    const to = elementKey(segment.toElementId)
    if (!to || to === FIELD) continue
    const from = enclosureLeaving(circuit, segment.fromElementId)
    if (!from || from === to) continue
    // A module drawn right against the trunk keeps its separator on its own short branch
    // stub: there it crosses the wire vertically instead of reaching into the module.
    segment.enclosureTransition = { from, to }
  }
}
