import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findLoadedDirectTrunkFeederCircuitIds } from '@/lib/eendraad/directTrunkFeeder'
import { findLoadedStripLedSupplyTapCircuitIds } from '@/lib/supplyTaps/stripTapLoads'
import { CommandError } from './types'

/**
 * A kWh meter wired directly to a busbar has no protection in front of it, so only protections
 * may follow it. Every edit (drops, moves, plan assignment, assistant and MCP tools) is refused
 * when it newly puts endpoints or branches on such a meter circuit. Older files that already
 * break the rule stay editable; validation reports them.
 */
export function assertDirectTrunkFeedersCarryNoLoads(before: ProjectV2, after: ProjectV2): void {
  const loaded = findLoadedDirectTrunkFeederCircuitIds(getProjectElectricalPanels(after))
  if (loaded.size === 0) return
  const previous = findLoadedDirectTrunkFeederCircuitIds(getProjectElectricalPanels(before))
  if ([...loaded].some((id) => !previous.has(id))) {
    throw new CommandError('check_failed', 'Only a protection can follow a kWh meter connected directly to the busbar', {
      reason: 'unprotected_meter_load',
    })
  }
}

/**
 * A supply tap that leaves the grid wire through a terminal strip has no protection yet: like a
 * directly wired meter, only a protection may follow the strip. Edits that newly put loads on such
 * a tap circuit are refused; older files stay editable.
 */
export function assertStripLedSupplyTapsCarryNoLoads(before: ProjectV2, after: ProjectV2): void {
  const loaded = findLoadedStripLedSupplyTapCircuitIds(getProjectElectricalPanels(after))
  if (loaded.size === 0) return
  const previous = findLoadedStripLedSupplyTapCircuitIds(getProjectElectricalPanels(before))
  if ([...loaded].some((id) => !previous.has(id))) {
    throw new CommandError('check_failed', 'Only a protection can follow a terminal strip on a supply tap', {
      reason: 'unprotected_strip_tap_load',
    })
  }
}
