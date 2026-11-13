import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { getProjectElectricalPanels, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import type { Circuit, ControlDeviceFields, ControlSystem, Endpoint, EndpointControlLink, Panel } from '@/types/schema'
import {
  addressKey,
  normalizeChannel,
  normalizeGroups,
  validateDeviceAddress,
  validateDeviceChannel,
  validateDeviceGroup,
} from './controlAddress'
import { busDeviceAddressKey, busRowLabelKey, rowAddressKey } from './controlLinkNoteContext'
import { getDomoticaBusContext, getDomoticaBusDeviceFields, getDomoticaBusLabel, type DomoticaBusContext } from './domoticaBus'
import { controlConnectionId, getActiveControlButtonAddresses, getControlButtonCount, setControlButtonAddress } from './buttonAddressing'

export { normalizeChannel } from './controlAddress'

export interface ControlLinkEntry {
  endpoint: Endpoint
  circuit: Circuit
}

export const CONTROL_LINK_NOTE_SEPARATOR = ' · '

/** Endpoints that may operate other endpoints through a control link. */
export function canOperateControlLinks(endpoint: Endpoint | undefined): endpoint is Endpoint {
  return getOperatingDeviceKind(endpoint) !== undefined
}

/**
 * Kind of an operating device: a domotica module, or a relay endpoint (impulse relay, contactor,
 * timer) whose coil sits on a control circuit while its contact is drawn in the circuit it
 * switches. Relays on a circuit trunk already switch their own circuit and are not included.
 */
export type OperatingDeviceKind = 'domotica' | 'relay'

export function getOperatingDeviceKind(endpoint: Endpoint | undefined): OperatingDeviceKind | undefined {
  if (!endpoint || endpoint.domoticaChildProps) return undefined
  if (endpoint.symbol === 'domotica') return 'domotica'
  if (endpoint.symbol === 'relay') return 'relay'
  return undefined
}

/** A module on an explicitly modeled bus also operates its own ordinary outputs. */
function contextualOperatingKind(
  panels: Panel[], endpoint: Endpoint | undefined, endpoints: ReadonlyMap<string, Endpoint>,
): OperatingDeviceKind | undefined {
  return getOperatingDeviceKind(endpoint) ??
    (endpoint?.symbol === 'domotica' && getDomoticaBusContext(panels, endpoint, endpoints) ? 'domotica' : undefined)
}

/**
 * Endpoints that may carry a control link: contacts operated by a module or relay (outputs),
 * switches or pushbuttons that signal one (inputs), and relay coils switched by another
 * device (outputs). Wired domotica children are connected through their parent instead.
 */
export function canHaveControlLink(endpoint: Endpoint | undefined): boolean {
  if (!endpoint || endpoint.domoticaChildProps) return false
  return endpoint.symbol === 'contact' || endpoint.symbol === 'relay' || isSwitchSymbol(endpoint.symbol)
}

/** Shared picker/command eligibility: a relay may be both a consumer and an operator,
 * but its chain of operating devices must remain acyclic. */
export function canLinkControlDevice(
  panels: Panel[],
  endpoint: Endpoint | undefined,
  deviceId: string,
  projectedEndpoints?: ReadonlyMap<string, Endpoint>,
): boolean {
  if (!canHaveControlLink(endpoint) || !endpoint || deviceId === endpoint.id) return false
  const endpoints = projectedEndpoints ?? new Map(
    collectControlLinkEntries(panels).map((entry) => [entry.endpoint.id, entry.endpoint]),
  )
  let current = endpoints.get(deviceId)
  if (!contextualOperatingKind(panels, current, endpoints)) return false
  const visited = new Set([endpoint.id])
  while (current) {
    if (visited.has(current.id) || !contextualOperatingKind(panels, current, endpoints)) return false
    visited.add(current.id)
    const parentId = current.controlLink?.deviceId
    if (!parentId) return true
    current = endpoints.get(parentId)
    if (!current) return false
  }
  return true
}

/** A new operating device assigns the first effective channel; the remaining
 * button addresses and all group assignments belong to the connection. */
export function rebindControlLink(
  endpoint: Endpoint,
  deviceId: string | undefined,
  channel?: string,
): EndpointControlLink | undefined {
  if (!deviceId) return undefined
  const next: EndpointControlLink = { ...endpoint.controlLink, deviceId, channel: normalizeChannel(channel) }
  const perButton = getConnectionDirection(endpoint) === 'input' &&
    (getControlButtonCount(endpoint) > 1 || !!endpoint.controlLink?.buttonAddresses?.length)
  return perButton ? setControlButtonAddress(next, 0, { channel: next.channel }) : next
}

export function collectControlLinkEntries(panels: Panel[]): ControlLinkEntry[] {
  const seen = new Set<string>()
  const entries: ControlLinkEntry[] = []
  for (const panel of panels) {
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints) {
        if (seen.has(endpoint.id)) continue
        seen.add(endpoint.id)
        entries.push({ endpoint, circuit })
      }
    }
  }
  return entries
}

