import { walkPanels } from '@/lib/panel/panelTree'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSupplyTapUpstreamDevicesForOwner } from '@/lib/supplyTaps/tapFeedDevice'
import { getSupplyTapOrigin } from '@/lib/supplyTaps/tapOrigin'
import { listSupplyTaps } from '@/lib/supplyTaps/virtualPanel'
import {
  collectTerminalStripOccurrences,
  getTerminalStripId,
  getTerminalStripPin,
} from '@/lib/terminalStrip/labels'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit } from '@/types/schema'

/** The terminal a tap leaves an originating strip through. */
export interface SupplyTapTerminal {
  stripId: string
  pin: number
  /** True when the tap has no strip section of its own: the number is assigned for display only. */
  implicit: boolean
}

export interface SupplyTapFeed {
  originDeviceId: string
  target: { kind: 'protection' | 'circuit'; id: string }
  terminal?: SupplyTapTerminal
}

function firstTrunkDevice(circuit: Circuit) {
  return [...(circuit.trunkDevices ?? [])].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))[0]
}

/**
 * The star feeds of every supply tap: each top-level tap is fed from its origin (see
 * `getSupplyTapOrigin`). Taps leaving an originating strip get a terminal on it; a tap that starts
 * with its own section of that strip keeps that number, the others take the next free numbers in
 * tap order without changing the project.
 */
export function collectSupplyTapFeeds(project: ProjectV2): SupplyTapFeed[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const feeds: SupplyTapFeed[] = []
  const usedPins = new Map<string, Set<number>>()
  const pinsOf = (stripId: string) => {
    let used = usedPins.get(stripId)
    if (!used) {
      used = new Set(
        collectTerminalStripOccurrences(project)
          .filter((occurrence) => occurrence.stripId.toUpperCase() === stripId.toUpperCase())
          .map((occurrence) => occurrence.pin)
      )
      usedPins.set(stripId, used)
    }
    return used
  }
  for (const owner of walkPanels(getProjectElectricalPanels(project))) {
    for (const entry of listSupplyTaps(owner)) {
      const anchor = entry.anchor ?? { leg: 'grid-run' as const }
      const origin = getSupplyTapOrigin(getSupplyTapUpstreamDevicesForOwner(installation, owner.id, anchor))
      if (!origin) continue
      const feed: SupplyTapFeed = { originDeviceId: origin.id, target: { kind: entry.kind, id: entry.item.id } }
      if (origin.symbol === 'terminal_strip') {
        const stripId = getTerminalStripId(origin) || '1'
        const own = entry.kind === 'circuit' ? firstTrunkDevice(entry.item) : undefined
        const ownPin = own?.symbol === 'terminal_strip' && getTerminalStripId(own).toUpperCase() === stripId.toUpperCase()
          ? getTerminalStripPin(own)
          : undefined
        if (ownPin != null) feed.terminal = { stripId, pin: ownPin, implicit: false }
        else {
          const used = pinsOf(stripId)
          let pin = 1
          while (used.has(pin)) pin += 1
          used.add(pin)
          feed.terminal = { stripId, pin, implicit: true }
        }
      }
      feeds.push(feed)
    }
  }
  return feeds
}
