import { walkPanels } from '@/lib/panel/panelTree'
import type { Circuit, Panel } from '@/types/schema'
import { getSupplyTapsPanel } from './virtualPanel'

/** A tap whose lead starts with a terminal strip: only a protection may follow the strip. */
export function isStripLedSupplyTapCircuit(circuit: Circuit): boolean {
  if (!circuit.supplyTap) return false
  const first = [...(circuit.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )[0]
  return first?.symbol === 'terminal_strip'
}

/** Strip-led tap circuits that carry endpoints or branches themselves (not behind a protection). */
export function findLoadedStripLedSupplyTapCircuitIds(panels: Panel[]): Set<string> {
  const ids = new Set<string>()
  for (const owner of walkPanels(panels)) {
    for (const circuit of getSupplyTapsPanel(owner)?.circuits ?? []) {
      if (!isStripLedSupplyTapCircuit(circuit)) continue
      if (circuit.endpoints.length > 0 || (circuit.branches ?? []).some((branch) => branch.endpointIds.length > 0))
        ids.add(circuit.id)
    }
  }
  return ids
}
