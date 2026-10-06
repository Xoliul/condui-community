import {
  canHaveControlLink,
  collectControlLinkEntries,
  findControlLinkDevices,
} from '@/lib/controlLink/controlLink'
import type { Endpoint, Panel } from '@/types/schema'

/** TRiK `Adres="PLC Q1"` on a contact, imported as the endpoint note line `address PLC Q1`. */
const TRIK_CONTROL_ADDRESS_NOTE = /^address\s+(.+?)\s+(\S+)\s*$/i

function getModuleName(module: Endpoint): string {
  return (module.notes ?? '').split('\n')[0]?.trim() || module.label.trim()
}

function matchesDeviceName(module: Endpoint, deviceName: string): boolean {
  const name = getModuleName(module).toLowerCase()
  const wanted = deviceName.toLowerCase()
  return name === wanted || name.startsWith(`${wanted} `)
}

/**
 * Links TRiK contacts whose address names a domotica module (`PLC Q1`) to that module.
 * The address only resolves when exactly one module carries that name, so it can run again
 * after another TRiK file adds the module. Unresolved addresses stay as notes.
 */
export function linkTrikControlAddresses(panels: Panel[]): number {
  const modules = findControlLinkDevices(panels)
    .map(({ endpoint }) => endpoint)
    .filter((endpoint) => endpoint.symbol === 'domotica')
  if (modules.length === 0) return 0

  let linked = 0
  for (const { endpoint } of collectControlLinkEntries(panels)) {
    if (!canHaveControlLink(endpoint) || endpoint.controlLink || !endpoint.notes) continue
    const lines = endpoint.notes.split('\n')
    const lineIndex = lines.findIndex((line) => TRIK_CONTROL_ADDRESS_NOTE.test(line.trim()))
    if (lineIndex < 0) continue
    const [, deviceName = '', channel = ''] =
      lines[lineIndex]!.trim().match(TRIK_CONTROL_ADDRESS_NOTE) ?? []
    const candidates = modules.filter((module) => matchesDeviceName(module, deviceName))
    if (candidates.length !== 1) continue

    endpoint.controlLink = { deviceId: candidates[0]!.id, channel }
    lines.splice(lineIndex, 1)
    endpoint.notes = lines.join('\n').trim() || undefined
    linked += 1
  }
  return linked
}
