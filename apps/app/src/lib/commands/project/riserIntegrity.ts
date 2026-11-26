import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { canEditOneWireRisers, hasOneWireRisers, normalizeCircuitStems } from '@/lib/eendraad/oneWireRisers'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { CommandError } from './types'

/** Runs inside every command transaction: keeps riser stems contiguous and rows sorted by stem. */
export function normalizeRiserStems(draft: ProjectV2): void {
  for (const circuit of [...walkPanels(getProjectElectricalPanels(draft))].flatMap(collectCircuits)) {
    // Rows moved or renumbered: points follow the new drawing order.
    if (circuit.branches?.some((branch) => branch.stem !== undefined) && normalizeCircuitStems(circuit)) syncSequentialEndpointBranchLabelsToCircuit(circuit)
  }
}

/**
 * A command may not add risers to, or add trunk devices / nested protections / sub-circuits
 * to, a circuit that cannot carry them. Circuits that were already malformed before the
 * command are left alone (they report a validation issue instead).
 */
export function assertRiserEditsStayEligible(before: ProjectV2, after: ProjectV2): void {
  const old = new Map([...walkPanels(getProjectElectricalPanels(before))].flatMap(collectCircuits).map((circuit) => [circuit.id, circuit]))
  for (const circuit of [...walkPanels(getProjectElectricalPanels(after))].flatMap(collectCircuits)) {
    if (circuit === old.get(circuit.id) || !hasOneWireRisers(circuit) || canEditOneWireRisers(circuit)) continue
    const previous = old.get(circuit.id)
    if (previous && hasOneWireRisers(previous) && !canEditOneWireRisers(previous)) continue
    throw new CommandError('check_failed', 'This edit is not possible on a circuit with risers', { reason: 'unsupported_riser' })
  }
}
