/** Manual risers (`Branch.stem`): a second cable leaving the breaker. Shared by layout, wire identity and export. */
import type { Branch, Circuit } from '@/types/schema'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'

type StemField = { stem?: number }

/** Stem of a root branch: 0 = the trunk, k = riser k. Legs never carry one. */
export function getBranchStem(branch: Branch & StemField): number {
  return branch.forkFrom ? 0 : branch.stem ?? 0
}

export function circuitHasRootStems(circuit: Pick<Circuit, 'branches'>): boolean {
  return !!circuit.branches?.some((branch) => getBranchStem(branch) > 0)
}

/** Wire-run anchor of a riser that has no symbol yet (its cable ends open above the breaker). */
export function getEmptyRiserWireAnchor(circuitId: string, protectionId: string, stem: number, domain = 'AC'): string {
  return deriveWireAnchorKey({
    kind: 'circuit-section', circuitId, domain,
    nodeRef: `open-end:protection:${encodeURIComponent(protectionId)}:riser-${stem}`,
  })
}
