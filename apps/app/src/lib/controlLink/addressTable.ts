import type { ControlSystem, Panel } from '@/types/schema'
import { findPanelContainingCircuit } from '@/lib/eendraad/projectElectricalDomain'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import { addressKey } from './controlAddress'
import { getOutputChannelOptions } from './controlDevicePicker'
import {
  buildControlDeviceIndex,
  collectControlLinkEntries,
  getOperatingDeviceKind,
  getChannelCapacity,
  issuesForConnection,
  validateControlDevices,
  type ChannelCapacity,
  type ConnectedEndpointSource,
  type ConnectionDirection,
  type ControlDeviceIssue,
  type OperatingDeviceKind,
} from './controlLink'

/**
 * The domotica address table: every module with its outputs and inputs, the free output
 * channels, and the same warnings as the properties panel. Derived live, never stored.
 */

export interface AddressTableRow {
  endpointId: string
  deviceId: string
  direction: ConnectionDirection
  source: ConnectedEndpointSource
  channel: string | undefined
  groups: string[]
  load: string
  circuitId: string
  circuit: string
  hasIssue: boolean
}

export interface AddressTableDevice {
  deviceId: string
  kind: OperatingDeviceKind
  label: string
  system: ControlSystem | undefined
  outputSystem: ControlSystem | undefined
  deviceAddress: string | undefined
  line: string | undefined
  panelId: string | undefined
  panelName: string | undefined
  capacity: ChannelCapacity
  /** Outputs first, then inputs, each naturally sorted by channel. */
  rows: AddressTableRow[]
  /** Enumerable output channels nobody uses; empty when the scheme is not enumerable. */
  freeChannels: string[]
  /** Device-level warnings (address, capacity) or any warning on its rows. */
  hasIssue: boolean
}

export interface AddressTableFilter {
  system?: ControlSystem
  panelId?: string
  issuesOnly?: boolean
  /** Leave out relays that operate contacts; only domotica modules remain. */
  hideRelays?: boolean
}

export function findOwningPanel(panels: Panel[], circuitId: string): Panel | undefined {
  for (const panel of panels) {
    const owner = findPanelContainingCircuit(panel, circuitId)
    if (owner) return owner
  }
  return undefined
}

/** The circuit name shown everywhere: a single MCB's label, otherwise the circuit code. */
export function getCircuitIdentifierFromPanels(panels: Panel[], circuitId: string): string {
  const result = getElectricalLookupIndex(panels).circuitsById.get(circuitId)
  if (result?.parent && 'type' in result.parent && 'label' in result.parent) {
    return result.parent.label
  }
  return result?.circuit.code ?? ''
}

function label(value: string): string {
  return value.trim() || '?'
}

function deviceHasOwnIssue(issues: ControlDeviceIssue[], deviceId: string): boolean {
  return issues.some(
    (issue) =>
      (issue.kind === 'invalid-device-address' || issue.kind === 'over-capacity') &&
      issue.deviceId === deviceId
  )
}