/** All domotica module endpoints that can be chosen as an operating device. */
export function findControlLinkDevices(panels: Panel[]): ControlLinkEntry[] {
  const entries = collectControlLinkEntries(panels)
  const endpoints = new Map(entries.map(({ endpoint }) => [endpoint.id, endpoint]))
  return entries.filter(({ endpoint }) =>
    contextualOperatingKind(panels, endpoint, endpoints) != null
  )
}

function compareChannels(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? 1 : -1
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/** Endpoints linked to a device, ordered by channel (unassigned last). */
export function findLinkedEndpoints(panels: Panel[], deviceId: string): ControlLinkEntry[] {
  return collectControlLinkEntries(panels)
    .filter(({ endpoint }) => endpoint.controlLink?.deviceId === deviceId)
    .sort(
      (left, right) =>
        compareChannels(
          normalizeChannel(left.endpoint.controlLink?.channel),
          normalizeChannel(right.endpoint.controlLink?.channel)
        )
    )
}

function resolveDevice(panels: Panel[], link: EndpointControlLink | undefined): Endpoint | undefined {
  if (!link) return undefined
  return findControlLinkDevices(panels).find(({ endpoint }) => endpoint.id === link.deviceId)?.endpoint
}

function formatControlLinkLabel(device: Endpoint, link: EndpointControlLink): string {
  const label = device.label.trim() || '?'
  const channel = normalizeChannel(link.channel)
  return channel == null ? label : `${label}${CONTROL_LINK_NOTE_SEPARATOR}${channel}`
}

/** Derived display label such as `D1 · A3`; a link without channel shows the device only. */
export function getControlLinkLabel(
  panels: Panel[],
  link: EndpointControlLink | undefined
): string | undefined {
  const device = resolveDevice(panels, link)
  if (!device || !link) return undefined
  return formatControlLinkLabel(device, link)
}

/**
 * Wired domotica outputs show their channel below the last symbol on the row. A row may hold
 * several output loads; its shared channel follows the endpoint that carries the row label.
 * Input buttons keep their own addresses below each symbol instead.
 */
function addRowAddressNotes(entries: ControlLinkEntry[], notes: Map<string, string>, panels: Panel[]): void {
  const rows = new Map<string, { ids: string[]; channel?: string }>()
  for (const { endpoint } of entries) {
    const child = endpoint.domoticaChildProps
    if (!child) continue
    const bus = getDomoticaBusContext(panels, endpoint)
    if (bus) {
      const label = getDomoticaBusLabel(bus)
      if (label) {
        notes.set(rowAddressKey(endpoint.id), label)
        notes.set(busRowLabelKey(endpoint.id), label)
      }
      const address = getDomoticaBusDeviceFields(bus, endpoint).deviceAddress
      if (address) notes.set(busDeviceAddressKey(endpoint.id), address)
      continue
    }
    if (getConnectionDirection(endpoint) === 'input') continue
    const key = `${child.parentEndpointId}:${child.outputGroup}:${child.outputIndex}`
    const row = rows.get(key) ?? { ids: [] }
    row.ids.push(endpoint.id)
    row.channel ??= normalizeChannel(child.channel)
    rows.set(key, row)
  }
  for (const row of rows.values()) {
    if (row.channel == null) continue
    const rowLabelEndpointId = row.ids.at(-1)
    if (rowLabelEndpointId) notes.set(rowAddressKey(rowLabelEndpointId), row.channel)
  }
}

/** Resolved one-wire note text per endpoint id for every endpoint with a valid control link. */
export function buildControlLinkNoteMap(panels: Panel[]): Map<string, string> {
  const notes = new Map<string, string>()
  const entries = collectControlLinkEntries(panels)
  addRowAddressNotes(entries, notes, panels)
  if (!entries.some(({ endpoint }) => endpoint.controlLink)) return notes
  const devices = new Map(
    findControlLinkDevices(panels)
      .map(({ endpoint }) => [endpoint.id, endpoint])
  )
  for (const { endpoint } of entries) {
    const link = endpoint.controlLink
    const device = link ? devices.get(link.deviceId) : undefined
    if (link && device && getConnectionDirection(endpoint) !== 'input')
      notes.set(endpoint.id, formatControlLinkLabel(device, link))
  }
  return notes
}

/**
 * A linked output contact shows its operating device. Input buttons keep their ordinary
 * notes independent of the per-button addresses painted directly below the symbol.
 */
export function getEndpointOneWireNoteText(
  endpoint: Endpoint,
  project: ProjectWithOptionalV2Electrical
): string {
  const linked = endpoint.controlLink && getConnectionDirection(endpoint) !== 'input'
    ? getControlLinkLabel(getProjectElectricalPanels(project), endpoint.controlLink)
    : undefined
  return getVisibleEndpointNoteText(endpoint, linked)
}

/** True when the endpoint's own notes are replaced on the one-wire by its control link. */
export function isEndpointNoteOverriddenByControlLink(
  endpoint: Endpoint,
  project: ProjectWithOptionalV2Electrical
): boolean {
  return (
    endpoint.controlLink != null && getConnectionDirection(endpoint) !== 'input' &&
    getControlLinkLabel(getProjectElectricalPanels(project), endpoint.controlLink) !== undefined
  )
}

/** Device fields of an operating device; empty when unspecified. */
export function getControlDeviceFields(device: Endpoint | undefined): ControlDeviceFields {
  return device?.domoticaProps ?? {}
}

export type ConnectedEndpointSource = 'wired' | 'linked'

/**
 * Inputs (pushbuttons, switches, detectors wired to the module) and outputs (loads and
 * contacts the module switches) use separate channels, so they never collide.
 */
export type ConnectionDirection = 'input' | 'output'

/** Symbols that signal the module instead of being switched by it. */
const INPUT_SYMBOLS = new Set([
  'switch',
  'switch_1p_twoway',
  'switch_cross',
  'switch_dimmer',
  'switch_1p_changeover',
  'switch_shutter',
  'switch_1p_pull',
  'switch_impulse',
  'light_sensor',
  'motion_detector',
  'smoke_detector',
])

const DETECTOR_SYMBOLS = new Set(['motion_detector', 'smoke_detector', 'light_sensor'])

function isSwitchSymbol(symbol: Endpoint['symbol']): boolean {
  return symbol != null && INPUT_SYMBOLS.has(symbol) && !DETECTOR_SYMBOLS.has(symbol)
}

/** Direction of a connection: switches and detectors signal the device, everything else is switched by it. */
export function getConnectionDirection(
  endpoint: Endpoint,
  _source?: ConnectedEndpointSource
): ConnectionDirection {
  return endpoint.symbol != null && INPUT_SYMBOLS.has(endpoint.symbol) ? 'input' : 'output'
}

export interface ConnectedEndpointEntry extends ControlLinkEntry {
  source: ConnectedEndpointSource
  direction: ConnectionDirection
  channel: string | undefined
  groups: string[]
  /** Stable identity when a multiplied pushbutton contributes several input channels. */
  connectionId: string
  buttonIndex?: number
  bus?: {
    key: string
    label: string
    outputGroup: 'control' | 'endpoint'
    outputIndex: number
    system: ControlSystem | undefined
    deviceAddress: string | undefined
  }
}

export interface ControlDeviceEntry extends ControlLinkEntry {
  kind: OperatingDeviceKind
  fields: ControlDeviceFields
  /** Wired children and linked endpoints, naturally sorted by channel (unassigned last). */
  connections: ConnectedEndpointEntry[]
  busContext?: DomoticaBusContext
}

export interface ControlDeviceIndex {
  devices: Map<string, ControlDeviceEntry>
  /** Linked endpoints whose device no longer resolves. */
  dangling: ControlLinkEntry[]
}

/** Every operating device with everything connected to it, from one pass over the project. */
export function buildControlDeviceIndex(panels: Panel[]): ControlDeviceIndex {
  const entries = collectControlLinkEntries(panels)
  const endpoints = new Map(entries.map(({ endpoint }) => [endpoint.id, endpoint]))
  const devices = new Map<string, ControlDeviceEntry>()
  for (const entry of entries) {
    const kind = contextualOperatingKind(panels, entry.endpoint, endpoints)
    if (!kind) continue
    const bus = getDomoticaBusContext(panels, entry.endpoint, endpoints)
    devices.set(entry.endpoint.id, {
      ...entry,
      kind,
      fields: bus
        ? { ...getControlDeviceFields(entry.endpoint), ...getDomoticaBusDeviceFields(bus, entry.endpoint) }
        : getControlDeviceFields(entry.endpoint),
      connections: [],
      ...(bus ? { busContext: bus } : {}),
    })
  }
  const dangling: ControlLinkEntry[] = []
  for (const entry of entries) {
    const { endpoint } = entry
    const link = endpoint.controlLink
    if (link) {
      const device = devices.get(link.deviceId)
      if (!device) {
        dangling.push(entry)
        continue
      }
      device.connections.push(...connectionEntries(entry, 'linked', link))
      continue
    }
    const child = endpoint.domoticaChildProps
    if (!child) continue
    const bus = getDomoticaBusContext(panels, endpoint, endpoints)
    if (endpoint.symbol === 'domotica' && !bus) continue
    devices.get(child.parentEndpointId)?.connections.push(...connectionEntries(entry, 'wired', child, bus))
  }
  for (const device of devices.values()) {
    device.connections.sort((left, right) => compareChannels(left.channel, right.channel))
  }
  return { devices, dangling }
}

function connectionEntries(
  entry: ControlLinkEntry,
  source: ConnectedEndpointSource,
  addressing: EndpointControlLink | NonNullable<Endpoint['domoticaChildProps']>,
  busContext?: DomoticaBusContext,
): ConnectedEndpointEntry[] {
  const direction = getConnectionDirection(entry.endpoint, source)
  const bus = busContext ? {
    key: busContext.busKey, label: getDomoticaBusLabel({ ...busContext, wire: { ...busContext.wire, showBusLabel: true } }),
    outputGroup: busContext.outputGroup, outputIndex: busContext.outputIndex,
    system: busContext.system,
    deviceAddress: getDomoticaBusDeviceFields(busContext, entry.endpoint).deviceAddress,
  } : undefined
  if (direction === 'input') {
    const numbered = getControlButtonCount(entry.endpoint) > 1 || addressing.buttonAddresses != null
    return getActiveControlButtonAddresses(entry.endpoint, addressing).map(({ buttonIndex, channel, groups }) => ({
      ...entry, source, direction, channel, groups,
      connectionId: controlConnectionId(entry.endpoint.id, buttonIndex),
      ...(numbered ? { buttonIndex } : {}),
      ...(bus ? { bus } : {}),
    }))
  }
  return [{
    ...entry, source, direction,
    channel: normalizeChannel(addressing.channel),
    groups: normalizeGroups(addressing.groups),
    connectionId: controlConnectionId(entry.endpoint.id),
    ...(bus ? { bus } : {}),
  }]
}

/** All operating devices, in project order. */
export function listControlDevices(panels: Panel[]): ControlDeviceEntry[] {
  return [...buildControlDeviceIndex(panels).devices.values()]
}

/** Wired children and control-linked endpoints of one device. */
export function findConnectedEndpoints(panels: Panel[], deviceId: string): ConnectedEndpointEntry[] {
  return buildControlDeviceIndex(panels).devices.get(deviceId)?.connections ?? []
}

/** Domotica module an endpoint is wired to, if any. */
export function findWiredParent(panels: Panel[], endpoint: Endpoint): Endpoint | undefined {
  const parentId = endpoint.domoticaChildProps?.parentEndpointId
  if (!parentId) return undefined
  return collectControlLinkEntries(panels).find(({ endpoint: candidate }) => candidate.id === parentId)
    ?.endpoint
}

/**
 * Suggested channel for a new connection in one direction (outputs by default). When every
 * channel already used in that direction is a plain integer (or none exist) this is max + 1;
 * otherwise the scheme is unknown and the suggestion is empty. `ignoreEndpointId` excludes
 * the endpoint being edited.
 */
export function getNextFreeChannel(
  panels: Panel[],
  deviceId: string,
  ignoreEndpointId?: string,
  direction: ConnectionDirection = 'output'
): string {
  const device = buildControlDeviceIndex(panels).devices.get(deviceId)
  // A relay usually has one contact; numbering only starts once the user chooses to.
  if (device?.kind === 'relay') return ''
  if (ignoreEndpointId && device?.connections.some((entry) => entry.endpoint.id === ignoreEndpointId && entry.bus)) return ''
  const used = (device?.connections ?? [])
    .filter((entry) => !entry.bus && entry.direction === direction && entry.endpoint.id !== ignoreEndpointId)
    .map(({ channel }) => channel)
    .filter((channel): channel is string => channel != null)
  if (!used.every((channel) => /^[0-9]+$/.test(channel))) return ''
  const max = used.reduce((highest, channel) => Math.max(highest, Number(channel)), 0)
  return String(max + 1)
}

export interface ChannelCapacity {
  /** Output channels. */
  capacity: number
  /** Output connections. */
  used: number
  /** Input connections; inputs never count against the output capacity. */
  inputs: number
  /** True when the capacity was entered; derived capacities never report over-capacity. */
  explicit: boolean
}

/**
 * Output channel capacity. When unset it is derived as max(drawn slots not taken by wired
 * inputs, output connections), since the drawn count covers inputs and outputs together.
 */
export function getChannelCapacity(device: ControlDeviceEntry): ChannelCapacity {
  const used = device.connections.filter((entry) => !entry.bus && entry.direction === 'output').length
  const inputs = device.connections.filter((entry) => entry.direction === 'input').length
  const explicit = device.fields.channelCount
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
    return { capacity: Math.floor(explicit), used, inputs, explicit: true }
  }
  const drawn = device.endpoint.domoticaProps?.endpointCount ?? 0
  const inputSlots = new Set(device.connections.filter((entry) => !entry.bus && entry.direction === 'input').map((entry) => entry.endpoint.id)).size
  const busSlots = (device.endpoint.domoticaProps?.endpointOutputWires ?? [])
    .slice(0, drawn).filter((wire) => wire?.connectionType === 'bus').length
  return { capacity: Math.max(drawn - inputSlots - busSlots, used), used, inputs, explicit: false }
}

