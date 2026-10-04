import type { ControlDeviceFields, ControlSystem } from '@/types/schema'

/**
 * Light, per-system syntax checks for control addressing. These only drive warnings: any
 * string is stored and nothing is rejected. Vendor programming rules (ETS, Loxone Config,
 * Niko software) are deliberately not modelled. An empty value is always valid (unassigned),
 * and an unspecified system accepts everything.
 */

/** Channel / address as a trimmed string; legacy numbers are stringified. */
export function normalizeChannel(channel: unknown): string | undefined {
  if (typeof channel === 'number') return Number.isFinite(channel) ? String(channel) : undefined
  if (typeof channel !== 'string') return undefined
  const trimmed = channel.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Duplicate detection key: trimmed, case-insensitive. */
export function addressKey(value: string): string {
  return value.trim().toLowerCase()
}

/** Trimmed, non-empty groups without case-insensitive duplicates, in their original order. */
export function normalizeGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    const value = normalizeChannel(group)
    if (value == null || seen.has(addressKey(value))) continue
    seen.add(addressKey(value))
    result.push(value)
  }
  return result
}

/** Groups typed as text, separated by commas, semicolons or whitespace. */
export function parseGroupsInput(text: string): string[] | undefined {
  const groups = normalizeGroups(text.split(/[\s,;]+/))
  return groups.length > 0 ? groups : undefined
}

export function formatGroups(groups: readonly string[] | undefined): string {
  return (groups ?? []).join(', ')
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  if (!/^[0-9]+$/.test(value)) return false
  const parsed = Number(value)
  return parsed >= min && parsed <= max
}

function isKnxGroupAddress(value: string): boolean {
  const parts = value.split('/')
  if (parts.length === 3) {
    return (
      isIntegerInRange(parts[0]!, 0, 31) &&
      isIntegerInRange(parts[1]!, 0, 7) &&
      isIntegerInRange(parts[2]!, 0, 255)
    )
  }
  return parts.length === 2 && isIntegerInRange(parts[0]!, 0, 31) && isIntegerInRange(parts[1]!, 0, 2047)
}

/** Systems whose connections carry logical groups next to the physical channel. */
export function systemUsesGroups(system: ControlSystem | undefined): boolean {
  return system === 'knx' || system === 'dali'
}

/** Device address on the bus. KNX: physical address `area.line.device` (0-15.0-15.0-255). */
export function validateDeviceAddress(system: ControlSystem | undefined, address: string): boolean {
  const value = address.trim()
  if (value === '' || system !== 'knx') return true
  const parts = value.split('.')
  return (
    parts.length === 3 &&
    isIntegerInRange(parts[0]!, 0, 15) &&
    isIntegerInRange(parts[1]!, 0, 15) &&
    isIntegerInRange(parts[2]!, 0, 255)
  )
}

/**
 * Physical channel on a device.
 * - KNX: actuator channel letter `A`-`Z` or number 1-64.
 * - DALI: short address 0-63, optionally prefixed with `A`.
 * - Loxone: `AQ1`, `AI1`, `DI1`, `DO1`, `Q1`, `I1` with an optional extension prefix (`Ext1.AQ1`).
 * - Niko Home Control and other: free.
 */
export function validateChannel(system: ControlSystem | undefined, channel: string): boolean {
  const value = channel.trim()
  if (value === '') return true
  switch (system) {
    case 'knx':
      return /^[A-Za-z]$/.test(value) || isIntegerInRange(value, 1, 64)
    case 'dali': {
      const short = /^A?([0-9]+)$/i.exec(value)
      return short != null && isIntegerInRange(short[1]!, 0, 63)
    }
    case 'loxone':
      return /^(?:ext[0-9]+\.)?(?:AQ|AI|DI|DO|Q|I)[0-9]+$/i.test(value)
    default:
      return true
  }
}

/**
 * Logical group.
 * - KNX: group address `main/middle/sub` (0-31 / 0-7 / 0-255) or `main/sub` (0-31 / 0-2047).
 * - DALI: group `G0`-`G15` or `broadcast`.
 * - Other systems: free.
 */
export function validateGroup(system: ControlSystem | undefined, group: string): boolean {
  const value = group.trim()
  if (value === '') return true
  switch (system) {
    case 'knx':
      return isKnxGroupAddress(value)
    case 'dali': {
      const normalized = value.toUpperCase()
      if (normalized === 'BROADCAST') return true
      const match = /^G([0-9]+)$/.exec(normalized)
      return match != null && isIntegerInRange(match[1]!, 0, 15)
    }
    default:
      return true
  }
}

/** System that addresses the device's channels: the output side of a gateway. */
export function getChannelSystem(device: ControlDeviceFields | undefined): ControlSystem | undefined {
  return device?.outputSystem ?? device?.system
}

/** Systems whose groups may appear on the device's connections (both sides of a gateway). */
export function getGroupSystems(device: ControlDeviceFields | undefined): ControlSystem[] {
  const systems = [device?.system, device?.outputSystem].filter(
    (system): system is ControlSystem => system != null
  )
  return [...new Set(systems)]
}

export function deviceUsesGroups(device: ControlDeviceFields | undefined): boolean {
  return getGroupSystems(device).some(systemUsesGroups)
}

export function validateDeviceChannel(device: ControlDeviceFields | undefined, channel: string): boolean {
  return validateChannel(getChannelSystem(device), channel)
}

/** A group is valid when it matches either side of a gateway. */
export function validateDeviceGroup(device: ControlDeviceFields | undefined, group: string): boolean {
  const systems = getGroupSystems(device)
  return systems.length === 0 || systems.some((system) => validateGroup(system, group))
}