export function buildAddressTable(panels: Panel[], filter: AddressTableFilter = {}): AddressTableDevice[] {
  const { devices } = buildControlDeviceIndex(panels)
  const issues = validateControlDevices(panels)
  const table: AddressTableDevice[] = []
  for (const device of devices.values()) {
    // A relay is listed once it operates a contact; every other relay stays out of the table.
    if (device.kind === 'relay' && (filter.hideRelays || device.connections.length === 0)) continue
    const deviceId = device.endpoint.id
    const panel = findOwningPanel(panels, device.circuit.id)
    const rows = device.connections
      .map(
        (entry): AddressTableRow => ({
          endpointId: entry.endpoint.id,
          deviceId,
          direction: entry.direction,
          source: entry.source,
          channel: entry.channel,
          groups: entry.groups,
          load: label(entry.endpoint.label),
          circuitId: entry.circuit.id,
          circuit: getCircuitIdentifierFromPanels(panels, entry.circuit.id),
          hasIssue: issuesForConnection(issues, entry.endpoint.id).length > 0,
        })
      )
      // Connections arrive sorted by channel; a stable sort keeps that within each direction.
      .sort((left, right) => (left.direction === right.direction ? 0 : left.direction === 'output' ? -1 : 1))
    const used = new Set(
      rows
        .filter((row) => row.direction === 'output' && row.channel != null)
        .map((row) => addressKey(row.channel!))
    )
    const entry: AddressTableDevice = {
      deviceId,
      kind: device.kind,
      label: label(device.endpoint.label),
      system: device.fields.system,
      outputSystem: device.fields.outputSystem,
      deviceAddress: device.fields.deviceAddress?.trim() || undefined,
      line: device.fields.line?.trim() || undefined,
      panelId: panel?.id,
      panelName: panel?.name,
      capacity: getChannelCapacity(device),
      rows,
      freeChannels: (getOutputChannelOptions(device) ?? []).filter((channel) => !used.has(addressKey(channel))),
      hasIssue: deviceHasOwnIssue(issues, deviceId) || rows.some((row) => row.hasIssue),
    }
    if (filter.system && entry.system !== filter.system && entry.outputSystem !== filter.system) continue
    if (filter.panelId && entry.panelId !== filter.panelId) continue
    if (filter.issuesOnly && !entry.hasIssue) continue
    table.push(entry)
  }
  return table.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/**
 * True when the table has content: a domotica module, or a contact operated by a relay.
 * Projects with only ordinary relays never see the table.
 */
export function projectHasControlDevices(panels: Panel[]): boolean {
  const entries = collectControlLinkEntries(panels)
  const relayIds = new Set<string>()
  for (const { endpoint } of entries) {
    const kind = getOperatingDeviceKind(endpoint)
    if (kind === 'domotica') return true
    if (kind === 'relay') relayIds.add(endpoint.id)
  }
  return entries.some(({ endpoint }) => endpoint.controlLink && relayIds.has(endpoint.controlLink.deviceId))
}

export interface AddressTableGroupEntry {
  group: string
  rows: Array<AddressTableRow & { deviceLabel: string }>
}

/**
 * The integrator's view: every group address with the channels listening to it, naturally
 * sorted. Connections without groups are left out.
 */
export function groupAddressTable(devices: AddressTableDevice[]): AddressTableGroupEntry[] {
  const groups = new Map<string, AddressTableGroupEntry>()
  for (const device of devices) {
    for (const row of device.rows) {
      for (const group of row.groups) {
        const key = addressKey(group)
        const entry = groups.get(key) ?? { group, rows: [] }
        entry.rows.push({ ...row, deviceLabel: device.label })
        groups.set(key, entry)
      }
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.group.localeCompare(right.group, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** Short range text for free channels: `2, 4–7`. */
export function formatChannelList(channels: readonly string[]): string {
  const parts: string[] = []
  let start: string | undefined
  let previous: string | undefined
  const step = (value: string) =>
    /^[0-9]+$/.test(value) ? Number(value) : value.length === 1 ? value.toUpperCase().charCodeAt(0) : NaN
  const flush = () => {
    if (start == null || previous == null) return
    parts.push(start === previous ? start : `${start}–${previous}`)
  }
  for (const channel of channels) {
    if (previous != null && step(channel) === step(previous) + 1) {
      previous = channel
      continue
    }
    flush()
    start = channel
    previous = channel
  }
  flush()
  return parts.join(', ')
}

export interface AddressTableCsvLabels {
  headers: [string, string, string, string, string, string, string, string, string]
  direction: (direction: ConnectionDirection) => string
  system: (system: ControlSystem | undefined) => string
  /** Shown in the system column for relays. */
  relay?: string
}

function csvCell(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** One line per connection with its module's details repeated, for spreadsheets. */
export function addressTableCsv(devices: AddressTableDevice[], labels: AddressTableCsvLabels): string {
  const lines = [labels.headers.map(csvCell).join(',')]
  for (const device of devices) {
    const system =
      device.kind === 'relay'
        ? (labels.relay ?? '')
        : device.outputSystem
          ? `${labels.system(device.system)} → ${labels.system(device.outputSystem)}`
          : labels.system(device.system)
    for (const row of device.rows) {
      lines.push(
        [
          device.label,
          system,
          [device.deviceAddress, device.line].filter(Boolean).join(' · '),
          labels.direction(row.direction),
          row.channel ?? '',
          row.groups.join(' '),
          row.load,
          row.circuit,
          device.panelName ?? '',
        ]
          .map(csvCell)
          .join(',')
      )
    }
  }
  return `${lines.join('\n')}\n`
}