export type ControlDeviceIssue =
  | { kind: 'dangling'; endpointId: string; deviceId: string }
  | {
      kind: 'duplicate-channel'
      deviceId: string
      direction: ConnectionDirection
      channel: string
      endpointIds: string[]
      connectionIds?: string[]
    }
  | { kind: 'invalid-channel'; deviceId: string; endpointId: string; channel: string; buttonIndex?: number }
  | { kind: 'invalid-group'; deviceId: string; endpointId: string; group: string; buttonIndex?: number }
  | { kind: 'invalid-device-address'; deviceId: string; address: string }
  | { kind: 'invalid-bus-device-address'; deviceId: string; endpointId: string; address: string }
  | { kind: 'duplicate-bus-device-address'; deviceId: string; busKey: string; address: string; endpointIds: string[] }
  | { kind: 'over-capacity'; deviceId: string; used: number; capacity: number }

/**
 * Warnings for control addressing. Syntax checks only apply once a device has a system, so
 * projects that never touch addressing produce no findings beyond dangling links.
 */
export function validateControlDevices(panels: Panel[]): ControlDeviceIssue[] {
  const { devices, dangling } = buildControlDeviceIndex(panels)
  const issues: ControlDeviceIssue[] = dangling.map(({ endpoint }) => ({
    kind: 'dangling',
    endpointId: endpoint.id,
    deviceId: endpoint.controlLink?.deviceId ?? '',
  }))
  for (const device of devices.values()) {
    const deviceId = device.endpoint.id
    const address = normalizeChannel(device.fields.deviceAddress)
    if (!device.busContext && address != null && !validateDeviceAddress(device.fields.system, address)) {
      issues.push({ kind: 'invalid-device-address', deviceId, address })
    }
    const claims = new Map<
      string,
      { direction: ConnectionDirection; channel: string; endpointIds: string[]; connectionIds: string[]; numbered: boolean }
    >()
    const busDevices = new Set<string>()
    const busAddressClaims = new Map<string, { busKey: string; address: string; endpointIds: string[] }>()
    for (const { endpoint, direction, channel, groups, connectionId, buttonIndex, bus } of device.connections) {
      const connectionFields = bus ? { system: bus.system } : device.fields
      if (bus && !busDevices.has(endpoint.id)) {
        busDevices.add(endpoint.id)
        if (bus.deviceAddress != null) {
          if (!validateDeviceAddress(bus.system, bus.deviceAddress)) {
            issues.push({ kind: 'invalid-bus-device-address', deviceId, endpointId: endpoint.id, address: bus.deviceAddress })
          }
          const key = `${bus.key}:${addressKey(bus.deviceAddress)}`
          const claim = busAddressClaims.get(key) ?? { busKey: bus.key, address: bus.deviceAddress, endpointIds: [] }
          claim.endpointIds.push(endpoint.id)
          busAddressClaims.set(key, claim)
        }
      }
      if (channel != null) {
        if (!bus && !validateDeviceChannel(connectionFields, channel)) {
          issues.push({ kind: 'invalid-channel', deviceId, endpointId: endpoint.id, channel, ...(buttonIndex == null ? {} : { buttonIndex }) })
        }
        const key = `${bus ? `bus-device:${endpoint.id}:` : ''}${direction}:${addressKey(channel)}`
        const claim = claims.get(key) ?? { direction, channel, endpointIds: [], connectionIds: [], numbered: false }
        claim.endpointIds.push(endpoint.id)
        claim.connectionIds.push(connectionId)
        claim.numbered ||= buttonIndex != null
        claims.set(key, claim)
      }
      for (const group of groups) {
        if (!validateDeviceGroup(connectionFields, group)) {
          issues.push({ kind: 'invalid-group', deviceId, endpointId: endpoint.id, group, ...(buttonIndex == null ? {} : { buttonIndex }) })
        }
      }
    }
    for (const claim of busAddressClaims.values()) {
      if (claim.endpointIds.length > 1) issues.push({ kind: 'duplicate-bus-device-address', deviceId, ...claim })
    }
    for (const claim of claims.values()) {
      if (claim.connectionIds.length > 1) issues.push({
        kind: 'duplicate-channel', deviceId,
        direction: claim.direction, channel: claim.channel,
        endpointIds: [...new Set(claim.endpointIds)],
        ...(claim.numbered ? { connectionIds: claim.connectionIds } : {}),
      })
    }
    const capacity = getChannelCapacity(device)
    if (capacity.explicit && capacity.used > capacity.capacity) {
      issues.push({ kind: 'over-capacity', deviceId, used: capacity.used, capacity: capacity.capacity })
    }
  }
  return issues
}

export function validateProjectControlDevices(
  project: ProjectWithOptionalV2Electrical
): ControlDeviceIssue[] {
  return validateControlDevices(getProjectElectricalPanels(project))
}

/** Issues that concern one endpoint as a connection. */
export function issuesForConnection(
  issues: ControlDeviceIssue[],
  endpointId: string,
  buttonIndex?: number,
): ControlDeviceIssue[] {
  return issues.filter((issue) => {
    if (issue.kind === 'duplicate-bus-device-address') return issue.endpointIds.includes(endpointId)
    if (issue.kind === 'duplicate-channel') {
      return buttonIndex != null && issue.connectionIds
        ? issue.connectionIds.includes(controlConnectionId(endpointId, buttonIndex))
        : issue.endpointIds.includes(endpointId)
    }
    return 'endpointId' in issue && issue.endpointId === endpointId &&
      (buttonIndex == null || !('buttonIndex' in issue) || issue.buttonIndex === buttonIndex)
  })
}
