import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import type { Circuit, TrunkDevice } from '@/types/schema'
import { getSupplyTapsPanel } from './virtualPanel'

/**
 * The supply device a tap leaves the grid wire after, for any circuit of that tap (the tap's own
 * circuit or one nested below it, such as the breaker after a tap's terminal strip). Undefined
 * for circuits that are no tap, and for taps at the start of a leg.
 */
export function findSupplyTapAnchorDevice(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): TrunkDevice | undefined {
  const installation = getProjectElectricalInstallation(project)
  for (const owner of walkPanels(getProjectElectricalPanels(project))) {
    const board = getSupplyTapsPanel(owner)
    if (!board) continue
    const byId = new Map<string, Circuit>()
    for (const circuit of board.circuits ?? []) byId.set(circuit.id, circuit)
    for (const protection of board.protections ?? [])
      for (const circuit of protection.circuits ?? []) byId.set(circuit.id, circuit)
    const contains = (circuit: Circuit, seen = new Set<string>()): boolean => {
      if (circuit.id === circuitId) return true
      if (seen.has(circuit.id)) return false
      seen.add(circuit.id)
      return (circuit.subCircuitIds ?? []).some((id) => {
        const child = byId.get(id)
        return !!child && contains(child, seen)
      })
    }
    const tops = [
      ...(board.protections ?? []).flatMap((protection) =>
        protection.supplyTap ? (protection.circuits ?? []).map((circuit) => ({ circuit, anchor: protection.supplyTap! })) : []
      ),
      ...(board.circuits ?? []).flatMap((circuit) => (circuit.supplyTap ? [{ circuit, anchor: circuit.supplyTap }] : [])),
    ]
    const top = tops.find(({ circuit }) => contains(circuit))
    if (!top) continue
    const deviceId = top.anchor.afterTrunkDeviceId
    if (!deviceId) return undefined
    return installation?.feedTopology?.rootFeeds
      ?.find((feed) => feed.panelId === owner.id)
      ?.trunkDevices?.find((device) => device.id === deviceId)
  }
  return undefined
}
